/* ═══════════════════════════════════════════════
   kr-collab.js — Card Collaboration Workspace
   Owner reviews pushed cards · Edit before approve ·
   Approved cards merge into the deck ZIP in place
   ═══════════════════════════════════════════════ */

// --- State ---
let collabDecks = [];
let collabActiveDeckId = null;
let collabFilter = 'PENDING'; // ALL | PENDING | APPROVED | REJECTED
let collabActiveContribution = null; // contribution detail view
let collabRenderToken = 0;
let collabEditMode = false; // inline edit mode in detail view

// --- API helpers ---
function collabApi(path, options) { return marketApi('/v2/' + path, options); }

// --- Main render ---
async function renderCollab() {
  const viewNode = $('#collabView');
  if (!viewNode) return;
  if (!marketUnlocked || !marketToken) {
    viewNode.innerHTML = '<div class="collab-empty-state"><p>请先登录牌组市场以使用协作功能。</p></div>';
    return;
  }
  viewNode.innerHTML = '<div class="collab-surface"><aside class="collab-sidebar"></aside><section class="collab-main"><div class="collab-main-inner" id="collabMainContent"><div class="collab-loading-hint">加载中…</div></div></section></div>';
  const token = ++collabRenderToken;
  try {
    const deckPath = marketUser?.role === 'ADMIN' ? '/decks?page=1&pageSize=100&sort=newest' : '/my-decks?page=1&pageSize=100&sort=newest';
    const result = await marketApi(deckPath);
    collabDecks = Array.isArray(result) ? result : result.decks || result.items || [];
  } catch (err) {
    collabDecks = [];
    if (token !== collabRenderToken) return;
    viewNode.innerHTML = '<div class="collab-surface"><aside class="collab-sidebar"><div class="collab-sidebar-header"><span class="collab-sidebar-title">COLLABORATION</span><small>卡片审核工作区</small></div><div class="collab-deck-list"><div class="collab-empty-hint">牌组加载失败：<br>' + esc(err.message || '网络错误') + '<br><button type="button" class="collab-retry-btn" id="collabRetryBtn">重试</button></div></div></aside><section class="collab-main"><div class="collab-main-inner" id="collabMainContent"></div></section></div>';
    const retryBtn = $('#collabRetryBtn');
    if (retryBtn) retryBtn.onclick = () => renderCollab();
    return;
  }
  if (token !== collabRenderToken) return;
  if ((!collabActiveDeckId || !collabDecks.some((d) => d.id === collabActiveDeckId)) && collabDecks.length > 0) collabActiveDeckId = collabDecks[0].id;
  renderCollabShell(viewNode);
}

function renderCollabShell(viewNode) {
  const deckListHtml = collabDecks.map((deck) => {
    const isActive = deck.id === collabActiveDeckId;
    const statusClass = deck.status === 'PUBLISHED' ? 'published' : 'draft';
    return `<button type="button" class="collab-deck-item${isActive ? ' active' : ''}" data-collab-deck="${esc(deck.id)}"><div class="collab-deck-info"><strong>${esc(deck.title || 'Untitled')}</strong><small>${esc(deck.category || '未分类')}</small></div><span class="collab-deck-status ${statusClass}">${deck.status === 'PUBLISHED' ? '已发布' : '草稿'}</span></button>`;
  }).join('');

  viewNode.innerHTML = `<div class="collab-surface"><aside class="collab-sidebar"><div class="collab-sidebar-header"><span class="collab-sidebar-title">COLLABORATION</span><small>卡片审核工作区</small></div><div class="collab-deck-list">${deckListHtml || '<div class="collab-empty-hint">暂无牌组</div>'}</div></aside><section class="collab-main"><div class="collab-main-inner" id="collabMainContent"></div></section></div>`;
  bindCollabEvents(viewNode);
  renderCollabMain();
}

async function renderCollabMain() {
  const content = $('#collabMainContent');
  if (!content) return;
  const token = ++collabRenderToken;
  const deck = collabDecks.find((d) => d.id === collabActiveDeckId);
  if (!deck) {
    content.innerHTML = '<div class="collab-empty-state"><p>选择一个牌组查看推送的卡片。</p></div>';
    return;
  }

  const headerHtml = `<header class="collab-header"><div><h1>${esc(deck.title || 'Untitled')}</h1><p>${esc(deck.description || '无描述')}</p></div><div class="collab-header-meta"><span class="collab-deck-badge ${deck.status === 'PUBLISHED' ? 'published' : 'draft'}">${deck.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'}</span></div></header>`;
  const filterHtml = `<div class="collab-cc-filters">${['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((s) => `<button type="button" class="${collabFilter === s ? 'active' : ''}" data-collab-filter="${s}">${s === 'ALL' ? '全部' : s === 'PENDING' ? '待审核' : s === 'APPROVED' ? '已采纳' : '已拒绝'}</button>`).join('')}</div>`;
  const toolbarHtml = `<div class="collab-cc-toolbar">${filterHtml}<span class="collab-review-hint">推送卡片请到「卡片」页选中卡片后操作</span></div>`;

  content.innerHTML = headerHtml + toolbarHtml + '<div class="collab-cc-list" id="collabCCList"><div class="collab-loading">加载中…</div></div>';
  bindCollabMainEvents(content);

  await renderCollabContributions(token);
}

// --- Contributions List ---
async function renderCollabContributions(token) {
  const listNode = $('#collabCCList');
  if (!listNode) return;
  try {
    const statusParam = collabFilter !== 'ALL' ? `?status=${collabFilter}` : '';
    const contributions = await collabApi(`decks/${collabActiveDeckId}/card-contributions${statusParam}`);
    if (token !== collabRenderToken) return;
    const list = Array.isArray(contributions) ? contributions : (contributions && contributions.items) || [];
    const listHtml = list.length > 0 ? list.map(renderContributionCard).join('') : '<div class="collab-empty-state"><p>暂无卡片推送。</p></div>';
    listNode.innerHTML = listHtml;
    bindContributionCardEvents(listNode);
  } catch (err) {
    if (token !== collabRenderToken) return;
    const msg = (err.message || '').toLowerCase().includes('forbidden')
      ? '你还没有此牌组的协作权限。'
      : '加载失败：' + esc(err.message || '未知错误');
    listNode.innerHTML = `<div class="collab-empty-state"><p>${msg}</p><button type="button" class="collab-retry-btn" data-collab-retry="contributions">重试</button></div>`;
    bindContributionCardEvents(listNode);
  }
}

function renderContributionCard(cc) {
  const statusMap = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };
  const statusLabel = { PENDING: '待审核', APPROVED: '已采纳', REJECTED: '已拒绝' };
  const actionLabel = { ADD: '新增', MODIFY: '修改' };
  const s = statusMap[cc.status] || 'pending';
  const contributor = cc.contributor?.nickname || cc.contributor?.username || 'unknown';
  const date = formatDate(cc.createdAt);
  const card = cc.cardData || {};
  const typeLabel = cardTypeLabel(card.type) || '未知';
  const questionText = card.type === 'note' ? (card.noteContent || '').replace(/[#*`>]/g, '').slice(0, 60) : (card.question || '').slice(0, 60);
  return `<article class="collab-cc-card" data-collab-cc="${esc(cc.id)}"><div class="collab-cc-card-main"><span class="collab-cc-action ${cc.action === 'ADD' ? 'add' : 'modify'}">${actionLabel[cc.action] || cc.action}</span><div class="collab-cc-card-info"><div class="collab-cc-card-type">${typeLabel}</div><strong>${esc(questionText)}${questionText.length >= 60 ? '…' : ''}</strong><small>${esc(contributor)} · ${date}</small></div></div><span class="collab-cc-status ${s}">${statusLabel[cc.status] || cc.status}</span></article>`;
}

// --- Card Preview Renderer ---
function renderContributionCardPreview(card) {
  if (!card || typeof card !== 'object') return '<p class="collab-card-empty">卡片数据为空</p>';
  const typeLabel = cardTypeLabel(card.type) || '未知';
  const isNote = card.type === 'note';
  const isTrueFalse = card.type === 'truefalse';
  const optionKeys = isTrueFalse ? ['A', 'B'] : OPTS;
  const optionLabels = isTrueFalse ? { A: '正确', B: '错误' } : {};
  const answers = Array.isArray(card.answer) ? card.answer : [];

  let optionsHtml = '';
  if (!isNote) {
    const options = card.options || {};
    optionsHtml = `<div class="cc-preview-options">${optionKeys.map((key) => {
      const text = optionLabels[key] || options[key] || '';
      if (!text && !optionLabels[key]) return '';
      const correct = answers.includes(key);
      return `<div class="cc-preview-option${correct ? ' correct' : ''}"><span class="cc-option-key">${key}</span><span class="cc-option-text">${cardHtml(text)}</span>${correct ? '<span class="cc-correct-mark">✓</span>' : ''}</div>`;
    }).join('')}</div>`;
  }

  const noteHtml = isNote ? `<div class="cc-preview-note markdown-preview">${noteMarkdownHtml(card.noteContent)}</div>` : '';
  const explanationHtml = card.explanation ? `<div class="cc-preview-explanation"><span class="cc-preview-label">解析</span><div class="markdown-preview">${cardHtml(card.explanation)}</div></div>` : '';
  const tagsHtml = (card.tags && card.tags.length) ? `<div class="cc-preview-tags">${card.tags.map((tag) => `<span class="tag-span">${esc(tag)}</span>`).join('')}</div>` : '';
  const metaHtml = (card.knowledgePoint || card.source || card.correctRate != null) ? `<div class="cc-preview-meta">${card.knowledgePoint ? `<span>知识点：${esc(card.knowledgePoint)}</span>` : ''}${card.source ? `<span>来源：${esc(card.source)}</span>` : ''}${card.correctRate != null ? `<span>正确率：${esc(card.correctRate)}%</span>` : ''}</div>` : '';

  return `<div class="cc-card-preview"><div class="cc-card-preview-head"><span class="question-type">${typeLabel}</span></div><div class="cc-card-preview-body"><h3 class="cc-preview-question">${cardHtml(card.question || (isNote ? '速记词条' : ''))}</h3>${noteHtml}${optionsHtml}</div>${explanationHtml}${tagsHtml}${metaHtml}</div>`;
}

// --- Inline Editor Renderer ---
function renderContributionEditor(card) {
  if (!card || typeof card !== 'object') card = {};
  const type = card.type || 'single';
  const isNote = type === 'note';
  const isTrueFalse = type === 'truefalse';
  const answers = Array.isArray(card.answer) ? card.answer : [];
  const options = card.options || {};
  const optionKeys = isTrueFalse ? ['A', 'B'] : OPTS;
  const optionLabels = isTrueFalse ? { A: '正确', B: '错误' } : {};

  const typeSelect = `<select id="ccEditType" data-cc-field="type"><option value="single" ${type === 'single' ? 'selected' : ''}>单选题</option><option value="multiple" ${type === 'multiple' ? 'selected' : ''}>多选题</option><option value="truefalse" ${type === 'truefalse' ? 'selected' : ''}>判断题</option><option value="note" ${type === 'note' ? 'selected' : ''}>速记词条</option></select>`;
  const questionField = `<label class="cc-edit-field">题干<textarea id="ccEditQuestion" rows="3">${esc(card.question || '')}</textarea></label>`;
  const optionsField = isNote ? '' : `<div class="cc-edit-options" id="ccEditOptions">${optionKeys.map((key) => {
    const val = optionLabels[key] || options[key] || '';
    return `<label class="cc-edit-option-row"><span class="cc-option-key">${key}</span><input type="text" data-cc-option="${key}" value="${esc(val)}" ${optionLabels[key] ? 'readonly' : ''} /></label>`;
  }).join('')}</div>`;
  const answerField = isNote ? '' : `<div class="cc-edit-answer"><span class="cc-edit-label">正确答案</span><div class="cc-edit-answer-choices" id="ccEditAnswer">${optionKeys.map((key) => {
    const label = optionLabels[key] || key;
    const inputType = type === 'multiple' ? 'checkbox' : 'radio';
    return `<label><input type="${inputType}" name="ccEditAnswer" value="${key}" ${answers.includes(key) ? 'checked' : ''}><span>${label}</span></label>`;
  }).join('')}</div></div>`;
  const noteField = isNote ? `<label class="cc-edit-field">速记内容<textarea id="ccEditNoteContent" rows="5">${esc(card.noteContent || '')}</textarea></label>` : '';
  const explanationField = isNote ? '' : `<label class="cc-edit-field">解析<textarea id="ccEditExplanation" rows="3">${esc(card.explanation || '')}</textarea></label>`;
  const tagsField = `<label class="cc-edit-field">标签（逗号分隔）<input type="text" id="ccEditTags" value="${esc((card.tags || []).join(', '))}" /></label>`;
  const metaFields = isNote ? '' : `<div class="cc-edit-meta-row"><label class="cc-edit-field">知识点<input type="text" id="ccEditKnowledgePoint" value="${esc(card.knowledgePoint || '')}" /></label><label class="cc-edit-field">来源<input type="text" id="ccEditSource" value="${esc(card.source || '')}" /></label><label class="cc-edit-field">正确率(%)<input type="number" id="ccEditCorrectRate" min="0" max="100" value="${esc(card.correctRate ?? '')}" /></label></div>`;

  return `<div class="cc-inline-editor" id="ccInlineEditor">${typeSelect}${questionField}${optionsField}${answerField}${noteField}${explanationField}${tagsField}${metaFields}</div>`;
}

function collectEditedCardData() {
  const editor = $('#ccInlineEditor');
  if (!editor) return null;
  const typeSel = editor.querySelector('#ccEditType');
  const type = typeSel ? typeSel.value : 'single';
  const isNote = type === 'note';
  const isTrueFalse = type === 'truefalse';
  const optionKeys = isTrueFalse ? ['A', 'B'] : OPTS;
  const optionLabels = isTrueFalse ? { A: '正确', B: '错误' } : {};
  const question = (editor.querySelector('#ccEditQuestion')?.value || '').trim();
  const noteContent = (editor.querySelector('#ccEditNoteContent')?.value || '').trim();
  const explanation = (editor.querySelector('#ccEditExplanation')?.value || '').trim();
  const tags = (editor.querySelector('#ccEditTags')?.value || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean);
  const knowledgePoint = (editor.querySelector('#ccEditKnowledgePoint')?.value || '').trim();
  const source = (editor.querySelector('#ccEditSource')?.value || '').trim();
  const rateText = (editor.querySelector('#ccEditCorrectRate')?.value || '').trim();
  const correctRate = rateText === '' ? null : Number(rateText);
  const options = {};
  if (!isNote) {
    optionKeys.forEach((key) => { options[key] = optionLabels[key] || (editor.querySelector(`[data-cc-option="${key}"]`)?.value || '').trim(); });
  }
  const answer = isNote ? [] : [...editor.querySelectorAll('input[name="ccEditAnswer"]:checked')].map((input) => input.value);
  return { type, question, options, answer, noteContent, explanation, tags, knowledgePoint, source, correctRate };
}

// --- Contribution Detail View ---
async function renderContributionDetail(ccId) {
  const content = $('#collabMainContent');
  if (!content) return;
  content.innerHTML = '<div class="collab-loading">加载卡片推送详情…</div>';
  const token = ++collabRenderToken;
  collabEditMode = false;
  try {
    const cc = await collabApi(`card-contributions/${ccId}`);
    if (token !== collabRenderToken) return;
    collabActiveContribution = cc;
    renderContributionDetailContent(cc);
  } catch (err) {
    if (token !== collabRenderToken) return;
    content.innerHTML = `<div class="collab-empty-state"><p>加载失败：${esc(err.message)}</p><button type="button" class="collab-back-btn" data-collab-back="list">← 返回列表</button></div>`;
  }
}

function renderContributionDetailContent(cc) {
  const content = $('#collabMainContent');
  if (!content || !cc) return;
  const isOwner = marketUser && cc.deck?.ownerId === marketUser.id;
  const isPending = cc.status === 'PENDING';
  const statusMap = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };
  const statusLabel = { PENDING: '待审核', APPROVED: '已采纳', REJECTED: '已拒绝' };
  const actionLabel = { ADD: '新增卡片', MODIFY: '修改卡片' };
  const s = statusMap[cc.status] || 'pending';
  const contributor = cc.contributor?.nickname || cc.contributor?.username || 'unknown';
  const card = cc.cardData || {};

  const reviewHtml = (cc.status !== 'PENDING' && cc.reviewedAt) ? `<div class="collab-review-info"><span class="collab-cc-status ${s}">${statusLabel[cc.status] || cc.status}</span><small>审核于 ${formatDate(cc.reviewedAt)}</small>${cc.reviewNote ? `<p>${esc(cc.reviewNote)}</p>` : ''}</div>` : '';

  let actionsHtml = '';
  if (isPending && isOwner) {
    actionsHtml = `<div class="collab-cc-actions"><button type="button" class="collab-action-btn approve" data-collab-action="approve">直接采纳</button><button type="button" class="collab-action-btn edit" data-collab-action="edit">编辑后采纳</button><button type="button" class="collab-action-btn reject" data-collab-action="show-reject">拒绝</button></div><div class="collab-reject-box" id="collabRejectBox" hidden><label class="cc-edit-field">拒绝理由（可选）<textarea id="collabRejectNote" rows="2" placeholder="请输入拒绝理由…"></textarea></label><div class="cc-edit-actions"><button type="button" class="collab-action-btn reject" data-collab-action="confirm-reject">确认拒绝</button><button type="button" class="collab-action-btn" data-collab-action="cancel-reject">取消</button></div></div>`;
  }

  const editorHtml = (isPending && isOwner && collabEditMode) ? `<section class="collab-pr-section cc-edit-section"><h3>编辑卡片</h3>${renderContributionEditor(card)}<div class="cc-edit-actions"><button type="button" class="collab-action-btn approve" data-collab-action="approve-edited">采纳编辑</button><button type="button" class="collab-action-btn" data-collab-action="cancel-edit">取消编辑</button></div></section>` : '';

  content.innerHTML = `<div class="collab-cc-detail"><button type="button" class="collab-back-btn" data-collab-back="list">← 返回列表</button><div class="collab-cc-detail-header"><span class="collab-cc-action ${cc.action === 'ADD' ? 'add' : 'modify'}">${actionLabel[cc.action] || cc.action}</span><h2>${esc(card.question ? card.question.slice(0, 40) : cc.cardId)}</h2><div class="collab-cc-detail-meta"><span>推送者：${esc(contributor)}</span><span>卡片ID：${esc(cc.cardId)}</span><span>时间：${formatDate(cc.createdAt)}</span></div></div>${reviewHtml}${actionsHtml}<section class="collab-pr-section"><h3>卡片预览</h3>${renderContributionCardPreview(card)}</section>${editorHtml}</div>`;
  bindContributionDetailEvents(content, cc);
}

// --- Event Bindings ---
function bindCollabEvents(viewNode) {
  viewNode.querySelectorAll('[data-collab-deck]').forEach((btn) => {
    btn.addEventListener('click', () => {
      collabActiveDeckId = btn.dataset.collabDeck;
      collabActiveContribution = null;
      collabFilter = 'PENDING';
      renderCollabShell(viewNode);
    });
  });
}

function bindCollabMainEvents(content) {
  content.querySelectorAll('[data-collab-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      collabFilter = btn.dataset.collabFilter;
      renderCollabMain();
    });
  });
  content.querySelectorAll('[data-collab-retry]').forEach((btn) => {
    btn.addEventListener('click', () => renderCollabMain());
  });
}

function bindContributionCardEvents(container) {
  container.querySelectorAll('[data-collab-cc]').forEach((card) => {
    card.addEventListener('click', () => renderContributionDetail(card.dataset.collabCc));
  });
  container.querySelectorAll('[data-collab-retry]').forEach((btn) => {
    btn.addEventListener('click', () => renderCollabMain());
  });
}

function bindContributionDetailEvents(container, cc) {
  const backBtn = container.querySelector('[data-collab-back]');
  if (backBtn) backBtn.addEventListener('click', () => { collabActiveContribution = null; renderCollabMain(); });
  if (!cc) return;

  container.querySelectorAll('[data-collab-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.collabAction;
      if (action === 'edit') {
        collabEditMode = true;
        renderContributionDetailContent(cc);
        return;
      }
      if (action === 'cancel-edit') {
        collabEditMode = false;
        renderContributionDetailContent(cc);
        return;
      }
      if (action === 'show-reject') {
        const box = container.querySelector('#collabRejectBox');
        if (box) { box.hidden = false; box.querySelector('#collabRejectNote')?.focus(); }
        return;
      }
      if (action === 'cancel-reject') {
        const box = container.querySelector('#collabRejectBox');
        if (box) { box.hidden = true; }
        return;
      }
      if (action === 'confirm-reject') {
        const note = container.querySelector('#collabRejectNote')?.value.trim() || '';
        btn.disabled = true;
        try {
          await collabApi(`card-contributions/${cc.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'REJECTED', note: note || undefined }) });
          toast('卡片已拒绝。');
          renderCollab();
        } catch (err) { toast('操作失败：' + (err.message || '未知错误')); btn.disabled = false; }
        return;
      }
      if (action === 'approve-edited') {
        const edited = collectEditedCardData();
        if (!edited) return;
        if (edited.type !== 'note' && !edited.answer.length) { toast('请选择正确答案。'); return; }
        if (edited.type === 'multiple' && edited.answer.length < 2) { toast('多选题至少选择两个答案。'); return; }
        if (!edited.question && edited.type !== 'note') { toast('请填写题干。'); return; }
        if (edited.type === 'note' && !edited.noteContent) { toast('请填写速记内容。'); return; }
        btn.disabled = true;
        try {
          await collabApi(`card-contributions/${cc.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED', editedCardData: edited }) });
          toast('卡片已采纳（含编辑）并合并到牌组。');
          renderCollab();
        } catch (err) { toast('操作失败：' + (err.message || '未知错误')); btn.disabled = false; }
        return;
      }
      // direct approve
      btn.disabled = true;
      try {
        await collabApi(`card-contributions/${cc.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED' }) });
        toast('卡片已采纳并合并到牌组。');
        renderCollab();
      } catch (err) { toast('操作失败：' + (err.message || '未知错误')); btn.disabled = false; }
    });
  });

  // Type change in inline editor — re-render editor with new type preserving values
  const typeSelect = container.querySelector('#ccEditType');
  if (typeSelect) {
    const handleTypeChange = () => {
      const edited = collectEditedCardData();
      if (!edited || !collabActiveContribution) return;
      const editorWrap = container.querySelector('#ccInlineEditor');
      if (!editorWrap) return;
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = renderContributionEditor({ ...edited, type: edited.type });
      const newEditor = tempDiv.querySelector('#ccInlineEditor');
      if (newEditor) {
        editorWrap.innerHTML = newEditor.innerHTML;
        editorWrap.querySelector('#ccEditType')?.addEventListener('change', handleTypeChange);
      }
    };
    typeSelect.addEventListener('change', handleTypeChange);
  }
}

