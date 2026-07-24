/**
 * kr-profile.js - Profile editing, avatar, deck management
 * Dependencies: kr-core.js, kr-state.js, kr-market.js
 * Provides: renderProfile, profileData, profileGroups, openProfileEditor,
 *           saveProfile, handleProfileAvatar, handleProfileDeckAction,
 *           openMessages, renderMessages
 */
let profileDeckPage = 1;
const profileDeckPageSize = 8;
function safeFormatDate(value) {
  if (!value) return '未知';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '未知';
  return d.toLocaleDateString('zh-CN');
}
function renderProfile() {
  const profile = profileData();
  const name = (typeof marketUser !== 'undefined' && marketUser?.nickname) || profile.name || 'Knowledge Learner';
  const bio = (typeof marketUser !== 'undefined' && marketUser?.bio) || profile.bio || '';
  const groups = profileGroups();
  const cardCount = groups.reduce((sum, group) => sum + profileGroupCards(group).length, 0);
  const avatar = $('#profileAvatarImage');
  const fallback = $('#profileAvatarFallback');
  $('#profileDisplayName') && ($('#profileDisplayName').textContent = name);
  $('#profileProfileHint') && ($('#profileProfileHint').textContent = bio || '你的公开名称会显示在牌组市场的作者信息中。');
  $('#profileDeckCount') && ($('#profileDeckCount').textContent = groups.length);
  $('#profileCardCount') && ($('#profileCardCount').textContent = cardCount);
  const myUploadedDecks = (profileData().myDecks || []).filter((d) => d.remoteId);
  $('#profilePublishedCount') && ($('#profilePublishedCount').textContent = myUploadedDecks.length);
  if (avatar && fallback) { const avatarSrc = profile.avatar || (typeof marketUser !== 'undefined' ? marketUser?.avatar : null); avatar.hidden = !avatarSrc; fallback.hidden = Boolean(avatarSrc); if (avatarSrc) avatar.src = avatarSrc; else fallback.textContent = name.slice(0, 1).toUpperCase(); }
  renderRailUserAvatar();
  renderMarketSettingsAccount();
  const list = $('#profileDeckList');
  if (!list) return;
  const totalPages = Math.max(1, Math.ceil(groups.length / profileDeckPageSize));
  if (profileDeckPage > totalPages) profileDeckPage = totalPages;
  if (profileDeckPage < 1) profileDeckPage = 1;
  const startIdx = (profileDeckPage - 1) * profileDeckPageSize;
  const pageGroups = groups.slice(startIdx, startIdx + profileDeckPageSize);
  list.innerHTML = pageGroups.length ? pageGroups.map((group, index) => { const cards = profileGroupCards(group); const meta = profileDeckMeta(group); const uploaded = Boolean(meta?.remoteId); const published = uploaded && meta.status === 'PUBLISHED'; const updatedLabel = uploaded ? `更新于 ${safeFormatDate(meta.updatedAt)}` : '当前本地卡组'; const actions = published ? `<button type="button" data-profile-deck-action="sync" data-profile-deck-id="${esc(group)}">同步</button><button type="button" data-profile-deck-action="unpublish" data-profile-deck-id="${esc(group)}">下架</button>` : `<button type="button" data-profile-deck-action="upload" data-profile-deck-id="${esc(group)}">上传</button>`; return `<article class="profile-deck-item"><div class="profile-deck-icon" style="--deck-color:${['#e7f3ed', '#eef0ff', '#fff2df'][(startIdx + index) % 3]};--deck-accent:${['#2f7d64', '#625bd7', '#c97824'][(startIdx + index) % 3]}"><svg><use href="#i-layers"></use></svg></div><div class="profile-deck-info"><div class="profile-deck-title"><h3>${esc(group)}</h3><span class="profile-deck-status ${published ? 'published' : ''}">${uploaded ? (published ? '已公开' : '已提交') : '本地卡组'}</span></div><p>与卡片管理页面共享数据源，卡片和复习状态保持同步。</p><div class="profile-deck-meta"><span>${cards.length} 张卡片</span><span>${updatedLabel}</span></div></div><div class="profile-deck-actions"><button type="button" data-profile-deck-action="edit" data-profile-deck-id="${esc(group)}">编辑</button><button type="button" data-profile-deck-action="view" data-profile-deck-id="${esc(group)}">查看</button>${actions}</div></article>`; }).join('') : '<div class="profile-empty"><div class="profile-empty-icon"><svg><use href="#i-layers"></use></svg></div><strong>还没有我的牌组</strong><span>请先在卡片管理页面创建卡组并添加卡片。</span></div>';
  const pager = $('#profileDeckPagination');
  if (pager) {
    pager.hidden = totalPages <= 1;
    pager.innerHTML = totalPages <= 1 ? '' : `<span>第 ${profileDeckPage} / ${totalPages} 页 · 共 ${groups.length} 个牌组</span><div><button type="button" data-profile-deck-page="${profileDeckPage - 1}" ${profileDeckPage <= 1 ? 'disabled' : ''}>上一页</button><button type="button" data-profile-deck-page="${profileDeckPage + 1}" ${profileDeckPage >= totalPages ? 'disabled' : ''}>下一页</button></div>`;
  }
}
function renderRailUserAvatar() {
  const profile = typeof profileData === 'function' && state ? profileData() : null;
  const image = $('#railUserAvatarImage');
  const fallback = $('#railUserAvatarFallback');
  if (!image || !fallback) return;
  const name = (typeof marketUser !== 'undefined' && marketUser?.nickname) || profile?.name || (typeof marketUser !== 'undefined' ? marketUser?.username : null) || 'K';
  const avatar = profile?.avatar || (typeof marketUser !== 'undefined' ? marketUser?.avatar : null);
  if (avatar) {
    image.src = avatar;
    image.hidden = false;
    fallback.hidden = true;
  } else {
    image.hidden = true;
    fallback.hidden = false;
    fallback.textContent = name.slice(0, 1).toUpperCase();
  }
}
async function uploadProfileDeck() {
  const file = await window.reviewBridge.openCardsFile();
  if (!file || !file.content.trim()) return;
  try {
    const parsed = file.extension === '.json' ? (Array.isArray(JSON.parse(file.content)) ? JSON.parse(file.content) : [JSON.parse(file.content)]).map(normCard) : parseMarkdownCards(file.content);
    const valid = parsed.filter((card) => card.question && (card.type === 'note' ? card.noteContent : card.answer.length));
    if (!valid.length) return toast('文件格式或字段不完整，无法建立牌组。');
    const name = file.name.replace(/\.(json|md|markdown)$/i, '') || '未命名牌组';
    const deck = { id: id('my-deck'), name, description: '从本地文件导入的待上传牌组。', cardCount: valid.length, cardIds: [], status: 'draft', updatedAt: new Date().toLocaleDateString('zh-CN'), color: '#e7f3ed', accent: '#2f7d64' };
    profileData().myDecks.push(deck);
    save();
    renderProfile();
    toast(`已添加“${name}”，当前仅保存为我的牌组草稿，未写入本地复习卡片。`);
  } catch { toast('无法解析牌组文件。'); }
}
function openProfileEditor() {
  const profile = profileData();
  const serverNickname = (typeof marketUser !== 'undefined' && marketUser?.nickname) || '';
  const serverBio = (typeof marketUser !== 'undefined' && marketUser?.bio) || '';
  $('#profileNameInput').value = serverNickname || profile.name || '';
  $('#profileBioInput').value = serverBio || profile.bio || '';
  $('#profileEditModal').showModal();
  $('#profileNameInput').focus();
}
async function saveProfile(event) {
  event.preventDefault();
  const profile = profileData();
  const name = $('#profileNameInput').value.trim();
  if (!name) return toast('请输入名称。');
  const bio = $('#profileBioInput').value.trim();
  profile.name = name;
  profile.bio = bio;
  save();
  // Update marketUser immediately so renderProfile shows the new nickname
  if (typeof marketUser !== 'undefined') {
    marketUser = { ...marketUser, nickname: name, bio, avatar: profile.avatar || marketUser?.avatar };
  }
  $('#profileEditModal').close();
  renderProfile();
  if (marketUnlocked) {
    renderMarketAccountMenu();
    try {
      const body = { nickname: name };
      if (bio !== undefined) body.bio = bio;
      if (profile.avatar) body.avatar = profile.avatar;
      await marketApi('/v2/me/profile', { method: 'PATCH', body: JSON.stringify(body) });
      renderRailUserAvatar();
      renderMarketSettingsAccount();
      renderProfile();
      toast('个人资料已保存并同步到服务器。');
    } catch (err) {
      console.warn('[PROFILE] Server sync failed:', err.message);
      toast('资料已保存在本地，但服务器同步失败。');
    }
  } else {
    toast('个人资料已保存。');
  }
}
function handleProfileAvatar(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return toast('头像不能超过 2 MB。');
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = String(reader.result || '');
    profileData().avatar = dataUrl;
    save();
    renderProfile();
    toast('头像已更新。');
    if (typeof marketUnlocked !== 'undefined' && marketUnlocked) {
      try {
        await marketApi('/v2/me/profile', { method: 'PATCH', body: JSON.stringify({ avatar: dataUrl }) });
        if (typeof marketUser !== 'undefined') marketUser = { ...marketUser, avatar: dataUrl };
        renderRailUserAvatar();
        renderMarketSettingsAccount();
        toast('头像已同步到服务器。');
      } catch (err) {
        console.warn('[PROFILE] Avatar server sync failed:', err.message);
        toast('头像已保存在本地，但服务器同步失败。');
      }
    }
  };
  reader.readAsDataURL(file);
}
// Keep profile actions wired to the market without replacing the local deck source.
function handleProfileDeckAction(event) {
  try {
    const button = event.target.closest('[data-profile-deck-action]');
    if (!button) return;
    const group = button.dataset.profileDeckId;
    if (!profileGroups().includes(group)) return;
    const action = button.dataset.profileDeckAction;
    if (action === 'edit') { openRenameGroup(group); return; }
    if (action === 'view') { view('cards'); els.folderFilter.value = group; syncCustomSelect(els.folderFilter); renderCards(true); return; }
    if (action === 'sync') { syncProfileDeckFromPublic(group, button); return; }
    if (action === 'unpublish') { unpublishProfileDeck(group, button); return; }
    openMarketUpload(group, action === 'update' ? 'update' : 'create');
  } catch (err) {
    console.error('[PROFILE-DECK-ACTION] Error:', err);
    toast('操作失败：' + err.message);
  }
}
async function syncProfileDeckFromPublic(group, button) {
  const meta = profileDeckMeta(group);
  if (!meta?.remoteId) return toast('该牌组尚未上传，无法同步。');
  if (!marketUnlocked || !marketToken) return toast('请先登录牌组市场。');
  if (button) { button.disabled = true; button.textContent = '同步中…'; }
  try {
    await syncMyMarketDeckMetadata();
    const freshMeta = profileDeckMeta(group) || meta;
    const result = await window.reviewBridge.market.downloadDeck({ baseUrl: marketApiBase, token: marketToken, deckId: freshMeta.remoteId, version: freshMeta.version });
    if (!result?.ok) throw new Error(result?.error || '下载牌组失败。');
    const imported = importMarketCards({ id: freshMeta.remoteId, title: group }, result, group);
    toast(imported.skipped ? `已新增 ${imported.count} 张卡片，${imported.skipped} 张已存在跳过。` : (imported.count ? `已新增 ${imported.count} 张卡片。` : '本地已是最新，无需同步。'));
    renderProfile();
  } catch (error) {
    toast(error instanceof Error ? error.message : '同步牌组失败。');
  } finally {
    if (button) { button.disabled = false; button.textContent = '同步'; }
  }
}
async function unpublishProfileDeck(group, button) {
  const meta = profileDeckMeta(group);
  if (!meta?.remoteId) return toast('该牌组尚未上传。');
  if (meta.status !== 'PUBLISHED') return toast('只有已公开的牌组才能下架。');
  if (!marketUnlocked || !marketToken) return toast('请先登录牌组市场。');
  if (button) { button.disabled = true; button.textContent = '下架中…'; }
  try {
    await marketApi(`/my-decks/${meta.remoteId}/unpublish`, { method: 'PATCH' });
    await syncMyMarketDeckMetadata();
    renderProfile();
    toast('牌组已下架，不再公开展示。');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[UNPUBLISH] Failed:', { remoteId: meta.remoteId, error: msg });
    if (/not found|404/i.test(msg)) {
      toast('下架失败：服务器未找到该接口或牌组，请确认后端服务已重启并包含最新代码。');
    } else {
      toast('下架牌组失败：' + msg);
    }
  } finally {
    if (button) { button.disabled = false; button.textContent = '下架'; }
  }
}

let messagesTab = 'mine';
let messagesCache = { mine: null, incoming: null };
async function openMessages() {
  $('#messagesModal').showModal();
  messagesTab = 'mine';
  messagesCache = { mine: null, incoming: null };
  document.querySelectorAll('.messages-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.messagesTab === 'mine'));
  $('#messagesBody').innerHTML = '<div class="messages-loading">加载中…</div>';
  await Promise.all([loadMyContributions(), loadIncomingContributions()]);
  renderMessagesTab();
}
async function loadMyContributions() {
  try {
    const result = await marketApi('/v2/my-contributions');
    messagesCache.mine = Array.isArray(result) ? result : [];
  } catch (err) {
    messagesCache.mine = [];
    console.error('[MESSAGES] loadMyContributions:', err);
  }
}
async function loadIncomingContributions() {
  try {
    const result = await marketApi('/v2/my-incoming-contributions');
    messagesCache.incoming = Array.isArray(result) ? result : [];
  } catch (err) {
    messagesCache.incoming = [];
    console.error('[MESSAGES] loadIncomingContributions:', err);
  }
}
function renderMessagesTab() {
  const body = $('#messagesBody');
  if (!body) return;
  const list = messagesCache[messagesTab] || [];
  if (!list.length) {
    body.innerHTML = `<div class="messages-empty"><div class="messages-empty-icon"><svg><use href="#i-mail"></use></svg></div><strong>${messagesTab === 'mine' ? '还没有推送记录' : '没有待审核的推送'}</strong><span>${messagesTab === 'mine' ? '在卡片库选中卡片后推送，这里会显示审核状态。' : '其他人向你牌组推送的卡片会显示在这里。'}</span></div>`;
    return;
  }
  body.innerHTML = list.map((item) => {
    const status = item.status || 'PENDING';
    const statusLabel = { PENDING: '待审核', APPROVED: '已采纳', REJECTED: '已拒绝' }[status] || status;
    const statusClass = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' }[status] || '';
    const date = safeFormatDate(item.createdAt || item.updatedAt);
    const deckTitle = esc(item.deck?.title || '未知牌组');
    if (messagesTab === 'mine') {
      const note = item.reviewNote ? `<div class="msg-item-note">审核意见：${esc(item.reviewNote)}</div>` : '';
      const cardQ = esc(String(item.cardData?.question || item.cardId || '').slice(0, 100));
      return `<div class="msg-item ${statusClass}"><div class="msg-item-header"><span class="msg-item-status ${statusClass}">${statusLabel}</span><span class="msg-item-deck">${deckTitle}</span><span class="msg-item-date">${date}</span></div><div class="msg-item-question">${cardQ}</div>${note}</div>`;
    } else {
      const contributor = esc(item.contributor?.nickname || item.contributor?.username || '匿名用户');
      const cardQ = esc(String(item.cardData?.question || item.cardId || '').slice(0, 100));
      return `<div class="msg-item ${statusClass}"><div class="msg-item-header"><span class="msg-item-status ${statusClass}">${statusLabel}</span><span class="msg-item-deck">${deckTitle}</span><span class="msg-item-date">${date}</span></div><div class="msg-item-question">${cardQ}</div><div class="msg-item-note">来自：${contributor}</div></div>`;
    }
  }).join('');
}
function switchMessagesTab(tab) {
  messagesTab = tab;
  document.querySelectorAll('.messages-tab').forEach((t) => t.classList.toggle('active', t.dataset.messagesTab === tab));
  renderMessagesTab();
}
