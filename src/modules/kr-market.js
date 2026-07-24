/**
 * kr-market.js - Deck market, auth, admin workspace
 * Dependencies: kr-core.js, kr-state.js
 * Provides: marketApi, renderMarket, showMarketWorkspace, handleMarketLogin,
 *           openAdminWorkspace, renderAdminWorkspace, bindAdminWorkspaceEvents,
 *           importMarketCards, resolveMarketConflicts, openMarketUpload,
 *           marketPublish, ensureServerSettingsPanel, toggleFavorite, isDeckFavorited, openPasswordChangeDialog, loadMarketFavorites
 */
function marketDeckMatches(deck) {
  const query = marketQuery.toLowerCase();
  return (marketCategory !== 'favorites' || isDeckFavorited(deck.id))
    && (!query || [deck.title, deck.author, ...deck.tags].join(' ').toLowerCase().includes(query));
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
  return decks.sort((a, b) => marketSort === 'popular' ? b.downloads - a.downloads : marketSort === 'cards' ? b.cards - a.cards : String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}
async function marketApi(path, options = {}) {
  const isV2 = String(path).startsWith('/v2/');
  const apiBase = isV2 ? marketApiBase.replace(/\/api\/v1$/, '/api/v2') : marketApiBase;
  const apiPath = isV2 ? String(path).slice(3) : path;
  const headers = new Headers(options.headers || {});
  if (marketToken) headers.set('Authorization', `Bearer ${marketToken}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const fullUrl = `${apiBase}${apiPath}`;
  const fetchOptions = { cache: 'no-store', ...options, headers };

  // Try IPC proxy through main process (bypasses renderer network restrictions)
  let ipcResult = null;
  try {
    if (window.reviewBridge?.market?.fetch) {
      const serializableOptions = {
        method: fetchOptions.method,
        headers: Object.fromEntries(headers.entries()),
        body: fetchOptions.body || undefined
      };
      ipcResult = await window.reviewBridge.market.fetch({ url: fullUrl, options: serializableOptions });
      if (ipcResult && ipcResult.status > 0) {
        const body = ipcResult.body;
        if (!ipcResult.ok) {
          const errMsg = (body && typeof body === 'object' && body.error) ? body.error : `市场接口请求失败（${ipcResult.status}）`;
          throw new Error(errMsg);
        }
        return body;
      }
    }
  } catch (ipcError) {
    // If IPC result was received and it was an error, re-throw immediately
    if (ipcResult && ipcResult.status > 0) throw ipcError;
    console.warn("[MARKET-API] IPC proxy failed, falling back to direct fetch:", ipcError.message);
  }

  // Fallback to direct fetch
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(fullUrl, { ...fetchOptions, signal: controller.signal });
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
  const manifest = deck.manifest || deck.versions?.[0]?.manifest || {};
  return {
    id: deck.id,
    title: deck.title || manifest.title || '未命名牌组',
    author: deck.author || deck.owner?.nickname || deck.owner?.username || '未知作者',
    category: deck.category || manifest.category || '',
    cards: Number(manifest.cardCount || 0),
    downloads: Number(deck.downloads ?? deck._count?.downloads ?? 0),
    updated: deck.updatedAt ? formatMarketDate(deck.updatedAt) : '刚刚更新',
    color: '#e7f3ed',
    accent: '#2f7d64',
    tags: Array.isArray(manifest.tags) ? manifest.tags : [],
    description: deck.description || manifest.description || '',
    version: Number(deck.version || deck.publishedVersion || deck.currentVersion || manifest.version || 1)
  };
}
function formatMarketDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
async function loadMarketDecks() {
  const backendSort = marketSort === 'popular' ? 'popular' : 'newest';
  const params = new URLSearchParams({ page: String(marketPage), pageSize: String(marketPageSize), sort: backendSort });
  if (marketQuery) params.set('search', marketQuery);
  const result = await marketApi(`/decks?${params.toString()}`);
  const decks = Array.isArray(result) ? result : (result.decks || result.items || []);
  marketTotal = Array.isArray(result) ? decks.length : Number(result.total || 0);
  marketTotalPages = Array.isArray(result) ? 1 : Math.max(1, Number(result.totalPages || 1));
  marketDecks = Array.isArray(decks) ? decks.map(normalizeMarketDeck) : [];
  marketUpdateCache.clear();
}
async function loadMarketFavorites() {
  if (!marketToken) return;
  try {
    const result = await marketApi('/favorites');
    state.favorites = Array.isArray(result?.favorites) ? result.favorites.map(f => f.deckId) : [];
    save();
  } catch (err) {
    console.warn('[MARKET] 收藏加载失败:', err.message);
  }
}
async function loadMarketCategories() {
  // Categories remain a backend compatibility endpoint, but are no longer a
  // market concept in the client.
  marketCategories = [];
}
async function loadMarketCapabilities() {
  const healthUrl = `${marketApiBase.replace(/\/api\/v1$/, '')}/health`;
  try {
    // Try IPC proxy first
    if (window.reviewBridge?.market?.fetch) {
      const result = await window.reviewBridge.market.fetch({ url: healthUrl, options: { method: 'GET' } });
      if (result && result.ok && result.body) {
        marketCapabilities = result.body.capabilities || {};
        return result.body;
      }
    }
    // Fallback to direct fetch
    const health = await fetch(healthUrl, { cache: 'no-store' }).then((response) => response.json());
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
  const remoteDecks = Array.isArray(result) ? result : result.decks || result.items || [];
  const remoteIds = new Set(remoteDecks.map((d) => d.id));
  const profile = profileData();
  const localDecks = Array.isArray(profile.myDecks) ? profile.myDecks : [];
  // Remove stale entries whose remoteId no longer exists on the server
  const merged = localDecks.filter((item) => !item.remoteId || remoteIds.has(item.remoteId));
  remoteDecks.forEach((remote) => {
    const latest = remote.versions?.[0];
    const remoteTitle = String(remote.title || '').trim().toLocaleLowerCase();
    const sameTitle = merged.filter((item) => [item.group, item.name, item.title]
      .some((value) => String(value || '').trim().toLocaleLowerCase() === remoteTitle));
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
  marketAuthBootstrapping = false;
  setAppAuthLock(true);
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
  // Pre-fill server address from current marketApiBase (not from old accessKey)
  const key = $('#marketServerKey');
  if (key && !key.value) {
    try { const u = new URL(marketApiBase); key.value = u.host + (u.pathname.replace(/\/api\/v1$/, '') || ''); } catch { key.value = '127.0.0.1:4100'; }
  }
  if (!saved?.remember || !saved.username || !saved.password || !autoLogin) {
    marketAuthBootstrapping = false;
    return;
  }
  marketRememberCredentials = true;
  const username = $('#marketUsername');
  const password = $('#marketPassword');
  const remember = $('#marketRememberCredentials');
  if (username) username.value = saved.username || '';
  if (password) password.value = saved.password || '';
  if (remember) remember.checked = true;
  if (autoLogin && !marketAutoLoginTried && saved.username && saved.password) {
    marketAutoLoginTried = true;
    setTimeout(() => {
      const form = $('#marketAuthForm');
      if (!form) return;
      form.dataset.autoLogin = 'true';
      form.requestSubmit();
    }, 120);
  }
}

async function saveMarketLoginCredentials(username, password) {
  const remember = $('#marketRememberCredentials')?.checked === true;
  marketRememberCredentials = remember;
  if (remember) await window.reviewBridge?.market?.saveCredentials?.({ username, password });
  else await window.reviewBridge?.market?.clearCredentials?.();
}

function showMarketWorkspace() {
  marketSurface = 'decks';
  view('market');
  renderMarket();
}
function setAppAuthLock(locked) {
  appAuthLocked = locked;
  document.body.classList.toggle('app-auth-locked', locked);
  $('#adminRailButton')?.toggleAttribute('hidden', locked || marketUser?.role !== 'ADMIN');
  renderMarketSettingsAccount();
}
function mountAdminWorkspace() {
  const surface = $('#marketAdminSurface');
  const host = $('#adminWorkspaceHost');
  if (surface && host && surface.parentElement !== host) host.appendChild(surface);
  surface?.removeAttribute('hidden');
  marketSurface = 'admin';
}
function openAdminWorkspace() {
  if (!marketUnlocked || marketUser?.role !== 'ADMIN') return;
  mountAdminWorkspace();
  view('admin');
}
function renderMarketSettingsAccount() {
  const section = $('#marketSettingsAccountSection');
  if (!section) return;
  const authenticated = Boolean(marketUnlocked && marketUser);
  section.hidden = !authenticated;
  if (!authenticated) return;
  const profile = profileData();
  const name = marketUser?.nickname || profile.name || marketUser?.username || 'Knowledge Learner';
  const avatarSrc = profile.avatar || marketUser?.avatar || '';
  const image = $('#marketSettingsAccountImage');
  const fallback = $('#marketSettingsAccountFallback');
  $('#marketSettingsAccountName').textContent = name;
  $('#marketSettingsAccountRole').textContent = marketUser.role === 'ADMIN' ? '管理员账户' : '许可账户';
  if (avatarSrc) {
    image.src = avatarSrc;
    image.hidden = false;
    fallback.hidden = true;
  } else {
    image.hidden = true;
    fallback.hidden = false;
    fallback.textContent = name.slice(0, 1).toUpperCase();
  }
}
async function showMarketDecks() {
  marketSurface = 'decks';
  if (marketUnlocked) {
    try {
      await loadMarketCategories();
      await loadMarketDecks();
      await loadMarketFavorites();
    } catch (error) {
      toast(error instanceof Error ? error.message : '公开牌组刷新失败。');
    }
  }
  view('market');
}
async function refreshMarketPage({ resetPage = false } = {}) {
  if (resetPage) marketPage = 1;
  try { await loadMarketCategories(); await loadMarketDecks(); await loadMarketFavorites(); } catch (error) { toast(error instanceof Error ? error.message : '公开牌组刷新失败。'); }
  renderMarket();
}
function marketProfileSummary() {
  const profile = profileData();
  return { name: marketUser?.nickname || profile.name || marketUser?.username || 'Knowledge Learner', avatar: profile.avatar || marketUser?.avatar || '' };
}
async function logoutMarket() {
  await returnToMarketLogin();
}
function openPasswordChangeDialog() {
  let dlg = document.getElementById('passwordChangeDialog');
  if (dlg) dlg.remove();
  dlg = document.createElement('dialog');
  dlg.id = 'passwordChangeDialog';
  dlg.className = 'modal password-change-modal';
  dlg.innerHTML = '<form method="dialog" class="modal-card password-change-card" id="passwordChangeForm"><div class="modal-header"><div><span class="modal-eyebrow">ACCOUNT SECURITY</span><h2>修改密码</h2><p class="modal-subtitle">正在修改账户 ' + esc(marketUser?.username || '') + ' 的密码</p></div><button type="button" id="pwdDialogClose" class="dialog-close" title="关闭"><svg><use href="#i-x"/></svg></button></div><div class="password-fields"><label>当前密码<input id="pwdCurrentInput" type="password" autocomplete="current-password" placeholder="输入当前密码" /></label><label>新密码<input id="pwdNewInput" type="password" autocomplete="new-password" placeholder="至少 8 个字符" minlength="8" /></label><label>确认新密码<input id="pwdConfirmInput" type="password" autocomplete="new-password" placeholder="再次输入新密码" /></label></div><menu><button type="button" id="pwdCancelBtn" value="cancel">取消</button><button type="button" class="primary" id="pwdSubmitBtn">修改密码</button></menu></form>';
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.querySelector('#pwdDialogClose')?.addEventListener('click', () => dlg.close());
  dlg.querySelector('#pwdCancelBtn')?.addEventListener('click', () => dlg.close());
  dlg.querySelector('#pwdSubmitBtn')?.addEventListener('click', async () => {
    const current = (dlg.querySelector('#pwdCurrentInput')?.value || '').trim();
    const newPwd = (dlg.querySelector('#pwdNewInput')?.value || '').trim();
    const confirm = (dlg.querySelector('#pwdConfirmInput')?.value || '').trim();
    if (!current) return toast('请输入当前密码。');
    if (!newPwd || newPwd.length < 8) return toast('新密码至少需要 8 个字符。');
    if (newPwd !== confirm) return toast('两次输入的新密码不一致。');
    const btn = dlg.querySelector('#pwdSubmitBtn');
    btn.disabled = true;
    btn.textContent = '修改中…';
    try {
      await marketApi('/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: newPwd })
      });
      toast('密码修改成功，请重新登录。');
      dlg.close();
      marketToken = '';
      marketUser = null;
      marketUnlocked = false;
      if (window.reviewBridge?.market?.clearCredentials) {
        void window.reviewBridge.market.clearCredentials();
      }
      returnToMarketLogin();
    } catch (err) {
      toast('密码修改失败：' + (err.message || '未知错误'));
    } finally {
      btn.disabled = false;
      btn.textContent = '修改密码';
    }
  });
}
function renderMarketAccountMenu() {
  const host = marketSurface === 'admin' ? $('#marketAdminAccountSlot') : $('#marketAccountSlot');
  if (!host || !marketUnlocked || !marketUser) return;
  const profile = marketProfileSummary();
  host.innerHTML = `<div class="market-account"><button type="button" class="market-account-trigger" id="marketAccountButton" aria-expanded="false"><span class="market-account-avatar">${profile.avatar ? `<img src="${esc(profile.avatar)}" alt="" />` : esc(profile.name.slice(0, 1).toUpperCase())}</span><span class="market-account-name">${esc(profile.name)}</span><svg><use href="#i-chevron-down"></use></svg></button><div class="market-account-menu" id="marketAccountMenu" hidden><div class="market-account-menu-head"><span class="market-account-avatar large">${profile.avatar ? `<img src="${esc(profile.avatar)}" alt="" />` : esc(profile.name.slice(0, 1).toUpperCase())}</span><div><strong>${esc(profile.name)}</strong><small>${esc(marketUser.role === 'ADMIN' ? '管理员账户' : '许可账户')}</small></div></div><button type="button" data-market-account-action="profile">编辑资料</button>${marketUser.role === 'ADMIN' ? '<button type="button" data-market-account-action="admin">管理后台</button>' : ''}<button type="button" data-market-account-action="password">修改密码</button><button type="button" class="danger" data-market-account-action="logout">退出登录</button></div></div>`;
  $('#marketAccountButton')?.addEventListener('click', (event) => { event.stopPropagation(); const menu = $('#marketAccountMenu'); if (menu) menu.hidden = !menu.hidden; $('#marketAccountButton').setAttribute('aria-expanded', String(!menu.hidden)); });
  $$('#marketAccountMenu [data-market-account-action]').forEach((button) => button.addEventListener('click', () => { const action = button.dataset.marketAccountAction; if (action === 'profile') openProfileEditor(); if (action === 'admin') openAdminWorkspace(); if (action === 'password') openPasswordChangeDialog(); if (action === 'logout') logoutMarket(); }));
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
    return;
  }
  const grid = $('#marketGrid');
  $('#marketView')?.classList.toggle('is-locked', !marketUnlocked);
  const authBootstrapping = marketAuthBootstrapping && !marketUnlocked;
  $('#marketLoginScreen')?.toggleAttribute('hidden', marketUnlocked || authBootstrapping);
  // Pre-fill server address field if empty
  const serverKeyField = $('#marketServerKey');
  if (serverKeyField && !serverKeyField.value) {
    try { const u = new URL(marketApiBase); serverKeyField.value = u.host + (u.pathname.replace(/\/api\/v1$/, '') || ''); } catch { serverKeyField.value = '127.0.0.1:4100'; }
  }
  $('#marketAuthBootstrap')?.toggleAttribute('hidden', !authBootstrapping);
  $('#marketUnlockedContent')?.toggleAttribute('hidden', !marketUnlocked);
  if (!grid) return;
  const decks = marketDecksForDisplay();
  grid.innerHTML = decks.length ? decks.map((deck) => {
    const hasUpdate = marketDeckHasUpdate(deck);
    const isFav = isDeckFavorited(deck.id);
    return `<article class="market-deck-card-v2${hasUpdate ? ' has-update' : ''}" data-market-deck="${esc(deck.id)}" style="--cat-color:${esc(deck.accent)}"><div class="mc2-header"><span class="mc2-category">${esc(deck.category)}</span><div style="display:flex;gap:6px;align-items:center">${hasUpdate ? '<span class="mc2-update-pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>可更新</span>' : ''}<button type="button" class="market-fav-button${isFav ? ' is-fav' : ''}" data-market-fav="${esc(deck.id)}" aria-label="收藏牌组"><svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></button></div></div><h3 class="mc2-title" data-market-detail="${esc(deck.id)}">${esc(deck.title)}</h3><p class="mc2-author">作者 ${esc(deck.author)}</p><p class="mc2-desc">${esc(deck.description || '由 ' + deck.author + ' 分享的学习牌组。')}</p><div class="mc2-meta"><span class="mc2-meta-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>${deck.cards} 张卡片</span><span class="mc2-meta-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${deck.downloads} 次下载</span><span class="mc2-meta-item mc2-date">${esc(deck.updated)}</span></div><button type="button" class="mc2-action-btn" data-market-detail="${esc(deck.id)}">${hasUpdate ? '更新牌组' : '查看牌组'}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button></article>`;
  }).join('') : '<div class="market-empty"><strong>没有找到匹配牌组</strong><span>尝试更换关键词或筛选条件。</span></div>';
  const pager = ensureMarketPagination();
  if (pager) {
    pager.hidden = marketTotalPages <= 1;
    pager.innerHTML = marketTotalPages <= 1 ? '' : `<span>第 ${marketPage} / ${marketTotalPages} 页 · 共 ${marketTotal} 个牌组</span><div><button type="button" data-market-page="${marketPage - 1}" ${marketPage <= 1 ? 'disabled' : ''}>上一页</button><button type="button" data-market-page="${marketPage + 1}" ${marketPage >= marketTotalPages ? 'disabled' : ''}>下一页</button></div>`;
  }
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

function findExistingCardByContent(folder, normalizedCard) {
  const normQ = String(normalizedCard.question || '').trim();
  const normT = String(normalizedCard.type || '').trim();
  if (!normQ) return null;
  return state.cards.find((card) => {
    if ((card.folder || '未分组') !== folder) return false;
    if (String(card.type || '').trim() !== normT) return false;
    if (String(card.question || '').trim() !== normQ) return false;
    return JSON.stringify(card.answer || []) === JSON.stringify(normalizedCard.answer || []);
  }) || null;
}

function importMarketCards(deck, packageData, targetFolder) {
  const folder = targetFolder || `市场 · ${deck.title}`;
  if (!state.groups.includes(folder)) state.groups.push(folder);
  const imported = [];
  const skipped = [];
  const remoteIds = new Set();
  packageData.cards.forEach((remoteCard, index) => {
    if (!remoteCard || typeof remoteCard !== 'object') return;
    const remoteCardId = String(remoteCard.id || `remote-${index + 1}`);
    remoteIds.add(remoteCardId);
    const normalized = normCard({ ...remoteCard, id: id('card'), folder });
    let existing = findLocalMarketCard(deck.id, remoteCardId);
    if (!existing) existing = findExistingCardByContent(folder, normalized);
    if (!existing) {
      normalized.source = { type: 'market', deckId: deck.id, version: packageData.version, remoteCardId, remoteFingerprint: cardFingerprint(normalized, remoteCardId) };
      state.cards.push(normalized);
      imported.push(normalized);
      return;
    }
    if (!existing.source || typeof existing.source === 'string') {
      existing.source = { type: 'market', deckId: deck.id, version: packageData.version, remoteCardId, remoteFingerprint: cardFingerprint(existing, remoteCardId) };
    }
    skipped.push(existing.id);
  });
  const previous = state.market?.conflicts || [];
  state.market = { ...(state.market || {}), decks: { ...(state.market?.decks || {}), [deck.id]: { ...deck, version: packageData.version, importedAt: new Date().toISOString(), folder } }, conflicts: previous.filter((item) => item.deckId !== deck.id) };
  save();
  refresh();
  return { count: imported.length, skipped: skipped.length, folder };
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
    toast(imported.skipped ? `已新增 ${imported.count} 张卡片，${imported.skipped} 张已存在跳过。` : `已新增 ${imported.count} 张卡片。`);
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
  $('#marketDetailSubtitle').textContent = `作者 ${deck.author}`;
  $('#marketDetailBody').innerHTML = `<div class="market-detail-cover" style="--deck-color:${deck.color};--deck-accent:${deck.accent}"><span>公开牌组</span><strong>${esc(deck.title)}</strong><small>${deck.cards} 张卡片</small></div><div class="market-detail-copy"><p>${esc(deck.description)}</p><div class="market-detail-tags">${deck.tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div><dl><div><dt>卡片数量</dt><dd>${deck.cards}</dd></div><div><dt>下载次数</dt><dd>${deck.downloads}</dd></div><div><dt>最近更新</dt><dd>${esc(deck.updated)}</dd></div><div class="market-deck-id-row"><dt>牌组 ID</dt><dd><code class="market-deck-id-code">${esc(deck.id)}</code><button type="button" class="market-copy-id-btn" data-copy-deck-id="${esc(deck.id)}" title="复制牌组 ID">复制</button></dd></div></dl><div class="market-sync-note" id="marketUpdateNote"><span>↻</span><span>正在检查版本信息…</span></div></div>`;
  $('#marketDownloadButton').textContent = marketUnlocked ? (marketDeckHasUpdate(deck) ? '更新牌组' : '下载牌组') : '需要认证';
  $('#marketDetailModal').showModal();
  $('#marketDetailBody').querySelector('[data-copy-deck-id]')?.addEventListener('click', async (e) => {
    const id = e.currentTarget.dataset.copyDeckId;
    try { await navigator.clipboard.writeText(id); toast('牌组 ID 已复制。'); } catch { copyToClipboardFallback(id); }
  });
  const localVersion = Number(state.market?.decks?.[deck.id]?.version || 0);
  const note = $('#marketUpdateNote');
  if (note) note.textContent = localVersion ? '本地已下载，正在检查更新…' : '正在检查更新…';
  try {
    const update = await checkMarketDeckUpdate(deck.id, localVersion);
    if (note) note.textContent = update.hasUpdate ? `发现更新。${update.changelog || '下载后将同步最新内容。'}` : (localVersion ? '当前已是最新版本。' : '当前为最新公开版本。');
  } catch {
    if (note) note.textContent = '暂时无法检查更新，仍可下载当前公开版本。';
  }
}
function handleMarketClick(event) {
  const catButton = event.target.closest('[data-market-category]');
  if (catButton) {
    marketCategory = catButton.dataset.marketCategory;
    marketPage = 1;
    document.querySelectorAll('.market-category-btn').forEach((btn) => btn.classList.toggle('active', btn === catButton));
    renderMarket();
    return;
  }
  const favButton = event.target.closest('[data-market-fav]');
  if (favButton) { toggleFavorite(favButton.dataset.marketFav, event); return; }
  const button = event.target.closest('[data-market-detail]');
  if (button) openMarketDetail(button.dataset.marketDetail);
}
function ensureMarketRegistrationField() {
  const form = $('#marketAuthForm');
  if (!form || $('#marketInvitationCode')) return;
  const field = document.createElement('div');
  field.className = 'market-character-form-group market-registration-field';
  field.hidden = true;
  field.innerHTML = '<label for="marketInvitationCode">邀请码</label><input id="marketInvitationCode" type="text" placeholder="输入管理员提供的邀请码" autocomplete="one-time-code" spellcheck="false" /><small class="field-hint" id="marketInvitationHint">邀请码只在注册时使用一次。</small>';
  const error = $('#marketLoginError');
  if (error) form.insertBefore(field, error);
  else form.appendChild(field);
}
async function submitMarketAuth(event) {
  event.preventDefault();
  marketAuthBootstrapping = false;
  ensureMarketRegistrationField();
  const form = $('#marketAuthForm');
  const isAutoLogin = form?.dataset.autoLogin === 'true';
  if (form) delete form.dataset.autoLogin;
  const serverAddr = $('#marketServerKey')?.value.trim();
  const username = $('#marketUsername')?.value.trim();
  const password = $('#marketPassword')?.value || '';
  const isRegister = form?.classList.contains('is-register-mode');
  const invitationCode = $('#marketInvitationCode')?.value.trim() || '';
  if (!serverAddr || !username || !password || (isRegister && !invitationCode)) {
    const errorBox = $('#marketLoginError');
    let hint = '请填写所有必填字段。';
    if (!serverAddr) hint = '请输入服务器地址。';
    else if (!username) hint = '请输入账户名。';
    else if (!password) hint = '请输入密码。';
    else if (isRegister && !invitationCode) hint = '请输入邀请码。';
    if (errorBox) { errorBox.textContent = hint; errorBox.classList.add('is-visible'); }
    window.marketLoginCharacters?.triggerError?.();
    return;
  }
  // Update marketApiBase from the server address field
  const newBase = parseMarketApiBase(serverAddr);
  if (newBase) {
    marketApiBase = newBase;
    state.settings.marketServerKey = encodeMarketServerKey(newBase);
    save();
  }
  const status = $('#marketAuthStatus');
  const submit = $('#marketAuthForm button[type="submit"]');
  if (submit) submit.disabled = true;
  if (status) status.textContent = '正在连接服务器验证…';
  try {
    if (isRegister) {
      const validation = await marketApi('/v2/invitations/validate', { method: 'POST', body: JSON.stringify({ code: invitationCode }) });
      if (!validation?.valid) throw new Error(validation?.reason || '邀请码无效或已失效。');
    }
    const result = await marketApi(isRegister ? '/v2/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(isRegister ? { invitationCode, username, password } : { username, password }) });
    marketToken = result.token || '';
    marketUser = result.user || null;
    if (!marketToken) throw new Error('服务器没有返回有效登录令牌');
    try { await loadMarketCapabilities(); } catch(e) { console.warn("[MARKET-AUTH] loadMarketCapabilities failed (non-fatal):", e.message); }
    try { await loadMarketCategories(); } catch(e) { console.warn("[MARKET-AUTH] loadMarketCategories failed (non-fatal):", e.message); }
    try { await syncMyMarketDeckMetadata(); } catch(e) { console.warn("[MARKET-AUTH] syncMyMarketDeckMetadata failed (non-fatal):", e.message); }
    try { await loadMarketDecks(); } catch(e) { console.warn("[MARKET-AUTH] loadMarketDecks failed (non-fatal):", e.message); }
    try { await loadMarketFavorites(); } catch(e) { console.warn("[MARKET-AUTH] loadMarketFavorites failed (non-fatal):", e.message); }
    const wasAppAuthLocked = appAuthLocked;
    marketUnlocked = true;
    setAppAuthLock(false);
    renderRailUserAvatar();
    try { await fetchServerProfile(); } catch(e) { console.warn("[MARKET-AUTH] fetchServerProfile failed (non-fatal):", e.message); }
    if (status) status.textContent = '服务器认证成功 · 已进入牌组市场';
    $('#marketAuthForm')?.classList.add('is-authenticated');
    await saveMarketLoginCredentials(username, password);
    if (isRegister) toggleMarketAuthMode();
    if (marketUser?.needsProfileCompletion) {
      view('library');
      showOnboarding();
      toast(isRegister ? '注册成功，请完成个人资料设置。' : '欢迎回来，请完成个人资料设置。');
    } else {
      if (wasAppAuthLocked || isAutoLogin) view('library');
      else if (!isAutoLogin || $('#marketView')?.classList.contains('active')) showMarketWorkspace();
      else renderMarket();
      toast(isRegister ? '注册成功，已登录应用。' : '服务器认证成功，应用已解锁。');
    }
  } catch (error) {
  console.error("[MARKET-AUTH] Login error:", error);
    marketToken = '';
    marketUnlocked = false;
    setAppAuthLock(true);
    if (status) status.textContent = '服务器认证失败';
    const errorBox = $('#marketLoginError');
    if (errorBox) {
      const rawMsg = error instanceof Error ? error.message : '无法连接牌组市场服务器';
      let cnMsg = rawMsg;
      cnMsg = cnMsg.replace(/Invalid market credentials/i, '服务器地址、账户名或密码不正确，请检查后重试。');
      cnMsg = cnMsg.replace(/Invalid server key/i, '服务器地址不正确，请检查后重试。');
      cnMsg = cnMsg.replace(/Username already taken/i, '该账户名已被注册，请更换其他账户名。');
      cnMsg = cnMsg.replace(/Invalid invitation code/i, '邀请码无效或已失效。');
      cnMsg = cnMsg.replace(/Self-registration is disabled/i, '当前服务器未开放自助注册。');
      cnMsg = cnMsg.replace(/Invalid registration data/i, '注册信息格式不正确，请检查账户名和密码长度。');
      cnMsg = cnMsg.replace(/Failed to fetch/i, '无法连接到服务器，请检查服务器地址和网络。');
      cnMsg = cnMsg.replace(/timeout|AbortError/i, '连接服务器超时，请检查服务器是否正常运行。');
      errorBox.textContent = cnMsg;
      errorBox.classList.add('is-visible');
    }
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
  let meta = profileDeckMeta(group);
  if (mode === 'update') {
    try {
      await syncMyMarketDeckMetadata();
      meta = profileDeckMeta(group);
    } catch (error) {
      console.warn('[MARKET-UPLOAD] Unable to refresh owned deck metadata:', error.message);
    }
  }
  const isUpdate = mode === 'update' && meta?.remoteId;
  $('#marketUploadTitle').textContent = isUpdate ? '更新牌组' : '上传牌组';
  $('#marketUploadDeckId').value = isUpdate ? meta.remoteId : '';
  $('#marketUploadGroup').value = group;
  $('#marketUploadName').value = group;
  $('#marketUploadDescription').value = meta?.description || `由 ${profileData().name || 'Knowledge Learner'} 分享的学习牌组。`;
  $('#marketUploadChangelog').value = meta?.changelog || '';
  $('#marketUploadModal').showModal();
}
async function submitMarketUpload(event) {
  event.preventDefault();
  if (!marketUnlocked || !marketToken) return toast('请先登录牌组市场。');
  const name = $('#marketUploadName').value.trim();
  const group = $('#marketUploadGroup').value.trim();
  const cards = profileGroupCards(group);
  if (!name || !cards.length) return toast('请确认牌组名称和卡片内容。');
  let meta = profileDeckMeta(group);
  const uid = getDeckUid(group);
  let deckId = $('#marketUploadDeckId').value.trim() || meta?.remoteId || '';

  // If no known remoteId, check the market for this deck UID
  if (!deckId) {
    try {
      const check = await marketApi(`/my-decks/check/${uid}`);
      if (check.exists && !check.owned) {
        return toast('此牌组 ID 已被其他用户占用，无法上传。');
      }
      if (check.exists && check.owned) {
        deckId = uid;
        meta = { ...meta, remoteId: uid, version: check.deck?.currentVersion || 0 };
      }
    } catch (error) {
      console.warn('[MARKET-UPLOAD] Deck ID check failed, proceeding as new:', error.message);
    }
  } else {
    // Existing remoteId — refresh metadata for version bump
    try {
      await syncMyMarketDeckMetadata();
      meta = profileDeckMeta(group);
      if (meta?.remoteId) { deckId = meta.remoteId; $('#marketUploadDeckId').value = deckId; }
    } catch (error) {
      console.warn('[MARKET-UPLOAD] Unable to refresh deck before update:', error.message);
    }
  }

  let version = deckId ? Number(meta?.version || 0) + 1 : 1;
  const submit = $('#marketUploadForm button[type="submit"]');
  if (submit) { submit.disabled = true; submit.textContent = '正在上传…'; }
  try {
    const changelog = $('#marketUploadChangelog').value.trim();
    let result;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        result = await window.reviewBridge.market.uploadDeck({ baseUrl: marketApiBase, token: marketToken, deckId, localDeckId: uid, title: name, description: $('#marketUploadDescription').value.trim(), changelog, version, tags: [], cards: cards.map((card) => marketCardPayload(card, group)) });
        if (!result?.ok) throw new Error(result?.error || '上传牌组失败。');
        break;
      } catch (error) {
        if (!deckId || attempt > 0 || !/deck not found|invalid.*uuid|牌组.*找不到|找不到 deck/i.test(error?.message || '')) throw error;
        await syncMyMarketDeckMetadata();
        const refreshed = profileDeckMeta(group);
        deckId = refreshed?.remoteId || '';
        if (!deckId) throw error;
        version = Number(refreshed?.version || 0) + 1;
      }
    }
    if (!result?.ok) throw new Error(result?.error || '上传牌组失败。');
    const next = { ...(meta || {}), group, name, remoteId: result.id || deckId || uid, version: Number(result.version || version), description: $('#marketUploadDescription').value.trim(), changelog, status: 'pending', updatedAt: new Date().toISOString() };
    const index = profileData().myDecks.findIndex((item) => item.group === group || item.name === group);
    if (index >= 0) profileData().myDecks[index] = next; else profileData().myDecks.push(next);
    save();
    $('#marketUploadModal').close();
    renderProfile();
    await loadMarketCategories();
    toast(deckId ? '牌组已上传更新，等待管理员审核。' : '牌组已上传，等待管理员审核。');
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
  if (deck.status === 'DISABLED') return `<button type="button" class="table-action" data-admin-deck-action="publish" data-admin-deck-id="${esc(deck.id)}">重新上架</button><button type="button" class="table-action danger" data-admin-deck-delete="${esc(deck.id)}">永久删除</button>`;
  const pending = deck.versions?.find((version) => version.status === 'PENDING');
  if (pending) return `<button type="button" class="table-action" data-admin-version-action="publish" data-admin-deck-id="${esc(deck.id)}" data-admin-version="${esc(pending.version)}">发布 v${pending.version}</button><button type="button" class="table-action danger" data-admin-version-action="reject" data-admin-deck-id="${esc(deck.id)}" data-admin-version="${esc(pending.version)}">拒绝</button>`;
  return `<button type="button" class="table-action" data-admin-deck-action="${deck.status === 'PUBLISHED' ? 'disable' : 'publish'}" data-admin-deck-id="${esc(deck.id)}">${deck.status === 'PUBLISHED' ? '下架' : '发布'}</button>`;
}
function adminCategoryOptions(current) {
  const options = [...new Set([current, ...marketCategories].filter(Boolean))];
  return options.map((category) => `<option value="${esc(category)}" ${category === current ? 'selected' : ''}>${esc(category)}</option>`).join('');
}
function adminDeckReviewMarkup(deck) {
  const latest = deck.versions?.[0];
  const author = deck.owner?.nickname || deck.owner?.username || '未知作者';
  const sizeBytes = Number(latest?.packageSize || 0);
  const sizeMB = sizeBytes > 0 ? (sizeBytes / 1024 / 1024).toFixed(2) + ' MB' : '—';
  const updated = deck.updatedAt ? formatMarketDate(deck.updatedAt) : '未知';
  return `<article class="admin-deck-review-card"><header class="admin-deck-review-card-head"><div class="admin-deck-review-identity"><span class="admin-deck-kicker">DECK REVIEW</span><h3>${esc(deck.title)}</h3><p>作者 ${esc(author)} · 文件大小 ${sizeMB} · 更新时间 ${esc(updated)}</p></div><span class="admin-review-count">牌组审核</span></header><div class="admin-deck-review-meta"><div><span>牌组状态</span><strong class="admin-deck-status ${esc(String(deck.status).toLowerCase())}">${esc(deck.status)}</strong></div><div><span>更新时间</span><strong>${esc(updated)}</strong></div></div><footer class="admin-deck-review-actions">${adminDeckActionMarkup(deck)}</footer></article>`;
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
  return `<tr data-admin-category-row="${category.id || ''}"><td><strong>${esc(category.name)}</strong><input class="admin-category-edit-input" value="${esc(category.name)}" maxlength="80" hidden /></td><td><span class="admin-deck-status ${esc(String(category.status).toLowerCase())}">${statusLabel}</span></td><td>${esc(category.createdBy?.username || (category.legacy ? '历史数据' : '用户提交'))}</td><td class="admin-action-cell">${actions.join('') || '<span class="muted-label">暂无操作</span>'}</td></tr>`;
}
function adminInvitationDate(value) {
  if (!value) return '永不过期';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN');
}
function adminInvitationCardMarkup(invitation) {
  const statusLabels = { ACTIVE: '可使用', USED: '已用尽', EXPIRED: '已过期', REVOKED: '已撤销' };
  const status = String(invitation.status || 'ACTIVE').toUpperCase();
  return `<article class="admin-invitation-card"><div class="admin-invitation-card-code"><code>${esc(invitation.code)}</code><span class="admin-deck-status ${esc(status.toLowerCase())}">${esc(statusLabels[status] || status)}</span></div><div class="admin-invitation-card-meta"><span>使用次数 <strong>${Number(invitation.currentUses || 0)} / ${Number(invitation.maxUses || 0)}</strong></span><span>过期时间 <strong>${esc(adminInvitationDate(invitation.expiresAt))}</strong></span><span>使用账户 <strong>${esc(invitation.usedBy?.username || '—')}</strong></span></div><div class="admin-invitation-card-actions"><button type="button" class="table-action" data-admin-invitation-copy="${esc(invitation.code)}">复制</button><button type="button" class="table-action danger" data-admin-invitation-delete="${esc(invitation.id)}">删除</button></div></article>`;
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
      ['audit', '操作日志', 'Audit log', 'i-list'],
      ['storage', '存储检查', 'Storage', 'i-panel'],
      ['invitations', '邀请码管理', 'Invitations', 'i-plus-circle']
    ];
    requiredTabs.forEach(([tab, label, subtitle, icon]) => {
      if (!adminNav.querySelector(`[data-admin-tab="${tab}"]`)) adminNav.insertAdjacentHTML('beforeend', `<button type="button" data-admin-tab="${tab}"><svg><use href="#${icon}"/></svg><span>${label}</span><small>${subtitle}</small></button>`);
    });
  }
  viewNode.querySelector('#adminBackMarketButton')?.remove();
  const titleMap = { users: ['许可用户', '创建、启用或停用牌组市场许可账户。'], decks: ['牌组审核', '审核用户上传的牌组并控制公开状态。'], audit: ['操作日志', '查询管理员、用户和牌组市场的关键操作。'], storage: ['存储检查', '确认数据库记录与服务器牌组文件保持一致。'], invitations: ['邀请码管理', '创建、复制和永久删除注册邀请码。'], categories: ['分类管理', '审核用户提交的分类并管理已有分类。'] };
  const [title, subtitle] = titleMap[adminActiveTab] || titleMap.users;
  $('#adminPageTitle').textContent = title;
  $('#adminPageSubtitle').textContent = subtitle;
  $$('.admin-nav [data-admin-tab]').forEach((button) => button.classList.toggle('active', button.dataset.adminTab === adminActiveTab));
  // Sync admin sidebar avatar and name with current profile / market session.
  const adminProfile = typeof profileData === 'function' ? profileData() : null;
  const adminAvatarImg = viewNode.querySelector('#adminAvatarImage');
  const adminAvatarFb = viewNode.querySelector('#adminAvatarFallback');
  const adminNameEl = viewNode.querySelector('#adminSidebarName');
  if (adminAvatarImg && adminAvatarFb) {
    const displayName = adminProfile?.name || marketUser?.username || 'Admin';
    if (adminProfile?.avatar) { adminAvatarImg.src = adminProfile.avatar; adminAvatarImg.hidden = false; adminAvatarFb.hidden = true; }
    else { adminAvatarImg.hidden = true; adminAvatarFb.hidden = false; adminAvatarFb.textContent = displayName.slice(0, 1).toUpperCase(); }
    if (adminNameEl) adminNameEl.textContent = displayName;
  }
  const content = $('#adminPageContent');
  // Bind navigation before awaiting remote data so a failed endpoint cannot freeze the workspace.
  bindAdminWorkspaceEvents();
  if (adminActiveTab === 'users') {
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
    content.innerHTML = `<section class="admin-section-card"><div class="admin-section-card-head"><div><span class="market-eyebrow">LICENSED ACCOUNTS</span><h2>许可用户</h2><p>普通用户必须启用后才能进入牌组市场。</p></div></div><form id="adminCreateUserForm" class="admin-create-form"><input id="adminNewUsername" required minlength="3" placeholder="账户名" /><input id="adminNewPassword" required minlength="8" type="password" placeholder="初始密码（至少 8 位）" /><button type="submit" class="primary">创建账户</button></form><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${page.items.map((user) => { const displayName = user.nickname || user.username; const avatarHtml = user.avatar ? `<img src="${esc(user.avatar)}" alt="" class="admin-user-avatar" />` : `<span class="admin-user-avatar-fallback">${esc(displayName.slice(0, 1).toUpperCase())}</span>`; return `<tr><td><div class="admin-user-cell">${avatarHtml}<div class="admin-user-info"><strong>${esc(displayName)}</strong><small>${esc(user.username)}</small></div></div></td><td><span class="admin-role">${esc(user.role)}</span></td><td><span class="admin-enabled ${user.enabled ? 'on' : 'off'}">${user.enabled ? '已启用' : '已停用'}</span></td><td>${esc(formatDateTime(user.createdAt))}</td><td class="admin-action-cell"><button type="button" class="table-action" data-admin-user-action="${user.enabled ? 'disable' : 'enable'}" data-admin-user-id="${esc(user.id)}">${user.enabled ? '停用' : '启用'}</button><button type="button" class="table-action" data-admin-user-reset="${esc(user.id)}" data-admin-user-name="${esc(user.nickname || user.username)}" title="重置密码">重置密码</button><button type="button" class="table-action danger" data-admin-user-delete="${esc(user.id)}" title="删除账户">删除</button></td></tr>`; }).join('')}</tbody></table></div>${adminPaginationMarkup('users', page)}</section>`;
  } else if (adminActiveTab === 'audit') {
    let result;
    try { result = await adminApi(`/admin/audit-logs?page=${adminPage.audit}&pageSize=${adminPageSize}`); } catch (error) {
      content.innerHTML = `<section class="admin-section-card admin-load-error"><h2>操作日志</h2><p>当前后端尚未提供日志查询接口，已有日志不会丢失。重启新版后端后即可查看。</p><button type="button" class="table-action" data-admin-retry="true">重新加载</button></section>`;
      bindAdminWorkspaceEvents();
      return;
    }
    if (renderToken !== adminRenderToken || activeTab !== adminActiveTab) return;
    adminTotalPages.audit = result.totalPages || 1;
    content.innerHTML = `<section class="admin-section-card"><div class="admin-section-card-head"><div><span class="market-eyebrow">AUDIT LOG</span><h2>操作日志</h2><p>管理员操作和市场访问事件会保留在服务器数据库中。</p></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>操作</th><th>用户</th><th>目标</th><th>时间</th></tr></thead><tbody>${(result.items || []).map((item) => `<tr><td><strong>${esc(item.action)}</strong></td><td>${esc(item.user?.username || 'system')}</td><td>${esc(item.targetId || '-')}</td><td>${esc(formatDateTime(item.createdAt))}</td></tr>`).join('') || '<tr><td colspan="4">暂无操作记录</td></tr>'}</tbody></table></div>${adminPaginationMarkup('audit', result)}</section>`;
  } else if (adminActiveTab === 'storage') {
    let result;
    try { result = await adminApi('/admin/storage/health'); } catch (error) {
      content.innerHTML = `<section class="admin-section-card admin-load-error"><h2>存储检查</h2><p>当前后端尚未提供存储检查接口。重启新版后端后即可检查数据库记录与服务器文件。</p><button type="button" class="table-action" data-admin-retry="true">重新加载</button></section>`;
      bindAdminWorkspaceEvents();
      return;
    }
    if (renderToken !== adminRenderToken || activeTab !== adminActiveTab) return;
    const refCount = Number(result.referencedCount || 0);
    const fileCount = Number(result.fileCount || 0);
    const missing = Array.isArray(result.missing) ? result.missing : [];
    const orphanFiles = Array.isArray(result.orphanFiles) ? result.orphanFiles : [];
    const temporary = Array.isArray(result.temporary) ? result.temporary : [];
    const quarantine = Array.isArray(result.quarantine) ? result.quarantine : [];
    content.innerHTML = `<section class="admin-section-card"><div class="admin-section-card-head"><div><span class="market-eyebrow">STORAGE HEALTH</span><h2>存储检查</h2><p>这里只清理服务器临时文件，不会删除用户本地数据。</p></div></div><div class="admin-stat-grid admin-stat-grid-compact"><article><span>数据库版本记录</span><strong>${refCount}</strong><small>应存在的牌组包</small></article><article><span>服务器文件</span><strong>${fileCount}</strong><small>扫描到的文件数</small></article><article><span>缺失文件</span><strong>${missing.length}</strong><small>${missing.length ? '需要修复' : '正常'}</small></article><article><span>孤立文件</span><strong>${orphanFiles.length}</strong><small>${orphanFiles.length ? '需要清理' : '正常'}</small></article></div><div class="admin-overview-actions"><button type="button" class="table-action" data-admin-storage-refresh="true">重新检查</button><button type="button" class="table-action danger" data-admin-storage-cleanup="true">清理临时文件</button></div><p class="admin-storage-detail">临时上传文件：${temporary.length} 个；删除隔离目录：${quarantine.length} 个。</p></section>`;
  } else if (adminActiveTab === 'invitations') {
    let result;
    try { result = await adminApi(`/v2/invitations?page=${adminPage.invitations}&pageSize=${adminPageSize}`); } catch (error) {
      content.innerHTML = `<section class="admin-section-card admin-load-error"><h2>邀请码暂时无法加载</h2><p>${esc(error.message || '请检查后端服务。')}</p><button type="button" class="table-action" data-admin-retry="true">重新加载</button></section>`;
      bindAdminWorkspaceEvents();
      return;
    }
    if (renderToken !== adminRenderToken || activeTab !== adminActiveTab) return;
    const page = { items: Array.isArray(result?.codes) ? result.codes : [], page: Number(result?.page || adminPage.invitations), totalPages: Number(result?.totalPages || 1), total: Number(result?.total || result?.codes?.length || 0) };
    adminTotalPages.invitations = page.totalPages;
    content.innerHTML = `<section class="admin-section-card"><div class="admin-section-card-head"><div><span class="market-eyebrow">REGISTRATION INVITATIONS</span><h2>邀请码管理</h2><p>邀请码只用于注册新账户，可限制使用次数并设置过期时间。</p></div></div><form id="adminCreateInvitationForm" class="admin-invitation-create-panel"><div class="form-field flex-1"><label>最大使用次数</label><input id="adminInvitationMaxUses" type="number" min="1" max="100000" value="1" required /></div><div class="form-field flex-fix"><label>过期时间</label><input id="adminInvitationExpiresAt" type="datetime-local" /></div><button type="submit">生成邀请码</button></form>${page.items.length ? `<div class="admin-invitation-cards">${page.items.map(adminInvitationCardMarkup).join('')}</div>` : `<div class="admin-invitation-empty"><svg><use href="#i-plus-circle"/></svg><strong>还没有邀请码</strong><span>在上方创建一个邀请码，分享给需要注册的用户。</span></div>`}${adminPaginationMarkup('invitations', page)}</section>`;
  } else if (adminActiveTab === 'categories') {
    let categories = [];
    try { const catResult = await adminApi('/admin/categories'); categories = Array.isArray(catResult) ? catResult : (catResult.categories || []); } catch (error) {
      content.innerHTML = `<section class="admin-section-card admin-load-error"><h2>分类管理暂时无法加载</h2><p>${esc(error.message || '请检查后端服务。')}</p><button type="button" class="table-action" data-admin-retry="true">重新加载</button></section>`;
      bindAdminWorkspaceEvents();
      return;
    }
    if (renderToken !== adminRenderToken || activeTab !== adminActiveTab) return;
    content.innerHTML = `<section class="admin-section-card"><div class="admin-section-card-head"><div><span class="market-eyebrow">CATEGORY REVIEW</span><h2>分类管理</h2><p>用户上传新分类后会先进入待审核状态，管理员创建的分类立即可用。删除前需要先迁移仍在使用中的牌组。</p></div></div><form id="adminCreateCategoryForm" class="admin-create-form"><input id="adminNewCategory" required maxlength="80" placeholder="新建公开分类" /><button type="submit" class="primary">创建分类</button></form><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>分类</th><th>状态</th><th>来源</th><th>操作</th></tr></thead><tbody>${categories.map(adminCategoryRowMarkup).join('') || '<tr><td colspan="4">暂无分类</td></tr>'}</tbody></table></div></section>`;
  } else if (adminActiveTab === 'decks') {
  let decksResult;
      try { const rawDecks = await adminApi(`/admin/decks?page=${adminPage.decks}&pageSize=${adminPageSize}`); decksResult = rawDecks.items ? rawDecks : { items: Array.isArray(rawDecks) ? rawDecks : (rawDecks.decks || []), page: rawDecks.page || 1, total: rawDecks.total || 0, totalPages: rawDecks.totalPages || 1 }; } catch (error) {
      content.innerHTML = `<section class="admin-section-card admin-load-error"><h2>牌组审核暂时无法加载</h2><p>${esc(error.message || '请检查后端服务。')}</p><button type="button" class="table-action" data-admin-retry="true">重新加载</button></section>`;
      bindAdminWorkspaceEvents();
      return;
    }
    if (renderToken !== adminRenderToken || activeTab !== adminActiveTab) return;
    const page = decksResult.items ? decksResult : adminPaginate(decksResult.decks || decksResult.items || [], adminPage.decks);
    adminTotalPages.decks = page.totalPages;
    content.innerHTML = `<section class="admin-section-card admin-deck-review-section"><div class="admin-section-card-head"><div><span class="market-eyebrow">DECK MODERATION</span><h2>牌组审核</h2><p>审核牌组版本和公开状态。待审核版本不会替换当前公开版本。</p></div><span class="admin-review-count">${page.total} 个牌组</span></div><div class="admin-deck-review-list">${page.items.map(adminDeckReviewMarkup).join('') || '<div class="admin-empty-state">暂无待处理牌组</div>'}</div>${adminPaginationMarkup('decks', page)}</section>`;
  }
  // Rebind controls created by the current render (tables, quick actions and retry buttons).
  bindAdminWorkspaceEvents();
}
// Reusable confirmation dialog — replaces window.confirm which is disabled in Electron.
function adminConfirm(message, title = '确认操作') {
  return new Promise((resolve) => {
    let dlg = document.getElementById('adminConfirmDialog');
    if (dlg) dlg.remove();
    dlg = document.createElement('dialog');
    dlg.id = 'adminConfirmDialog';
    dlg.className = 'modal password-change-modal';
    dlg.innerHTML = `<form method="dialog" class="modal-card password-change-card" id="adminConfirmForm"><div class="modal-header"><div><span class="modal-eyebrow">CONFIRM</span><h2>${esc(title)}</h2></div><button type="button" id="adminConfirmClose" class="dialog-close" title="关闭"><svg><use href="#i-x"/></svg></button></div><div class="password-fields"><p style="color:#4a5550;font-size:13px;line-height:1.6;margin:0">${esc(message)}</p></div><menu><button type="button" id="adminConfirmCancel">取消</button><button type="button" class="primary" id="adminConfirmOk">确认</button></menu></form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    const cleanup = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('#adminConfirmClose')?.addEventListener('click', () => { cleanup(); resolve(false); });
    dlg.querySelector('#adminConfirmCancel')?.addEventListener('click', () => { cleanup(); resolve(false); });
    dlg.querySelector('#adminConfirmOk')?.addEventListener('click', (e) => { e.preventDefault(); cleanup(); resolve(true); });
    dlg.querySelector('#adminConfirmForm')?.addEventListener('submit', (e) => { e.preventDefault(); cleanup(); resolve(true); });
    dlg.addEventListener('close', () => { if (document.body.contains(dlg)) { dlg.remove(); } resolve(false); });
  });
}
// Clipboard fallback — replaces window.prompt which is disabled in Electron.
function copyToClipboardFallback(text) {
  const input = document.createElement('input');
  input.value = text;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  try { document.execCommand('copy'); toast('已复制到剪贴板。'); } catch { toast('复制失败，请手动复制：' + text); }
  document.body.removeChild(input);
}
function bindAdminWorkspaceEvents() {
  $$('.admin-nav [data-admin-tab]').forEach((button) => button.onclick = () => { adminActiveTab = button.dataset.adminTab; renderAdminWorkspace(); });
  $$('[data-admin-go]').forEach((button) => button.onclick = () => { adminActiveTab = button.dataset.adminGo; renderAdminWorkspace(); });
  $$('[data-admin-page]').forEach((button) => button.onclick = () => { const kind = button.dataset.adminPage; adminPage[kind] = Number(button.dataset.page); renderAdminWorkspace(); });
  $$('[data-admin-retry]').forEach((button) => button.onclick = () => renderAdminWorkspace());
  $$('[data-admin-storage-refresh]').forEach((button) => button.onclick = async () => { button.disabled = true; try { const result = await adminApi('/admin/storage/health'); toast(result.healthy ? '存储检查通过。' : `发现 ${result.missing.length + result.orphanFiles.length} 个文件问题。`); await renderAdminWorkspace(); } catch (error) { toast(error.message || '存储检查失败。'); } finally { button.disabled = false; } });
  $$('[data-admin-storage-cleanup]').forEach((button) => button.onclick = async () => { if (!await adminConfirm('只清理超过 24 小时的临时上传文件，继续吗？', '清理临时文件')) return; button.disabled = true; try { const result = await adminApi('/admin/storage/cleanup', { method: 'POST', body: JSON.stringify({ olderThanHours: 24, removeOrphans: false, removeQuarantine: false }) }); toast(`已清理 ${result.removed.length} 个临时文件。`); await renderAdminWorkspace(); } catch (error) { toast(error.message || '清理失败。'); } finally { button.disabled = false; } });
  const createInvitationForm = $('#adminCreateInvitationForm');
  if (createInvitationForm) createInvitationForm.onsubmit = async (event) => {
    event.preventDefault();
    const submit = createInvitationForm.querySelector('button[type="submit"]');
    if (submit?.disabled) return;
    const maxUses = Number($('#adminInvitationMaxUses')?.value || 1);
    const expiresValue = $('#adminInvitationExpiresAt')?.value || '';
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100000) return toast('使用次数必须是 1 到 100000 之间的整数。');
    if (submit) submit.disabled = true;
    try {
      const body = { maxUses };
      if (expiresValue) body.expiresAt = new Date(expiresValue).toISOString();
      await adminApi('/v2/invitations', { method: 'POST', body: JSON.stringify(body) });
      toast('邀请码已生成。');
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '生成邀请码失败。');
    } finally {
      if (submit) submit.disabled = false;
    }
  };
  $$('[data-admin-invitation-copy]').forEach((button) => button.onclick = async () => {
    const code = button.dataset.adminInvitationCopy || '';
    try {
      await navigator.clipboard.writeText(code);
      toast('邀请码已复制。');
    } catch {
      copyToClipboardFallback(code);
    }
  });
  $$('[data-admin-invitation-delete]').forEach((button) => button.onclick = async () => {
    if (button.disabled || !await adminConfirm('删除后该邀请码及其记录将无法恢复，确定继续吗？', '删除邀请码')) return;
    button.disabled = true;
    try {
      await adminApi(`/v2/invitations/${encodeURIComponent(button.dataset.adminInvitationDelete)}`, { method: 'DELETE' });
      toast('邀请码已删除。');
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '撤销邀请码失败。');
      button.disabled = false;
    }
  });
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
    if (!submit || submit.disabled) return;
    submit.disabled = true;
    try {
      await adminApi('/admin/categories', { method: 'POST', body: JSON.stringify({ name: $('#adminNewCategory').value.trim() }) });
      toast('分类已创建并启用。');
      await loadMarketCategories();
      await renderAdminWorkspace();
    } catch (error) {
      toast(error.message || '创建分类失败。');
    } finally {
      if (submit) submit.disabled = false;
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
    if (button.disabled || !await adminConfirm(`确定删除分类”${button.dataset.adminCategoryName}”吗？`, '删除分类')) return;
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
    const deckId = button.dataset.adminDeckId;
    const currentCat = button.dataset.adminDeckCategory || '';
    let dlg = document.getElementById('adminCategoryDialog');
    if (dlg) dlg.remove();
    dlg = document.createElement('dialog');
    dlg.id = 'adminCategoryDialog';
    dlg.className = 'modal password-change-modal';
    dlg.innerHTML = `<form method="dialog" class="modal-card password-change-card" id="adminCategoryForm"><div class="modal-header"><div><span class="modal-eyebrow">DECK CATEGORY</span><h2>编辑牌组分类</h2><p class="modal-subtitle">为牌组设置或修改分类标签</p></div><button type="button" id="adminCategoryClose" class="dialog-close" title="关闭"><svg><use href="#i-x"/></svg></button></div><div class="password-fields"><label>分类名称<input id="adminCategoryInput" type="text" placeholder="输入分类名称" value="${esc(currentCat)}" /></label></div><menu><button type="button" id="adminCategoryCancel">取消</button><button type="button" class="primary" id="adminCategorySubmit">保存</button></menu></form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    const input = dlg.querySelector('#adminCategoryInput');
    if (input) { input.focus(); input.select(); }
    dlg.querySelector('#adminCategoryClose')?.addEventListener('click', () => dlg.close());
    dlg.querySelector('#adminCategoryCancel')?.addEventListener('click', () => dlg.close());
    dlg.querySelector('#adminCategorySubmit')?.addEventListener('click', async () => {
      const category = (dlg.querySelector('#adminCategoryInput')?.value || '').trim();
      if (!category) { toast('请输入分类名称。'); return; }
      const btn = dlg.querySelector('#adminCategorySubmit');
      btn.disabled = true;
      btn.textContent = '保存中…';
      try {
        await adminApi(`/admin/decks/${deckId}/category`, { method: 'PATCH', body: JSON.stringify({ category }) });
        toast('牌组分类已调整。');
        dlg.close();
        await loadMarketDecks();
        await renderAdminWorkspace();
      } catch (error) {
        toast(error.message || '调整牌组分类失败。');
      } finally {
        btn.disabled = false;
        btn.textContent = '保存';
      }
    });
    dlg.querySelector('#adminCategoryForm')?.addEventListener('submit', (e) => { e.preventDefault(); dlg.querySelector('#adminCategorySubmit')?.click(); });
  });
  $$('[data-admin-user-action]').forEach((button) => button.onclick = async () => { try { await adminApi(`/admin/users/${button.dataset.adminUserId}/${button.dataset.adminUserAction}`, { method: 'PATCH' }); renderAdminWorkspace(); } catch (error) { toast(error.message || '更新账户失败。'); } });
  $$('[data-admin-user-reset]').forEach((button) => button.onclick = async () => {
    const userId = button.dataset.adminUserReset;
    const userName = button.dataset.adminUserName || '该用户';
    let dlg = document.getElementById('adminResetPwdDialog');
    if (dlg) dlg.remove();
    dlg = document.createElement('dialog');
    dlg.id = 'adminResetPwdDialog';
    dlg.className = 'modal password-change-modal';
    dlg.innerHTML = `<form method="dialog" class="modal-card password-change-card" id="adminResetPwdForm"><div class="modal-header"><div><span class="modal-eyebrow">ADMIN ACTION</span><h2>重置密码</h2><p class="modal-subtitle">为账户「${esc(userName)}」设置新密码</p></div><button type="button" id="adminResetPwdClose" class="dialog-close" title="关闭"><svg><use href="#i-x"/></svg></button></div><div class="password-fields"><label>新密码<input id="adminResetPwdInput" type="password" autocomplete="new-password" placeholder="至少 8 个字符" minlength="8" /></label><label>确认新密码<input id="adminResetPwdConfirm" type="password" autocomplete="new-password" placeholder="再次输入新密码" /></label></div><menu><button type="button" id="adminResetPwdCancel">取消</button><button type="button" class="primary" id="adminResetPwdSubmit">重置密码</button></menu></form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('#adminResetPwdClose')?.addEventListener('click', () => dlg.close());
    dlg.querySelector('#adminResetPwdCancel')?.addEventListener('click', () => dlg.close());
    dlg.querySelector('#adminResetPwdSubmit')?.addEventListener('click', async () => {
      const newPwd = (dlg.querySelector('#adminResetPwdInput')?.value || '').trim();
      const confirmPwd = (dlg.querySelector('#adminResetPwdConfirm')?.value || '').trim();
      if (!newPwd || newPwd.length < 8) { toast('新密码至少需要 8 个字符。'); return; }
      if (newPwd !== confirmPwd) { toast('两次输入的密码不一致。'); return; }
      const btn = dlg.querySelector('#adminResetPwdSubmit');
      btn.disabled = true;
      btn.textContent = '重置中…';
      try {
        await adminApi(`/admin/users/${userId}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword: newPwd }) });
        toast(`「${userName}」的密码已重置。`);
        dlg.close();
      } catch (error) {
        toast(error.message || '重置密码失败。');
      } finally {
        btn.disabled = false;
        btn.textContent = '重置密码';
      }
    });
  });
  $$('[data-admin-user-delete]').forEach((button) => button.onclick = async () => { if (!await adminConfirm('确定要删除该账户吗？此操作不可撤销。', '删除账户')) return; try { await adminApi(`/admin/users/${button.dataset.adminUserDelete}`, { method: 'DELETE' }); toast('账户已删除。'); renderAdminWorkspace(); } catch (error) { toast(error.message || '删除账户失败。'); } });
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
    if (button.disabled || !await adminConfirm('永久删除后，服务器上的牌组、历史版本和下载记录都无法恢复。确定继续吗？', '永久删除牌组')) return;
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
  panel.innerHTML = `<div class="server-card"><div class="server-card-header"><span class="modal-eyebrow">MARKET SERVER</span><h2>牌组市场服务器</h2><p>当前连接的服务器地址。如需更换服务器，请退出登录后在登录页面修改。</p></div><div class="server-card-body"><label class="server-field"><span>当前服务器地址</span><input id="marketServerSettingsKey" type="text" autocomplete="off" spellcheck="false" placeholder="未配置" readonly /></label><p class="server-field-hint">服务器地址只能在登录页面修改。退出登录后即可重新输入服务器地址。</p><div class="server-actions"><button class="server-btn server-btn-test" id="marketServerTestButton" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>测试连接</button></div><div class="server-status" id="marketServerStatus"><span class="server-status-dot"></span>使用默认服务器</div></div></div><section class="server-account-section" id="marketSettingsAccountSection" hidden><div class="server-account-card"><div class="server-account-avatar" id="marketSettingsAccountAvatar"><span id="marketSettingsAccountFallback">K</span><img id="marketSettingsAccountImage" alt="" hidden /></div><div class="server-account-info"><strong id="marketSettingsAccountName">未登录</strong><span id="marketSettingsAccountRole">许可账户</span></div></div><div class="server-account-actions"><button type="button" class="server-account-btn" id="serverChangePasswordBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>修改密码</button><button type="button" class="server-account-btn server-account-logout" id="marketSettingsLogoutButton"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>退出登录</button></div></section>`;
  const input = $('#marketServerSettingsKey');
  $('#marketSettingsLogoutButton').addEventListener('click', logoutMarket);
  $('#serverChangePasswordBtn')?.addEventListener('click', openPasswordChangeDialog);
  renderMarketSettingsAccount();
  const status = $('#marketServerStatus');
  const displayUrl = (() => { try { const u = new URL(marketApiBase); return u.host + (u.pathname.replace(/\/api\/v1$/, '') || ''); } catch { return ''; } })();
  input.value = displayUrl || '默认服务器';
  const testHandler = async () => {
    const button = $('#marketServerTestButton');
    button.disabled = true;
    if (status) status.innerHTML = '<span class="server-status-dot testing"></span>正在测试服务器连接…';
    try {
      const testUrl = `${marketApiBase.replace(/\/api\/v1$/, '')}/health`;
      let health = null;
      let ok = false;
      let statusText = '';
      if (window.reviewBridge?.market?.fetch) {
        const result = await window.reviewBridge.market.fetch({ url: testUrl, options: { method: 'GET' } });
        if (result && result.status > 0) {
          ok = result.ok;
          health = typeof result.body === 'object' ? result.body : {};
          statusText = result.status;
        }
      }
      if (!health) {
        const response = await fetch(testUrl, { cache: 'no-store' });
        health = await response.json().catch(() => ({}));
        ok = response.ok;
        statusText = response.status;
      }
      if (!ok || !health?.ok) throw new Error(`服务器返回 ${statusText}`);
      if (status) status.innerHTML = '<span class="server-status-dot ok"></span>连接成功 · API ' + esc(health.apiVersion || '未知版本');
      toast('牌组市场服务器连接成功。');
    } catch (error) {
      if (status) status.innerHTML = '<span class="server-status-dot err"></span>连接失败：' + esc(error instanceof Error ? error.message : '无法连接服务器');
      toast('无法连接牌组市场服务器，请检查地址和服务状态。');
    } finally {
      button.disabled = false;
    }
  };
  $('#marketServerTestButton').addEventListener('click', testHandler);
}

function toggleMarketAuthMode() {
  var form = document.getElementById("marketAuthForm");
  var btn = document.getElementById("marketRegisterToggle");
  if (!form || !btn) return;
  ensureMarketRegistrationField();
  var isRegister = form.classList.toggle("is-register-mode");
  var field = document.getElementById('marketInvitationCode')?.closest('.market-registration-field');
  if (field) field.hidden = !isRegister;
  var title = document.querySelector('#marketAuthForm')?.closest('.market-login-form-container')?.querySelector('h1');
  var subtitle = document.querySelector('#marketAuthForm')?.closest('.market-login-form-container')?.querySelector('.market-form-header p');
  if (title) title.textContent = isRegister ? '创建市场账户' : '进入牌组市场';
  if (subtitle) subtitle.textContent = isRegister ? '使用管理员邀请码创建账户' : '请输入许可信息以浏览公开牌组';
  btn.textContent = isRegister ? '已有账户？返回登录' : '还没有账户？注册';
  document.querySelector('#marketAuthForm .market-character-submit span')?.replaceChildren(document.createTextNode(isRegister ? '注册并进入' : '验证并进入'));
  document.getElementById('marketLoginError')?.classList.remove('is-visible');
}

// ─── Server Profile Read/Write Chain ───
// Fetches the full profile from GET /api/v2/me/profile and merges into marketUser.
// Called after login to ensure nickname, bio, avatar come from the server (canonical source).
async function fetchServerProfile() {
  if (!marketToken || !marketUnlocked) return;
  try {
    const profile = await marketApi('/v2/me/profile');
    if (profile && typeof profile === 'object') {
      marketUser = {
        ...marketUser,
        nickname: profile.nickname || marketUser?.nickname || null,
        avatar: profile.avatar || marketUser?.avatar || null,
        bio: profile.bio || marketUser?.bio || null,
        uid: profile.uid || marketUser?.uid || null,
        status: profile.status || marketUser?.status || null,
      };
      // Sync server profile into local state so account switches show correct data
      const local = profileData();
      if (profile.nickname) local.name = profile.nickname;
      if (profile.bio) local.bio = profile.bio;
      if (profile.avatar) local.avatar = profile.avatar;
      else local.avatar = '';
      save();
      renderRailUserAvatar();
      renderMarketSettingsAccount();
      if (typeof renderProfile === 'function') renderProfile();
    }
  } catch (e) {
    console.warn('[SERVER-PROFILE] fetchServerProfile failed (non-fatal):', e.message);
  }
}

// ─── Post-Registration Onboarding ───
// Shows a modal for new users (status INCOMPLETE) to set nickname and avatar.
function showOnboarding() {
  const modal = $('#onboardingModal');
  if (!modal) return;
  const nicknameInput = $('#onboardingNickname');
  const bioInput = $('#onboardingBio');
  if (nicknameInput) nicknameInput.value = marketUser?.username || '';
  if (bioInput) bioInput.value = '';
  const img = $('#onboardingAvatarImage');
  const fallback = $('#onboardingAvatarFallback');
  if (img && fallback) { img.hidden = true; fallback.hidden = false; fallback.textContent = (marketUser?.username || 'K').slice(0, 1).toUpperCase(); }
  const form = $('#onboardingForm');
  if (form) delete form.dataset.avatar;
  modal.showModal();
  if (nicknameInput) nicknameInput.focus();
}

function handleOnboardingAvatar(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return toast('头像不能超过 2 MB。');
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || '');
    const img = $('#onboardingAvatarImage');
    const fallback = $('#onboardingAvatarFallback');
    if (img && fallback) { img.src = dataUrl; img.hidden = false; fallback.hidden = true; }
    const form = $('#onboardingForm');
    if (form) form.dataset.avatar = dataUrl;
  };
  reader.readAsDataURL(file);
}

async function submitOnboarding(event) {
  event.preventDefault();
  const nickname = $('#onboardingNickname')?.value.trim();
  if (!nickname) return toast('请输入昵称。');
  const submit = $('#onboardingForm button[type="submit"]');
  if (submit) { submit.disabled = true; submit.textContent = '完成中…'; }
  try {
    const body = { nickname };
    const bio = $('#onboardingBio')?.value.trim();
    if (bio) body.bio = bio;
    const avatar = $('#onboardingForm')?.dataset.avatar;
    if (avatar) body.avatar = avatar;
    const result = await marketApi('/v2/me/profile', { method: 'POST', body: JSON.stringify(body) });
    marketUser = { ...marketUser, ...result, needsProfileCompletion: false };
    const localProfile = profileData();
    localProfile.name = nickname;
    if (bio) localProfile.bio = bio;
    if (avatar) localProfile.avatar = avatar;
    save();
    $('#onboardingModal')?.close();
    renderRailUserAvatar();
    renderMarketSettingsAccount();
    if (typeof renderProfile === 'function') renderProfile();
    toast('个人资料设置完成，欢迎加入！');
  } catch (err) {
    toast('资料设置失败：' + (err.message || '未知错误'));
  } finally {
    if (submit) { submit.disabled = false; submit.textContent = '完成'; }
  }
}
