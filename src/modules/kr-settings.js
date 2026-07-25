/**
 * kr-settings.js - Settings panels, FSRS config, update panel, data recovery
 * Dependencies: kr-core.js, kr-state.js
 * Provides: cache, init, ensureFSRSSettingsPanel, ensureStampSetting,
 *           ensureStoragePanel, ensureUpdatePanel, renderUpdateState,
 *           handleUpdateEvent, bindUpdateEvents, view, refresh, setting, 
 *           restoreLatexForStorage, formatBytes
 */
function cache() {
  ['noteEditor', 'outlineList', 'heatmap', 'heatmapPrev', 'heatmapNext', 'heatmapMonthLabel', 'cardGroupSelect', 'cardTypeSelect', 'answerChoices', 'todayCount', 'questionCard', 'reviewProgressText', 'remainingText', 'progressRing', 'nextButton', 'cardModal', 'cardForm', 'createModal', 'createForm', 'exportModal', 'cardList', 'folderFilter', 'tagFilter', 'cardTypeFilter', 'cardStatusFilter', 'cardSearchInput', 'cardSummary', 'cardGroupRail', 'bulkSelectionBar', 'selectedCardCount', 'bulkDeleteCardsButton', 'pushSelectedButton', 'dedupCardsButton', 'cardLoadMore', 'cardPageWheel', 'cardWheelRail', 'cardWheelLabel', 'cardSortSelect', 'marketGrid', 'marketSearchInput', 'marketSortSelect', 'marketAuthForm', 'marketDetailModal', 'marketDetailBody', 'marketDownloadButton', 'marketUploadModal', 'marketUploadForm', 'marketUploadDeckId', 'marketUploadGroup', 'marketUploadName', 'marketUploadDescription', 'marketUploadChangelog', 'profileDeckList', 'profileDeckPagination', 'profileAvatarButton', 'profileAvatarImage', 'profileAvatarFallback', 'profileAvatarInput', 'profileEditModal', 'profileEditForm', 'profileDisplayName', 'profileProfileHint', 'profileDeckCount', 'profileCardCount', 'profilePublishedCount', 'toast', 'desiredRetention', 'desiredRetentionValue', 'dailyLimit', 'dailyNewLimit', 'intervalPreview', 'showStampsToggle', 'reviewGroupSelect', 'reviewOrderButton', 'reviewOrderMenu', 'reviewHistory', 'reviewHistoryMeta', 'reviewHistoryButton', 'reviewHistoryCount', 'reviewHistoryPopover', 'reviewPlanList', 'reviewPlanMeta', 'reviewHome', 'reviewStudy', 'reviewStudyBack', 'reviewStudyGroupLabel', 'updateStatus', 'updateProgress', 'updateProgressBar', 'updateProgressMeta', 'updateCheckButton', 'updateInstallButton', 'appVersion', 'dataPath'].forEach((key) => { if (!els[key]) els[key] = document.getElementById(key); });
  if (!els.reviewPriority) els.reviewPriority = document.querySelector('input[name="reviewPriority"]:checked');
  if (!els.reviewPriorityDescription) els.reviewPriorityDescription = document.getElementById('reviewPriorityDescription');
}
/* ensureAccountSecurityPanel removed - password change moved to market account menu */

/* appearance panel and tag manager removed */

function ensureFSRSSettingsPanel() {
  const panel = $('#algorithmPanel');
  if (!panel) return;
  panel.innerHTML = '<h2>FSRS 复习算法</h2><p class="setting-description">根据目标记忆保持率自动安排复习间隔。评分越准确，计划越贴合你的实际记忆状态。</p><label>目标记忆保持率 <input type="range" id="desiredRetention" min="0.8" max="0.99" step="0.01" /><span id="desiredRetentionValue"></span></label><label>每日复习上限 <input type="number" id="dailyLimit" min="1" max="500" /></label><label>每日新卡上限 <input type="number" id="dailyNewLimit" min="0" max="100" /></label><div class="interval-preview-label">不同评分的首次安排</div><div id="intervalPreview" class="interval-preview"></div><div class="review-priority-settings"><div class="comic-radio-group" role="radiogroup" aria-label="复习优先模式"><input type="radio" id="priority-new" name="reviewPriority" value="new" /><label for="priority-new">新词</label><input type="radio" id="priority-review" name="reviewPriority" value="review" /><label for="priority-review">复习</label><input type="radio" id="priority-mixed" name="reviewPriority" value="mixed" checked /><label for="priority-mixed">混合</label><div class="comic-glider" aria-hidden="true"></div></div><p class="review-priority-description" id="reviewPriorityDescription"></p></div>';
}
async function init() {

  // The market login is the application session gate. Keep every local view
  // locked until authentication succeeds, including when local data loads.
  try { setAppAuthLock(true); } catch (e) {}

  // === Phase 1: Migrate old data & load from Dexie (primary backend) ===
  // Start disk load in parallel with Dexie migration to minimize startup latency.
  const _diskPromise = (async () => { try { return await window.reviewBridge?.data?.load(); } catch (e) { console.warn('[INIT] Persistent load failed:', e.message); return null; } })();

  try {
    const migrated = await migrateToDexie();
    if (migrated) console.log('[INIT] Data migrated to Dexie structured stores.');
  } catch (e) {
    console.warn('[INIT] Migration failed:', e.message);
  }

  // Load from Dexie structured stores (falls back to legacy IDB blob internally)
  let dexieResult = null;
  try {
    dexieResult = await loadFromDexieWithFallback();
  } catch (e) {
    console.warn('[INIT] Dexie load failed:', e.message);
  }

  // Disk load was started in parallel — await its result now
  let persistent = await _diskPromise;

  const browserState = localStorage.getItem(KEY) || localStorage.getItem('knowledge-review-state-v1');

  // === Phase 2: Build candidates and select best ===
  const browserCandidate = (() => {
    if (!browserState) return null;
    try {
      const parsed = JSON.parse(browserState);
      return { data: parsed, savedAt: localStorage.getItem(STATE_META_KEY) || '', source: 'localStorage' };
    } catch { return null; }
  })();

  const persistentCandidate = persistent?.ok && persistent.data
    ? { data: persistent.data, savedAt: persistent.savedAt || '', source: 'electron' }
    : null;

  // Dexie result is either structured data { data, savedAt } or legacy { _legacy, _raw, _savedAt }
  const dexieCandidate = dexieResult
    ? dexieResult._legacy
      ? (() => { try { return { data: JSON.parse(dexieResult._raw), savedAt: dexieResult._savedAt || '', source: 'dexie-legacy' }; } catch { return null; } })()
      : { data: dexieResult.data, savedAt: dexieResult.savedAt || '', source: 'dexie' }
    : null;

  const cardCount = (c) => Array.isArray(c?.data?.cards) ? c.data.cards.length : 0;
  const hasData = (c) => Boolean(c && (cardCount(c) || c.data?.documents?.length || c.data?.groups?.length));

  const candidates = [dexieCandidate, persistentCandidate, browserCandidate].filter(hasData);

  // BUG-02 fix: Select by most recent savedAt instead of card count to prevent
  // deleted cards from "resurrecting" when an older snapshot has more cards.
  const selected = candidates.length > 1
    ? candidates.reduce((best, c) => (c.savedAt || '') > (best.savedAt || '') ? c : best)
    : candidates[0] || null;

  // BUG-02 fix: When candidates differ significantly in card count, create a
  // safety backup so the user can recover data if the merge is undesirable.
  if (selected && candidates.length > 1) {
    try {
      const maxCards = Math.max(...candidates.map(cardCount));
      const selCards = cardCount(selected);
      if (maxCards > selCards && maxCards - selCards > Math.max(5, selCards * 0.2)) {
        console.warn('[INIT] Card count mismatch detected (selected:', selCards, 'max:', maxCards, '). Creating safety backup.');
        if (window.reviewBridge?.data?.save) {
          const richest = candidates.reduce((a, b) => cardCount(a) > cardCount(b) ? a : b);
          const backupPayload = { format: 'knowledge-review-local-state', version: 1, savedAt: new Date().toISOString(), data: richest.data };
          window.reviewBridge.data.save(backupPayload).catch(function() {});
        }
      }
    } catch (e) { console.warn('[INIT] Safety backup failed:', e.message); }
  }


  // === Phase 3: Apply selected data to state ===
  if (selected) {
    try {
      state = hydrate(selected.data);  // hydrate accepts object or string
    } catch (e) {
      console.error('[INIT] Hydrate failed:', e.message);
      state = hydrate('');
    }
    try {
      const _serialized = JSON.stringify(state);
      if (_serialized.length > 4000000) { console.warn("[INIT] State too large for localStorage (" + _serialized.length + " chars), skipping"); }
      else { localStorage.setItem(KEY, _serialized); }
      localStorage.setItem(STATE_META_KEY, selected.savedAt || new Date().toISOString());
    } catch (e) {
      console.warn('[INIT] localStorage write failed (may be full):', e.message);
    }
    try { schedulePersistentSave(true); } catch (e) {}
    try { scheduleDexieSave(); } catch (e) {}
    idbReady = true;
  } else {
    state = hydrate('');
    try { save(); } catch (e) {}
  }

  // Rebuild in-memory card index for O(1) lookups
  try { rebuildCardIndex(); } catch (e) { console.warn('[INIT] rebuildCardIndex failed:', e.message); }


  // === Phase 4: UI initialization (each step wrapped in try/catch) ===
  const safeCall = (name, fn) => {
    try { fn(); } catch (e) { console.error('[INIT] ' + name + ' failed:', e.message); }
  };

  try { marketApiBase = normalizeMarketApiBase(state.settings?.marketServerKey || state.settings?.marketServerUrl); } catch (e) {}

  safeCall('removeEditButton', () => document.querySelector('.profile-hero > #editProfileButton')?.remove());
  safeCall('cache1', () => cache());
    safeCall('cache2', () => cache());
  safeCall('ensureFSRSSettingsPanel', ensureFSRSSettingsPanel);
  safeCall('cache3', () => cache());
  safeCall('ensureStoragePanel', ensureStoragePanel);
  safeCall('ensureServerSettingsPanel', ensureServerSettingsPanel);
  safeCall('cache4', () => cache());
  safeCall('ensureUpdatePanel', ensureUpdatePanel);
  safeCall('cache5', () => cache());
  safeCall('ensureStampSetting', ensureStampSetting);
  safeCall('ensureLocalModeSetting', ensureLocalModeSetting);
  safeCall('ensureCardEditorFields', ensureCardEditorFields);
  safeCall('enhanceSelectsPortal', enhanceSelectsPortal);
  document.body.classList.add('selects-ready');
  safeCall('ensureToolbarPalettes', ensureToolbarPalettes);
  safeCall('bind', bind);
  // Auto-login right after bind() — form submit handler is now attached.
  // form.requestSubmit() fires synchronously, so the HTTP login request
  // starts immediately and overlaps with the remaining Phase 4 work below.
  loadWebDavConfig().catch(() => {}); // non-blocking — don't delay auto-login
  try { ensureMarketRegistrationField(); } catch (e) {}
  try { await loadSavedMarketCredentials(); } catch (e) {}

  safeCall('enableTooltips', enableTooltips);
  safeCall('bindUpdateEvents', bindUpdateEvents);
  safeCall('startAutoPushTimers', startAutoPushTimers);

  cardSortDirection = ['asc', 'desc', 'reviews-asc', 'reviews-desc'].includes(state.settings?.cardSortDirection) ? state.settings.cardSortDirection : 'asc';

  safeCall('loadDoc', loadDoc);
  safeCall('syncSettings', syncSettings);
  safeCall('refresh', refresh);
  safeCall('view', () => view('market'));

  // Phase 5: Cloud sync — pull server data then push local state.
  // Only runs if already authenticated (auto-login). Non-blocking.
  try {
    if (marketUnlocked && marketToken) {
      fullCloudSync().catch((e) => console.warn('[INIT] Cloud sync failed:', e.message));
    }
  } catch (e) { console.warn('[INIT] Cloud sync trigger failed:', e.message); }

}
function ensureStampSetting() {
  const toggle = $('#showStampsToggle');
  if (!toggle) return;
  els.showStampsToggle = toggle;
  toggle.checked = state.settings.showStamps !== false;
  if (toggle.dataset.bound === 'true') return;
  toggle.dataset.bound = 'true';
  toggle.addEventListener('change', () => {
    state.settings.showStamps = toggle.checked;
    save();
    refresh();
  });
}
function ensureLocalModeSetting() {
  const toggle = $('#localModeToggle');
  if (!toggle) return;
  els.localModeToggle = toggle;
  toggle.checked = state.settings.localMode === true;
  if (toggle.dataset.bound === 'true') return;
  toggle.dataset.bound = 'true';
  toggle.addEventListener('change', () => {
    state.settings.localMode = toggle.checked;
    save();
    document.body.classList.toggle('local-mode', state.settings.localMode);
    toast(state.settings.localMode ? '已切换到本地模式，修改不会自动推送。' : '已切换到推送模式，修改将自动推送到市场牌组。');
    if (!state.settings.localMode) retryFailedPushes();
  });
  document.body.classList.toggle('local-mode', state.settings.localMode);
}function ensureBatchModeButton() { const header = els.cardModal?.querySelector('.modal-header'); const form = els.cardForm; if (!header || !form) return; if (!$('#batchModeButton')) { const button = document.createElement('button'); button.type = 'button'; button.id = 'batchModeButton'; button.className = 'modal-mode-toggle'; button.textContent = '批量制卡'; header.insertBefore(button, header.querySelector('.dialog-close')); button.addEventListener('click', toggleBatchCardMode); } if (!form.querySelector('.card-editor-scroll')) { const menu = form.querySelector(':scope > menu'); if (!menu) return; const body = document.createElement('div'); body.className = 'card-editor-scroll'; let node = header.nextElementSibling; while (node && node !== menu) { const next = node.nextElementSibling; body.appendChild(node); node = next; } form.insertBefore(body, menu); } }
/**
 * Defensive safe-call helper: runs fn() and logs errors without throwing.
 * Prevents cascade failures where one broken render call kills the entire UI.
 */
function safeRender(label, fn) {
  try { fn(); } catch (err) { console.error('[RENDER] ' + label + ' failed:', err); }
}


 function view(name) {
  try {
    const requested = name;
    const canOpenAdmin = marketUnlocked && marketUser?.role === 'ADMIN';
    if (appAuthLocked && requested !== 'market') {
      marketSurface = 'decks';
      name = 'market';
    } else if (requested === 'admin' && canOpenAdmin) {
      mountAdminWorkspace();
      marketSurface = 'admin';
      name = 'admin';
    } else if (requested === 'admin') {
      marketSurface = 'decks';
      name = 'market';
    } else if (requested === 'market') {
      marketSurface = 'decks';
    }
    const target = name;
    $$('.view').forEach((item) => item.classList.toggle('active', item.id === `${name}View`));
    $$('.rail-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === target));
    if (name === 'library') safeRender('openKnowledgeHome', openKnowledgeHome);
    if (name === 'cards') {
      safeRender('renderCards', renderCards);
      if (marketUnlocked && marketToken && !view._cardsSynced) {
        view._cardsSynced = true;
        marketUpdateCache.clear();
        syncSubscribedDecks().catch(() => {}).finally(() => { view._cardsSynced = false; });
      }
    }
    if (name === 'market') safeRender('renderMarket', renderMarket);
    if (name === 'collab') safeRender('renderCollab', renderCollab);
    if (name === 'profile') {
      safeRender('renderProfile', renderProfile);
      if (marketUnlocked && marketToken && !view._profileSynced) {
        view._profileSynced = true;
        syncMyMarketDeckMetadata().then(() => renderProfile()).catch(() => {}).finally(() => { view._profileSynced = false; });
      }
    }
    if (name === 'review') {
      safeRender('exitReviewStudy', exitReviewStudy);
      safeRender('renderReviewPlanControls', renderReviewPlanControls);
      safeRender('renderReviewHome', renderReviewHome);
      safeRender('renderReviewHistory', renderReviewHistory);
    }
    if (name === 'admin') safeRender('renderAdminWorkspace', renderAdminWorkspace);
  } catch (err) {
    console.error('[VIEW] view() failed for "' + name + '":', err);
  }
}
// Refresh only specific UI parts. Pass an object with truthy keys to render
// a subset of views, e.g. refresh({ cards: true, dock: true }).
// Called without arguments, renders everything (backward compatible).
//
// Available keys:
//   tree, home, outline, heatmaps, reviewPlanControls, dock,
//   standalone, reviewHome, reviewPlan, reviewHistory,
//   cards, market, profile, badges
const REFRESH_MAP = {
  tree: () => safeRender('renderTree', renderTree),
  home: () => safeRender('renderKnowledgeHome', renderKnowledgeHome),
  outline: () => safeRender('outline', outline),
  heatmaps: () => safeRender('renderHeatmaps', renderHeatmaps),
  reviewPlanControls: () => safeRender('renderReviewPlanControls', renderReviewPlanControls),
  dock: () => safeRender('renderDock', renderDock),
  standalone: () => safeRender('renderStandalone', renderStandalone),
  reviewHome: () => safeRender('renderReviewHome', renderReviewHome),
  reviewPlan: () => safeRender('renderReviewPlan', renderReviewPlan),
  reviewHistory: () => safeRender('renderReviewHistory', renderReviewHistory),
  cards: () => safeRender('renderCards', renderCards),
  market: () => safeRender('renderMarket', renderMarket),
  profile: () => safeRender('renderProfile', renderProfile),
  badges: () => safeRender('badges', badges),
};
function refresh(parts) {
  if (!parts || typeof parts !== 'object') {
    for (const fn of Object.values(REFRESH_MAP)) fn();
    try { clearDirty(); } catch (e) { /* uiDirty may not be loaded yet */ }
    return;
  }
  for (const key of Object.keys(parts)) {
    if (parts[key] && REFRESH_MAP[key]) REFRESH_MAP[key]();
  }
  try { clearDirty(parts); } catch (e) { /* non-fatal */ }
}
// Refresh only views marked dirty by mutation functions.
// Falls back to full refresh if no dirty flags are set (safety net).
function refreshDirty() {
  let any = false;
  const parts = {};
  for (const key of Object.keys(uiDirty)) {
    if (uiDirty[key]) { any = true; parts[key] = true; }
  }
  if (any) refresh(parts);
  else refresh(); // safety: full refresh if nothing flagged dirty
}
function setting(name) { $$('.settings-nav button').forEach((button) => button.classList.toggle('active', button.dataset.setting === name)); $$('.setting-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${name}Panel`)); }
function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}
function renderUpdateState() {
  const status = els.updateStatus;
  const bar = els.updateProgressBar;
  const progress = els.updateProgress;
  const install = els.updateInstallButton;
  const check = els.updateCheckButton;
  if (!status) return;
  const labels = {
    idle: '应用会从 GitHub Releases 获取稳定版本。',
    checking: '正在检查 GitHub Releases…',
    available: `发现新版本 v${updateState.version}，正在后台流式下载…`,
    progress: `正在下载 v${updateState.version}：${updateState.percent.toFixed(0)}%`,
    downloaded: `v${updateState.version} 已下载完成，可以重启安装。`,
    'not-available': '当前已经是最新版本。',
    error: updateState.message || '更新暂时不可用。',
    'data-migrated': '旧版用户数据已安全迁移，原目录未删除。'
  };
  status.textContent = labels[updateState.status] || labels.idle;
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, updateState.percent))}%`;
  if (progress) progress.hidden = !['available', 'progress', 'downloaded'].includes(updateState.status);
  if (install) install.hidden = updateState.status !== 'downloaded';
  if (els.updateProgressMeta) {
    els.updateProgressMeta.textContent = updateState.total
      ? `${formatBytes(updateState.transferred)} / ${formatBytes(updateState.total)}${updateState.bytesPerSecond ? ` · ${formatBytes(updateState.bytesPerSecond)}/秒` : ''}`
      : (updateState.status === 'downloaded' ? '安装包已准备好' : '准备下载…');
  }
  if (check) {
    check.disabled = ['checking', 'available', 'progress'].includes(updateState.status);
    check.querySelector('span:last-child').textContent = updateState.status === 'checking' ? '检查中…' : '检查更新';
  }
  if (install) install.disabled = updateState.installing === true;
}
function handleUpdateEvent(payload = {}) {
  if (payload.event === 'available' || payload.event === 'progress' || payload.event === 'downloaded') {
    updateState = { ...updateState, status: payload.event, version: payload.version || updateState.version, percent: payload.percent ?? updateState.percent, transferred: payload.transferred ?? updateState.transferred, total: payload.total ?? updateState.total, bytesPerSecond: payload.bytesPerSecond ?? updateState.bytesPerSecond };
  } else if (payload.event === 'not-available') updateState = { ...updateState, status: 'not-available' };
  else if (payload.event === 'checking') updateState = { ...updateState, status: 'checking' };
  else if (payload.event === 'error') updateState = { ...updateState, status: 'error', message: payload.message || '' };
  else if (payload.event === 'data-migrated') updateState = { ...updateState, status: 'data-migrated' };
  renderUpdateState();
  if (payload.event === 'downloaded') toast(`新版本 v${payload.version} 已下载完成。`);
}
function bindUpdateEvents() {
  window.reviewBridge?.updates?.onEvent?.(handleUpdateEvent);
  els.updateCheckButton?.addEventListener('click', async () => {
    updateState = { ...updateState, status: 'checking', message: '' };
    renderUpdateState();
    const result = await window.reviewBridge?.updates?.check?.();
    if (!result?.ok && !result?.skipped) handleUpdateEvent({ event: 'error', message: result.error });
    if (result?.skipped) handleUpdateEvent({ event: 'error', message: result.error });
  });
  els.updateInstallButton?.addEventListener('click', async () => {
    updateState = { ...updateState, installing: true };
    renderUpdateState();
    const result = await window.reviewBridge?.updates?.install?.();
    if (!result?.ok) { updateState = { ...updateState, installing: false }; handleUpdateEvent({ event: 'error', message: result.error }); }
  });
  window.reviewBridge?.app?.getInfo?.().then((info) => {
    if (els.appVersion) els.appVersion.textContent = `当前版本 v${info.version}`;
    if (els.dataPath) els.dataPath.textContent = info.dataPath;
    if (!info.isPackaged) renderUpdateState();
  }).catch(() => {});
  renderUpdateState();
}
function restoreLatexForStorage(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html || '';
  wrapper.querySelectorAll('[data-latex-source]').forEach((node) => {
    const source = node.getAttribute('data-latex-source') || '';
    const display = node.getAttribute('data-latex-display') === 'true';
    node.replaceWith(document.createTextNode(display ? `$$${source}$$` : `$${source}$`));
  });
  return wrapper.innerHTML;
}
function renderLatexInHtml(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = sanitizeClipboardHtml(html || '');
  const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (/\\?\$\$[\s\S]*?\\?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\\?\$[^$\n]+?\$/.test(node.nodeValue || '')
      && !node.parentElement?.closest('.katex, [data-latex-source], code, pre, textarea')) nodes.push(node);
  }
  nodes.forEach((node) => {
    const holder = document.createElement('span');
    holder.innerHTML = markdownInline(node.nodeValue || '');
    node.replaceWith(...holder.childNodes);
  });
  return wrapper.innerHTML;
}
