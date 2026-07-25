/**
 * kr-state.js - State management, load/save, hydration
 * Dependencies: kr-core.js, kr-db.js (Dexie)
 * Provides: hydrate, load, save, schedulePersistentSave, storageSnapshot,
 *           syncReviewLog, activeDoc, debounce, saveCardChange, saveDocChange
 * Globals: state, webdavConfig, updateState, persistentSaveTimer, persistentSaveQueue
 */
function hydrate(raw) {
  try {
    if (!raw) return { ...structuredClone(base), documents: sampleDocs.map(normDoc) };
    const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
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
  try { ensureCardOrder(state.cards); syncReviewLog(); archiveOldReviewEvents(); localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('本地空间不足，请先导出备份。'); }
}
function load() {
  return hydrate(localStorage.getItem(KEY) || localStorage.getItem('knowledge-review-state-v1'));
}

// Initialize state after load() is defined.
// Synchronous load from localStorage as fast fallback; init() will upgrade to Dexie.
// Archive cooldown vars must be declared before the module-load call below.
let _lastArchiveTime = 0;
const ARCHIVE_COOLDOWN_MS = 60000; // 1 minute
state = load();
try { loadMarketCache(); } catch (e) { /* non-fatal */ }
syncReviewLog();
archiveOldReviewEvents();
ensureCardOrder(state.cards);
try { rebuildCardIndex(); } catch (e) { /* kr-db.js may not be loaded yet */ }

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
    // Pass state directly — Electron IPC serializes via structured clone automatically.
    // No need for structuredClone(state) which is expensive for large state objects.
    persistentSaveQueue = persistentSaveQueue.catch(() => {}).then(async () => {
      try {
        const result = await window.reviewBridge?.data?.save(state);
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
  // Use JSON round-trip instead of structuredClone for better performance.
  // structuredClone recursively traverses the object graph; JSON.stringify is
  // optimized by JS engines and handles our plain-data state efficiently.
  const snapshot = JSON.parse(JSON.stringify(state));
  if (snapshot.settings) delete snapshot.settings.dataDirectory;
  return JSON.stringify(snapshot, null, 2);
}

// ─── Save: debounced coordinator with incremental Dexie writes ───
// save() marks state as dirty and schedules async writes.
// Hot paths (card review, card edit) should use saveCardChange() for incremental saves.
let dexieSaveTimer = null;
let stateDirty = false;
let localStorageSaveTimer = null;
// Dirty flags for incremental Dexie saves.
// When saveCardChange/saveDocChange is called before save(), the card/document
// is already written to Dexie individually — scheduleDexieSave can skip the
// expensive bulk card/document sync and only write meta + review events.
let cardsBulkDirty = true;       // start true to ensure initial sync
let docsBulkDirty = true;
let cardIncrementalSaved = false;
let docIncrementalSaved = false;

// UI dirty flags — track which view sections need refresh.
// Set by mutation functions, consumed by refreshDirty().
const uiDirty = {
  tree: false, home: false, outline: false, heatmaps: false,
  reviewPlanControls: false, dock: false, standalone: false,
  reviewHome: false, reviewPlan: false, reviewHistory: false,
  cards: false, market: false, profile: false, badges: false,
};
function markDirty(parts) {
  if (!parts || typeof parts !== 'object') {
    for (const key of Object.keys(uiDirty)) uiDirty[key] = true;
    return;
  }
  for (const key of Object.keys(parts)) {
    if (parts[key] && key in uiDirty) uiDirty[key] = true;
  }
}
function clearDirty(parts) {
  if (!parts || typeof parts !== 'object') {
    for (const key of Object.keys(uiDirty)) uiDirty[key] = false;
    return;
  }
  for (const key of Object.keys(parts)) {
    if (parts[key] && key in uiDirty) uiDirty[key] = false;
  }
}

// Debounced async localStorage write — offloaded to Web Worker to avoid
// blocking the main thread with JSON.stringify of large state objects.
// Dexie is the primary store; localStorage is just a sync fallback.
const _serializeWorker = (() => {
  try {
    const code = 'self.onmessage=(e)=>{const{id,data}=e.data;try{const s=JSON.stringify(data);self.postMessage({id,ok:true,s:s})}catch(err){self.postMessage({id,ok:false,err:err.message})}}';
    const blob = new Blob([code], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  } catch (e) {
    console.warn('[Worker] Serialize worker unavailable, falling back to main thread:', e.message);
    return null;
  }
})();
let _serializeReqId = 0;
const _pendingSerialize = new Map();
if (_serializeWorker) {
  _serializeWorker.onmessage = (e) => {
    const cb = _pendingSerialize.get(e.data.id);
    if (!cb) return;
    _pendingSerialize.delete(e.data.id);
    cb(e.data);
  };
}
function scheduleLocalStorageSave() {
  if (localStorageFull) return;
  clearTimeout(localStorageSaveTimer);
  localStorageSaveTimer = setTimeout(() => {
    if (localStorageFull) return;
    if (!_serializeWorker) {
      // Fallback: synchronous serialization on main thread
      try {
        const serialized = JSON.stringify(state);
        if (serialized.length <= 4000000) {
          localStorage.setItem(KEY, serialized);
          localStorage.setItem(STATE_META_KEY, new Date().toISOString());
        }
      } catch (lsErr) {
        localStorageFull = true;
        toast('本地空间不足，数据已保存到磁盘和数据库。建议导出备份。');
      }
      return;
    }
    // Offload JSON.stringify to worker thread
    const reqId = ++_serializeReqId;
    _pendingSerialize.set(reqId, (msg) => {
      if (!msg.ok) {
        localStorageFull = true;
        return;
      }
      try {
        if (msg.s.length <= 4000000) {
          localStorage.setItem(KEY, msg.s);
          localStorage.setItem(STATE_META_KEY, new Date().toISOString());
        }
      } catch (lsErr) {
        localStorageFull = true;
        toast('本地空间不足，数据已保存到磁盘和数据库。建议导出备份。');
      }
    });
    _serializeWorker.postMessage({ id: reqId, data: state });
  }, 100);
}

function save() {
  try {
    ensureCardOrder(state.cards);
    syncReviewLog();
    archiveOldReviewEvents(); // rate-limited — won't run every save
    stateDirty = true;
    // If saveCardChange was NOT called for this save cycle, cards were bulk-modified
    // (import, dedup, delete, group rename, etc.) and need a full card sync.
    if (!cardIncrementalSaved) cardsBulkDirty = true;
    if (!docIncrementalSaved) docsBulkDirty = true;
    // Reset incremental flags for the next save cycle
    cardIncrementalSaved = false;
    docIncrementalSaved = false;
    // Async debounced localStorage write (non-blocking)
    scheduleLocalStorageSave();
    schedulePersistentSave();
    scheduleDexieSave();
    // Debounced cloud sync push (only runs when authenticated & online)
    try { scheduleCloudSyncPush(); } catch (e) {}
  } catch {
    toast('数据序列化失败，请导出备份。');
  }
}

// Incremental save: write a single card to Dexie without touching everything else.
async function saveCardChange(cardId) {
  cardIncrementalSaved = true; // mark as incrementally saved
  const card = getCardIndex().get(cardId) || state.cards.find((c) => c.id === cardId);
  if (card) {
    invalidateSignatureCache(card); // invalidate sync signature cache
    try { await saveCard(card); } catch (e) { console.warn('[Dexie] saveCard failed:', e.message); }
  }
}

// Incremental save: write a single document to Dexie.
async function saveDocChange(docId) {
  docIncrementalSaved = true; // mark as incrementally saved
  const doc = state.documents.find((d) => d.id === docId);
  if (doc) {
    invalidateSignatureCache(doc); // invalidate sync signature cache
    try { await saveDocument(doc); } catch (e) { console.warn('[Dexie] saveDocument failed:', e.message); }
  }
}

// Debounced Dexie save — uses incremental writes instead of full nuke-and-rewrite.
// Only syncs cards/documents when they were bulk-modified (not saved incrementally).
function scheduleDexieSave() {
  clearTimeout(dexieSaveTimer);
  dexieSaveTimer = setTimeout(async () => {
    if (!stateDirty) return;
    stateDirty = false;
    const restoreCardsDirty = cardsBulkDirty;
    const restoreDocsDirty = docsBulkDirty;
    try {
      const tasks = [];
      // Only sync cards if bulk-modified (individual cards already saved by saveCardChange)
      if (cardsBulkDirty) {
        cardsBulkDirty = false;
        tasks.push(syncCards(state.cards || []));
      }
      if (docsBulkDirty) {
        docsBulkDirty = false;
        tasks.push(syncDocuments(state.documents || []));
      }
      // Always write meta + review events (they're small, and review events change frequently)
      tasks.push(saveMetaAndEvents(state));
      await Promise.all(tasks);
    } catch (e) {
      console.warn('[Dexie] save failed:', e.message);
      stateDirty = true; // retry next time
      cardsBulkDirty = restoreCardsDirty; // restore dirty flags for retry
      docsBulkDirty = restoreDocsDirty;
    }
  }, 500);
}

// Force immediate Dexie flush (used before logout / window close).
// Uses saveFullState for complete consistency — clears and rewrites all stores.
async function flushDexie() {
  clearTimeout(dexieSaveTimer);
  clearTimeout(localStorageSaveTimer);
  // Flush localStorage synchronously before exit
  if (!localStorageFull) {
    try {
      const serialized = JSON.stringify(state);
      if (serialized.length <= 4000000) {
        localStorage.setItem(KEY, serialized);
        localStorage.setItem(STATE_META_KEY, new Date().toISOString());
      }
    } catch (e) { /* non-fatal */ }
  }
  if (!stateDirty) return;
  stateDirty = false;
  try { await saveFullState(state); } catch (e) { console.warn('[Dexie] flush failed:', e.message); stateDirty = true; }
}

function syncReviewLog() {
  if (!state?.reviewEvents) return;
  const next = {};
  state.reviewEvents.filter(reviewEventIsActive).forEach((event) => {
    const key = event.reviewedAt?.slice(0, 10);
    if (key) next[key] = (next[key] || 0) + 1;
  });
  state.reviewLog = next;
}

// Archive events older than 90 days to prevent unbounded growth.
// Separated from syncReviewLog() so save() doesn't mutate state.reviewEvents
// on every call. Runs on a 60s cooldown; called from save() and startup.
// (_lastArchiveTime and ARCHIVE_COOLDOWN_MS are declared earlier, before module-load code)
function archiveOldReviewEvents() {
  if (!state?.reviewEvents) return;
  const now = Date.now();
  if (now - _lastArchiveTime < ARCHIVE_COOLDOWN_MS) return;
  _lastArchiveTime = now;
  const ARCHIVE_THRESHOLD = 90 * 86400000; // 90 days in ms
  const cutoff = now - ARCHIVE_THRESHOLD;
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

// ─── Legacy IDB compatibility (for migration only) ───
let idbReady = false;
let localStorageFull = false;

// Load state from Dexie structured stores (called by init()).
// Returns { data, savedAt } or { _legacy, _raw, _savedAt } or null.
async function loadFromDexieWithFallback() {
  try {
    const data = await loadFromDexie();
    if (data.cards.length > 0 || data.documents.length > 0 || (data.settings && Object.keys(data.settings).length > 0)) {
      const savedAt = await getDexieSavedAt();
      return { data, savedAt };
    }
  } catch (e) {
    console.warn('[Dexie] load failed:', e.message);
  }
  // Fall back to legacy IDB single-blob
  try {
    const record = await idbGet('app-state');
    if (record && record.data) return { _legacy: true, _raw: record.data, _savedAt: record.savedAt || '' };
  } catch (e) { /* ignore */ }
  return null;
}

// Migrate old localStorage/IDB data to new structured Dexie stores.
async function migrateToDexie() {
  try {
    // First check if structured stores already have data
    const cardCount = await db.cards.count();
    if (cardCount > 0) return false; // already migrated

    // Try migrating from legacy IDB single-blob
    const migrated = await migrateOldData();
    if (migrated) return true;

    // Try migrating from localStorage
    const raw = localStorage.getItem(KEY) || localStorage.getItem('knowledge-review-state-v1');
    if (raw) {
      console.log('[Dexie] Migrating from localStorage to structured stores...');
      const oldState = hydrate(raw);
      await saveFullState(oldState);
      console.log('[Dexie] Migration complete.');
      return true;
    }
  } catch (e) {
    console.warn('[Dexie] migration failed:', e.message);
  }
  return false;
}
