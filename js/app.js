/* ============================================================
   app.js —— 主控制器：界面渲染与交互逻辑
   ============================================================ */
(function () {
  'use strict';

  var state = Store.load();
  var currentDeckId = null;     // 当前管理的卡组
  var studyDeckId = null;       // 当前学习的卡组
  var studyQueue = [];          // 本轮复习队列（卡片 id）
  var studyPos = 0;             // 队列位置
  var flipped = false;          // 卡片是否已翻转
  var session = null;           // 本轮学习统计
  var editingDeckId = null;     // 正在编辑的卡组 id（null = 新建）
  var editingCardId = null;     // 正在编辑的卡片 id（null = 新建）
  var aiResults = [];           // AI 生成的候选卡片

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---------------- 通用 UI ---------------- */
  var toastTimer;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function persist() {
    if (!Store.save(state)) toast('保存失败：浏览器存储空间可能已满');
  }

  function switchView(view) {
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('active', v.id === 'view-' + view);
    });
    if (view === 'decks') renderDecks();
    if (view === 'study') renderStudyEntry();
    if (view === 'stats') renderStats();
    if (view === 'settings') loadConfigToForm();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }

  /* ---------------- 卡组管理 ---------------- */
  function dueCount(deckId) {
    var now = Date.now();
    return state.cards.filter(function (c) {
      return (!deckId || c.deckId === deckId) && Scheduler.isDue(c, now);
    }).length;
  }

  function renderDecks() {
    var totalCards = state.cards.length;
    var mastered = state.cards.filter(function (c) { return Scheduler.masteryLevel(c) === 3; }).length;
    $('stat-decks').textContent = state.decks.length;
    $('stat-cards').textContent = totalCards;
    $('stat-due').textContent = dueCount();
    $('stat-mastered').textContent = mastered;

    var grid = $('deck-grid');
    if (!state.decks.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">' +
        '<div class="empty-icon">🗂️</div><h3>还没有卡组</h3>' +
        '<p>点击右上角「新建卡组」开始创建，或先加载示例卡组体验完整功能。</p>' +
        '<button class="btn btn-primary" id="empty-sample">加载示例卡组</button></div>';
      $('empty-sample').onclick = loadSample;
      return;
    }

    grid.innerHTML = state.decks.map(function (d) {
      var cards = state.cards.filter(function (c) { return c.deckId === d.id; });
      var m = cards.filter(function (c) { return Scheduler.masteryLevel(c) === 3; }).length;
      var pct = cards.length ? Math.round(m / cards.length * 100) : 0;
      return '<article class="deck-card">' +
        '<div class="deck-color" style="background:' + esc(d.color) + '"></div>' +
        '<button class="deck-delete" data-del-deck="' + d.id + '" title="删除卡组">×</button>' +
        '<span class="deck-badge">📚 学习卡组</span>' +
        '<h3>' + esc(d.name) + '</h3>' +
        '<p>' + esc(d.desc || '暂无描述') + '</p>' +
        '<div class="deck-meta"><span>卡片 <b>' + cards.length + '</b> 张</span>' +
        '<span>待复习 <b>' + dueCount(d.id) + '</b> 张</span></div>' +
        '<div class="deck-progress-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="deck-actions">' +
        '<button class="btn btn-ghost" data-manage="' + d.id + '">管理卡片</button>' +
        '<button class="btn btn-primary" data-study="' + d.id + '">开始学习 →</button>' +
        '</div></article>';
    }).join('');

    grid.querySelectorAll('[data-manage]').forEach(function (b) {
      b.onclick = function () { openDeck(b.dataset.manage); };
    });
    grid.querySelectorAll('[data-study]').forEach(function (b) {
      b.onclick = function () {
        studyDeckId = b.dataset.study;
        switchView('study');
      };
    });
    grid.querySelectorAll('[data-del-deck]').forEach(function (b) {
      b.onclick = function () {
        var d = state.decks.find(function (x) { return x.id === b.dataset.delDeck; });
        var n = state.cards.filter(function (c) { return c.deckId === b.dataset.delDeck; }).length;
        if (!confirm('确定删除卡组「' + (d ? d.name : '') + '」及其 ' + n + ' 张卡片吗？此操作不可恢复。')) return;
        state.decks = state.decks.filter(function (x) { return x.id !== b.dataset.delDeck; });
        state.cards = state.cards.filter(function (c) { return c.deckId !== b.dataset.delDeck; });
        persist(); renderDecks(); toast('卡组已删除');
      };
    });
  }

  function loadSample() {
    if (state.decks.length && !confirm('加载示例卡组会在现有数据基础上追加，确定继续吗？')) return;
    var s = Store.sampleData();
    state.decks.push(s.deck);
    state.cards = state.cards.concat(s.cards);
    persist(); renderDecks(); toast('示例卡组已加载：10 张人工智能核心概念卡片');
  }

  function openDeckModal(id) {
    editingDeckId = id || null;
    var d = id ? state.decks.find(function (x) { return x.id === id; }) : null;
    $('deck-modal-title').textContent = d ? '编辑卡组' : '新建卡组';
    $('deck-name').value = d ? d.name : '';
    $('deck-desc').value = d ? (d.desc || '') : '';
    openModal('modal-deck');
    setTimeout(function () { $('deck-name').focus(); }, 80);
  }

  function saveDeck() {
    var name = $('deck-name').value.trim();
    if (!name) { toast('请输入卡组名称'); return; }
    if (editingDeckId) {
      var d = state.decks.find(function (x) { return x.id === editingDeckId; });
      if (d) { d.name = name; d.desc = $('deck-desc').value.trim(); }
      toast('卡组已更新');
    } else {
      var colors = ['#5b5bd6', '#8b5cf6', '#0ea5e9', '#16a34a', '#f59e0b', '#ec4899'];
      state.decks.push({
        id: Store.uid(), name: name, desc: $('deck-desc').value.trim(),
        color: colors[state.decks.length % colors.length], createdAt: Date.now()
      });
      toast('卡组创建成功');
    }
    persist(); closeModal('modal-deck'); renderDecks();
  }

  /* ---------------- 卡片管理 ---------------- */
  function openDeck(id) {
    currentDeckId = id;
    var d = state.decks.find(function (x) { return x.id === id; });
    $('cards-deck-title').textContent = d ? d.name : '卡组';
    $('cards-deck-desc').textContent = d ? (d.desc || '') : '';
    $('card-search').value = '';
    switchView('cards');
    renderCards();
  }

  function renderCards() {
    var kw = $('card-search').value.trim().toLowerCase();
    var cards = state.cards.filter(function (c) {
      return c.deckId === currentDeckId &&
        (!kw || (c.front + c.back + (c.hint || '')).toLowerCase().indexOf(kw) >= 0);
    });
    $('card-count').textContent = '共 ' + cards.length + ' 张卡片';
    var list = $('card-list');
    if (!cards.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">🃏</div>' +
        '<h3>' + (kw ? '没有匹配的卡片' : '这个卡组还是空的') + '</h3>' +
        '<p>' + (kw ? '换个关键词试试。' : '手动添加卡片，或用「AI 生成卡片」从一段文字快速创建。') + '</p></div>';
      return;
    }
    list.innerHTML = cards.map(function (c, i) {
      var level = Scheduler.masteryLevel(c);
      var tag = level === 3 ? '<span class="mini-tag mastered">✓ 已掌握</span>' :
        (Scheduler.isDue(c) ? '<span class="mini-tag due">待复习</span>' : '<span class="mini-tag">复习 ' + c.totalReviews + ' 次</span>');
      return '<div class="card-row">' +
        '<div class="card-index">' + (i + 1) + '</div>' +
        '<div class="card-content"><div class="card-front-text">' + esc(c.front) + '</div>' +
        '<div class="card-back-text">' + esc(c.back) + '</div>' +
        '<div class="card-tags">' + tag + (c.hint ? '<span class="mini-tag">提示：' + esc(c.hint) + '</span>' : '') + '</div></div>' +
        '<div class="card-actions">' +
        '<button data-edit-card="' + c.id + '" title="编辑">✎</button>' +
        '<button class="del" data-del-card="' + c.id + '" title="删除">🗑</button>' +
        '</div></div>';
    }).join('');

    list.querySelectorAll('[data-edit-card]').forEach(function (b) {
      b.onclick = function () { openCardModal(b.dataset.editCard); };
    });
    list.querySelectorAll('[data-del-card]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('确定删除这张卡片吗？')) return;
        state.cards = state.cards.filter(function (c) { return c.id !== b.dataset.delCard; });
        persist(); renderCards(); toast('卡片已删除');
      };
    });
  }

  function openCardModal(id) {
    editingCardId = id || null;
    var c = id ? state.cards.find(function (x) { return x.id === id; }) : null;
    $('card-modal-title').textContent = c ? '编辑卡片' : '添加卡片';
    $('card-front').value = c ? c.front : '';
    $('card-back').value = c ? c.back : '';
    $('card-hint').value = c ? (c.hint || '') : '';
    openModal('modal-card');
    setTimeout(function () { $('card-front').focus(); }, 80);
  }

  function saveCard() {
    var front = $('card-front').value.trim(), back = $('card-back').value.trim();
    if (!front || !back) { toast('请填写问题和答案'); return; }
    if (editingCardId) {
      var c = state.cards.find(function (x) { return x.id === editingCardId; });
      if (c) { c.front = front; c.back = back; c.hint = $('card-hint').value.trim(); }
      toast('卡片已更新');
    } else {
      state.cards.push(Store.newCard(currentDeckId, front, back, $('card-hint').value.trim()));
      toast('卡片添加成功');
    }
    persist(); closeModal('modal-card'); renderCards();
  }

  /* ---------------- 学习中心 ---------------- */
  function renderStudyEntry() {
    var sel = $('study-deck-select');
    var prev = studyDeckId;
    sel.innerHTML = state.decks.map(function (d) {
      return '<option value="' + d.id + '">' + esc(d.name) + '（' + dueCount(d.id) + ' 张待复习）</option>';
    }).join('') || '<option value="">暂无卡组</option>';
    if (prev && state.decks.some(function (d) { return d.id === prev; })) sel.value = prev;
    studyDeckId = sel.value || null;
    startSession();
  }

  function startSession() {
    var now = Date.now();
    studyQueue = state.cards
      .filter(function (c) { return (!studyDeckId || c.deckId === studyDeckId) && Scheduler.isDue(c, now); })
      .map(function (c) { return c.id; });
    // 洗牌，避免固定顺序造成位置记忆
    for (var i = studyQueue.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = studyQueue[i]; studyQueue[i] = studyQueue[j]; studyQueue[j] = t;
    }
    studyPos = 0;
    session = { reviewed: 0, correct: 0, again: 0, start: Date.now() };
    showStudyCard();
  }

  function showStudyCard() {
    var hasCard = studyPos < studyQueue.length;
    $('study-wrap').hidden = !hasCard;
    $('study-empty').hidden = hasCard;
    if (!hasCard) return;

    var card = state.cards.find(function (c) { return c.id === studyQueue[studyPos]; });
    if (!card) { studyPos++; return showStudyCard(); }
    flipped = false;
    $('flashcard').classList.remove('flipped');
    $('flash-front').textContent = card.front;
    $('flash-back').textContent = card.back;
    $('flash-hint').textContent = card.hint ? '💡 提示：' + card.hint : '点击卡片查看答案';
    $('rating-row').classList.add('disabled');
    $('study-progress-text').textContent = card.hint ? '先自己想一想，再看答案' : '先回忆答案，再翻转核对';
    $('study-progress-count').textContent = (studyPos + 1) + ' / ' + studyQueue.length;
    $('study-progress-fill').style.width = (studyPos / studyQueue.length * 100) + '%';
  }

  function flipCard() {
    if (!$('flashcard') || $('study-wrap').hidden) return;
    flipped = !flipped;
    $('flashcard').classList.toggle('flipped', flipped);
    $('rating-row').classList.toggle('disabled', !flipped);
    $('study-progress-text').textContent = flipped ? '根据回忆程度为这张卡片评分' : '先回忆答案，再翻转核对';
  }

  function rateCard(grade) {
    if (!flipped || studyPos >= studyQueue.length) return;
    var card = state.cards.find(function (c) { return c.id === studyQueue[studyPos]; });
    if (!card) return;
    var result = Scheduler.schedule(card, grade);
    card.ease = result.ease;
    card.interval = result.interval;
    card.repetitions = result.repetitions;
    card.dueAt = result.dueAt;
    card.lastReviewed = Date.now();
    card.totalReviews += 1;
    if (result.correct) card.correctCount += 1;
    state.reviewLog.push({ date: Store.today(), cardId: card.id, grade: grade, time: Date.now() });

    session.reviewed++;
    if (result.correct) session.correct++;
    if (grade === 1) {
      session.again++;
      // 答错的卡片在本轮末尾重现一次，强化记忆
      if (studyQueue.filter(function (id) { return id === card.id; }).length < 2) studyQueue.push(card.id);
    }
    studyPos++;
    persist();
    if (studyPos >= studyQueue.length) return finishSession();
    showStudyCard();
  }

  function finishSession() {
    $('study-progress-fill').style.width = '100%';
    $('study-progress-count').textContent = studyQueue.length + ' / ' + studyQueue.length;
    $('study-wrap').hidden = true;
    $('study-empty').hidden = false;
    $('study-empty').innerHTML = '<div class="empty-icon">🎉</div><h3>本轮复习完成</h3>' +
      '<p>共复习 ' + session.reviewed + ' 张卡片，明天继续巩固效果更好。</p>' +
      '<button class="btn btn-primary" id="btn-study-again">再复习一轮</button>';
    $('btn-study-again').onclick = function () {
      $('study-empty').innerHTML = '<div class="empty-icon">📚</div><h3>暂时没有待复习的卡片</h3>' +
        '<p>去「我的卡组」添加卡片，或稍后再来复习。间隔重复会让知识记得更久。</p>' +
        '<button class="btn btn-primary" data-view="decks">去管理卡组</button>';
      $('btn-study-again').onclick = null;
      startSession();
    };
    var mins = Math.max(1, Math.round((Date.now() - session.start) / 60000));
    $('summary-body').innerHTML =
      '<div class="summary-stat"><span>复习卡片</span><strong>' + session.reviewed + ' 张</strong></div>' +
      '<div class="summary-stat"><span>一次记住</span><strong>' + session.correct + ' 张</strong></div>' +
      '<div class="summary-stat"><span>需要加强</span><strong>' + session.again + ' 张</strong></div>' +
      '<div class="summary-stat"><span>正确率</span><strong>' +
      (session.reviewed ? Math.round(session.correct / session.reviewed * 100) : 0) + '%</strong></div>' +
      '<div class="summary-stat"><span>用时</span><strong>约 ' + mins + ' 分钟</strong></div>';
    openModal('modal-summary');
  }

  /* ---------------- 学习统计 ---------------- */
  function renderStats() {
    $('stat-reviews').textContent = state.reviewLog.length;
    var good = state.reviewLog.filter(function (r) { return r.grade >= 3; }).length;
    $('stat-accuracy').textContent = (state.reviewLog.length ? Math.round(good / state.reviewLog.length * 100) : 0) + '%';
    // 连续学习天数
    var days = {};
    state.reviewLog.forEach(function (r) { days[r.date] = true; });
    var streak = 0;
    for (var i = 0; i < 365; i++) {
      if (days[Store.today(-i)]) streak++;
      else if (i > 0) break;
    }
    $('stat-streak').textContent = streak;

    var names = ['新卡片', '初学', '巩固中', '已掌握'];
    var colors = ['#cbd5e1', '#f59e0b', '#8b5cf6', '#16a34a'];
    $('mastery-chart').innerHTML = names.map(function (n, idx) {
      var count = state.cards.filter(function (c) { return Scheduler.masteryLevel(c) === idx; }).length;
      var pct = state.cards.length ? Math.round(count / state.cards.length * 100) : 0;
      return '<div class="chart-row"><span class="chart-label">' + n + '</span>' +
        '<div class="chart-track"><div class="chart-fill" style="width:' + pct + '%;background:' + colors[idx] + '"></div></div>' +
        '<span class="chart-value">' + count + ' 张</span></div>';
    }).join('');

    $('deck-progress').innerHTML = state.decks.map(function (d) {
      var cards = state.cards.filter(function (c) { return c.deckId === d.id; });
      var m = cards.filter(function (c) { return Scheduler.masteryLevel(c) === 3; }).length;
      var pct = cards.length ? Math.round(m / cards.length * 100) : 0;
      return '<div class="progress-item"><strong>' + esc(d.name) + '</strong>' +
        '<p>' + m + ' / ' + cards.length + ' 张已掌握（' + pct + '%）</p>' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div></div>';
    }).join('') || '<p class="panel-desc">还没有卡组数据。</p>';

    $('activity-chart').innerHTML = Array.from({ length: 7 }, function (_, idx) {
      var d = Store.today(idx - 6);
      var count = state.reviewLog.filter(function (r) { return r.date === d; }).length;
      var max = Math.max(1, ...Object.values(state.reviewLog.reduce(function (acc, r) {
        acc[r.date] = (acc[r.date] || 0) + 1; return acc;
      }, {})));
      var h = Math.round(count / max * 100);
      return '<div class="chart-day"><div class="chart-track"><div class="chart-fill" style="height:' + h + '%"></div></div>' +
        '<span>' + d.slice(5) + '</span><span>' + count + '</span></div>';
    }).join('');
  }

  /* ---------------- AI 生成 ---------------- */
  function openAIModal() {
    if (!currentDeckId) { toast('请先选择一个卡组'); return; }
    aiResults = [];
    $('ai-source').value = '';
    $('ai-result').hidden = true;
    $('btn-ai-import').hidden = true;
    openModal('modal-ai');
  }

  async function runAI() {
    var text = $('ai-source').value.trim();
    if (text.length < 20) { toast('请粘贴至少 20 个字的知识文本'); return; }
    var limit = Math.min(12, Math.max(1, parseInt($('ai-count').value, 10) || 5));
    var btn = $('btn-ai-run');
    btn.disabled = true; btn.textContent = '正在生成…';
    try {
      aiResults = $('ai-mode').value === 'llm'
        ? await AI.llmGenerate(text, limit, state.config)
        : AI.localGenerate(text, limit);
      if (!aiResults.length) throw new Error('未能从文本中提取知识点，请换一段文字试试');
      renderAIResults();
      toast('生成了 ' + aiResults.length + ' 张候选卡片');
    } catch (e) {
      toast('生成失败：' + e.message);
    } finally {
      btn.disabled = false; btn.innerHTML = '✦ 开始生成';
    }
  }

  function renderAIResults() {
    $('ai-result').hidden = false;
    $('btn-ai-import').hidden = false;
    $('ai-result-list').innerHTML = aiResults.map(function (c, i) {
      return '<label class="ai-item"><input type="checkbox" data-ai-idx="' + i + '" checked>' +
        '<div><b>' + esc(c.front) + '</b><span>' + esc(c.back) + '</span></div></label>';
    }).join('');
  }

  function importAICards() {
    var picked = Array.prototype.slice.call(document.querySelectorAll('[data-ai-idx]:checked'))
      .map(function (el) { return aiResults[parseInt(el.dataset.aiIdx, 10)]; });
    if (!picked.length) { toast('请至少勾选一张卡片'); return; }
    picked.forEach(function (c) { state.cards.push(Store.newCard(currentDeckId, c.front, c.back, c.hint)); });
    persist(); closeModal('modal-ai'); renderCards(); renderDecks();
    toast('已导入 ' + picked.length + ' 张卡片');
  }

  /* ---------------- 设置 ---------------- */
  function loadConfigToForm() {
    $('cfg-endpoint').value = state.config.endpoint || '';
    $('cfg-key').value = state.config.key || '';
    $('cfg-model').value = state.config.model || '';
    updateStatus();
  }

  function saveConfig() {
    state.config = {
      endpoint: $('cfg-endpoint').value.trim(),
      key: $('cfg-key').value.trim(),
      model: $('cfg-model').value.trim()
    };
    persist(); updateStatus(); toast('配置已保存到本地浏览器');
  }

  function updateStatus() {
    var on = !!(state.config && state.config.key);
    $('ai-status').classList.toggle('online', on);
    $('ai-status-text').textContent = on ? '大模型 AI 已就绪' : '本地智能引擎';
  }

  async function testConfig() {
    var btn = $('btn-test-config');
    btn.disabled = true; btn.textContent = '测试中…';
    $('config-note').textContent = '正在连接…';
    try {
      await AI.testConnection({ endpoint: $('cfg-endpoint').value.trim(), key: $('cfg-key').value.trim(), model: $('cfg-model').value.trim() });
      $('config-note').textContent = '✓ 连接成功，模型可正常调用。';
    } catch (e) {
      $('config-note').textContent = '✗ 连接失败：' + e.message;
    } finally {
      btn.disabled = false; btn.textContent = '测试连接';
    }
  }

  function exportData() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '智闪卡备份_' + Store.today() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('数据已导出');
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data.decks || !data.cards) throw new Error('文件格式不正确');
        if (!confirm('导入将覆盖当前全部数据，确定继续吗？')) return;
        state = data;
        if (!state.reviewLog) state.reviewLog = [];
        if (!state.config) state.config = { endpoint: '', key: '', model: '' };
        persist(); renderDecks(); loadConfigToForm(); toast('数据导入成功');
      } catch (e) { toast('导入失败：' + e.message); }
    };
    reader.readAsText(file);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 使用事件委托：动态生成的按钮（如学习小结中的"去管理卡组"）同样可响应
    document.addEventListener('click', function (e) {
      var viewBtn = e.target.closest && e.target.closest('[data-view]');
      if (viewBtn) { switchView(viewBtn.dataset.view); return; }
      var closeBtn = e.target.closest && e.target.closest('[data-close]');
      if (closeBtn) closeModal(closeBtn.dataset.close);
    });
    document.querySelectorAll('.modal-backdrop').forEach(function (m) {
      m.onclick = function (e) { if (e.target === m) m.hidden = true; };
    });

    $('btn-load-sample').onclick = loadSample;
    $('btn-new-deck').onclick = function () { openDeckModal(); };
    $('btn-save-deck').onclick = saveDeck;
    $('btn-back-decks').onclick = function () { switchView('decks'); };
    $('btn-new-card').onclick = function () { openCardModal(); };
    $('btn-save-card').onclick = saveCard;
    $('card-search').oninput = renderCards;

    $('flashcard').onclick = flipCard;
    document.querySelectorAll('.rating-btn').forEach(function (b) {
      b.onclick = function () { rateCard(parseInt(b.dataset.grade, 10)); };
    });
    document.addEventListener('keydown', function (e) {
      if (!$('view-study').classList.contains('active')) return;
      if (document.querySelector('.modal-backdrop:not([hidden])')) return;
      if (e.code === 'Space') { e.preventDefault(); flipCard(); }
      var map = { '1': 1, '2': 3, '3': 4, '4': 5 };
      if (map[e.key] && flipped) rateCard(map[e.key]);
    });

    $('study-deck-select').onchange = function () { studyDeckId = this.value; startSession(); };
    $('btn-ai-generate').onclick = openAIModal;
    $('btn-ai-run').onclick = runAI;
    $('btn-ai-import').onclick = importAICards;
    $('btn-save-config').onclick = saveConfig;
    $('btn-test-config').onclick = testConfig;
    $('btn-export').onclick = exportData;
    $('btn-import').onclick = function () { $('file-import').click(); };
    $('file-import').onchange = function () { if (this.files[0]) importData(this.files[0]); this.value = ''; };
    $('btn-reset').onclick = function () {
      if (!confirm('⚠️ 确定清空全部卡组、卡片和复习记录吗？此操作不可恢复。建议先导出备份。')) return;
      state = Store.emptyState(); persist(); renderDecks(); loadConfigToForm(); toast('已清空全部数据');
    };
    $('btn-theme-info').onclick = function () {
      alert('智闪卡 · AI 辅助知识点闪卡学习工具\n\n《人工智能基础与应用》课程作业\n技术栈：HTML + CSS + 原生 JavaScript\n核心：SM-2 间隔重复算法 + 本地智能出题 + 可选大模型 API\n\n所有数据仅保存在你的浏览器中。');
    };
    $('ai-mode').onchange = function () {
      if (this.value === 'llm' && !state.config.key) {
        toast('尚未配置 API Key，将使用本地智能引擎');
        this.value = 'auto';
      }
    };
  }

  /* ---------------- 启动 ---------------- */
  bind();
  updateStatus();
  renderDecks();
})();
