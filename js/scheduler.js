/* ============================================================
   scheduler.js —— 间隔重复记忆调度算法（SM-2 改进版）
   
   SM-2 是 SuperMemo 公司提出的经典间隔重复算法：
   1. 根据用户的回忆质量 q(0~5) 更新"简易度系数" ease；
   2. 连续答对时按 1天 → 6天 → interval × ease 递增复习间隔；
   3. 答错则重置连续计数，短间隔后重新出现。
   
   本作业对原算法做两点改进：
   - 评分"忘记了"(q=1) 时 1 分钟后立即重现，强化短期记忆；
   - 引入"有印象"(q=3) 与"太简单"(q=5) 的差异化间隔调整。
   
   该算法模拟人脑遗忘曲线，是本作品的核心智能调度逻辑。
   ============================================================ */
(function (global) {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;
  var MINUTE = 60 * 1000;

  /**
   * 根据评分计算下一次复习安排
   * @param {Object} card 卡片对象（含 ease / interval / repetitions）
   * @param {number} grade 用户评分：1(忘记) / 3(有印象) / 4(记住) / 5(太简单)
   * @returns {Object} { ease, interval, repetitions, dueAt, correct }
   */
  function schedule(card, grade) {
    var ease = card.ease || 2.5;
    var interval = card.interval || 0;
    var reps = card.repetitions || 0;

    // 1) 更新简易度系数（SM-2 标准公式）
    ease = ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
    if (ease < 1.3) ease = 1.3; // 下限保护

    var dueAt;
    if (grade < 3) {
      // 没想起来：重置连续正确次数，1 分钟后重现
      reps = 0;
      interval = 0;
      dueAt = Date.now() + 1 * MINUTE;
    } else {
      // 想起来了：按 SM-2 规则递增间隔
      if (reps === 0) interval = 1;
      else if (reps === 1) interval = 6;
      else interval = Math.max(1, Math.round(interval * ease));

      // 差异化微调：q=3 略缩短，q=5 略拉长
      if (grade === 3) interval = Math.max(1, Math.round(interval * 0.8));
      if (grade === 5) interval = Math.round(interval * 1.3);

      reps += 1;
      dueAt = Date.now() + interval * DAY;
    }

    return {
      ease: Math.round(ease * 100) / 100,
      interval: interval,
      repetitions: reps,
      dueAt: dueAt,
      correct: grade >= 3
    };
  }

  /** 判断卡片是否到期（含 1 分钟内的短期重现） */
  function isDue(card, now) {
    return (card.dueAt || 0) <= (now || Date.now());
  }

  /** 熟练度等级：0 新卡 / 1 初学 / 2 巩固 / 3 掌握 */
  function masteryLevel(card) {
    if (!card.totalReviews) return 0;
    if (card.repetitions >= 4 && card.interval >= 21) return 3;
    if (card.repetitions >= 2) return 2;
    return 1;
  }

  global.Scheduler = { schedule: schedule, isDue: isDue, masteryLevel: masteryLevel, DAY: DAY };
})(window);
