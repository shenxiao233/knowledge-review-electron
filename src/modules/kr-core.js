/**
 * kr-core.js - Constants, utilities, sample data, card/document normalization
 * Dependencies: None (loaded first)
 * Provides: $, $$, id, today, dateKey, esc, formatDate, normCard, normDoc,
 *           ensureCardOrder, groupCards, cardPosition, reviewCount, reviewCountLabel,
 *           sortCardsForDisplay, reviewEventIsActive, reviewEventMatchesGroup
 */
const KEY = 'knowledge-review-ui-v2';
const STATE_META_KEY = 'knowledge-review-state-meta-v1';
const OPTS = ['A', 'B', 'C', 'D'];
const TRUE_FALSE_OPTS = ['A', 'B'];
const CARD_TYPES = ['single', 'multiple', 'truefalse', 'note'];
function ensureCardEditorFields() {
  const typeSelect = $('#cardTypeSelect');
  if (typeSelect && !typeSelect.querySelector('option[value="truefalse"]')) typeSelect.insertAdjacentHTML('beforeend', '<option value="truefalse">判断题</option>');
  const typeFilter = $('#cardTypeFilter');
  if (typeFilter && !typeFilter.querySelector('option[value="truefalse"]')) typeFilter.insertAdjacentHTML('beforeend', '<option value="truefalse">判断题</option>');
  const tagField = $('#tagInput')?.closest('label');
  if (!tagField || $('#cardMetadataField')) return;
  const field = document.createElement('fieldset');
  field.id = 'cardMetadataField';
  field.className = 'card-metadata-field';
  field.innerHTML = '<legend>卡片信息</legend><div class="card-metadata-grid"><label>全站正确率 (%)<input id="correctRateInput" type="number" min="0" max="100" step="0.1" placeholder="可选，例如 68.5" /></label><label>考点<input id="knowledgePointInput" maxlength="160" placeholder="例如：函数、时态、TCP/IP" /></label><label class="card-source-field">来源 / 网站链接<input id="sourceInput" maxlength="1000" placeholder="支持 https:// 或 Markdown 链接" /></label></div>';
  tagField.before(field);
}
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
const DEFAULT_MARKET_API_BASE = 'http://127.0.0.1:4000/api/v1';
function parseMarketApiBase(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_MARKET_API_BASE;
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/api/v1') ? path : `${path || ''}/api/v1`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
function normalizeMarketApiBase(value) { return parseMarketApiBase(value) || DEFAULT_MARKET_API_BASE; }

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
  settings: { desiredRetention: 0.9, dailyLimit: 50, dailyNewLimit: 10, reviewPriority: 'mixed', showStamps: true, marketServerUrl: '' },
  reviewPlan: { group: 'all', order: 'ordered' },
  selectedCardId: sampleCards[0].id,
  extractedText: '',
  groups: ['学习科学', '前端技术'],
  trash: { documents: [], folders: [], cards: [] },
  profile: { name: 'Knowledge Learner', bio: '正在整理和分享值得反复学习的知识。', avatar: '', myDecks: [], publishedGroups: {} }
};


const TAG_PALETTE = ["#81b29a","#f2cc8f","#e07a5f","#3d405b","#6c9bcf","#d4a373","#a98467","#ddb892","#b5838d","#e5989b"];
function getTagColor(tag) {
  var hash = 0;
  for (var i = 0; i < tag.length; i++) hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
}
let state;
let els = {};
let queue = [];
let queueKey = '';
let index = 0;
let answered = false;
let answer = [];
let pendingReviewCardId = '';
let pendingCorrect = false;
let reviewDisposition = 'pending';
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
let cardSortDirection = 'asc';


let cardBatchTotal = 1;
let cardWheelDrag = null;
let cardLoadedThrough = 1;
let cardRenderTimer = null;
let marketQuery = '';
let marketCategory = 'all';
let marketCategories = [];
let marketSort = 'latest';
let marketSelectedDeck = null;
const marketUpdateCache = new Map();
let marketUnlocked = false;
let marketSurface = 'decks';
let marketToken = '';
let marketApiBase = '';
let marketUser = null;
let marketBusy = false;
let marketRememberCredentials = false;
let marketAutoLoginTried = false;
let marketCapabilities = {};
let marketPage = 1;
let marketPageSize = 20;
let marketTotal = 0;
let marketTotalPages = 1;
let adminActiveTab = 'overview';
let adminPage = { users: 1, decks: 1, audit: 1 };
let adminTotalPages = { users: 1, decks: 1, audit: 1 };
const adminPageSize = 8;
let adminRenderToken = 0;
let profileEditingDeckId = '';
let marketDecks = [
  { id: 'deck-js-core', title: 'JavaScript 核心概念', author: 'Knowledge Lab', category: '编程开发', cards: 128, downloads: 842, updated: '2026-07-18', color: '#e7f3ed', accent: '#2f7d64', tags: ['JavaScript', '前端', '基础'], description: '覆盖作用域、异步、原型、模块化和常见面试概念，适合系统复习前端基础。' },
  { id: 'deck-english-c1', title: '英语 C1 高频词汇', author: 'Mira', category: '语言学习', cards: 560, downloads: 1260, updated: '2026-07-16', color: '#eef0ff', accent: '#625bd7', tags: ['英语', '词汇', 'C1'], description: '按主题整理的高频词汇牌组，包含例句和易混淆词辨析。' },
  { id: 'deck-product-design', title: '产品设计方法论', author: 'Design Notes', category: '通识知识', cards: 96, downloads: 417, updated: '2026-07-12', color: '#fff2df', accent: '#c97824', tags: ['产品', '设计', '方法论'], description: '从用户研究到迭代验证，帮助建立完整的产品设计思维框架。' },
  { id: 'deck-computer-networks', title: '计算机网络重点', author: 'Study Room', category: '考试备考', cards: 214, downloads: 693, updated: '2026-07-09', color: '#eaf3fb', accent: '#3479aa', tags: ['网络', '408', '考试'], description: '整理 TCP/IP、HTTP、路由与传输层重点，适合考前集中巩固。' },
  { id: 'deck-react-patterns', title: 'React 实战模式', author: 'Frontend Club', category: '编程开发', cards: 76, downloads: 318, updated: '2026-07-05', color: '#e9f7f7', accent: '#258b8d', tags: ['React', 'Hooks', '工程化'], description: '围绕组件设计、Hooks、状态管理和性能优化的实战型牌组。' },
  { id: 'deck-general-science', title: '日常科学小知识', author: 'Open Decks', category: '通识知识', cards: 180, downloads: 521, updated: '2026-06-28', color: '#f5edfb', accent: '#8a5cab', tags: ['科学', '常识', '百科'], description: '用简短卡片解释身边的物理、化学、生物和天文现象。' }
];

function normCard(card) {
  const rawType = String(card.type || '').toLowerCase();
  const type = rawType === 'judge' || rawType === 'judgement' || rawType === 'boolean' ? 'truefalse' : CARD_TYPES.includes(rawType) ? rawType : 'single';
  const answers = Array.isArray(card.answer) ? card.answer : card.answer ? [card.answer] : [];
  const normalizedAnswers = type === 'truefalse'
    ? answers.map((value) => String(value).toLowerCase() === 'true' ? 'A' : String(value).toLowerCase() === 'false' ? 'B' : String(value)).filter((value) => TRUE_FALSE_OPTS.includes(value))
    : answers;
  const rateValue = card.correctRate === '' || card.correctRate === null || card.correctRate === undefined ? null : Number(card.correctRate);
  const normalized = {
    ...card,
    id: card.id || id('card'),
    type,
    folder: card.folder || '未分组',
    question: card.question || '',
    options: type === 'truefalse' ? { A: '正确', B: '错误', C: '', D: '' } : { A: card.options?.A || '', B: card.options?.B || '', C: card.options?.C || '', D: card.options?.D || '' },
    answer: type === 'note' ? [] : normalizedAnswers,
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
    correctRate: Number.isFinite(rateValue) ? Math.min(100, Math.max(0, rateValue)) : null,
    knowledgePoint: String(card.knowledgePoint || '').trim(),
    source: String(card.source || '').trim(),
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
function reviewCount(card) { return Math.max(0, Number(card?.reviews ?? card?.fsrs?.reps ?? 0)); }
function reviewCountLabel(card) { return `复习 ${reviewCount(card)} 次`; }
function sortCardsForDisplay(cards) {
  const groupOrder = new Map((state.groups || []).map((group, index) => [group, index]));
  const reviewSort = cardSortDirection === 'reviews-asc' || cardSortDirection === 'reviews-desc';
  const direction = cardSortDirection === 'desc' || cardSortDirection === 'reviews-desc' ? -1 : 1;
  return cards.sort((a, b) => {
    if (reviewSort) return direction * (reviewCount(a) - reviewCount(b))
      || (groupOrder.get(a.folder) ?? 9999) - (groupOrder.get(b.folder) ?? 9999)
      || cardPosition(a) - cardPosition(b);
    return (groupOrder.get(a.folder) ?? 9999) - (groupOrder.get(b.folder) ?? 9999)
      || direction * (cardPosition(a) - cardPosition(b));
  });
}
function normDoc(doc) {
  return { ...doc, id: doc.id || id('doc'), folderId: doc.folderId || null, title: doc.title || '未命名文档', html: doc.html || '<h1>未命名文档</h1><p>开始记录你的知识。</p>', createdAt: doc.createdAt || new Date().toISOString(), updatedAt: doc.updatedAt || doc.createdAt || new Date().toISOString() };
}
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