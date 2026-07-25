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
function getDeckUid(group) {
  const ids = state.profile.deckIds || (state.profile.deckIds = {});
  if (!ids[group]) { ids[group] = crypto.randomUUID(); schedulePersistentSave(); }
  return ids[group];
}
const today = () => dateKey(new Date());
const dateKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatDate = (value) => { const d = new Date(value); if (isNaN(d.getTime())) return '未知'; return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }); };
const formatDateTime = (value) => { const d = new Date(value); if (isNaN(d.getTime())) return '未知'; const pad = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
// Reusable input dialog — replaces window.prompt which is disabled in Electron.
function openInputDialog(title, label, defaultValue = '') {
  return new Promise((resolve) => {
    let dlg = document.getElementById('globalInputDialog');
    if (dlg) dlg.remove();
    dlg = document.createElement('dialog');
    dlg.id = 'globalInputDialog';
    dlg.className = 'modal password-change-modal';
    dlg.innerHTML = `<form method="dialog" class="modal-card password-change-card" id="globalInputDialogForm"><div class="modal-header"><div><span class="modal-eyebrow">INPUT</span><h2>${esc(title)}</h2></div><button type="button" id="globalInputDialogClose" class="dialog-close" title="关闭"><svg><use href="#i-x"/></svg></button></div><div class="password-fields"><label>${esc(label)}<input id="globalInputDialogInput" type="text" value="${esc(defaultValue)}" placeholder="${esc(defaultValue || '')}" /></label></div><menu><button type="button" id="globalInputDialogCancel">取消</button><button type="button" class="primary" id="globalInputDialogOk">确定</button></menu></form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    const input = dlg.querySelector('#globalInputDialogInput');
    if (input) { input.focus(); input.select(); }
    const cleanup = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('#globalInputDialogClose')?.addEventListener('click', () => { cleanup(); resolve(null); });
    dlg.querySelector('#globalInputDialogCancel')?.addEventListener('click', () => { cleanup(); resolve(null); });
    dlg.querySelector('#globalInputDialogOk')?.addEventListener('click', (e) => { e.preventDefault(); const val = (input?.value || '').trim(); cleanup(); resolve(val); });
    dlg.querySelector('#globalInputDialogForm')?.addEventListener('submit', (e) => { e.preventDefault(); const val = (input?.value || '').trim(); cleanup(); resolve(val); });
    dlg.addEventListener('close', () => { if (document.body.contains(dlg)) { dlg.remove(); } resolve(null); });
  });
}
const DEFAULT_MARKET_API_BASE = 'http://127.0.0.1:4100/api/v1';
const MARKET_SERVER_KEY_PREFIX = 'KR1.';
function decodeMarketServerKey(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith(MARKET_SERVER_KEY_PREFIX)) return '';
  try {
    const encoded = raw.slice(MARKET_SERVER_KEY_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder('utf-8').decode(bytes);
    const payload = JSON.parse(json);
    return payload?.v === 1 && typeof payload.base === 'string' ? payload.base : '';
  } catch {
    return '';
  }
}
function encodeMarketServerKey(value) {
  const parsed = parseMarketApiBase(value);
  if (!parsed) return '';
  if (String(value || '').trim().startsWith(MARKET_SERVER_KEY_PREFIX)) return String(value).trim();
  const json = JSON.stringify({ v: 1, base: parsed });
  const bytes = new TextEncoder().encode(json);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${MARKET_SERVER_KEY_PREFIX}${encoded}`;
}
function parseMarketApiBase(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_MARKET_API_BASE;
  const decoded = decodeMarketServerKey(raw);
  const source = decoded || raw;
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(source) ? source : `http://${source}`;
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
function normalizeMarketApiBase(value) {
  const parsed = parseMarketApiBase(value);
  if (!parsed) return DEFAULT_MARKET_API_BASE;
  try {
    const url = new URL(parsed);
    if (url.port === "4000" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
      console.warn("[MARKET] Saved server URL still on port 4000, auto-upgrading to 4100");
      return DEFAULT_MARKET_API_BASE;
    }
  } catch (e) {}
  return parsed;
}

const sampleFolders = [
  { id: 'folder-guide', name: '使用指南', color: '#2f7d64' },
  { id: 'folder-core', name: '核心功能', color: '#28a9c7' },
  { id: 'folder-cloud', name: '云端与市场', color: '#6c68ff' }
];

const sampleDocs = [
  { id: 'doc-overview', folderId: 'folder-guide', title: 'Notion Card 应用总览与界面介绍', updatedAt: '2026-07-25T09:00:00.000Z', createdAt: '2026-07-25T09:00:00.000Z', html: `<h1>Notion Card 应用总览与界面介绍</h1><h2>什么是 Notion Card</h2><p>Notion Card 是一款基于间隔重复（Spaced Repetition）原理的桌面知识管理工具。它将<strong>知识库</strong>、<strong>卡片管理</strong>、<strong>FSRS 复习系统</strong>、<strong>牌组市场</strong>和<strong>云端同步</strong>整合到一个 Electron 桌面应用中，帮助你把阅读笔记转化为可复习的知识卡片，并按照科学的遗忘曲线安排复习时间。</p><h2>核心功能</h2><ul><li><strong>知识库</strong>：创建和管理 Markdown 文档，用文件夹分类组织文章。</li><li><strong>卡片管理</strong>：从文档内容提炼单选题、多选题、判断题和速记词条，支持批量制卡、排序、筛选、导出和去重。</li><li><strong>FSRS 复习</strong>：基于 Free Spaced Repetition Scheduler 算法，根据每次评分动态调整复习间隔，最大化长期记忆效率。</li><li><strong>牌组市场</strong>：浏览和下载其他用户分享的学习牌组，订阅后自动接收更新。</li><li><strong>云端同步</strong>：将卡片、文档、设置和复习记录同步到服务器，支持多设备协作和账户隔离。</li><li><strong>熟练度印章</strong>：每张卡片根据评分和复习历史显示 0-100 分的熟练度，快速掌握学习进度。</li></ul><h2>界面布局</h2><p>应用采用无边框窗口设计，界面分为两个主要区域：</p><h3>左侧导航栏</h3><p>固定宽度的侧边栏，包含以下导航按钮（从上到下）：</p><ul><li><strong>知识库</strong>（图书馆图标）：文档管理和知识库首页。</li><li><strong>卡片</strong>（卡片图标）：卡片库管理页面。</li><li><strong>复习</strong>（循环箭头图标）：间隔复习中心。</li><li><strong>市场</strong>（市场图标）：牌组市场和登录入口。</li><li><strong>我的</strong>（用户图标）：个人资料和我的牌组。</li><li><strong>设置</strong>（齿轮图标）：应用配置面板。</li><li><strong>管理</strong>（盾牌图标）：仅管理员可见，管理后台。</li></ul><p>导航栏底部显示当前登录用户的头像和昵称。未登录时，应用会锁定所有视图，只显示牌组市场的登录界面。</p><h3>主内容区</h3><p>占据剩余空间的主显示区域，根据当前选中的导航项显示不同的视图。每个视图都是独立的页面，切换时保持各自的状态。</p><h2>窗口控制</h2><p>窗口标题栏位于主内容区顶部右侧，包含三个按钮：</p><ul><li><strong>最小化</strong>：将窗口收起到任务栏。</li><li><strong>最大化/还原</strong>：切换全屏和窗口化模式。</li><li><strong>关闭</strong>：关闭应用。点击后会弹出退出确认对话框，退出前会自动同步数据到云端。</li></ul><h2>全局搜索</h2><p>在导航栏点击搜索图标或使用快捷键，可以打开全局搜索面板。支持搜索卡片（题干、卡组、标签）和文档标题，使用键盘方向键导航、回车打开、Esc 关闭。</p><h2>键盘快捷键</h2><ul><li><strong>Esc</strong>：关闭当前对话框或退出编辑模式。</li><li><strong>↑/↓</strong>：在全局搜索结果中导航。</li><li><strong>Enter</strong>：在搜索结果中打开选中项。</li></ul><h2>数据存储</h2><p>所有数据优先保存在本地，包括三层存储：</p><ul><li><strong>localStorage</strong>：快速同步读写，用于即时恢复。</li><li><strong>IndexedDB</strong>：异步大容量存储，用于完整状态备份。</li><li><strong>磁盘文件</strong>：通过 Electron IPC 写入 state.json，用于跨会话持久化。</li></ul><p>三层存储自动同步，启动时选择最新版本恢复。登录服务器后，数据还会同步到云端，支持多设备访问。</p>` },

  { id: 'doc-login', folderId: 'folder-guide', title: '账号登录与服务器配置', updatedAt: '2026-07-25T09:01:00.000Z', createdAt: '2026-07-25T09:01:00.000Z', html: `<h1>账号登录与服务器配置</h1><h2>前置条件</h2><p>使用 Notion Card 前需要一台运行牌组市场服务器的机器。服务器基于 Fastify + Prisma + PostgreSQL 构建，默认端口为 4100。如果你是首次使用，请联系管理员获取服务器地址和邀请码。</p><h2>登录界面</h2><p>启动应用后，如果未自动登录，会显示登录界面。界面左侧是品牌展示区（带有动画角色），右侧是登录表单。</p><h3>服务器地址</h3><p>输入服务器的地址和端口，格式如 <code>127.0.0.1:4100</code> 或 <code>192.168.1.100:4100</code>。应用会自动补全 <code>http://</code> 前缀和 <code>/api/v1</code> 路径。</p><h3>账户名和密码</h3><p>输入管理员为你创建的账户名和密码。如果是注册新账户，点击”还没有账户？注册”切换到注册模式，此时需要输入邀请码。</p><h3>记住账号和密码</h3><p>勾选”记住账号和密码”后，凭证会使用系统级加密存储（Windows DPAPI），下次启动时自动填充并自动登录。密码不会以明文保存。</p><h3>密码显示切换</h3><p>密码输入框右侧有切换按钮，点击可显示或隐藏密码明文。</p><h2>注册新账户</h2><p>如果你有邀请码，可以注册新账户：</p><ol><li>点击登录表单下方的”还没有账户？注册”按钮。</li><li>表单切换到注册模式，新增”邀请码”输入框。</li><li>填写服务器地址、邀请码、账户名和密码。</li><li>点击”验证并进入”提交注册。</li></ol><p>注册成功后，账户状态为 INCOMPLETE（未完善），需要完成个人资料设置才能正常使用所有功能。管理员可以在后台创建邀请码并分配给用户。</p><h2>自动登录</h2><p>如果之前勾选了”记住账号和密码”，下次启动应用时会自动尝试登录。自动登录期间会显示”正在连接服务器…”的加载提示。如果服务器不可达或登录失败，会显示登录表单和错误信息，不会卡在白屏状态。</p><h2>登录错误处理</h2><p>登录失败时，表单下方会显示具体的错误信息：</p><ul><li><strong>”无法连接到服务器，请检查服务器地址和网络”</strong>：服务器未启动或地址错误。</li><li><strong>”服务器地址、账户名或密码不正确”</strong>：凭证错误。</li><li><strong>”连接服务器超时”</strong>：网络延迟过高或服务器无响应。</li></ul><h2>账户状态</h2><ul><li><strong>INCOMPLETE</strong>：刚注册，需要完善个人资料（昵称、简介等）。</li><li><strong>ACTIVE</strong>：资料完整，可以使用所有功能。</li><li><strong>SUSPENDED</strong>：被临时停用，联系管理员处理。</li><li><strong>BANNED</strong>：被永久封禁。</li></ul><h2>首次使用引导</h2><p>登录成功后，如果账户状态为 INCOMPLETE，应用会自动跳转到知识库页面并显示引导提示，提醒你完成个人资料设置。在”我的”页面可以编辑昵称、简介和头像。</p>` },

  { id: 'doc-knowledge', folderId: 'folder-core', title: '知识库与文档管理', updatedAt: '2026-07-25T09:02:00.000Z', createdAt: '2026-07-25T09:02:00.000Z', html: `<h1>知识库与文档管理</h1><h2>知识库概览</h2><p>知识库是 Notion Card 的文档管理中心。点击左侧导航栏的”知识库”按钮进入。首页显示欢迎信息和”最近编辑”列表，点击任意文档可直接打开编辑。</p><h2>文件夹与文档树</h2><p>知识库左侧显示文档树，包含文件夹和文档两层结构：</p><ul><li><strong>文件夹</strong>：用于分类管理文档，每个文件夹有名称和颜色标识。</li><li><strong>文档</strong>：属于某个文件夹，点击可在右侧编辑区打开。</li></ul><h3>创建文件夹</h3><p>在文档树底部点击”新建文件夹”按钮，输入文件夹名称即可创建。文件夹颜色会自动分配。</p><h3>创建文档</h3><p>在文档树顶部点击”新建文档”按钮，或右键文件夹选择”新建文档”。新文档默认属于当前选中的文件夹，如果没有选中文件夹则放在根目录。</p><h2>文档编辑器</h2><p>文档编辑器位于主内容区右侧，支持 Markdown 格式写作。编辑器顶部有工具栏，提供常用格式按钮：</p><ul><li><strong>标题</strong>：H1 到 H3 级标题。</li><li><strong>粗体/斜体/下划线</strong>：文本样式。</li><li><strong>列表</strong>：有序列表和无序列表。</li><li><strong>引用</strong>：引用块。</li><li><strong>代码</strong>：行内代码和代码块。</li><li><strong>链接</strong>：插入超链接。</li><li><strong>图片</strong>：插入图片（支持本地文件和 base64）。</li></ul><h3>支持的 Markdown 语法</h3><ul><li>标题：# ## ###</li><li>粗体：**文字**</li><li>斜体：*文字*</li><li>列表：- 或 1.</li><li>引用：></li><li>代码：\`行内代码\` 或 \`\`\`代码块\`\`\`</li><li>链接：[文字](URL)</li><li>图片：![描述](URL)</li><li>表格：| 列 | 列 |</li></ul><p>编辑器使用 marked.js 渲染 Markdown，支持 KaTeX 数学公式（用 $...$ 或 $$...$$ 包裹）。</p><h2>文档操作</h2><h3>重命名</h3><p>在文档树中右键文档，选择”重命名”，输入新标题。</p><h3>移动到其他文件夹</h3><p>右键文档选择”移动到”，然后选择目标文件夹。也可以直接拖拽文档到另一个文件夹。</p><h3>删除</h3><p>右键文档选择”删除”。删除前会有确认对话框。删除后文档从树中移除，但数据不会立即清除，可以通过数据恢复功能找回。</p><h2>最近编辑</h2><p>知识库首页的”最近编辑”区域显示最近修改过的文档列表，按更新时间倒序排列，最多显示 8 条。点击任意条目可直接打开对应文档。</p><h2>全局搜索</h2><p>点击导航栏的搜索图标打开全局搜索面板。搜索范围包括卡片（题干、卡组名、标签）和文档标题。输入关键词后实时显示匹配结果，使用方向键导航，回车打开选中项。</p>` },

  { id: 'doc-cards', folderId: 'folder-core', title: '卡片管理与制卡指南', updatedAt: '2026-07-25T09:03:00.000Z', createdAt: '2026-07-25T09:03:00.000Z', html: `<h1>卡片管理与制卡指南</h1><h2>卡片类型</h2><p>Notion Card 支持四种卡片类型：</p><ul><li><strong>单选题（single）</strong>：从 A/B/C/D 中选择一个正确答案。</li><li><strong>多选题（multiple）</strong>：可以选择多个正确答案。</li><li><strong>判断题（truefalse）</strong>：判断陈述是否正确，选项为”正确”和”错误”。</li><li><strong>速记词条（note）</strong>：没有选择题的卡片，用于记录概念定义、例子和理解，支持 Markdown 内容。</li></ul><h2>创建卡片</h2><h3>单张制卡</h3><p>点击卡片库页面的”新建卡片”按钮，打开卡片编辑模态框。填写以下字段：</p><ul><li><strong>题干</strong>：卡片的题目内容。</li><li><strong>选项 A-D</strong>：四个选项文本（判断题只有”正确”和”错误”）。</li><li><strong>答案</strong>：选择正确选项（多选题可多选）。</li><li><strong>解析</strong>：答案的详细说明，复习时会显示。</li><li><strong>标签/卡组</strong>：卡片所属的分组名称，用于分类和筛选。</li></ul><h3>批量制卡</h3><p>在卡片编辑模态框中点击”批量制卡”按钮切换到批量模式。批量模式允许连续创建多张卡片，每张卡片填写完成后点击”保存并继续”进入下一张，不用反复打开模态框。</p><h3>速记词条</h3><p>创建速记词条时，卡片类型选择”速记词条”。此时不需要填写选项和答案，而是在内容区域使用 Markdown 编写词条内容，包括定义、例子、自己的理解等。复习时系统会显示词条内容并让你自评回忆程度。</p><h2>卡片库视图</h2><p>卡片库页面以瀑布流布局展示所有卡片，每张卡片显示题干预览、熟练度印章、复习次数等信息。</p><h3>分页</h3><p>卡片数量较多时自动分页，页面右侧有页码轮盘可以快速跳转。每页显示固定数量的卡片，点击”显示更多”加载下一批。</p><h3>排序</h3><p>页面顶部有排序下拉菜单，支持四种排序方式：</p><ul><li><strong>正序</strong>：按创建顺序排列。</li><li><strong>倒序</strong>：按创建倒序排列。</li><li><strong>复习次数正序</strong>：复习次数少的在前。</li><li><strong>复习次数倒序</strong>：复习次数多的在前。</li></ul><h3>筛选</h3><p>页面顶部有多个筛选器：</p><ul><li><strong>卡组筛选</strong>：只显示某个卡组的卡片。</li><li><strong>标签筛选</strong>：按标签过滤。</li><li><strong>类型筛选</strong>：按卡片类型（单选/多选/判断/速记）过滤。</li><li><strong>熟练度筛选</strong>：按掌握程度（未评价/已评价/太简单/熟悉/模糊/忘记了）过滤。</li></ul><p>点击”清除筛选”可以重置所有筛选条件。</p><h3>搜索</h3><p>搜索框支持搜索题干、卡组和标签，输入关键词后实时过滤卡片列表。</p><h2>卡组侧栏</h2><p>卡片库左侧有卡组侧栏，显示所有卡组名称和卡片数量。点击卡组名可以快速筛选该卡组的卡片。点击”隐藏卡组侧栏”按钮可以收起侧栏，获得更大的卡片显示区域。</p><h2>熟练度印章</h2><p>每张卡片右上角显示熟练度印章，颜色对应掌握程度：</p><ul><li><strong>未评价</strong>：灰色，显示为 --</li><li><strong>忘记了</strong>：红色系，20 分基准</li><li><strong>模糊</strong>：橙色系，55 分基准</li><li><strong>熟悉</strong>：绿色系，80 分基准</li><li><strong>太简单</strong>：深绿色，100 分</li></ul><p>印章可以在设置中关闭显示。</p><h2>本地模式与推送模式</h2><p>卡片库顶部有”本地”开关：</p><ul><li><strong>推送模式（默认）</strong>：修改市场卡组的卡片时会自动推送到服务器。</li><li><strong>本地模式</strong>：修改不会自动推送，适合离线编辑或批量修改后统一推送。</li></ul><h2>批量操作</h2><p>点击”全选”按钮可以选中当前页所有卡片，选中后顶部出现批量操作栏：</p><ul><li><strong>永久删除</strong>：删除选中的卡片（不可恢复）。</li><li><strong>推送选中</strong>：将选中卡片推送到关联的市场牌组。</li><li><strong>导出选中</strong>：导出为 JSON 或 Markdown 文件。</li><li><strong>导出当前卡组</strong>：导出当前卡组的所有卡片。</li><li><strong>去除重复</strong>：检测并删除重复题干的卡片。</li></ul><h2>卡片顺序编辑</h2><p>每张卡片显示序号，点击序号可以输入新的序号来调整卡片在卡组中的顺序。</p><h2>导出功能</h2><p>支持三种导出格式：</p><ul><li><strong>JSON</strong>：完整保留卡片结构和 FSRS 状态，可重新导入。</li><li><strong>Markdown</strong>：以纯文本格式导出，方便阅读和分享。</li><li><strong>PDF</strong>：生成 PDF 文件，适合打印。</li></ul>` },

  { id: 'doc-review', folderId: 'folder-core', title: '间隔复习系统详解', updatedAt: '2026-07-25T09:04:00.000Z', createdAt: '2026-07-25T09:04:00.000Z', html: `<h1>间隔复习系统详解</h1><h2>FSRS 算法概述</h2><p>Notion Card 使用 FSRS（Free Spaced Repetition Scheduler）算法安排复习时间。FSRS 根据每次评分估算记忆的<strong>稳定性</strong>（记忆稳固程度）和<strong>难度</strong>（回忆难度），动态调整下一次复习的间隔。相比固定间隔的艾宾浩斯曲线，FSRS 能根据个人记忆特征自适应调整，用更少的复习次数达到更好的保持效果。</p><h2>复习中心</h2><p>点击导航栏的”复习”按钮进入复习中心。复习中心有两个状态：</p><h3>复习首页</h3><p>显示今日复习概览，包括到期卡片数量、今日已复习数量和进度环。点击”开始复习”进入复习学习模式。</p><h3>复习学习模式</h3><p>进入后全屏显示卡片内容：</p><ul><li><strong>选择题</strong>：显示题干和选项，选择答案后立即显示对错和解析，然后选择评分。</li><li><strong>速记词条</strong>：显示词条内容，根据回忆程度选择评分。</li></ul><p>顶部有进度条，显示当前复习进度和百分比。点击”返回学习中心”可以退出复习模式。</p><h2>评分系统</h2><h3>选择题评分</h3><ul><li><strong>Again（忘记了）</strong>：没有回忆起来，系统会尽快重新安排这张卡片。</li><li><strong>Hard（模糊）</strong>：想起来了但比较困难，间隔会缩短。</li><li><strong>Good（熟悉）</strong>：正常回忆，间隔按算法正常延长。</li><li><strong>Easy（太简单）</strong>：非常熟练，间隔大幅延长，卡片暂停进入常规队列。</li></ul><p>答错后只能选择 Again；答对后根据真实回忆难度选择 Hard、Good 或 Easy。不要因为猜对就选 Easy，也不要为了延长间隔而高估熟练度。</p><h3>速记词条评分</h3><ul><li><strong>没印象</strong>：等同于 Again。</li><li><strong>模糊</strong>：等同于 Hard。</li><li><strong>熟悉</strong>：等同于 Good 或 Easy。</li></ul><h2>复习顺序</h2><p>复习页面顶部有”复习顺序”菜单（点击三个点图标）：</p><ul><li><strong>按卡组顺序</strong>：按卡组中卡片的排列顺序复习。</li><li><strong>随机复习</strong>：打乱顺序随机出题。</li></ul><h2>复习历史</h2><p>复习页面顶部有”今日历史”按钮，点击后弹出历史面板，显示当天复习过的卡片列表和总数。每条记录显示卡片题干预览和评分结果。</p><h2>熟练度分数</h2><p>每张卡片有 0-100 分的熟练度分数，由三部分构成：</p><ul><li><strong>评价基准分</strong>：最近一次评分（忘记 20 / 模糊 55 / 熟悉 80 / 太简单 100）。</li><li><strong>复习次数加成</strong>：每复习一次加 1.5 分，最高 10 分。</li><li><strong>复习间隔加成</strong>：根据当前间隔天数计算，最高 8 分。</li></ul><p>公式：<code>基准分 + min(10, 次数×1.5) + min(8, ln(1+间隔天数)×2.6)</code>。”太简单”固定为 100 分。</p><h3>分数区间</h3><ul><li><strong>0-39</strong>：薄弱，建议尽快重新学习。</li><li><strong>40-69</strong>：发展中，需要较高频率复习。</li><li><strong>70-84</strong>：熟练，保持正常复习。</li><li><strong>85-99</strong>：稳定，通常有较长间隔。</li><li><strong>100</strong>：太简单或满分状态。</li></ul><h2>FSRS 设置</h2><p>在”设置 → 复习算法”面板中可以调整：</p><ul><li><strong>目标记忆保持率</strong>：计划复习时仍能回忆的概率，默认 90%。越高则间隔越短、复习越频繁。</li><li><strong>每日复习上限</strong>：限制当天完成的复习操作次数，默认 50。</li><li><strong>每日新卡上限</strong>：限制当天首次学习的新卡数量，默认 10。建议从 5-10 张开始。</li><li><strong>复习优先模式</strong>：新词优先 / 复习优先 / 混合（默认）。</li></ul><p>设置面板还显示间隔预览，展示新卡在不同评分下的首次安排时间。</p><h2>复习计划</h2><p>复习首页显示复习计划列表，列出按卡组分类的到期卡片数量。可以选择只复习某个卡组的卡片。</p><h2>独立复习</h2><p>独立复习模式不依赖 FSRS 到期安排，适合考前突击或自由复习。在复习页面可以选择卡组和顺序，直接开始复习所有卡片。</p><h2>重置熟练度</h2><p>如果需要重新评估某张卡片，可以在卡片详情中重置熟练度。重置后评价、FSRS 状态和分数都会回到未评价状态。</p>` },

  { id: 'doc-market', folderId: 'folder-cloud', title: '牌组市场与云同步', updatedAt: '2026-07-25T09:05:00.000Z', createdAt: '2026-07-25T09:05:00.000Z', html: `<h1>牌组市场与云同步</h1><h2>牌组市场概览</h2><p>牌组市场是 Notion Card 的内容分享平台。登录后可以浏览其他用户分享的学习牌组，下载到本地使用，或收藏感兴趣的牌组。市场数据与本地卡片库相互独立，下载的牌组会导入到你的本地卡片库中。</p><h2>浏览牌组</h2><p>市场页面显示所有已发布的牌组卡片，每张卡片显示标题、作者、简介、卡片数量、下载次数和更新时间。</p><h3>分类筛选</h3><p>页面顶部有分类标签：</p><ul><li><strong>全部</strong>：显示所有牌组。</li><li><strong>我的收藏</strong>：只显示已收藏的牌组。</li></ul><h3>搜索</h3><p>搜索框支持按牌组标题、作者和标签搜索。</p><h3>排序</h3><p>排序下拉菜单支持三种方式：最近更新、最受欢迎、卡片最多。</p><h3>分页</h3><p>牌组列表支持分页，页面底部有翻页按钮。</p><h2>下载牌组</h2><p>点击牌组卡片上的”查看牌组”按钮，打开牌组详情弹窗，显示牌组的完整信息。点击”下载”按钮将牌组导入到本地卡片库。下载后牌组的卡片会出现在你的卡片库中，可以像普通卡片一样编辑和复习。</p><h2>订阅与更新</h2><p>下载牌组后会自动订阅该牌组。当牌组作者发布新版本时，你的卡片库中对应卡组会显示”可更新”标记。点击”更新牌组”按钮即可拉取最新版本的卡片。</p><h2>收藏牌组</h2><p>点击牌组卡片右下角的爱心图标可以收藏或取消收藏。收藏的牌组可以在”我的收藏”分类中快速找到。</p><h2>云同步</h2><p>云同步是 Notion Card 的核心功能，将你的所有数据同步到服务器，支持多设备访问和数据备份。</p><h3>同步的数据范围</h3><ul><li><strong>卡片</strong>：题干、选项、答案、解析、标签、FSRS 状态（间隔、复习次数、稳定性、难度、到期时间）。</li><li><strong>文档</strong>：知识库中的所有文档内容和元数据。</li><li><strong>设置</strong>：FSRS 参数、每日上限、复习优先级、分组结构、文件夹、个人资料、复习计划、复习历史、收藏列表等。</li></ul><h3>同步流程</h3><p>完整的云同步流程分为三个阶段：</p><ol><li><strong>拉取（Pull）</strong>：从服务器获取最新数据，合并到本地。支持增量同步——只获取上次同步后变更的对象。</li><li><strong>推送（Push）</strong>：将本地变更的对象推送到服务器。使用签名比对，只推送内容实际变化的对象，避免重复推送。</li><li><strong>设备注册</strong>：首次同步时注册设备，获取服务器设备 ID。后续同步更新设备的最后同步时间。</li></ol><h3>触发同步的时机</h3><ul><li><strong>登录后</strong>：自动登录成功后立即执行全量同步。</li><li><strong>保存数据时</strong>：每次保存（创建卡片、编辑文档、复习评分等）后延迟 5 秒执行增量推送。</li><li><strong>退出应用时</strong>：点击关闭按钮后，退出确认对话框弹出期间立即开始同步，确保数据不丢失。</li><li><strong>定时后台同步</strong>：每 5 分钟自动执行一次全量同步，拉取其他设备的变更。</li><li><strong>网络恢复时</strong>：从离线恢复在线后自动触发同步。</li></ul><h3>增量同步</h3><p>每次推送时，系统会对每个对象计算签名（内容哈希），与上次推送的签名比对。只有签名变化的对象才会被推送，避免重复传输未修改的数据。签名表存储在 localStorage 中，跨会话保持。</p><h3>冲突处理</h3><p>如果本地版本号低于服务器版本号（说明其他设备先修改了同一对象），服务器返回冲突标记，本地会使用服务器数据覆盖，确保多设备数据一致。</p><h3>账户隔离</h3><p>不同账户的数据完全隔离。切换账户时，本地数据会被清空（保留服务器地址和设备 ID），然后从新账户拉取数据。这防止了跨账户数据泄露。</p><h3>新设备首次登录</h3><p>在新设备上首次登录账户时，本地数据为空（样本数据会被清除），系统自动从服务器拉取全部数据到本地。不会用本地的空数据覆盖服务器。</p><h2>本地模式</h2><p>在卡片库页面可以切换”本地”模式。开启后对卡片的修改不会自动推送到市场牌组，适合离线编辑或批量修改后统一推送。关闭本地模式后恢复自动推送。</p>` },

  { id: 'doc-profile', folderId: 'folder-cloud', title: '个人资料与牌组分享', updatedAt: '2026-07-25T09:06:00.000Z', createdAt: '2026-07-25T09:06:00.000Z', html: `<h1>个人资料与牌组分享</h1><h2>个人资料</h2><p>点击导航栏的”我的”按钮进入个人资料页面。页面顶部显示头像、昵称、简介和数据统计（我的牌组数、牌组卡片数、已上传数）。</p><h3>编辑资料</h3><p>点击右上角的”Edit”按钮打开编辑弹窗，可以修改：</p><ul><li><strong>显示名称</strong>：显示在牌组市场的作者信息中。</li><li><strong>简介</strong>：一句话介绍自己。</li></ul><h3>更换头像</h3><p>点击头像区域可以上传新头像，支持 PNG、JPG、WebP 和 GIF 格式。头像以 base64 格式存储，会同步到云端。</p><h2>我的牌组管理</h2><p>个人资料页面下方显示”我的卡组管理”列表，直接展示卡片管理页面中的卡组，数据保持同步。每个卡组显示名称、卡片数量和发布状态。</p><h3>发布牌组</h3><p>选择一个卡组，点击”上传到市场”按钮打开上传弹窗：</p><ul><li><strong>牌组名称</strong>：市场显示的标题。</li><li><strong>简介</strong>：牌组描述。</li><li><strong>分类</strong>：选择市场分类。</li></ul><p>上传后牌组状态为”待审核”，管理员审核通过后才会公开展示。</p><h3>更新牌组版本</h3><p>已发布的牌组可以上传新版本。更新时需要填写更新日志（changelog），订阅该牌组的用户会收到更新提示。每次更新都会创建一个新版本，用户可以选择更新到最新版或保留旧版。</p><h2>卡片贡献系统</h2><p>除了整组上传，你还可以对已订阅的牌组提交单张卡片的修改：</p><ul><li><strong>新增卡片</strong>：向牌组添加新卡片。</li><li><strong>修改卡片</strong>：修改已有卡片内容。</li><li><strong>删除卡片</strong>：建议删除某张卡片。</li></ul><p>贡献提交后状态为”待审核”，牌组作者或管理员审核通过后合并到牌组中。</p><h2>设置面板</h2><p>点击导航栏的”设置”按钮进入设置面板，左侧有四个设置分类：</p><h3>复习算法</h3><ul><li><strong>目标记忆保持率</strong>：0.80-0.99，默认 0.90。</li><li><strong>每日复习上限</strong>：1-500，默认 50。</li><li><strong>每日新卡上限</strong>：0-100，默认 10。</li><li><strong>复习优先模式</strong>：新词 / 复习 / 混合。</li><li><strong>间隔预览</strong>：展示不同评分下的首次安排时间。</li></ul><h3>存储</h3><p>坚果云 WebDAV 备份配置：</p><ul><li>WebDAV 地址、账号、应用密码。</li><li>远程备份文件夹。</li><li>启用/禁用备份。</li><li>每小时自动备份开关。</li><li>手动立即备份。</li><li>备份历史记录（保留最近 20 条）。</li></ul><p>本地数据是唯一来源，WebDAV 只接收备份快照，不会覆盖本地数据。</p><h3>服务器</h3><p>显示当前服务器地址和连接状态。可以修改服务器地址或退出登录。</p><h3>关于</h3><p>显示应用版本号和基本信息。</p><h2>管理后台（仅管理员）</h2><p>管理员账户可以在导航栏看到”管理”按钮，进入管理后台：</p><h3>许可用户</h3><p>创建、启用或停用牌组市场许可账户。可以查看用户列表、修改角色（USER/ADMIN）、重置密码等。</p><h3>牌组审核</h3><p>审核用户上传的牌组：批准、拒绝、禁用或删除。查看牌组版本和卡片内容。</p><h3>操作日志</h3><p>查看管理员和用户的关键操作记录，包括登录、推送、删除等。</p><h3>存储检查</h3><p>查看服务器存储状态和数据库健康度。</p><h3>邀请码管理</h3><p>创建和管理邀请码：设置最大使用次数、过期时间、撤销等。</p>` }
];

function makeCard(question, options, answer, explanation, tags, type = 'single') {
  return normCard({ id: id('card'), type, folder: tags[0], question, options, answer, explanation, tags });
}
const sampleCards = [
  makeCard('Notion Card 的核心复习算法叫什么？', { A: '艾宾浩斯曲线', B: 'FSRS（自由间隔重复调度器）', C: 'Anki SM-2', D: 'Leitner 系统' }, ['B'], 'FSRS 根据每次评分动态调整复习间隔，比固定间隔更高效。', ['使用指南']),
  makeCard('卡片库中开启”本地模式”后会发生什么？', { A: '卡片被删除', B: '修改不会自动推送到市场牌组', C: '无法编辑卡片', D: '数据不上云' }, ['B'], '本地模式下对卡片的修改不会自动推送，适合批量编辑后统一推送。', ['核心功能']),
  makeCard('Notion Card 支持的卡片类型包括哪些？', { A: '单选题、多选题、判断题、速记词条', B: '只有选择题', C: '填空题和选择题', D: '只有速记词条' }, ['A'], '共支持四种类型：单选、多选、判断和速记词条。', ['核心功能']),
  makeCard('退出应用时点击关闭按钮会先执行什么操作？', { A: '直接关闭', B: '弹出确认对话框并同步数据', C: '最小化到托盘', D: '保存文档' }, ['B'], '点击关闭会弹出退出确认对话框，同时立即开始云同步，确保数据不丢失。', ['云端与市场']),
  makeCard('FSRS 复习算法', {}, [], 'FSRS（Free Spaced Repetition Scheduler）根据每次评分估算记忆稳定性和难度，动态安排下一次复习时间。评分包括忘记、模糊、熟悉、太简单四档。', ['使用指南'], 'note')
];
const base = {
  folders: sampleFolders,
  documents: sampleDocs,
  activeDocId: 'doc-overview',
  cards: sampleCards,
  reviewLog: {},
  reviewEvents: [],
  schemaVersion: 3,
  algorithm: 'fsrs',
  settings: { desiredRetention: 0.9, dailyLimit: 50, dailyNewLimit: 10, reviewPriority: 'mixed', showStamps: true, marketServerKey: '', localMode: false },
  reviewPlan: { group: 'all', order: 'ordered' },
  selectedCardId: sampleCards[0].id,
  extractedText: '',
  groups: ['使用指南', '核心功能', '云端与市场'],
  profile: { name: 'Knowledge Learner', bio: '正在整理和分享值得反复学习的知识。', avatar: '', myDecks: [], publishedGroups: {}, deckIds: {} }
};


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
let selectedCardIds = new Set();
let lastNext = 0;
let queueVersion = 0;
let batchCardMode = false;
let pendingCardOrder = null;
let createMode = 'document';
let renameTargetId = '';
let actionTarget = null;
let heatmapMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let libraryMode = 'home';
let documentQuery = '';
let reviewStudyActive = false;
let tooltipTimer = null;
let cardPage = 1;
let cardPageSize = 50;
let cardSortDirection = 'asc';
let cardPositionCache = new Map();


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
let appAuthLocked = true;
let marketAuthBootstrapping = true;
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
let adminActiveTab = 'users';
let adminPage = { users: 1, decks: 1, audit: 1, invitations: 1 };
let adminTotalPages = { users: 1, decks: 1, audit: 1, invitations: 1 };
const adminPageSize = 8;
let adminRenderToken = 0;
let adminUsersCache = null;
let adminUsersCacheTime = 0;
const ADMIN_USERS_CACHE_TTL = 30_000;
let adminAvatarCache = {};
// ─── Market data cache (persisted to localStorage, separate from state) ───
let marketDecksCache = null;
let marketCapsCache = null;
let marketProfileCache = null;
const MARKET_DECKS_CACHE_TTL = 60_000;
const MARKET_CAPS_CACHE_TTL = 300_000;
const MARKET_PROFILE_CACHE_TTL = 60_000;
const MARKET_CACHE_KEY = 'kr-market-cache-v1';
function loadMarketCache() {
  try {
    const raw = localStorage.getItem(MARKET_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    marketDecksCache = parsed.decks || null;
    marketCapsCache = parsed.caps || null;
    marketProfileCache = parsed.profile || null;
  } catch { /* ignore corrupted cache */ }
}
function saveMarketCache() {
  try {
    localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify({
      decks: marketDecksCache, caps: marketCapsCache, profile: marketProfileCache,
    }));
  } catch { /* localStorage might be full */ }
}
function invalidateMarketCache() {
  marketDecksCache = null;
  marketCapsCache = null;
  marketProfileCache = null;
  try { localStorage.removeItem(MARKET_CACHE_KEY); } catch { /* ignore */ }
}
let profileEditingDeckId = '';
let marketDecks = [];

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
    source: card.source && typeof card.source === 'object' ? card.source : String(card.source || '').trim(),
    resetAt: card.resetAt || '',
    fsrs: card.fsrs || null,
    pushStatus: card.pushStatus || null
  };
  // BUG-05 fix: Skip FSRS migration for cards that already have valid FSRS state
  const hasValidFsrs = normalized.fsrs && normalized.fsrs.due && normalized.fsrs.state && typeof normalized.fsrs.stability === 'number';
  if (!hasValidFsrs) {
    if (window.knowledgeFSRS) {
      normalized.fsrs = window.knowledgeFSRS.migrate(normalized);
    } else {
      normalized.fsrs = normalized.fsrs || { due: normalized.dueAt, state: 0, stability: 0, difficulty: 0, reps: normalized.reviews || 0, scheduledDays: normalized.interval || 1 };
    }
  }
  normalized.dueAt = normalized.fsrs?.due || normalized.dueAt;
  normalized.interval = normalized.fsrs?.scheduledDays ?? normalized.interval ?? 1;
  normalized.reviews = normalized.fsrs?.reps ?? normalized.reviews ?? 0;
  return normalized;
}
function ensureCardOrder(cards = []) {
  const groups = new Map();
  cards.forEach((card, index) => { const key = card.folder || '未分组'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push({ card, index }); });
  groups.forEach((items) => {
    items.sort((a, b) => { const ao = Number(a.card.order); const bo = Number(b.card.order); const av = Number.isFinite(ao) && ao > 0 ? ao : Number.MAX_SAFE_INTEGER; const bv = Number.isFinite(bo) && bo > 0 ? bo : Number.MAX_SAFE_INTEGER; return av - bv || a.index - b.index; });
    items.forEach(({ card }, index) => { const newOrder = index + 1; if (card.order !== newOrder) { card.order = newOrder; try { invalidateSignatureCache(card); } catch (e) { /* kr-sync.js may not be loaded yet at module-init time */ } } });
  });
  bumpCardOrderVersion();
}
function groupCards(folder) { return state.cards.filter((card) => (card.folder || '未分组') === folder).sort((a, b) => Number(a.order || 0) - Number(b.order || 0)); }
function cardPosition(card) {
  if (cardPositionCache.has(card.id)) return cardPositionCache.get(card.id);
  const list = groupCards(card.folder || '未分组');
  const pos = Math.max(1, list.findIndex((item) => item.id === card.id) + 1);
  cardPositionCache.set(card.id, pos);
  return pos;
}
function reviewCount(card) { return Math.max(0, Number(card?.reviews ?? card?.fsrs?.reps ?? 0)); }
function reviewCountLabel(card) { return `复习 ${reviewCount(card)} 次`; }

// Version-based cache: positions and groupOrder are only rebuilt when cards
// are added, removed, reordered, or when groups change.
let _cardOrderVersion = 0;
let _cachedVersion = -1;
let _cachedGroupOrder = new Map();
let _cachedPositions = new Map();
function bumpCardOrderVersion() { _cardOrderVersion++; }
function sortCardsForDisplay(cards) {
  if (_cachedVersion !== _cardOrderVersion) {
    _cachedGroupOrder = new Map((state.groups || []).map((group, index) => [group, index]));
    _cachedPositions = new Map();
    const grouped = new Map();
    state.cards.forEach((card) => {
      const group = card.folder || '未分组';
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(card);
    });
    grouped.forEach((items) => items.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).forEach((card, index) => _cachedPositions.set(card.id, index + 1)));
    cardPositionCache = _cachedPositions;
    _cachedVersion = _cardOrderVersion;
  }
  const groupOrder = _cachedGroupOrder;
  const positions = _cachedPositions;
  const reviewSort = cardSortDirection === 'reviews-asc' || cardSortDirection === 'reviews-desc';
  const direction = cardSortDirection === 'desc' || cardSortDirection === 'reviews-desc' ? -1 : 1;
  return cards.sort((a, b) => {
    if (reviewSort) return direction * (reviewCount(a) - reviewCount(b))
      || (groupOrder.get(a.folder) ?? 9999) - (groupOrder.get(b.folder) ?? 9999)
      || (positions.get(a.id) || 0) - (positions.get(b.id) || 0);
    return (groupOrder.get(a.folder) ?? 9999) - (groupOrder.get(b.folder) ?? 9999)
      || direction * ((positions.get(a.id) || 0) - (positions.get(b.id) || 0));
  });
}
function normDoc(doc) {
  return { ...doc, id: doc.id || id('doc'), folderId: doc.folderId || null, title: doc.title || '未命名文档', html: doc.html || '<h1>未命名文档</h1><p>开始记录你的知识。</p>', createdAt: doc.createdAt || new Date().toISOString(), updatedAt: doc.updatedAt || doc.createdAt || new Date().toISOString() };
}
function reviewEventIsActive(event) {
  const card = getCardIndex().get(event.cardId);
  if (!card?.resetAt || !event.reviewedAt) return true;
  return new Date(event.reviewedAt).getTime() > new Date(card.resetAt).getTime();
}
function reviewEventMatchesGroup(event, group) {
  if (group === 'all') return true;
  if (event.folder === group) return true;
  return getCardIndex().get(event.cardId)?.folder === group;
}
// Compress and resize an avatar image file to a small base64 JPEG data URL.
// Max 256x256 pixels, JPEG quality 0.8 — typically results in 10-50KB base64 strings
// that easily fit within server body limits and database TEXT columns.
function compressAvatar(file, maxSize = 256, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Not an image file.')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}
