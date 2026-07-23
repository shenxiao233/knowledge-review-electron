/**
 * kr-profile.js - Profile editing, avatar, deck management
 * Dependencies: kr-core.js, kr-state.js, kr-market.js
 * Provides: renderProfile, profileData, profileGroups, openProfileEditor,
 *           saveProfile, handleProfileAvatar, handleProfileDeckAction
 */
function renderProfile() {
  const profile = profileData();
  const name = profile.name || 'Knowledge Learner';
  const groups = profileGroups();
  const cardCount = groups.reduce((sum, group) => sum + profileGroupCards(group).length, 0);
  const avatar = $('#profileAvatarImage');
  const fallback = $('#profileAvatarFallback');
  $('#profileDisplayName') && ($('#profileDisplayName').textContent = name);
  $('#profileProfileHint') && ($('#profileProfileHint').textContent = profile.bio || '你的公开名称会显示在牌组市场的作者信息中。');
  $('#profileDeckCount') && ($('#profileDeckCount').textContent = groups.length);
  $('#profileCardCount') && ($('#profileCardCount').textContent = cardCount);
  $('#profilePublishedCount') && ($('#profilePublishedCount').textContent = groups.filter((group) => profile.publishedGroups?.[group]).length);
  if (avatar && fallback) { avatar.hidden = !profile.avatar; fallback.hidden = Boolean(profile.avatar); if (profile.avatar) avatar.src = profile.avatar; else fallback.textContent = name.slice(0, 1).toUpperCase(); }
  renderRailUserAvatar();
  renderMarketSettingsAccount();
  const list = $('#profileDeckList');
  if (!list) return;
  list.innerHTML = groups.length ? groups.map((group, index) => { const cards = profileGroupCards(group); const meta = profileDeckMeta(group); const uploaded = Boolean(meta?.remoteId); const published = uploaded && meta.status === 'PUBLISHED'; return `<article class="profile-deck-item"><div class="profile-deck-icon" style="--deck-color:${['#e7f3ed', '#eef0ff', '#fff2df'][index % 3]};--deck-accent:${['#2f7d64', '#625bd7', '#c97824'][index % 3]}"><svg><use href="#i-layers"></use></svg></div><div class="profile-deck-info"><div class="profile-deck-title"><h3>${esc(group)}</h3><span class="profile-deck-status ${published ? 'published' : ''}">${uploaded ? (published ? '已公开' : '已提交') : '本地卡组'}</span></div><p>与卡片管理页面共享数据源，卡片和复习状态保持同步。</p><div class="profile-deck-meta"><span>${cards.length} 张卡片</span><span>${uploaded ? `远程 v${meta.version || 0}` : '当前本地卡组'}</span></div></div><div class="profile-deck-actions"><button type="button" data-profile-deck-action="edit" data-profile-deck-id="${esc(group)}">编辑</button><button type="button" data-profile-deck-action="view" data-profile-deck-id="${esc(group)}">查看</button>${uploaded ? `<button type="button" data-profile-deck-action="update" data-profile-deck-id="${esc(group)}">更新</button>` : `<button type="button" data-profile-deck-action="upload" data-profile-deck-id="${esc(group)}">上传</button>`}</div></article>`; }).join('') : '<div class="profile-empty"><div class="profile-empty-icon"><svg><use href="#i-layers"></use></svg></div><strong>还没有我的牌组</strong><span>请先在卡片管理页面创建卡组并添加卡片。</span></div>';
}
function renderRailUserAvatar() {
  const profile = typeof profileData === 'function' && state ? profileData() : null;
  const image = $('#railUserAvatarImage');
  const fallback = $('#railUserAvatarFallback');
  if (!image || !fallback) return;
  const name = profile?.name || marketUser?.username || 'K';
  if (profile?.avatar) {
    image.src = profile.avatar;
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
  $('#profileNameInput').value = profile.name || '';
  $('#profileBioInput').value = profile.bio || '';
  $('#profileEditModal').showModal();
  $('#profileNameInput').focus();
}
function saveProfile(event) { event.preventDefault(); const profile = profileData(); const name = $('#profileNameInput').value.trim(); if (!name) return toast('请输入名称。'); profile.name = name; profile.bio = $('#profileBioInput').value.trim(); save(); $('#profileEditModal').close(); renderProfile(); if (marketUnlocked) renderMarketAccountMenu(); toast('个人资料已保存。'); }
function handleProfileAvatar(event) { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) return toast('头像不能超过 2 MB。'); const reader = new FileReader(); reader.onload = () => { profileData().avatar = String(reader.result || ''); save(); renderProfile(); toast('头像已更新。'); }; reader.readAsDataURL(file); }
// Keep profile actions wired to the market without replacing the local deck source.
function handleProfileDeckAction(event) { const button = event.target.closest('[data-profile-deck-action]'); if (!button) return; const group = button.dataset.profileDeckId; if (!profileGroups().includes(group)) return; const action = button.dataset.profileDeckAction; if (action === 'edit') { openRenameGroup(group); return; } if (action === 'view') { view('cards'); els.folderFilter.value = group; syncCustomSelect(els.folderFilter); renderCards(true); return; } openMarketUpload(group, action === 'update' ? 'update' : 'create'); }
