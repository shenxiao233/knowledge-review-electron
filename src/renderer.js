const KEY = 'knowledge-review-ui-v2';
const OPTS = ['A', 'B', 'C', 'D'];
const NOTE_RATINGS = {
  familiar: { label: '熟悉', className: 'familiar' },
  fuzzy: { label: '模糊', className: 'fuzzy' },
  forgot: { label: '没印象', className: 'forgot' }
};
const DAY = 86400000;
const $ = (q) => document.querySelector(q);
const $$ = (q) => [...document.querySelectorAll(q)];
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const today = () => dateKey(new Date());
const dateKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatDate = (value) => new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

const sampleDocs = [
  { id: 'doc-study', folderId: 'folder-study', title: '间隔重复学习法', html: '<h1>间隔重复学习法</h1><p>间隔重复是在遗忘曲线下降之前安排复习，逐步拉长复习间隔。</p><h2>核心原则</h2><ul><li>主动回忆</li><li>逐步延长间隔</li><li>错误内容及时再现</li></ul>' },
  { id: 'doc-reading', folderId: 'folder-study', title: '高效阅读与知识整理', html: '<h1>高效阅读与知识整理</h1><p>阅读的目标不是划线数量，而是把信息转化为可检索、可解释和可复用的知识。</p><h2>阅读前</h2><ul><li>明确阅读问题</li><li>快速浏览目录和摘要</li></ul><h2>阅读后</h2><ul><li>用自己的语言写摘要</li><li>提炼概念并建立卡片</li></ul>' },
  { id: 'doc-react', folderId: 'folder-frontend', title: 'React Hooks 核心概念', html: '<h1>React Hooks 核心概念</h1><p>React Hooks 让函数组件拥有状态管理和生命周期能力。</p><h2>基础 Hooks</h2><ul><li><strong>useState</strong> - 状态管理</li><li><strong>useEffect</strong> - 副作用处理</li><li><strong>useMemo</strong> - 值记忆化</li></ul>' }
];
const sampleFolders = [
  { id: 'folder-study', name: '学习科学', color: '#2f7d64' },
  { id: 'folder-frontend', name: '前端技术', color: '#28a9c7' }
];
function makeCard(question, options, answer, explanation, tags, type = 'single') {
  return normCard({ id: id('card'), type, folder: tags[0], question, options, answer, explanation, tags });
}
const sampleCards = [
  makeCard('间隔重复学习法的核心原则是什么？', { A: '立即重复', B: '依据遗忘曲线逐步延长复习间隔', C: '每天固定重复', D: '同时学习多个科目' }, ['B'], '在快速遗忘前主动回忆，可以提高长期保持。', ['学习科学']),
  makeCard('useEffect 常用于处理什么？', { A: '样式覆盖', B: '副作用逻辑', C: '路由命名', D: '字体加载' }, ['B'], '请求、订阅和定时器等副作用适合放入 useEffect。', ['前端技术']),
  makeCard('主动回忆比重复阅读更适合长期记忆。', { A: '正确', B: '错误', C: '', D: '' }, ['A'], '主动从记忆中提取内容，是间隔重复的重要基础。', ['学习科学']),
  makeCard('useMemo 的主要用途是什么？', { A: '缓存计算结果', B: '创建组件', C: '发送请求', D: '定义路由' }, ['A'], 'useMemo 用于缓存计算结果，避免不必要的重复计算。', ['前端技术']),
  makeCard('遗忘曲线', {}, [], '记录一个概念的定义、例子和自己的理解。', ['学习科学'], 'note')
];
const base = {
  folders: sampleFolders,
  documents: sampleDocs,
  activeDocId: 'doc-react',
  cards: sampleCards,
  reviewLog: {},
  settings: { forgettingFactor: 2.5, dailyLimit: 50 },
  selectedCardId: sampleCards[0].id,
  extractedText: '',
  groups: ['学习科学', '前端技术'],
  trash: { documents: [], folders: [], cards: [] }
};

let state = load();
let els = {};
let queue = [];
let index = 0;
let answered = false;
let answer = [];
let selectedCardIds = new Set();
let lastNext = 0;
let createMode = 'document';
let trashTab = 'documents';
let heatmapMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function normCard(card) {
  const type = ['single', 'multiple', 'note'].includes(card.type) ? card.type : 'single';
  const answers = Array.isArray(card.answer) ? card.answer : card.answer ? [card.answer] : [];
  return {
    ...card,
    id: card.id || id('card'),
    type,
    folder: card.folder || '未分组',
    question: card.question || '',
    options: { A: card.options?.A || '', B: card.options?.B || '', C: card.options?.C || '', D: card.options?.D || '' },
    answer: type === 'note' ? [] : answers,
    noteContent: card.noteContent || (type === 'note' ? card.explanation || '' : ''),
    noteRating: type === 'note' && NOTE_RATINGS[card.noteRating] ? card.noteRating : '',
    explanation: type === 'note' ? '' : card.explanation || '',
    tags: Array.isArray(card.tags) && card.tags.length ? card.tags : ['未分组'],
    dueAt: card.dueAt || new Date().toISOString(),
    createdAt: card.createdAt || new Date().toISOString(),
    ease: Number(card.ease || 2.5),
    interval: Number(card.interval || 1),
    reviews: Number(card.reviews || 0)
  };
}
function normDoc(doc) {
  return { ...doc, id: doc.id || id('doc'), folderId: doc.folderId || null, title: doc.title || '未命名文档', html: doc.html || '<h1>未命名文档</h1><p>开始记录你的知识。</p>' };
}
function load() {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem('knowledge-review-state-v1');
    if (!raw) return structuredClone(base);
    const saved = JSON.parse(raw);
    const documents = Array.isArray(saved.documents) && saved.documents.length ? saved.documents.map(normDoc) : structuredClone(sampleDocs);
    sampleDocs.forEach((doc) => { if (!documents.some((item) => item.id === doc.id)) documents.push(structuredClone(doc)); });
    const cards = Array.isArray(saved.cards) && saved.cards.length ? saved.cards.map(normCard) : structuredClone(sampleCards);
    return {
      ...structuredClone(base), ...saved,
      folders: Array.isArray(saved.folders) && saved.folders.length ? saved.folders : structuredClone(sampleFolders),
      documents,
      cards,
      reviewLog: saved.reviewLog || {},
      settings: { ...base.settings, ...(saved.settings || {}) },
      trash: { ...base.trash, ...(saved.trash || {}) },
      groups: [...new Set([...(saved.groups || []), ...cards.map((card) => card.folder)])],
      activeDocId: documents.some((doc) => doc.id === saved.activeDocId) ? saved.activeDocId : documents[0]?.id
    };
  } catch {
    return structuredClone(base);
  }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('本地空间不足，请先导出备份。'); }
}
function activeDoc() { return state.documents.find((doc) => doc.id === state.activeDocId) || state.documents[0]; }
function cache() {
  ['noteEditor', 'outlineList', 'heatmap', 'heatmapPrev', 'heatmapNext', 'heatmapMonthLabel', 'profileHeatmap', 'profileHeatmapPrev', 'profileHeatmapNext', 'profileHeatmapMonthLabel', 'cardGroupSelect', 'cardTypeSelect', 'answerChoices', 'todayCount', 'questionCard', 'reviewProgressText', 'remainingText', 'progressRing', 'nextButton', 'cardModal', 'cardForm', 'createModal', 'createForm', 'exportModal', 'cardList', 'folderFilter', 'tagFilter', 'cardTypeFilter', 'cardStatusFilter', 'cardSearchInput', 'cardSummary', 'cardGroupRail', 'bulkSelectionBar', 'selectedCardCount', 'bulkDeleteCardsButton', 'toast', 'forgettingFactor', 'forgettingValue', 'dailyLimit', 'intervalPreview'].forEach((key) => { els[key] = document.getElementById(key); });
}
function init() { cache(); enhanceSelects(); bind(); loadDoc(); syncSettings(); refresh(); }
function bind() {
  $('#windowMinimizeButton')?.addEventListener('click', () => window.reviewBridge.windowControls.minimize());
  $('#windowMaximizeButton')?.addEventListener('click', async () => { const maximized = await window.reviewBridge.windowControls.toggleMaximize(); $('#windowMaximizeButton').title = maximized ? '还原窗口' : '最大化'; });
  $('#windowCloseButton')?.addEventListener('click', () => window.reviewBridge.windowControls.close());
  $('#windowChrome')?.addEventListener('dblclick', (event) => { if (!event.target.closest('button')) window.reviewBridge.windowControls.toggleMaximize(); });
  $$('.rail-btn,[data-view]').forEach((button) => button.addEventListener('click', () => button.dataset.view && view(button.dataset.view)));
  $$('.formatbar [data-command]').forEach((button) => button.addEventListener('click', () => editorCommand(button.dataset.command, button.dataset.value)));
  $('#blockFormat').addEventListener('change', (event) => editorCommand('formatBlock', event.target.value));
  $('#fontSizeSelect').addEventListener('change', (event) => editorCommand('fontSize', event.target.value));
  $$('.formatbar .select-trigger, .formatbar [data-command]').forEach((button) => button.addEventListener('mousedown', (event) => { rememberSelection(); event.preventDefault(); }));
  els.noteEditor.addEventListener('input', () => { saveDoc(); outline(); });
  els.noteEditor.addEventListener('mouseup', rememberSelection);
  els.noteEditor.addEventListener('keyup', rememberSelection);
  els.noteEditor.addEventListener('paste', handleEditorPaste);
  els.noteEditor.addEventListener('keydown', handleEditorKeydown);
  $('#insertImageButton').addEventListener('click', insertImage);
  $('#quickCreateFromSelection').addEventListener('click', quickCard);
  $('#openCreatorButton').addEventListener('click', () => openCard());
  $('#closeModalButton').addEventListener('click', () => els.cardModal.close());
  $('#cancelCardButton').addEventListener('click', () => els.cardModal.close());
  els.cardForm.addEventListener('submit', saveCard);
  els.cardTypeSelect.addEventListener('change', renderCardTypeFields);
  $$('.image-insert-button').forEach((button) => button.addEventListener('click', () => insertCardImage(button.dataset.cardImage)));
  els.nextButton.addEventListener('click', next);
  $('#exportTopButton').addEventListener('click', () => openExport('all'));
  $('#exportSelectedButton').addEventListener('click', () => openExport('selected'));
  $('#exportFolderButton').addEventListener('click', () => openExport('folder'));
  $('#storageExportButton').addEventListener('click', exportAllState);
  $('#chooseDataDirectoryButton').addEventListener('click', chooseDataDirectory);
  $('#migrateDataButton').addEventListener('click', migrateData);
  $('#closeExportButton').addEventListener('click', () => els.exportModal.close());
  $('#confirmExportButton').addEventListener('click', exportCards);
  $('#importButton').addEventListener('click', importCards);
  els.cardSearchInput.addEventListener('input', renderCards);
  els.folderFilter.addEventListener('change', renderCards);
  els.tagFilter.addEventListener('change', renderCards);
  els.cardTypeFilter.addEventListener('change', renderCards);
  els.cardStatusFilter.addEventListener('change', renderCards);
  $('#clearCardFilters').addEventListener('click', clearCardFilters);
  $('#selectAllCardsButton').addEventListener('click', toggleSelectAllCards);
  $('#clearCardSelectionButton').addEventListener('click', clearCardSelection);
  $('#bulkDeleteCardsButton').addEventListener('click', bulkDeleteCards);
  $('#newGroupButton').addEventListener('click', openCreateGroup);
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
  $$('.trash-tabs [data-trash-tab]').forEach((button) => button.addEventListener('click', () => { trashTab = button.dataset.trashTab; renderTrash(); }));
  $('#toggleOutlineButton').addEventListener('click', toggleOutline);
  $('#toggleReviewButton').addEventListener('click', toggleReview);
  $$('.settings-nav button').forEach((button) => button.addEventListener('click', () => setting(button.dataset.setting)));
  [els.forgettingFactor, els.dailyLimit].forEach((input) => input.addEventListener('input', settings));
  $('.toast-close')?.addEventListener('click', () => els.toast.classList.remove('show'));
}
function view(name) { $$('.view').forEach((item) => item.classList.toggle('active', item.id === `${name}View`)); $$('.rail-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === name)); if (name === 'cards') renderCards(); if (name === 'review') renderStandalone(); if (name === 'profile') renderProfile(); if (name === 'trash') renderTrash(); }
function refresh() { renderTree(); outline(); renderHeatmaps(); renderDock(); renderCards(); renderProfile(); renderTrash(); badges(); }
function setting(name) { $$('.settings-nav button').forEach((button) => button.classList.toggle('active', button.dataset.setting === name)); $$('.setting-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${name}Panel`)); }
function saveDoc() { const doc = activeDoc(); if (!doc) return; doc.html = els.noteEditor.innerHTML; doc.updatedAt = new Date().toISOString(); save(); }
function loadDoc() { const doc = activeDoc(); els.noteEditor.innerHTML = /(^|\n)#{1,6}\s|(^|\n)[-*+]\s/.test(doc?.html || '') ? markdownToHtml(doc.html) : doc?.html || '<h1>未命名文档</h1><p>开始记录你的知识。</p>'; els.noteEditor.scrollTop = 0; outline(); }
function toggleOutline() { const grid = document.querySelector('.doc-body-grid'); const pane = $('#outlinePane'); const button = $('#toggleOutlineButton'); const collapsed = grid.classList.toggle('outline-collapsed'); pane.classList.toggle('is-collapsed', collapsed); button.classList.toggle('active', collapsed); button.title = collapsed ? '展开大纲' : '收起大纲'; }
function toggleReview() { const grid = document.querySelector('.doc-body-grid'); const dock = $('#reviewDock'); const button = $('#toggleReviewButton'); const collapsed = grid.classList.toggle('review-collapsed'); dock.classList.toggle('is-collapsed', collapsed); button.classList.toggle('active', collapsed); button.title = collapsed ? '展开复习栏' : '收起复习栏'; }
function editorCommand(command, value) { focusEditorSelection(); if (command === 'formatBlock') { document.execCommand('formatBlock', false, `<${value}>`); } else if (command === 'createLink') { const url = prompt('链接地址', 'https://'); if (!url) return; document.execCommand('createLink', false, url); } else if (command === 'fontSize') { document.execCommand('fontSize', false, '7'); els.noteEditor.querySelectorAll('font[size="7"]').forEach((node) => { const span = document.createElement('span'); span.style.fontSize = `${value}px`; span.innerHTML = node.innerHTML; node.replaceWith(span); }); } else if (command === 'grayBlock') { const selection = window.getSelection(); const node = selection?.anchorNode?.parentElement?.closest('p,h1,h2,h3,h4,h5,h6,blockquote,li'); if (node && els.noteEditor.contains(node)) node.classList.toggle('gray-block'); else document.execCommand('backColor', false, value || '#f1f1f1'); } else document.execCommand(command, false, value || null); els.noteEditor.focus(); saveDoc(); outline(); }
function focusEditorSelection() { els.noteEditor.focus(); if (savedSelection) { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(savedSelection); } }
let savedSelection = null;
function outline() { const headings = [...els.noteEditor.querySelectorAll('h1,h2,h3,h4,h5,h6')]; els.outlineList.innerHTML = headings.map((heading, i) => { heading.id = `heading-${i}`; return `<button class="${heading.tagName.toLowerCase()}" title="${esc(heading.textContent || '未命名')}" data-heading="${heading.id}">${esc(heading.textContent || '未命名')}</button>`; }).join(''); els.outlineList.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { const heading = document.getElementById(button.dataset.heading); const paper = document.querySelector('.paper'); if (!heading || !paper) return; paper.scrollTo({ top: Math.max(0, heading.offsetTop - 28), behavior: 'smooth' }); })); const doc = activeDoc(); const folder = state.folders.find((item) => item.id === doc?.folderId); $('#docCrumbFolder').textContent = folder?.name || '未分组'; $('#docCrumbTitle').textContent = doc?.title || '未命名文档'; }
function markdownInline(value, options = {}) { const html = esc(value).replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => `<img src="${markdownUrl(url)}" alt="${esc(alt)}" loading="lazy">`).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `<a href="${markdownUrl(url)}" target="_blank" rel="noreferrer">${label}</a>`).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>').replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/==([^=]+)==/g, '<mark>$1</mark>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/_([^_]+)_/g, '<em>$1</em>'); return options.noteEntries ? html.replace(/\[([^\]]+)\]/g, '<span class="note-link-hint">[$1]</span>') : html; }
function markdownToHtml(markdown, options = {}) { const lines = String(markdown || '').replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').split('\n'); const out = []; let list = null; let inCode = false; let codeLines = []; const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } }; const closeCode = () => { if (inCode) { out.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`); codeLines = []; inCode = false; } }; const escapeHtml = (value) => markdownInline(value, options); lines.forEach((line) => { const value = line.replace(/\t/g, '  ').trimEnd(); if (/^\s*```/.test(value)) { closeList(); if (inCode) closeCode(); else inCode = true; return; } if (inCode) { codeLines.push(value); return; } if (!value.trim()) { closeList(); return; } let match = value.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/); if (match) { closeList(); const level = Number(match[1].length); out.push(`<h${level}>${escapeHtml(match[2])}</h${level}>`); return; } if (options.noteEntries && (match = value.match(/^\s*(专题|真题|例句)\s*(.*)$/))) { closeList(); const label = match[1]; const labelClass = label === '专题' ? 'topic' : label === '真题' ? 'question' : 'example'; out.push(`<p class="note-entry"><span class="note-entry-label ${labelClass}">${label}</span><span class="note-entry-body">${escapeHtml(match[2])}</span></p>`); return; } match = value.match(/^\s*([-*+])\s+(.+)$/); if (match) { if (list !== 'ul') { closeList(); list = 'ul'; out.push('<ul>'); } out.push(`<li>${escapeHtml(match[2])}</li>`); return; } match = value.match(/^\s*(\d+)[.)]\s+(.+)$/); if (match) { if (list !== 'ol') { closeList(); list = 'ol'; out.push('<ol>'); } out.push(`<li>${escapeHtml(match[2])}</li>`); return; } if (/^\s*>/.test(value)) { closeList(); out.push(`<blockquote>${escapeHtml(value.replace(/^\s*>\s?/, ''))}</blockquote>`); return; } if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(value)) { closeList(); out.push('<hr>'); return; } closeList(); out.push(`<p>${escapeHtml(value)}</p>`); }); closeList(); closeCode(); return out.join(''); }
function sanitizeClipboardHtml(html) { const doc = new DOMParser().parseFromString(html, 'text/html'); doc.querySelectorAll('script,style,meta,link,iframe,object,form').forEach((node) => node.remove()); doc.querySelectorAll('*').forEach((node) => { [...node.attributes].forEach((attribute) => { if (attribute.name.toLowerCase().startsWith('on')) node.removeAttribute(attribute.name); if (attribute.name === 'href' && !/^(https?:|mailto:|#)/i.test(attribute.value)) node.removeAttribute(attribute.name); if (attribute.name === 'src' && !/^(https?:|data:image\/)/i.test(attribute.value)) node.removeAttribute(attribute.name); }); }); return doc.body.innerHTML; }
function handleEditorPaste(event) { const clipboard = event.clipboardData; const markdown = clipboard?.getData('text/markdown') || ''; const plain = clipboard?.getData('text/plain') || ''; const html = clipboard?.getData('text/html') || ''; const source = markdown.trim() || plain.trim(); if (!source && !html.trim()) return; const hasStructuredHtml = /<(h[1-6]|ul|ol|blockquote|pre|table|img|a)\b/i.test(html); const looksLikeMarkdown = /(^|\n)\s*#{1,6}\s+|(^|\n)\s*[-*+]\s+|(^|\n)\s*\d+[.)]\s+|\*\*[^*]+\*\*|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)/.test(source); if (!hasStructuredHtml && !looksLikeMarkdown) return; event.preventDefault(); focusEditorSelection(); document.execCommand('insertHTML', false, hasStructuredHtml ? sanitizeClipboardHtml(html) : markdownToHtml(source)); saveDoc(); outline(); }
function handleEditorKeydown(event) { const anchor = window.getSelection()?.anchorNode; const node = anchor?.nodeType === 1 ? anchor : anchor?.parentElement; const block = node?.closest?.('.gray-block'); if (block && els.noteEditor.contains(block) && event.key === 'Enter') { event.preventDefault(); document.execCommand('insertHTML', false, '<br>'); saveDoc(); outline(); } }
function insertImage() { const url = prompt('图片地址', 'https://'); if (!url) return; focusEditorSelection(); document.execCommand('insertHTML', false, `<img src="${esc(url)}" alt="插入图片">`); saveDoc(); outline(); }
function rememberSelection() { const selection = window.getSelection(); const text = selection?.toString().trim() || ''; if (selection?.rangeCount && els.noteEditor.contains(selection.anchorNode)) savedSelection = selection.getRangeAt(0).cloneRange(); if (text) state.extractedText = text; }
function quickCard() { const text = state.extractedText.trim(); if (!text) return toast('请先在编辑器中选中文本。'); openCard(); $('#questionInput').value = `解释：${text.slice(0, 40)}`; $('#explanationInput').value = text; }
function openCard(cardId = null) { const card = cardId ? state.cards.find((item) => item.id === cardId) : null; els.cardForm.reset(); els.cardModal.dataset.editingId = card?.id || ''; $('#cardModalTitle').textContent = card ? '编辑复习卡片' : '新建复习卡片'; fill(els.cardGroupSelect, [...new Set([...(state.groups || []), ...state.cards.map((item) => item.folder)])]); els.cardGroupSelect.value = card?.folder || state.groups?.[0] || '学习科学'; syncCustomSelect(els.cardGroupSelect); $('#cardTypeSelect').value = card?.type || 'single'; syncCustomSelect(els.cardTypeSelect); $('#questionInput').value = card?.question || state.extractedText || ''; $('#optionA').value = card?.options.A || ''; $('#optionB').value = card?.options.B || ''; $('#optionC').value = card?.options.C || ''; $('#optionD').value = card?.options.D || ''; $('#noteContentInput').value = card?.noteContent || ''; $('#explanationInput').value = card?.explanation || ''; $('#tagInput').value = (card?.tags || ['学习科学']).join(', '); renderCardTypeFields(); renderAnswerChoices(card?.answer || []); els.cardModal.showModal(); }
function renderCardTypeFields() { const note = els.cardTypeSelect.value === 'note'; $('#cardOptionsGrid').classList.toggle('hidden', note); $('#cardAnswersField').classList.toggle('hidden', note); $('#noteContentField').classList.toggle('hidden', !note); $('#explanationField').classList.toggle('hidden', note); if (!note) renderAnswerChoices(); }
function renderAnswerChoices(selected = []) { const multiple = els.cardTypeSelect.value === 'multiple'; els.answerChoices.innerHTML = OPTS.map((key) => `<label><input type="${multiple ? 'checkbox' : 'radio'}" name="answer" value="${key}" ${selected.includes(key) ? 'checked' : ''}><span>${key}</span></label>`).join(''); }
function insertCardImage(targetId) { const url = prompt('图片地址', 'https://'); if (!url) return; const field = document.getElementById(targetId); field.value += `${field.value ? '\n' : ''}![图片](${url})`; field.focus(); }
function markdownUrl(value, fallback = '#') { const url = String(value || '').trim(); return /^(https?:|mailto:|#|data:image\/)/i.test(url) ? esc(url) : fallback; }
function cardHtml(value) { return esc(String(value || '')).replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => `<img src="${markdownUrl(url)}" alt="${esc(alt)}" loading="lazy">`).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `<a href="${markdownUrl(url)}" target="_blank" rel="noreferrer">${label}</a>`).replace(/\n/g, '<br>'); }
function noteMarkdownHtml(value) { const raw = String(value || '').trim(); if (!raw) return '<p class="note-empty-content">暂无速记内容</p>'; if (/^\s*<(p|h[1-6]|ul|ol|blockquote|pre|img|a)\b/i.test(raw)) return sanitizeClipboardHtml(raw); return markdownToHtml(raw, { noteEntries: true }); }
function noteRatingBadge(card) { const rating = NOTE_RATINGS[card.noteRating]; return rating ? `<span class="review-stamp-mini ${rating.className}">${rating.label}</span>` : '<span class="review-stamp-mini pending">未评价</span>'; }
function saveCard(event) { event.preventDefault(); const type = els.cardTypeSelect.value; const tags = String($('#tagInput').value || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean); const folder = els.cardGroupSelect.value || tags[0] || '未分组'; const options = { A: $('#optionA').value.trim(), B: $('#optionB').value.trim(), C: $('#optionC').value.trim(), D: $('#optionD').value.trim() }; const selected = [...document.querySelectorAll('input[name="answer"]:checked')].map((input) => input.value); const question = $('#questionInput').value.trim(); if (!question) return toast('请填写题干或词条。'); if (type === 'note') { if (!$('#noteContentInput').value.trim()) return toast('请填写速记内容。'); } else { if (!selected.length) return toast('请选择正确答案。'); if (type === 'multiple' && selected.length < 2) return toast('多选题至少选择两个答案。'); if (!Object.values(options).some(Boolean)) return toast('至少填写一个选项。'); } const data = normCard({ id: els.cardModal.dataset.editingId || id('card'), type, folder, question, options, answer: selected, noteContent: $('#noteContentInput').value.trim(), explanation: $('#explanationInput').value.trim(), tags: tags.length ? tags : [folder] }); const old = state.cards.findIndex((item) => item.id === data.id); if (old >= 0) state.cards[old] = { ...state.cards[old], ...data }; else state.cards.unshift(data); state.groups = [...new Set([...(state.groups || []), folder])]; state.selectedCardId = data.id; save(); els.cardModal.close(); answered = false; refresh(); toast(old >= 0 ? '卡片已更新。' : '卡片已保存。'); }

function renderTree() { const tree = $('#documentTree'); tree.innerHTML = ''; const opened = renderTree.opened || (renderTree.opened = new Set(state.folders.map((folder) => folder.id))); state.folders.forEach((folder) => { const section = document.createElement('div'); section.className = 'tree-section'; const head = document.createElement('div'); head.className = 'tree-folder-row'; head.innerHTML = `<button class="tree-caret" title="展开或折叠"><svg><use href="#i-chevron-down"></use></svg></button><span class="folder-glyph" style="--folder-color:${folder.color}"><svg><use href="#i-folder"></use></svg></span><strong></strong><span class="count"></span><button class="tree-action" title="移入回收站"><svg><use href="#i-x"></use></svg></button>`; head.querySelector('strong').textContent = folder.name; head.querySelector('.count').textContent = state.documents.filter((doc) => doc.folderId === folder.id).length; head.onclick = (event) => { if (event.target.closest('.tree-action') || event.target.closest('.tree-caret')) return; opened.has(folder.id) ? opened.delete(folder.id) : opened.add(folder.id); renderTree(); }; head.querySelector('.tree-caret').onclick = () => { opened.has(folder.id) ? opened.delete(folder.id) : opened.add(folder.id); renderTree(); }; head.querySelector('.tree-action').onclick = (event) => { event.stopPropagation(); trashFolder(folder.id); }; head.ondragover = (event) => { event.preventDefault(); head.classList.add('drag-over'); }; head.ondragleave = () => head.classList.remove('drag-over'); head.ondrop = (event) => { event.preventDefault(); moveDoc(event.dataTransfer.getData('doc-id'), folder.id); }; section.appendChild(head); if (opened.has(folder.id)) state.documents.filter((doc) => doc.folderId === folder.id).forEach((doc) => section.appendChild(docRow(doc))); tree.appendChild(section); }); const loose = state.documents.filter((doc) => !doc.folderId); if (loose.length) { const section = document.createElement('div'); section.className = 'tree-section'; section.innerHTML = `<div class="tree-folder-row loose-folder-row"><span class="folder-glyph"><svg><use href="#i-folder"></use></svg></span><strong>未分组文档</strong><span class="count">${loose.length}</span></div>`; loose.forEach((doc) => section.appendChild(docRow(doc))); tree.appendChild(section); } }
function docRow(doc) { const row = document.createElement('div'); row.className = `tree-doc-row${doc.id === state.activeDocId ? ' active' : ''}`; row.draggable = true; row.innerHTML = '<span class="doc-glyph"><svg><use href="#i-file"></use></svg></span><span class="tree-doc-title"></span><button class="tree-action" title="移入回收站"><svg><use href="#i-x"></use></svg></button>'; row.querySelector('.tree-doc-title').textContent = doc.title; row.onclick = (event) => { if (!event.target.closest('.tree-action')) switchDoc(doc.id); }; row.ondragstart = (event) => event.dataTransfer.setData('doc-id', doc.id); row.querySelector('.tree-action').onclick = (event) => { event.stopPropagation(); trashDoc(doc.id); }; return row; }
function switchDoc(docId) { if (docId === state.activeDocId) return; saveDoc(); state.activeDocId = docId; state.extractedText = ''; loadDoc(); save(); renderTree(); }
function moveDoc(docId, folderId) { const doc = state.documents.find((item) => item.id === docId); if (!doc || doc.folderId === folderId) return; doc.folderId = folderId || null; save(); renderTree(); toast('文档已移动。'); }
function rootDrop(event) { event.preventDefault(); event.currentTarget.classList.remove('drag-over'); moveDoc(event.dataTransfer.getData('doc-id'), null); }
function openCreate(mode) { createMode = mode; $('#createModalTitle').textContent = mode === 'folder' ? '新建文件夹' : '新建文档'; $('#createNameInput').value = ''; $('#createFolderLabel').style.display = mode === 'folder' ? 'none' : 'grid'; $('#createFolderSelect').innerHTML = '<option value="">未分组</option>' + state.folders.map((folder) => `<option value="${folder.id}">${esc(folder.name)}</option>`).join(''); $('#createFolderSelect').value = activeDoc()?.folderId || ''; els.createModal.showModal(); }
function createItem(event) { event.preventDefault(); const name = $('#createNameInput').value.trim(); if (!name) return toast('请输入名称。'); if (createMode === 'folder') { if (state.folders.some((folder) => folder.name === name)) return toast('文件夹已存在。'); state.folders.push({ id: id('folder'), name, color: ['#2f7d64', '#28a9c7', '#8b73d6', '#d88746'][state.folders.length % 4] }); } else { const doc = { id: id('doc'), folderId: $('#createFolderSelect').value || null, title: name, html: `<h1>${esc(name)}</h1><p>开始记录你的知识。</p>` }; state.documents.push(doc); state.activeDocId = doc.id; } save(); els.createModal.close(); loadDoc(); refresh(); toast(createMode === 'folder' ? '文件夹已创建。' : '文档已创建。'); }
function trashDoc(docId) { const at = state.documents.findIndex((doc) => doc.id === docId); if (at < 0) return; state.trash.documents.push(state.documents.splice(at, 1)[0]); if (state.activeDocId === docId) state.activeDocId = state.documents[0]?.id || ''; save(); loadDoc(); refresh(); toast('文档已移入回收站。'); }
function trashFolder(folderId) { const at = state.folders.findIndex((folder) => folder.id === folderId); if (at < 0) return; const folder = state.folders.splice(at, 1)[0]; const documents = state.documents.filter((doc) => doc.folderId === folderId); state.documents = state.documents.filter((doc) => doc.folderId !== folderId); state.trash.folders.push({ folder, documents }); if (documents.some((doc) => doc.id === state.activeDocId)) state.activeDocId = state.documents[0]?.id || ''; save(); loadDoc(); refresh(); toast('文件夹已移入回收站。'); }

function cardMatches(card) { const query = els.cardSearchInput.value.trim().toLowerCase(); const folder = els.folderFilter.value; const tag = els.tagFilter.value; const type = els.cardTypeFilter.value; const status = els.cardStatusFilter.value; return (!query || [card.question, card.folder, card.tags.join(' '), card.noteContent].join(' ').toLowerCase().includes(query)) && (!folder || folder === '全部文件夹' || card.folder === folder) && (!tag || tag === '全部标签' || card.tags.includes(tag)) && (!type || type === '全部类型' || card.type === type) && (!status || status === '全部状态' || status === (isDue(card) ? 'due' : 'mastered')); }
function renderCardSummary() { const due = state.cards.filter(isDue).length; const notes = state.cards.filter((card) => card.type === 'note').length; els.cardSummary.innerHTML = [['#i-layers', state.cards.length, '全部卡片'], ['#i-review', due, '待复习'], ['#i-book', notes, '速记词条'], ['#i-flame', totalReviews(), '累计复习']].map(([icon, value, label]) => `<div class="card-summary-item"><svg><use href="${icon}"></use></svg><div><b>${value}</b><span>${label}</span></div></div>`).join(''); $('#cardTotalBadge').textContent = `${state.cards.length} 张`; }
function renderCardGroups() { const groups = [...new Set([...(state.groups || []), ...state.cards.map((card) => card.folder)])]; $('#cardGroupCount').textContent = groups.length; els.cardGroupRail.innerHTML = `<div class="card-group-row"><button class="card-group-link ${els.folderFilter.value === '全部文件夹' ? 'active' : ''}" data-group="全部文件夹"><span class="group-dot all"></span><span>全部卡片</span><b>${state.cards.length}</b></button></div>` + groups.map((group) => `<div class="card-group-row"><button class="card-group-link ${els.folderFilter.value === group ? 'active' : ''}" data-group="${esc(group)}"><span class="group-dot"></span><span>${esc(group)}</span><b>${state.cards.filter((card) => card.folder === group).length}</b></button><button class="card-group-delete" title="删除卡组" data-group-delete="${esc(group)}"><svg><use href="#i-trash"></use></svg></button></div>`).join(''); els.cardGroupRail.querySelectorAll('[data-group]').forEach((button) => button.addEventListener('click', () => { els.folderFilter.value = button.dataset.group; syncCustomSelect(els.folderFilter); renderCards(); })); els.cardGroupRail.querySelectorAll('[data-group-delete]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); deleteCardGroup(button.dataset.groupDelete); })); }
function renderFilters() { const folders = ['全部文件夹', ...new Set(state.cards.map((card) => card.folder))]; const tags = ['全部标签', ...new Set(state.cards.flatMap((card) => card.tags))]; fill(els.folderFilter, folders); fill(els.tagFilter, tags); }
function fill(select, values) { const old = select.value; select.innerHTML = values.map((value) => `<option>${esc(value)}</option>`).join(''); if (values.includes(old)) select.value = old; syncCustomSelect(select); }
function enhanceSelects() { $$('select').forEach((select) => { if (select.parentElement?.classList.contains('select-shell')) return; const shell = document.createElement('div'); shell.className = `select-shell${select.closest('.formatbar') ? ' format-select-shell' : ''}`; select.parentNode.insertBefore(shell, select); shell.appendChild(select); const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', select.title || select.getAttribute('aria-label') || '选择'); const menu = document.createElement('div'); menu.className = 'select-menu'; menu.setAttribute('role', 'listbox'); shell.append(trigger, menu); trigger.addEventListener('click', (event) => { event.stopPropagation(); const open = shell.classList.toggle('open'); trigger.setAttribute('aria-expanded', String(open)); $$('.select-shell.open').filter((item) => item !== shell).forEach((item) => { item.classList.remove('open'); item.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false'); }); if (open && shell.classList.contains('format-select-shell')) { const rect = trigger.getBoundingClientRect(); menu.style.top = `${rect.bottom + 7}px`; menu.style.left = `${rect.left}px`; menu.style.minWidth = `${Math.max(rect.width, select.id === 'blockFormat' ? 96 : 82)}px`; } }); menu.addEventListener('click', (event) => { const option = event.target.closest('[data-option]'); if (!option) return; select.value = option.dataset.option; select.dispatchEvent(new Event('change', { bubbles: true })); shell.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); }); select.addEventListener('change', () => syncCustomSelect(select)); syncCustomSelect(select); }); document.addEventListener('click', (event) => { if (!event.target.closest('.select-shell')) $$('.select-shell.open').forEach((shell) => { shell.classList.remove('open'); shell.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false'); }); }); }
function syncCustomSelect(select) { const shell = select?.parentElement?.classList.contains('select-shell') ? select.parentElement : null; if (!shell) return; const trigger = shell.querySelector('.select-trigger'); const menu = shell.querySelector('.select-menu'); const options = [...select.options]; trigger.textContent = options.find((option) => option.value === select.value)?.textContent || select.value || ''; menu.innerHTML = options.map((option) => `<button type="button" role="option" data-option="${esc(option.value)}" class="${option.value === select.value ? 'selected' : ''}">${esc(option.textContent)}</button>`).join(''); }
function renderCards() { renderFilters(); renderCardSummary(); renderCardGroups(); const list = state.cards.filter(cardMatches); const folderName = els.folderFilter.value || '全部文件夹'; $('#cardListTitle').textContent = folderName; $('#cardListMeta').textContent = `${list.length} 张卡片`; els.cardList.innerHTML = list.length ? list.map((card) => { const typeLabel = card.type === 'note' ? '速记词条' : card.type === 'multiple' ? '多选题' : '单选题'; const status = card.type === 'note' ? noteRatingBadge(card) : isDue(card) ? '<span class="card-status due">待复习</span>' : '<span class="card-status">已掌握</span>'; const preview = card.type === 'note' ? noteMarkdownHtml(card.noteContent) : cardHtml(`答案 ${card.answer.join('、')} · 下次复习 ${formatDate(card.dueAt)}`); return `<article class="card-item ${card.type === 'note' ? 'note-card-item' : ''} ${selectedCardIds.has(card.id) ? 'bulk-selected' : ''}" data-card="${card.id}"><div class="card-item-head"><span class="question-type">${typeLabel}</span>${status}</div><h3>${cardHtml(card.question)}</h3><div class="card-note-preview ${card.type === 'note' ? 'markdown-preview' : ''}">${preview}</div><div class="card-item-foot"><div class="tag-row">${card.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</div><div class="card-item-actions"><button class="card-edit" title="编辑卡片" data-card-edit="${card.id}"><svg><use href="#i-edit"></use></svg></button></div></div></article>`; }).join('') : '<div class="empty-state"><strong>没有符合条件的卡片</strong><span>调整筛选条件或新建一张复习卡片。</span></div>'; $$('#cardList .card-item').forEach((row) => row.addEventListener('click', (event) => { if (event.target.closest('[data-card-edit]')) return; const cardId = row.dataset.card; if (selectedCardIds.has(cardId)) selectedCardIds.delete(cardId); else selectedCardIds.add(cardId); state.selectedCardId = cardId; save(); renderCards(); })); $$('#cardList [data-card-edit]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); openCard(button.dataset.cardEdit); })); updateBulkSelection(list); }
function updateBulkSelection(list = state.cards.filter(cardMatches)) { const count = selectedCardIds.size; els.selectedCardCount.textContent = `已选择 ${count} 张`; els.bulkSelectionBar.classList.toggle('active', count > 0); els.bulkDeleteCardsButton.disabled = count === 0; $('#selectAllCardsButton').classList.toggle('active', list.length > 0 && list.every((card) => selectedCardIds.has(card.id))); }
function toggleSelectAllCards() { const list = state.cards.filter(cardMatches); if (list.every((card) => selectedCardIds.has(card.id))) list.forEach((card) => selectedCardIds.delete(card.id)); else list.forEach((card) => selectedCardIds.add(card.id)); renderCards(); }
function clearCardSelection() { selectedCardIds.clear(); renderCards(); }
function bulkDeleteCards() { const ids = new Set(selectedCardIds); if (!ids.size) return; state.trash.cards.push(...state.cards.filter((card) => ids.has(card.id))); state.cards = state.cards.filter((card) => !ids.has(card.id)); selectedCardIds.clear(); save(); refresh(); toast(`已将 ${ids.size} 张卡片移入回收站。`); }
function clearCardFilters() { els.cardSearchInput.value = ''; els.folderFilter.value = '全部文件夹'; els.tagFilter.value = '全部标签'; els.cardTypeFilter.value = '全部类型'; els.cardStatusFilter.value = '全部状态'; [els.folderFilter, els.tagFilter, els.cardTypeFilter, els.cardStatusFilter].forEach(syncCustomSelect); renderCards(); }
function trashCard(cardId) { const at = state.cards.findIndex((card) => card.id === cardId); if (at < 0) return; state.trash.cards.push(state.cards.splice(at, 1)[0]); if (state.selectedCardId === cardId) state.selectedCardId = state.cards[0]?.id || ''; save(); refresh(); toast('卡片已移入回收站。'); }
function openCreateGroup() { $('#createGroupName').value = ''; $('#createGroupModal').showModal(); $('#createGroupName').focus(); }
function saveGroup(event) { event.preventDefault(); const name = $('#createGroupName').value.trim(); if (!name) return toast('请输入卡组名称。'); if (state.groups.includes(name)) return toast('卡组已存在。'); state.groups.push(name); save(); $('#createGroupModal').close(); renderCards(); toast('卡组已创建。'); }
function deleteCardGroup(group) { const cards = state.cards.filter((card) => card.folder === group); if (!confirm(`删除卡组“${group}”及其中 ${cards.length} 张卡片？内容会移入回收站。`)) return; state.trash.cards.push(...cards); state.cards = state.cards.filter((card) => card.folder !== group); state.groups = state.groups.filter((item) => item !== group); if (els.folderFilter.value === group) { els.folderFilter.value = '全部文件夹'; syncCustomSelect(els.folderFilter); } cards.forEach((card) => selectedCardIds.delete(card.id)); save(); refresh(); toast(`卡组“${group}”已移入回收站。`); }

function renderQuestionLegacy(box, card, standalone) { const shell = box.closest('.review-shell'); if (!card) { shell?.classList.add('is-complete'); box.innerHTML = '<div class="review-complete"><div class="complete-mark"><svg><use href="#i-review"></use></svg></div><div class="completion-kicker">REVIEW SESSION</div><h2>今日复习已完成</h2><p>本次复习计划已经完成，明天继续保持。</p><button class="secondary-action" data-view="cards">查看卡片库</button></div>'; box.querySelector('[data-view]')?.addEventListener('click', () => view('cards')); els.nextButton.disabled = true; return; } shell?.classList.remove('is-complete'); const selected = Array.isArray(answer) ? answer : []; const head = `<div class="tag-row"><span class="tag">${esc(card.tags[0] || '未分组')}</span><span class="question-type">${card.type === 'note' ? '速记词条' : card.type === 'multiple' ? '多选题' : '单选题'}</span></div><div class="question-title">${cardHtml(card.question)}</div>`; if (card.type === 'note') { box.innerHTML = `${head}<div class="note-answer-content">${cardHtml(card.noteContent)}</div><div class="note-rating-block"><p>根据回忆程度选择反馈</p><div class="note-rating-actions">${[['familiar', '熟悉'], ['fuzzy', '模糊'], ['forgot', '没印象']].map(([value, label]) => `<button class="note-rating ${answered ? 'is-disabled' : ''}" data-rating="${value}" ${answered ? 'disabled' : ''}>${label}</button>`).join('')}</div></div>${answered && card.noteContent ? `<div class="explanation"><strong>速记内容</strong>${cardHtml(card.noteContent)}</div>` : ''}`; box.querySelectorAll('[data-rating]').forEach((button) => button.addEventListener('click', () => answerNoteCard(card, button.dataset.rating))); } else { box.innerHTML = `${head}<div class="options-block"></div>${answered && card.explanation ? `<div class="explanation"><strong>解析</strong>${cardHtml(card.explanation)}</div>` : ''}`; const block = box.querySelector('.options-block'); OPTS.forEach((key) => { const button = document.createElement('button'); button.className = 'option-button'; if (!answered && selected.includes(key)) button.classList.add('selected'); if (answered && card.answer.includes(key)) button.classList.add('correct'); if (answered && selected.includes(key) && !card.answer.includes(key)) button.classList.add('wrong'); button.innerHTML = `<span class="key">${key}</span><span>${cardHtml(card.options[key] || '未填写选项')}</span>`; button.disabled = answered; button.addEventListener('click', () => answerCard(card, key)); block.appendChild(button); }); if (card.type === 'multiple' && !answered) { const submit = document.createElement('button'); submit.className = 'next-button submit-answer'; submit.textContent = '提交答案'; submit.disabled = !selected.length; submit.addEventListener('click', () => finalizeMultiple(card)); box.appendChild(submit); } } els.nextButton.disabled = !answered; if (standalone && answered) { const nextButton = document.createElement('button'); nextButton.className = 'next-button'; nextButton.textContent = '下一题'; nextButton.addEventListener('click', next); box.appendChild(nextButton); } }
function buildQueue() { queue = state.cards.filter(isDue).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)).slice(0, Number(state.settings.dailyLimit) || 50); if (index >= queue.length) index = 0; }
function renderDock() { if (!answered) buildQueue(); renderQuestion(els.questionCard, queue[index], false); progress(); }
function renderStandalone() { if (!answered) buildQueue(); renderQuestion($('#standaloneQuestion'), queue[index], true); progress(); }
function finalizeMultiple(card) { if (!answer.length) return toast('请至少选择一个选项。'); answerCard(card, null, true); }
function answerCard(card, selected, submit = false) { if (answered) return; if (card.type === 'multiple' && !submit) { answer = answer.includes(selected) ? answer.filter((key) => key !== selected) : [...answer, selected]; renderDock(); renderStandalone(); return; } if (card.type === 'single') answer = [selected]; const correct = answer.length === card.answer.length && answer.every((key) => card.answer.includes(key)); recordReview(card, correct ? 'correct' : 'wrong'); }
function answerNoteCardLegacy(card, rating) { if (answered) return; recordReviewLegacy(card, rating); }
function recordReviewLegacy(card, rating) { answered = true; card.reviews += 1; const score = rating === 'familiar' || rating === 'correct'; if (score) { card.ease = Math.min(5, card.ease + 0.18); card.interval = Math.max(1, Math.round(card.interval * (card.ease + Number(state.settings.forgettingFactor) / 5))); card.dueAt = new Date(Date.now() + card.interval * DAY).toISOString(); } else { card.ease = Math.max(1.3, card.ease - 0.3); card.interval = rating === 'fuzzy' ? 0.25 : 0; card.dueAt = new Date(Date.now() + (rating === 'fuzzy' ? 6 : 1) * 3600000).toISOString(); } state.reviewLog[today()] = (state.reviewLog[today()] || 0) + 1; save(); renderDock(); renderStandalone(); renderHeatmaps(); renderProfile(); badges(); }
function next() { if (Date.now() - lastNext < 450) return; lastNext = Date.now(); answered = false; answer = []; index += 1; buildQueue(); renderDock(); renderStandalone(); }
function progress() { const done = state.reviewLog[today()] || 0; const total = Math.max(done + queue.length, 1); const current = queue.length ? Math.min(index + 1, queue.length) : total; const percent = Math.min(100, Math.round((current / total) * 100)); els.progressRing.style.background = `conic-gradient(var(--green) ${percent * 3.6}deg, #ece9e4 0deg)`; els.progressRing.querySelector('span').textContent = `${percent}%`; els.remainingText.textContent = `当前第 ${current} 题 / 共 ${total} 题`; els.reviewProgressText.textContent = queue.length ? `待复习 ${queue.length} 张` : '今日已完成'; $('#standaloneProgress').textContent = `${current} / ${total}`; $('#standalonePercent').textContent = `${percent}%`; $('#standaloneBar').style.width = `${percent}%`; $('#reviewedTodayTop').textContent = done; }

function shiftHeatmapMonth(offset) { heatmapMonth = new Date(heatmapMonth.getFullYear(), heatmapMonth.getMonth() + offset, 1); renderHeatmaps(); }
function renderHeatmaps() { renderGithubHeatmap(els.heatmap); renderGithubHeatmap(els.profileHeatmap); els.todayCount.textContent = `共 ${state.reviewLog[today()] || 0} 次复习`; }
function renderGithubHeatmap(box) { if (!box) return; const weeks = box.classList.contains('compact') ? 26 : 52; const totalDays = weeks * 7; const now = new Date(); now.setHours(0, 0, 0, 0); const start = new Date(now.getTime() - (totalDays - 1) * DAY); box.classList.remove('monthly-heatmap'); box.classList.add('github-heatmap'); box.innerHTML = ''; for (let i = 0; i < totalDays; i += 1) { const date = new Date(start.getTime() + i * DAY); const key = dateKey(date); const count = state.reviewLog[key] || 0; const cell = document.createElement('button'); cell.type = 'button'; cell.className = `heat-cell ${count > 30 ? 'heat-3' : count > 10 ? 'heat-2' : count ? 'heat-1' : ''}`; cell.title = `${key} · ${count} 次复习${i === totalDays - 1 ? ' · 今天' : ''}`; cell.setAttribute('aria-label', `${key}，${count} 次复习${i === totalDays - 1 ? '，今天' : ''}`); cell.dataset.date = key; if (i === totalDays - 1) cell.classList.add('today-cell'); cell.addEventListener('click', () => { $$('.heat-cell.selected').forEach((item) => item.classList.remove('selected')); cell.classList.add('selected'); toast(`${key} · ${count} 次复习`); }); box.appendChild(cell); } }

function renderProfile() { const todayCount = state.reviewLog[today()] || 0; const stats = [['#i-folder-plus', state.folders.length, '文件夹'], ['#i-file', state.documents.length, '文档'], ['#i-layers', state.cards.length, '卡片'], ['#i-review', todayCount, '今日复习'], ['#i-flame', `${streak()}天`, '连续打卡'], ['#i-review', totalReviews(), '累计复习']]; $('#profileStats').innerHTML = stats.map(([icon, value, label]) => `<div class="stat-box"><svg><use href="${icon}"></use></svg><b>${value}</b><span>${label}</span></div>`).join(''); renderGithubHeatmap(els.profileHeatmap); $('#profileDays').textContent = `${Object.keys(state.reviewLog).length} 天有记录`; $('#profileReviewCount').textContent = `共 ${totalReviews()} 次复习`; }
function renderTrash() { $$('.trash-tabs [data-trash-tab]').forEach((button) => button.classList.toggle('active', button.dataset.trashTab === trashTab)); const list = state.trash[trashTab] || []; const box = $('#trashContent'); if (!list.length) { box.innerHTML = '<div class="trash-empty"><div class="trash-empty-icon"><svg><use href="#i-trash"></use></svg></div><strong>回收站为空</strong><p>删除的内容会显示在这里，你可以随时恢复。</p></div>'; return; } const icon = trashTab === 'folders' ? '#i-folder' : trashTab === 'cards' ? '#i-layers' : '#i-file'; box.innerHTML = list.map((item, i) => { const data = trashTab === 'folders' ? item.folder : item; const label = trashTab === 'folders' ? `包含 ${item.documents.length} 篇文档` : trashTab === 'cards' ? `${data.type === 'note' ? '速记词条' : '复习卡片'} · ${data.tags?.join('、') || '未分组'}` : '知识文档'; const preview = trashTab === 'folders' ? item.documents.map((doc) => doc.title).join('、') || '文件夹为空' : trashTab === 'cards' ? (data.type === 'note' ? data.noteContent : data.explanation || Object.values(data.options || {}).filter(Boolean).join(' · ')) : String(data.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); return `<article class="trash-item"><div class="trash-item-icon"><svg><use href="${icon}"></use></svg></div><div class="trash-item-main"><strong>${esc(data.name || data.title || data.question)}</strong><span>${esc(label)}</span><p>${esc(preview || '暂无内容预览')}</p></div><div class="trash-item-actions"><button data-restore="${i}">恢复</button><button class="danger" data-permanent="${i}">彻底删除</button></div></article>`; }).join(''); box.querySelectorAll('[data-restore]').forEach((button) => button.addEventListener('click', () => restoreTrash(Number(button.dataset.restore)))); box.querySelectorAll('[data-permanent]').forEach((button) => button.addEventListener('click', () => { state.trash[trashTab].splice(Number(button.dataset.permanent), 1); save(); renderTrash(); })); }
function restoreTrash(at) { const item = state.trash[trashTab][at]; if (!item) return; if (trashTab === 'documents') state.documents.push(normDoc(item)); if (trashTab === 'cards') state.cards.push(normCard(item)); if (trashTab === 'folders') { state.folders.push(item.folder); state.documents.push(...item.documents.map(normDoc)); } state.trash[trashTab].splice(at, 1); save(); refresh(); toast('内容已恢复。'); }
function emptyTrash() { if (!state.trash[trashTab]?.length) return toast('当前分类没有内容。'); if (!confirm('确定彻底删除当前分类吗？')) return; state.trash[trashTab] = []; save(); renderTrash(); toast('回收站已清理。'); }
function syncSettings() { els.forgettingFactor.value = state.settings.forgettingFactor; els.dailyLimit.value = state.settings.dailyLimit; els.forgettingValue.textContent = Number(state.settings.forgettingFactor).toFixed(1); els.intervalPreview.innerHTML = [1, 2, 3, 4].map((n) => `<div><strong>第 ${n} 次答对</strong><br>${Math.round(n * n * state.settings.forgettingFactor)} 天后复习</div>`).join(''); if ($('#storagePath')) $('#storagePath').textContent = state.settings.dataDirectory || '尚未选择外部数据目录'; }
function settings() { if (Number(els.dailyLimit.value) <= 0) { els.dailyLimit.value = 1; return toast('每日上限必须大于 0。'); } state.settings.forgettingFactor = Number(els.forgettingFactor.value); state.settings.dailyLimit = Number(els.dailyLimit.value); save(); syncSettings(); progress(); }
async function chooseDataDirectory() { const result = await window.reviewBridge.chooseDataDirectory(); if (!result || result.canceled) return; state.settings.dataDirectory = result.directory; save(); $('#storagePath').textContent = result.directory; toast('数据目录已选择。'); }
async function migrateData() { const directory = state.settings.dataDirectory || (await window.reviewBridge.chooseDataDirectory())?.directory; if (!directory) return toast('请先选择数据目录。'); state.settings.dataDirectory = directory; const result = await window.reviewBridge.writeStorageSnapshot({ directory, content: JSON.stringify(state, null, 2) }); if (!result?.ok) return toast('数据迁移失败。'); save(); $('#storagePath').textContent = directory; toast('当前数据已迁移到所选目录。'); }
async function exportAllState() { const result = await window.reviewBridge.saveExportFile({ format: 'json', filename: 'knowledge-review-backup', content: JSON.stringify(state, null, 2) }); if (!result?.canceled) toast('全部数据导出完成。'); }
function openExport(scope) { $('#exportScope').value = scope; els.exportModal.showModal(); }
function markdownExport(card) { if (card.type === 'note') return `# ${card.question}\n\nType: note\n\n${card.noteContent}\n\nTags: ${card.tags.join(', ')}`; return `# ${card.question}\n\nType: ${card.type}\n\nA. ${card.options.A}\nB. ${card.options.B}\nC. ${card.options.C}\nD. ${card.options.D}\n\nAnswer: ${card.answer.join(', ')}\n\nExplanation: ${card.explanation}`; }
async function exportCards() { const scope = $('#exportScope').value; const format = $('#exportFormat').value; const list = scope === 'selected' ? state.cards.filter((card) => selectedCardIds.size ? selectedCardIds.has(card.id) : card.id === state.selectedCardId) : scope === 'folder' ? state.cards.filter((card) => card.folder === els.folderFilter.value) : state.cards; if (!list.length) return toast('没有可导出的卡片。'); const content = format === 'markdown' ? list.map(markdownExport).join('\n\n---\n\n') : JSON.stringify(list, null, 2); const result = await window.reviewBridge.saveExportFile({ format, filename: 'knowledge-cards', content }); els.exportModal.close(); if (!result?.canceled) toast('导出完成。'); }
function parseMarkdownCards(content) { return content.split(/\n---\n/).map((chunk) => { const lines = chunk.split('\n'); const question = lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim(); const type = lines.find((line) => /^Type:\s*/i.test(line))?.replace(/^Type:\s*/i, '').trim(); if (!question) return null; if (type === 'note') return normCard({ type: 'note', question, noteContent: lines.slice(3).join('\n').split(/\nTags:/i)[0].trim(), tags: ['导入'] }); const options = {}; OPTS.forEach((key) => { options[key] = lines.find((line) => new RegExp(`^${key}\\.\\s*`).test(line))?.replace(new RegExp(`^${key}\\.\\s*`), '').trim() || ''; }); const answer = lines.find((line) => /^Answer:/i.test(line))?.replace(/^Answer:\s*/i, '').split(/[,，]/).map((value) => value.trim()).filter(Boolean) || []; const explanation = lines.find((line) => /^Explanation:/i.test(line))?.replace(/^Explanation:\s*/i, '').trim() || ''; return normCard({ question, type: type === 'multiple' ? 'multiple' : 'single', options, answer, explanation, tags: ['导入'] }); }).filter(Boolean); }
async function importCards() { const file = await window.reviewBridge.openCardsFile(); if (!file || !file.content.trim()) return toast('请选择有效文件。'); try { const cards = file.extension === '.json' ? (Array.isArray(JSON.parse(file.content)) ? JSON.parse(file.content) : [JSON.parse(file.content)]).map(normCard) : parseMarkdownCards(file.content); const valid = cards.filter((card) => card.question && (card.type === 'note' ? card.noteContent : card.answer.length)); if (!valid.length) return toast('文件格式或字段不完整。'); state.cards = [...valid, ...state.cards]; state.groups = [...new Set([...(state.groups || []), ...valid.map((card) => card.folder)])]; save(); refresh(); toast(`已导入 ${valid.length} 张卡片。`); } catch { toast('无法解析导入文件。'); } }
function badges() { $('#reviewBadge').textContent = state.cards.filter(isDue).length; $('#reviewedTodayTop').textContent = state.reviewLog[today()] || 0; }
function isDue(card) { return new Date(card.dueAt).getTime() <= Date.now(); }
function totalReviews() { return Object.values(state.reviewLog).reduce((sum, count) => sum + Number(count || 0), 0); }

// Note cards keep Markdown as source text and render it only in the review surface.
function renderQuestion(box, card, standalone) {
  const shell = box.closest('.review-shell');
  if (!card) {
    shell?.classList.add('is-complete');
    box.innerHTML = '<div class="review-complete"><div class="complete-mark"><svg><use href="#i-review"></use></svg></div><div class="completion-kicker">REVIEW SESSION</div><h2>今日复习已完成</h2><p>本次复习计划已经完成，明天继续保持。</p><button class="secondary-action" data-view="cards">查看卡片库</button></div>';
    box.querySelector('[data-view]')?.addEventListener('click', () => view('cards'));
    els.nextButton.disabled = true;
    els.nextButton.textContent = '下一条';
    return;
  }
  shell?.classList.remove('is-complete');
  const selected = Array.isArray(answer) ? answer : [];
  const head = `<div class="tag-row"><span class="tag">${esc(card.tags[0] || '未分组')}</span><span class="question-type">${card.type === 'note' ? '速记词条' : card.type === 'multiple' ? '多选题' : '单选题'}</span></div><div class="question-title">${cardHtml(card.question)}</div>`;
  if (card.type === 'note') {
    const rating = NOTE_RATINGS[card.noteRating];
    const stamp = answered && rating ? `<div class="note-stamp ${rating.className}" aria-label="${rating.label}"><span>${rating.label}</span></div>` : '';
    box.innerHTML = `${head}<div class="note-review-body ${answered ? 'is-reviewed' : ''}">${stamp}<div class="note-answer-content">${noteMarkdownHtml(card.noteContent)}</div></div><div class="note-rating-block ${answered ? 'is-complete' : ''}">${answered ? '' : '<p>根据回忆程度选择反馈</p><div class="note-rating-actions">' + Object.entries(NOTE_RATINGS).map(([value, meta]) => `<button class="note-rating ${meta.className}" data-rating="${value}">${meta.label}</button>`).join('') + '</div>'}</div>`;
    box.querySelectorAll('[data-rating]').forEach((button) => button.addEventListener('click', () => answerNoteCard(card, button.dataset.rating)));
    els.nextButton.textContent = '下一条';
  } else {
    box.innerHTML = `${head}<div class="options-block"></div>${answered && card.explanation ? `<div class="explanation"><strong>解析</strong>${cardHtml(card.explanation)}</div>` : ''}`;
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
  els.nextButton.disabled = !answered;
  if (standalone && answered) {
    const nextButton = document.createElement('button');
    nextButton.className = 'next-button';
    nextButton.textContent = card.type === 'note' ? '下一条' : '下一题';
    nextButton.addEventListener('click', next);
    box.appendChild(nextButton);
  }
}

function answerNoteCard(card, rating) {
  if (answered || !NOTE_RATINGS[rating]) return;
  card.noteRating = rating;
  recordReview(card, rating);
}

function recordReview(card, rating) {
  answered = true;
  card.reviews += 1;
  if (card.type === 'note') card.noteRating = NOTE_RATINGS[rating] ? rating : '';
  const score = rating === 'familiar' || rating === 'correct';
  if (score) {
    card.ease = Math.min(5, card.ease + 0.18);
    card.interval = Math.max(1, Math.round(card.interval * (card.ease + Number(state.settings.forgettingFactor) / 5)));
    card.dueAt = new Date(Date.now() + card.interval * DAY).toISOString();
  } else {
    card.ease = Math.max(1.3, card.ease - 0.3);
    card.interval = rating === 'fuzzy' ? 0.25 : 0;
    card.dueAt = new Date(Date.now() + (rating === 'fuzzy' ? 6 : 1) * 3600000).toISOString();
  }
  state.reviewLog[today()] = (state.reviewLog[today()] || 0) + 1;
  save();
  renderDock();
  renderStandalone();
  renderHeatmaps();
  renderProfile();
  badges();
}
function streak() { let count = 0; for (let i = 0; i < 366; i += 1) { const key = dateKey(Date.now() - i * DAY); if (state.reviewLog[key]) count += 1; else if (i) break; } return count; }
function toast(message) { const box = els.toast; const label = box.querySelector('.toast-message'); label.textContent = message; box.classList.remove('show'); requestAnimationFrame(() => box.classList.add('show')); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove('show'), 3000); }
document.addEventListener('DOMContentLoaded', init);
