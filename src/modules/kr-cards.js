/**
 * kr-cards.js - Card CRUD, library rendering, filtering, batch ops
 * Dependencies: kr-core.js, kr-state.js
 * Note: Contains updated versions that override earlier compressed defs.
 */
function renderTagSpan(text) {
  return '<span class="tag">' + text + '</span>';
}
function quickCard() { const text = state.extractedText.trim(); if (!text) return toast('请先在编辑器中选中文本。'); openCard(); $('#questionInput').value = `解释：${text.slice(0, 40)}`; $('#explanationInput').value = text; }
function openCard(cardId = null) { ensureBatchModeButton(); const card = cardId ? state.cards.find((item) => item.id === cardId) : null; els.cardForm.reset(); els.cardModal.dataset.editingId = card?.id || ''; els.cardForm.dataset.autoTag = card ? 'false' : 'true'; if (card) batchCardMode = false; const modeButton = $('#batchModeButton'); modeButton.classList.toggle('active', batchCardMode); modeButton.textContent = batchCardMode ? '批量制卡中' : '批量制卡'; modeButton.disabled = Boolean(card); els.cardModal.classList.toggle('batch-mode', batchCardMode); $('#cardModalTitle').textContent = card ? '编辑复习卡片' : '新建复习卡片'; fill(els.cardGroupSelect, [...new Set([...(state.groups || []), ...state.cards.map((item) => item.folder)])]); els.cardGroupSelect.value = card?.folder || state.groups?.[0] || '学习科学'; syncCustomSelect(els.cardGroupSelect); $('#cardTypeSelect').value = card?.type || 'single'; syncCustomSelect(els.cardTypeSelect); $('#questionInput').value = card?.question || state.extractedText || ''; $('#optionA').value = card?.options.A || ''; $('#optionB').value = card?.options.B || ''; $('#optionC').value = card?.options.C || ''; $('#optionD').value = card?.options.D || ''; $('#noteContentInput').value = card?.noteContent || ''; $('#explanationInput').value = card?.explanation || ''; $('#tagInput').value = (card?.tags || [els.cardGroupSelect.value || '未分组']).join(', '); renderCardTypeFields(); renderAnswerChoices(card?.answer || []); els.cardModal.showModal(); }
function renderCardTypeFields() { const note = els.cardTypeSelect.value === 'note'; $('#cardOptionsGrid').classList.toggle('hidden', note); $('#cardAnswersField').classList.toggle('hidden', note); $('#noteContentField').classList.toggle('hidden', !note); $('#explanationField').classList.toggle('hidden', note); if (!note) renderAnswerChoices(); }
function renderAnswerChoices(selected = []) { const multiple = els.cardTypeSelect.value === 'multiple'; els.answerChoices.innerHTML = OPTS.map((key) => `<label><input type="${multiple ? 'checkbox' : 'radio'}" name="answer" value="${key}" ${selected.includes(key) ? 'checked' : ''}><span>${key}</span></label>`).join(''); }
function insertCardImage(targetId) { const url = prompt('图片地址', 'https://'); if (!url) return; const field = document.getElementById(targetId); field.value += `${field.value ? '\n' : ''}![图片](${url})`; field.focus(); }
function markdownUrl(value, fallback = '#') { const url = String(value || '').trim(); return /^(https?:|mailto:|#|data:image\/)/i.test(url) ? esc(url) : fallback; }
function cardHtml(value) { return markdownInline(String(value || '')).replace(/\n/g, '<br>'); }
function noteMarkdownHtml(value) { const raw = String(value || '').trim(); if (!raw) return '<p class="note-empty-content">暂无速记内容</p>'; if (/^\s*<(p|h[1-6]|ul|ol|blockquote|pre|img|a)\b/i.test(raw)) return renderLatexInHtml(raw); return markdownToHtml(raw, { noteEntries: true }); }
function masteryMeta(card) { const value = card.mastery || (card.type === 'note' ? card.noteRating : ''); return value && NOTE_RATINGS[value] ? NOTE_RATINGS[value] : null; }
function masteryScore(card) {
  const rating = card.mastery || (card.type === 'note' ? card.noteRating : '');
  if (!rating) return null;
  if (rating === 'tooEasy') return 100;
  const base = { forgot: 20, fuzzy: 55, familiar: 80, tooEasy: 94 }[rating] ?? 0;
  const reviews = Math.max(0, Number(card.reviews || card.fsrs?.reps || 0));
  const interval = Math.max(0, Number(card.interval || card.fsrs?.scheduledDays || 0));
  const reviewBonus = Math.min(10, reviews * 1.5);
  const intervalBonus = Math.min(8, Math.log1p(interval) * 2.6);
  return Math.max(0, Math.min(100, Math.round(base + reviewBonus + intervalBonus)));
}
function noteRatingBadge(card) { const rating = masteryMeta(card); return rating ? `<span class="review-stamp-mini ${rating.className}">${rating.label}</span>` : '<span class="review-stamp-mini pending">未评价</span>'; }
function saveCard(event) { event.preventDefault(); const type = els.cardTypeSelect.value; const folder = els.cardGroupSelect.value || '未分组'; const tags = String($('#tagInput').value || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean); const options = { A: $('#optionA').value.trim(), B: $('#optionB').value.trim(), C: $('#optionC').value.trim(), D: $('#optionD').value.trim() }; const selected = [...document.querySelectorAll('input[name="answer"]:checked')].map((input) => input.value); const question = $('#questionInput').value.trim(); if (!question) return toast('请填写题干或词条。'); if (type === 'note') { if (!$('#noteContentInput').value.trim()) return toast('请填写速记内容。'); } else { if (!selected.length) return toast('请选择正确答案。'); if (type === 'multiple' && selected.length < 2) return toast('多选题至少选择两个答案。'); if (!Object.values(options).some(Boolean)) return toast('至少填写一个选项。'); } const data = normCard({ id: els.cardModal.dataset.editingId || id('card'), type, folder, question, options, answer: selected, noteContent: $('#noteContentInput').value.trim(), explanation: $('#explanationInput').value.trim(), tags: tags.length ? tags : [folder] }); const old = state.cards.findIndex((item) => item.id === data.id); if (old >= 0) state.cards[old] = { ...state.cards[old], ...data }; else state.cards.push(data); state.groups = [...new Set([...(state.groups || []), folder])]; state.selectedCardId = data.id; save(); answered = false; refresh(); if (old >= 0 || !batchCardMode) { els.cardModal.close(); toast(old >= 0 ? '卡片已更新。' : '卡片已保存。'); } else { resetBatchCardForm(); toast('卡片已保存，可继续创建下一张。'); } }
function resetBatchCardForm() { const group = els.cardGroupSelect.value; const type = els.cardTypeSelect.value; els.cardForm.reset(); els.cardModal.dataset.editingId = ''; els.cardForm.dataset.autoTag = 'true'; els.cardGroupSelect.value = group; syncCustomSelect(els.cardGroupSelect); els.cardTypeSelect.value = type; syncCustomSelect(els.cardTypeSelect); $('#tagInput').value = group || '未分组'; renderCardTypeFields(); renderAnswerChoices(); $('#questionInput').focus(); }

function cardMatches(card) { const query = els.cardSearchInput.value.trim().toLowerCase(); const folder = els.folderFilter.value; const tag = els.tagFilter.value; const type = els.cardTypeFilter.value; const status = els.cardStatusFilter.value; const mastery = card.mastery || ''; return (!query || [card.question, card.folder, card.tags.join(' '), card.noteContent].join(' ').toLowerCase().includes(query)) && (!folder || folder === '全部文件夹' || card.folder === folder) && (!tag || tag === '全部标签' || card.tags.includes(tag)) && (!type || type === '全部类型' || card.type === type) && (!status || status === '全部熟练度' || (status === 'evaluated' ? Boolean(mastery) : status === 'unrated' ? !mastery : mastery === status)); }
function renderCardSummary() { const due = state.cards.filter(isDue).length; const notes = state.cards.filter((card) => card.type === 'note').length; if (els.cardSummary) els.cardSummary.innerHTML = [['#i-layers', state.cards.length, '全部卡片'], ['#i-review', due, '待复习'], ['#i-book', notes, '速记词条'], ['#i-flame', totalReviews(), '累计复习']].map(([icon, value, label]) => `<div class="card-summary-item"><svg><use href="${icon}"></use></svg><div><b>${value}</b><span>${label}</span></div></div>`).join(''); const totalBadge = $('#cardTotalBadge'); if (totalBadge) totalBadge.textContent = `${state.cards.length} 张`; }
function renderCardGroups() {
  const groups = [...new Set([...(state.groups || []), ...state.cards.map((card) => card.folder)])];
  state.groups = groups;
  $('#cardGroupCount').textContent = groups.length;
  const allGroup = `<div class="card-group-row all-group-row"><div class="card-group-link ${els.folderFilter.value === '全部文件夹' ? 'active' : ''}"><button type="button" class="card-group-select" data-group="全部文件夹"><span class="group-dot all"></span><span>全部卡片</span></button><button type="button" class="card-group-more" data-group-menu="__all__" aria-label="全部卡片更多操作" aria-expanded="false"><svg><use href="#i-more-vertical"></use></svg></button><div class="card-group-menu" data-group-menu-panel="__all__"><button type="button" data-create-group="true">新建卡组</button></div></div></div>`;
  const groupItems = groups.map((group) => `<div class="card-group-row sortable-group-row" draggable="true" data-sort-group="${esc(group)}"><div class="card-group-link ${els.folderFilter.value === group ? 'active' : ''}"><button type="button" class="card-group-select" data-group="${esc(group)}"><span class="group-dot"></span><span>${esc(group)}</span></button><button type="button" class="card-group-more" data-group-menu="${esc(group)}" aria-label="${esc(group)}更多操作" aria-expanded="false"><svg><use href="#i-more-vertical"></use></svg></button><div class="card-group-menu" data-group-menu-panel="${esc(group)}"><button type="button" data-group-rename="${esc(group)}">重命名</button><button type="button" data-group-relearn="${esc(group)}">重学此卡组</button><button type="button" class="danger" data-group-delete="${esc(group)}">删除卡组</button></div></div></div>`).join('');
  const addCardsFolder = `<label class="folder-card" data-open-card-creator="true">
    <input type="checkbox" class="folder-toggle" />
    <div class="hint-wrapper">
      <span class="hint-text">add more cards</span>
      <svg class="hint-arrow" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M 35 5 C 35 5, 15 5, 10 25 M 10 25 L 3 18 M 10 25 L 18 22" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
    </div>
    <div class="folder-container">
      <svg class="folder-back" viewBox="0 0 50 40" fill="none"><path d="M0 4C0 1.79086 1.79086 0 4 0H16.524C17.721 0 18.8415 0.54051 19.574 1.4673L22.426 5.0654C23.1585 5.99219 24.279 6.5327 25.476 6.5327H46C48.2091 6.5327 50 8.32356 50 10.5327V36C50 38.2091 48.2091 40 46 40H4C1.79086 40 0 38.2091 0 36V4Z" fill="#0056b3"></path></svg>
      <div class="folder-search"><svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><input type="text" placeholder="Search files..." class="search-input" aria-label="搜索卡片"></div>
      <div class="file file-5"><div class="shine"></div><svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg><div class="file-text">Hero_BG.png</div><div class="file-tag">PNG &bull; 4.2 MB</div></div>
      <div class="file file-4"><div class="shine"></div><svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg><div class="file-text">Promo_Cut.mp4</div><div class="file-tag">MP4 &bull; 128 MB</div></div>
      <div class="file file-3"><div class="shine"></div><svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg><div class="file-text">app_config.json</div><div class="file-tag">JSON &bull; 12 KB</div></div>
      <div class="file file-2"><div class="shine"></div><svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg><div class="file-text">Q3_Report.pdf</div><div class="file-tag">PDF &bull; 1.1 MB</div></div>
      <div class="file file-1"><div class="shine"></div><svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg><div class="file-text">Pitch_Deck.pptx</div><div class="file-tag">PPTX &bull; 8.4 MB</div></div>
      <div class="folder-front-wrapper"><svg class="folder-front" viewBox="0 0 50 34" fill="none"><path d="M0 4C0 1.79086 1.79086 0 4 0H46C48.2091 0 50 1.79086 50 4V30C50 32.2091 48.2091 34 46 34H4C1.79086 34 0 32.2091 0 30V4Z" fill="rgba(0, 123, 255, 0.65)"></path></svg><div class="folder-label"></div><div class="counter"><div class="status-dot"></div><span class="counter-label">CARDS</span><span class="counter-number" id="addCardsFolderCount">${String(state.cards.length).padStart(2, '0')}</span></div></div>
    </div>
  </label>`;
  els.cardGroupRail.innerHTML = allGroup + groupItems + addCardsFolder;
  bindGroupSorting();
}
function handleCardGroupRailClick(event) {
  const addCardsFolder = event.target.closest('[data-open-card-creator]');
  if (addCardsFolder) {
    if (event.target.closest('.folder-search')) return;
    event.stopPropagation();
    openCard();
    return;
  }
  const groupButton = event.target.closest('[data-group]');
  if (groupButton) { els.folderFilter.value = groupButton.dataset.group; syncCustomSelect(els.folderFilter); cardPage = 1; renderCards(); return; }
  const menuButton = event.target.closest('[data-group-menu]');
  if (menuButton) { event.stopPropagation(); const menu = menuButton.parentElement?.querySelector(`[data-group-menu-panel="${CSS.escape(menuButton.dataset.groupMenu)}"]`); const open = menu && !menu.classList.contains('open'); closeCardGroupMenus(); if (menu && open) { menu.classList.add('open'); menuButton.setAttribute('aria-expanded', 'true'); } return; }
  if (event.target.closest('[data-create-group]')) { event.stopPropagation(); closeCardGroupMenus(); openCreateGroup(); return; }
  const action = event.target.closest('[data-group-rename], [data-group-relearn], [data-group-delete]');
  if (!action) return;
  event.stopPropagation();
  closeCardGroupMenus();
  if (action.dataset.groupRename) openRenameGroup(action.dataset.groupRename);
  else if (action.dataset.groupRelearn) relearnCardGroup(action.dataset.groupRelearn);
  else deleteCardGroup(action.dataset.groupDelete);
}
function closeCardGroupMenus() { $$$('.card-group-menu.open').forEach((menu) => menu.classList.remove('open')); $$('.card-group-more[aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false')); }
function enableTooltips() {
  document.addEventListener('pointerover', (event) => {
    const target = event.target.closest('[title]');
    if (!target || target.closest('.select-shell')) return;
    const title = target.getAttribute('title');
    if (!title) return;
    target.dataset.tooltip = title;
    target.removeAttribute('title');
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const tip = document.createElement('div');
      tip.className = 'app-tooltip';
      tip.textContent = title;
      document.body.appendChild(tip);
      const tipRect = tip.getBoundingClientRect();
      const margin = 8;
      const left = Math.max(margin, Math.min(window.innerWidth - tipRect.width - margin, rect.left + (rect.width - tipRect.width) / 2));
      const below = rect.bottom + tipRect.height + 8 <= window.innerHeight - margin;
      tip.style.left = `${left}px`;
      tip.style.top = `${below ? rect.bottom + 8 : Math.max(margin, rect.top - tipRect.height - 8)}px`;
      requestAnimationFrame(() => tip.classList.add('show'));
      target.dataset.tooltipVisible = 'true';
    }, 260);
  });
  document.addEventListener('pointerout', (event) => {
    const target = event.target.closest('[data-tooltip]');
    if (!target || target.contains(event.relatedTarget)) return;
    clearTimeout(tooltipTimer);
    target.setAttribute('title', target.dataset.tooltip);
    delete target.dataset.tooltip;
    delete target.dataset.tooltipVisible;
    document.querySelectorAll('.app-tooltip').forEach((tip) => tip.remove());
  });
  document.addEventListener('scroll', () => document.querySelectorAll('.app-tooltip').forEach((tip) => tip.remove()), true);
}
function toggleCardGroups() { const layout = document.querySelector('.card-library-layout'); const button = $('#toggleCardGroupsButton'); const collapsed = layout.classList.toggle('groups-collapsed'); button.title = collapsed ? '显示卡组侧栏' : '隐藏卡组侧栏'; button.setAttribute('aria-label', button.title); button.classList.toggle('active', collapsed); }
function bindGroupSorting() { $$$('#cardGroupRail [data-sort-group]').forEach((row) => { row.addEventListener('dragstart', (event) => { if (event.target.closest('button')) { event.preventDefault(); return; } event.dataTransfer.setData('group-name', row.dataset.sortGroup); row.classList.add('dragging'); }); row.addEventListener('dragend', () => row.classList.remove('dragging')); row.addEventListener('dragover', (event) => { event.preventDefault(); row.classList.add('drag-over'); }); row.addEventListener('dragleave', () => row.classList.remove('drag-over')); row.addEventListener('drop', (event) => { event.preventDefault(); row.classList.remove('drag-over'); reorderGroups(event.dataTransfer.getData('group-name'), row.dataset.sortGroup); }); }); }
function reorderGroups(source, target) { if (!source || !target || source === target) return; const from = state.groups.indexOf(source); const to = state.groups.indexOf(target); if (from < 0 || to < 0) return; const [group] = state.groups.splice(from, 1); state.groups.splice(to, 0, group); save(); renderCards(); toast('卡组顺序已更新。'); }
function renderFilters() { const tags = ['全部标签', ...new Set(state.cards.flatMap((card) => card.tags))]; fill(els.tagFilter, tags); if (!els.folderFilter.value) els.folderFilter.value = '全部文件夹'; if (els.cardSortSelect && els.cardSortSelect.value !== cardSortDirection) { els.cardSortSelect.value = cardSortDirection; syncCustomSelect(els.cardSortSelect); } }
function fill(select, values) { const old = select.value; select.innerHTML = values.map((value) => `<option>${esc(value)}</option>`).join(''); if (values.includes(old)) select.value = old; syncCustomSelect(select); }
function reviewGroups() { return [...new Set([...(state.groups || []), ...state.cards.map((card) => card.folder).filter(Boolean)])]; }
function reviewGroupLabel(value) { return value === 'all' ? '全部卡组' : value; }
function renderReviewPlanControls() {
  const groups = reviewGroups();
  const values = ['all', ...groups];
  const selected = values.includes(state.reviewPlan?.group) ? state.reviewPlan.group : 'all';
  state.reviewPlan = { ...(state.reviewPlan || {}), group: selected };
  const order = state.reviewPlan.order === 'random' ? 'random' : 'ordered';
  state.reviewPlan.order = order;
  els.reviewOrderMenu?.querySelectorAll('[data-review-order]').forEach((button) => {
    const selectedOrder = button.dataset.reviewOrder === order;
    button.classList.toggle('selected', selectedOrder);
    button.setAttribute('aria-checked', String(selectedOrder));
  });
  [els.reviewGroupSelect].filter(Boolean).forEach((select) => {
    const current = select.value;
    select.innerHTML = values.map((value) => `<option value="${esc(value)}">${esc(reviewGroupLabel(value))}</option>`).join('');
    select.value = values.includes(current) && current === selected ? current : selected;
    syncCustomSelect(select);
  });
}
function toggleReviewOrderMenu() {
  if (!els.reviewOrderMenu || !els.reviewOrderButton) return;
  const open = els.reviewOrderMenu.hidden;
  closeReviewOrderMenu();
  if (open) {
    els.reviewOrderMenu.hidden = false;
    els.reviewOrderButton.setAttribute('aria-expanded', 'true');
  }
}
function closeReviewOrderMenu() {
  if (!els.reviewOrderMenu || !els.reviewOrderButton) return;
  els.reviewOrderMenu.hidden = true;
  els.reviewOrderButton.setAttribute('aria-expanded', 'false');
}
function changeReviewOrder(order) {
  const selected = order === 'random' ? 'random' : 'ordered';
  if (state.reviewPlan?.order === selected) return;
  state.reviewPlan = { ...(state.reviewPlan || {}), order: selected };
  save();
  answered = false;
  answer = [];
  pendingReviewCardId = '';
  pendingCorrect = false;
  reviewDisplayCard = null;
  reviewSnapshot = null;
  index = 0;
  queueKey = '';
  buildQueue(true);
  renderReviewPlanControls();
  renderDock();
  renderStandalone();
  renderReviewHome();
  renderReviewHistory();
  toast(selected === 'random' ? '已切换为随机复习。' : '已切换为按卡组顺序复习。');
}
function changeReviewGroup(group) {
  const selected = ['all', ...reviewGroups()].includes(group) ? group : 'all';
  state.reviewPlan = { ...(state.reviewPlan || {}), group: selected };
  save();
  answered = false;
  answer = [];
  pendingReviewCardId = '';
  pendingCorrect = false;
  reviewDisplayCard = null;
  reviewSnapshot = null;
  index = 0;
  queueKey = '';
  renderReviewPlanControls();
  buildQueue();
  renderDock();
  renderStandalone();
  renderReviewPlan();
  renderReviewHistory();
  toast(`${reviewGroupLabel(selected)}复习计划已切换。`);
}
function reviewGroupCards(group) { return group === 'all' ? state.cards : state.cards.filter((card) => card.folder === group); }
function todayReviewEvents() {
  return state.reviewEvents
    .filter((event) => event.reviewedAt?.slice(0, 10) === today())
    .sort((a, b) => new Date(b.reviewedAt) - new Date(a.reviewedAt));
}
function reviewStateSnapshot(group = state.reviewPlan?.group || 'all') {
  const cards = reviewGroupCards(group);
  const events = todayReviewEvents().filter((event) => reviewEventIsActive(event) && reviewEventMatchesGroup(event, group));
  const due = cards.filter((card) => !card.suspended && isDue(card)).length;
  const planned = Math.max(events.length + due, events.length, 1);
  return { cards, events, done: events.length, due, planned, percent: Math.min(100, Math.round((events.length / planned) * 100)) };
}
function reviewGroupStats(group) {
  return reviewStateSnapshot(group);
}
function renderReviewHome() {
  if (!els.reviewHome || !els.reviewStudy) return;
  els.reviewHome.hidden = reviewStudyActive;
  els.reviewStudy.hidden = !reviewStudyActive;
  if (reviewStudyActive) {
    return;
  }
  const groups = reviewGroups();
  const selected = state.reviewPlan?.group || 'all';
  const current = reviewGroupStats(selected);
  const currentLabel = reviewGroupLabel(selected);
  const groupCards = groups.map((group) => {
    const stats = reviewGroupStats(group);
    const isSelected = group === selected;
    const actionLabel = isSelected ? '学习中' : '学习此书';
    return `<article class="review-book-card ${isSelected ? 'is-selected' : ''}"><div class="review-book-cover"><span>KNOWLEDGE</span><strong>${esc(group)}</strong><small>SPACED REVIEW</small></div><div class="review-book-body"><div class="review-book-actions"><button type="button" class="review-book-more" data-review-group-menu="${esc(group)}" aria-label="${esc(group)}更多操作" aria-expanded="false"><svg><use href="#i-more-vertical"></use></svg></button><div class="review-book-menu" data-review-menu="${esc(group)}"><button type="button" data-review-group-action="rename" data-review-group="${esc(group)}">重命名</button><button type="button" data-review-group-action="relearn" data-review-group="${esc(group)}">重学此卡组</button><button type="button" class="danger" data-review-group-action="delete" data-review-group="${esc(group)}">删除卡组</button></div></div><div class="review-book-title-row"><h3>${esc(group)}</h3><span class="review-book-type">卡组</span></div><p>已完成 ${stats.done} / ${stats.planned} 张</p><div class="review-book-progress"><i style="width:${stats.percent}%"></i></div><div class="review-book-meta"><span>待学习 ${stats.due} 张</span><button type="button" class="review-book-start ${isSelected ? 'is-selected' : ''}" data-review-start="${esc(group)}">${actionLabel}</button></div></div></article>`;
  }).join('');
  els.reviewHome.innerHTML = `<section class="review-welcome"><div><span class="review-eyebrow">LEARNING CENTER</span><h1>今天也来复习一点</h1><p>选择一个卡组，按当前学习计划完成今天的复习。</p></div><div class="review-welcome-stat"><strong>${current.done}</strong><span>今日已复习</span></div></section><section class="review-feature-card"><div class="review-feature-cover"><span>NOTION CARD</span><strong>${esc(currentLabel)}</strong><small>FSRS LEARNING PLAN</small></div><div class="review-feature-content"><div class="review-feature-heading"><div><span class="review-eyebrow">CURRENT PLAN</span><h2>${esc(currentLabel)}</h2></div><span class="review-feature-chip">${current.due ? '今日待学习' : '计划已完成'}</span></div><div class="review-feature-stats"><div><strong>${current.due}</strong><span>待学习</span></div><div><strong>${current.done}</strong><span>已完成</span></div><div><strong>${current.cards.length}</strong><span>卡片总数</span></div></div><div class="review-feature-progress"><div><span>今日完成度</span><b>${current.done} / ${current.planned}</b></div><div class="review-feature-line"><i style="width:${current.percent}%"></i></div></div><button type="button" class="review-start-button" data-review-start="${esc(selected)}">${current.due ? '开始学习' : '查看学习计划'}<kbd>Enter</kbd></button></div></section><section class="review-books-section"><div class="review-section-heading"><div><span class="review-eyebrow">MY CARD GROUPS</span><h2>我的卡组</h2></div><span>${groups.length} 个卡组</span></div><div class="review-book-grid">${groupCards || '<div class="review-home-empty">还没有卡组，先去卡片库创建一组卡片。</div>'}</div></section>`;
}
function handleReviewHomeClick(event) {
  const menuButton = event.target.closest('[data-review-group-menu]');
  if (menuButton) {
    event.stopPropagation();
    const menu = menuButton.parentElement?.querySelector(`[data-review-menu="${CSS.escape(menuButton.dataset.reviewGroupMenu)}"]`);
    const open = menu && !menu.classList.contains('open');
    closeReviewBookMenus();
    if (menu && open) {
      menu.classList.add('open');
      menuButton.setAttribute('aria-expanded', 'true');
    }
    return;
  }
  const action = event.target.closest('[data-review-group-action]');
  if (action) {
    event.stopPropagation();
    closeReviewBookMenus();
    const group = action.dataset.reviewGroup;
    if (action.dataset.reviewGroupAction === 'rename') return openRenameGroup(group);
    if (action.dataset.reviewGroupAction === 'relearn') return relearnCardGroup(group);
    if (action.dataset.reviewGroupAction === 'delete') return deleteCardGroup(group);
  }
  const button = event.target.closest('[data-review-start]');
  if (button) startReviewStudy(button.dataset.reviewStart);
}
function closeReviewBookMenus() {
  $$$('.review-book-menu.open').forEach((menu) => menu.classList.remove('open'));
  $$('.review-book-more[aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
}
function startReviewStudy(group = state.reviewPlan?.group || 'all') {
  const selected = ['all', ...reviewGroups()].includes(group) ? group : 'all';
  if (state.reviewPlan?.group !== selected) changeReviewGroup(selected);
  resetReviewSession();
  reviewStudyActive = true;
  renderReviewHome();
  renderStandalone();
}
function exitReviewStudy() {
  reviewStudyActive = false;
  closeReviewHistory();
  renderReviewHome();
}
function resetReviewSession() {
  answered = false;
  answer = [];
  pendingReviewCardId = '';
  pendingCorrect = false;
  reviewDisposition = 'pending';
  reviewDisplayCard = null;
  reviewSnapshot = null;
  index = 0;
  queue = [];
  queueKey = '';
}
function enhanceSelectsLegacy() { $$$('select').forEach((select) => { if (select.parentElement?.classList.contains('select-shell')) return; const shell = document.createElement('div'); shell.className = `select-shell${select.closest('.formatbar') ? ' format-select-shell' : ''}`; select.parentNode.insertBefore(shell, select); shell.appendChild(select); const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', select.title || select.getAttribute('aria-label') || '选择'); const menu = document.createElement('div'); menu.className = 'select-menu'; menu.setAttribute('role', 'listbox'); shell.append(trigger, menu); trigger.addEventListener('click', (event) => { event.stopPropagation(); const open = shell.classList.toggle('open'); trigger.setAttribute('aria-expanded', String(open)); $$('.select-shell.open').filter((item) => item !== shell).forEach((item) => { item.classList.remove('open'); item.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false'); }); if (open && (shell.classList.contains('format-select-shell') || shell.closest('.modal'))) { const rect = trigger.getBoundingClientRect(); menu.style.position = 'fixed'; menu.style.top = `${rect.bottom + 7}px`; menu.style.left = `${rect.left}px`; menu.style.right = 'auto'; menu.style.minWidth = `${Math.max(rect.width, select.id === 'blockFormat' ? 96 : 120)}px`; } }); menu.addEventListener('click', (event) => { const option = event.target.closest('[data-option]'); if (!option) return; select.value = option.dataset.option; select.dispatchEvent(new Event('change', { bubbles: true })); shell.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); }); select.addEventListener('change', () => syncCustomSelectLegacy(select)); syncCustomSelectLegacy(select); }); document.addEventListener('click', (event) => { if (!event.target.closest('.select-shell')) $$$('.select-shell.open').forEach((shell) => { shell.classList.remove('open'); shell.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false'); }); }); }
function syncCustomSelectLegacy(select) { const shell = select?.parentElement?.classList.contains('select-shell') ? select.parentElement : null; if (!shell) return; const trigger = shell.querySelector('.select-trigger'); const menu = shell.querySelector('.select-menu'); const options = [...select.options]; trigger.textContent = options.find((option) => option.value === select.value)?.textContent || select.value || ''; menu.innerHTML = options.map((option) => `<button type="button" role="option" data-option="${esc(option.value)}" class="${option.value === select.value ? 'selected' : ''}">${esc(option.textContent)}</button>`).join(''); }
function cardMarkup(card) {
  const typeLabel = card.type === 'note' ? '速记词条' : card.type === 'multiple' ? '多选题' : '单选题';
  const score = masteryScore(card);
  const scoreMarkup = score === null ? '<span class="card-score pending">--</span>' : `<span class="card-score">${score}<small>分</small></span>`;
  const query = els.cardSearchInput.value;
  const preview = card.type === 'note' ? highlightHtml(noteMarkdownHtml(card.noteContent), query) : highlightHtml(cardHtml(`答案 ${card.answer.join('、')} · 下次复习 ${formatDate(card.dueAt)}`), query);
  const stamp = state.settings.showStamps !== false && score !== null ? `<div class="card-mastery-stamp ${masteryMeta(card)?.className || ''}"><span>${masteryMeta(card)?.label || '已评价'}</span></div>` : '';
  return `<article class="card-item ${card.type === 'note' ? 'note-card-item' : ''} ${selectedCardIds.has(card.id) ? 'bulk-selected' : ''}" data-card="${card.id}" draggable="true"><div class="card-item-head"><button type="button" class="card-index-editor" title="点击修改卡组内顺序" data-card-order="${card.id}">-${cardPosition(card)}-</button><span class="question-type">${typeLabel}</span>${scoreMarkup}</div><div class="card-item-content"><h3>${highlightHtml(cardHtml(card.question), query)}</h3><div class="card-note-preview ${card.type === 'note' ? 'markdown-preview' : ''}">${preview}</div>${stamp}</div><div class="card-item-foot"><div class="tag-row">${card.tags.map((tag) => renderTagSpan(highlightText(tag, query))).join('')}</div><div class="card-item-actions"><button class="card-edit" title="编辑卡片" data-card-edit="${card.id}"><svg><use href="#i-edit"></use></svg></button><button class="card-reset-mastery" title="重置熟练度" data-card-reset="${card.id}"><svg><use href="#i-reset"></use></svg></button></div></div></article>`;
}
function addMasonryCards(items, reset = false, startIndex = 0) {
  if (reset) els.cardList.innerHTML = '';
  let masonry = els.cardList.querySelector('.card-masonry');
  if (!masonry) {
    masonry = document.createElement('div');
    masonry.className = 'card-masonry';
    els.cardList.appendChild(masonry);
  }
  const columnCount = Math.max(1, Math.min(4, Math.floor(els.cardList.clientWidth / 320) || 1));
  let columns = [...masonry.children];
  while (columns.length < columnCount) {
    const column = document.createElement('div');
    column.className = 'card-masonry-column';
    masonry.appendChild(column);
    columns.push(column);
  }
  const temp = document.createElement('div');
  temp.innerHTML = items.map((card, index) => cardMarkup(card, Math.floor((startIndex + index) / cardPageSize) + 1)).join('');
  [...temp.children].forEach((card, index) => {
    card.dataset.cardBatch = String(Math.floor((startIndex + index) / cardPageSize) + 1);
    const target = columns.reduce((shortest, column) => column.offsetHeight < shortest.offsetHeight ? column : shortest, columns[0]);
    target.appendChild(card);
  });
}
function renderCards(resetPage = false, append = false, jump = false) {
  if (resetPage) { cardPage = 1; cardLoadedThrough = 1; }
  if (append) { cardLoadedThrough = Math.min(cardBatchTotal, cardLoadedThrough + 1); cardPage = cardLoadedThrough; }
  renderFilters(); renderCardSummary(); renderCardGroups();
  const list = sortCardsForDisplay(state.cards.filter(cardMatches));
  cardBatchTotal = Math.max(1, Math.ceil(list.length / cardPageSize));
  cardPage = Math.min(Math.max(1, cardPage), cardBatchTotal);
  cardLoadedThrough = Math.min(Math.max(1, cardLoadedThrough), cardBatchTotal);
  const visibleThrough = jump ? cardPage : cardLoadedThrough;
  const pageItems = list.slice(0, visibleThrough * cardPageSize);
  if (append) {
    const nextItems = list.slice((cardLoadedThrough - 1) * cardPageSize, cardLoadedThrough * cardPageSize);
    $('#cardLoadMore')?.remove();
    addMasonryCards(nextItems, false, (cardLoadedThrough - 1) * cardPageSize);
    if (cardLoadedThrough < cardBatchTotal) els.cardList.insertAdjacentHTML('beforeend', '<div class="card-load-more" id="cardLoadMore"><button type="button" class="card-load-more-glass" data-load-more><strong>显示更多</strong><span>继续浏览下一批卡片</span></button></div>');
    renderCardWheel(cardBatchTotal);
    bindCardSorting();
    updateCardLoadMore();
    return;
  }
  const folderName = els.folderFilter.value || '全部文件夹';
  $('#cardListTitle').textContent = folderName === '全部文件夹' ? '全部卡片' : folderName;
  $('#cardListMeta').textContent = `${list.length} 张卡片`;
  renderCardWheel(cardBatchTotal);
  if (pageItems.length) addMasonryCards(pageItems, true);
  else els.cardList.innerHTML = '<div class="empty-state"><strong>没有符合条件的卡片</strong><span>调整筛选条件或新建一张复习卡片。</span></div>';
  if (list.length && cardLoadedThrough < cardBatchTotal) {
    els.cardList.insertAdjacentHTML('beforeend', '<div class="card-load-more" id="cardLoadMore"><button type="button" class="card-load-more-glass" data-load-more><strong>显示更多</strong><span>继续浏览下一批卡片</span></button></div>');
  }
  els.cardList.onclick = (event) => {
    if (event.target.closest('[data-load-more]')) { if (cardLoadedThrough < cardBatchTotal) renderCards(false, true); return; }
    const edit = event.target.closest('[data-card-edit]');
    if (edit) return openCard(edit.dataset.cardEdit);
    const reset = event.target.closest('[data-card-reset]');
    if (reset) return resetCardMastery(reset.dataset.cardReset);
    const order = event.target.closest('[data-card-order]');
    if (order) return beginCardOrderEdit(order);
    const row = event.target.closest('[data-card]');
    if (!row) return;
    const cardId = row.dataset.card;
    if (selectedCardIds.has(cardId)) selectedCardIds.delete(cardId); else selectedCardIds.add(cardId);
    state.selectedCardId = cardId;
    save();
    renderCards();
  };
  bindCardSorting(); updateBulkSelection(list);
  updateCardLoadMore();
}
function scheduleCardRender() {
  clearTimeout(cardRenderTimer);
  cardRenderTimer = setTimeout(() => renderCards(true), 180);
}
function handleCardListScroll() { updateCardLoadMore(); }
function updateCardLoadMore() { const overlay = $('#cardLoadMore'); if (!overlay) return; const nearBottom = els.cardList.scrollHeight - els.cardList.scrollTop - els.cardList.clientHeight < 180; overlay.classList.toggle('is-visible', nearBottom); }
function selectCardBatch(page) {
  const target = Math.max(1, Math.min(cardBatchTotal, Number(page) || 1));
  cardPage = target;
  cardLoadedThrough = target;
  renderCards(false, false, true);
  requestAnimationFrame(() => {
    const anchor = els.cardList.querySelector(`[data-card-batch="${target}"]`);
    if (anchor) {
      const listRect = els.cardList.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      els.cardList.scrollTo({ top: Math.max(0, els.cardList.scrollTop + anchorRect.top - listRect.top - 18), behavior: 'smooth' });
    }
  });
}
function renderCardWheel(totalPages) {
  if (!els.cardPageWheel || !els.cardWheelRail) return;
  els.cardPageWheel.hidden = totalPages <= 1;
  if (totalPages <= 1) return;
  const start = Math.max(1, Math.min(totalPages - 4, cardPage - 2));
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => start + index);
  els.cardWheelRail.innerHTML = pages.map((page, index) => `<button type="button" class="card-wheel-tick ${page === cardPage ? 'active' : ''}" style="--wheel-index:${index}" data-wheel-page="${page}" aria-label="第 ${page} 批">${page}</button>`).join('');
  els.cardWheelLabel.textContent = `${cardPage} / ${totalPages}`;
}
function bindCardWheel() {
  if (!els.cardPageWheel || els.cardPageWheel.dataset.bound === 'true') return;
  els.cardPageWheel.dataset.bound = 'true';
  els.cardPageWheel.title = '滚轮切换批次；中键拖动定位';
  els.cardPageWheel.addEventListener('click', (event) => { const button = event.target.closest('[data-wheel-page]'); if (button) selectCardBatch(button.dataset.wheelPage); });
  els.cardPageWheel.addEventListener('wheel', (event) => { if (Math.abs(event.deltaY) < 2) return; event.preventDefault(); selectCardBatch(cardPage + (event.deltaY > 0 ? 1 : -1)); }, { passive: false });
  els.cardPageWheel.addEventListener('pointerdown', (event) => { if (event.button !== 1) return; event.preventDefault(); cardWheelDrag = { startY: event.clientY, startPage: cardPage }; els.cardPageWheel.setPointerCapture?.(event.pointerId); });
  els.cardPageWheel.addEventListener('pointermove', (event) => { if (!cardWheelDrag) return; const delta = Math.round((cardWheelDrag.startY - event.clientY) / 28); if (delta) selectCardBatch(cardWheelDrag.startPage + delta); });
  els.cardPageWheel.addEventListener('pointerup', () => { cardWheelDrag = null; });
  els.cardPageWheel.addEventListener('pointercancel', () => { cardWheelDrag = null; });
}
function bindCardSorting() { $$$('#cardList [data-card]').forEach((row) => { row.addEventListener('dragstart', (event) => { if (event.target.closest('button')) { event.preventDefault(); return; } event.dataTransfer.setData('card-id', row.dataset.card); row.classList.add('dragging'); }); row.addEventListener('dragend', () => row.classList.remove('dragging')); row.addEventListener('dragover', (event) => { event.preventDefault(); row.classList.add('drag-over'); }); row.addEventListener('dragleave', () => row.classList.remove('drag-over')); row.addEventListener('drop', (event) => { event.preventDefault(); row.classList.remove('drag-over'); reorderCards(event.dataTransfer.getData('card-id'), row.dataset.card); }); }); }
function reorderCards(source, target) {
  if (!source || !target || source === target) return;
  const sourceCard = state.cards.find((card) => card.id === source);
  const targetCard = state.cards.find((card) => card.id === target);
  if (!sourceCard || !targetCard) return;
  if ((sourceCard.folder || '未分组') !== (targetCard.folder || '未分组')) return toast('卡片只能在同一卡组内排序。');
  const items = groupCards(sourceCard.folder || '未分组');
  const targetPosition = Math.max(1, items.findIndex((card) => card.id === target) + 1);
  pendingCardOrder = { cardId: source, target: targetPosition };
  openDeleteConfirm('card-order', source, `调整卡片顺序为 -${targetPosition}-？`, '同卡组其他卡片会自动顺延。', '确认');
}
function updateBulkSelection(list = state.cards.filter(cardMatches)) { const count = selectedCardIds.size; els.selectedCardCount.textContent = `已选择 ${count} 张`; els.bulkSelectionBar.classList.toggle('active', count > 0); els.bulkDeleteCardsButton.disabled = count === 0; $('#selectAllCardsButton').classList.toggle('active', list.length > 0 && list.every((card) => selectedCardIds.has(card.id))); }
function toggleSelectAllCards() { const list = state.cards.filter(cardMatches); if (list.every((card) => selectedCardIds.has(card.id))) list.forEach((card) => selectedCardIds.delete(card.id)); else list.forEach((card) => selectedCardIds.add(card.id)); renderCards(); }
function clearCardSelection() { selectedCardIds.clear(); renderCards(); }
function bulkDeleteCards() { const ids = new Set(selectedCardIds); if (!ids.size) return; openDeleteConfirm('cards', [...ids].join(','), `删除 ${ids.size} 张卡片？`, '选中的卡片将移入回收站，之后仍可恢复。'); }
function clearCardFilters() { els.cardSearchInput.value = ''; els.folderFilter.value = '全部文件夹'; els.tagFilter.value = '全部标签'; els.cardTypeFilter.value = '全部类型'; els.cardStatusFilter.value = '全部熟练度'; [els.folderFilter, els.tagFilter, els.cardTypeFilter, els.cardStatusFilter].forEach(syncCustomSelect); renderCards(); }
function resetCardMastery(cardId) { const card = state.cards.find((item) => item.id === cardId); if (!card) return; const resetAt = new Date().toISOString(); card.mastery = ''; card.noteRating = ''; card.suspended = false; card.resetAt = resetAt; card.fsrs = window.knowledgeFSRS.reset(); card.dueAt = card.fsrs.due; card.interval = card.fsrs.scheduledDays; card.reviews = card.fsrs.reps; card.updatedAt = resetAt; state.reviewEvents = state.reviewEvents.filter((event) => event.cardId !== card.id); resetReviewSession(); save(); refresh(); toast('熟练度已重置，卡片重新加入学习计划。'); }
function confirmRelearnCardGroup(group) {
  const cards = state.cards.filter((card) => card.folder === group);
  const resetAt = new Date().toISOString();
  const cardIds = new Set(cards.map((card) => card.id));
  cards.forEach((card) => {
    card.mastery = '';
    card.noteRating = '';
    card.suspended = false;
    card.resetAt = resetAt;
    card.fsrs = window.knowledgeFSRS.reset();
    card.dueAt = card.fsrs.due;
    card.interval = card.fsrs.scheduledDays;
    card.reviews = card.fsrs.reps;
    card.updatedAt = new Date().toISOString();
  });
  state.reviewEvents = state.reviewEvents.filter((event) => !cardIds.has(event.cardId));
  resetReviewSession();
  save();
  refresh();
  toast(`“${group}”已重新纳入学习计划。`);
}
function trashCard(cardId) { const card = state.cards.find((item) => item.id === cardId); if (!card) return; openDeleteConfirm('card', cardId, `删除卡片“${card.question}”？`, '卡片将移入回收站，之后仍可恢复。'); }
function openCreateGroup() { $('#createGroupModal').dataset.editingGroup = ''; $('#cardGroupModalTitle').textContent = '新建卡组'; $('#cardGroupModalSubtitle').textContent = '将相近主题的卡片集中管理'; $('#saveGroupButton').textContent = '创建卡组'; $('#createGroupName').value = ''; $('#createGroupModal').showModal(); $('#createGroupName').focus(); }
function openRenameGroup(group) { $('#createGroupModal').dataset.editingGroup = group; $('#cardGroupModalTitle').textContent = '重命名卡组'; $('#cardGroupModalSubtitle').textContent = '更新卡组名称后，卡片和学习计划会自动同步'; $('#saveGroupButton').textContent = '保存名称'; $('#createGroupName').value = group; $('#createGroupModal').showModal(); $('#createGroupName').focus(); }
function saveGroup(event) { event.preventDefault(); const name = $('#createGroupName').value.trim(); const oldName = $('#createGroupModal').dataset.editingGroup || ''; if (!name) return toast('请输入卡组名称。'); if (state.groups.some((group) => group !== oldName && group === name)) return toast('卡组已存在。'); if (oldName) { state.groups = state.groups.map((group) => group === oldName ? name : group); state.cards.forEach((card) => { if (card.folder === oldName) { card.folder = name; if (card.tags.includes(oldName)) card.tags = card.tags.map((tag) => tag === oldName ? name : tag); } }); state.reviewEvents.forEach((event) => { if (event.folder === oldName) event.folder = name; }); if (state.reviewPlan?.group === oldName) state.reviewPlan.group = name; } else { state.groups.push(name); } save(); $('#createGroupModal').close(); renderCards(); refresh(); toast(oldName ? '卡组名称已更新。' : '卡组已创建。'); }
function relearnCardGroup(group) {
  const cards = state.cards.filter((card) => card.folder === group);
  if (!cards.length) return toast('该卡组暂无卡片。');
  openDeleteConfirm('relearn-card-group', group, `重新学习“${group}”？`, `将重置该卡组的 ${cards.length} 张卡片，并重新纳入学习计划。`, '确认重学');
}

function renderQuestionLegacy(box, card, standalone) { const shell = box.closest('.review-shell'); if (!card) { shell?.classList.add('is-complete'); box.innerHTML = '<div class="review-complete"><div class="complete-mark"><svg><use href="#i-review"></use></svg></div><div class="completion-kicker">REVIEW SESSION</div><h2>今日复习已完成</h2><p>本次复习计划已经完成，明天继续保持。</p><button class="secondary-action" data-view="cards">查看卡片库</button></div>'; box.querySelector('[data-view]')?.addEventListener('click', () => view('cards')); els.nextButton.disabled = true; return; } shell?.classList.remove('is-complete'); const selected = Array.isArray(answer) ? answer : []; const head = `<div class="tag-row"><span class="tag">${esc(card.tags[0] || '未分组')}</span><span class="question-type">${card.type === 'note' ? '速记词条' : card.type === 'multiple' ? '多选题' : '单选题'}</span></div><div class="question-title">${cardHtml(card.question)}</div>`; if (card.type === 'note') { box.innerHTML = `${head}<div class="note-answer-content">${cardHtml(card.noteContent)}</div><div class="note-rating-block"><p>根据回忆程度选择反馈</p><div class="note-rating-actions">${[['familiar', '熟悉'], ['fuzzy', '模糊'], ['forgot', '没印象']].map(([value, label]) => `<button class="note-rating ${answered ? 'is-disabled' : ''}" data-rating="${value}" ${answered ? 'disabled' : ''}>${label}</button>`).join('')}</div></div>${answered && card.noteContent ? `<div class="explanation"><strong>速记内容</strong>${cardHtml(card.noteContent)}</div>` : ''}`; box.querySelectorAll('[data-rating]').forEach((button) => button.addEventListener('click', () => answerNoteCard(card, button.dataset.rating))); } else { box.innerHTML = `${head}<div class="options-block"></div>${answered && card.explanation ? `<div class="explanation"><strong>解析</strong>${cardHtml(card.explanation)}</div>` : ''}`; const block = box.querySelector('.options-block'); OPTS.forEach((key) => { const button = document.createElement('button'); button.className = 'option-button'; if (!answered && selected.includes(key)) button.classList.add('selected'); if (answered && card.answer.includes(key)) button.classList.add('correct'); if (answered && selected.includes(key) && !card.answer.includes(key)) button.classList.add('wrong'); button.innerHTML = `<span class="key">${key}</span><span>${cardHtml(card.options[key] || '未填写选项')}</span>`; button.disabled = answered; button.addEventListener('click', () => answerCard(card, key)); block.appendChild(button); }); if (card.type === 'multiple' && !answered) { const submit = document.createElement('button'); submit.className = 'next-button submit-answer'; submit.textContent = '提交答案'; submit.disabled = !selected.length; submit.addEventListener('click', () => finalizeMultiple(card)); box.appendChild(submit); } } els.nextButton.disabled = !answered; if (standalone && answered) { const nextButton = document.createElement('button'); nextButton.className = 'next-button'; nextButton.textContent = '下一题'; nextButton.addEventListener('click', next); box.appendChild(nextButton); } }
function beginCardOrderEdit(button) {
  const cardId = button.dataset.cardOrder;
  const card = state.cards.find((item) => item.id === cardId);
  if (!card || button.querySelector('input')) return;
  const current = cardPosition(card);
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.max = String(groupCards(card.folder || '未分组').length);
  input.value = String(current);
  input.className = 'card-index-input';
  button.textContent = '';
  button.appendChild(input);
  input.focus();
  input.select();
  const finish = () => {
    const value = Number(input.value);
    button.textContent = `-${current}-`;
    if (!Number.isFinite(value)) return;
    const target = Math.max(1, Math.min(Number(input.max), Math.round(value)));
    if (target === current) return;
    pendingCardOrder = { cardId, target, current };
    openDeleteConfirm('card-order', cardId, `调整卡片顺序为 -${target}-？`, `当前顺序为 -${current}-，同卡组其他卡片会自动顺延。`, '确认');
  };
  input.addEventListener('blur', finish, { once: true });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } if (event.key === 'Escape') { event.preventDefault(); input.value = String(current); input.blur(); } });
}

function changeCardOrder(cardId) {
  const card = state.cards.find((item) => item.id === cardId);
  if (!card) return;
  const items = groupCards(card.folder || '未分组');
  const current = cardPosition(card);
  const input = window.prompt(`请输入新的卡组内顺序（1-${items.length}）：`, String(current));
  if (input === null) return;
  const value = Number(input);
  if (!Number.isFinite(value)) return toast('请输入有效的卡组内顺序。');
  const target = Math.max(1, Math.min(items.length, Math.round(value)));
  if (target === current) return;
  pendingCardOrder = { cardId, target, current };
  openDeleteConfirm('card-order', cardId, `调整卡片顺序为 -${target}-？`, `当前顺序为 -${current}-，同卡组其他卡片会自动顺延。`, '确认');
}

function confirmCardOrderChange() {
  const change = pendingCardOrder;
  pendingCardOrder = null;
  if (!change) return;
  const card = state.cards.find((item) => item.id === change.cardId);
  if (!card) return;
  const items = groupCards(card.folder || '未分组');
  const current = cardPosition(card);
  const target = Math.max(1, Math.min(items.length, Math.round(change.target)));
  if (target === current) return;
  if (target < current) items.forEach((item) => { if (item.id !== card.id && item.order >= target && item.order < current) item.order += 1; });
  else items.forEach((item) => { if (item.id !== card.id && item.order > current && item.order <= target) item.order -= 1; });
  card.order = target;
  ensureCardOrder(state.cards);
  save();
  renderCards();
  toast(`已调整为卡组第 ${target} 张。`);
}
function cardTypeLabel(type) {
  return type === 'note' ? '速记词条' : type === 'multiple' ? '多选题' : type === 'truefalse' ? '判断题' : '单选题';
}
function cardOptionKeys(card) {
  if (card.type === 'truefalse') return TRUE_FALSE_OPTS;
  return OPTS;
}
function cardMetadataMarkup(card, className = 'card-meta') {
  if (!card || card.type === 'note') return '';
  const items = [];
  if (Number.isFinite(card.correctRate)) items.push(`<span class="card-meta-rate">全站正确率 ${Number(card.correctRate).toFixed(1).replace(/\.0$/, '')}%</span>`);
  if (card.knowledgePoint) items.push(`<span class="card-meta-point">考点：${esc(card.knowledgePoint)}</span>`);
  if (card.source) items.push(`<span class="card-meta-source">来源：${cardHtml(card.source)}</span>`);
  return items.length ? `<div class="${className}" data-card-meta="true">${items.join('')}</div>` : '';
}
function openCard(cardId = null) {
  ensureBatchModeButton();
  ensureCardEditorFields();
  const card = cardId ? state.cards.find((item) => item.id === cardId) : null;
  els.cardForm.reset();
  els.cardModal.dataset.editingId = card?.id || '';
  els.cardForm.dataset.autoTag = card ? 'false' : 'true';
  if (card) batchCardMode = false;
  const modeButton = $('#batchModeButton');
  modeButton.classList.toggle('active', batchCardMode);
  modeButton.textContent = batchCardMode ? '批量制卡中' : '批量制卡';
  modeButton.disabled = Boolean(card);
  els.cardModal.classList.toggle('batch-mode', batchCardMode);
  $('#cardModalTitle').textContent = card ? '编辑复习卡片' : '新建复习卡片';
  fill(els.cardGroupSelect, [...new Set([...(state.groups || []), ...state.cards.map((item) => item.folder)])]);
  const selectedGroup = els.folderFilter?.value;
  const defaultGroup = selectedGroup && selectedGroup !== '全部文件夹' && state.groups.includes(selectedGroup) ? selectedGroup : state.groups?.[0] || '学习科学';
  els.cardGroupSelect.value = card?.folder || defaultGroup;
  syncCustomSelect(els.cardGroupSelect);
  $('#cardTypeSelect').value = card?.type || 'single';
  syncCustomSelect(els.cardTypeSelect);
  $('#questionInput').value = card?.question || state.extractedText || '';
  $('#optionA').value = card?.type === 'truefalse' ? '' : card?.options.A || '';
  $('#optionB').value = card?.type === 'truefalse' ? '' : card?.options.B || '';
  $('#optionC').value = card?.options.C || '';
  $('#optionD').value = card?.options.D || '';
  $('#noteContentInput').value = card?.noteContent || '';
  $('#explanationInput').value = card?.explanation || '';
  $('#correctRateInput').value = Number.isFinite(card?.correctRate) ? card.correctRate : '';
  $('#knowledgePointInput').value = card?.knowledgePoint || '';
  $('#sourceInput').value = card?.source || '';
  $('#tagInput').value = (card?.tags || [els.cardGroupSelect.value || '未分组']).join(', ');
  renderCardTypeFields();
  renderAnswerChoices(card?.answer || []);
  els.cardModal.showModal();
}
function renderCardTypeFields() {
  const type = els.cardTypeSelect.value;
  const note = type === 'note';
  const trueFalse = type === 'truefalse';
  $('#cardOptionsGrid').classList.toggle('hidden', note || trueFalse);
  $('#cardAnswersField').classList.toggle('hidden', note);
  $('#noteContentField').classList.toggle('hidden', !note);
  $('#explanationField').classList.toggle('hidden', note);
  $('#cardMetadataField')?.classList.toggle('hidden', note);
  if (!note) renderAnswerChoices();
}
function renderAnswerChoices(selected = []) {
  const type = els.cardTypeSelect.value;
  const multiple = type === 'multiple';
  const options = type === 'truefalse' ? [['A', '正确'], ['B', '错误']] : OPTS.map((key) => [key, key]);
  els.answerChoices.innerHTML = options.map(([key, label]) => `<label><input type="${multiple ? 'checkbox' : 'radio'}" name="answer" value="${key}" ${selected.includes(key) ? 'checked' : ''}><span>${label}</span></label>`).join('');
}
function saveCard(event) {
  event.preventDefault();
  const type = els.cardTypeSelect.value;
  const folder = els.cardGroupSelect.value || '未分组';
  const tags = String($('#tagInput').value || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  const options = type === 'truefalse' ? { A: '正确', B: '错误', C: '', D: '' } : { A: $('#optionA').value.trim(), B: $('#optionB').value.trim(), C: $('#optionC').value.trim(), D: $('#optionD').value.trim() };
  const selected = [...document.querySelectorAll('input[name="answer"]:checked')].map((input) => input.value);
  const question = $('#questionInput').value.trim();
  const rateText = $('#correctRateInput').value.trim();
  const correctRate = rateText === '' ? null : Number(rateText);
  if (!question) return toast('请填写题干或词条。');
  if (type === 'note') {
    if (!$('#noteContentInput').value.trim()) return toast('请填写速记内容。');
  } else {
    if (!selected.length) return toast('请选择正确答案。');
    if (type === 'multiple' && selected.length < 2) return toast('多选题至少选择两个答案。');
    if (rateText !== '' && (!Number.isFinite(correctRate) || correctRate < 0 || correctRate > 100)) return toast('全站正确率必须在 0 到 100 之间。');
  }
  const editingId = els.cardModal.dataset.editingId || '';
  const existing = editingId ? state.cards.find((item) => item.id === editingId) : null;
  const data = normCard({ id: editingId || id('card'), order: existing?.order || 0, type, folder, question, options, answer: selected, noteContent: $('#noteContentInput').value.trim(), explanation: $('#explanationInput').value.trim(), correctRate, knowledgePoint: $('#knowledgePointInput').value.trim(), source: $('#sourceInput').value.trim(), tags: tags.length ? tags : [folder] });
  if (type === 'note') { data.correctRate = null; data.knowledgePoint = ''; data.source = ''; }
  const old = state.cards.findIndex((item) => item.id === data.id);
  if (old >= 0) state.cards[old] = { ...state.cards[old], ...data, order: state.cards[old].order || data.order || 0 };
  else state.cards.push(data);
  state.groups = [...new Set([...(state.groups || []), folder])];
  state.selectedCardId = data.id;
  save();
  answered = false;
  refresh();
  if (old >= 0 || !batchCardMode) {
    els.cardModal.close();
    toast(old >= 0 ? '卡片已更新。' : '卡片已保存。');
  } else {
    resetBatchCardForm();
    toast('卡片已保存，可继续创建下一张。');
  }
}
function cardMarkup(card) {
  const typeLabel = cardTypeLabel(card.type);
  const scoreMarkup = `<span class="card-review-count">${reviewCountLabel(card)}</span>`;
  const query = els.cardSearchInput.value;
  const preview = card.type === 'note' ? highlightHtml(noteMarkdownHtml(card.noteContent), query) : highlightHtml(cardHtml(`答案 ${card.answer.join('、')} · 下次复习 ${formatDate(card.dueAt)}`), query);
  const stamp = state.settings.showStamps !== false && masteryScore(card) !== null ? `<div class="card-mastery-stamp ${masteryMeta(card)?.className || ''}"><span>${masteryMeta(card)?.label || '已评价'}</span></div>` : '';
  return `<article class="card-item ${card.type === 'note' ? 'note-card-item' : ''} ${selectedCardIds.has(card.id) ? 'bulk-selected' : ''}" data-card="${card.id}" draggable="true"><div class="card-item-head"><button type="button" class="card-index-editor" title="点击修改卡组内顺序" data-card-order="${card.id}">-${cardPosition(card)}-</button><span class="question-type">${typeLabel}</span>${scoreMarkup}</div><div class="card-item-content"><h3>${highlightHtml(cardHtml(card.question), query)}</h3>${cardMetadataMarkup(card, 'card-meta-grid')}<div class="card-note-preview ${card.type === 'note' ? 'markdown-preview' : ''}">${preview}</div>${stamp}</div><div class="card-item-foot"><div class="tag-row">${card.tags.map((tag) => renderTagSpan(highlightText(tag, query))).join('')}</div><div class="card-item-actions"><button class="card-edit" title="编辑卡片" data-card-edit="${card.id}"><svg><use href="#i-edit"></use></svg></button><button class="card-reset-mastery" title="重置熟练度" data-card-reset="${card.id}"><svg><use href="#i-reset"></use></svg></button></div></div></article>`;
}
function cardMatches(card) {
  const query = els.cardSearchInput.value.trim().toLowerCase();
  const folder = els.folderFilter.value;
  const tag = els.tagFilter.value;
  const type = els.cardTypeFilter.value;
  const status = els.cardStatusFilter.value;
  const mastery = card.mastery || '';
  const searchable = [card.question, card.folder, card.tags.join(' '), card.noteContent, card.knowledgePoint, card.source].join(' ').toLowerCase();
  return (!query || searchable.includes(query))
    && (!folder || folder === '全部文件夹' || card.folder === folder)
    && (!tag || tag === '全部标签' || card.tags.includes(tag))
    && (!type || type === '全部类型' || card.type === type)
    && (!status || status === '全部熟练度' || (status === 'evaluated' ? Boolean(mastery) : status === 'unrated' ? !mastery : mastery === status));
}