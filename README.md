# Notion Card - 知识管理与间隔重复复习工具

> 基于 Electron 的桌面端知识管理应用，集成 FSRS 间隔重复算法，支持文档编辑、卡片制作、复习计划、牌组市场等功能。

## 项目概述

Notion Card 是一个面向学习者的知识管理工具，核心理念是**输入-加工-输出-复习**的学习闭环：

- **文档库**：富文本编辑器，支持 Markdown（含嵌套列表）、LaTeX 公式、代码高亮
- **卡片库**：将知识点制作为复习卡片（单选/多选/判断/速记），支持标签和卡组管理
- **复习系统**：基于 FSRS 算法的智能间隔重复复习，支持连续打卡追踪和复习热力图
- **牌组市场**：分享和下载社区牌组，支持收藏筛选、评价评论和用户注册
- **全局搜索**：Ctrl+K 快捷搜索，跨文档、卡片和牌组统一检索
- **云同步**：支持 WebDAV（坚果云等）同步
- **PDF 导出**：支持大文件导出（临时文件模式，无大小限制）

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Electron 28 | 跨平台桌面应用 |
| 前端 | 原生 HTML/CSS/JS | 无框架，全局作用域模块化 |
| 数学公式 | KaTeX | LaTeX 公式渲染 |
| 复习算法 | ts-fsrs | FSRS 间隔重复算法 |
| 数据存储 | IndexedDB + JSON 文件 | 双层持久化，localStorage 降级 |
| 后端（可选）| Fastify + Prisma + PostgreSQL | 牌组市场服务端 |
| 缓存/限流 | Redis (ioredis) | 共享限流，内存降级回退 |
| 构建打包 | electron-builder | Windows NSIS 安装包 |
| 自动更新 | electron-updater | GitHub Releases 更新 |

## 项目结构

```
knowledge-review-electron/
├── src/                          # 前端源码
│   ├── index.html                # 主页面（包含完整 HTML 结构）
│   ├── styles.css                # 样式表（完整 CSS）
│   ├── main.js                   # Electron 主进程入口
│   ├── preload.js                # 安全桥接层（contextBridge）
│   ├── renderer.js               # 渲染进程引导入口
│   ├── review/
│   │   └── fsrs-adapter.js       # FSRS 算法适配器
│   ├── market-login-characters.js # 市场登录页动画
│   ├── modules/                  # 功能模块（全局作用域）
│   │   ├── idb-store.js          # IndexedDB 存储适配
│   │   ├── kr-core.js            # 常量、工具函数、数据模型
│   │   ├── kr-state.js           # 状态管理（load/save/hydrate）
│   │   ├── kr-cards.js           # 卡片 CRUD 和渲染
│   │   ├── kr-documents.js       # 文档编辑和树形结构
│   │   ├── kr-review.js          # 复习系统和 FSRS 集成
│   │   ├── kr-market.js          # 牌组市场、认证、收藏、密码修改
│   │   ├── kr-profile.js         # 个人资料管理
│   │   ├── kr-settings.js        # 设置面板和应用初始化
│   │   └── kr-ui.js              # UI 工具、事件绑定、WebDAV、全局搜索
│   ├── assets/                   # 静态资源（图标、Logo）
│   └── vendor/                   # 第三方库（KaTeX 字体和 JS）
├── backend/                      # 牌组市场后端
│   ├── src/
│   │   └── server.ts             # Fastify 服务端
│   ├── prisma/
│   │   └── schema.prisma         # 数据库 Schema（PostgreSQL）
│   └── dist/                     # 编译输出
├── scripts/                      # 辅助脚本
├── docs/                         # 用户文档
├── smoke/                        # 冒烟测试
├── .github/workflows/            # GitHub Actions CI/CD
├── package.json                  # 项目配置
└── README.md                     # 本文件
```

## 模块加载顺序

前端采用**全局作用域模块化**（无打包器），所有模块共享全局 `window` 对象。加载顺序至关重要：

```
index.html 中的 <script> 加载顺序：
1. idb-store.js    → IndexedDB 适配器（无依赖）
2. kr-core.js      → 常量和工具函数（无依赖）
3. kr-state.js     → 状态管理（依赖 kr-core）
4. kr-cards.js     → 卡片功能（依赖 kr-core, kr-state）
5. kr-documents.js → 文档功能（依赖 kr-core, kr-state, kr-cards）
6. kr-review.js    → 复习功能（依赖 kr-core, kr-state, kr-cards）
7. kr-market.js    → 市场功能（依赖 kr-core, kr-state）
8. kr-profile.js   → 个人资料（依赖 kr-core, kr-state, kr-market）
9. kr-settings.js  → 设置和 init()（依赖所有模块）
10. kr-ui.js       → UI 绑定（依赖所有模块）
11. renderer.js    → 引导入口（调用 init()）
```

> **注意**：由于所有函数都在全局作用域，后加载的模块可以调用先加载模块的函数。但如果顺序错误，会导致 `ReferenceError`。

## 数据流架构

```
┌─────────────────────────────────────────────────────┐
│                  渲染进程 (Renderer)                  │
│                                                     │
│  ┌─────────┐    ┌──────────┐    ┌───────────────┐  │
│  │ UI 模块  │───▶│ kr-state │───▶│  IndexedDB    │  │
│  │ kr-*.js │    │ (state)  │    │ (主要存储)     │  │
│  └─────────┘    └────┬─────┘    └───────────────┘  │
│                      │                               │
│                      ▼                               │
│              ┌───────────────┐                      │
│              │  localStorage │                      │
│              │ (降级方案)     │                      │
│              └───────────────┘                      │
└──────────────────────┬──────────────────────────────┘
                       │ IPC (contextBridge)
                       ▼
┌─────────────────────────────────────────────────────┐
│                   主进程 (Main)                      │
│                                                     │
│  ┌───────────────┐  ┌──────────┐  ┌─────────────┐  │
│  │  state.json   │  │ autoUpd. │  │  市场 API   │  │
│  │ (持久化备份)   │  │ (更新)    │  │ (HTTP/HTTPS)│  │
│  └───────────────┘  └──────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 数据存储优先级

1. **IndexedDB**（异步，大容量，首选）
2. **Electron state.json**（`%APPDATA%/KnowledgeReview/data/state.json`）
3. **localStorage**（5MB 限制，降级方案；超限时自动静默跳过，不弹 toast）

应用启动时，`init()` 函数从三个数据源加载数据，选择 **`savedAt` 时间戳最新**的作为有效数据源（而非卡片数量最多的），确保用户最近的操作不被旧快照覆盖。当数据源之间卡片数量差异超过 20% 时，自动创建安全备份。

## 已实现功能清单

### 核心功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 文档库 | ✅ 完整 | 三栏工作区（文档树/编辑器/大纲），支持拖拽归组 |
| 卡片库 | ✅ 完整 | 单选/多选/判断/速记，支持标签、卡组、搜索筛选 |
| 复习系统 | ✅ 完整 | FSRS 算法，专注模式 + 侧栏模式，连续打卡追踪 |
| 牌组市场 | ✅ 完整 | 登录认证、用户注册、牌组评价评论、收藏筛选 |
| 全局搜索 | ✅ 完整 | Ctrl+K 快捷键，跨文档/卡片/牌组统一检索 |
| WebDAV 同步 | ✅ 完整 | 坚果云等，测试连接不自动保存配置 |
| PDF 导出 | ✅ 完整 | 临时文件模式，无大小限制 |
| 导入导出 | ✅ 完整 | JSON / Markdown 双向导入导出 |
| 回收站 | ✅ 完整 | 分类查看、恢复、彻底删除、清空 |
| 自动更新 | ✅ 完整 | GitHub Releases 后台下载，重启安装 |
| 个人中心 | ✅ 完整 | 统计面板、52 周打卡热图 |

### 设置页面

| 面板 | 说明 |
|------|------|
| 复习算法 | FSRS 参数：目标保持率、每日复习上限、每日新卡上限、优先模式 |
| 存储 | 本地存储策略说明，数据导出入口 |
| 服务器 | 牌组市场服务器地址配置（留空使用本机） |
| 关于 | 版本信息和数据路径 |

> **密码修改**位于牌组市场的账户下拉菜单中，不在设置页面。

### 后端 API（牌组市场）

| 功能 | 路由 | 说明 |
|------|------|------|
| 认证 | `/auth/login`, `/auth/register` | 登录 + 自助注册 |
| 密码修改 | `/me/password` | PATCH 修改密码 |
| 牌组 | `/decks`, `/decks/:id` | 列表、详情、搜索 |
| 收藏 | `/favorites`, `/favorites/:deckId` | 收藏/取消收藏 |
| 评价 | `/decks/:id/reviews` | 星级评分 + 文字评论 |
| 管理 | `/admin/*` | 用户管理、牌组审核、分类管理 |
| 限流 | Redis INCR + EXPIRE | 滑动窗口限流，内存降级回退 |
| 审计 | `AuditLog` 表 | 90 天审计日志归档 |

## 开发指南

### 环境要求

- Node.js 18+
- npm 9+

### 快速开始

```bash
# 安装依赖（使用项目内缓存）
npm install --cache .npm-cache

# 环境诊断
npm run doctor

# 开发模式运行
npm run dev
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式运行 |
| `npm run build` | 构建 Windows 安装包 |
| `npm run check` | 语法校验所有 JS 文件 |
| `npm run doctor` | 环境诊断 |
| `npm test` | 运行冒烟测试 |

### 调试技巧

- 打开开发者工具：`Ctrl+Shift+I`
- 主进程日志：终端输出
- 渲染进程日志：开发者工具 Console
- 应用数据路径：`%APPDATA%/KnowledgeReview/`

### 代码风格

- 所有模块使用 JSDoc 注释头，标明依赖和导出函数
- 全局函数使用驼峰命名（如 `renderCards`、`syncSettings`）
- `$()` = `document.querySelector()`（返回单个元素）
- `$$()` = `document.querySelectorAll()`（返回元素数组）
- 异步操作使用 async/await + try/catch

## 发布与自动更新

### 发布流程

1. 修改 `package.json` 中的版本号
2. 提交代码并打标签：
   ```bash
   git tag v0.1.8
   git push origin v0.1.8
   ```
3. GitHub Actions 自动构建并发布 Release
4. 已安装客户端会收到更新通知

### 更新机制

- 检查频率：应用启动时 + 每 4 小时
- 下载方式：后台流式下载
- 安装方式：用户确认后重启安装
- 回滚机制：自动备份旧版本数据

## 后端（牌组市场）

牌组市场后端是可选组件，位于 `backend/` 目录。

### 技术栈

- **Fastify** + TypeScript
- **Prisma** ORM + PostgreSQL
- **JWT** 认证
- **ioredis** 共享限流（内存降级回退）
- 文件存储（牌组 ZIP 包）

### 快速启动

```bash
cd backend
npm install
npx prisma migrate deploy
npm run dev
```

详见 `backend/README.md` 和 `backend/API-DOCUMENTATION.md`。

## 近期 Bug 修复

以下 12 个 Bug 已在 2026-07-22/23 修复（详见 [FIX_DIARY.md](FIX_DIARY.md)）：

| # | 严重度 | Bug | 文件 |
|---|--------|-----|------|
| 01 | 🔴 高 | WebDAV 测试连接触发不必要的配置保存 | `main.js` |
| 02 | 🔴 高 | 数据源选择策略导致已删除卡片复活 | `kr-settings.js` |
| 03 | 🔴 高 | localStorage 超限后持续弹 toast | `kr-state.js` |
| 04 | 🔴 高 | PDF 导出 data URL 大小限制 | `main.js` |
| 05 | 🔴 高 | normCard 每次调用都执行 FSRS 迁移 | `kr-core.js` |
| 06 | 🟡 中 | queueKey 缓存导致过期队列 | `kr-core.js` |
| 07 | 🟡 中 | 全局搜索中 card.options 被当数组 | `kr-ui.js` |
| 08 | 🟡 中 | reviewEvents 无限增长无清理 | `kr-state.js` |
| 09 | 🟡 中 | streak 连续打卡函数逻辑缺陷 | `kr-review.js` |
| 10 | 🟡 中 | persistentSave 失败无用户通知 | `kr-state.js` |
| 11 | 🟡 中 | Markdown 渲染器不支持嵌套列表 | `kr-documents.js` |
| 12 | 🟡 中 | renderTree 不自动包含新文件夹 | `kr-documents.js` |

## 用户文档

完整使用说明见 [docs/使用说明书与已实现功能.md](docs/使用说明书与已实现功能.md)

## 常见问题

### Q: 应用启动后界面空白？
A: 打开开发者工具（Ctrl+Shift+I）查看 Console 错误信息。常见原因：
- IndexedDB 被锁定（重启应用）
- 模块加载顺序错误（检查 index.html 中的 script 顺序）

### Q: 数据会丢失吗？
A: 应用有三层数据保护：IndexedDB、state.json、localStorage。`init()` 基于 `savedAt` 时间戳选择最新数据源，不会因为旧快照卡片数量多而覆盖。当数据差异超过 20% 时自动创建安全备份。

### Q: 如何备份数据？
A: 数据文件位于 `%APPDATA%/KnowledgeReview/data/state.json`，复制此文件即可备份。也可以在设置中启用 WebDAV 自动备份。

### Q: 牌组市场的收藏怎么用？
A: 登录后，每个牌组卡片右上角有 ❤️ 收藏按钮。点击可收藏/取消收藏。在分类筛选器中选择「★ 我的收藏」可查看已收藏的牌组。

### Q: 如何修改密码？
A: 进入牌组市场 → 点击右上角账户头像 → 下拉菜单中选择「修改密码」。

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request。