/* ============================================================
   storage.js —— 数据持久化层
   使用浏览器 localStorage 保存卡组、卡片、复习记录与配置。
   数据结构：
   {
     decks: [{ id, name, desc, color, createdAt }],
     cards: [{ id, deckId, front, back, hint,
               ease, interval, repetitions, dueAt,
               lastReviewed, totalReviews, correctCount }],
     reviewLog: [{ date, cardId, grade, time }],
     config: { endpoint, key, model }
   }
   ============================================================ */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'ai_flashcard_state_v1';

  /** 生成唯一 ID（时间戳 + 随机数） */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** 返回 YYYY-MM-DD 格式的本地日期 */
  function today(offsetDays) {
    var d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /** 默认空状态 */
  function emptyState() {
    return { decks: [], cards: [], reviewLog: [], config: { endpoint: '', key: '', model: '' } };
  }

  /** 读取状态；数据损坏时自动回退到空状态 */
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.decks) || !Array.isArray(data.cards)) return emptyState();
      if (!Array.isArray(data.reviewLog)) data.reviewLog = [];
      if (!data.config) data.config = { endpoint: '', key: '', model: '' };
      return data;
    } catch (e) {
      console.warn('读取本地数据失败，已重置：', e);
      return emptyState();
    }
  }

  /** 保存状态 */
  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('保存失败：', e);
      return false;
    }
  }

  /** 新建一张卡片，初始化 SM-2 调度参数 */
  function newCard(deckId, front, back, hint) {
    return {
      id: uid(),
      deckId: deckId,
      front: front || '',
      back: back || '',
      hint: hint || '',
      ease: 2.5,          // 简易度系数（SM-2 中 1.3 ~ 2.5+）
      interval: 0,        // 当前复习间隔（天）
      repetitions: 0,     // 连续正确次数
      dueAt: Date.now(),  // 到期时间：新卡立即加入复习队列
      lastReviewed: null,
      totalReviews: 0,
      correctCount: 0
    };
  }

  /** 内置示例卡组：《人工智能基础》核心概念，方便演示 */
  function sampleData() {
    var deck = {
      id: uid(), name: '人工智能基础 · 核心概念',
      desc: '课程作业演示卡组：机器学习、神经网络、深度学习等高频考点',
      color: '#5b5bd6', createdAt: Date.now()
    };
    var pairs = [
      ['什么是人工智能（AI）？', '计算机科学的一个分支，试图理解智能的实质，并生产出能以类似人类智能的方式做出反应的智能机器。', '图灵测试'],
      ['什么是机器学习？', '让计算机从数据中自动学习规律，并利用规律对未知数据进行预测的方法，无需显式编程。', '数据驱动'],
      ['机器学习的三大类型是什么？', '监督学习、无监督学习、强化学习。', '是否有标签 / 奖励反馈'],
      ['什么是神经网络？', '受生物神经系统启发建立的计算模型，由多层节点（神经元）组成，通过权重连接并传递信号。', '感知机 → 多层网络'],
      ['什么是深度学习？', '使用多层神经网络自动学习数据层次化特征表示的方法，"深度"指网络的层数较多。', '特征自动提取'],
      ['什么是过拟合？', '模型在训练数据上表现很好，但在新数据上表现很差的现象，通常因模型过于复杂或训练过度导致。', '泛化能力下降'],
      ['如何缓解过拟合？', '增加数据量、正则化（L1/L2）、Dropout、早停（early stopping）、数据增强等。', '正则化'],
      ['什么是 Transformer 架构？', '基于自注意力机制（Self-Attention）的神经网络架构，可并行处理序列，是大语言模型的主流基础架构。', 'Attention Is All You Need'],
      ['什么是生成式 AI？', '能够生成文本、图像、音频等新内容的 AI 技术，如大语言模型、扩散模型等。', 'AIGC'],
      ['什么是提示词工程（Prompt Engineering）？', '通过设计和优化输入提示，引导大模型输出更符合预期结果的方法。', '与 AI 交互的技巧']
    ];
    return {
      deck: deck,
      cards: pairs.map(function (p) { return newCard(deck.id, p[0], p[1], p[2]); })
    };
  }

  global.Store = {
    KEY: STORAGE_KEY,
    uid: uid,
    today: today,
    load: load,
    save: save,
    emptyState: emptyState,
    newCard: newCard,
    sampleData: sampleData
  };
})(window);
