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
