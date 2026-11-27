/* ============================================================
   ai.js —— AI 辅助功能模块
   
   两档智能引擎：
   1) 本地智能提取（无需联网）：基于中文自然语言规则，从教材文本中
      识别"X是Y / X指Y"等定义句式，自动出题并生成填空式卡片；
   2) 大模型生成（可选）：通过兼容 OpenAI Chat Completions 格式的 API，
      调用大语言模型生成更高质量的问答卡片，密钥仅存本地。
   ============================================================ */
(function (global) {
  'use strict';

  /** 文本清洗与分句 */
  function splitSentences(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .split(/[。！？；\n]+/)
      .map(function (s) { return s.trim().replace(/^[，,、\s]+/, ''); })
      .filter(function (s) { return s.length >= 8; });
  }

  /** 去除句首的序号与多余符号 */
  function clean(s) {
    return s.replace(/^\s*[\d一二三四五六七八九十]+[.、．)）:：]\s*/, '').trim();
  }

  /**
   * 本地智能出题：解析定义句式 + 关键词填空 + 兜底分段
   * @param {string} text 知识文本
   * @param {number} limit 生成数量
   * @returns {Array<{front, back, hint}>}
   */
  function localGenerate(text, limit) {
    var sentences = splitSentences(text).map(clean);
    var results = [];
    var seen = {};

    function add(front, back, hint) {
      var key = front.slice(0, 14);
      if (!front || !back || seen[key] || results.length >= limit) return;
      seen[key] = true;
      results.push({ front: front, back: back, hint: hint || '' });
    }

    // 规则 1：识别 "X 是 / 是指 / 称为 / 叫做 Y" 定义句
    sentences.forEach(function (s) {
      if (results.length >= limit) return;
      var m = s.match(/^(.{2,18}?)(是指|指的是|是一种|是一个|是|称为|叫做|即为|即)(.{4,})$/);
      if (m) {
        add('什么是' + m[1].replace(/^(所谓|通常|一般)/, '') + '？', s, m[1] + '…（' + s.length + '字）');
        return;
      }
      // 规则 2：识别 "X：Y" 或 "X，指 Y" 结构
      var m2 = s.match(/^(.{2,16}?)[：:](.{4,})$/);
      if (m2) {
        add(m2[1] + '是什么？', m2[1] + '：' + m2[2], m2[2].slice(0, 3) + '…');
        return;
      }
      // 规则 3：按中文虚词切分，提取较短的实词短语做填空卡
      var parts = s.split(/[的是在了和与由为对中等可能将会把被而及其或]/)
        .filter(function (x) { return x.length >= 2 && x.length <= 8; });
      var term = parts.sort(function (a, b) { return b.length - a.length; })[0];
      if (term && s.length <= 120) {
        var blanked = s.replace(term, '______');
        add('填空题：' + blanked, s, term.slice(0, 1) + '…（' + term.length + '字）');
      }
    });

    // 规则 4：兜底——按长度切块生成简述卡
    if (results.length === 0) {
      var chunkSize = Math.max(40, Math.ceil(text.length / limit));
      for (var i = 0; i < text.length && results.length < limit; i += chunkSize) {
        var chunk = text.slice(i, i + chunkSize).trim();
        if (chunk.length < 8) continue;
        add('请简述：' + chunk.slice(0, 12) + '…', chunk, chunk.slice(0, 2) + '…');
      }
    }
    return results;
  }

  /** 从大模型返回的文本中解析 JSON 数组（兼容 markdown 代码块） */
  function parseCards(raw) {
    var text = String(raw || '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    var start = text.indexOf('[');
    var end = text.lastIndexOf(']');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    var arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('返回格式不是数组');
    return arr
      .filter(function (x) { return x && x.front && x.back; })
      .map(function (x) { return { front: String(x.front), back: String(x.back), hint: String(x.hint || '') }; });
  }

  /**
   * 调用大模型生成卡片（OpenAI Chat Completions 兼容格式）
   * @param {string} text 知识文本
   * @param {number} limit 数量
   * @param {Object} config { endpoint, key, model }
   */
  async function llmGenerate(text, limit, config) {
    if (!config.key) throw new Error('请先在「设置」中配置 API Key');
    var endpoint = config.endpoint || 'https://api.deepseek.com/v1/chat/completions';
    var model = config.model || 'deepseek-chat';
    var prompt = '你是学习卡片生成助手。请把下面的知识点整理成 ' + limit + ' 张问答闪卡。' +
      '要求：问题简洁明确、答案准确完整，覆盖不同知识点，避免重复。' +
      '只输出 JSON 数组，格式为 [{"front":"问题","back":"答案","hint":"可选提示"}]。\n\n知识点：\n' + text.slice(0, 6000);

    var resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.key },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: '你是一个严格输出 JSON 的学习助手，不要输出解释性文字。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      })
    });
    if (!resp.ok) throw new Error('接口请求失败：HTTP ' + resp.status);
    var data = await resp.json();
    var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('接口未返回有效内容');
    return parseCards(content).slice(0, limit);
  }

  /** 测试 API 连接是否可用 */
  async function testConnection(config) {
    if (!config.key) throw new Error('请先填写 API Key');
    var endpoint = config.endpoint || 'https://api.deepseek.com/v1/chat/completions';
    var model = config.model || 'deepseek-chat';
    var resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.key },
      body: JSON.stringify({ model: model, messages: [{ role: 'user', content: '请只回复 OK' }], max_tokens: 10 })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status + '，请检查地址、密钥与模型名称');
    var data = await resp.json();
    return !!(data.choices && data.choices.length);
  }

  global.AI = { localGenerate: localGenerate, llmGenerate: llmGenerate, testConnection: testConnection };
})(window);
