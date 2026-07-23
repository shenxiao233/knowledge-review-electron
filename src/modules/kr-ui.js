/**
 * kr-ui.js - View switching, event binding, UI utilities, WebDAV, keydown
 * Dependencies: All other modules
 * Provides: bind, enhanceSelectsPortal, syncCustomSelect, ensureToolbarPalettes,
 *           confirmDeleteCardGroup, WebDAV backup functions,
 *           keydown handler, init
 */
function toggleBatchCardMode() { batchCardMode = !batchCardMode; const button = $('#batchModeButton'); button?.classList.toggle('active', batchCardMode); button.textContent = batchCardMode ? '批量制卡中' : '批量制卡'; els.cardModal?.classList.toggle('batch-mode', batchCardMode); }
function closeSelectMenus(except = null) { $$('.select-shell.open').filter((shell) => shell !== except && !shell.matches(':hover') && !(shell._selectMenu && shell._selectMenu.matches(':hover'))).forEach((shell) => { shell.classList.remove('open'); shell.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false'); shell._selectMenu?.classList.remove('portal-open'); }); }
function positionSelectMenu(trigger, menu, select) { const rect = trigger.getBoundingClientRect(); const width = Math.max(rect.width, select.id === 'blockFormat' ? 96 : 120); const height = Math.min(300, Math.max(40, select.options.length * 36 + 10)); const above = rect.bottom + height + 7 > window.innerHeight && rect.top > height + 7; menu.style.minWidth = `${width}px`; menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`; menu.style.top = `${above ? Math.max(8, rect.top - height - 7) : rect.bottom + 7}px`; }
function enhanceSelectsPortal() { $$$('select').forEach((select) => { if (select.parentElement?.classList.contains('select-shell')) return; const shell = document.createElement('div'); shell.className = `select-shell${select.closest('.formatbar') ? ' format-select-shell' : ''}`; select.parentNode.insertBefore(shell, select); shell.appendChild(select); const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', select.title || select.getAttribute('aria-label') || '选择'); const menu = document.createElement('div'); menu.className = `select-menu select-menu-portal${select.closest('.formatbar') ? ' format-toolbar-menu' : ''}`; menu.dataset.selectId = select.id; menu.setAttribute('role', 'listbox'); shell.appendChild(trigger); const owner = select.closest('dialog') || document.body; owner.appendChild(menu); shell._selectMenu = menu; select._selectMenu = menu; trigger.addEventListener('click', (event) => { event.stopPropagation(); const open = !shell.classList.contains('open'); closeSelectMenus(shell); shell.classList.toggle('open', open); trigger.setAttribute('aria-expanded', String(open)); menu.classList.toggle('portal-open', open); if (open) positionSelectMenu(trigger, menu, select); }); menu.addEventListener('click', (event) => { const option = event.target.closest('[data-option]'); if (!option) return; select.value = option.dataset.option; select.dispatchEvent(new Event('change', { bubbles: true })); shell.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); menu.classList.remove('portal-open'); }); if (select.closest('.card-library-toolbar')) { shell.addEventListener('mouseenter', () => { closeSelectMenus(shell); shell.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); menu.classList.add('portal-open'); positionSelectMenu(trigger, menu, select); }); shell.addEventListener('mouseleave', () => { setTimeout(() => { if (!shell.matches(':hover') && !menu.matches(':hover')) closeSelectMenus(); }, 80); }); menu.addEventListener('mouseenter', () => { shell.classList.add('open'); menu.classList.add('portal-open'); }); menu.addEventListener('mouseleave', () => { if (!shell.matches(':hover')) closeSelectMenus(); }); } select.addEventListener('change', () => syncCustomSelect(select)); syncCustomSelect(select); }); document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('close', () => closeSelectMenus())); document.addEventListener('click', (event) => { if (!event.target.closest('.select-shell') && !event.target.closest('.select-menu-portal') && !event.target.closest('.toolbar-palette-wrap')) closeSelectMenus(); closeToolbarPalettes(event.target.closest('.toolbar-palette-wrap')); }); window.addEventListener('resize', () => { const shell = $('.select-shell.open'); if (shell?._selectMenu) positionSelectMenu(shell.querySelector('.select-trigger'), shell._selectMenu, shell.querySelector('select')); }); window.addEventListener('scroll', () => { const shell = $('.select-shell.open'); if (shell?._selectMenu) positionSelectMenu(shell.querySelector('.select-trigger'), shell._selectMenu, shell.querySelector('select')); }, true); }
function syncCustomSelect(select) { const shell = select?.parentElement?.classList.contains('select-shell') ? select.parentElement : null; if (!shell) return; const trigger = shell.querySelector('.select-trigger'); const menu = select._selectMenu || shell._selectMenu || shell.querySelector('.select-menu'); if (!menu) return; const options = [...select.options]; trigger.textContent = options.find((option) => option.value === select.value)?.textContent || select.value || ''; menu.innerHTML = options.map((option) => `<button type="button" role="option" data-option="${esc(option.value)}" class="${option.value === select.value ? 'selected' : ''}">${esc(option.textContent)}</button>`).join(''); }
function ensureToolbarPalettes() {
  const colors = [
    '#202321', '#59605c', '#a5aaa7', '#e2e5e3', '#ffffff',
    '#d93847', '#ec7e31', '#e0ae29', '#5b9c42', '#2d9e9f', '#397fd5', '#5f58c8', '#a15ac8',
    '#f0a3aa', '#f3bd91', '#f1d58b', '#badc91', '#91d5d0', '#9fc5ea', '#b9b5ed', '#d8a6d1',
    '#9e2030', '#b95619', '#ac8011', '#3e752d', '#157879', '#2168ae', '#3e399f', '#7d347f'
  ];
  const gradients = [
    'linear-gradient(90deg,#2d55e8,#24c6dc)',
    'linear-gradient(90deg,#7047d9,#e23f9d)',
    'linear-gradient(90deg,#f23771,#ffb122)',
    'linear-gradient(90deg,#e84231,#f38c14)'
  ];
  const gradientValues = ['#2d55e8', '#7047d9', '#f23771', '#e84231'];
  const recentColors = [];
  let pickerCommand = '';
  let picker = document.getElementById('toolbarColorPicker');
  if (!picker) {
    picker = document.createElement('input');
    picker.type = 'color';
    picker.id = 'toolbarColorPicker';
    picker.tabIndex = -1;
    picker.setAttribute('aria-hidden', 'true');
    document.body.appendChild(picker);
  }
  const renderRecent = (box) => {
    const recent = box.querySelector('.palette-recent');
    if (!recent) return;
    recent.innerHTML = recentColors.length
      ? recentColors.map((color) => `<button type="button" class="palette-color palette-recent-color" style="--swatch:${color}" data-palette-command="${box.dataset.command}" data-palette-value="${color}" aria-label="${color}"></button>`).join('')
      : '<span class="palette-none">暂无</span>';
  };
  const rememberRecentColor = (color) => {
    const value = String(color || '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    const existing = recentColors.indexOf(value);
    if (existing >= 0) recentColors.splice(existing, 1);
    recentColors.unshift(value);
    recentColors.splice(8);
    document.querySelectorAll('.toolbar-palette').forEach(renderRecent);
  };
  const applyColor = (command, value) => {
    rememberSelection();
    editorCommand(command, value);
    if (value !== 'transparent') rememberRecentColor(value);
    closeToolbarPalettes();
  };
  const build = (id, command, clearLabel, clearValue) => {
    const box = document.getElementById(id);
    if (!box || box.dataset.ready) return;
    box.dataset.ready = 'true';
    box.dataset.command = command;
    const defaultSwatch = clearValue === 'transparent' ? '<span class="clear-swatch"></span>' : '<span class="default-swatch">✓</span>';
    box.innerHTML = `<div class="palette-default-row"><button type="button" class="palette-clear" data-palette-command="${command}" data-palette-value="${clearValue}">${defaultSwatch}<span>${clearLabel}</span></button></div><div class="palette-grid">${colors.map((color) => `<button type="button" class="palette-color" style="--swatch:${color}" data-palette-command="${command}" data-palette-value="${color}" aria-label="${color}"></button>`).join('')}</div><div class="palette-section-title">渐变色</div><div class="palette-gradient-grid">${gradients.map((gradient, index) => `<button type="button" class="palette-color palette-gradient" style="--swatch:${gradient}" data-palette-command="${command}" data-palette-value="${gradientValues[index]}" aria-label="渐变色"></button>`).join('')}</div><div class="palette-section-title">最近使用</div><div class="palette-recent"></div><button type="button" class="palette-more" data-palette-more="${command}"><span class="more-color-icon"></span><span>更多颜色</span><span class="palette-more-arrow">›</span></button>`;
    renderRecent(box);
    box.addEventListener('click', (event) => {
      const more = event.target.closest('[data-palette-more]');
      if (more) {
        event.stopPropagation();
        pickerCommand = more.dataset.paletteMore;
        rememberSelection();
        picker.value = '#34413b';
        picker.click();
        return;
      }
      const button = event.target.closest('[data-palette-command]');
      if (!button) return;
      event.stopPropagation();
      applyColor(button.dataset.paletteCommand, button.dataset.paletteValue);
    });
  };
  picker.addEventListener('change', () => {
    if (!pickerCommand) return;
    applyColor(pickerCommand, picker.value);
    pickerCommand = '';
  });
  build('textColorPalette', 'foreColor', '默认', '#34413b');
  build('highlightColorPalette', 'hiliteColor', '无填充色', 'transparent');
  document.querySelectorAll('[data-palette-target]').forEach((trigger) => {
    if (trigger.dataset.paletteBound) return;
    trigger.dataset.paletteBound = 'true';
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      rememberSelection();
      const wrap = trigger.closest('.toolbar-palette-wrap');
      const palette = document.getElementById(trigger.dataset.paletteTarget);
      const open = palette.hidden;
      closeToolbarPalettes();
      if (!open) return;
      const rect = trigger.getBoundingClientRect();
      const width = 280;
      palette.style.width = `${width}px`;
      palette.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      palette.style.top = `${Math.max(8, rect.bottom + 6)}px`;
      palette.hidden = false;
      const paletteRect = palette.getBoundingClientRect();
      const top = paletteRect.bottom > window.innerHeight - 8 ? rect.top - paletteRect.height - 6 : paletteRect.top;
      palette.style.top = `${Math.max(8, Math.min(top, window.innerHeight - paletteRect.height - 8))}px`;
      wrap.classList.add('open');
    });
  });
}
function closeToolbarPalettes(keep = null) { document.querySelectorAll('.toolbar-palette-wrap.open').forEach((wrap) => { if (keep && wrap === keep) return; wrap.classList.remove('open'); const palette = wrap.querySelector('.toolbar-palette'); if (palette) palette.hidden = true; }); }

// Global search (Phase 1-7)
let globalSearchResults = [];
let globalSearchSelectedIdx = 0;
function openGlobalSearch() {
  const modal = $('#globalSearchModal');
  if (!modal) return;
  modal.showModal();
  const input = $('#globalSearchInput');
  if (input) { input.value = ''; input.focus(); }
  renderGlobalSearchResults('');
}
function closeGlobalSearch() {
  const modal = $('#globalSearchModal');
  if (modal) modal.close();
}
function performGlobalSearch(query) {
  if (!query || query.length < 1) return [];
  const q = query.toLowerCase();
  const results = [];
  // Search documents
  (state.documents || []).forEach((doc) => {
    const titleMatch = (doc.title || '').toLowerCase().includes(q);
    const contentMatch = (doc.content || '').toLowerCase().includes(q);
    if (titleMatch || contentMatch) {
      results.push({ type: 'document', id: doc.id, title: doc.title, subtitle: doc.folder || '', score: titleMatch ? 2 : 1 });
    }
  });
  // Search cards
  (state.cards || []).forEach((card) => {
    const qMatch = (card.question || '').toLowerCase().includes(q);
    const tagMatch = (card.tags || []).some(t => t.toLowerCase().includes(q));
    const folderMatch = (card.folder || '').toLowerCase().includes(q);
    if (qMatch || tagMatch || folderMatch) {
      const preview = card.type === 'note' ? (card.noteContent || '').substring(0, 80) : Object.values(card.options || {}).filter(Boolean).join(', ').substring(0, 80);
      results.push({ type: 'card', id: card.id, title: (card.question || '').replace(/<[^>]*>/g, '').substring(0, 60), subtitle: card.folder + (tagMatch ? ' · ' + card.tags.join(', ') : ''), preview, score: qMatch ? 3 : tagMatch ? 2 : 1 });
    }
  });
  // Search market decks (only if unlocked)
  if (marketUnlocked) {
    (marketDecks || []).forEach((deck) => {
      const titleMatch = (deck.title || '').toLowerCase().includes(q);
      const authorMatch = (deck.author || '').toLowerCase().includes(q);
      const descMatch = (deck.description || '').toLowerCase().includes(q);
      if (titleMatch || authorMatch || descMatch) {
        results.push({ type: 'market', id: deck.id, title: deck.title, subtitle: deck.author + ' · ' + deck.category, score: titleMatch ? 3 : 2 });
      }
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 50);
}
function renderGlobalSearchResults(query) {
  const container = $('#globalSearchResults');
  if (!container) return;
  globalSearchResults = query ? performGlobalSearch(query) : [];
  globalSearchSelectedIdx = 0;
  if (!query) {
    container.innerHTML = '<div class="global-search-empty"><strong>开始输入以搜索</strong><span>搜索卡片、文章和牌组市场</span></div>';
    return;
  }
  if (!globalSearchResults.length) {
    container.innerHTML = '<div class="global-search-empty"><strong>没有找到结果</strong><span>尝试更换关键词</span></div>';
    return;
  }
  const grouped = { document: [], card: [], market: [] };
  globalSearchResults.forEach((r) => { if (grouped[r.type]) grouped[r.type].push(r); });
  const typeLabels = { document: '文章', card: '卡片', market: '牌组市场' };
  let html = '';
  for (const [type, items] of Object.entries(grouped)) {
    if (!items.length) continue;
    html += '<div class="global-search-group"><div class="global-search-group-label">' + typeLabels[type] + ' (' + items.length + ')</div>';
    items.forEach((item) => {
      const idx = globalSearchResults.indexOf(item);
      html += '<button class="global-search-item' + (idx === globalSearchSelectedIdx ? ' is-selected' : '') + '" data-search-idx="' + idx + '"><div class="global-search-item-main"><strong>' + esc(item.title) + '</strong><small>' + esc(item.subtitle) + '</small></div>' + (item.preview ? '<p class="global-search-preview">' + esc(item.preview) + '</p>' : '') + '</button>';
    });
    html += '</div>';
  }
  container.innerHTML = html;
  container.querySelectorAll('.global-search-item').forEach((el) => {
    el.addEventListener('click', () => activateGlobalSearchResult(globalSearchResults[Number(el.dataset.searchIdx)]));
  });
}
function activateGlobalSearchResult(result) {
  if (!result) return;
  closeGlobalSearch();
  if (result.type === 'document') {
    view('library');
    state.activeDocId = result.id;
    loadDoc();
    refresh();
  } else if (result.type === 'card') {
    view('library');
    state.selectedCardId = result.id;
    refresh();
    setTimeout(() => { const el = document.querySelector('[data-card="' + result.id + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
  } else if (result.type === 'market') {
    view('market');
    showMarketWorkspace();
  }
}

function bind() {
  $('#windowMinimizeButton')?.addEventListener('click', () => window.reviewBridge.windowControls.minimize());
  $('#windowMaximizeButton')?.addEventListener('click', async () => { const maximized = await window.reviewBridge.windowControls.toggleMaximize(); $('#windowMaximizeButton').title = maximized ? '还原窗口' : '最大化'; });
  $('#windowCloseButton')?.addEventListener('click', () => window.reviewBridge.windowControls.close());
  $('#windowChrome')?.addEventListener('dblclick', (event) => { if (!event.target.closest('button')) window.reviewBridge.windowControls.toggleMaximize(); });
  $$$('.rail-btn,[data-view]').forEach((button) => button.addEventListener('click', () => button.dataset.view && view(button.dataset.view)));
  $('#knowledgeHomeButton').addEventListener('click', openKnowledgeHome);
  $('#knowledgeHomeNav').addEventListener('click', openKnowledgeHome);
  $('#crumbKnowledgeHome').addEventListener('click', openKnowledgeHome);
  $('#knowledgeAddButton').addEventListener('click', toggleKnowledgeAddMenu);
  $('#documentSearchInput').addEventListener('input', (event) => { documentQuery = event.target.value.trim().toLowerCase(); renderTree(); renderKnowledgeHome(); });
  document.addEventListener('click', (event) => { if (!event.target.closest('.knowledge-sidebar-tools')) closeKnowledgeAddMenu(); });
  $('#closeMoveDocumentButton').addEventListener('click', () => $('#moveDocumentModal').close());
  $('#cancelMoveDocumentButton').addEventListener('click', () => $('#moveDocumentModal').close());
  $('#moveDocumentForm').addEventListener('submit', moveDocumentFromModal);
  $$$('.formatbar [data-command]').forEach((button) => button.addEventListener('click', () => editorCommand(button.dataset.command, button.dataset.value)));
  $('#blockFormat').addEventListener('change', (event) => editorCommand('formatBlock', event.target.value));
  $('#fontSizeSelect').addEventListener('change', (event) => editorCommand('fontSize', event.target.value));
  $$$('.formatbar .select-trigger, .formatbar [data-command]').forEach((button) => button.addEventListener('mousedown', (event) => { rememberSelection(); event.preventDefault(); }));
  els.noteEditor.addEventListener('input', () => { saveDoc(); outline(); updateEditorWordCount(); });
  els.noteEditor.addEventListener('mouseup', rememberSelection);
  els.noteEditor.addEventListener('keyup', rememberSelection);
  els.noteEditor.addEventListener('paste', handleEditorPaste);
  els.noteEditor.addEventListener('keydown', handleEditorKeydown);
  els.noteEditor.addEventListener('click', handleEditorClick);
  document.addEventListener('click', handleImagePreviewClick);
  $('#quickCreateFromSelection')?.addEventListener('click', quickCard);
  $('#closeModalButton').addEventListener('click', () => els.cardModal.close());
  $('#cancelCardButton').addEventListener('click', () => els.cardModal.close());
  els.cardForm.addEventListener('submit', saveCard);
  els.cardTypeSelect.addEventListener('change', renderCardTypeFields);
  els.cardGroupSelect.addEventListener('change', () => { if (els.cardForm.dataset.autoTag === 'true') { $('#tagInput').value = els.cardGroupSelect.value || '未分组'; } });
  $('#tagInput').addEventListener('input', () => { els.cardForm.dataset.autoTag = 'false'; });
  $$$('.image-insert-button').forEach((button) => button.addEventListener('click', () => insertCardImage(button.dataset.cardImage)));
  els.nextButton.addEventListener('click', next);
  els.reviewGroupSelect?.addEventListener('change', (event) => changeReviewGroup(event.target.value));
  els.reviewOrderButton?.addEventListener('click', (event) => { event.stopPropagation(); toggleReviewOrderMenu(); });
  els.reviewOrderMenu?.addEventListener('click', (event) => { const option = event.target.closest('[data-review-order]'); if (!option) return; changeReviewOrder(option.dataset.reviewOrder); closeReviewOrderMenu(); });
  $$('input[name="reviewPriority"]').forEach((input) => input.addEventListener('change', () => { state.settings.reviewPriority = input.value; save(); syncSettings(); buildQueue(true); renderDock(); renderStandalone(); renderReviewPlan(); }));
  els.reviewHistoryButton?.addEventListener('click', toggleReviewHistory);
  els.reviewStudyBack?.addEventListener('click', exitReviewStudy);
  els.reviewHome?.addEventListener('click', handleReviewHomeClick);
  document.addEventListener('click', (event) => { if (!event.target.closest('.review-history-wrap')) closeReviewHistory(); if (!event.target.closest('.review-order-wrap')) closeReviewOrderMenu(); if (!event.target.closest('.review-book-actions')) closeReviewBookMenus(); if (!event.target.closest('.card-group-row')) closeCardGroupMenus(); });
  $('#exportTopButton').addEventListener('click', () => openExport('all'));
  $('#exportSelectedButton').addEventListener('click', () => openExport('selected'));
  $('#exportFolderButton').addEventListener('click', () => openExport('folder'));
  $('#webdavTestButton')?.addEventListener('click', testWebDav);
  $('#webdavSaveButton')?.addEventListener('click', saveWebDavConfig);
  $('#webdavSyncButton')?.addEventListener('click', syncWebDavNow);
  $('#webdavEditButton')?.addEventListener('click', () => setWebDavEditing(true));
  $('#webdavCancelEditButton')?.addEventListener('click', () => { webdavConfigEditing = false; syncWebDavForm(); });
  $('#webdavEnabled')?.addEventListener('change', () => { if (!$('#webdavEnabled').checked) updateStorageStatus('坚果云备份已停用'); });
  $('#closeExportButton').addEventListener('click', () => els.exportModal.close());
  $('#confirmExportButton').addEventListener('click', exportCards);
  $('#importButton').addEventListener('click', importCards);
  els.cardSearchInput.addEventListener('input', () => scheduleCardRender());
  els.tagFilter.addEventListener('change', () => scheduleCardRender());
  els.cardTypeFilter.addEventListener('change', () => scheduleCardRender());
  els.cardStatusFilter.addEventListener('change', () => scheduleCardRender());
  els.cardSortSelect.addEventListener('change', () => { const value = els.cardSortSelect.value; cardSortDirection = ['asc', 'desc', 'reviews-asc', 'reviews-desc'].includes(value) ? value : 'asc'; state.settings.cardSortDirection = cardSortDirection; save(); renderCards(true); });
  els.cardList.addEventListener('scroll', handleCardListScroll, { passive: true });
  bindCardWheel();
  $('#clearCardFilters').addEventListener('click', clearCardFilters);
  $('#selectAllCardsButton').addEventListener('click', toggleSelectAllCards);
  $('#clearCardSelectionButton').addEventListener('click', clearCardSelection);
  $('#bulkDeleteCardsButton').addEventListener('click', bulkDeleteCards);
  $('#toggleCardGroupsButton').addEventListener('click', toggleCardGroups);
  els.cardGroupRail.addEventListener('click', handleCardGroupRailClick);
  $('#marketSearchInput')?.addEventListener('input', debounce(() => { marketQuery = $('#marketSearchInput').value.trim(); refreshMarketPage({ resetPage: true }); }, 300));
  $('#marketCategoryFilter')?.addEventListener('change', () => { marketCategory = $('#marketCategoryFilter').value; refreshMarketPage({ resetPage: true }); });
  $('#marketSortSelect')?.addEventListener('change', () => { marketSort = $('#marketSortSelect').value; refreshMarketPage({ resetPage: true }); });
  $('#marketGrid')?.addEventListener('click', handleMarketClick);
  $('#marketPagination')?.addEventListener('click', (event) => { const button = event.target.closest('[data-market-page]'); if (!button || button.disabled) return; marketPage = Number(button.dataset.marketPage); refreshMarketPage(); });
  $('#marketAuthForm')?.addEventListener('submit', submitMarketAuth);
  $('#marketRegisterToggle')?.addEventListener('click', toggleMarketAuthMode);
  $('#marketPasswordToggle')?.addEventListener('click', () => { const field = $('#marketPassword'); if (field) field.type = field.type === 'password' ? 'text' : 'password'; });
  $('#adminBackMarketButton')?.addEventListener('click', showMarketDecks);
  $('#marketReturnLoginButton')?.addEventListener('click', returnToMarketLogin);
  document.addEventListener('click', (event) => {
    if (event.target.closest('.market-account')) return;
    const menu = $('#marketAccountMenu');
    if (menu) menu.hidden = true;
    $('#marketAccountButton')?.setAttribute('aria-expanded', 'false');
  });
  $('#closeMarketDetailButton')?.addEventListener('click', () => $('#marketDetailModal').close());
  $('#cancelMarketDetailButton')?.addEventListener('click', () => $('#marketDetailModal').close());
  $('#marketDownloadButton')?.addEventListener('click', downloadSelectedMarketDeck);
  $('#marketUploadForm')?.addEventListener('submit', submitMarketUpload);
  $('#marketUploadCategorySelect')?.addEventListener('change', (event) => {
    const input = $('#marketUploadNewCategory');
    const isNew = event.target.value === '__new__';
    input?.toggleAttribute('hidden', !isNew);
    if (isNew) input?.focus();
  });
  $('#closeMarketUploadButton')?.addEventListener('click', () => $('#marketUploadModal').close());
  $('#cancelMarketUploadButton')?.addEventListener('click', () => $('#marketUploadModal').close());
  $('#profileAvatarButton')?.addEventListener('click', () => $('#profileAvatarInput')?.click());
  $('#profileAvatarInput')?.addEventListener('change', handleProfileAvatar);
  $('#editProfileButton')?.addEventListener('click', openProfileEditor);
  $('#closeProfileEditButton')?.addEventListener('click', () => $('#profileEditModal').close());
  $('#cancelProfileEditButton')?.addEventListener('click', () => $('#profileEditModal').close());
  $('#profileEditForm')?.addEventListener('submit', saveProfile);
  $('#profileDeckList')?.addEventListener('click', handleProfileDeckAction);
  $('#cancelDeleteGroupButton').addEventListener('click', () => { pendingCardOrder = null; $('#deleteGroupModal').close(); });
  $('#confirmDeleteGroupButton').addEventListener('click', confirmDeleteTarget);
  $('#closeGroupButton').addEventListener('click', () => $('#createGroupModal').close());
  $('#cancelGroupButton').addEventListener('click', () => $('#createGroupModal').close());
  $('#createGroupForm').addEventListener('submit', saveGroup);
  $('#newFolderButton').addEventListener('click', () => openCreate('folder'));
  $('#newDocButton').addEventListener('click', () => openCreate('document'));
  $('#closeCreateButton').addEventListener('click', () => els.createModal.close());
  $('#cancelCreateButton').addEventListener('click', () => els.createModal.close());
  els.createForm.addEventListener('submit', createItem);
  $('#rootDropZone').addEventListener('dragover', (event) => { event.preventDefault(); event.currentTarget.classList.add('drag-over'); });
  $('#rootDropZone').addEventListener('dragleave', (event) => event.currentTarget.classList.remove('drag-over'));
  $('#rootDropZone').addEventListener('drop', rootDrop);
  $('#emptyTrashButton').addEventListener('click', emptyTrash);
  $$$('.trash-tabs [data-trash-tab]').forEach((button) => button.addEventListener('click', () => { trashTab = button.dataset.trashTab; renderTrash(); }));
  $('#toggleOutlineButton').addEventListener('click', toggleOutline);
  $('#toggleReviewButton').addEventListener('click', toggleReview);
  $$$('.settings-nav button').forEach((button) => button.addEventListener('click', () => setting(button.dataset.setting)));
  [els.desiredRetention, els.dailyLimit, els.dailyNewLimit].forEach((input) => input?.addEventListener('input', settings));
  $('.toast-close')?.addEventListener('click', () => els.toast.classList.remove('show'));
  $('#globalSearchInput')?.addEventListener('input', (e) => renderGlobalSearchResults(e.target.value));
  $('#globalSearchModal')?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); globalSearchSelectedIdx = Math.min(globalSearchSelectedIdx + 1, globalSearchResults.length - 1); renderGlobalSearchResults($('#globalSearchInput')?.value || ''); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); globalSearchSelectedIdx = Math.max(globalSearchSelectedIdx - 1, 0); renderGlobalSearchResults($('#globalSearchInput')?.value || ''); }
    else if (e.key === 'Enter') { e.preventDefault(); activateGlobalSearchResult(globalSearchResults[globalSearchSelectedIdx]); }
  });
}

// Replace the native confirmation with the themed dialog when the card-library code calls it.
function deleteCardGroup(group) { const cards = state.cards.filter((card) => card.folder === group); openDeleteConfirm('card-group', group, `删除卡组“${group}”？`, cards.length ? `该卡组包含 ${cards.length} 张卡片，删除后卡片会移入回收站。` : '该卡组没有卡片，删除后仍可在回收站中恢复。'); }
function confirmDeleteCardGroup() { const modal = $('#deleteGroupModal'); const group = modal?.dataset.group; if (!group) return; const cards = state.cards.filter((card) => card.folder === group); state.trash.cards.push(...cards); state.cards = state.cards.filter((card) => card.folder !== group); state.groups = state.groups.filter((item) => item !== group); if (els.folderFilter.value === group) { els.folderFilter.value = '全部文件夹'; syncCustomSelect(els.folderFilter); } cards.forEach((card) => selectedCardIds.delete(card.id)); save(); modal.close(); refresh(); toast(`卡组“${group}”已移入回收站。`); }

// Backup-only WebDAV mode: localStorage is the only data source and uploads are hourly.
let webdavBackupTimer = null;
let webdavLastBackupAt = '';
const webdavBackupInterval = 60 * 60 * 1000;
let webdavConfigEditing = false;

function updateStorageStatus(message = '') {
  const status = $('#storageStatus');
  const dot = $('#webdavStatusDot');
  const lastBackup = webdavConfig.lastBackupAt ? `最近备份：${formatBackupTime(webdavConfig.lastBackupAt)}` : '尚未产生备份记录';
  if (status) status.textContent = message || (webdavConfig.enabled ? `坚果云备份已启用，每小时自动上传。${lastBackup}` : '尚未启用坚果云备份');
  if (dot) dot.style.background = webdavConfig.enabled ? '#4da77f' : '#c9cfca';
}

function formatBackupTime(value) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return '时间未知';
  return time.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderWebDavBackupHistory(history = webdavConfig.backupHistory || []) {
  const list = $('#webdavBackupHistory');
  if (!list) return;
  const entries = Array.isArray(history) ? history.slice(0, 8) : [];
  if (!entries.length) {
    list.innerHTML = '<p class="backup-history-empty">暂无备份记录。首次备份完成后会在这里显示。</p>';
    return;
  }
  list.innerHTML = entries.map((entry) => {
    const succeeded = entry.status === 'success';
    const trigger = entry.trigger === 'manual' ? '手动备份' : '自动备份';
    const message = succeeded ? '本地数据快照已上传' : (entry.message || '备份失败');
    return `<div class="backup-history-item"><div><strong>${esc(trigger)}</strong><span>${esc(formatBackupTime(entry.at))}</span></div><span class="backup-history-result ${succeeded ? 'success' : 'failed'}">${succeeded ? '成功' : '失败'}</span><small title="${esc(message)}">${esc(message)}</small></div>`;
  }).join('');
}

function setWebDavEditing(editing) {
  webdavConfigEditing = editing === true;
  const form = $('.webdav-form');
  form?.classList.toggle('is-editing', webdavConfigEditing);
  ['webdavUrl', 'webdavUsername', 'webdavRemoteFolder'].forEach((id) => {
    const field = $(`#${id}`);
    if (field) field.readOnly = !webdavConfigEditing;
  });
  const password = $('#webdavPassword');
  if (password) {
    password.readOnly = !webdavConfigEditing;
    password.type = webdavConfigEditing ? 'password' : 'text';
    if (webdavConfigEditing) {
      password.value = '';
      password.dataset.savedMask = '';
      password.placeholder = '留空表示保持已保存的应用密码';
      $('#webdavUrl')?.focus();
    } else {
      password.value = webdavConfig.hasPassword ? '••••••••••••' : '';
      password.dataset.savedMask = webdavConfig.hasPassword ? 'true' : '';
      password.placeholder = webdavConfig.hasPassword ? '' : '请输入坚果云应用密码';
    }
  }
  $('#webdavEditButton')?.classList.toggle('hidden', webdavConfigEditing);
  $('#webdavCancelEditButton')?.classList.toggle('hidden', !webdavConfigEditing);
}

function syncWebDavForm() {
  const values = { webdavUrl: webdavConfig.url || 'https://dav.jianguoyun.com/dav/', webdavRemoteFolder: webdavConfig.remoteFolder || 'knowledge-review-electron', webdavUsername: webdavConfig.username || '' };
  Object.entries(values).forEach(([key, value]) => { const field = document.getElementById(key); if (field && (!webdavConfigEditing || !field.matches(':focus'))) field.value = value; });
  const enabled = $('#webdavEnabled');
  const autoBackup = $('#webdavAutoBackup');
  if (enabled) enabled.checked = webdavConfig.enabled === true;
  if (autoBackup) autoBackup.checked = webdavConfig.autoBackup === true;
  setWebDavEditing(webdavConfigEditing);
  renderWebDavBackupHistory(webdavConfig.backupHistory);
}

function webdavFormPayload() {
  const password = $('#webdavPassword');
  return { url: $('#webdavUrl')?.value.trim(), remoteFolder: $('#webdavRemoteFolder')?.value.trim(), username: $('#webdavUsername')?.value.trim(), password: password?.dataset.savedMask ? '' : (password?.value || ''), enabled: $('#webdavEnabled')?.checked === true, autoBackup: $('#webdavAutoBackup')?.checked === true };
}

function backupSnapshot() {
  const snapshot = JSON.parse(storageSnapshot());
  snapshot.backup = { mode: 'webdav-upload-only', createdAt: new Date().toISOString() };
  return JSON.stringify(snapshot, null, 2);
}

function pushWebDavState(trigger = 'automatic') {
  if (!webdavConfig.enabled || !window.reviewBridge?.webdav?.push) return Promise.resolve({ ok: false, skipped: true });
  webdavPushPromise = webdavPushPromise.catch(() => {}).then(async () => {
    updateStorageStatus('正在备份到坚果云...');
    const result = await window.reviewBridge.webdav.push({ content: backupSnapshot(), updatedAt: new Date().toISOString(), trigger });
    if (result?.backupHistory) webdavConfig = { ...webdavConfig, ...result, backupHistory: result.backupHistory, lastBackupAt: result.lastBackupAt || result.updatedAt || webdavConfig.lastBackupAt };
    if (result?.ok) { webdavLastBackupAt = result.updatedAt || new Date().toISOString(); updateStorageStatus(`最近备份：${new Date(webdavLastBackupAt).toLocaleString('zh-CN')}`); }
    else updateStorageStatus(result?.error ? `备份失败：${result.error}` : '等待下一次自动备份');
    renderWebDavBackupHistory(webdavConfig.backupHistory);
    return result;
  });
  return webdavPushPromise;
}

function startWebDavPolling() {
  clearInterval(webdavBackupTimer);
  webdavBackupTimer = null;
  if (!webdavConfig.enabled || !webdavConfig.autoBackup) return;
  webdavBackupTimer = setInterval(() => pushWebDavState('automatic'), webdavBackupInterval);
}

async function loadWebDavConfig() {
  if (!window.reviewBridge?.webdav?.getConfig) return;
  const result = await window.reviewBridge.webdav.getConfig();
  if (result?.ok) { webdavConfig = result; updateStorageStatus(); syncWebDavForm(); startWebDavPolling(); }
}

async function saveWebDavConfig() {
  const result = await window.reviewBridge.webdav.saveConfig(webdavFormPayload());
  if (!result?.ok) return toast(result?.error || '无法保存 WebDAV 备份配置。');
  webdavConfig = result;
  webdavConfigEditing = false;
  syncWebDavForm();
  startWebDavPolling();
  updateStorageStatus(webdavConfig.enabled ? '坚果云备份已启用，每小时自动上传' : '坚果云备份配置已保存但未启用');
  toast('WebDAV 备份配置已保存。');
}

async function testWebDav() {
  const result = await window.reviewBridge.webdav.test(webdavFormPayload());
  if (result?.ok) { webdavConfig = { ...webdavConfig, ...result }; syncWebDavForm(); updateStorageStatus('连接成功，可执行坚果云备份。'); }
  else updateStorageStatus(result?.error || 'WebDAV 连接失败。');
  toast(result?.ok ? 'WebDAV 连接成功。' : (result?.error || 'WebDAV 连接失败。'));
}

async function syncWebDavNow() {
  const result = await pushWebDavState('manual');
  if (result?.skipped) toast('请先启用坚果云备份。');
}

function ensureStoragePanel() {
  const panel = $('#storagePanel');
  if (!panel) return;
  panel.dataset.ready = 'backup-only';
  panel.innerHTML = `<div class="sync-panel-heading"><div><span class="modal-eyebrow">CLOUD BACKUP</span><h2>坚果云 WebDAV 备份</h2><p class="setting-description">本地数据是唯一来源。坚果云只接收备份，应用不会在启动时下载，也不会用云端内容覆盖本地数据。</p></div><span class="sync-status-dot" id="webdavStatusDot" aria-hidden="true"></span></div><div class="webdav-form"><label>WebDAV 地址<input id="webdavUrl" value="https://dav.jianguoyun.com/dav/" /></label><label>坚果云账号 / 邮箱<input id="webdavUsername" autocomplete="username" placeholder="输入坚果云登录账号或邮箱" /></label><label>应用密码<input id="webdavPassword" autocomplete="new-password" /></label><label>远程备份文件夹<input id="webdavRemoteFolder" value="knowledge-review-electron" /></label></div><div class="sync-options"><label class="switch-row"><span class="switch-copy"><strong>启用坚果云备份</strong><small>允许应用将本地数据上传到 WebDAV</small></span><span class="switch-control"><input id="webdavEnabled" type="checkbox" /><span aria-hidden="true"></span></span></label><label class="switch-row"><span class="switch-copy"><strong>每小时自动备份</strong><small>每 60 分钟上传一次完整数据</small></span><span class="switch-control"><input id="webdavAutoBackup" type="checkbox" checked /><span aria-hidden="true"></span></span></label></div><div class="sync-policy"><span class="sync-policy-icon">i</span><span><strong>备份规则</strong><small>卡片、文章和复习记录都先保存在本地。保存不会触发网络请求；只有手动备份或每小时自动备份会上传当前本地快照。</small></span></div><div class="storage-actions webdav-actions"><button class="secondary-button" id="webdavEditButton" type="button">编辑配置</button><button class="secondary-button hidden" id="webdavCancelEditButton" type="button">取消编辑</button><button class="secondary-button" id="webdavTestButton" type="button">测试连接</button><button class="secondary-button" id="webdavSaveButton" type="button">保存配置</button><button class="primary" id="webdavSyncButton" type="button">立即备份到坚果云</button></div><div class="storage-sync-status"><div class="storage-status" id="storageStatus">等待配置 WebDAV 备份</div></div><section class="backup-history" aria-labelledby="backupHistoryTitle"><div class="backup-history-heading"><h3 id="backupHistoryTitle">备份记录</h3><span>保留最近 20 条</span></div><div id="webdavBackupHistory" class="backup-history-list"></div></section>`;
  syncWebDavForm();
}
