# Notion Card 修复日记 & 功能建议

> 项目：knowledge-review-electron v0.1.9-featured
> 日期：2026-07-23
> 修复范围：Phase 0 模块化重构后产生的运行时 Bug

---

## 一、Bug 修复日记

### 问题现象

应用启动后界面显示 0 张卡片/0 篇文档，所有按钮完全无法点击，甚至无法关闭窗口。

### 数据完整性确认

**用户数据安全无虞。** 持久化存储 `%APPDATA%\KnowledgeReview\data\state.json`（3.2MB）中包含完整的 1221 张卡片和 8 篇文档。问题仅出在渲染进程的代码层面。

### 根因分析

在 Phase 0 模块化重构过程中，原始的 3010 行 `renderer.js` 被拆分为 10 个独立模块。拆分时存在以下问题：

1. **代码合并错误** — 两处不同代码被意外拼接到同一行
2. **选择器函数混淆** — `$()`（返回单个元素）与 `$$()`（返回元素数组）被错误使用
3. **错误处理不足** — 异步操作缺少超时和降级机制

### 脚本加载顺序

```
index.html 加载顺序（全局作用域，无打包器）：
idb-store.js → kr-core.js → kr-state.js → kr-cards.js → kr-documents.js →
kr-review.js → kr-market.js → kr-profile.js → kr-settings.js → kr-ui.js → renderer.js
```

---

### Bug #1：kr-review.js 第 82 行 — 代码合并损坏（严重）

**文件：** `src/modules/kr-review.js`
**严重度：** 🔴 严重

**错误代码：**
```javascript
todayPlanEvents().reverse()('input[name="reviewPriority"]').forEach((event) => {
```

**问题分析：**
`todayPlanEvents().reverse()` 返回一个数组，随后立即用 `('input[name="reviewPriority"]')` 作为函数调用，这会导致 `TypeError: ... is not a function`。

这段代码明显是两处不同代码被意外合并到一行：
- `todayPlanEvents().reverse().forEach(...)` — 遍历复习事件
- `$('input[name="reviewPriority"]').forEach(...)` — 同步单选按钮状态（来自第 162 行）

**修复后：**
```javascript
todayPlanEvents().reverse().forEach((event) => {
```

**影响范围：**
`reviewPlanItems()` 函数无法执行 → 复习计划列表为空 → 复习页面无法显示任何计划内容。

---

### Bug #2：kr-review.js 第 162 行 — 选择器函数混淆（严重）

**文件：** `src/modules/kr-review.js`
**严重度：** 🔴 严重

**错误代码：**
```javascript
$('input[name="reviewPriority"]').forEach((input) => {
  input.checked = input.value === priority;
});
```

**问题分析：**
`$()` 是 `document.querySelector()` 的简写，只返回**单个元素**（或 null）。对单个元素调用 `.forEach()` 会抛出 `TypeError: $(...).forEach is not a function`。

复习优先级有 3 个单选按钮（新词优先/复习优先/混合），需要用 `$$()` 即 `document.querySelectorAll()` 获取所有元素后遍历。

**修复后：**
```javascript
$$('input[name="reviewPriority"]').forEach((input) => {
  input.checked = input.value === priority;
});
```

**影响范围：**
`syncSettings()` 函数抛出异常 → 设置面板的复习优先级单选按钮无法同步 → 用户看到的设置状态与实际不符。

---

### Bug #3：kr-settings.js 第 258 行 — 选择器函数混淆（中等）

**文件：** `src/modules/kr-settings.js`
**严重度：** 🟡 中等

**错误代码：**
```javascript
function setting(name) {
  $('.settings-nav button').forEach((button) =>
    button.classList.toggle('active', button.dataset.setting === name));
  $('.setting-panel').forEach((panel) =>
    panel.classList.toggle('active', panel.id === `${name}Panel`));
  // ...
}
```

**问题分析：**
- 设置导航栏有多个按钮 → 需要 `$$('.settings-nav button')` 获取全部
- 设置面板有多个 → 需要 `$$('.setting-panel')` 获取全部
- 使用 `$()` 只返回第一个元素，调用 `.forEach()` 报错

**修复后：**
```javascript
function setting(name) {
  $$('.settings-nav button').forEach((button) =>
    button.classList.toggle('active', button.dataset.setting === name));
  $$('.setting-panel').forEach((panel) =>
    panel.classList.toggle('active', panel.id === `${name}Panel`));
  // ...
}
```

**影响范围：**
`setting()` 函数调用时抛出异常 → 设置面板之间无法切换 → 用户点击任何设置导航按钮都没有反应。

---

### Bug #4：idb-store.js UTF-8 BOM（轻微）

**文件：** `src/modules/idb-store.js`
**严重度：** 🟢 轻微

**问题：** 文件开头包含 UTF-8 BOM（EF BB BF），可能影响某些解析器。

**修复：** 移除 BOM 字节。

---

### 其他修复

| 修复项 | 文件 | 说明 |
|--------|------|------|
| 移除调试日志 | `src/main.js` | 移除 `console-message` 临时捕获处理器 |
| 精简启动日志 | `src/renderer.js` | 移除所有 `[BOOT]` 调试输出，只保留错误日志 |
| 精简 init 日志 | `src/modules/kr-settings.js` | 移除冗余的 `[INIT]` 状态日志，保留关键错误日志 |

---

### 修复验证

Electron 自动化测试结果：

```
✅ init() 完整执行，零 safeCall 失败
✅ 1221 张卡片、8 篇文档成功加载
✅ 2 个卡片组正确识别
✅ IndexedDB 超时优雅降级（单实例锁导致，正常现象）
✅ 所有 JS 文件语法验证通过
✅ 无 $($).forEach 类型错误残留
```

---

### 提交记录

```
commit be6762f
fix: resolve critical UI bugs causing unresponsive interface

- Fix corrupted code in kr-review.js line 82
- Fix $ -> $$ in kr-review.js syncSettings
- Fix $ -> $$ in kr-settings.js setting()
- Remove UTF-8 BOM from idb-store.js
- Remove debug console-message handler from main.js
- Clean up verbose [INIT]/[BOOT] logging
```

---



---

### Bug #5：卡牌市场收藏功能未实装（严重）

**文件：** `src/modules/kr-market.js`
**提交：** `ecc5408`
**严重度：** 🔴 严重

**问题现象：**
卡牌市场的收藏按钮（❤️）虽然渲染出来了，但点击收藏后数据不会持久化到服务器，且无法通过分类筛选查看已收藏的牌组。

**根因分析：**
1. **缺少 `loadMarketFavorites()` 函数** — 没有从服务器 `GET /api/v1/favorites` 拉取收藏列表，`state.favorites` 始终为空数组
2. **登录流程未加载收藏** — 认证成功后没有调用收藏加载函数
3. **分类筛选不支持 favorites** — `loadMarketCategories()` 重写 `<select>` 时没有包含 "★ 我的收藏" 选项
4. **`marketDeckMatches()` 不识别 favorites** — 将 `favorites` 当作普通分类名匹配 `deck.category`，永远匹配不到
5. **`loadMarketDecks()` 错误发送参数** — `category=favorites` 被发送到服务器查询，返回空结果

**修复方案：**
- 新增 `loadMarketFavorites()` 函数，登录后/刷新时自动调用
- `marketDeckMatches()` 添加 `favorites` 特殊判断：`isDeckFavorited(deck.id)`
- `loadMarketDecks()` 跳过 `favorites` 作为服务器分类参数
- `loadMarketCategories()` 保留 "★ 我的收藏" 选项
- `showMarketDecks()` 和 `refreshMarketPage()` 中也调用 `loadMarketFavorites()`

---

### Bug #6：密码修改功能位置不当（中等）

**文件：** `src/modules/kr-market.js`, `src/modules/kr-settings.js`, `src/index.html`
**提交：** `ecc5408`
**严重度：** 🟡 中等

**问题现象：**
密码修改功能放在应用设置页面的"安全"标签页中。用户反馈应在牌组市场的个人设置菜单中找到此功能。

**修复方案：**
1. 从 `kr-settings.js` 移除 `ensureAccountSecurityPanel()` 函数
2. 从 `index.html` 移除设置导航中的 "安全" 按钮和 `accountPanel` 面板
3. 在市场账户菜单中添加"修改密码"按钮
4. 新增 `openPasswordChangeDialog()` 使用 `<dialog>` 原生弹窗
5. 简化 `setting()` 函数，移除 `account` 条件分支




---

### Bug #7：全局搜索中 card.options 被当数组处理（中等）

**文件：** `src/modules/kr-ui.js`
**严重度：** 🟡 中等

**问题现象：**
全局搜索（Ctrl+K）结果中，选择题卡片的选项预览始终为空。

**根因分析：**
`card.options` 是 `{ A: '文本', B: '文本', C: '文本', D: '文本' }` 对象，但搜索代码中使用了 `(card.options || []).join(', ')`，对对象调用 `.join()` 会抛出 TypeError（被静默捕获）。

**修复后：**
```javascript
// 修复前
(card.options || []).join(', ').substring(0, 80)

// 修复后
Object.values(card.options || {}).filter(Boolean).join(', ').substring(0, 80)
```

---

### Bug #8：Markdown 渲染器不支持嵌套列表（中等）

**文件：** `src/modules/kr-documents.js`
**严重度：** 🟡 中等

**问题现象：**
文档中的嵌套列表（缩进子列表）被扁平化为单层列表。

**根因分析：**
`markdownToHtml()` 只维护单个 `list` 变量跟踪当前列表类型，不支持基于缩进的嵌套。

**修复方案：**
将单变量 `list` 替换为栈结构 `listStack`，每项记录 `{ type, indent }`。根据缩进级别开闭嵌套层。




---

### Bug #9：WebDAV 测试连接触发不必要的配置保存（严重）

**文件：** `src/main.js`
**严重度：** 🔴 高

**问题现象：**
WebDAV 设置面板中点击"测试连接"后，即使用户只是在测试而未打算修改配置，凭证和配置也会被自动写入。

**根因分析：**
`webdav:test` IPC 处理器在测试连接成功后，会自动调用 `writeWebDavCredentials()` 和 `writeAppConfig()`。

**修复后：**
移除测试处理器中的写入逻辑，使其成为纯粹的只读连接验证。保存配置需通过 `webdav:saveConfig` 显式操作。

---

### Bug #10：数据源选择策略导致已删除卡片复活（严重）

**文件：** `src/modules/kr-settings.js`
**严重度：** 🔴 高

**问题现象：**
用户删除部分卡片后重启应用，被删除的卡片可能"复活"。

**根因分析：**
`init()` 在三个数据源（IndexedDB / state.json / localStorage）之间选择"卡片数量最多"的作为权威来源。删除卡片后，旧快照因卡片更多而被选中，覆盖新数据。

**修复后：**
将选择策略从"卡片数量最多"改为"`savedAt` 时间戳最新"。同时增加冲突检测：数据源之间卡片数量差异超过 20% 时自动创建安全备份。

---

### Bug #11：localStorage 超限后持续弹 toast（严重）

**文件：** `src/modules/kr-state.js`
**严重度：** 🔴 高

**问题现象：**
localStorage 达到 5MB 上限后，每次 `save()` 都会弹出 toast 提示，严重干扰用户操作。

**修复后：**
增加 `localStorageFull` 标记。首次失败时弹出一次 toast 并设置标记，后续 `save()` 调用直接跳过 localStorage 写入，仅依赖磁盘文件和 IndexedDB。

---

### Bug #12：PDF 导出 data URL 大小限制（严重）

**文件：** `src/main.js`
**严重度：** 🔴 高

**问题现象：**
包含大量 base64 图片的 PDF 导出会失败或截断。

**根因分析：**
PDF 导出通过 `data:text/html` URL 加载 HTML 到隐藏窗口，该方式有约 2MB 大小限制。

**修复后：**
改为将 HTML 写入 `os.tmpdir()` 临时文件，使用 `loadFile()` 替代 `loadURL()` 加载，`finally` 块中清理临时文件。

---

### Bug #13：normCard 每次调用都执行 FSRS 迁移（严重）

**文件：** `src/modules/kr-core.js`
**严重度：** 🔴 高

**问题现象：**
加载 1200+ 张卡片时性能下降，每次 `normCard()` 都调用 `knowledgeFSRS.migrate()`。

**修复后：**
在调用 migrate 前检查卡片是否已拥有有效的 FSRS 状态（包含 `due`、`state`、`stability` 字段）。已有有效状态的卡片直接复用，仅对遗留卡片执行迁移。

---

### Bug #14：复习队列缓存导致过期队列（中等）

**文件：** `src/modules/kr-core.js`, `src/modules/kr-review.js`
**严重度：** 🟡 中

**问题现象：**
编辑卡片或导入牌组后，复习队列可能不会更新。

**修复后：**
引入 `queueVersion` 全局计数器，在 `recordReview()` 等关键操作后递增，并纳入 `queueKey` 计算。任何卡片状态变更都会使缓存 key 失效。

---

### Bug #15：reviewEvents 无限增长（中等）

**文件：** `src/modules/kr-state.js`
**严重度：** 🟡 中

**问题现象：**
长期使用后 `state.reviewEvents` 可能累积数万条记录，拖慢序列化性能。

**修复后：**
`syncReviewLog()` 中增加归档逻辑：超过 500 条时自动清除 90 天之前的旧事件。热力图数据通过 `state.reviewLog` 独立保存，不受影响。

---

### Bug #16：连续打卡天数（streak）逻辑缺陷（中等）

**文件：** `src/modules/kr-review.js`
**严重度：** 🟡 中

**问题现象：**
当天还没有复习记录时，streak 显示为 0（断连），而不是延续昨天的连续天数。

**修复后：**
当今天有复习记录时从 `i=0`（今天）开始计数；当今天尚无记录时从 `i=1`（昨天）开始计数，将"尚未复习"视为连续天数的延续。

---

### Bug #17：磁盘保存失败无用户通知（中等）

**文件：** `src/modules/kr-state.js`
**严重度：** 🟡 中

**问题现象：**
`schedulePersistentSave` 的磁盘写入失败被静默吞掉，用户完全不知情。

**修复后：**
增加 `persistentSaveWarned` 标记。首次失败时弹出 toast 警告并在 console 记录错误详情，后续不再重复弹 toast。

---

### Bug #18：文档树新建文件夹默认折叠（中等）

**文件：** `src/modules/kr-documents.js`
**严重度：** 🟡 中

**问题现象：**
新建文件夹在文档树中默认折叠，用户需要手动展开。

**根因分析：**
`renderTree.opened` 集合仅在首次调用时初始化，新建的文件夹 ID 不会自动加入。

**修复后：**
每次 `renderTree()` 调用时遍历所有文件夹并将缺失的 ID 补充到 `opened` 集合中。

## 二、已知限制与注意事项

### IndexedDB 超时

在 Electron 开发环境中，IndexedDB 可能因为单实例锁而无法打开。当前实现了 2 秒超时机制，超时后优雅降级到 Electron 持久化存储（`state.json`）。这是预期行为，不影响数据安全。

### localStorage 容量限制

当应用状态超过 4MB 时，会自动跳过 localStorage 写入，避免 `QuotaExceededError`。大状态数据通过 Electron 持久化存储保存。

---

## 三、功能建议（按用户提供的路线图）

### Phase 0（地基，必须先做完）

#### ① #9 renderer.js 模块化重构 ✅ 已完成

**当前状态：** 10 个模块拆分完成，本次修复了拆分过程中引入的运行时 Bug。

**后续建议：**
- 为每个模块添加 JSDoc 头部注释，标明依赖关系和导出函数
- 考虑引入简单的模块通信机制（事件总线或依赖注入），替代当前的全局变量共享
- 添加 `npm run lint` 脚本（ESLint），自动检测 `$` vs `$$` 类错误

#### ② #1 localStorage → IndexedDB 迁移 ✅ 基础完成

**当前状态：** IndexedDB 作为主要存储，Electron `state.json` 作为持久化备份，localStorage 作为同步降级方案。三级数据源优先级已实现。

**后续建议：**
- IndexedDB 迁移工具 `migrateLocalStorageToIDB()` 已就绪
- 建议添加用户提示：首次使用 IndexedDB 时显示"数据已迁移到更安全的存储"通知
- 考虑定期自动备份到 IndexedDB（当前仅在 save() 时触发）

---

### Phase 1（核心体验）

#### ③ #6 密码修改 UI

**建议实现方案：**
- 在 `ensureAccountSecurityPanel()` 中扩展密码修改表单
- 密码强度实时检测（长度 ≥ 8、含大小写、含数字/特殊字符）
- 支持显示/隐藏密码切换
- 修改成功后自动刷新 token
- 错误时显示具体原因（密码错误、网络问题等）

**安全注意事项：**
- 当前密码输入不要回显
- 使用 `crypto.subtle` 做客户端哈希后再传输
- 限制尝试频率（客户端 3 次/分钟）

#### ④ #2 FSRS 学习计划设置 UI

**建议实现方案：**
- 在设置面板添加 FSRS 参数可视化调节器：
  - `desiredRetention`（目标保留率）：滑块 + 实时间隔预览
  - `dailyLimit` / `dailyNewLimit`：数字输入 + 进度条
  - `reviewPriority`：单选按钮组（已修复 Bug）
- 添加 7 天复习量预测图表（基于当前卡片状态和 FSRS 参数）
- 添加"重置为默认"按钮

**技术要点：**
- `window.knowledgeFSRS.preview()` 已可用，直接调用
- `syncSettings()` 需要同步更新 UI（已修复 Bug）

#### ⑤ #8 牌组收藏/书签

**建议实现方案：**
- `state.favorites` 数组已存在（hydrate 函数中处理）
- 在牌组卡片上添加 ⭐ 收藏按钮
- 市场页面添加"仅显示收藏"筛选
- 收藏状态同步到 profile 页面

**数据结构建议：**
```javascript
state.favorites = [
  { deckId: 'abc123', addedAt: '2026-07-23T00:00:00Z' }
]
```

#### ⑥ #3 卡片标签系统增强

**当前状态：** `getTagColor()` 和 `renderTagSpan()` 已实现，支持扁平多标签和颜色。

**增强建议：**
- 标签管理器面板（`ensureTagManagerPanel` 已就绪）
- 标签自动补全（输入时显示已有标签建议）
- 标签颜色自定义（点击标签 → 弹出调色板）
- 标签筛选支持多标签 AND/OR 逻辑

#### ⑦ #4 全局搜索

**建议实现方案：**
- 添加全局搜索快捷键（Ctrl+K / Cmd+K）
- 搜索范围：卡片问题/答案、文档标题/内容、牌组名称
- 搜索结果实时预览
- 使用 Fuse.js 或自建简单的模糊搜索索引

**性能考虑：**
- 1221 张卡片的全量搜索在前端完全可以承受
- 文档内容搜索可能需要索引优化

---

### Phase 2（增长/UGC，安全先行）

#### ⑧ #10 Redis 共享限流

**建议实现方案：**
- 后端使用 Redis `INCR` + `EXPIRE` 实现滑动窗口限流
- 默认限制：API 请求 60 次/分钟，下载 10 次/分钟
- 限流响应返回 `429 Too Many Requests` + `Retry-After` 头
- 客户端显示剩余配额和等待时间

**安全要点：**
- 基于用户 token 限流，未登录用户基于 IP
- 管理后台可配置限流参数
- 日志记录超限请求

#### ⑨ #5 用户自助注册

**建议实现方案：**
- 注册表单：用户名、密码、邮箱（可选）
- 客户端密码强度校验
- 注册后自动登录
- 防止重复注册（用户名/邮箱唯一性检查）

**安全措施：**
- 服务端 bcrypt 哈希存储密码
- 注册后发送验证邮件（可选）
- 注册频率限制（同 IP 5 次/小时）

#### ⑩ #7 牌组评价与评论

**建议实现方案：**
- 牌组详情页添加星级评分（1-5 星）
- 文字评论（200 字限制）
- 评论排序：最新、最有帮助
- 作者可以回复评论
- 管理后台可删除违规评论

---

### Phase 3（规模化/运维）

#### ⑪ #12 审计日志归档

**建议实现方案：**
- 记录所有管理操作（用户封禁、牌组删除、配置变更）
- 日志结构化存储（JSON 格式）
- 定期归档到冷存储（如 S3）
- 管理后台提供日志查询和导出

#### ⑫ #11 牌组增量更新

**建议实现方案：**
- 牌组版本号管理（semver）
- 更新时仅传输差异卡片
- 客户端对比本地版本和远程版本
- 先埋点量化使用频率，评估 ROI 后再实现

---

## 四、架构改进建议

### 短期（当前可做）

1. **添加 ESLint 规则**：自动检测 `$(` vs `$$(` 的使用，避免类似 Bug 再次发生
2. **添加单元测试**：对 `syncSettings()`、`reviewPlanItems()`、`setting()` 等关键函数做基本测试
3. **统一错误上报**：所有 safeCall 失败时统一上报到管理后台

### 中期（Phase 1 期间）

4. **引入事件系统**：替代全局变量通信，降低模块耦合
5. **添加加载状态 UI**：应用启动时显示加载动画，而非空白界面
6. **实现离线缓存**：Service Worker 缓存静态资源

### 长期（Phase 2+ 期间）

7. **考虑迁移到打包工具**：Vite/esbuild 可以提供更好的模块化和 tree-shaking
8. **添加 Crash Reporting**：集成 Sentry 或自建错误上报
9. **国际化支持**：i18n 框架，支持多语言界面

---

## 五、总结

本次修复解决了 Phase 0 模块化重构后引入的 **3 个关键运行时 Bug**，导致应用界面完全无响应。所有修复均已通过 Electron 自动化测试验证。

**核心教训：**
- 大型文件拆分时，务必保持函数边界的完整性
- `$()` 与 `$$()` 的混淆是 DOM 操作中的常见陷阱
- 自动化测试（即使是简单的启动测试）能快速发现初始化链中的问题
- 错误处理应始终使用 try/catch 包装，避免单个组件故障导致整个应用崩溃