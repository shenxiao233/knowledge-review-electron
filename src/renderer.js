const KEY = 'knowledge-review-ui-v2';
const OPTS = ['A', 'B', 'C', 'D'];
const NOTE_RATINGS = {
  familiar: { label: '熟悉', className: 'familiar' },
  fuzzy: { label: '模糊', className: 'fuzzy' },
  forgot: { label: '没印象', className: 'forgot' },
  tooEasy: { label: '太简单', className: 'too-easy' }
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
  { id: 'doc-fsrs-guide', folderId: 'folder-study', title: 'FSRS 复习算法更新说明与使用指南', updatedAt: '2026-07-17T09:00:00.000Z', createdAt: '2026-07-17T09:00:00.000Z', html: '<h1>FSRS 复习算法更新说明与使用指南</h1><p>本次版本将原有的简化间隔公式升级为 FSRS（Free Spaced Repetition Scheduler），根据每次复习评分估算记忆稳定性和难度，并安排更适合你的下一次复习时间。</p><h2>一、本次更新</h2><ul><li>使用成熟的 FSRS 调度算法替代旧的 ease 和 interval 计算。</li><li>保留已有卡片、标签、复习次数和打卡记录，首次启动时自动迁移卡片状态。</li><li>复习记录增加评分、记忆状态、稳定性、难度和下次复习时间。</li><li>新增每日新卡上限和目标记忆保持率设置。</li></ul><h2>二、如何复习</h2><h3>选择题</h3><ol><li>选择一个答案，系统立即显示对错和解析。</li><li>答题后选择本次回忆质量：Again、Hard、Good 或 Easy。</li><li>完成评分后点击“下一题”，FSRS 会保存新的复习计划。</li></ol><h3>速记词条</h3><ol><li>阅读词条和 Markdown 格式的内容。</li><li>根据实际回忆程度选择“没印象、模糊、熟悉”。</li><li>系统会在卡片上盖上对应熟练度印章，并进入下一条。</li></ol><h2>三、评分含义</h2><ul><li><strong>Again</strong>：没有回忆起来，需要尽快重新学习。</li><li><strong>Hard</strong>：想起来了，但过程比较困难或不稳定。</li><li><strong>Good</strong>：正常回忆，答案基本准确。</li><li><strong>Easy</strong>：非常熟练，几乎不需要思考。</li></ul><p>选择题答错后系统只提供 Again；答对后建议根据真实回忆难度选择 Hard、Good 或 Easy，不要因为“猜对”就选择 Easy。</p><h2>四、FSRS 设置</h2><h3>目标记忆保持率</h3><p>表示希望在计划复习时仍能回忆起来的概率，默认值为 90%。数值越高，复习间隔越短、复习频率越高；数值越低，间隔会更长。建议先使用 90%，连续使用一段时间后再调整。</p><h3>每日复习上限</h3><p>限制当天最多完成的复习操作次数。同一张卡片当天因 Again 再次出现时，每次复习都会计入上限。</p><h3>每日新卡上限</h3><p>限制当天首次进入学习流程的新卡数量。建议从 5 到 10 张开始，避免一次引入过多新内容。</p><h2>五、间隔预览</h2><p>设置页面会展示新卡在 Again、Hard、Good、Easy 四种评分下的首次安排时间。实际间隔还会受到卡片历史、上次复习时间和记忆状态影响。</p><h2>六、数据与迁移</h2><p>卡片和复习数据仍保存在应用本地存储中。升级到 FSRS 时不会清空数据；旧卡片会根据原有复习次数和间隔生成兼容的 FSRS 初始状态。建议在设置页面先导出一份完整数据备份。</p><h2>七、使用建议</h2><ul><li>根据真实回忆情况评分，不要为了延长间隔而高估熟练度。</li><li>每天保持稳定复习，优先完成到期卡片。</li><li>速记词条内容支持标题、列表、引用、代码、链接和图片等 Markdown 展示。</li><li>观察一到两周后再调整目标记忆保持率。</li></ul>' },
  { id: 'doc-study', folderId: 'folder-study', title: '间隔重复学习法', html: '<h1>间隔重复学习法</h1><p>间隔重复是在遗忘曲线下降之前安排复习，逐步拉长复习间隔。</p><h2>核心原则</h2><ul><li>主动回忆</li><li>逐步延长间隔</li><li>错误内容及时再现</li></ul>' },
  { id: 'doc-reading', folderId: 'folder-study', title: '高效阅读与知识整理', html: '<h1>高效阅读与知识整理</h1><p>阅读的目标不是划线数量，而是把信息转化为可检索、可解释和可复用的知识。</p><h2>阅读前</h2><ul><li>明确阅读问题</li><li>快速浏览目录和摘要</li></ul><h2>阅读后</h2><ul><li>用自己的语言写摘要</li><li>提炼概念并建立卡片</li></ul>' },
  { id: 'doc-react', folderId: 'folder-frontend', title: 'React Hooks 核心概念', html: '<h1>React Hooks 核心概念</h1><p>React Hooks 让函数组件拥有状态管理和生命周期能力。</p><h2>基础 Hooks</h2><ul><li><strong>useState</strong> - 状态管理</li><li><strong>useEffect</strong> - 副作用处理</li><li><strong>useMemo</strong> - 值记忆化</li></ul>' }
];
sampleDocs.push({
  id: 'doc-mastery-score-guide',
  folderId: 'folder-study',
  title: '卡片熟练度评分规则',
  updatedAt: '2026-07-18T09:00:00.000Z',
  createdAt: '2026-07-18T09:00:00.000Z',
  html: `<h1>卡片熟练度评分规则</h1><p>卡片熟练度分数是 0 到 100 分的辅助指标，用于快速判断当前掌握程度。它不会替代 FSRS 的内部参数，FSRS 仍然根据每次复习评价安排下一次复习时间。</p><h2>一、分数构成</h2><p>分数由评价基准分、复习次数加成和复习间隔加成构成。</p><ul><li><strong>评价基准分：</strong>反映最近一次主观评价。</li><li><strong>复习次数加成：</strong>主动回忆次数越多，加成越高，最高 10 分。</li><li><strong>复习间隔加成：</strong>FSRS 安排的间隔越长，说明记忆稳定性越高，加成最高 8 分。</li></ul><h2>二、计算公式</h2><p>最终分数为以下公式的四舍五入结果，并限制在 0 到 100 分之间：</p><pre><code>评价基准分 + min(10, 复习次数 × 1.5) + min(8, ln(1 + 当前间隔天数) × 2.6)</code></pre><p>当前间隔天数取卡片 FSRS 计划中的 interval 值。“太简单”是唯一例外：无论复习次数和间隔如何，最终分数固定为 100 分。</p><h2>三、评价对应的基准分</h2><ul><li><strong>忘记了：</strong>20 分，表示本次没有成功回忆。</li><li><strong>模糊：</strong>55 分，表示部分回忆但答案不稳定。</li><li><strong>熟悉：</strong>80 分，表示能够正常回忆并基本答对。</li><li><strong>太简单：</strong>100 分，表示几乎无需思考即可回答。此卡片会暂停进入常规学习队列，但保留历史和分数。</li><li><strong>未评价：</strong>显示为 --，不计算分数。</li></ul><h2>四、计算示例</h2><p>一张最近评价为“熟悉”的卡片，复习 4 次，当前间隔 7 天：</p><pre><code>80 + min(10, 4 × 1.5) + min(8, ln(1 + 7) × 2.6) 约等于 91 分</code></pre><p>一张评价为“太简单”的卡片：</p><pre><code>最终分数 = 100 分</code></pre><h2>五、分数区间</h2><ul><li><strong>0 - 39 分：</strong>薄弱，建议尽快重新学习。</li><li><strong>40 - 69 分：</strong>发展中，仍需要较高频率的主动回忆。</li><li><strong>70 - 84 分：</strong>熟练，保持正常复习即可。</li><li><strong>85 - 99 分：</strong>稳定，通常会获得较长复习间隔。</li><li><strong>100 分：</strong>太简单或达到满分状态。</li></ul><h2>六、使用建议</h2><ol><li>根据真实回忆情况评价，不要为了提高分数而选择“太简单”。</li><li>分数用于快速查看，不是考试成绩。</li><li>如果分数高但经常答错，应相信真实答题结果并重新评价。</li><li>重置熟练度后，评价、FSRS 状态和分数都会回到未评价状态。</li><li>分数会立即显示在卡片库右上角的手写风格分数区域。</li></ol><p>请结合卡片内容质量、真实回忆体验和 FSRS 到期安排综合判断学习效果。</p>`
});
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
  reviewEvents: [],
  schemaVersion: 3,
  algorithm: 'fsrs',
  settings: { desiredRetention: 0.9, dailyLimit: 50, dailyNewLimit: 10, showStamps: true },
  reviewPlan: { group: 'all', order: 'ordered' },
  selectedCardId: sampleCards[0].id,
  extractedText: '',
  groups: ['学习科学', '前端技术'],
  trash: { documents: [], folders: [], cards: [] }
};

let state = load();
syncReviewLog();
ensureCardOrder(state.cards);
let els = {};
let queue = [];
let queueKey = '';
let index = 0;
let answered = false;
let answer = [];
let pendingReviewCardId = '';
let pendingCorrect = false;
let reviewDisplayCard = null;
let reviewSnapshot = null;
let selectedCardIds = new Set();
let lastNext = 0;
let batchCardMode = false;
let pendingCardOrder = null;
let createMode = 'document';
let renameTargetId = '';
let actionTarget = null;
let trashTab = 'documents';
let heatmapMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let libraryMode = 'home';
let documentQuery = '';
let reviewStudyActive = false;
let tooltipTimer = null;
let cardPage = 1;
let cardPageSize = 50;
let cardSortDirection = state.settings?.cardSortDirection === 'desc' ? 'desc' : 'asc';
let cardBatchTotal = 1;
let cardWheelDrag = null;
let cardLoadedThrough = 1;

function normCard(card) {
  const type = ['single', 'multiple', 'note'].includes(card.type) ? card.type : 'single';
  const answers = Array.isArray(card.answer) ? card.answer : card.answer ? [card.answer] : [];
  const normalized = {
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
    reviews: Number(card.reviews || 0),
    order: Number.isFinite(Number(card.order)) && Number(card.order) > 0 ? Number(card.order) : 0,
    mastery: ['tooEasy', 'familiar', 'fuzzy', 'forgot'].includes(card.mastery) ? card.mastery : (card.noteRating || ''),
    resetAt: card.resetAt || '',
    fsrs: card.fsrs || null
  };
  normalized.fsrs = window.knowledgeFSRS.migrate(normalized);
  normalized.dueAt = normalized.fsrs.due;
  normalized.interval = normalized.fsrs.scheduledDays;
  normalized.reviews = normalized.fsrs.reps;
  return normalized;
}
function ensureCardOrder(cards = []) {
  const groups = new Map();
  cards.forEach((card, index) => { const key = card.folder || '未分组'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push({ card, index }); });
  groups.forEach((items) => {
    items.sort((a, b) => { const ao = Number(a.card.order); const bo = Number(b.card.order); const av = Number.isFinite(ao) && ao > 0 ? ao : Number.MAX_SAFE_INTEGER; const bv = Number.isFinite(bo) && bo > 0 ? bo : Number.MAX_SAFE_INTEGER; return av - bv || a.index - b.index; });
    items.forEach(({ card }, index) => { card.order = index + 1; });
  });
}
function groupCards(folder) { return state.cards.filter((card) => (card.folder || '未分组') === folder).sort((a, b) => Number(a.order || 0) - Number(b.order || 0)); }
function cardPosition(card) { const list = groupCards(card.folder || '未分组'); return Math.max(1, list.findIndex((item) => item.id === card.id) + 1); }
function sortCardsForDisplay(cards) { const groupOrder = new Map((state.groups || []).map((group, index) => [group, index])); const direction = cardSortDirection === 'desc' ? -1 : 1; return cards.sort((a, b) => (groupOrder.get(a.folder) ?? 9999) - (groupOrder.get(b.folder) ?? 9999) || direction * (cardPosition(a) - cardPosition(b))); }
function normDoc(doc) {
  return { ...doc, id: doc.id || id('doc'), folderId: doc.folderId || null, title: doc.title || '未命名文档', html: doc.html || '<h1>未命名文档</h1><p>开始记录你的知识。</p>', createdAt: doc.createdAt || new Date().toISOString(), updatedAt: doc.updatedAt || doc.createdAt || new Date().toISOString() };
}
function load() {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem('knowledge-review-state-v1');
    if (!raw) return { ...structuredClone(base), documents: sampleDocs.map(normDoc) };
    const saved = JSON.parse(raw);
    const documents = Array.isArray(saved.documents) && saved.documents.length ? saved.documents.map(normDoc) : structuredClone(sampleDocs);
    sampleDocs.forEach((doc) => { if (!documents.some((item) => item.id === doc.id)) documents.push(normDoc(doc)); });
    const cards = Array.isArray(saved.cards) && saved.cards.length ? saved.cards.map(normCard) : structuredClone(sampleCards);
    ensureCardOrder(cards);
    const latestMastery = new Map();
    (Array.isArray(saved.reviewEvents) ? saved.reviewEvents : []).forEach((event) => { if (event.cardId && event.rating) latestMastery.set(event.cardId, event.rating === 'Easy' ? 'tooEasy' : event.rating === 'Good' ? 'familiar' : event.rating === 'Hard' ? 'fuzzy' : 'forgot'); });
    cards.forEach((card) => { if (!card.mastery && latestMastery.has(card.id)) card.mastery = latestMastery.get(card.id); });
    return {
      ...structuredClone(base), ...saved,
      folders: Array.isArray(saved.folders) && saved.folders.length ? saved.folders : structuredClone(sampleFolders),
      documents,
      cards,
      reviewLog: saved.reviewLog || {},
      reviewEvents: Array.isArray(saved.reviewEvents) ? saved.reviewEvents : [],
      schemaVersion: 3,
      algorithm: 'fsrs',
      settings: { ...base.settings, ...(saved.settings || {}), desiredRetention: Number(saved.settings?.desiredRetention || 0.9), showStamps: saved.settings?.showStamps !== false },
      reviewPlan: { ...base.reviewPlan, ...(saved.reviewPlan || {}), order: saved.reviewPlan?.order === 'random' ? 'random' : 'ordered' },
      trash: { ...base.trash, ...(saved.trash || {}) },
      groups: [...new Set([...(saved.groups || []), ...cards.map((card) => card.folder)])],
      activeDocId: documents.some((doc) => doc.id === saved.activeDocId) ? saved.activeDocId : documents[0]?.id
    };
  } catch {
    return structuredClone(base);
  }
}
function save() {
  try { ensureCardOrder(state.cards); syncReviewLog(); localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('本地空间不足，请先导出备份。'); }
}
function syncReviewLog() {
  if (!state?.reviewEvents) return;
  const next = {};
  state.reviewEvents.filter(reviewEventIsActive).forEach((event) => {
    const key = event.reviewedAt?.slice(0, 10);
    if (key) next[key] = (next[key] || 0) + 1;
  });
  state.reviewLog = next;
}
function activeDoc() { return state.documents.find((doc) => doc.id === state.activeDocId) || state.documents[0]; }
function cache() {
  ['noteEditor', 'outlineList', 'heatmap', 'heatmapPrev', 'heatmapNext', 'heatmapMonthLabel', 'profileHeatmap', 'profileHeatmapPrev', 'profileHeatmapNext', 'profileHeatmapMonthLabel', 'cardGroupSelect', 'cardTypeSelect', 'answerChoices', 'todayCount', 'questionCard', 'reviewProgressText', 'remainingText', 'progressRing', 'nextButton', 'cardModal', 'cardForm', 'createModal', 'createForm', 'exportModal', 'cardList', 'folderFilter', 'tagFilter', 'cardTypeFilter', 'cardStatusFilter', 'cardSearchInput', 'cardSummary', 'cardGroupRail', 'bulkSelectionBar', 'selectedCardCount', 'bulkDeleteCardsButton', 'cardLoadMore', 'cardPageWheel', 'cardWheelRail', 'cardWheelLabel', 'cardSortSelect', 'toast', 'desiredRetention', 'desiredRetentionValue', 'dailyLimit', 'dailyNewLimit', 'intervalPreview', 'showStampsToggle', 'reviewGroupSelect', 'reviewOrderButton', 'reviewOrderMenu', 'reviewHistory', 'reviewHistoryMeta', 'reviewHistoryButton', 'reviewHistoryCount', 'reviewHistoryPopover', 'reviewPlanList', 'reviewPlanMeta', 'reviewHome', 'reviewStudy', 'reviewStudyBack', 'reviewStudyGroupLabel'].forEach((key) => { els[key] = document.getElementById(key); });
}
function ensureFSRSSettingsPanel() {
  const panel = $('#algorithmPanel');
  if (!panel) return;
  panel.innerHTML = '<h2>FSRS 复习算法</h2><p class="setting-description">根据目标记忆保持率自动安排复习间隔。评分越准确，计划越贴合你的实际记忆状态。</p><label>目标记忆保持率 <input type="range" id="desiredRetention" min="0.8" max="0.99" step="0.01" /><span id="desiredRetentionValue"></span></label><label>每日复习上限 <input type="number" id="dailyLimit" min="1" max="500" /></label><label>每日新卡上限 <input type="number" id="dailyNewLimit" min="0" max="100" /></label><div class="interval-preview-label">不同评分的首次安排</div><div id="intervalPreview" class="interval-preview"></div>';
}
function init() { cache(); ensureFSRSSettingsPanel(); cache(); ensureStampSetting(); enhanceSelectsPortal(); bind(); enableTooltips(); loadDoc(); syncSettings(); refresh(); }
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
}function ensureBatchModeButton() { const header = els.cardModal?.querySelector('.modal-header'); const form = els.cardForm; if (!header || !form) return; if (!$('#batchModeButton')) { const button = document.createElement('button'); button.type = 'button'; button.id = 'batchModeButton'; button.className = 'modal-mode-toggle'; button.textContent = '批量制卡'; header.insertBefore(button, header.querySelector('.dialog-close')); button.addEventListener('click', toggleBatchCardMode); } if (!form.querySelector('.card-editor-scroll')) { const menu = form.querySelector(':scope > menu'); if (!menu) return; const body = document.createElement('div'); body.className = 'card-editor-scroll'; let node = header.nextElementSibling; while (node && node !== menu) { const next = node.nextElementSibling; body.appendChild(node); node = next; } form.insertBefore(body, menu); } }
function toggleBatchCardMode() { batchCardMode = !batchCardMode; const button = $('#batchModeButton'); button?.classList.toggle('active', batchCardMode); button.textContent = batchCardMode ? '批量制卡中' : '批量制卡'; els.cardModal?.classList.toggle('batch-mode', batchCardMode); }
function closeSelectMenus(except = null) { $$('.select-shell.open').filter((shell) => shell !== except).forEach((shell) => { shell.classList.remove('open'); shell.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false'); shell._selectMenu?.classList.remove('portal-open'); }); }
function positionSelectMenu(trigger, menu, select) { const rect = trigger.getBoundingClientRect(); const width = Math.max(rect.width, select.id === 'blockFormat' ? 96 : 120); const height = Math.min(300, Math.max(40, select.options.length * 36 + 10)); const above = rect.bottom + height + 7 > window.innerHeight && rect.top > height + 7; menu.style.minWidth = `${width}px`; menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`; menu.style.top = `${above ? Math.max(8, rect.top - height - 7) : rect.bottom + 7}px`; }
function enhanceSelectsPortal() { $$('select').forEach((select) => { if (select.parentElement?.classList.contains('select-shell')) return; const shell = document.createElement('div'); shell.className = `select-shell${select.closest('.formatbar') ? ' format-select-shell' : ''}`; select.parentNode.insertBefore(shell, select); shell.appendChild(select); const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', select.title || select.getAttribute('aria-label') || '选择'); const menu = document.createElement('div'); menu.className = 'select-menu select-menu-portal'; menu.setAttribute('role', 'listbox'); shell.appendChild(trigger); const owner = select.closest('dialog') || document.body; owner.appendChild(menu); shell._selectMenu = menu; select._selectMenu = menu; trigger.addEventListener('click', (event) => { event.stopPropagation(); const open = !shell.classList.contains('open'); closeSelectMenus(shell); shell.classList.toggle('open', open); trigger.setAttribute('aria-expanded', String(open)); menu.classList.toggle('portal-open', open); if (open) positionSelectMenu(trigger, menu, select); }); menu.addEventListener('click', (event) => { const option = event.target.closest('[data-option]'); if (!option) return; select.value = option.dataset.option; select.dispatchEvent(new Event('change', { bubbles: true })); shell.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); menu.classList.remove('portal-open'); }); select.addEventListener('change', () => syncCustomSelect(select)); syncCustomSelect(select); }); document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('close', () => closeSelectMenus())); document.addEventListener('click', (event) => { if (!event.target.closest('.select-shell') && !event.target.closest('.select-menu-portal')) closeSelectMenus(); }); window.addEventListener('resize', () => { const shell = $('.select-shell.open'); if (shell?._selectMenu) positionSelectMenu(shell.querySelector('.select-trigger'), shell._selectMenu, shell.querySelector('select')); }); window.addEventListener('scroll', () => { const shell = $('.select-shell.open'); if (shell?._selectMenu) positionSelectMenu(shell.querySelector('.select-trigger'), shell._selectMenu, shell.querySelector('select')); }, true); }
function syncCustomSelect(select) { const shell = select?.parentElement?.classList.contains('select-shell') ? select.parentElement : null; if (!shell) return; const trigger = shell.querySelector('.select-trigger'); const menu = select._selectMenu || shell._selectMenu || shell.querySelector('.select-menu'); if (!menu) return; const options = [...select.options]; trigger.textContent = options.find((option) => option.value === select.value)?.textContent || select.value || ''; menu.innerHTML = options.map((option) => `<button type="button" role="option" data-option="${esc(option.value)}" class="${option.value === select.value ? 'selected' : ''}">${esc(option.textContent)}</button>`).join(''); }
function bind() {
  $('#windowMinimizeButton')?.addEventListener('click', () => window.reviewBridge.windowControls.minimize());
  $('#windowMaximizeButton')?.addEventListener('click', async () => { const maximized = await window.reviewBridge.windowControls.toggleMaximize(); $('#windowMaximizeButton').title = maximized ? '还原窗口' : '最大化'; });
  $('#windowCloseButton')?.addEventListener('click', () => window.reviewBridge.windowControls.close());
  $('#windowChrome')?.addEventListener('dblclick', (event) => { if (!event.target.closest('button')) window.reviewBridge.windowControls.toggleMaximize(); });
  $$('.rail-btn,[data-view]').forEach((button) => button.addEventListener('click', () => button.dataset.view && view(button.dataset.view)));
  $('#knowledgeHomeButton').addEventListener('click', openKnowledgeHome);
  $('#knowledgeHomeNav').addEventListener('click', openKnowledgeHome);
  $('#crumbKnowledgeHome').addEventListener('click', openKnowledgeHome);
  $('#knowledgeAddButton').addEventListener('click', toggleKnowledgeAddMenu);
  $('#documentSearchInput').addEventListener('input', (event) => { documentQuery = event.target.value.trim().toLowerCase(); renderTree(); renderKnowledgeHome(); });
  document.addEventListener('click', (event) => { if (!event.target.closest('.knowledge-sidebar-tools')) closeKnowledgeAddMenu(); });
  $('#closeMoveDocumentButton').addEventListener('click', () => $('#moveDocumentModal').close());
  $('#cancelMoveDocumentButton').addEventListener('click', () => $('#moveDocumentModal').close());
  $('#moveDocumentForm').addEventListener('submit', moveDocumentFromModal);
  $$('.formatbar [data-command]').forEach((button) => button.addEventListener('click', () => editorCommand(button.dataset.command, button.dataset.value)));
  $('#blockFormat').addEventListener('change', (event) => editorCommand('formatBlock', event.target.value));
  $('#fontSizeSelect').addEventListener('change', (event) => editorCommand('fontSize', event.target.value));
  $$('.formatbar .select-trigger, .formatbar [data-command]').forEach((button) => button.addEventListener('mousedown', (event) => { rememberSelection(); event.preventDefault(); }));
  els.noteEditor.addEventListener('input', () => { saveDoc(); outline(); updateEditorWordCount(); });
  els.noteEditor.addEventListener('mouseup', rememberSelection);
  els.noteEditor.addEventListener('keyup', rememberSelection);
  els.noteEditor.addEventListener('paste', handleEditorPaste);
  els.noteEditor.addEventListener('keydown', handleEditorKeydown);
  $('#insertImageButton').addEventListener('click', insertImage);
  $('#quickCreateFromSelection')?.addEventListener('click', quickCard);
  $('#openCreatorButton').addEventListener('click', () => openCard());
  $('#closeModalButton').addEventListener('click', () => els.cardModal.close());
  $('#cancelCardButton').addEventListener('click', () => els.cardModal.close());
  els.cardForm.addEventListener('submit', saveCard);
  els.cardTypeSelect.addEventListener('change', renderCardTypeFields);
  els.cardGroupSelect.addEventListener('change', () => { if (els.cardForm.dataset.autoTag === 'true') { $('#tagInput').value = els.cardGroupSelect.value || '未分组'; } });
  $('#tagInput').addEventListener('input', () => { els.cardForm.dataset.autoTag = 'false'; });
  $$('.image-insert-button').forEach((button) => button.addEventListener('click', () => insertCardImage(button.dataset.cardImage)));
  els.nextButton.addEventListener('click', next);
  els.reviewGroupSelect?.addEventListener('change', (event) => changeReviewGroup(event.target.value));
  els.reviewOrderButton?.addEventListener('click', (event) => { event.stopPropagation(); toggleReviewOrderMenu(); });
  els.reviewOrderMenu?.addEventListener('click', (event) => { const option = event.target.closest('[data-review-order]'); if (!option) return; changeReviewOrder(option.dataset.reviewOrder); closeReviewOrderMenu(); });
  els.reviewHistoryButton?.addEventListener('click', toggleReviewHistory);
  els.reviewStudyBack?.addEventListener('click', exitReviewStudy);
  els.reviewHome?.addEventListener('click', handleReviewHomeClick);
  document.addEventListener('click', (event) => { if (!event.target.closest('.review-history-wrap')) closeReviewHistory(); if (!event.target.closest('.review-order-wrap')) closeReviewOrderMenu(); if (!event.target.closest('.review-book-actions')) closeReviewBookMenus(); if (!event.target.closest('.card-group-row')) closeCardGroupMenus(); });
  $('#exportTopButton').addEventListener('click', () => openExport('all'));
  $('#exportSelectedButton').addEventListener('click', () => openExport('selected'));
  $('#exportFolderButton').addEventListener('click', () => openExport('folder'));
  $('#storageExportButton').addEventListener('click', exportAllState);
  $('#chooseDataDirectoryButton').addEventListener('click', chooseDataDirectory);
  $('#migrateDataButton').addEventListener('click', migrateData);
  $('#closeExportButton').addEventListener('click', () => els.exportModal.close());
  $('#confirmExportButton').addEventListener('click', exportCards);
  $('#importButton').addEventListener('click', importCards);
  els.cardSearchInput.addEventListener('input', () => renderCards(true));
  els.tagFilter.addEventListener('change', () => renderCards(true));
  els.cardTypeFilter.addEventListener('change', () => renderCards(true));
  els.cardStatusFilter.addEventListener('change', () => renderCards(true));
  els.cardSortSelect.addEventListener('change', () => { cardSortDirection = els.cardSortSelect.value === 'desc' ? 'desc' : 'asc'; state.settings.cardSortDirection = cardSortDirection; save(); renderCards(true); });
  els.cardList.addEventListener('scroll', handleCardListScroll, { passive: true });
  bindCardWheel();
  $('#clearCardFilters').addEventListener('click', clearCardFilters);
  $('#selectAllCardsButton').addEventListener('click', toggleSelectAllCards);
  $('#clearCardSelectionButton').addEventListener('click', clearCardSelection);
  $('#bulkDeleteCardsButton').addEventListener('click', bulkDeleteCards);
  $('#toggleCardGroupsButton').addEventListener('click', toggleCardGroups);
  els.cardGroupRail.addEventListener('click', handleCardGroupRailClick);
  $('#newGroupButton').addEventListener('click', openCreateGroup);
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
  $$('.trash-tabs [data-trash-tab]').forEach((button) => button.addEventListener('click', () => { trashTab = button.dataset.trashTab; renderTrash(); }));
  $('#toggleOutlineButton').addEventListener('click', toggleOutline);
  $('#toggleReviewButton').addEventListener('click', toggleReview);
  $$('.settings-nav button').forEach((button) => button.addEventListener('click', () => setting(button.dataset.setting)));
  [els.desiredRetention, els.dailyLimit, els.dailyNewLimit].forEach((input) => input?.addEventListener('input', settings));
  $('.toast-close')?.addEventListener('click', () => els.toast.classList.remove('show'));
}
function view(name) { $$('.view').forEach((item) => item.classList.toggle('active', item.id === `${name}View`)); $$('.rail-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === name)); if (name === 'library') openKnowledgeHome(); if (name === 'cards') renderCards(); if (name === 'review') { exitReviewStudy(); renderReviewPlanControls(); renderReviewHome(); renderReviewHistory(); } if (name === 'profile') renderProfile(); if (name === 'trash') renderTrash(); }
function refresh() { renderTree(); renderKnowledgeHome(); outline(); renderHeatmaps(); renderReviewPlanControls(); renderDock(); renderStandalone(); renderReviewHome(); renderReviewPlan(); renderReviewHistory(); renderCards(); renderProfile(); renderTrash(); badges(); }
function setting(name) { $$('.settings-nav button').forEach((button) => button.classList.toggle('active', button.dataset.setting === name)); $$('.setting-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${name}Panel`)); }
function saveDoc() { const doc = activeDoc(); if (!doc) return; doc.html = els.noteEditor.innerHTML; doc.updatedAt = new Date().toISOString(); save(); }
function loadDoc() { const doc = activeDoc(); els.noteEditor.innerHTML = /(^|\n)#{1,6}\s|(^|\n)[-*+]\s/.test(doc?.html || '') ? markdownToHtml(doc.html) : doc?.html || '<h1>未命名文档</h1><p>开始记录你的知识。</p>'; els.noteEditor.scrollTop = 0; outline(); updateEditorWordCount(); }
function updateEditorWordCount() { const text = String(els.noteEditor?.innerText || '').replace(/\s/g, ''); $('#editorWordCount').textContent = `${text.length}字`; }
function openKnowledgeHome() { saveDoc(); libraryMode = 'home'; document.querySelector('.document-workbench').classList.add('home-mode'); $('#knowledgeHomeNav').classList.add('active'); $('#knowledgeAddButton').setAttribute('aria-expanded', 'false'); closeKnowledgeAddMenu(); renderKnowledgeHome(); renderTree(); }
function openDocumentEditor(docId = state.activeDocId) { if (docId) switchDoc(docId, true); libraryMode = 'editor'; document.querySelector('.document-workbench').classList.remove('home-mode'); $('#knowledgeHomeNav').classList.remove('active'); loadDoc(); renderTree(); }
function toggleKnowledgeAddMenu(event) { event.stopPropagation(); const menu = $('#knowledgeAddMenu'); const button = $('#knowledgeAddButton'); const open = !menu.classList.contains('open'); closeKnowledgeAddMenu(); if (!open) return; const rect = button.getBoundingClientRect(); menu.style.position = 'fixed'; menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`; menu.style.top = `${rect.bottom + 8}px`; menu.classList.add('open'); button.setAttribute('aria-expanded', 'true'); }
function closeKnowledgeAddMenu() { const menu = $('#knowledgeAddMenu'); menu?.classList.remove('open'); $('#knowledgeAddButton')?.setAttribute('aria-expanded', 'false'); }
function documentMatches(doc) { return !documentQuery || [doc.title, state.folders.find((folder) => folder.id === doc.folderId)?.name || ''].join(' ').toLowerCase().includes(documentQuery); }
function highlightText(value, query) { const safe = esc(value); const term = String(query || '').trim(); if (!term) return safe; const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return safe.replace(new RegExp(pattern, 'ig'), (match) => `<mark class="search-highlight">${match}</mark>`); }
function highlightHtml(value, query) { const term = String(query || '').trim(); if (!term) return value; const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return String(value).split(/(<[^>]+>)/g).map((part) => part.startsWith('<') ? part : part.replace(new RegExp(pattern, 'ig'), (match) => `<mark class="search-highlight">${match}</mark>`)).join(''); }
function documentUpdatedAt(doc) { return new Date(doc.updatedAt || doc.createdAt || 0); }
function formatDocumentUpdatedAt(doc) { const value = documentUpdatedAt(doc); if (Number.isNaN(value.getTime())) return '未记录时间'; const now = new Date(); const sameDay = value.toDateString() === now.toDateString(); if (sameDay) return `今天 ${value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`; const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); if (value.toDateString() === yesterday.toDateString()) return `昨天 ${value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`; return value.getFullYear() === now.getFullYear() ? value.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : value.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }); }
function renderKnowledgeHome() { const list = $('#knowledgeDocumentList'); if (!list) return; const docs = state.documents.filter(documentMatches).sort((a, b) => documentUpdatedAt(b) - documentUpdatedAt(a)); $('#knowledgeDocumentCount').textContent = state.documents.length; list.innerHTML = docs.length ? docs.map((doc) => `<button type="button" class="knowledge-document-row" data-knowledge-doc="${esc(doc.id)}"><span class="knowledge-document-name">${highlightText(doc.title, documentQuery)}</span><span class="knowledge-document-line" aria-hidden="true"></span><time>${formatDocumentUpdatedAt(doc)}</time></button>`).join('') : '<div class="knowledge-empty-result">没有找到匹配的文章</div>'; list.querySelectorAll('[data-knowledge-doc]').forEach((button) => button.addEventListener('click', () => openDocumentEditor(button.dataset.knowledgeDoc))); }
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
function openCard(cardId = null) { ensureBatchModeButton(); const card = cardId ? state.cards.find((item) => item.id === cardId) : null; els.cardForm.reset(); els.cardModal.dataset.editingId = card?.id || ''; els.cardForm.dataset.autoTag = card ? 'false' : 'true'; if (card) batchCardMode = false; const modeButton = $('#batchModeButton'); modeButton.classList.toggle('active', batchCardMode); modeButton.textContent = batchCardMode ? '批量制卡中' : '批量制卡'; modeButton.disabled = Boolean(card); els.cardModal.classList.toggle('batch-mode', batchCardMode); $('#cardModalTitle').textContent = card ? '编辑复习卡片' : '新建复习卡片'; fill(els.cardGroupSelect, [...new Set([...(state.groups || []), ...state.cards.map((item) => item.folder)])]); els.cardGroupSelect.value = card?.folder || state.groups?.[0] || '学习科学'; syncCustomSelect(els.cardGroupSelect); $('#cardTypeSelect').value = card?.type || 'single'; syncCustomSelect(els.cardTypeSelect); $('#questionInput').value = card?.question || state.extractedText || ''; $('#optionA').value = card?.options.A || ''; $('#optionB').value = card?.options.B || ''; $('#optionC').value = card?.options.C || ''; $('#optionD').value = card?.options.D || ''; $('#noteContentInput').value = card?.noteContent || ''; $('#explanationInput').value = card?.explanation || ''; $('#tagInput').value = (card?.tags || [els.cardGroupSelect.value || '未分组']).join(', '); renderCardTypeFields(); renderAnswerChoices(card?.answer || []); els.cardModal.showModal(); }
function renderCardTypeFields() { const note = els.cardTypeSelect.value === 'note'; $('#cardOptionsGrid').classList.toggle('hidden', note); $('#cardAnswersField').classList.toggle('hidden', note); $('#noteContentField').classList.toggle('hidden', !note); $('#explanationField').classList.toggle('hidden', note); if (!note) renderAnswerChoices(); }
function renderAnswerChoices(selected = []) { const multiple = els.cardTypeSelect.value === 'multiple'; els.answerChoices.innerHTML = OPTS.map((key) => `<label><input type="${multiple ? 'checkbox' : 'radio'}" name="answer" value="${key}" ${selected.includes(key) ? 'checked' : ''}><span>${key}</span></label>`).join(''); }
function insertCardImage(targetId) { const url = prompt('图片地址', 'https://'); if (!url) return; const field = document.getElementById(targetId); field.value += `${field.value ? '\n' : ''}![图片](${url})`; field.focus(); }
function markdownUrl(value, fallback = '#') { const url = String(value || '').trim(); return /^(https?:|mailto:|#|data:image\/)/i.test(url) ? esc(url) : fallback; }
function cardHtml(value) { return esc(String(value || '')).replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => `<img src="${markdownUrl(url)}" alt="${esc(alt)}" loading="lazy">`).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `<a href="${markdownUrl(url)}" target="_blank" rel="noreferrer">${label}</a>`).replace(/\n/g, '<br>'); }
function noteMarkdownHtml(value) { const raw = String(value || '').trim(); if (!raw) return '<p class="note-empty-content">暂无速记内容</p>'; if (/^\s*<(p|h[1-6]|ul|ol|blockquote|pre|img|a)\b/i.test(raw)) return sanitizeClipboardHtml(raw); return markdownToHtml(raw, { noteEntries: true }); }
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

function renderTree() { const tree = $('#documentTree'); tree.innerHTML = ''; const opened = renderTree.opened || (renderTree.opened = new Set(state.folders.map((folder) => folder.id))); state.folders.forEach((folder) => { const folderDocs = state.documents.filter((doc) => doc.folderId === folder.id && documentMatches(doc)); if (documentQuery && !folderDocs.length && !folder.name.toLowerCase().includes(documentQuery)) return; const section = document.createElement('div'); section.className = 'tree-section'; const head = document.createElement('div'); head.className = 'tree-folder-row'; head.innerHTML = '<button class="tree-caret" title="展开或折叠"><svg><use href="#i-chevron-down"></use></svg></button><strong></strong>'; head.querySelector('strong').textContent = folder.name; head.appendChild(actionButton('folder', folder.id)); head.ondblclick = () => openRename('folder', folder.id); head.onclick = (event) => { if (event.target.closest('.tree-more-button') || event.target.closest('.tree-caret')) return; opened.has(folder.id) ? opened.delete(folder.id) : opened.add(folder.id); renderTree(); }; head.querySelector('.tree-caret').onclick = () => { opened.has(folder.id) ? opened.delete(folder.id) : opened.add(folder.id); renderTree(); }; head.ondragover = (event) => { event.preventDefault(); head.classList.add('drag-over'); }; head.ondragleave = () => head.classList.remove('drag-over'); head.ondrop = (event) => { event.preventDefault(); moveDoc(event.dataTransfer.getData('doc-id'), folder.id); }; section.appendChild(head); if (opened.has(folder.id) || documentQuery) folderDocs.forEach((doc) => section.appendChild(docRow(doc))); tree.appendChild(section); }); const loose = state.documents.filter((doc) => !doc.folderId && documentMatches(doc)); if (loose.length) { const section = document.createElement('div'); section.className = 'tree-section'; section.innerHTML = '<div class="tree-folder-row loose-folder-row"><strong>未分组文档</strong></div>'; loose.forEach((doc) => section.appendChild(docRow(doc))); tree.appendChild(section); } if (!tree.children.length) tree.innerHTML = '<div class="tree-empty">没有匹配的文章</div>'; }
function docRow(doc) { const row = document.createElement('div'); row.className = `tree-doc-row${doc.id === state.activeDocId && libraryMode === 'editor' ? ' active' : ''}`; row.draggable = true; row.innerHTML = '<span class="tree-doc-title"></span>'; row.querySelector('.tree-doc-title').innerHTML = highlightText(doc.title, documentQuery); row.appendChild(actionButton('document', doc.id)); row.onclick = (event) => { if (!event.target.closest('.tree-more-button')) openDocumentEditor(doc.id); }; row.ondblclick = () => openRename('document', doc.id); row.ondragstart = (event) => event.dataTransfer.setData('doc-id', doc.id); return row; }
function actionButton(type, targetId) { const button = document.createElement('button'); button.type = 'button'; button.className = 'tree-more-button'; button.title = '更多操作'; button.innerHTML = '<svg><use href="#i-more-vertical"></use></svg>'; button.onclick = (event) => { event.stopPropagation(); openTreeMenu(button, type, targetId); }; return button; }
function openTreeMenu(anchor, type, targetId) { closeTreeMenus(); const menu = document.createElement('div'); menu.className = 'tree-context-menu'; menu.innerHTML = type === 'document' ? '<button data-action="rename">重命名</button><button data-action="edit">编辑文章</button><hr><button data-action="remove">移出目录</button><hr><button data-action="copy">复制</button><button data-action="move">移动…</button><button data-action="export">导出…</button><button data-action="pin">置顶文档</button><hr><button data-action="delete" class="danger">删除</button>' : '<button data-action="rename">重命名</button><button data-action="copy">复制</button><hr><button data-action="delete" class="danger">删除</button>'; document.body.appendChild(menu); const rect = anchor.getBoundingClientRect(); menu.style.top = `${Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4)}px`; menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.left))}px`; menu.querySelectorAll('[data-action]').forEach((item) => item.onclick = () => handleTreeAction(item.dataset.action, type, targetId, menu)); menu.addEventListener('click', (event) => event.stopPropagation()); document.addEventListener('click', closeTreeMenus, { once: true }); }
function closeTreeMenus() { $$('.tree-context-menu').forEach((menu) => menu.remove()); }
function handleTreeAction(action, type, targetId, menu) { menu.remove(); if (action === 'rename') return openRename(type, targetId); if (action === 'edit') return openDocumentEditor(targetId); if (action === 'remove') return moveDoc(targetId, null); if (action === 'move') return openMoveDocument(targetId); if (action === 'delete') return type === 'document' ? trashDoc(targetId) : trashFolder(targetId); if (action === 'copy') return duplicateTreeItem(type, targetId); if (action === 'copy-link') return copyDocumentLink(targetId); if (action === 'export') return exportDocument(targetId); if (action === 'pin') return pinDocument(targetId); if (action === 'new-tab') return openDocumentEditor(targetId); }
function duplicateTreeItem(type, targetId) { const now = new Date().toISOString(); if (type === 'document') { const source = state.documents.find((doc) => doc.id === targetId); if (!source) return; state.documents.push({ ...structuredClone(source), id: id('doc'), title: `${source.title} 副本`, createdAt: now, updatedAt: now }); } else { const source = state.folders.find((folder) => folder.id === targetId); if (!source) return; const copyId = id('folder'); state.folders.push({ ...structuredClone(source), id: copyId, name: `${source.name} 副本` }); state.documents.filter((doc) => doc.folderId === targetId).forEach((doc) => state.documents.push({ ...structuredClone(doc), id: id('doc'), folderId: copyId, title: `${doc.title} 副本`, createdAt: now, updatedAt: now })); } save(); refresh(); toast('已创建副本。'); }
function exportDocument(docId) { const doc = state.documents.find((item) => item.id === docId); if (!doc) return; const blob = new Blob([doc.html || ''], { type: 'text/html;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${doc.title || '文章'}.html`; link.click(); URL.revokeObjectURL(url); toast('文章已导出。'); }
function pinDocument(docId) { const doc = state.documents.find((item) => item.id === docId); if (!doc) return; doc.pinned = !doc.pinned; save(); refresh(); toast(doc.pinned ? '文章已置顶。' : '已取消置顶。'); }
function openMoveDocument(docId) { actionTarget = { type: 'document', id: docId }; fill($('#moveFolderSelect'), ['未分组', ...state.folders.map((folder) => folder.name)]); const doc = state.documents.find((item) => item.id === docId); $('#moveFolderSelect').value = state.folders.find((folder) => folder.id === doc?.folderId)?.name || '未分组'; syncCustomSelect($('#moveFolderSelect')); $('#moveDocumentModal').showModal(); }
function moveDocumentFromModal(event) { event.preventDefault(); const doc = state.documents.find((item) => item.id === actionTarget?.id); if (!doc) return; const name = $('#moveFolderSelect').value; doc.folderId = state.folders.find((folder) => folder.name === name)?.id || null; save(); $('#moveDocumentModal').close(); refresh(); toast('文章已移动。'); }
function switchDoc(docId, force = false) { if (docId === state.activeDocId && !force) return; saveDoc(); state.activeDocId = docId; state.extractedText = ''; loadDoc(); save(); renderTree(); renderKnowledgeHome(); }
function moveDoc(docId, folderId) { const doc = state.documents.find((item) => item.id === docId); if (!doc || doc.folderId === folderId) return; doc.folderId = folderId || null; save(); renderTree(); toast('文档已移动。'); }
function rootDrop(event) { event.preventDefault(); event.currentTarget.classList.remove('drag-over'); moveDoc(event.dataTransfer.getData('doc-id'), null); }
function openRename(mode, targetId) { createMode = mode; renameTargetId = targetId; const target = mode === 'folder' ? state.folders.find((item) => item.id === targetId) : state.documents.find((item) => item.id === targetId); if (!target) return; $('#createModalTitle').textContent = mode === 'folder' ? '重命名分组' : '重命名文章'; $('#createNameInput').value = target.name || target.title; $('#createFolderLabel').style.display = 'none'; els.createModal.showModal(); }
function openCreate(mode) { createMode = mode; renameTargetId = ''; $('#createModalTitle').textContent = mode === 'folder' ? '新建分组' : '新建文章'; $('#createNameInput').value = ''; $('#createFolderLabel').style.display = mode === 'folder' ? 'none' : 'grid'; $('#createFolderSelect').innerHTML = '<option value="">未分组</option>' + state.folders.map((folder) => `<option value="${folder.id}">${esc(folder.name)}</option>`).join(''); $('#createFolderSelect').value = activeDoc()?.folderId || ''; els.createModal.showModal(); closeKnowledgeAddMenu(); }
function createItem(event) { event.preventDefault(); const name = $('#createNameInput').value.trim(); if (!name) return toast('请输入名称。'); const isRenaming = Boolean(renameTargetId); if (isRenaming) { if (createMode === 'folder') { const folder = state.folders.find((item) => item.id === renameTargetId); if (state.folders.some((item) => item.id !== renameTargetId && item.name === name)) return toast('分组名称已存在。'); if (folder) folder.name = name; } else { const doc = state.documents.find((item) => item.id === renameTargetId); if (state.documents.some((item) => item.id !== renameTargetId && item.title === name)) return toast('文章名称已存在。'); if (doc) { doc.title = name; doc.updatedAt = new Date().toISOString(); } } } else if (createMode === 'folder') { if (state.folders.some((folder) => folder.name === name)) return toast('分组已存在。'); state.folders.push({ id: id('folder'), name, color: ['#2f7d64', '#28a9c7', '#8b73d6', '#d88746'][state.folders.length % 4] }); } else { const now = new Date().toISOString(); const doc = { id: id('doc'), folderId: $('#createFolderSelect').value || null, title: name, html: `<h1>${esc(name)}</h1><p>开始记录你的知识。</p>`, createdAt: now, updatedAt: now }; state.documents.push(doc); state.activeDocId = doc.id; } save(); els.createModal.close(); renameTargetId = ''; if (!isRenaming && createMode === 'document') { libraryMode = 'editor'; document.querySelector('.document-workbench').classList.remove('home-mode'); } loadDoc(); refresh(); toast(isRenaming ? '名称已更新。' : createMode === 'folder' ? '分组已创建。' : '文章已创建。'); }
function trashDoc(docId) { const doc = state.documents.find((item) => item.id === docId); if (!doc) return; openDeleteConfirm('document', docId, `删除文档“${doc.title}”？`, '文档将移入回收站，之后仍可恢复。'); }
function trashFolder(folderId) { const folder = state.folders.find((item) => item.id === folderId); if (!folder) return; const count = state.documents.filter((doc) => doc.folderId === folderId).length; openDeleteConfirm('folder', folderId, `删除文件夹“${folder.name}”？`, count ? `其中 ${count} 篇文档将随文件夹移入回收站。` : '文件夹将移入回收站，之后仍可恢复。'); }
function openDeleteConfirm(type, targetId, title, description, actionLabel = '确认删除') { const modal = $('#deleteGroupModal'); if (!modal) return; modal.dataset.deleteType = type; modal.dataset.deleteId = targetId; $('#deleteGroupTitle').textContent = title; $('#deleteGroupDescription').textContent = description; $('#confirmDeleteGroupButton').textContent = actionLabel; modal.showModal(); }
function confirmDeleteTarget() {
  const modal = $('#deleteGroupModal');
  const type = modal?.dataset.deleteType;
  const targetId = modal?.dataset.deleteId;
  if (!type || !targetId) return;
  if (type === 'card-order') { modal.close(); confirmCardOrderChange(); return; }
  if (type === 'relearn-card-group') { modal.close(); confirmRelearnCardGroup(targetId); return; }
  modal.close();
  if (type === 'document') {
    const at = state.documents.findIndex((doc) => doc.id === targetId);
    if (at < 0) return;
    state.trash.documents.push(state.documents.splice(at, 1)[0]);
    if (state.activeDocId === targetId) state.activeDocId = state.documents[0]?.id || '';
  } else if (type === 'folder') {
    const at = state.folders.findIndex((folder) => folder.id === targetId);
    if (at < 0) return;
    const folder = state.folders.splice(at, 1)[0];
    const documents = state.documents.filter((doc) => doc.folderId === targetId);
    state.documents = state.documents.filter((doc) => doc.folderId !== targetId);
    state.trash.folders.push({ folder, documents });
    if (documents.some((doc) => doc.id === state.activeDocId)) state.activeDocId = state.documents[0]?.id || '';
  } else if (type === 'card') {
    const at = state.cards.findIndex((card) => card.id === targetId);
    if (at < 0) return;
    state.trash.cards.push(state.cards.splice(at, 1)[0]);
    if (state.selectedCardId === targetId) state.selectedCardId = state.cards[0]?.id || '';
  } else if (type === 'cards') {
    const ids = new Set(targetId.split(','));
    state.trash.cards.push(...state.cards.filter((card) => ids.has(card.id)));
    state.cards = state.cards.filter((card) => !ids.has(card.id));
    selectedCardIds.clear();
  } else if (type === 'trash-item') {
    state.trash[trashTab].splice(Number(targetId), 1);
  } else if (type === 'trash-all') {
    state.trash[trashTab] = [];
  } else if (type === 'card-group') {
    const cards = state.cards.filter((card) => card.folder === targetId);
    state.trash.cards.push(...cards);
    state.cards = state.cards.filter((card) => card.folder !== targetId);
    state.groups = state.groups.filter((item) => item !== targetId);
    if (els.folderFilter.value === targetId) els.folderFilter.value = '全部文件夹';
    cards.forEach((card) => selectedCardIds.delete(card.id));
  }
  save();
  loadDoc();
  refresh();
  toast('内容已移入回收站。');
}

function cardMatches(card) { const query = els.cardSearchInput.value.trim().toLowerCase(); const folder = els.folderFilter.value; const tag = els.tagFilter.value; const type = els.cardTypeFilter.value; const status = els.cardStatusFilter.value; const mastery = card.mastery || ''; return (!query || [card.question, card.folder, card.tags.join(' '), card.noteContent].join(' ').toLowerCase().includes(query)) && (!folder || folder === '全部文件夹' || card.folder === folder) && (!tag || tag === '全部标签' || card.tags.includes(tag)) && (!type || type === '全部类型' || card.type === type) && (!status || status === '全部熟练度' || (status === 'evaluated' ? Boolean(mastery) : status === 'unrated' ? !mastery : mastery === status)); }
function renderCardSummary() { const due = state.cards.filter(isDue).length; const notes = state.cards.filter((card) => card.type === 'note').length; els.cardSummary.innerHTML = [['#i-layers', state.cards.length, '全部卡片'], ['#i-review', due, '待复习'], ['#i-book', notes, '速记词条'], ['#i-flame', totalReviews(), '累计复习']].map(([icon, value, label]) => `<div class="card-summary-item"><svg><use href="${icon}"></use></svg><div><b>${value}</b><span>${label}</span></div></div>`).join(''); $('#cardTotalBadge').textContent = `${state.cards.length} 张`; }
function renderCardGroups() {
  const groups = [...new Set([...(state.groups || []), ...state.cards.map((card) => card.folder)])];
  state.groups = groups;
  $('#cardGroupCount').textContent = groups.length;
  const allGroup = `<div class="card-group-row"><div class="card-group-link ${els.folderFilter.value === '全部文件夹' ? 'active' : ''}"><button type="button" class="card-group-select" data-group="全部文件夹"><span class="group-dot all"></span><span>全部卡片</span></button></div></div>`;
  const groupItems = groups.map((group) => `<div class="card-group-row sortable-group-row" draggable="true" data-sort-group="${esc(group)}"><div class="card-group-link ${els.folderFilter.value === group ? 'active' : ''}"><button type="button" class="card-group-select" data-group="${esc(group)}"><span class="group-dot"></span><span>${esc(group)}</span></button><button type="button" class="card-group-more" data-group-menu="${esc(group)}" aria-label="${esc(group)}更多操作" aria-expanded="false"><svg><use href="#i-more-vertical"></use></svg></button><div class="card-group-menu" data-group-menu-panel="${esc(group)}"><button type="button" data-group-rename="${esc(group)}">重命名</button><button type="button" data-group-relearn="${esc(group)}">重学此卡组</button><button type="button" class="danger" data-group-delete="${esc(group)}">删除卡组</button></div></div></div>`).join('');
  els.cardGroupRail.innerHTML = allGroup + groupItems;
  bindGroupSorting();
}
function handleCardGroupRailClick(event) {
  const groupButton = event.target.closest('[data-group]');
  if (groupButton) { els.folderFilter.value = groupButton.dataset.group; syncCustomSelect(els.folderFilter); cardPage = 1; renderCards(); return; }
  const menuButton = event.target.closest('[data-group-menu]');
  if (menuButton) { event.stopPropagation(); const menu = menuButton.parentElement?.querySelector(`[data-group-menu-panel="${CSS.escape(menuButton.dataset.groupMenu)}"]`); const open = menu && !menu.classList.contains('open'); closeCardGroupMenus(); if (menu && open) { menu.classList.add('open'); menuButton.setAttribute('aria-expanded', 'true'); } return; }
  const action = event.target.closest('[data-group-rename], [data-group-relearn], [data-group-delete]');
  if (!action) return;
  event.stopPropagation();
  closeCardGroupMenus();
  if (action.dataset.groupRename) openRenameGroup(action.dataset.groupRename);
  else if (action.dataset.groupRelearn) relearnCardGroup(action.dataset.groupRelearn);
  else deleteCardGroup(action.dataset.groupDelete);
}
function closeCardGroupMenus() { $$('.card-group-menu.open').forEach((menu) => menu.classList.remove('open')); $$('.card-group-more[aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false')); }
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
function bindGroupSorting() { $$('#cardGroupRail [data-sort-group]').forEach((row) => { row.addEventListener('dragstart', (event) => { if (event.target.closest('button')) { event.preventDefault(); return; } event.dataTransfer.setData('group-name', row.dataset.sortGroup); row.classList.add('dragging'); }); row.addEventListener('dragend', () => row.classList.remove('dragging')); row.addEventListener('dragover', (event) => { event.preventDefault(); row.classList.add('drag-over'); }); row.addEventListener('dragleave', () => row.classList.remove('drag-over')); row.addEventListener('drop', (event) => { event.preventDefault(); row.classList.remove('drag-over'); reorderGroups(event.dataTransfer.getData('group-name'), row.dataset.sortGroup); }); }); }
function reorderGroups(source, target) { if (!source || !target || source === target) return; const from = state.groups.indexOf(source); const to = state.groups.indexOf(target); if (from < 0 || to < 0) return; const [group] = state.groups.splice(from, 1); state.groups.splice(to, 0, group); save(); renderCards(); toast('卡组顺序已更新。'); }
function renderFilters() { const tags = ['全部标签', ...new Set(state.cards.flatMap((card) => card.tags))]; fill(els.tagFilter, tags); if (!els.folderFilter.value) els.folderFilter.value = '全部文件夹'; }
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
function reviewEventIsActive(event) {
  const card = state.cards.find((item) => item.id === event.cardId);
  if (!card?.resetAt || !event.reviewedAt) return true;
  return new Date(event.reviewedAt).getTime() > new Date(card.resetAt).getTime();
}
function reviewEventMatchesGroup(event, group) {
  if (group === 'all') return true;
  if (event.folder === group) return true;
  return state.cards.find((card) => card.id === event.cardId)?.folder === group;
}
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
  els.reviewHome.innerHTML = `<section class="review-welcome"><div><span class="review-eyebrow">LEARNING CENTER</span><h1>今天也来复习一点</h1><p>选择一个卡组，按当前学习计划完成今天的复习。</p></div><div class="review-welcome-stat"><strong>${current.done}</strong><span>今日已复习</span></div></section><section class="review-feature-card"><div class="review-feature-cover"><span>KNOWLEDGE REVIEW</span><strong>${esc(currentLabel)}</strong><small>FSRS LEARNING PLAN</small></div><div class="review-feature-content"><div class="review-feature-heading"><div><span class="review-eyebrow">CURRENT PLAN</span><h2>${esc(currentLabel)}</h2></div><span class="review-feature-chip">${current.due ? '今日待学习' : '计划已完成'}</span></div><div class="review-feature-stats"><div><strong>${current.due}</strong><span>待学习</span></div><div><strong>${current.done}</strong><span>已完成</span></div><div><strong>${current.cards.length}</strong><span>卡片总数</span></div></div><div class="review-feature-progress"><div><span>今日完成度</span><b>${current.done} / ${current.planned}</b></div><div class="review-feature-line"><i style="width:${current.percent}%"></i></div></div><button type="button" class="review-start-button" data-review-start="${esc(selected)}">${current.due ? '开始学习' : '查看学习计划'}<kbd>Enter</kbd></button></div></section><section class="review-books-section"><div class="review-section-heading"><div><span class="review-eyebrow">MY CARD GROUPS</span><h2>我的卡组</h2></div><span>${groups.length} 个卡组</span></div><div class="review-book-grid">${groupCards || '<div class="review-home-empty">还没有卡组，先去卡片库创建一组卡片。</div>'}</div></section>`;
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
  $$('.review-book-menu.open').forEach((menu) => menu.classList.remove('open'));
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
  reviewDisplayCard = null;
  reviewSnapshot = null;
  index = 0;
  queue = [];
  queueKey = '';
}
function enhanceSelectsLegacy() { $$('select').forEach((select) => { if (select.parentElement?.classList.contains('select-shell')) return; const shell = document.createElement('div'); shell.className = `select-shell${select.closest('.formatbar') ? ' format-select-shell' : ''}`; select.parentNode.insertBefore(shell, select); shell.appendChild(select); const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', select.title || select.getAttribute('aria-label') || '选择'); const menu = document.createElement('div'); menu.className = 'select-menu'; menu.setAttribute('role', 'listbox'); shell.append(trigger, menu); trigger.addEventListener('click', (event) => { event.stopPropagation(); const open = shell.classList.toggle('open'); trigger.setAttribute('aria-expanded', String(open)); $$('.select-shell.open').filter((item) => item !== shell).forEach((item) => { item.classList.remove('open'); item.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false'); }); if (open && (shell.classList.contains('format-select-shell') || shell.closest('.modal'))) { const rect = trigger.getBoundingClientRect(); menu.style.position = 'fixed'; menu.style.top = `${rect.bottom + 7}px`; menu.style.left = `${rect.left}px`; menu.style.right = 'auto'; menu.style.minWidth = `${Math.max(rect.width, select.id === 'blockFormat' ? 96 : 120)}px`; } }); menu.addEventListener('click', (event) => { const option = event.target.closest('[data-option]'); if (!option) return; select.value = option.dataset.option; select.dispatchEvent(new Event('change', { bubbles: true })); shell.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); }); select.addEventListener('change', () => syncCustomSelectLegacy(select)); syncCustomSelectLegacy(select); }); document.addEventListener('click', (event) => { if (!event.target.closest('.select-shell')) $$('.select-shell.open').forEach((shell) => { shell.classList.remove('open'); shell.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false'); }); }); }
function syncCustomSelectLegacy(select) { const shell = select?.parentElement?.classList.contains('select-shell') ? select.parentElement : null; if (!shell) return; const trigger = shell.querySelector('.select-trigger'); const menu = shell.querySelector('.select-menu'); const options = [...select.options]; trigger.textContent = options.find((option) => option.value === select.value)?.textContent || select.value || ''; menu.innerHTML = options.map((option) => `<button type="button" role="option" data-option="${esc(option.value)}" class="${option.value === select.value ? 'selected' : ''}">${esc(option.textContent)}</button>`).join(''); }
function cardMarkup(card) {
  const typeLabel = card.type === 'note' ? '速记词条' : card.type === 'multiple' ? '多选题' : '单选题';
  const score = masteryScore(card);
  const scoreMarkup = score === null ? '<span class="card-score pending">--</span>' : `<span class="card-score">${score}<small>分</small></span>`;
  const query = els.cardSearchInput.value;
  const preview = card.type === 'note' ? highlightHtml(noteMarkdownHtml(card.noteContent), query) : highlightHtml(cardHtml(`答案 ${card.answer.join('、')} · 下次复习 ${formatDate(card.dueAt)}`), query);
  const stamp = state.settings.showStamps !== false && score !== null ? `<div class="card-mastery-stamp ${masteryMeta(card)?.className || ''}"><span>${masteryMeta(card)?.label || '已评价'}</span></div>` : '';
  return `<article class="card-item ${card.type === 'note' ? 'note-card-item' : ''} ${selectedCardIds.has(card.id) ? 'bulk-selected' : ''}" data-card="${card.id}" draggable="true"><div class="card-item-head"><button type="button" class="card-index-editor" title="点击修改卡组内顺序" data-card-order="${card.id}">-${cardPosition(card)}-</button><span class="question-type">${typeLabel}</span>${scoreMarkup}</div><div class="card-item-content"><h3>${highlightText(card.question, query)}</h3><div class="card-note-preview ${card.type === 'note' ? 'markdown-preview' : ''}">${preview}</div>${stamp}</div><div class="card-item-foot"><div class="tag-row">${card.tags.map((tag) => `<span class="tag">${highlightText(tag, query)}</span>`).join('')}</div><div class="card-item-actions"><button class="card-edit" title="编辑卡片" data-card-edit="${card.id}"><svg><use href="#i-edit"></use></svg></button><button class="card-reset-mastery" title="重置熟练度" data-card-reset="${card.id}"><svg><use href="#i-reset"></use></svg></button></div></div></article>`;
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
  els.cardPageWheel.addEventListener('click', (event) => { const button = event.target.closest('[data-wheel-page]'); if (button) selectCardBatch(button.dataset.wheelPage); });
  els.cardPageWheel.addEventListener('wheel', (event) => { if (Math.abs(event.deltaY) < 2) return; event.preventDefault(); selectCardBatch(cardPage + (event.deltaY > 0 ? 1 : -1)); }, { passive: false });
  els.cardPageWheel.addEventListener('pointerdown', (event) => { if (event.button !== 1) return; event.preventDefault(); cardWheelDrag = { startY: event.clientY, startPage: cardPage }; els.cardPageWheel.setPointerCapture?.(event.pointerId); });
  els.cardPageWheel.addEventListener('pointermove', (event) => { if (!cardWheelDrag) return; const delta = Math.round((cardWheelDrag.startY - event.clientY) / 28); if (delta) selectCardBatch(cardWheelDrag.startPage + delta); });
  els.cardPageWheel.addEventListener('pointerup', () => { cardWheelDrag = null; });
  els.cardPageWheel.addEventListener('pointercancel', () => { cardWheelDrag = null; });
}
function bindCardSorting() { $$('#cardList [data-card]').forEach((row) => { row.addEventListener('dragstart', (event) => { if (event.target.closest('button')) { event.preventDefault(); return; } event.dataTransfer.setData('card-id', row.dataset.card); row.classList.add('dragging'); }); row.addEventListener('dragend', () => row.classList.remove('dragging')); row.addEventListener('dragover', (event) => { event.preventDefault(); row.classList.add('drag-over'); }); row.addEventListener('dragleave', () => row.classList.remove('drag-over')); row.addEventListener('drop', (event) => { event.preventDefault(); row.classList.remove('drag-over'); reorderCards(event.dataTransfer.getData('card-id'), row.dataset.card); }); }); }
function reorderCards(source, target) {
  if (!source || !target || source === target) return;
  const sourceCard = state.cards.find((card) => card.id === source);
  const targetCard = state.cards.find((card) => card.id === target);
  if (!sourceCard || !targetCard) return;
  if ((sourceCard.folder || '未分组') !== (targetCard.folder || '未分组')) return toast('卡片只能在同一卡组内排序。');
  const items = groupCards(sourceCard.folder || '未分组');
  const targetPosition = Math.max(1, items.findIndex((card) => card.id === target) + 1);
  pendingCardOrder = { cardId: source, target: targetPosition };
  openDeleteConfirm('card-order', source, `调整卡片顺序为 -${targetPosition}-？`, '同卡组其他卡片会自动顺延。');
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
    openDeleteConfirm('card-order', cardId, `调整卡片顺序为 -${target}-？`, `当前顺序为 -${current}-，同卡组其他卡片会自动顺延。`);
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
  openDeleteConfirm('card-order', cardId, `调整卡片顺序为 -${target}-？`, `当前顺序为 -${current}-，同卡组其他卡片会自动顺延。`);
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
  const candidates = [...reviewCards, ...newCards.slice(0, allowedNew)];
  const candidateKey = candidates.map((card) => `${card.id}:${card.dueAt}:${card.reviews}:${card.fsrs?.state || ''}`).join('|');
  const nextKey = `${activeGroup}:${order}:${remaining}:${candidateKey}`;
  if (!force && nextKey === queueKey) return;
  const groupOrder = new Map((state.groups || []).map((group, position) => [group, position]));
  if (order === 'ordered') {
    candidates.sort((a, b) => (groupOrder.get(a.folder) ?? 9999) - (groupOrder.get(b.folder) ?? 9999) || cardPosition(a) - cardPosition(b) || new Date(a.dueAt) - new Date(b.dueAt));
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
function answerCard(card, selected, submit = false) { if (answered) return; if (card.type === 'multiple' && !submit) { answer = answer.includes(selected) ? answer.filter((key) => key !== selected) : [...answer, selected]; renderDock(); renderStandalone(); return; } if (card.type === 'single') answer = [selected]; const correct = answer.length === card.answer.length && answer.every((key) => card.answer.includes(key)); answered = true; pendingReviewCardId = card.id; pendingCorrect = correct; renderDock(); renderStandalone(); }
function answerNoteCardLegacy(card, rating) { if (answered) return; recordReviewLegacy(card, rating); }
function recordReviewLegacy(card, rating) { recordReview(card, rating === 'familiar' ? 'Good' : rating === 'fuzzy' ? 'Hard' : 'Again'); }
function next() { if (Date.now() - lastNext < 450 || pendingReviewCardId) return; lastNext = Date.now(); answered = false; answer = []; pendingCorrect = false; reviewDisplayCard = null; index = 0; buildQueue(); renderDock(); renderStandalone(); renderReviewPlan(); }
function retryCurrentReview() { if (!reviewDisplayCard) return; answered = false; answer = []; pendingCorrect = false; pendingReviewCardId = ''; reviewSnapshot = null; renderDock(); renderStandalone(); }
function reviewActionButtons(card) { return `<div class="review-space-actions"><button type="button" class="review-action-button" data-review-action="retry">再选一次</button><button type="button" class="review-action-button primary-review-action" data-review-action="next">${card.type === 'note' ? '下一条' : '下一题'}</button></div>`; }
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
function renderHeatmaps() { renderGithubHeatmap(els.heatmap); renderGithubHeatmap(els.profileHeatmap); els.todayCount.textContent = `共 ${state.reviewLog[today()] || 0} 次复习`; }
function renderGithubHeatmap(box) { if (!box) return; const weeks = box.classList.contains('compact') ? 26 : 52; const totalDays = weeks * 7; const now = new Date(); now.setHours(0, 0, 0, 0); const start = new Date(now.getTime() - (totalDays - 1) * DAY); box.classList.remove('monthly-heatmap'); box.classList.add('github-heatmap'); box.innerHTML = ''; for (let i = 0; i < totalDays; i += 1) { const date = new Date(start.getTime() + i * DAY); const key = dateKey(date); const count = state.reviewLog[key] || 0; const cell = document.createElement('button'); cell.type = 'button'; cell.className = `heat-cell ${count > 30 ? 'heat-3' : count > 10 ? 'heat-2' : count ? 'heat-1' : ''}`; cell.title = `${key} · ${count} 次复习${i === totalDays - 1 ? ' · 今天' : ''}`; cell.setAttribute('aria-label', `${key}，${count} 次复习${i === totalDays - 1 ? '，今天' : ''}`); cell.dataset.date = key; if (i === totalDays - 1) cell.classList.add('today-cell'); cell.addEventListener('click', () => { $$('.heat-cell.selected').forEach((item) => item.classList.remove('selected')); cell.classList.add('selected'); toast(`${key} · ${count} 次复习`); }); box.appendChild(cell); } }

function renderProfile() { const todayCount = state.reviewLog[today()] || 0; const stats = [['#i-folder-plus', state.folders.length, '文件夹'], ['#i-file', state.documents.length, '文档'], ['#i-layers', state.cards.length, '卡片'], ['#i-review', todayCount, '今日复习'], ['#i-flame', `${streak()}天`, '连续打卡'], ['#i-review', totalReviews(), '累计复习']]; $('#profileStats').innerHTML = stats.map(([icon, value, label]) => `<div class="stat-box"><svg><use href="${icon}"></use></svg><b>${value}</b><span>${label}</span></div>`).join(''); renderGithubHeatmap(els.profileHeatmap); $('#profileDays').textContent = `${Object.keys(state.reviewLog).length} 天有记录`; $('#profileReviewCount').textContent = `共 ${totalReviews()} 次复习`; }
function renderTrash() { $$('.trash-tabs [data-trash-tab]').forEach((button) => button.classList.toggle('active', button.dataset.trashTab === trashTab)); const list = state.trash[trashTab] || []; const box = $('#trashContent'); if (!list.length) { box.innerHTML = '<div class="trash-empty"><div class="trash-empty-icon"><svg><use href="#i-trash"></use></svg></div><strong>回收站为空</strong><p>删除的内容会显示在这里，你可以随时恢复。</p></div>'; return; } const icon = trashTab === 'folders' ? '#i-folder' : trashTab === 'cards' ? '#i-layers' : '#i-file'; box.innerHTML = list.map((item, i) => { const data = trashTab === 'folders' ? item.folder : item; const label = trashTab === 'folders' ? `包含 ${item.documents.length} 篇文档` : trashTab === 'cards' ? `${data.type === 'note' ? '速记词条' : '复习卡片'} · ${data.tags?.join('、') || '未分组'}` : '知识文档'; const preview = trashTab === 'folders' ? item.documents.map((doc) => doc.title).join('、') || '文件夹为空' : trashTab === 'cards' ? (data.type === 'note' ? data.noteContent : data.explanation || Object.values(data.options || {}).filter(Boolean).join(' · ')) : String(data.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); return `<article class="trash-item"><div class="trash-item-icon"><svg><use href="${icon}"></use></svg></div><div class="trash-item-main"><strong>${esc(data.name || data.title || data.question)}</strong><span>${esc(label)}</span><p>${esc(preview || '暂无内容预览')}</p></div><div class="trash-item-actions"><button data-restore="${i}">恢复</button><button class="danger" data-permanent="${i}">彻底删除</button></div></article>`; }).join(''); box.querySelectorAll('[data-restore]').forEach((button) => button.addEventListener('click', () => restoreTrash(Number(button.dataset.restore)))); box.querySelectorAll('[data-permanent]').forEach((button) => button.addEventListener('click', () => { const index = Number(button.dataset.permanent); const item = state.trash[trashTab][index]; const name = trashTab === 'folders' ? item.folder.name : item.title || item.question || '此内容'; openDeleteConfirm('trash-item', String(index), `永久删除“${name}”？`, '永久删除后无法恢复。', '永久删除'); })); }
function restoreTrash(at) { const item = state.trash[trashTab][at]; if (!item) return; if (trashTab === 'documents') state.documents.push(normDoc(item)); if (trashTab === 'cards') state.cards.push(normCard(item)); if (trashTab === 'folders') { state.folders.push(item.folder); state.documents.push(...item.documents.map(normDoc)); } state.trash[trashTab].splice(at, 1); save(); refresh(); toast('内容已恢复。'); }
function emptyTrash() { if (!state.trash[trashTab]?.length) return toast('当前分类没有内容。'); openDeleteConfirm('trash-all', trashTab, '清空当前回收站分类？', '此操作会永久删除当前分类中的全部内容，无法恢复。', '永久删除'); }
function formatInterval(days) { if (days < 1) return `${Math.max(1, Math.round(days * 24 * 60))} 分钟`; if (days < 2) return `${Math.max(1, Math.round(days * 24))} 小时`; return `${Math.round(days)} 天`; }
function syncSettings() { els.desiredRetention.value = state.settings.desiredRetention; els.desiredRetentionValue.textContent = `${Math.round(state.settings.desiredRetention * 100)}%`; els.dailyLimit.value = state.settings.dailyLimit; els.dailyNewLimit.value = state.settings.dailyNewLimit; const preview = window.knowledgeFSRS.preview({ dueAt: new Date().toISOString(), reviews: 0 }, state.settings); els.intervalPreview.innerHTML = preview.map((item) => `<div><strong>${item.label}</strong><br>${formatInterval(item.days)}</div>`).join(''); if ($('#storagePath')) $('#storagePath').textContent = state.settings.dataDirectory || '尚未选择外部数据目录'; }
function settings() { if (Number(els.dailyLimit.value) <= 0 || Number(els.dailyNewLimit.value) < 0) { els.dailyLimit.value = Math.max(1, Number(els.dailyLimit.value) || 1); els.dailyNewLimit.value = Math.max(0, Number(els.dailyNewLimit.value) || 0); return toast('复习上限必须有效。'); } state.settings.desiredRetention = Math.min(0.99, Math.max(0.8, Number(els.desiredRetention.value) || 0.9)); state.settings.dailyLimit = Number(els.dailyLimit.value); state.settings.dailyNewLimit = Number(els.dailyNewLimit.value); save(); syncSettings(); buildQueue(); progress(); }
async function chooseDataDirectory() { const result = await window.reviewBridge.chooseDataDirectory(); if (!result || result.canceled) return; state.settings.dataDirectory = result.directory; save(); $('#storagePath').textContent = result.directory; toast('数据目录已选择。'); }
async function migrateData() { const directory = state.settings.dataDirectory || (await window.reviewBridge.chooseDataDirectory())?.directory; if (!directory) return toast('请先选择数据目录。'); state.settings.dataDirectory = directory; const result = await window.reviewBridge.writeStorageSnapshot({ directory, content: JSON.stringify(state, null, 2) }); if (!result?.ok) return toast('数据迁移失败。'); save(); $('#storagePath').textContent = directory; toast('当前数据已迁移到所选目录。'); }
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
function renderQuestion(box, card, standalone) {
  const shell = box.closest('.review-shell');
  if (!card) {
    shell?.classList.add('is-complete');
    box.innerHTML = '<div class="review-complete"><div class="complete-mark"><svg><use href="#i-review"></use></svg></div><div class="completion-kicker">REVIEW SESSION</div><h2>今日复习已完成</h2><p>本次复习计划已经完成，明天继续保持。</p><button class="secondary-action" data-view="cards">查看卡片库</button></div>';
    box.querySelector('[data-view]')?.addEventListener('click', () => view('cards'));
    els.nextButton.disabled = true;
    els.nextButton.hidden = true;
    return;
  }
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
  box.querySelectorAll('[data-fsrs-grade]').forEach((button) => button.addEventListener('click', () => recordReview(card, button.dataset.fsrsGrade)));
}

function reviewGradeActions(card) {
  const hint = pendingCorrect ? '答对了，选择这次回忆的难度' : '答错了，将按 Again 重新安排';
  const grades = pendingCorrect ? [['Hard', 'Hard', '有些犹豫'], ['Good', 'Good', '正常回忆'], ['Easy', 'Easy', '非常熟练']] : [['Again', 'Again', '重新学习']];
  return `<div class="fsrs-grade-panel"><p>${hint}</p><div class="fsrs-grade-actions">${grades.map(([value, label, detail]) => `<button type="button" class="fsrs-grade ${value.toLowerCase()}" data-fsrs-grade="${value}"><strong>${label}</strong><span>${detail}</span></button>`).join('')}</div></div>`;
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

function recordReview(card, rating) {
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
  if (card.type === 'note') card.noteRating = NOTE_RATINGS[rating] ? rating : card.noteRating;
  if (card.type === 'note' && rating === 'tooEasy') card.suspended = true;
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
    nextDue: result.dueAt,
    stability: result.log.stability,
    difficulty: result.log.difficulty,
    elapsedDays: result.log.elapsedDays,
    scheduledDays: result.log.scheduledDays
  });
  reviewDisplayCard = card;
  pendingReviewCardId = '';
  pendingCorrect = false;
  save();
  buildQueue();
  renderDock();
  renderStandalone();
  renderReviewPlan();
  renderReviewHistory();
  renderHeatmaps();
  renderProfile();
  badges();
}
function streak() { let count = 0; for (let i = 0; i < 366; i += 1) { const key = dateKey(Date.now() - i * DAY); if (state.reviewLog[key]) count += 1; else if (i) break; } return count; }
function toast(message) { const box = els.toast; const label = box.querySelector('.toast-message'); label.textContent = message; box.classList.remove('show'); requestAnimationFrame(() => box.classList.add('show')); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove('show'), 3000); }
document.addEventListener('DOMContentLoaded', init);

// Replace the native confirmation with the themed dialog when the card-library code calls it.
function deleteCardGroup(group) { const cards = state.cards.filter((card) => card.folder === group); openDeleteConfirm('card-group', group, `删除卡组“${group}”？`, cards.length ? `该卡组包含 ${cards.length} 张卡片，删除后卡片会移入回收站。` : '该卡组没有卡片，删除后仍可在回收站中恢复。'); }
function confirmDeleteCardGroup() { const modal = $('#deleteGroupModal'); const group = modal?.dataset.group; if (!group) return; const cards = state.cards.filter((card) => card.folder === group); state.trash.cards.push(...cards); state.cards = state.cards.filter((card) => card.folder !== group); state.groups = state.groups.filter((item) => item !== group); if (els.folderFilter.value === group) { els.folderFilter.value = '全部文件夹'; syncCustomSelect(els.folderFilter); } cards.forEach((card) => selectedCardIds.delete(card.id)); save(); modal.close(); refresh(); toast(`卡组“${group}”已移入回收站。`); }
