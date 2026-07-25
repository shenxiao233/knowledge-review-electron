/**
 * kr-state.js - State management, load/save, hydration
 * Dependencies: kr-core.js
 * Provides: hydrate, load, save, schedulePersistentSave, storageSnapshot,
 *           syncReviewLog, activeDoc, debounce
 * Globals: state, webdavConfig, updateState, persistentSaveTimer, persistentSaveQueue
 */
function hydrate(raw) {
  try {
    if (!raw) return { ...structuredClone(base), documents: sampleDocs.map(normDoc) };
    const saved = JSON.parse(raw);
    const documents = Array.isArray(saved.documents) ? saved.documents.map(normDoc) : [];
    const folders = Array.isArray(saved.folders) ? [...saved.folders] : [];
    const cards = Array.isArray(saved.cards) ? saved.cards.map(normCard) : [];
    // Deduplicate by ID (cleans up entries from older hydrate versions that re-added samples)
    const _seen = new Set();
    const dedupedFolders = folders.filter((f) => { if (_seen.has(f.id)) return false; _seen.add(f.id); return true; });
    _seen.clear();
    const dedupedDocs = documents.filter((d) => { if (_seen.has(d.id)) return false; _seen.add(d.id); return true; });
    _seen.clear();
    const dedupedCards = cards.filter((c) => { if (_seen.has(c.id)) return false; _seen.add(c.id); return true; });
    ensureCardOrder(dedupedCards);
    const latestMastery = new Map();
    (Array.isArray(saved.reviewEvents) ? saved.reviewEvents : []).forEach((event) => { if (event.cardId && event.rating) latestMastery.set(event.cardId, event.rating === 'Easy' ? 'tooEasy' : event.rating === 'Good' ? 'familiar' : event.rating === 'Hard' ? 'fuzzy' : 'forgot'); });
    dedupedCards.forEach((card) => { if (!card.mastery && latestMastery.has(card.id)) card.mastery = latestMastery.get(card.id); });
    return {
      ...structuredClone(base), ...saved,
      folders: dedupedFolders,
      documents: dedupedDocs,
      cards: dedupedCards,
      reviewLog: saved.reviewLog || {},
      reviewEvents: Array.isArray(saved.reviewEvents) ? saved.reviewEvents : [],
      schemaVersion: 3,
      algorithm: 'fsrs',
      settings: { ...base.settings, ...(saved.settings || {}), desiredRetention: Number(saved.settings?.desiredRetention || 0.9), reviewPriority: ['new', 'review', 'mixed'].includes(saved.settings?.reviewPriority) ? saved.settings.reviewPriority : 'mixed', showStamps: saved.settings?.showStamps !== false, marketServerKey: typeof saved.settings?.marketServerKey === 'string' ? saved.settings.marketServerKey.trim() : encodeMarketServerKey(saved.settings?.marketServerUrl || ''), localMode: saved.settings?.localMode === true },
      reviewPlan: { ...base.reviewPlan, ...(saved.reviewPlan || {}), order: saved.reviewPlan?.order === 'random' ? 'random' : 'ordered' },
      profile: { ...base.profile, ...(saved.profile || {}), myDecks: Array.isArray(saved.profile?.myDecks) ? saved.profile.myDecks : [], publishedGroups: saved.profile?.publishedGroups && typeof saved.profile.publishedGroups === 'object' ? saved.profile.publishedGroups : {}, deckIds: saved.profile?.deckIds && typeof saved.profile.deckIds === 'object' ? saved.profile.deckIds : {} },
      market: { ...(base.market || { conflicts: [], decks: {} }), ...(saved.market || {}), conflicts: Array.isArray(saved.market?.conflicts) ? saved.market.conflicts : [], decks: saved.market?.decks && typeof saved.market.decks === 'object' ? saved.market.decks : {} },
      groups: [...new Set([...(saved.groups || []), ...cards.map((card) => card.folder)])],
      activeDocId: documents.some((doc) => doc.id === saved.activeDocId) ? saved.activeDocId : documents[0]?.id,
      favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
      syncMeta: {
        deviceId: typeof saved.syncMeta?.deviceId === 'string' ? saved.syncMeta.deviceId : '',
        serverDeviceId: typeof saved.syncMeta?.serverDeviceId === 'string' ? saved.syncMeta.serverDeviceId : '',
        lastSyncAt: typeof saved.syncMeta?.lastSyncAt === 'string' ? saved.syncMeta.lastSyncAt : null,
        versions: saved.syncMeta?.versions && typeof saved.syncMeta.versions === 'object' ? saved.syncMeta.versions : {},
        userId: typeof saved.syncMeta?.userId === 'string' ? saved.syncMeta.userId : '',
      },
    };
  } catch {
    return structuredClone(base);
  }
}
function saveLegacyLocalStorage() {
  try { ensureCardOrder(state.cards); syncReviewLog(); localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('本地空间不足，请先导出备份。'); }
}
function load() {
  return hydrate(localStorage.getItem(KEY) || localStorage.getItem('knowledge-review-state-v1'));
}

// Initialize state after load() is defined
state = load();
syncReviewLog();
ensureCardOrder(state.cards);

// State-dependent variable initialization (must run after state = load())
cardSortDirection = ['asc', 'desc', 'reviews-asc', 'reviews-desc'].includes(state.settings?.cardSortDirection)
  ? state.settings.cardSortDirection
  : 'asc';
marketApiBase = normalizeMarketApiBase(state.settings?.marketServerKey || state.settings?.marketServerUrl);
let webdavConfig = { url: '', remoteFolder: '', username: '', enabled: false, autoBackup: true, hasPassword: false, backupHistory: [] };
let webdavPushPromise = Promise.resolve();
let updateState = { status: 'idle', version: '', percent: 0, message: '' };
let persistentSaveTimer = null;
let persistentSaveQueue = Promise.resolve();
let persistentSaveWarned = false;
function schedulePersistentSave(immediate = false) {
  clearTimeout(persistentSaveTimer);
  const write = () => {
    const snapshot = structuredClone(state);
    persistentSaveQueue = persistentSaveQueue.catch(() => {}).then(async () => {
      try {
        const result = await window.reviewBridge?.data?.save(snapshot);
        if (result && !result.ok && !persistentSaveWarned) {
          persistentSaveWarned = true;
          console.warn('[PersistentSave] Disk save failed:', result.error);
          toast('磁盘保存失败，数据仍在内存中。请检查磁盘空间。');
        }
      } catch (err) {
        if (!persistentSaveWarned) {
          persistentSaveWarned = true;
          console.warn('[PersistentSave] Disk save threw an error:', err.message);
          toast('磁盘保存异常，数据仍在内存中。');
        }
      }
    });
  };
  if (immediate) write();
  else persistentSaveTimer = setTimeout(write, 350);
}
function storageSnapshot() {
  const snapshot = structuredClone(state);
  if (snapshot.settings) delete snapshot.settings.dataDirectory;
  return JSON.stringify(snapshot, null, 2);
}
function save() {
  try {
    ensureCardOrder(state.cards);
    syncReviewLog();
    const serialized = JSON.stringify(state);
    const savedAt = new Date().toISOString();
    // BUG-03 fix: Skip localStorage if it previously failed (quota exceeded)
    if (!localStorageFull) {
      try {
        localStorage.setItem(KEY, serialized);
        localStorage.setItem(STATE_META_KEY, savedAt);
      } catch (lsErr) {
        localStorageFull = true;
        toast('本地空间不足，数据已保存到磁盘和数据库。建议导出备份。');
      }
    }
    schedulePersistentSave();
    scheduleIDBSave();
    // Debounced cloud sync push (only runs when authenticated & online)
    try { scheduleCloudSyncPush(); } catch (e) {}
  } catch {
    toast('数据序列化失败，请导出备份。');
  }
}
function syncReviewLog() {
  if (!state?.reviewEvents) return;
  const next = {};
  state.reviewEvents.filter(reviewEventIsActive).forEach((event) => {
    const key = event.reviewedAt?.slice(0, 10);
    if (key) next[key] = (next[key] || 0) + 1;
  });
  state.reviewLog = next;

  // BUG-08 fix: Archive events older than 90 days to prevent unbounded growth.
  // The heatmap data is already captured in state.reviewLog above.
  const ARCHIVE_THRESHOLD = 90 * 86400000; // 90 days in ms
  const cutoff = Date.now() - ARCHIVE_THRESHOLD;
  if (state.reviewEvents.length > 500) {
    state.reviewEvents = state.reviewEvents.filter((event) => {
      if (!event.reviewedAt) return true;
      return new Date(event.reviewedAt).getTime() > cutoff;
    });
  }
}
function activeDoc() { return state.documents.find((doc) => doc.id === state.activeDocId) || state.documents[0]; }
function debounce(callback, delay = 250) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => callback(...args), delay); };
}
// ---- IndexedDB integration (Phase 0-②) ----
// IDB is the primary storage backend; localStorage remains as sync fallback.

let idbReady = false;
let idbSaveTimer = null;
let localStorageFull = false;

async function idbSaveState() {
  try {
    const serialized = JSON.stringify(state);
    await idbSet('app-state', { data: serialized, savedAt: new Date().toISOString() });
    return true;
  } catch (err) {
    console.warn('[IDB] save failed:', err);
    return false;
  }
}

async function idbLoadState() {
  try {
    const record = await idbGet('app-state');
    if (record && record.data) return record;
    return null;
  } catch (err) {
    console.warn('[IDB] load failed:', err);
    return null;
  }
}

function scheduleIDBSave() {
  clearTimeout(idbSaveTimer);
  idbSaveTimer = setTimeout(() => idbSaveState(), 500);
}

async function migrateLocalStorageToIDB() {
  const existing = await idbGet('app-state');
  if (existing) return false;
  const raw = localStorage.getItem(KEY) || localStorage.getItem('knowledge-review-state-v1');
  if (!raw) return false;
  try {
    await idbSet('app-state', { data: raw, savedAt: localStorage.getItem(STATE_META_KEY) || new Date().toISOString() });
    return true;
  } catch (err) {
    console.warn('[IDB] migration failed:', err);
    return false;
  }
}
