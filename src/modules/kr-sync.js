/* ═══════════════════════════════════════════════
   kr-sync.js — Cloud Data Synchronization (Incremental)
   Syncs all local state to the server via SyncObject API:
   - Cards (content + FSRS state + review history)
   - Documents (notebook content)
   - Settings (preferences, groups, folders, profile, review data)

   Incremental sync strategy:
   - Each object gets a signature (hash of its JSON content)
   - On push, only objects whose signature changed are sent
   - Deleted objects are detected by absence from the signature map
   - After a successful push, signatures are updated
   - Pulled objects get their signatures updated to prevent re-push

   Uses POST /api/v2/sync/batch for pushing (max 100 per batch)
   Uses GET  /api/v2/sync/full for pulling
   Uses DELETE /api/v2/sync/:type/:id for deletions
   Conflict resolution: SERVER_WINS triggers local merge
   ═══════════════════════════════════════════════ */

// --- State ---
let cloudSyncBusy = false;
let cloudSyncPushTimer = null;
let cloudSyncSuppressPush = false;
const cloudSyncPushedSigs = new Map(); // "TYPE:id" -> signature string
let cloudSyncSigSaveTimer = null;
let pendingNewUserSeeding = false; // Set true on user switch; cloud pull confirms whether to seed samples
const CLOUD_SYNC_PUSH_DEBOUNCE = 5000; // 5 seconds
const CLOUD_SYNC_BATCH_SIZE = 100;
const SETTINGS_OBJECT_ID = 'app-settings';
const SIGS_STORAGE_KEY = 'kr-sync-sigs';

// --- Signature map persistence (survives app restarts) ---
function loadPushedSigs() {
  try {
    const raw = localStorage.getItem(SIGS_STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        cloudSyncPushedSigs.set(key, String(value));
      }
    }
  } catch (e) {
    console.warn('[CLOUD-SYNC] Failed to load pushed sigs:', e.message);
  }
}

function scheduleSavePushedSigs() {
  clearTimeout(cloudSyncSigSaveTimer);
  cloudSyncSigSaveTimer = setTimeout(() => {
    try {
      const obj = Object.fromEntries(cloudSyncPushedSigs);
      localStorage.setItem(SIGS_STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      // Non-fatal — sigs will be recomputed on next full sync
    }
  }, 2000);
}

// Load persisted signatures at module initialization
loadPushedSigs();

// --- Object signature ---
// Computes a lightweight hash that changes when any field of the object changes.
// This is used to detect which objects need to be pushed incrementally.
function objectSignature(obj) {
  try {
    const json = JSON.stringify(obj);
    let h = 0;
    for (let i = 0; i < json.length; i++) {
      h = ((h << 5) - h + json.charCodeAt(i)) | 0;
    }
    return h + ':' + json.length;
  } catch { return 'err:0'; }
}

function sigKey(objectType, objectId) { return `${objectType}:${objectId}`; }

function getPushedSig(objectType, objectId) {
  return cloudSyncPushedSigs.get(sigKey(objectType, objectId));
}

function setPushedSig(objectType, objectId, obj) {
  cloudSyncPushedSigs.set(sigKey(objectType, objectId), objectSignature(obj));
}

// --- Device ID management ---
function getDeviceId() {
  if (!state.syncMeta) state.syncMeta = {};
  if (!state.syncMeta.deviceId) {
    const existing = localStorage.getItem('kr-device-id');
    if (existing) {
      state.syncMeta.deviceId = existing;
    } else {
      const id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('kr-device-id', id);
      state.syncMeta.deviceId = id;
    }
  }
  return state.syncMeta.deviceId;
}

// --- Account isolation ---
// Ensures each user account has its own isolated local data.
// When the user switches accounts, the previous account's local data is cleared
// and the new account's data is pulled from the server.

function resetLocalStateForNewUser(userId) {
  // Preserve server address and local device ID across account switches
  const preservedServerKey = state.settings?.marketServerKey || '';
  const preservedDeviceId = state.syncMeta?.deviceId || localStorage.getItem('kr-device-id') || '';

  // 1. Clear cloud sync state (signatures, versions are per-account)
  cloudSyncPushedSigs.clear();
  try { localStorage.removeItem(SIGS_STORAGE_KEY); } catch (e) {}

  // 2. Reset local data to EMPTY state — cloud pull will populate if data exists.
  //    Sample data is seeded only AFTER pull confirms the user has no cloud data.
  //    This prevents local samples from polluting existing users' data via union merge.
  state.cards = [];
  state.documents = [];
  state.groups = [];
  state.folders = [];
  state.reviewEvents = [];
  state.reviewLog = {};
  state.favorites = [];
  state.profile = { name: '', bio: '', avatar: '', myDecks: [], publishedGroups: {}, deckIds: {} };
  state.settings = { ...base.settings, marketServerKey: preservedServerKey };
  state.reviewPlan = { ...base.reviewPlan };
  state.market = { conflicts: [], decks: {} };
  state.selectedCardId = null;
  state.activeDocId = null;
  state.extractedText = '';

  // 3. Reset sync metadata for the new user
  state.syncMeta = {
    deviceId: preservedDeviceId,
    serverDeviceId: '', // needs re-registration for the new account
    lastSyncAt: null,
    versions: {},
    userId: userId,
  };

  // 4. Flag: seed sample data after cloud pull confirms no existing data
  pendingNewUserSeeding = true;

  // 5. Persist the reset state to all local storage layers
  cloudSyncSuppressPush = true;
  try { save(); } finally { cloudSyncSuppressPush = false; }

  console.log(`[CLOUD-SYNC] Local state reset for user: ${userId}`);
}

// Seeds sample data for genuinely new users (no cloud data found after pull).
function seedSampleDataForNewUser() {
  state.cards = structuredClone(sampleCards);
  state.documents = sampleDocs.map(normDoc);
  state.groups = [...base.groups];
  state.folders = structuredClone(sampleFolders);
  state.selectedCardId = sampleCards[0]?.id || null;
  state.activeDocId = sampleDocs[0]?.id || null;
  cloudSyncSuppressPush = true;
  try { save(); } finally { cloudSyncSuppressPush = false; }
  refresh();
  console.log('[CLOUD-SYNC] Seeded sample data for new user (no cloud data found).');
}

function checkAndHandleUserChange(userId) {
  if (!userId) return false;
  if (!state.syncMeta) state.syncMeta = {};
  const storedUserId = state.syncMeta.userId;
  if (storedUserId === userId) return false; // same user, no change

  // User changed (or first login on this device) — reset local state
  console.log(`[CLOUD-SYNC] Account changed: ${storedUserId || '(none)'} → ${userId}. Resetting local data.`);
  resetLocalStateForNewUser(userId);
  return true;
}

// --- Version tracking ---
function getSyncVersion(objectType, objectId) {
  if (!state.syncMeta?.versions) return 0;
  return Number(state.syncMeta.versions[sigKey(objectType, objectId)] || 0);
}

function setSyncVersion(objectType, objectId, version) {
  if (!state.syncMeta) state.syncMeta = {};
  if (!state.syncMeta.versions) state.syncMeta.versions = {};
  state.syncMeta.versions[sigKey(objectType, objectId)] = Number(version) || 0;
}

function getLastSyncAt() { return state.syncMeta?.lastSyncAt || null; }
function setLastSyncAt(isoString) {
  if (!state.syncMeta) state.syncMeta = {};
  state.syncMeta.lastSyncAt = isoString || new Date().toISOString();
}

// --- Build settings data (shared by push & pull) ---
function buildSettingsData() {
  return {
    settings: state.settings || {},
    groups: state.groups || [],
    folders: state.folders || [],
    profile: state.profile || {},
    reviewPlan: state.reviewPlan || {},
    reviewLog: state.reviewLog || {},
    reviewEvents: state.reviewEvents || [],
    favorites: state.favorites || [],
    market: {
      decks: state.market?.decks || {},
      conflicts: state.market?.conflicts || [],
    },
    selectedCardId: state.selectedCardId || null,
    activeDocId: state.activeDocId || null,
    algorithm: state.algorithm || 'fsrs',
    schemaVersion: state.schemaVersion || 3,
  };
}

// --- Merge helpers (for pull/conflict resolution) ---
function mergeCardFromServer(localCard, serverCard) {
  if (!serverCard) return localCard;
  if (!localCard) return { ...serverCard };
  // Preserve local FSRS review state if local has equal or more reviews
  const localReviews = Number(localCard.reviews || 0);
  const serverReviews = Number(serverCard.reviews || 0);
  const merged = { ...serverCard };
  if (localReviews >= serverReviews) {
    merged.dueAt = localCard.dueAt;
    merged.interval = localCard.interval;
    merged.reviews = localCard.reviews;
    merged.mastery = localCard.mastery;
    merged.correctRate = localCard.correctRate;
    merged.ease = localCard.ease;
    merged.fsrs = localCard.fsrs;
    merged.resetAt = localCard.resetAt;
    merged.suspended = localCard.suspended;
    merged.noteRating = localCard.noteRating;
  }
  return merged;
}

function mergeDocumentFromServer(localDoc, serverDoc) {
  if (!serverDoc) return localDoc;
  if (!localDoc) return { ...serverDoc };
  const localTime = localDoc.updatedAt ? new Date(localDoc.updatedAt).getTime() : 0;
  const serverTime = serverDoc.updatedAt ? new Date(serverDoc.updatedAt).getTime() : 0;
  return serverTime > localTime ? { ...serverDoc } : { ...localDoc };
}

function mergeSettingsFromServer(serverSettingsData) {
  if (!serverSettingsData) return;
  if (serverSettingsData.settings) {
    state.settings = { ...state.settings, ...serverSettingsData.settings };
  }
  if (Array.isArray(serverSettingsData.groups)) {
    const localGroups = new Set(state.groups || []);
    serverSettingsData.groups.forEach((g) => localGroups.add(g));
    state.groups = [...localGroups];
  }
  if (Array.isArray(serverSettingsData.folders)) {
    // Deduplicate folders by ID (objects) or by value (strings).
    // Using a Map prevents duplicates that a Set would miss due to reference inequality.
    const folderMap = new Map();
    const folderKey = (f) => (f && typeof f === 'object' && f.id) ? f.id : String(f);
    (state.folders || []).forEach((f) => folderMap.set(folderKey(f), f));
    serverSettingsData.folders.forEach((f) => folderMap.set(folderKey(f), f));
    state.folders = [...folderMap.values()];
  }
  if (serverSettingsData.profile) {
    state.profile = { ...(state.profile || {}), ...serverSettingsData.profile };
  }
  if (serverSettingsData.reviewPlan) {
    state.reviewPlan = { ...(state.reviewPlan || {}), ...serverSettingsData.reviewPlan };
  }
  if (serverSettingsData.reviewLog) {
    state.reviewLog = { ...(state.reviewLog || {}), ...serverSettingsData.reviewLog };
  }
  if (Array.isArray(serverSettingsData.reviewEvents)) {
    const existing = new Set((state.reviewEvents || []).map((e) => `${e.cardId}|${e.reviewedAt}`));
    const merged = [...(state.reviewEvents || [])];
    serverSettingsData.reviewEvents.forEach((e) => {
      const key = `${e.cardId}|${e.reviewedAt}`;
      if (!existing.has(key)) merged.push(e);
    });
    state.reviewEvents = merged;
  }
  if (Array.isArray(serverSettingsData.favorites)) {
    const existing = new Set(state.favorites || []);
    serverSettingsData.favorites.forEach((f) => existing.add(f));
    state.favorites = [...existing];
  }
  if (serverSettingsData.market?.decks) {
    state.market = {
      ...(state.market || { conflicts: [], decks: {} }),
      decks: { ...(state.market?.decks || {}), ...serverSettingsData.market.decks },
    };
  }
}

// --- Incremental push to cloud ---
// Only pushes objects whose content has changed since the last successful push.
// Also detects and deletes objects that no longer exist locally.
async function pushToCloud() {
  if (!marketUnlocked || !marketToken || !navigator.onLine) return;
  const deviceId = getDeviceId();

  // --- Phase 1: Detect changed and deleted objects ---
  const requests = [];
  const changedKeys = new Set(); // track which objects we're pushing (for sig update)
  const currentKeys = new Set();

  // Check cards for changes
  for (const card of (state.cards || [])) {
    const key = sigKey('CARD', card.id);
    currentKeys.add(key);
    const sig = objectSignature(card);
    const oldSig = cloudSyncPushedSigs.get(key);
    if (oldSig !== sig) {
      requests.push({
        objectType: 'CARD',
        objectId: card.id,
        objectVersion: getSyncVersion('CARD', card.id) || 1,
        data: card,
        deviceId,
      });
      changedKeys.add(key);
    }
  }

  // Check documents for changes
  for (const doc of (state.documents || [])) {
    const key = sigKey('DOCUMENT', doc.id);
    currentKeys.add(key);
    const sig = objectSignature(doc);
    const oldSig = cloudSyncPushedSigs.get(key);
    if (oldSig !== sig) {
      requests.push({
        objectType: 'DOCUMENT',
        objectId: doc.id,
        objectVersion: getSyncVersion('DOCUMENT', doc.id) || 1,
        data: doc,
        deviceId,
      });
      changedKeys.add(key);
    }
  }

  // Check settings for changes
  const settingsData = buildSettingsData();
  const settingsKey = sigKey('SETTINGS', SETTINGS_OBJECT_ID);
  currentKeys.add(settingsKey);
  const settingsSig = objectSignature(settingsData);
  const oldSettingsSig = cloudSyncPushedSigs.get(settingsKey);
  if (oldSettingsSig !== settingsSig) {
    requests.push({
      objectType: 'SETTINGS',
      objectId: SETTINGS_OBJECT_ID,
      objectVersion: getSyncVersion('SETTINGS', SETTINGS_OBJECT_ID) || 1,
      data: settingsData,
      deviceId,
    });
    changedKeys.add(settingsKey);
  }

  // Detect deletions: objects in the sig map but no longer in current state
  const deletedKeys = [];
  for (const key of cloudSyncPushedSigs.keys()) {
    if (!currentKeys.has(key)) {
      const [objectType, objectId] = key.split(':');
      deletedKeys.push({ objectType, objectId, key });
    }
  }

  // --- Phase 2: Push changed objects in batches ---
  const conflictsToMerge = [];
  let pushSuccessCount = 0;

  for (let i = 0; i < requests.length; i += CLOUD_SYNC_BATCH_SIZE) {
    const batch = requests.slice(i, i + CLOUD_SYNC_BATCH_SIZE);
    try {
      const result = await marketApi('/v2/sync/batch', {
        method: 'POST',
        body: JSON.stringify({ requests: batch }),
      });
      const responses = result?.responses || [];
      for (const resp of responses) {
        if (resp.conflict && resp.resolution === 'SERVER_WINS' && resp.data) {
          conflictsToMerge.push({
            objectType: resp.objectType,
            objectId: resp.objectId,
            serverVersion: resp.serverVersion,
            data: resp.data,
          });
        } else if (!resp.conflict) {
          setSyncVersion(resp.objectType, resp.objectId, resp.serverVersion);
          // Update signature to prevent re-push of unchanged data
          const req = batch.find((r) => r.objectId === resp.objectId && r.objectType === resp.objectType);
          if (req?.data) {
            cloudSyncPushedSigs.set(sigKey(resp.objectType, resp.objectId), objectSignature(req.data));
          }
          pushSuccessCount++;
        }
      }
    } catch (err) {
      console.warn('[CLOUD-SYNC] Push batch failed:', err.message);
    }
  }

  // --- Phase 3: Delete removed objects from server (parallel for low latency) ---
  await Promise.allSettled(deletedKeys.map(async ({ objectType, objectId, key }) => {
    try {
      await marketApi(`/v2/sync/${objectType}/${encodeURIComponent(objectId)}`, { method: 'DELETE' });
      cloudSyncPushedSigs.delete(key);
      setSyncVersion(objectType, objectId, 0);
    } catch (err) {
      // Non-fatal — might already be deleted on server
      if (/not found|404/i.test(err.message || '')) {
        cloudSyncPushedSigs.delete(key);
        setSyncVersion(objectType, objectId, 0);
      }
    }
  }));

  // --- Phase 4: Merge conflicts from server ---
  if (conflictsToMerge.length > 0) {
    let needsRefresh = false;
    for (const conflict of conflictsToMerge) {
      if (conflict.objectType === 'CARD') {
        const idx = state.cards.findIndex((c) => c.id === conflict.objectId);
        const localCard = idx >= 0 ? state.cards[idx] : null;
        const localReviews = Number(localCard?.reviews || 0);
        const serverReviews = Number(conflict.data?.reviews || 0);
        if (idx >= 0) {
          state.cards[idx] = mergeCardFromServer(localCard, conflict.data);
        } else {
          state.cards.push(normCard(conflict.data));
        }
        setSyncVersion('CARD', conflict.objectId, conflict.serverVersion);
        // If we preserved local FSRS state, the merged card differs from server.
        // Delete the pushed sig so the merged result gets pushed back to the server.
        if (localReviews >= serverReviews) {
          cloudSyncPushedSigs.delete(sigKey('CARD', conflict.objectId));
        } else {
          setPushedSig('CARD', conflict.objectId, state.cards.find((c) => c.id === conflict.objectId) || conflict.data);
        }
        needsRefresh = true;
      } else if (conflict.objectType === 'DOCUMENT') {
        const idx = state.documents.findIndex((d) => d.id === conflict.objectId);
        if (idx >= 0) {
          state.documents[idx] = mergeDocumentFromServer(state.documents[idx], conflict.data);
        } else {
          state.documents.push(normDoc(conflict.data));
        }
        setSyncVersion('DOCUMENT', conflict.objectId, conflict.serverVersion);
        setPushedSig('DOCUMENT', conflict.objectId, state.documents.find((d) => d.id === conflict.objectId) || conflict.data);
        needsRefresh = true;
      } else if (conflict.objectType === 'SETTINGS') {
        // SETTINGS merge always combines local + server data, so the result
        // differs from what the server has. Delete the sig to trigger re-push.
        mergeSettingsFromServer(conflict.data);
        setSyncVersion('SETTINGS', conflict.objectId, conflict.serverVersion);
        cloudSyncPushedSigs.delete(sigKey('SETTINGS', conflict.objectId));
        needsRefresh = true;
      }
    }
    if (needsRefresh) {
      cloudSyncSuppressPush = true;
      try { save(); } finally { cloudSyncSuppressPush = false; }
      refresh();
      console.log(`[CLOUD-SYNC] Merged ${conflictsToMerge.length} conflicts from server.`);
      // Schedule a re-push to send merged data (with local FSRS state) back to server
      scheduleCloudSyncPush();
    }
  }

  if (pushSuccessCount > 0 || deletedKeys.length > 0) {
    console.log(`[CLOUD-SYNC] Pushed ${pushSuccessCount} objects, deleted ${deletedKeys.length} objects.`);
    scheduleSavePushedSigs();
  }
  return pushSuccessCount + deletedKeys.length;
}

// --- Pull from cloud ---
async function pullFromCloud() {
  if (!marketUnlocked || !marketToken || !navigator.onLine) return 0;
  const lastSync = getLastSyncAt();
  try {
    const url = lastSync
      ? `/v2/sync/full?lastSyncAt=${encodeURIComponent(lastSync)}`
      : '/v2/sync/full';
    const result = await marketApi(url);
    // Always update lastSyncAt to the SERVER's time (not client time) to prevent
    // clock-skew from causing re-downloads of unchanged objects on the next sync.
    setLastSyncAt(result?.syncTime || new Date().toISOString());
    const objects = result?.objects || [];
    if (objects.length === 0) return 0;

    let changed = false;
    let needsRepush = false; // track objects that need to be pushed back after merge
    for (const obj of objects) {
      const localVersion = getSyncVersion(obj.objectType, obj.objectId);
      // Skip if we already have this version or newer
      if (localVersion >= obj.objectVersion) continue;

      if (obj.objectType === 'CARD' && obj.data) {
        const idx = state.cards.findIndex((c) => c.id === obj.objectId);
        const localCard = idx >= 0 ? state.cards[idx] : null;
        const localReviews = Number(localCard?.reviews || 0);
        const serverReviews = Number(obj.data?.reviews || 0);
        if (idx >= 0) {
          state.cards[idx] = mergeCardFromServer(localCard, obj.data);
        } else {
          state.cards.push(normCard(obj.data));
        }
        setSyncVersion('CARD', obj.objectId, obj.objectVersion);
        // If we preserved local FSRS state, the merged card differs from server.
        // Delete sig so the merged result gets pushed back to the server.
        if (localCard && localReviews >= serverReviews) {
          cloudSyncPushedSigs.delete(sigKey('CARD', obj.objectId));
          needsRepush = true;
        } else {
          setPushedSig('CARD', obj.objectId, state.cards.find((c) => c.id === obj.objectId) || obj.data);
        }
        changed = true;
      } else if (obj.objectType === 'DOCUMENT' && obj.data) {
        const idx = state.documents.findIndex((d) => d.id === obj.objectId);
        if (idx >= 0) {
          state.documents[idx] = mergeDocumentFromServer(state.documents[idx], obj.data);
        } else {
          state.documents.push(normDoc(obj.data));
        }
        setSyncVersion('DOCUMENT', obj.objectId, obj.objectVersion);
        setPushedSig('DOCUMENT', obj.objectId, state.documents.find((d) => d.id === obj.objectId) || obj.data);
        changed = true;
      } else if (obj.objectType === 'SETTINGS' && obj.data) {
        // SETTINGS merge combines local + server data — result may differ from server.
        // Only mark for re-push if the merge actually changed local data.
        const beforeJson = JSON.stringify({ groups: state.groups, folders: state.folders, reviewEvents: state.reviewEvents, favorites: state.favorites, profile: state.profile, reviewPlan: state.reviewPlan });
        mergeSettingsFromServer(obj.data);
        const afterJson = JSON.stringify({ groups: state.groups, folders: state.folders, reviewEvents: state.reviewEvents, favorites: state.favorites, profile: state.profile, reviewPlan: state.reviewPlan });
        setSyncVersion('SETTINGS', obj.objectId, obj.objectVersion);
        if (beforeJson !== afterJson) {
          cloudSyncPushedSigs.delete(sigKey('SETTINGS', obj.objectId));
          needsRepush = true;
        }
        changed = true;
      }
    }

    if (changed) {
      cloudSyncSuppressPush = true;
      try { save(); } finally { cloudSyncSuppressPush = false; }
      refresh();
      scheduleSavePushedSigs();
      // If merge produced data that differs from server (e.g., local FSRS state
      // was preserved, or SETTINGS were combined), push it back immediately.
      if (needsRepush) {
        try { await pushToCloud(); } catch (e) { console.warn('[CLOUD-SYNC] Post-pull re-push failed:', e.message); }
      }
    }
    return objects.length;
  } catch (err) {
    console.warn('[CLOUD-SYNC] Pull failed:', err.message);
    return -1;
  }
}

// --- Full sync: pull then push ---
async function fullCloudSync() {
  if (!marketUnlocked || !marketToken || !navigator.onLine) return;
  if (cloudSyncBusy) {
    console.log('[CLOUD-SYNC] Already in progress, skipping.');
    return;
  }
  cloudSyncBusy = true;
  try {
    // Phase 1: Pull server changes
    const pulledCount = await pullFromCloud();
    // After pull, if this was a new user switch and cloud had no data, seed sample data.
    // Only seed when pull succeeded (returned 0 = confirmed no cloud data).
    // If pull errored (returned -1), skip seeding — user might have cloud data we couldn't fetch.
    if (pendingNewUserSeeding) {
      pendingNewUserSeeding = false;
      if (pulledCount === 0) {
        seedSampleDataForNewUser();
      }
    }
    // Phase 2: Push local changes (incremental — only changed objects)
    const pushedCount = await pushToCloud();
    // Phase 3: Register/update device sync time (skip when nothing changed to save a round-trip)
    if (pulledCount > 0 || pushedCount > 0 || !state.syncMeta?.serverDeviceId) {
    try {
      let serverDeviceId = state.syncMeta?.serverDeviceId || '';
      if (!serverDeviceId) {
        const device = await marketApi('/v2/me/devices', {
          method: 'POST',
          body: JSON.stringify({
            deviceType: 'electron-desktop',
            deviceName: navigator.userAgent?.includes('Mac') ? 'macOS Desktop' : navigator.userAgent?.includes('Win') ? 'Windows Desktop' : 'Linux Desktop',
            deviceModel: navigator.platform || 'unknown',
            osVersion: navigator.userAgent || '',
            appVersion: '1.0.0',
          }),
        });
        if (device?.id) {
          serverDeviceId = device.id;
          if (!state.syncMeta) state.syncMeta = {};
          state.syncMeta.serverDeviceId = serverDeviceId;
        }
      }
      if (serverDeviceId) {
        await marketApi(`/v2/sync/device/${encodeURIComponent(serverDeviceId)}`, { method: 'POST' });
      }
    } catch (e) {
      // Non-fatal — device sync time tracking is optional
    }
    }
    // lastSyncAt was already set to the server's syncTime by pullFromCloud().
    // Do NOT overwrite with client time — that causes clock-skew re-download bugs.
    cloudSyncSuppressPush = true;
    try { save(); } finally { cloudSyncSuppressPush = false; }
  } catch (err) {
    console.warn('[CLOUD-SYNC] Full sync failed:', err.message);
  } finally {
    cloudSyncBusy = false;
  }
}

// --- Debounced push trigger (called from save()) ---
function scheduleCloudSyncPush() {
  if (!marketUnlocked || !marketToken || !navigator.onLine) return;
  if (cloudSyncSuppressPush) return;
  clearTimeout(cloudSyncPushTimer);
  cloudSyncPushTimer = setTimeout(() => {
    pushToCloud().catch((err) => {
      console.warn('[CLOUD-SYNC] Debounced push failed:', err.message);
    });
  }, CLOUD_SYNC_PUSH_DEBOUNCE);
}

// --- Periodic background sync ---
// Pulls changes from other devices every 5 minutes, even when the user is idle.
let cloudSyncIntervalTimer = null;
const CLOUD_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

function startCloudSyncTimer() {
  if (cloudSyncIntervalTimer) return;
  cloudSyncIntervalTimer = setInterval(() => {
    if (!marketUnlocked || !marketToken || !navigator.onLine) return;
    if (cloudSyncBusy) return;
    fullCloudSync().catch((err) => {
      console.warn('[CLOUD-SYNC] Periodic sync failed:', err.message);
    });
  }, CLOUD_SYNC_INTERVAL);
}

function stopCloudSyncTimer() {
  if (cloudSyncIntervalTimer) {
    clearInterval(cloudSyncIntervalTimer);
    cloudSyncIntervalTimer = null;
  }
}

// Start the periodic background sync timer
startCloudSyncTimer();

// --- Network recovery sync ---
// When the network comes back online after being offline, trigger a full sync
// to push any changes made while offline and pull server updates.
window.addEventListener('online', () => {
  if (!marketUnlocked || !marketToken) return;
  console.log('[CLOUD-SYNC] Network recovered — triggering full sync.');
  fullCloudSync().catch((err) => {
    console.warn('[CLOUD-SYNC] Post-recovery sync failed:', err.message);
  });
});
