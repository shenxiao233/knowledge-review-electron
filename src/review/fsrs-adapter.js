/**
 * fsrs-adapter.js - FSRS 间隔重复算法适配器
 *
 * 概述：
 *   本文件将 ts-fsrs 库的 FSRS（Free Spaced Repetition Scheduler）算法
 *   适配到 Notion Card 的数据模型中。FSRS 是一种基于机器学习的间隔重复算法，
 *   能根据用户的复习表现自动优化复习间隔。
 *
 * FSRS 核心概念：
 *   - State（状态）: New -> Learning -> Review -> Relearning
 *   - Rating（评分）: Again(1) / Hard(2) / Good(3) / Easy(4)
 *   - Stability（稳定性）: 记忆强度，决定复习间隔
 *   - Difficulty（难度）: 卡片固有难度
 *   - Retrievability（可提取性）: 当前记忆可提取概率
 *
 * 暴露的 API（通过 window.knowledgeFSRS）：
 *
 *   knowledgeFSRS.schedule(card, rating, settings)
 *     计算下次复习时间和卡片新状态
 *
 *   knowledgeFSRS.preview(card, settings)
 *     预览不同评分下的复习间隔（用于设置界面）
 *
 *   knowledgeFSRS.retrievability(card, now)
 *     计算当前卡片的可提取概率（0~1）
 *
 *   knowledgeFSRS.forget(card)
 *     重置卡片为全新状态
 *
 * 卡片字段映射：
 *   Notion Card        -> FSRS
 *   card.fsrsState     -> FSRS Card State
 *   card.dueAt         -> 下次复习时间 (ISO string)
 *   card.stability     -> 记忆稳定性
 *   card.difficulty    -> 难度参数
 *
 * 配置项（state.settings）：
 *   - desiredRetention: 目标保留率（默认 0.9）
 *   - enableFuzz: 是否启用间隔随机偏移（避免大量卡片同天到期）
 *   - maximumInterval: 最大复习间隔（天）
 *
 * 依赖：ts-fsrs (window.FSRS)
 * 参考：https://github.com/open-spaced-repetition/ts-fsrs
 */

(function attachKnowledgeFSRS(global) {
  const lib = global.FSRS;
  if (!lib) throw new Error('FSRS runtime was not loaded');

  const STATE_NAMES = ['New', 'Learning', 'Review', 'Relearning'];
  const RATING_NAMES = ['Manual', 'Again', 'Hard', 'Good', 'Easy'];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || min));
  const asDate = (value, fallback = new Date()) => {
    const date = new Date(value || fallback);
    return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
  };

  function params(settings = {}) {
    return {
      request_retention: clamp(settings.desiredRetention ?? 0.9, 0.8, 0.99),
      maximum_interval: 36500,
      enable_fuzz: false,
      enable_short_term: true,
      learning_steps: ['10m', '1d'],
      relearning_steps: ['10m', '1d']
    };
  }

  function normalize(card, now = new Date()) {
    const legacyReviews = Number(card.reviews || 0);
    const oldInterval = Math.max(0.1, Number(card.interval || 1));
    const source = card.fsrs || {};
    const state = source.state ?? (legacyReviews ? 'Review' : 'New');
    return {
      due: asDate(source.due || card.dueAt, now),
      stability: Math.max(0.001, Number(source.stability || (legacyReviews ? oldInterval : 0))),
      difficulty: clamp(source.difficulty || 5, 1, 10),
      elapsed_days: Math.max(0, Number(source.elapsedDays ?? 0)),
      scheduled_days: Math.max(0, Number(source.scheduledDays || (legacyReviews ? oldInterval : 0))),
      learning_steps: Number(source.learningSteps || 0),
      reps: Math.max(0, Number(source.reps ?? legacyReviews)),
      lapses: Math.max(0, Number(source.lapses || 0)),
      state: typeof state === 'number' ? state : state,
      last_review: source.lastReview ? asDate(source.lastReview, now) : null
    };
  }

  function serialize(card) {
    return {
      due: card.due.toISOString(),
      stability: Number(card.stability || 0),
      difficulty: Number(card.difficulty || 0),
      elapsedDays: Number(card.elapsed_days || 0),
      scheduledDays: Number(card.scheduled_days || 0),
      learningSteps: Number(card.learning_steps || 0),
      reps: Number(card.reps || 0),
      lapses: Number(card.lapses || 0),
      state: typeof card.state === 'number' ? STATE_NAMES[card.state] : card.state,
      lastReview: card.last_review ? card.last_review.toISOString() : null
    };
  }

  function migrate(card, now = new Date()) {
    return serialize(normalize(card, now));
  }

  function reset(now = new Date()) {
    return serialize(lib.createEmptyCard(now));
  }

  function next(card, rating, settings = {}, now = new Date()) {
    const grade = typeof rating === 'number' ? rating : RATING_NAMES.indexOf(rating);
    if (grade < 1 || grade > 4) throw new Error(`Unsupported FSRS rating: ${rating}`);
    const scheduler = lib.fsrs(params(settings));
    const result = scheduler.next(normalize(card, now), now, grade);
    const fsrs = serialize(result.card);
    return {
      fsrs,
      dueAt: fsrs.due,
      interval: Math.max(0, fsrs.scheduledDays),
      reviews: fsrs.reps,
      ease: Math.max(1.3, Math.min(5, 5 - fsrs.difficulty * 0.35)),
      log: {
        rating: RATING_NAMES[result.log.rating] || RATING_NAMES[grade],
        ratingValue: result.log.rating,
        state: STATE_NAMES[result.log.state] || result.log.state,
        due: result.log.due.toISOString(),
        stability: result.log.stability,
        difficulty: result.log.difficulty,
        elapsedDays: result.log.elapsed_days,
        scheduledDays: result.log.scheduled_days,
        review: result.log.review.toISOString()
      }
    };
  }

  function preview(card, settings = {}, now = new Date()) {
    const scheduler = lib.fsrs(params(settings));
    const records = scheduler.repeat(normalize(card, now), now);
    return [1, 2, 3, 4].map((rating) => {
      const item = records[rating];
      return { rating, label: RATING_NAMES[rating], due: item.card.due.toISOString(), days: item.card.scheduled_days };
    });
  }

  global.knowledgeFSRS = { normalize, migrate, next, preview, reset, ratingNames: RATING_NAMES, stateNames: STATE_NAMES };
})(window);
