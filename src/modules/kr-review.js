/**
 * kr-review.js - Review sessions, FSRS, heatmaps, progress
 * Dependencies: kr-core.js, kr-state.js, kr-cards.js
 * Provides: buildQueue, renderDock, renderStandalone, answerCard, next,
 *           recordReview, flashcardReview, renderQuestion, renderHeatmaps,
 *           renderReviewPlanControls, renderProgress, streak, toast,
 *           todayReviewEvents, totalReviews, handleExternalLinkClick
 */
function buildQueue(force = false) {
  const activeGroup = state.reviewPlan?.group || 'all';
  const order = state.reviewPlan?.order === 'random' ? 'random' : 'ordered';
  const inPlan = (item) => activeGroup === 'all' || item.folder === activeGroup || state.cards.find((card) => card.id === item.cardId)?.folder === activeGroup;
  const reviewedToday = todayReviewEvents().filter((event) => reviewEventIsActive(event) && inPlan(event)).length;
  const remaining = Math.max(0, (Number(state.settings.dailyLimit) || 50) - reviewedToday);
  const due = state.cards.filter((card) => inPlan(card) && !card.suspended && isDue(card));
  const reviewCards = due.filter((card) => card.fsrs?.state !== 'New');
  const newCards = due.filter((card) => card.fsrs?.state === 'New');
  const newReviewedToday = todayReviewEvents().filter((event) => reviewEventIsActive(event) && event.previousState === 'New' && inPlan(event)).length;
  const allowedNew = Math.max(0, (Number(state.settings.dailyNewLimit) || 0) - newReviewedToday);
  const priority = ['new', 'review', 'mixed'].includes(state.settings.reviewPriority) ? state.settings.reviewPriority : 'mixed';
  const limitedNewCards = newCards.slice(0, allowedNew);
  const candidates = priority === 'new' ? [...limitedNewCards, ...reviewCards] : priority === 'review' ? [...reviewCards, ...limitedNewCards] : [...reviewCards, ...limitedNewCards];
  const candidateKey = `${priority}:${candidates.map((card) => `${card.id}:${card.dueAt}:${card.reviews}:${card.fsrs?.state || ''}`).join('|')}`;
  const nextKey = `${activeGroup}:${order}:${remaining}:${candidateKey}`;
  if (!force && nextKey === queueKey) return;
  const groupOrder = new Map((state.groups || []).map((group, position) => [group, position]));
  if (order === 'ordered' && priority === 'mixed') {
    candidates.sort((a, b) => (groupOrder.get(a.folder) ?? 9999) - (groupOrder.get(b.folder) ?? 9999) || cardPosition(a) - cardPosition(b) || new Date(a.dueAt) - new Date(b.dueAt));
  } else if (order === 'ordered') {
    const rank = new Map(candidates.map((card, position) => [card.id, position]));
    candidates.sort((a, b) => rank.get(a.id) - rank.get(b.id) || (groupOrder.get(a.folder) ?? 9999) - (groupOrder.get(b.folder) ?? 9999) || cardPosition(a) - cardPosition(b));
  } else {
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const target = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[target]] = [candidates[target], candidates[i]];
    }
  }
  queue = candidates.slice(0, remaining);
  queueKey = nextKey;
  if (index >= queue.length) index = 0;
}
function renderDock() { if (!answered) buildQueue(); renderQuestion(els.questionCard, reviewDisplayCard || queue[index], false); progress(); }
function renderStandalone() { if (!answered) buildQueue(); renderQuestion($('#standaloneQuestion'), reviewDisplayCard || queue[index], true); progress(); }
function finalizeMultiple(card) { if (!answer.length) return toast('请至少选择一个选项。'); answerCard(card, null, true); }
function answerNoteCardLegacy(card, rating) { if (answered) return; recordReviewLegacy(card, rating); }
function recordReviewLegacy(card, rating) { recordReview(card, rating === 'familiar' ? 'Good' : rating === 'fuzzy' ? 'Hard' : 'Again'); }
function next() { if (Date.now() - lastNext < 450 || pendingReviewCardId) return; lastNext = Date.now(); answered = false; answer = []; pendingCorrect = false; reviewDisposition = 'pending'; reviewDisplayCard = null; index = 0; buildQueue(); renderDock(); renderStandalone(); renderReviewPlan(); }
function retryCurrentReview() { if (!reviewDisplayCard) return; answered = false; answer = []; pendingCorrect = false; reviewDisposition = 'pending'; pendingReviewCardId = ''; reviewSnapshot = null; renderDock(); renderStandalone(); }
function reviewActionButtons(card) { return `<div class="review-space-actions"><button type="button" class="review-action-button retry-review-action" data-review-action="retry">再选一次</button><button type="button" class="review-action-button primary-review-action" data-review-action="next">${card.type === 'note' ? '下一条' : '下一题'}</button></div>`; }
function reviewDispositionActions(card) {
  if (!answered || pendingReviewCardId !== card.id) return '';
  return `<div class="review-disposition-panel"><p>答题后的处理方式</p><div class="review-disposition-actions"><button type="button" class="review-disposition remove-missed" data-review-disposition="remove"><strong>移除错题</strong><span>答对后不再安排</span></button><button type="button" class="review-disposition continue-review" data-review-disposition="continue"><strong>继续复习</strong><span>答对答错都保留</span></button></div></div>`;
}
function handleReviewDisposition(card, disposition) {
  if (!pendingReviewCardId || pendingReviewCardId !== card.id) return;
  reviewDisposition = disposition === 'remove' ? 'remove' : 'continue';
  if (disposition === 'remove') return recordReview(card, 'Easy', true);
  recordReview(card, pendingCorrect ? 'Good' : 'Again', false, true);
}
function reviewEventMatchesPlan(event) {
  const activeGroup = state.reviewPlan?.group || 'all';
  return reviewEventMatchesGroup(event, activeGroup) && reviewEventIsActive(event);
}
function todayPlanEvents() {
  return todayReviewEvents().filter(reviewEventMatchesPlan);
}
function closeReviewHistory() {
  if (!els.reviewHistoryPopover) return;
  els.reviewHistoryPopover.hidden = true;
  els.reviewHistoryButton?.setAttribute('aria-expanded', 'false');
}
function toggleReviewHistory(event) {
  event?.stopPropagation();
  if (!els.reviewHistoryPopover) return;
  const open = els.reviewHistoryPopover.hidden;
  els.reviewHistoryPopover.hidden = !open;
  els.reviewHistoryButton?.setAttribute('aria-expanded', String(open));
}
function reviewPlanItems() {
  const items = [];
  const seen = new Set();
  todayPlanEvents().reverse().forEach((event) => {
    if (!event.cardId || seen.has(event.cardId)) return;
    seen.add(event.cardId);
    items.push({ id: event.cardId, title: event.question || '已删除卡片', completed: true });
  });
  queue.forEach((card) => {
    if (seen.has(card.id)) return;
    seen.add(card.id);
    items.push({ id: card.id, title: card.question || '未命名卡片', completed: false });
  });
  return items;
}
function renderReviewPlan() {
  if (!els.reviewPlanList) return;
  const items = reviewPlanItems();
  els.reviewPlanMeta.textContent = `${items.length} 张卡片`;
  if (!items.length) {
    els.reviewPlanList.innerHTML = '<div class="review-plan-empty"><svg><use href="#i-check"></use></svg><strong>今日学习计划已完成</strong><span>当前卡组暂无待学习卡片。</span></div>';
    return;
  }
  els.reviewPlanList.innerHTML = items.map((item, i) => `<div class="review-plan-item ${item.completed ? 'is-complete' : ''}"><span class="review-plan-index">${i + 1}</span><span class="review-plan-title">${esc(item.title)}</span>${item.completed ? '<svg aria-label="已完成"><use href="#i-check"></use></svg>' : ''}</div>`).join('');
}
function progress() {
  const done = todayPlanEvents().length;
  const planned = Math.max(done + queue.length, done, 1);
  const percent = Math.min(100, Math.round((done / planned) * 100));
  els.progressRing.style.background = `conic-gradient(var(--green) ${percent * 3.6}deg, #ece9e4 0deg)`;
  els.progressRing.querySelector('span').textContent = `${percent}%`;
  els.remainingText.textContent = `已复习 ${done} / ${planned} 张`;
  els.reviewProgressText.textContent = queue.length ? `待复习 ${queue.length} 张` : '今日已完成';
  $('#standaloneProgress').textContent = `${done} / ${planned}`;
  $('#standalonePercent').textContent = `${percent}%`;
  $('#standaloneBar').style.width = `${percent}%`;
}

function reviewRatingMeta(event) {
  const rating = event.rating || '';
  if (rating === 'Easy') return { label: '太简单', className: 'too-easy' };
  if (rating === 'Good') return { label: '熟悉', className: 'familiar' };
  if (rating === 'Hard') return { label: '模糊', className: 'fuzzy' };
  return { label: '忘记了', className: 'forgot' };
}
function renderReviewHistory() {
  if (!els.reviewHistory) return;
  const events = todayReviewEvents().filter(reviewEventIsActive);
  els.reviewHistoryMeta.textContent = `${events.length} 张卡片`;
  els.reviewHistoryCount.textContent = events.length;
  if (!events.length) {
    els.reviewHistory.innerHTML = '<div class="review-history-empty"><svg><use href="#i-review"></use></svg><strong>今天还没有复习记录</strong><span>完成评价后，卡片会出现在这里。</span></div>';
    return;
  }
  els.reviewHistory.innerHTML = events.map((event) => {
    const card = state.cards.find((item) => item.id === event.cardId);
    const title = event.question || card?.question || '已删除卡片';
    const folder = event.folder || card?.folder || '未分组';
    const meta = reviewRatingMeta(event);
    const time = new Date(event.reviewedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return `<article class="review-history-item"><div class="review-history-item-main"><strong>${esc(title)}</strong><span>${esc(folder)} · ${time}</span></div><span class="review-history-stamp ${meta.className}">${meta.label}</span></article>`;
  }).join('');
}

function shiftHeatmapMonth(offset) { heatmapMonth = new Date(heatmapMonth.getFullYear(), heatmapMonth.getMonth() + offset, 1); renderHeatmaps(); }
function renderHeatmaps() { renderGithubHeatmap(els.heatmap); els.todayCount.textContent = `共 ${state.reviewLog[today()] || 0} 次复习`; }
function renderGithubHeatmap(box) { if (!box) return; const weeks = box.classList.contains('compact') ? 26 : 52; const totalDays = weeks * 7; const now = new Date(); now.setHours(0, 0, 0, 0); const start = new Date(now.getTime() - (totalDays - 1) * DAY); box.classList.remove('monthly-heatmap'); box.classList.add('github-heatmap'); box.innerHTML = ''; for (let i = 0; i < totalDays; i += 1) { const date = new Date(start.getTime() + i * DAY); const key = dateKey(date); const count = state.reviewLog[key] || 0; const cell = document.createElement('button'); cell.type = 'button'; cell.className = `heat-cell ${count > 30 ? 'heat-3' : count > 10 ? 'heat-2' : count ? 'heat-1' : ''}`; cell.title = `${key} · ${count} 次复习${i === totalDays - 1 ? ' · 今天' : ''}`; cell.setAttribute('aria-label', `${key}，${count} 次复习${i === totalDays - 1 ? '，今天' : ''}`); cell.dataset.date = key; if (i === totalDays - 1) cell.classList.add('today-cell'); cell.addEventListener('click', () => { $$('.heat-cell.selected').forEach((item) => item.classList.remove('selected')); cell.classList.add('selected'); toast(`${key} · ${count} 次复习`); }); box.appendChild(cell); } }

function renderTrash() { $$('.trash-tabs [data-trash-tab]').forEach((button) => button.classList.toggle('active', button.dataset.trashTab === trashTab)); const list = state.trash[trashTab] || []; const box = $('#trashContent'); if (!list.length) { box.innerHTML = '<div class="trash-empty"><div class="trash-empty-icon"><svg><use href="#i-trash"></use></svg></div><strong>回收站为空</strong><p>删除的内容会显示在这里，你可以随时恢复。</p></div>'; return; } const icon = trashTab === 'folders' ? '#i-folder' : trashTab === 'cards' ? '#i-layers' : '#i-file'; box.innerHTML = list.map((item, i) => { const data = trashTab === 'folders' ? item.folder : item; const label = trashTab === 'folders' ? `包含 ${item.documents.length} 篇文档` : trashTab === 'cards' ? `${data.type === 'note' ? '速记词条' : '复习卡片'} · ${data.tags?.join('、') || '未分组'}` : '知识文档'; const preview = trashTab === 'folders' ? item.documents.map((doc) => doc.title).join('、') || '文件夹为空' : trashTab === 'cards' ? (data.type === 'note' ? data.noteContent : data.explanation || Object.values(data.options || {}).filter(Boolean).join(' · ')) : String(data.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); return `<article class="trash-item"><div class="trash-item-icon"><svg><use href="${icon}"></use></svg></div><div class="trash-item-main"><strong>${esc(data.name || data.title || data.question)}</strong><span>${esc(label)}</span><p>${esc(preview || '暂无内容预览')}</p></div><div class="trash-item-actions"><button data-restore="${i}">恢复</button><button class="danger" data-permanent="${i}">彻底删除</button></div></article>`; }).join(''); box.querySelectorAll('[data-restore]').forEach((button) => button.addEventListener('click', () => restoreTrash(Number(button.dataset.restore)))); box.querySelectorAll('[data-permanent]').forEach((button) => button.addEventListener('click', () => { const index = Number(button.dataset.permanent); const item = state.trash[trashTab][index]; const name = trashTab === 'folders' ? item.folder.name : item.title || item.question || '此内容'; openDeleteConfirm('trash-item', String(index), `永久删除“${name}”？`, '永久删除后无法恢复。', '永久删除'); })); }
function restoreTrash(at) { const item = state.trash[trashTab][at]; if (!item) return; if (trashTab === 'documents') state.documents.push(normDoc(item)); if (trashTab === 'cards') state.cards.push(normCard(item)); if (trashTab === 'folders') { state.folders.push(item.folder); state.documents.push(...item.documents.map(normDoc)); } state.trash[trashTab].splice(at, 1); save(); refresh(); toast('内容已恢复。'); }
function emptyTrash() { if (!state.trash[trashTab]?.length) return toast('当前分类没有内容。'); openDeleteConfirm('trash-all', trashTab, '清空当前回收站分类？', '此操作会永久删除当前分类中的全部内容，无法恢复。', '永久删除'); }
function formatInterval(days) { if (days < 1) return `${Math.max(1, Math.round(days * 24 * 60))} 分钟`; if (days < 2) return `${Math.max(1, Math.round(days * 24))} 小时`; return `${Math.round(days)} 天`; }
function syncSettings() {
  els.desiredRetention.value = state.settings.desiredRetention;
  els.desiredRetentionValue.textContent = `${Math.round(state.settings.desiredRetention * 100)}%`;
  els.dailyLimit.value = state.settings.dailyLimit;
  els.dailyNewLimit.value = state.settings.dailyNewLimit;
  const priority = ['new', 'review', 'mixed'].includes(state.settings.reviewPriority) ? state.settings.reviewPriority : 'mixed';
  const descriptions = {
    new: '优先安排尚未学习的新词，适合建立新的知识基础。',
    review: '优先安排已经到期的复习卡片，适合巩固已有记忆。',
    mixed: '在新词和到期复习之间平衡安排，适合日常学习。'
  };
  $('input[name="reviewPriority"]').forEach((input) => { input.checked = input.value === priority; });
  els.reviewPriority = document.querySelector('input[name="reviewPriority"]:checked');
  if (els.reviewPriorityDescription) els.reviewPriorityDescription.textContent = descriptions[priority];

  // Enhanced interval preview with dates
  const now = new Date();
  const preview = window.knowledgeFSRS.preview({ dueAt: now.toISOString(), reviews: 0 }, state.settings);
  if (els.intervalPreview) {
    els.intervalPreview.innerHTML = preview.map((item) => {
      const dueDate = new Date(item.due);
      const dateStr = `${dueDate.getMonth() + 1}/${dueDate.getDate()}`;
      return `<div><strong>${item.label}</strong><br>${formatInterval(item.days)}<br><small class="fsrs-preview-date">${dateStr}</small></div>`;
    }).join('');
  }

  // 7-day forecast based on current cards
  const forecastEl = document.getElementById('fsrsForecast');
  if (forecastEl) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const forecast = [];
    for (let d = 0; d < 7; d++) {
      const dayStart = new Date(today);
      dayStart.setDate(dayStart.getDate() + d);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const dayLabel = d === 0 ? '今天' : d === 1 ? '明天' : `${dayStart.getMonth() + 1}/${dayStart.getDate()}`;
      const dueCount = (state.cards || []).filter((card) => {
        if (!card.dueAt) return false;
        const due = new Date(card.dueAt);
        return due >= dayStart && due < dayEnd;
      }).length;
      const overdueCount = d === 0 ? (state.cards || []).filter((card) => {
        if (!card.dueAt) return false;
        const due = new Date(card.dueAt);
        return due < today;
      }).length : 0;
      forecast.push({ label: dayLabel, due: dueCount + overdueCount, overdue: overdueCount });
    }
    const maxDue = Math.max(1, ...forecast.map(f => f.due));
    forecastEl.innerHTML = forecast.map((f) => {
      const pct = Math.max(4, (f.due / maxDue) * 100);
      const barClass = f.overdue > 0 ? 'fsrs-bar-overdue' : f.due > state.settings.dailyLimit ? 'fsrs-bar-high' : '';
      return `<div class="fsrs-forecast-day"><span class="fsrs-forecast-label">${f.label}</span><div class="fsrs-forecast-bar-wrap"><div class="fsrs-forecast-bar ${barClass}" style="width:${pct}%"></div></div><span class="fsrs-forecast-count">${f.due}</span></div>`;
    }).join('');
    const totalWeek = forecast.reduce((s, f) => s + f.due, 0);
    const avgDaily = Math.round(totalWeek / 7);
    forecastEl.insertAdjacentHTML('beforeend', `<div class="fsrs-forecast-summary">预计本周复习 <strong>${totalWeek}</strong> 张卡片，日均 <strong>${avgDaily}</strong> 张</div>`);
  }

  updateStorageStatus();
}
function settings() { if (Number(els.dailyLimit.value) <= 0 || Number(els.dailyNewLimit.value) < 0) { els.dailyLimit.value = Math.max(1, Number(els.dailyLimit.value) || 1); els.dailyNewLimit.value = Math.max(0, Number(els.dailyNewLimit.value) || 0); return toast('复习上限必须有效。'); } state.settings.desiredRetention = Math.min(0.99, Math.max(0.8, Number(els.desiredRetention.value) || 0.9)); state.settings.dailyLimit = Number(els.dailyLimit.value); state.settings.dailyNewLimit = Number(els.dailyNewLimit.value); save(); syncSettings(); buildQueue(); progress(); }
async function exportAllState() { const result = await window.reviewBridge.saveExportFile({ format: 'json', filename: 'knowledge-review-backup', content: JSON.stringify(state, null, 2) }); if (!result?.canceled) toast('全部数据导出完成。'); }
function openExport(scope) { $('#exportScope').value = scope; syncCustomSelect($('#exportScope')); syncCustomSelect($('#exportFormat')); els.exportModal.showModal(); }
function markdownExport(card) { if (card.type === 'note') return `# ${card.question}\n\nType: note\n\n${card.noteContent}\n\nTags: ${card.tags.join(', ')}`; return `# ${card.question}\n\nType: ${card.type}\n\nA. ${card.options.A}\nB. ${card.options.B}\nC. ${card.options.C}\nD. ${card.options.D}\n\nAnswer: ${card.answer.join(', ')}\n\nExplanation: ${card.explanation}`; }
function pdfCardBody(card) { const title = esc(card.question || '未命名卡片'); const body = card.type === 'note' ? noteMarkdownHtml(card.noteContent) : `<div class="meta">类型：${card.type === 'multiple' ? '多选题' : '单选题'} · 标签：${esc(card.tags.join('、'))}</div><h2>选项</h2><ol>${OPTS.filter((key) => card.options[key]).map((key) => `<li><strong>${key}.</strong> ${cardHtml(card.options[key])}</li>`).join('')}</ol><p><strong>答案：</strong>${esc(card.answer.join('、'))}</p>${card.explanation ? `<h2>解析</h2><p>${cardHtml(card.explanation)}</p>` : ''}`; return `<article class="pdf-card"><h1>${title}</h1>${body}</article>`; }
function pdfExport(cards) { const list = Array.isArray(cards) ? cards : [cards]; const body = list.map(pdfCardBody).join(''); return `<html><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font-family:Segoe UI,Microsoft YaHei,sans-serif;color:#26352e;line-height:1.7}.pdf-card{page-break-after:always}.pdf-card:last-child{page-break-after:auto}h1{font-size:26px;border-bottom:2px solid #2f7d64;padding-bottom:12px}h2{font-size:17px;color:#2f7d64}.meta{color:#77847c;font-size:12px;margin-bottom:18px}.note-entry-label{padding:2px 5px;background:#45b99a;color:#fff;font-weight:700}.note-entry{margin:10px 0}img{max-width:100%;height:auto}</style></head><body>${body}</body></html>`; }
async function exportCards() { const scope = $('#exportScope').value; const format = $('#exportFormat').value; const list = scope === 'selected' ? state.cards.filter((card) => selectedCardIds.size ? selectedCardIds.has(card.id) : card.id === state.selectedCardId) : scope === 'folder' ? state.cards.filter((card) => card.folder === els.folderFilter.value) : state.cards; if (!list.length) return toast('没有可导出的卡片。'); const content = format === 'markdown' ? list.map(markdownExport).join('\n\n---\n\n') : format === 'pdf' ? pdfExport(list) : JSON.stringify(list, null, 2); const result = await window.reviewBridge.saveExportFile({ format, filename: 'knowledge-cards', content }); els.exportModal.close(); if (!result?.canceled) toast('导出完成。'); }
function parseMarkdownCards(content) { return content.split(/\n---\n/).map((chunk) => { const lines = chunk.split('\n'); const question = lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim(); const type = lines.find((line) => /^Type:\s*/i.test(line))?.replace(/^Type:\s*/i, '').trim(); if (!question) return null; if (type === 'note') return normCard({ type: 'note', question, noteContent: lines.slice(3).join('\n').split(/\nTags:/i)[0].trim(), tags: ['导入'] }); const options = {}; OPTS.forEach((key) => { options[key] = lines.find((line) => new RegExp(`^${key}\\.\\s*`).test(line))?.replace(new RegExp(`^${key}\\.\\s*`), '').trim() || ''; }); const answer = lines.find((line) => /^Answer:/i.test(line))?.replace(/^Answer:\s*/i, '').split(/[,，]/).map((value) => value.trim()).filter(Boolean) || []; const explanation = lines.find((line) => /^Explanation:/i.test(line))?.replace(/^Explanation:\s*/i, '').trim() || ''; return normCard({ question, type: type === 'multiple' ? 'multiple' : 'single', options, answer, explanation, tags: ['导入'] }); }).filter(Boolean); }
async function importCards() { const file = await window.reviewBridge.openCardsFile(); if (!file || !file.content.trim()) return toast('请选择有效文件。'); try { const cards = file.extension === '.json' ? (Array.isArray(JSON.parse(file.content)) ? JSON.parse(file.content) : [JSON.parse(file.content)]).map(normCard) : parseMarkdownCards(file.content); const valid = cards.filter((card) => card.question && (card.type === 'note' ? card.noteContent : card.answer.length)); if (!valid.length) return toast('文件格式或字段不完整。'); state.cards = [...valid, ...state.cards]; state.groups = [...new Set([...(state.groups || []), ...valid.map((card) => card.folder)])]; save(); refresh(); toast(`已导入 ${valid.length} 张卡片。`); } catch { toast('无法解析导入文件。'); } }
function badges() { const badge = $('#reviewBadge'); if (badge) badge.textContent = state.cards.filter(isDue).length; }
function isDue(card) { return !card.suspended && new Date(card.dueAt).getTime() <= Date.now(); }
function totalReviews() { return Object.values(state.reviewLog).reduce((sum, count) => sum + Number(count || 0), 0); }

// Note cards keep Markdown as source text and render it only in the review surface.
function renderQuestionOriginal(box, card, standalone) {
  const shell = box.closest('.review-shell');
  if (!card) {
    shell?.classList.add('is-complete');
    if (standalone) {
      shell?.classList.add('manifesto-complete-shell');
      box.innerHTML = `<div class="manifesto-showcase">
        <input type="checkbox" id="rebel-toggle" class="rebel-toggle" />
        <div class="presentation-stage">
          <label for="rebel-toggle" class="aesthetic-switch">
            <span class="switch-track"></span>
            <span class="switch-text mode-clean">BRUTALIZE AESTHETIC-CLICK ME</span>
            <span class="switch-text mode-chaos">RESTORE MINIMALISM</span>
          </label>
          <div class="poster-card">
            <div class="css-mesh-grain"></div>
            <div class="drafting-grid"></div>
            <div class="geo-orb"></div>
            <div class="type-container">
              <div class="huge-text word-1">STUDY</div>
              <div class="huge-text word-2">END.</div>
            </div>
            <div class="tape-ribbon">
              <div class="tape-scroll">
                <span>NO JS // PURE CSS // BOLD AESTHETICS // REJECT MEDIOCRITY //</span>
                <span>NO JS // PURE CSS // BOLD AESTHETICS // REJECT MEDIOCRITY //</span>
              </div>
            </div>
            <div class="poster-footer">
              <div class="barcode"></div>
              <div class="manifesto-text">
                <p class="vol">VOL. 01 / STUDY COMPLETE</p>
                <p class="desc">TODAY'S REVIEW SESSION IS COMPLETE. KEEP THE MOMENTUM TOMORROW.</p>
              </div>
            </div>
          </div>
        </div>
      </div>`;
      els.nextButton.disabled = true;
      els.nextButton.hidden = true;
      return;
    }
    box.innerHTML = '<div class="review-complete"><div class="complete-mark"><svg><use href="#i-review"></use></svg></div><div class="completion-kicker">REVIEW SESSION</div><h2>今日复习已完成</h2><p>本次复习计划已经完成，明天继续保持。</p><button class="secondary-action" data-view="cards">查看卡片库</button></div>';
    box.querySelector('[data-view]')?.addEventListener('click', () => view('cards'));
    els.nextButton.disabled = true;
    els.nextButton.hidden = true;
    return;
  }
  shell?.classList.remove('manifesto-complete-shell');
  shell?.classList.remove('is-complete');
  const selected = Array.isArray(answer) ? answer : [];
  const head = `<div class="tag-row"><span class="tag">${esc(card.tags[0] || '未分组')}</span><span class="question-type">${card.type === 'note' ? '速记词条' : card.type === 'multiple' ? '多选题' : '单选题'}</span></div><div class="question-title">${cardHtml(card.question)}</div>`;
  if (card.type === 'note') {
    const rating = NOTE_RATINGS[card.noteRating];
    const stamp = state.settings.showStamps !== false && answered && rating ? `<div class="note-stamp ${rating.className}" aria-label="${rating.label}"><span>${rating.label}</span></div>` : '';
    box.innerHTML = `${head}<div class="note-review-body ${answered ? 'is-reviewed' : ''}">${stamp}<div class="note-answer-content">${noteMarkdownHtml(card.noteContent)}</div></div><div class="note-rating-block ${answered ? 'is-complete' : ''}">${answered ? '' : '<p>根据回忆程度选择反馈</p><div class="note-rating-actions"><div class="note-rating-main">' + Object.entries(NOTE_RATINGS).map(([value, meta], index) => `<button class="note-rating ${meta.className}" data-rating="${value}" data-shortcut="${index + 1}"><span class="keycap">${index + 1}</span><strong>${meta.label}</strong></button>`).join('') + '</div></div>'}</div>`;
    box.querySelectorAll('[data-rating]').forEach((button) => button.addEventListener('click', () => answerNoteCard(card, button.dataset.rating)));
    els.nextButton.textContent = '下一条';
  } else {
    box.innerHTML = `${head}<div class="options-block"></div>${answered && card.explanation ? `<div class="explanation"><strong>解析</strong>${cardHtml(card.explanation)}</div>` : ''}${answered && pendingReviewCardId === card.id ? reviewGradeActions(card) : ''}`;
    if (answered && pendingReviewCardId === card.id) {
      box.insertAdjacentHTML('beforeend', reviewDispositionActions(card));
    }
    const block = box.querySelector('.options-block');
    OPTS.forEach((key) => {
      const button = document.createElement('button');
      button.className = 'option-button';
      if (!answered && selected.includes(key)) button.classList.add('selected');
      if (answered && card.answer.includes(key)) button.classList.add('correct');
      if (answered && selected.includes(key) && !card.answer.includes(key)) button.classList.add('wrong');
      button.innerHTML = `<span class="key">${key}</span><span>${cardHtml(card.options[key] || '未填写选项')}</span>`;
      button.disabled = answered;
      button.addEventListener('click', () => answerCard(card, key));
      block.appendChild(button);
    });
    if (card.type === 'multiple' && !answered) {
      const submit = document.createElement('button');
      submit.className = 'next-button submit-answer';
      submit.textContent = '提交答案';
      submit.disabled = !selected.length;
      submit.addEventListener('click', () => finalizeMultiple(card));
      box.appendChild(submit);
    }
    els.nextButton.textContent = '下一题';
  }
  els.nextButton.disabled = true;
  els.nextButton.hidden = true;
  if (answered && reviewDisplayCard?.id === card.id) box.insertAdjacentHTML('beforeend', reviewActionButtons(card));
  box.querySelectorAll('[data-review-action]').forEach((button) => button.addEventListener('click', () => button.dataset.reviewAction === 'retry' ? retryCurrentReview() : next()));
  box.querySelectorAll('[data-review-disposition]').forEach((button) => button.addEventListener('click', () => handleReviewDisposition(card, button.dataset.reviewDisposition)));
  box.querySelectorAll('[data-fsrs-grade]').forEach((button) => button.addEventListener('click', () => recordReview(card, button.dataset.fsrsGrade)));
}

function reviewGradeActions(card) {
  return '';
}

function answerNoteCard(card, rating) {
  if (answered || !NOTE_RATINGS[rating]) return;
  card.noteRating = rating;
  card.suspended = rating === 'tooEasy';
  reviewDisplayCard = card;
  recordReview(card, rating);
}

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
  if (!reviewStudyActive && $('#reviewView')?.classList.contains('active') && event.key === 'Enter') {
    event.preventDefault();
    startReviewStudy(state.reviewPlan?.group || 'all');
    return;
  }
  const key = event.key.toLowerCase();
  if (answered && reviewDisplayCard && (key === 'q' || key === 'e')) {
    event.preventDefault();
    if (key === 'q') retryCurrentReview();
    else next();
    return;
  }
  if (!queue[index] || answered) return;
  const button = $(`#questionCard [data-shortcut="${event.key}"]`);
  if (button) { event.preventDefault(); button.click(); }
});

function recordReview(card, rating, suspendAfter = false, forceTomorrow = false) {
  answered = true;
  const grade = rating === 'familiar' ? 'Good' : rating === 'fuzzy' ? 'Hard' : rating === 'tooEasy' ? 'Easy' : rating === 'forgot' || rating === 'wrong' ? 'Again' : rating;
  const mastery = grade === 'Easy' ? 'tooEasy' : grade === 'Good' ? 'familiar' : grade === 'Hard' ? 'fuzzy' : 'forgot';
  card.mastery = mastery;
  const previous = window.knowledgeFSRS.normalize(card);
  const result = window.knowledgeFSRS.next(card, grade, state.settings);
  card.fsrs = result.fsrs;
  card.dueAt = result.dueAt;
  card.interval = result.interval;
  card.reviews = result.reviews;
  card.ease = result.ease;
  card.updatedAt = new Date().toISOString();
  if (forceTomorrow) {
    const tomorrow = new Date(Date.now() + DAY).toISOString();
    card.dueAt = tomorrow;
    card.interval = 1;
    card.fsrs = { ...card.fsrs, due: tomorrow, scheduledDays: 1 };
    result.dueAt = tomorrow;
    result.log.scheduledDays = 1;
  }
  if (card.type === 'note') card.noteRating = NOTE_RATINGS[rating] ? rating : card.noteRating;
  if (card.type === 'note' && rating === 'tooEasy') card.suspended = true;
  if (suspendAfter) card.suspended = true;
  state.reviewEvents.push({
    id: id('review'),
    cardId: card.id,
    folder: card.folder || '未分组',
    question: card.question || '',
    type: card.type || 'single',
    rating: result.log.rating,
    ratingValue: result.log.ratingValue,
    previousState: previous.state,
    state: result.log.state,
    reviewedAt: result.log.review,
    previousDue: previous.due.toISOString(),
    nextDue: card.dueAt,
    stability: result.log.stability,
    difficulty: result.log.difficulty,
    elapsedDays: result.log.elapsedDays,
    scheduledDays: result.log.scheduledDays
  });
  reviewDisplayCard = card;
  pendingReviewCardId = '';
  pendingCorrect = false;
  reviewDisposition = 'pending';
  save();
  buildQueue();
  renderDock();
  renderStandalone();
  renderReviewPlan();
  renderReviewHistory();
  renderHeatmaps();
  badges();
}
function streak() { let count = 0; for (let i = 0; i < 366; i += 1) { const key = dateKey(Date.now() - i * DAY); if (state.reviewLog[key]) count += 1; else if (i) break; } return count; }
function toast(message) { const box = els.toast; const label = box.querySelector('.toast-message'); label.textContent = message; box.classList.remove('show'); requestAnimationFrame(() => box.classList.add('show')); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove('show'), 3000); }
document.addEventListener('DOMContentLoaded', init);
function renderQuestion(box, card, standalone) {
  renderQuestionOriginal(box, card, standalone);
  if (!card) return;
  const type = box.querySelector('.question-type');
  if (type) type.textContent = cardTypeLabel(card.type);
  const title = box.querySelector('.question-title');
  if (title) {
    title.classList.toggle('choice-question', card.type !== 'note');
    box.querySelector('[data-card-meta]')?.remove();
    title.insertAdjacentHTML('afterend', cardMetadataMarkup(card, 'review-card-meta'));
  }
  const allowed = new Set(cardOptionKeys(card));
  box.querySelectorAll('.options-block .option-button').forEach((button) => {
    const key = button.querySelector('.key')?.textContent?.trim();
    if (!allowed.has(key)) button.remove();
  });
}
function answerCard(card, selected, submit = false) {
  if (answered) return;
  if (card.type === 'multiple' && !submit) {
    answer = answer.includes(selected) ? answer.filter((key) => key !== selected) : [...answer, selected];
    renderDock();
    renderStandalone();
    return;
  }
  if (card.type !== 'multiple') answer = [selected].filter(Boolean);
  const correct = answer.length === card.answer.length && answer.every((key) => card.answer.includes(key));
  answered = true;
  pendingReviewCardId = card.id;
  pendingCorrect = correct;
  reviewDisposition = 'pending';
  renderDock();
  renderStandalone();
}
function handleExternalLinkClick(event) {
  const link = event.target.closest?.('a');
  if (!link || !/^https?:\/\//i.test(link.href)) return;
  event.preventDefault();
  event.stopPropagation();
  window.reviewBridge.openExternal(link.href);
}
document.addEventListener('click', handleExternalLinkClick, true);
function ensureUpdatePanel() {
  const panel = $('#aboutPanel');
  if (!panel || panel.dataset.updateReady === 'true') return;
  panel.dataset.updateReady = 'true';
  panel.innerHTML = `<h2>关于</h2><p class="about-intro">Notion Card Electron 桌面应用。</p><section class="update-panel"><div class="update-panel-heading"><div><span class="modal-eyebrow">GITHUB RELEASES</span><h3>应用更新</h3><p class="setting-description">通过 GitHub Releases 获取新版本。下载在后台进行，更新和卸载都不会删除你的本地数据。</p></div><span class="update-shield" aria-hidden="true">✓</span></div><div class="update-version-row"><span class="update-version" id="appVersion">正在读取版本…</span><span class="update-channel">稳定版</span></div><div class="update-progress" id="updateProgress" hidden><div class="update-progress-track"><i id="updateProgressBar"></i></div><div class="update-progress-meta" id="updateProgressMeta">准备下载…</div></div><div class="update-status" id="updateStatus">正在准备更新检查…</div><div class="update-actions"><button class="update-check-button" id="updateCheckButton" type="button"><span class="update-button-icon" aria-hidden="true">↻</span><span>检查更新</span></button><button class="primary update-install-button" id="updateInstallButton" type="button" hidden>重启并安装</button></div><div class="data-location"><div class="data-location-heading"><strong>用户数据位置</strong><span>更新安全</span></div><code id="dataPath">正在读取…</code><small>此目录独立于安装目录。更新、升级和卸载不会删除它。</small></div></section>`;
}