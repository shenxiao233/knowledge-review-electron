/**
 * kr-market.js - Deck market, auth, admin workspace
 * Dependencies: kr-core.js, kr-state.js
 * Provides: marketApi, renderMarket, showMarketWorkspace, handleMarketLogin,
 *           openAdminWorkspace, renderAdminWorkspace, bindAdminWorkspaceEvents,
 *           importMarketCards, resolveMarketConflicts, openMarketUpload,
 *           marketPublish, ensureServerSettingsPanel, toggleFavorite, isDeckFavorited
 */
function marketDeckMatches(deck) {
  const query = marketQuery.toLowerCase();
  return (marketCategory === 'all' || deck.category === marketCategory)
    && (!query || [deck.title, deck.author, deck.category, ...deck.tags].join(' ').toLowerCase().includes(query));
}

function isDeckFavorited(deckId) { return (state.favorites || []).includes(deckId); }
async function toggleFavorite(deckId, event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const favorites = state.favorites || [];
  const isFav = favorites.includes(deckId);
  if (marketToken) {
    try {
      if (isFav) {
        await marketApi('/favorites/' + deckId, { method: 'DELETE' });
      } else {
        await marketApi('/favorites/' + deckId, { method: 'POST' });
      }
    } catch (err) {
      toast('收藏操作失败：' + (err.message || '网络错误'));
      return;
    }
  }
  if (isFav) {
    state.favorites = favorites.filter(id => id !== deckId);
  } else {
    state.favorites = [...favorites, deckId];
  }
  save();
  renderMarket();
  toast(isFav ? '已取消收藏' : '已添加到收藏');
}

function marketDecksForDisplay() {
  const decks = marketDecks.filter(marketDeckMatches);
  return decks.sort((a, b) => marketSort === 'popular' ? b.downloads - a.downloads : marketSort === 'cards' ? b.cards - a.cards : b.updated.localeCompare(a.updated));
}
async function marketApi(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (marketToken) headers.set('Authorization', `Bearer ${marketToken}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${marketApiBase}${path}`, { cache: 'no-store', ...options, headers, signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.blob();
    if (!response.ok) throw new Error(body?.error || `市场接口请求失败（${response.status}）`);
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('市场服务响应超时，请检查后端服务是否已重启。');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
function normalizeMarketDeck(deck) {
  const manifest = deck.manifest || {};
  return {
    id: deck.id,
    title: deck.title || manifest.title || '未命名牌组',
    author: deck.author || '未知作者',
    category: deck.category || manifest.category || '未分类',
    cards: Number(manifest.cardCount || 0),
    downloads: Number(deck.downloads || 0),
    updated: deck.updatedAt ? formatMarketDate(deck.updatedAt) : '刚刚更新',
    color: '#e7f3ed',
    accent: '#2f7d64',
    tags: Array.isArray(manifest.tags) ? manifest.tags : [],
    description: deck.description || manifest.description || '',
    version: Number(deck.version || manifest.version || 1)
  };
}
function formatMarketDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
async function loadMarketDecks() {
  const params = new URLSearchParams({ page: String(marketPage), pageSize: String(marketPageSize), sort: marketSort });
  if (marketQuery) params.set('q', marketQuery);
  if (marketCategory !== 'all') params.set('category', marketCategory);
  const result = await marketApi(`/decks?${params.toString()}`);
  const decks = Array.isArray(result) ? result : result.items;
  marketTotal = Array.isArray(result) ? decks.length : Number(result.total || 0);
  marketTotalPages = Array.isArray(result) ? 1 : Math.max(1, Number(result.totalPages || 1));
  marketDecks = Array.isArray(decks) ? decks.map(normalizeMarketDeck) : [];
  marketUpdateCache.clear();
}
async function loadMarketCategories() {
  try {
    const result = await marketApi('/categories');
    marketCategories = Array.isArray(result) ? result : [];
    const select = $('#marketCategoryFilter');
    if (select) {
      const current = marketCategory;
      select.innerHTML = `<option value="all">全部分类</option>${marketCategories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('')}`;
      select.value = marketCategories.includes(current) ? current : 'all';
      marketCategory = select.value;
    }
    const uploadSelect = $('#marketUploadCategorySelect');
    if (uploadSelect) {
      const current = uploadSelect.value;
      uploadSelect.innerHTML = `<option value="">请选择分类</option>${marketCategories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('')}<option value="__new__">＋ 新建分类</option>`;
      uploadSelect.value = marketCategories.includes(current) || current === '__new__' ? current : '';
    }
  } catch {
    marketCategories = [];
  }
}
async function loadMarketCapabilities() {
  try {
    const health = await fetch(`${marketApiBase.replace(/\/api\/v1$/, '')}/health`, { cache: 'no-store' }).then((response) => response.json());
    marketCapabilities = health.capabilities || {};
    return health;
  } catch {
    marketCapabilities = {};
    return null;
  }
}
async function syncMyMarketDeckMetadata() {
  if (!marketToken) return;
  const result = await marketApi('/my-decks');
  const remoteDecks = Array.isArray(result) ? result : result.items || [];
  const profile = profileData();
  const localDecks = Array.isArray(profile.myDecks) ? profile.myDecks : [];
  const merged = [...localDecks];
  remoteDecks.forEach((remote) => {
    const latest = remote.versions?.[0];
    const sameTitle = merged.filter((item) => item.group === remote.title || item.name === remote.title);
    const index = merged.findIndex((item) => item.remoteId === remote.id) >= 0
      ? merged.findIndex((item) => item.remoteId === remote.id)
      : sameTitle.length === 1
        ? merged.indexOf(sameTitle[0])
        : -1;
    const value = { ...(index >= 0 ? merged[index] : {}), group: index >= 0 ? (merged[index].group || remote.title) : remote.title, name: remote.title, remoteId: remote.id, version: Number(remote.currentVersion || latest?.version || 0), category: remote.category, description: remote.description, status: remote.status, updatedAt: remote.updatedAt };
    if (index >= 0) merged[index] = value;
    else merged.push(value);
  });
  profile.myDecks = merged;
  save();
}
function ensureMarketPagination() {
  const surface = $('#marketDecksSurface');
  if (!surface) return null;
  let pager = $('#marketPagination');
  if (!pager) {
    pager = document.createElement('div');
    pager.id = 'marketPagination';
    pager.className = 'market-pagination';
    surface.appendChild(pager);
    pager.addEventListener('click', (event) => {
      const button = event.target.closest('[data-market-page]');
      if (!button || button.disabled) return;
      marketPage = Number(button.dataset.marketPage);
      refreshMarketPage();
    });
  }
  return pager;
}
async function checkMarketDeckUpdate(deckId, currentVersion = 0) {
  const cacheKey = `${deckId}:${currentVersion}`;
  if (marketUpdateCache.has(cacheKey)) return marketUpdateCache.get(cacheKey);
  const result = await marketApi(`/decks/${encodeURIComponent(deckId)}/update?version=${encodeURIComponent(currentVersion)}`);
  marketUpdateCache.set(cacheKey, result);
  return result;
}
async function returnToMarketLogin() {
  marketSurface = 'decks';
  marketUnlocked = false;
  marketToken = '';
  marketUser = null;
  marketCapabilities = {};
  marketDecks = [];
  $('#marketAuthForm')?.classList.remove('is-authenticated');
  const status = $('#marketAuthStatus');
  if (status) status.textContent = '服务器频道等待认证';
  $('#marketLoginError')?.classList.remove('is-visible');
  view('market');
  renderMarket();
  // Restore saved credentials without submitting the form again.
  await loadSavedMarketCredentials({ autoLogin: false });
}

async function loadSavedMarketCredentials({ autoLogin = true } = {}) {
  let saved = null;
  try { saved = await window.reviewBridge?.market?.getCredentials?.(); } catch { saved = null; }
  if (!saved?.remember) return;
  marketRememberCredentials = true;
  const key = $('#marketServerKey');
  const username = $('#marketUsername');
  const password = $('#marketPassword');
  const remember = $('#marketRememberCredentials');
  if (key) key.value = saved.accessKey || '';
  if (username) username.value = saved.username || '';
  if (password) password.value = saved.password || '';
  if (remember) remember.checked = true;
  if (autoLogin && !marketAutoLoginTried && saved.accessKey && saved.username && saved.password) {
    marketAutoLoginTried = true;
    setTimeout(() => {
      const form = $('#marketAuthForm');
      if (!form) return;
      form.dataset.autoLogin = 'true';
      form.requestSubmit();
    }, 120);
  }
}

async function saveMarketLoginCredentials(accessKey, username, password) {
  const remember = $('#marketRememberCredentials')?.checked === true;
  marketRememberCredentials = remember;
  if (remember) await window.reviewBridge?.market?.saveCredentials?.({ accessKey, username, password });
  else await window.reviewBridge?.market?.clearCredentials?.();
}

function showMarketWorkspace() {
  marketSurface = 'decks';
  view('market');
  renderMarket();
}
function openAdminWorkspace() {
  if (!marketUnlocked || marketUser?.role !== 'ADMIN') return;
  marketSurface = 'admin';
  view('admin');
}
async function showMarketDecks() {
  marketSurface = 'decks';
  if (marketUnlocked) {
    try {
      await loadMarketCategories();
      await loadMarketDecks();
    } catch (error) {
      toast(error instanceof Error ? error.message : '公开牌组刷新失败。');
    }
  }
  view('market');
}
async function refreshMarketPage({ resetPage = false } = {}) {
  if (resetPage) marketPage = 1;
  try { await loadMarketCategories(); await loadMarketDecks(); } catch (error) { toast(error instanceof Error ? error.message : '公开牌组刷新失败。'); }
  renderMarket();
}
function marketProfileSummary() {
  const profile = profileData();
  return { name: profile.name || marketUser?.username || 'Knowledge Learner', avatar: profile.avatar || '' };
}
function logoutMarket() {
  returnToMarketLogin();
}
function renderMarketAccountMenu() {
  const host = marketSurface === 'admin' ? $('#marketAdminAccountSlot') : $('#marketAccountSlot');
  if (!host || !marketUnlocked || !marketUser) return;
  const profile = marketProfileSummary();
  host.innerHTML = `<div class="market-account"><button type="button" class="market-account-trigger" id="marketAccountButton" aria-expanded="false"><span class="market-account-avatar">${profile.avatar ? `<img src="${esc(profile.avatar)}" alt="" />` : esc(profile.name.slice(0, 1).toUpperCase())}</span><span class="market-account-name">${esc(profile.name)}</span><svg><use href="#i-chevron-down"></use></svg></button><div class="market-account-menu" id="marketAccountMenu" hidden><div class="market-account-menu-head"><span class="market-account-avatar large">${profile.avatar ? `<img src="${esc(profile.avatar)}" alt="" />` : esc(profile.name.slice(0, 1).toUpperCase())}</span><div><strong>${esc(profile.name)}</strong><small>${esc(marketUser.role === 'ADMIN' ? '管理员账户' : '许可账户')}</small></div></div><button type="button" data-market-account-action="profile">编辑资料</button>${marketUser.role === 'ADMIN' ? '<button type="button" data-market-account-action="admin">管理后台</button>' : ''}<button type="button" class="danger" data-market-account-action="logout">退出登录</button></div></div>`;
  $('#marketAccountButton')?.addEventListener('click', (event) => { event.stopPropagation(); const menu = $('#marketAccountMenu'); if (menu) menu.hidden = !menu.hidden; $('#marketAccountButton').setAttribute('aria-expanded', String(!menu.hidden)); });
  $$('#marketAccountMenu [data-market-account-action]').forEach((button) => button.addEventListener('click', () => { const action = button.dataset.marketAccountAction; if (action === 'profile') openProfileEditor(); if (action === 'admin') openAdminWorkspace(); if (action === 'logout') logoutMarket(); }));
}
function marketDeckHasUpdate(deck) {
  const localVersion = Number(state.market?.decks?.[deck.id]?.version || 0);
  return localVersion > 0 && Number(deck.version || 0) > localVersion;
}
function marketDeckNewBadge(deck) { return marketDeckHasUpdate(deck) ? '<span class="market-new-badge"><b>NEW</b><small>可更新</small></span>' : ''; }
function renderMarket() {
  const marketView = $('#marketView');
  marketView?.classList.toggle('is-admin-surface', marketSurface === 'admin');
  $('#marketDecksSurface')?.toggleAttribute('hidden', marketSurface !== 'decks');
  $('#marketAdminSurface')?.toggleAttribute('hidden', marketSurface !== 'admin');
  if (marketSurface === 'admin') {
    renderAdminWorkspace();
    renderMarketAccountMenu();
    return;
  }
  const grid = $('#marketGrid');
  $('#marketView')?.classList.toggle('is-locked', !marketUnlocked);
  $('#marketLoginScreen')?.toggleAttribute('hidden', marketUnlocked);
  $('#marketUnlockedContent')?.toggleAttribute('hidden', !marketUnlocked);
  if (!grid) return;
  const decks = marketDecksForDisplay();
  grid.innerHTML = decks.length ? decks.map((deck) => `<article class="market-deck-card${marketDeckHasUpdate(deck) ? ' has-update' : ''}" data-market-deck="${esc(deck.id)}"><div class="market-deck-cover" style="--deck-color:${deck.color};--deck-accent:${deck.accent}">${marketDeckNewBadge(deck)}<span>${esc(deck.category)}</span><strong>${esc(deck.title)}</strong><small>${esc(deck.tags.join(' · '))}</small><i aria-hidden="true"></i></div><div class="market-deck-body"><div class="market-deck-heading"><div><h3>${esc(deck.title)}</h3><span>作者 ${esc(deck.author)}</span></div><button type="button" class="market-fav-button${isDeckFavorited(deck.id) ? ' is-fav' : ''}" data-market-fav="${esc(deck.id)}" aria-label="收藏牌组"><svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></button><button type="button" class="market-more-button" data-market-detail="${esc(deck.id)}" aria-label="查看牌组详情"><svg><use href="#i-chevron-right"></use></svg></button></div><p>${esc(deck.description)}</p><div class="market-deck-meta"><span><strong>${deck.cards}</strong> 张卡片</span><span><strong>${deck.downloads}</strong> 次下载</span><span>${esc(deck.updated)}</span></div><button type="button" class="market-view-deck" data-market-detail="${esc(deck.id)}">${marketDeckHasUpdate(deck) ? '更新牌组' : '查看牌组'}</button></div></article>`).join('') : '<div class="market-empty"><strong>没有找到匹配牌组</strong><span>尝试更换关键词或筛选条件。</span></div>';
  const pager = ensureMarketPagination();
  if (pager) {
    pager.hidden = marketTotalPages <= 1;
    pager.innerHTML = marketTotalPages <= 1 ? '' : `<span>第 ${marketPage} / ${marketTotalPages} 页 · 共 ${marketTotal} 个牌组</span><div><button type="button" data-market-page="${marketPage - 1}" ${marketPage <= 1 ? 'disabled' : ''}>上一页</button><button type="button" data-market-page="${marketPage + 1}" ${marketPage >= marketTotalPages ? 'disabled' : ''}>下一页</button></div>`;
  }
  renderMarketAccountMenu();
}

function marketCardPayload(card, folder, remoteCardId = '') {
  const payload = structuredClone(card);
  payload.id = remoteCardId || card.id;
  payload.folder = folder;
  delete payload.fsrs;
  delete payload.dueAt;
  delete payload.interval;
  delete payload.reviews;
  delete payload.mastery;
  delete payload.resetAt;
  delete payload.source;
  return payload;
}

function localMarketCards(deckId) {
  return state.cards.filter((card) => card.source?.type === 'market' && card.source.deckId === deckId);
}

function cardFingerprint(card, remoteCardId = '') {
  const copy = marketCardPayload(card, card.folder || '未分组', remoteCardId || card.source?.remoteCardId || '');
  return JSON.stringify(copy);
}

function findLocalMarketCard(deckId, remoteCardId) {
  return state.cards.find((card) => card.source?.type === 'market' && card.source.deckId === deckId && card.source.remoteCardId === remoteCardId);
}

function importMarketCards(deck, packageData) {
  const folder = `市场 · ${deck.title}`;
  if (!state.groups.includes(folder)) state.groups.push(folder);
  const imported = [];
  const conflicts = [];
  const remoteIds = new Set();
  packageData.cards.forEach((remoteCard, index) => {
    if (!remoteCard || typeof remoteCard !== 'object') return;
    const remoteCardId = String(remoteCard.id || `remote-${index + 1}`);
    remoteIds.add(remoteCardId);
    const normalized = normCard({ ...remoteCard, id: id('card'), folder });
    const existing = findLocalMarketCard(deck.id, remoteCardId);
    if (!existing) {
      normalized.source = { type: 'market', deckId: deck.id, version: packageData.version, remoteCardId, remoteFingerprint: cardFingerprint(normalized, remoteCardId) };
      state.cards.push(normalized);
      imported.push(normalized);
      return;
    }
    const original = existing.source?.remoteFingerprint || '';
    const localChanged = original && cardFingerprint(existing, remoteCardId) !== original;
    const incomingFingerprint = cardFingerprint(normalized, remoteCardId);
    if (localChanged && incomingFingerprint !== original) {
      conflicts.push({ deckId: deck.id, deckTitle: deck.title, cardId: existing.id, remoteCardId, version: packageData.version });
      return;
    }
    Object.assign(existing, normalized, { id: existing.id, source: { type: 'market', deckId: deck.id, version: packageData.version, remoteCardId, remoteFingerprint: incomingFingerprint } });
    imported.push(existing);
  });
  localMarketCards(deck.id).forEach((card) => {
    const remoteCardId = card.source?.remoteCardId;
    if (remoteCardId && !remoteIds.has(remoteCardId)) card.source = { ...card.source, version: packageData.version, remoteDeletedAt: new Date().toISOString() };
  });
  const previous = state.market?.conflicts || [];
  state.market = { ...(state.market || {}), decks: { ...(state.market?.decks || {}), [deck.id]: { ...deck, version: packageData.version, importedAt: new Date().toISOString(), folder } }, conflicts: [...previous.filter((item) => item.deckId !== deck.id), ...conflicts] };
  save();
  refresh();
  return { count: imported.length, conflicts: conflicts.length, folder };
}

async function downloadSelectedMarketDeck() {
  if (!marketSelectedDeck || !marketUnlocked || marketBusy) return;
  marketBusy = true;
  const button = $('#marketDownloadButton');
  if (button) { button.disabled = true; button.textContent = '正在下载并校验…'; }
  try {
    const result = await window.reviewBridge.market.downloadDeck({ baseUrl: marketApiBase, token: marketToken, deckId: marketSelectedDeck.id, version: marketSelectedDeck.version });
    if (!result?.ok) throw new Error(result?.error || '下载牌组失败。');
    const imported = importMarketCards(marketSelectedDeck, result);
    $('#marketDetailModal')?.close();
    toast(imported.conflicts ? `已导入 ${imported.count} 张卡片，${imported.conflicts} 张卡片存在本地修改，未覆盖。` : `已安全导入 ${imported.count} 张卡片。`);
  } catch (error) {
    toast(error instanceof Error ? error.message : '下载牌组失败。');
  } finally {
    marketBusy = false;
    if (button) { button.disabled = false; button.textContent = '下载牌组'; }
  }
}
async function openMarketDetail(deckId) {
  const deck = marketDecks.find((item) => item.id === deckId);
  if (!deck) return;
  marketSelectedDeck = deck;
  $('#marketDetailTitle').textContent = deck.title;
  $('#marketDetailSubtitle').textContent = `${deck.category} · 作者 ${deck.author}`;
  $('#marketDetailBody').innerHTML = `<div class="market-detail-cover" style="--deck-color:${deck.color};--deck-accent:${deck.accent}"><span>${esc(deck.category)}</span><strong>${esc(deck.title)}</strong><small>${deck.cards} 张卡片</small></div><div class="market-detail-copy"><p>${esc(deck.description)}</p><div class="market-detail-tags">${deck.tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div><dl><div><dt>卡片数量</dt><dd>${deck.cards}</dd></div><div><dt>下载次数</dt><dd>${deck.downloads}</dd></div><div><dt>最近更新</dt><dd>${esc(deck.updated)}</dd></div></dl><div class="market-sync-note" id="marketUpdateNote"><span>↻</span><span>正在检查版本信息…</span></div></div>`;
  $('#marketDownloadButton').textContent = marketUnlocked ? (marketDeckHasUpdate(deck) ? '更新牌组' : '下载牌组') : '需要认证';
  $('#marketDetailModal').showModal();
  const localVersion = Number(state.market?.decks?.[deck.id]?.version || 0);
  const note = $('#marketUpdateNote');
  if (note) note.textContent = localVersion ? `本地已下载 v${localVersion}，正在检查更新…` : '正在检查版本信息…';
  try {
    const update = await checkMarketDeckUpdate(deck.id, localVersion);
    if (note) note.textContent = update.hasUpdate ? `发现新版本 v${update.latestVersion}。${update.changelog || '下载后将同步最新版本。'}` : (localVersion ? `当前已是最新版本 v${update.latestVersion}。` : '当前为最新公开版本。');
  } catch {
    if (note) note.textContent = '暂时无法检查更新，仍可下载当前公开版本。';
  }
}
function handleMarketClick(event) {
  const button = event.target.closest('[data-market-detail]');
  if (button) openMarketDetail(button.dataset.marketDetail);
}
async function submitMarketAuth(event) {
  event.preventDefault();
  const form = $('#marketAuthForm');
  const isAutoLogin = form?.dataset.autoLogin === 'true';
  if (form) delete form.dataset.autoLogin;
  const serverKey = $('#marketServerKey')?.value.trim();
  const username = $('#marketUsername')?.value.trim();
  const password = $('#marketPassword')?.value || '';
  if (!serverKey || !username || !password) {
    window.marketLoginCharacters?.triggerError?.();
    return;
  }
  const status = $('#marketAuthStatus');
  const submit = $('#marketAuthForm button[type="submit"]');
  if (submit) submit.disabled = true;
  if (status) status.textContent = '正在连接服务器验证…';
  try {
    const result = await marketApi('/auth/login', { method: 'POST', body: JSON.stringify({ accessKey: serverKey, username, password }) });
    marketToken = result.token || '';
    marketUser = result.user || null;
    if (!marketToken) throw new Error('服务器没有返回有效登录令牌');
    await loadMarketCapabilities();
    await loadMarketCategories();
    await syncMyMarketDeckMetadata();
    await loadMarketDecks();
    marketUnlocked = true;
    if (status) status.textContent = '服务器认证成功 · 已进入牌组市场';
    $('#marketAuthForm')?.classList.add('is-authenticated');
    await saveMarketLoginCredentials(serverKey, username, password);
    // Restoring a saved session must not hijack the page shown at startup.
    if (!isAutoLogin || $('#marketView')?.classList.contains('active')) showMarketWorkspace();
    else renderMarket();
    toast('服务器认证成功，牌组市场已开启。');
  } catch (error) {
    marketToken = '';
    marketUnlocked = false;
    if (status) status.textContent = '服务器认证失败';
    const errorBox = $('#marketLoginError');
    if (errorBox) { errorBox.textContent = error instanceof Error ? error.message : '无法连接牌组市场服务器'; errorBox.classList.add('is-visible'); }
    window.marketLoginCharacters?.triggerError?.();
  } finally {
    if (submit) submit.disabled = false;
  }
}
function profileData() { return state.profile || (state.profile = structuredClone(base.profile)); }
function profileGroups() { return [...new Set((state.groups || []).filter(Boolean))]; }
function profileGroupCards(group) { return state.cards.filter((card) => (card.folder || '未分组') === group); }
function profileDeckMeta(group) {
  return profileData().myDecks.find((item) => item.group === group || item.name === group) || null;
}
async function openMarketUpload(group, mode = 'create') {
  if (!marketUnlocked || !marketToken) return toast('请先登录牌组市场。');
  const cards = profileGroupCards(group);
  if (!cards.length) return toast('这个卡组没有可上传的卡片。');
  await loadMarketCategories();
  const meta = profileDeckMeta(group);
  const isUpdate = mode === 'update' && meta?.remoteId;
  $('#marketUploadTitle').textContent = isUpdate ? '更新牌组' : '上传牌组';
  $('#marketUploadDeckId').value = isUpdate ? meta.remoteId : '';
  $('#marketUploadGroup').value = group;
  $('#marketUploadName').value = group;
  const categorySelect = $('#marketUploadCategorySelect');
  const categoryInput = $('#marketUploadNewCategory');
  const category = meta?.category || '';
  if (categorySelect) {
    categorySelect.value = marketCategories.includes(category) ? category : (category ? '__new__' : '');
    categoryInput && (categoryInput.value = marketCategories.includes(category) ? '' : category);
    categoryInput?.toggleAttribute('hidden', categorySelect.value !== '__new__');
  }
  $('#marketUploadDescription').value = meta?.description || `由 ${profileData().name || 'Knowledge Learner'} 分享的学习牌组。`;
  $('#marketUploadChangelog').value = meta?.changelog || '';
  $('#marketUploadModal').showModal();
}
async function submitMarketUpload(event) {
  event.preventDefault();
  if (!marketUnlocked || !marketToken) return toast('请先登录牌组市场。');
  const name = $('#marketUploadName').value.trim();
  const categorySelect = $('#marketUploadCategorySelect');
  const category = categorySelect?.value === '__new__' ? $('#marketUploadNewCategory').value.trim() : (categorySelect?.value || '').trim();
  const group = $('#marketUploadGroup').value.trim();
  const cards = profileGroupCards(group);
  if (!name || !category || !cards.length) return toast('请确认牌组名称、分类和卡片内容。');
  const meta = profileDeckMeta(group);
  const deckId = $('#marketUploadDeckId').value.trim();
  const version = deckId ? Number(meta?.version || 0) + 1 : 1;
  const submit = $('#marketUploadForm button[type="submit"]');
  if (submit) { submit.disabled = true; submit.textContent = '正在上传…'; }
  try {
    const changelog = $('#marketUploadChangelog').value.trim();
    const result = await window.reviewBridge.market.uploadDeck({ baseUrl: marketApiBase, token: marketToken, deckId, title: name, category, description: $('#marketUploadDescription').value.trim(), changelog, version, tags: [category], cards: cards.map((card) => marketCardPayload(card, group)) });
    if (!result?.ok) throw new Error(result?.error || '上传牌组失败。');
    const next = { ...(meta || {}), group, name, remoteId: result.id || deckId, version: Number(result.version || version), category, description: $('#marketUploadDescription').value.trim(), changelog, status: 'pending', updatedAt: new Date().toISOString() };
    const index = profileData().myDecks.findIndex((item) => item.group === group || item.name === group);
    if (index >= 0) profileData().myDecks[index] = next; else profileData().myDecks.push(next);
    save();
    $('#marketUploadModal').close();
    renderProfile();
    await loadMarketCategories();
    toast(deckId ? `牌组已上传新版本 v${next.version}，等待管理员审核。` : '牌组已上传，等待管理员审核。');
  } catch (error) {
    toast(error instanceof Error ? error.message : '上传牌组失败。');
  } finally {
    if (submit) { submit.disabled = false; submit.textContent = '开始上传'; }
  }
}
async function adminApi(path, options = {}) {
  return marketApi(path, options);
}
function adminPaginate(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / adminPageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  return { items: items.slice((current - 1) * adminPageSize, current * adminPageSize), page: current, totalPages, total: items.length };
}
function adminPaginationMarkup(kind, data) {
  if (Number(data.totalPages || 1) <= 1) return '';
  return `<div class="admin-pagination"><span>第 ${data.page} / ${data.totalPages} 页 · 共 ${data.total} 条</span><div><button type="button" data-admin-page="${kind}" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>上一页</button><button type="button" data-admin-page="${kind}" data-page="${data.page + 1}" ${data.page >= data.totalPages ? 'disabled' : ''}>下一页</button></div></div>`;
}
function adminDeckActionMarkup(deck) {
  if (deck.status === 'DISABLED') return `<button type="button" class="table-action" data-admin-deck-action="publish" data-admin-deck-id="${deck.id}">重新上架</button><button type="button" class="table-action danger" data-admin-deck-delete="${deck.id}">永久删除</button>`;
  const pending = deck.versions?.find((version) => version.status === 'PENDING');
  if (pending) return `<button type="button" class="table-action" data-admin-version-action="publish" data-admin-deck-id="${deck.id}" data-admin-version="${pending.version}">发布 v${pending.version}</button><button type="button" class="table-action danger" data-admin-version-action="reject" data-admin-deck-id="${deck.id}" data-admin-version="${pending.version}">拒绝</button>`;
  return `<button type="button" class="table-action" data-admin-deck-action="${deck.status === 'PUBLISHED' ? 'disable' : 'publish'}" data-admin-deck-id="${deck.id}">${deck.status === 'PUBLISHED' ? '下架' : '发布'}</button>`;
}
function adminCategoryOptions(current) {
  const options = [...new Set([current, ...marketCategories].filter(Boolean))];
  return options.map((category) => `<option value="${esc(category)}" ${category === current ? 'selected' : ''}>${esc(category)}</option>`).join('');
}
function adminDeckReviewMarkup(deck) {
  const latest = deck.versions?.[0];
  const pendingCategory = latest?.status === 'PENDING' ? latest.manifest?.category : '';
  const category = deck.category || pendingCategory || '未分类';
  const pendingLabel = pendingCategory && pendingCategory !== category ? `<span class="admin-pending-note">待审核版本：${esc(pendingCategory)}</span>` : '';
  return `<article class="admin-deck-review-card"><header class="admin-deck-review-card-head"><div class="admin-deck-review-identity"><span class="admin-deck-kicker">DECK REVIEW</span><h3>${esc(deck.title)}</h3><p>作者 ${esc(deck.owner.username)} · 最近更新 ${esc(formatDate(deck.updatedAt))}</p></div><div class="admin-deck-review-category"><span>分类</span><div><select class="admin-deck-category-select" data-admin-deck-category-select="${deck.id}" aria-label="${esc(deck.title)}分类">${adminCategoryOptions(category)}</select><button type="button" class="table-action" data-admin-deck-category-save="${deck.id}">保存</button></div>${pendingLabel}</div></header><div class="admin-deck-review-meta"><div><span>牌组状态</span><strong class="admin-deck-status ${String(deck.status).toLowerCase()}">${deck.status}</strong></div><div><span>当前版本</span><strong>v${deck.currentVersion || latest?.version || 0}</strong></div><div><span>版本状态</span><strong class="admin-deck-status ${String(latest?.status || '').toLowerCase()}">${latest?.status || 'NONE'}</strong></div><div><span>文件大小</span><strong>${esc(latest?.packageSize || '0')} B</strong></div></div><footer class="admin-deck-review-actions">${adminDeckActionMarkup(deck)}</footer></article>`;
}
function adminCategoryRowMarkup(category) {
  const statusLabel = category.status === 'PUBLISHED' ? '已通过' : category.status === 'PENDING' ? '待审核' : '已拒绝';
  const actions = [];
  if (category.id) {
    actions.push(`<button type="button" class="table-action" data-admin-category-edit="${category.id}" data-admin-category-name="${esc(category.name)}">编辑</button><button type="button" class="table-action" data-admin-category-cancel hidden>取消</button>`);
    if (category.status === 'PENDING') actions.push(`<button type="button" class="table-action" data-admin-category-action="approve" data-admin-category-id="${category.id}">通过</button><button type="button" class="table-action danger" data-admin-category-action="reject" data-admin-category-id="${category.id}">拒绝</button>`);
    else if (category.status === 'REJECTED') actions.push(`<button type="button" class="table-action" data-admin-category-action="approve" data-admin-category-id="${category.id}">重新通过</button>`);
    actions.push(`<button type="button" class="table-action danger" data-admin-category-delete="${category.id}" data-admin-category-name="${esc(category.name)}">删除</button>`);
  }
  return `<tr data-admin-category-row="${category.id || ''}"><td><strong>${esc(category.name)}</strong><input class="admin-category-edit-input" value="${esc(category.name)}" maxlength="80" hidden /></td><td><span class="admin-deck-status ${String(category.status).toLowerCase()}">${statusLabel}</span></td><td>${esc(category.createdBy?.username || (category.legacy ? '历史数据' : '用户提交'))}</td><td class="admin-action-cell">${actions.join('') || '<span class="muted-label">暂无操作</span>'}</td></tr>`;
}
async function renderAdminOverviewExtras(content, renderToken) {
  try {
    const [stats, audit] = await Promise.all([adminApi('/admin/stats'), adminApi('/admin/audit-logs?page=1&pageSize=8')]);
    if (renderToken !== adminRenderToken || adminActiveTab !== 'overview') return;
    const storage = stats.storage || {};
    const recentLogs = (audit.items || []).map((item) => `<tr><td>${esc(item.action)}</td><td>${esc(item.user?.username || 'system')}</td><td>${esc(formatDate(item.createdAt))}</td></tr>`).join('');
    content.insertAdjacentHTML('beforeend', `<section class="admin-overview-card admin-operations-card"><div><span class="market-eyebrow">OPERATIONS</span><h2>运营与存储</h2><p>查看后端运行数据、最近操作和服务器文件一致性。</p></div><div class="admin-stat-grid admin-stat-grid-compact"><article><span>下载总数</span><strong>${stats.downloads || 0}</strong><small>最近 7 天 ${stats.dailyDownloads?.reduce((sum, item) => sum + item.count, 0) || 0}</small></article><article><span>待审核版本</span><strong>${stats.pendingVersions || 0}</strong><small>等待管理员处理</small></article><article><span>缺失文件</span><strong>${storage.missing?.length || 0}</strong><small>${storage.healthy ? '存储正常' : '需要检查'}</small></article><article><span>孤立文件</span><strong>${storage.orphanFiles?.length || 0}</strong><small>未被数据库引用</small></article></div><div class="admin-overview-actions"><button type="button" class="table-action" data-admin-storage-refresh="true">刷新存储检查</button><button type="button" class="table-action danger" data-admin-storage-cleanup="true">清理临时文件</button></div><div class="admin-log-table-wrap"><table class="admin-table"><thead><tr><th>操作</th><th>用户</th><th>时间</th></tr></thead><tbody>${recentLogs || '<tr><td colspan="3">暂无操作记录</td></tr>'}</tbody></table></div></section>`);
  } catch (error) {
    content.insertAdjacentHTML('beforeend', `<section class="admin-section-card"><p>运营数据暂时无法加载：${esc(error.message || 'unknown error')}</p></section>`);
  }
}
async function renderAdminWorkspace() {
  const viewNode = $('#marketAdminSurface');
  if (!viewNode || marketUser?.role !== 'ADMIN') return;
  const renderToken = ++adminRenderToken;
  const activeTab = adminActiveTab;
  viewNode.hidden = false;
  const adminNav = viewNode.querySelector('.admin-nav');
  if (adminNav) {
    const requiredTabs = [
      ['audit', '操作日志', 'Audit log'],
      ['storage', '存储检查', 'Storage'],
      ['categories', '分类管理', 'Categories']
    ];
    requiredTabs.forEach(([tab, label, subtitle]) => {
      if (!adminNav.querySelector(`[data-admin-tab="${tab}"]`)) adminNav.insertAdjacentHTML('beforeend', `<button type="button" data-admin-tab="${tab}"><span>${label}</span><small>${subtitle}</small></button>`);
    });
  }
  const header = viewNode.querySelector('.admin-main-header');
  if (header && !header.querySelector('.admin-header-actions')) {
    const sessionBadge = header.querySelector('.admin-session-badge');
    const headerActions = document.createElement('div');
    headerActions.className = 'admin-header-actions';
    if (sessionBadge) headerActions.appendChild(sessionBadge);
    const accountSlot = document.createElement('div');
    accountSlot.id = 'marketAdminAccountSlot';
    accountSlot.className = 'market-admin-account-slot';
    headerActions.appendChild(accountSlot);
    header.appendChild(headerActions);
  }
  $('#adminSessionName').textContent = marketUser.username || '管理员';
  const titleMap = { overview: ['市场总览', '查看市场状态和最近的管理活动。'], users: ['许可用户', '创建、启用或停用牌组市场许可账户。'], decks: ['牌组审核', '审核用户上传的牌组并控制公开状态。'], audit: ['操作日志', '查询管理员、用户和牌组市场的关键操作。'], storage: ['存储检查', '确认数据库记录与服务器牌组文件保持一致。'], categories: ['分类管理', '审核用户提交的分类，并调整牌组所属分类。'] };
  const [title, subtitle] = titleMap[adminActiveTab] || titleMap.overview;
  $('#adminPageTitle').textContent = title;
  $('#adminPageSubtitle').textContent = subtitle;
  $$('.admin-nav [data-admin-tab]').forEach((button) => button.classList.toggle('active', button.dataset.adminTab === adminActiveTab));
  const content = $('#adminPageContent');
  // Bind navigation before awaiting remote data so a failed endpoint cannot freeze the workspace.
  bindAdminWorkspaceEvents();
  if (adminActiveTab === 'overview') {
    let stats;
    try {
      stats = await adminApi('/admin/stats');
    } catch {
      // Keep the dashboard usable while an older backend process is still running.
      let users = [];
      let decks = [];
      try {
        const [usersResult, decksResult] = await Promise.all([adminApi('/admin/users'), adminApi('/admin/decks')]);
        users = usersResult.items || usersResult;
        decks = decksResult.items || decksResult;
      } catch {
        // Render zeroed cards instead of leaving the entire workspace blank.
      }
      stats = {
        users: users.length,
        decks: decks.length,
        publishedDecks: decks.filter((deck) => deck.status === 'PUBLISHED').length,
        pendingVersions: decks.reduce((count, deck) => count + (deck.versions || []).filter((version) => version.status === 'PENDING').length, 0),
        downloads: decks.reduce((count, deck) => count + Number(deck.downloads || 0), 0),
        dailyDownloads: []
      };
    }
    if (renderToken !== adminRenderToken || activeTab !== adminActiveTab) return;
    content.innerHTML = `<div class="admin-stat-grid"><article><span>许可用户</span><strong>${stats.users}</strong><small>当前账户总数</small></article><article><span>全部牌组</span><strong>${stats.decks}</strong><small>包含待审核和已下架</small></article><article><span>已公开</span><strong>${stats.publishedDecks}</strong><small>用户可见牌组</small></article><article><span>待处理</span><strong>${stats.pendingVersions}</strong><small>等待版本审核</small></article></div><section class="admin-overview-card"><div><span class="market-eyebrow">QUICK ACTIONS</span><h2>快速管理</h2><p>从这里进入用户或牌组审核页面。</p></div><div class="admin-quick-actions"><button type="button" data-admin-go="users">管理许可用户</button><button type="button" data-admin-go="decks">审核牌组</button></div></section>`;
  } else if (adminActiveTab === 'users') {
    let usersResult;
    try {
      usersResult = await adminApi(`/admin/users?page=${adminPage.users}&pageSize=${adminPageSize}`);
    } catch (error) {
      content.innerHTML = `<section class="admin-section-card admin-load-error"><h2>许可用户暂时无法加载</h2><p>${esc(error.message || '请检查后端服务。')}</p><button type="button" class="table-action" data-admin-retry="true">重新加载</button></section>`;
      bindAdminWorkspaceEvents();
      return;
    }
    if (renderToken !== adminRenderToken || activeTab !== adminActiveTab) return;
    const page = usersResult.items ? usersResult : adminPaginate(usersResult, adminPage.users);
    adminTotalPages.users = page.totalPages;
    content.innerHTML = `<section class="admin-section-card"><div class="admin-section-card-head"><div><span class="market-eyebrow">LICENSED ACCOUNTS</span><h2>许可用户</h2><p>普通用户必须启用后才能进入牌组市场。</p></div></div><form id="adminCreateUserForm" class="admin-create-form"><input id="adminNewUsername" required minlength="3" placeholder="账户名" /><input id="adminNewPassword" required minlength="8" type="password" placeholder="初始密码（至少 8 位）" /><button type="submit" class="primary">创建账户</button></form><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>账户</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${page.items.map((user) => `<tr><td><strong>${esc(user.username)}</strong></td><td><span class="admin-role">${user.role}</span></td><td><span class="admin-enabled ${user.enabled ? 'on' : 'off'}">${user.enabled ? '已启用' : '已停用'}</span></td><td>${esc(formatDate(user.createdAt))}</td><td><button type="button" class="table-action" data-admin-user-action="${user.enabled ? 'disable' : 'enable'}" data-admin-user-id="${user.id}">${user.enabled ? '停用' : '启用'}</button></td></tr>`).join('')}</tbody></table></div>${adminPaginationMarkup('users', page)}</section>`;
  } else if (adminActiveTab === 'audit') {
    let result;
    try { result = await adminApi(`/admin/audit-logs?page=${adminPage.audit}&pageSize=${adminPageSize}`); } catch (error) {
      content.innerHTML = `<section class="admin-section-card admin-load-error"><h2>操作日志</h2><p>当前后端尚未提供日志查询接口，已有日志不会丢失。重启新版后端后即可查看。</p><button type="button" class="table-action" data-admin-retry="true">重新加载</button></section>`;
      bindAdminWorkspaceEvents();
      return;
    }
    if (renderToken !== adminRenderToken || activeTab !== adminActiveTab) return;
    adminTotalPages.audit = result.totalPages || 1;
    content.innerHTML = `<section class="admin-section-card"><div class="admin-section-card-head"><div><span class="market-eyebrow">AUDIT LOG</span><h2>操作日志</h2><p>管理员操作和市场访问事件会保留在服务器数据库中。</p></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>操作</th><th>用户</th><th>目标</th><th>时间</th></tr></thead><tbody>${(result.items || []).map((item) => `<tr><td><strong>${esc(item.action)}</strong></td><td>${esc(item.user?.username || 'system')}</td><td>${esc(item.targetId || '-')}</td><td>${esc(formatDate(item.createdAt))}</td></tr>`).join('') || '<tr><td colspan="4">暂无操作记录</td></tr>'}</tbody></table></div>${adminPaginationMarkup('audit', result)}</section>`;
  } else if (adminActiveTab === 'storage') {
    let result;
    try { result = await adminApi('/admin/storage/health'); } catch (error) {
      content.innerHTML = `<section class="admin-section-card admin-load-error"><h2>存储检查</h2><p>当前后端尚未提供存储检查接口。重启新版后端后即可检查数据库记录与服务器文件。</p><button type="button" class="table-action" data-admin-retry="true">重新加载</button></section>`;
      bindAdminWorkspaceEvents();
      return;
    }
    if (renderToken !== adminRenderToken || activeTab !== adminActiveTab) return;
    content.innerHTML = `<section class="admin-section-card"><div class="admin-section-card-head"><div><span class="market-eyebrow">STORAGE HEALTH</span><h2>存储检查</h2><p>这里只清理服务器临时文件，不会删除用户本地数据。</p></div></div><div class="admin-stat-grid admin-stat-grid-compact"><article><span>数据库版本记录</span><strong>${result.referencedCount}</strong><small>应存在的牌组包</small></article><article><span>服务器文件</span><strong>${result.fileCount}</strong><small>扫描到的文件数</small></article><article><span>缺失文件</span><strong>${result.missing.length}</strong><small>${result.missing.length ? '需要修复' : '正常'}</small></article><article><span>孤立文件</span><strong>${result.orphanFiles.length}</strong><small>${result.orphanFiles.length ? '需要清理' : '正常'}</small></article></div><div class="admin-overview-actions"><button type="button" class="table-action" data-admin-storage-refresh="true">重新检查</button><button type="button" class="table-action danger" data-admin-storage-cleanup="true">清理临时文件</button></div><p class="admin-storage-detail">临时上传文件：${result.temporary.length} 个；删除隔离目录：${result.quarantine.length} 个。</p></section>`;
  } else if (adminActiveTab === 'categories') {
    let categories = [];
    try { categories = await adminApi('/admin/categories'); } catch (error) {
      content.innerHTML = `<section class="admin-section-card admin-load-error"><h2>分类管理暂时无法加载</h2><p>${esc(error.message || '请检查后端服务。')}</p><button type="button" class="table-action" data-admin-retry="true">重新加载</button></section>`;
      bindAdminWorkspaceEvents();
      return;
    }
    if (renderToken !== adminRenderToken || activeTab !== adminActiveTab) return;
    content.innerHTML = `<section class="admin-section-card"><div class="admin-section-card-head"><div><span class="market-eyebrow">CATEGORY REVIEW</span><h2>分类管理</h2><p>用户上传新分类后会先进入待审核状态，管理员创建的分类立即可用。删除前需要先迁移仍在使用中的牌组。</p></div></div><form id="adminCreateCategoryForm" class="admin-create-form"><input id="adminNewCategory" required maxlength="80" placeholder="新建公开分类" /><button type="submit" class="primary">创建分类</button></form><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>分类</th><th>状态</th><th>来源</th><th>操作</th></tr></thead><tbody>${categories.map(adminCategoryRowMarkup).join('') || '<tr><td colspan="4">暂无分类</td></tr>'}</tbody></table></div></section>`;
  } else {
  let decksResult;
    try { decksResult = await adminApi(`/admin/decks?page=${adminPage.decks}&pageSize=${adminPageSize}`); } catch (error) {
      content.innerHTML = `<section class="admin-section-card admin-load-error"><h2>牌组审核暂时无法加载</h2><p>${esc(error.message || '请检查后端服务。')}</p><button type="button" class="table-action" data-admin-retry="true">重新加载</button></section>`;
      bindAdminWorkspaceEvents();
      return;
    }
    if (renderToken !== adminRenderToken || activeTab !== adminActiveTab) return;
    const page = decksResult.items ? decksResult : adminPaginate(decksResult, adminPage.decks);
    adminTotalPages.decks = page.totalPages;
    content.innerHTML = `<section class="admin-section-card admin-deck-review-section"><div class="admin-section-card-head"><div><span class="market-eyebrow">DECK MODERATION</span><h2>牌组审核</h2><p>审核牌组版本、公开状态和分类。待审核版本不会替换当前公开版本。</p></div><span class="admin-review-count">${page.total} 个牌组</span></div><div class="admin-deck-review-list">${page.items.map(adminDeckReviewMarkup).join('') || '<div class="admin-empty-state">暂无待处理牌组</div>'}</div>${adminPaginationMarkup('decks', page)}</section>`;
  }
  if (adminActiveTab === 'overview') await renderAdminOverviewExtras(content, renderToken);
  // Rebind controls created by the current render (tables, quick actions and retry buttons).
  bindAdminWorkspaceEvents();
}
function bindAdminWorkspaceEvents() {
  $$('.admin-nav [data-admin-tab]').forEach((button) => button.onclick = () => { adminActiveTab = button.dataset.adminTab; renderAdminWorkspace(); });
  $$('[data-admin-go]').forEach((button) => button.onclick = () => { adminActiveTab = button.dataset.adminGo; renderAdminWorkspace(); });
  $$('[data-admin-page]').forEach((button) => button.onclick = () => { const kind = button.dataset.adminPage; adminPage[kind] = Number(button.dataset.page); renderAdminWorkspace(); });
  $$('[data-admin-retry]').forEach((button) => button.onclick = () => renderAdminWorkspace());
  $$('[data-admin-storage-refresh]').forEach((button) => button.onclick = async () => { button.disabled = true; try { const result = await adminApi('/admin/storage/health'); toast(result.healthy ? '存储检查通过。' : `发现 ${result.missing.length + result.orphanFiles.length} 个文件问题。`); await renderAdminWorkspace(); } catch (error) { toast(error.message || '存储检查失败。'); } finally { button.disabled = false; } });
  $$('[data-admin-storage-cleanup]').forEach((button) => button.onclick = async () => { if (!window.confirm('只清理超过 24 小时的临时上传文件，继续吗？')) return; button.disabled = true; try { const result = await adminApi('/admin/storage/cleanup', { method: 'POST', body: JSON.stringify({ olderThanHours: 24, removeOrphans: false, removeQuarantine: false }) }); toast(`已清理 ${result.removed.length} 个临时文件。`); await renderAdminWorkspace(); } catch (error) { toast(error.message || '清理失败。'); } finally { button.disabled = false; } });
  const createUserForm = $('#adminCreateUserForm');
  if (createUserForm) createUserForm.onsubmit = async (event) => {
    event.preventDefault();
    const submit = createUserForm.querySelector('button[type="submit"]');
    if (submit?.disabled) return;
    if (submit) submit.disabled = true;
    try {
      await adminApi('/admin/users', { method: 'POST', body: JSON.stringify({ username: $('#adminNewUsername').value.trim(), password: $('#adminNewPassword').value }) });
      toast('许可账户已创建。');
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '创建账户失败。');
    } finally {
      if (submit) submit.disabled = false;
    }
  };
  const createCategoryForm = $('#adminCreateCategoryForm');
  if (createCategoryForm) createCategoryForm.onsubmit = async (event) => {
    event.preventDefault();
    const submit = createCategoryForm.querySelector('button[type="submit"]');
    if (submit?.disabled) return;
    submit.disabled = true;
    try {
      await adminApi('/admin/categories', { method: 'POST', body: JSON.stringify({ name: $('#adminNewCategory').value.trim() }) });
      toast('分类已创建并启用。');
      await loadMarketCategories();
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '创建分类失败。');
    } finally {
      submit.disabled = false;
    }
  };
  $$('[data-admin-category-action]').forEach((button) => button.onclick = async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await adminApi(`/admin/categories/${button.dataset.adminCategoryId}/${button.dataset.adminCategoryAction}`, { method: 'PATCH' });
      toast(button.dataset.adminCategoryAction === 'approve' ? '分类已通过。' : '分类已拒绝。');
      await loadMarketCategories();
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '更新分类失败。');
      button.disabled = false;
    }
  });
  $$('[data-admin-category-edit]').forEach((button) => button.onclick = async () => {
    if (button.disabled) return;
    const row = button.closest('[data-admin-category-row]');
    const label = row?.querySelector('strong');
    const input = row?.querySelector('.admin-category-edit-input');
    const cancel = row?.querySelector('[data-admin-category-cancel]');
    if (button.dataset.editing !== 'true') {
      button.dataset.editing = 'true';
      button.textContent = '保存';
      label?.toggleAttribute('hidden', true);
      input?.toggleAttribute('hidden', false);
      cancel?.toggleAttribute('hidden', false);
      input?.focus();
      return;
    }
    const name = input?.value.trim() || '';
    if (!name || name === button.dataset.adminCategoryName) return toast('请输入新的分类名称。');
    button.disabled = true;
    try {
      await adminApi(`/admin/categories/${button.dataset.adminCategoryEdit}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
      toast('分类已更新，使用该分类的牌组也已同步。');
      await loadMarketCategories();
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '更新分类失败。');
      button.disabled = false;
    }
  });
  $$('[data-admin-category-cancel]').forEach((button) => button.onclick = () => {
    const row = button.closest('[data-admin-category-row]');
    const edit = row?.querySelector('[data-admin-category-edit]');
    const label = row?.querySelector('strong');
    const input = row?.querySelector('.admin-category-edit-input');
    edit?.removeAttribute('data-editing');
    if (edit) edit.textContent = '编辑';
    label?.toggleAttribute('hidden', false);
    input?.toggleAttribute('hidden', true);
    button.toggleAttribute('hidden', true);
  });
  $$('[data-admin-category-delete]').forEach((button) => button.onclick = async () => {
    if (button.disabled || !window.confirm(`确定删除分类“${button.dataset.adminCategoryName}”吗？`)) return;
    button.disabled = true;
    try {
      await adminApi(`/admin/categories/${button.dataset.adminCategoryDelete}`, { method: 'DELETE' });
      toast('分类已删除。');
      await loadMarketCategories();
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '删除分类失败。');
      button.disabled = false;
    }
  });
  $$('[data-admin-deck-category-save]').forEach((button) => button.onclick = async () => {
    if (button.disabled) return;
    const select = document.querySelector(`[data-admin-deck-category-select="${button.dataset.adminDeckCategorySave}"]`);
    const category = select?.value.trim();
    if (!category) return toast('请选择牌组分类。');
    button.disabled = true;
    try {
      await adminApi(`/admin/decks/${button.dataset.adminDeckCategorySave}/category`, { method: 'PATCH', body: JSON.stringify({ category }) });
      toast('牌组分类已更新。');
      await loadMarketCategories();
      await loadMarketDecks();
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '调整牌组分类失败。');
      button.disabled = false;
    }
  });
  $$('[data-admin-deck-category]').forEach((button) => button.onclick = async () => {
    const category = window.prompt('请输入新的牌组分类：', button.dataset.adminDeckCategory || '');
    if (!category?.trim()) return;
    button.disabled = true;
    try {
      await adminApi(`/admin/decks/${button.dataset.adminDeckId}/category`, { method: 'PATCH', body: JSON.stringify({ category: category.trim() }) });
      toast('牌组分类已调整。');
      await loadMarketDecks();
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '调整牌组分类失败。');
      button.disabled = false;
    }
  });
  $$('[data-admin-user-action]').forEach((button) => button.onclick = async () => { try { await adminApi(`/admin/users/${button.dataset.adminUserId}/${button.dataset.adminUserAction}`, { method: 'PATCH' }); renderAdminWorkspace(); } catch (error) { toast(error.message || '更新账户失败。'); } });
  $$('[data-admin-deck-action]').forEach((button) => button.onclick = async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await adminApi(`/admin/decks/${button.dataset.adminDeckId}/${button.dataset.adminDeckAction}`, { method: 'PATCH' });
      await loadMarketDecks();
      toast('牌组状态已更新。');
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '更新牌组失败。');
      button.disabled = false;
    }
  });
  $$('[data-admin-deck-delete]').forEach((button) => button.onclick = async () => {
    if (button.disabled || !window.confirm('永久删除后，服务器上的牌组、历史版本和下载记录都无法恢复。确定继续吗？')) return;
    button.disabled = true;
    try {
      if (marketCapabilities.permanentDeckDelete !== true) throw new Error('当前后端版本不支持永久删除，请先重启新版后端服务。');
      await adminApi(`/admin/decks/${button.dataset.adminDeckDelete}`, { method: 'DELETE' });
      await loadMarketDecks();
      toast('停用牌组及其服务器数据已永久删除。');
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '永久删除牌组失败。');
      button.disabled = false;
    }
  });
  $$('[data-admin-version-action]').forEach((button) => button.onclick = async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await adminApi(`/admin/decks/${button.dataset.adminDeckId}/versions/${button.dataset.adminVersion}/${button.dataset.adminVersionAction}`, { method: 'PATCH' });
      await loadMarketDecks();
      toast(button.dataset.adminVersionAction === 'publish' ? '牌组新版本已发布。' : '牌组新版本已拒绝。');
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '审核牌组版本失败。');
      button.disabled = false;
    }
  });
}
async function renderAdminPanel() {
  // Kept as a compatibility shim for older markup. The active admin surface is
  // rendered by renderAdminWorkspace so there is only one source of truth.
  if ($('#marketAdminSurface')) return renderAdminWorkspace();
}
function ensureServerSettingsPanel() {
  const panel = $('#serverPanel');
  if (!panel || panel.dataset.ready === 'true') return;
  panel.dataset.ready = 'true';
  panel.innerHTML = `<div class="sync-panel-heading"><div><span class="modal-eyebrow">MARKET SERVER</span><h2>牌组市场服务器</h2><p class="setting-description">填写服务器域名或 IP 后，牌组市场会使用远程服务。留空时默认连接本机服务。</p></div></div><div class="market-server-form"><label>服务器地址<input id="marketServerUrl" type="url" autocomplete="url" spellcheck="false" placeholder="留空使用 http://127.0.0.1:4000" /></label><p class="field-hint">例如 https://market.example.com 或 192.168.1.20:4000。程序会自动补充 /api/v1。</p></div><div class="storage-actions market-server-actions"><button class="secondary-button" id="marketServerTestButton" type="button">测试连接</button><button class="primary" id="marketServerSaveButton" type="button">保存服务器地址</button><button class="secondary-button" id="marketServerResetButton" type="button">恢复本机</button></div><div class="storage-status" id="marketServerStatus">当前使用本机服务器</div>`;
  const input = $('#marketServerUrl');
  const status = $('#marketServerStatus');
  input.value = state.settings?.marketServerUrl || '';
  if (status) status.textContent = input.value ? `当前服务器：${normalizeMarketApiBase(input.value)}` : '当前使用本机服务器';
  const applyServer = (value) => {
    const raw = String(value || '').trim();
    if (raw && !parseMarketApiBase(raw)) {
      toast('服务器地址格式不正确，请填写域名、IP 或完整 URL。');
      return false;
    }
    const nextBase = normalizeMarketApiBase(raw);
    if (nextBase !== marketApiBase) {
      marketRememberCredentials = false;
      void window.reviewBridge?.market?.clearCredentials?.();
    }
    state.settings.marketServerUrl = raw;
    marketApiBase = nextBase;
    marketToken = '';
    marketUser = null;
    marketUnlocked = false;
    marketCapabilities = {};
    marketAutoLoginTried = false;
    save();
    if (status) status.textContent = raw ? `当前服务器：${marketApiBase}` : '当前使用本机服务器';
    return true;
  };
  $('#marketServerSaveButton').addEventListener('click', () => {
    if (applyServer(input.value)) {
      renderMarket();
      toast('牌组市场服务器地址已保存。');
    }
  });
  $('#marketServerResetButton').addEventListener('click', () => {
    input.value = '';
    if (applyServer('')) {
      renderMarket();
      toast('已恢复本机牌组市场服务器。');
    }
  });
  $('#marketServerTestButton').addEventListener('click', async () => {
    const raw = input.value.trim();
    const base = parseMarketApiBase(raw);
    if (raw && !base) return toast('服务器地址格式不正确，请填写域名、IP 或完整 URL。');
    const button = $('#marketServerTestButton');
    button.disabled = true;
    if (status) status.textContent = '正在测试服务器连接…';
    try {
      const response = await fetch(`${(base || DEFAULT_MARKET_API_BASE).replace(/\/api\/v1$/, '')}/health`, { cache: 'no-store' });
      const health = await response.json().catch(() => ({}));
      if (!response.ok || !health.ok) throw new Error(`服务器返回 ${response.status}`);
      if (status) status.textContent = `连接成功：${base || DEFAULT_MARKET_API_BASE} · API ${health.apiVersion || '未知版本'}`;
      toast('牌组市场服务器连接成功。');
    } catch (error) {
      if (status) status.textContent = `连接失败：${error instanceof Error ? error.message : '无法连接服务器'}`;
      toast('无法连接牌组市场服务器，请检查地址和服务状态。');
    } finally {
      button.disabled = false;
    }
  });
}

function toggleMarketAuthMode() {
  var form = document.getElementById("marketAuthForm");
  var btn = document.getElementById("marketRegisterToggle");
  if (!form || !btn) return;
  var isRegister = form.classList.toggle("is-register-mode");
  btn.textContent = isRegister ? "Already have an account? Login" : "No account? Register";
}
