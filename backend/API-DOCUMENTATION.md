# Knowledge Review 牌组市场后端文档

## 更新记录

- `0.3.1`：分类目录支持管理员改名和删除；改名会同步牌组分类，删除仍被牌组使用的分类会被 `409` 拒绝，避免产生无分类牌组。

本文档描述当前仓库中已经实现的牌组市场后端，包括接口、认证、数据结构、牌组包格式、管理员功能、存储方式、部署方式和测试边界。

## 1. 系统定位

牌组市场后端是一个独立的 Fastify + PostgreSQL 服务，与 Electron 客户端的本地数据完全分离：

- 后端不读取或修改用户本地的 `state.json`、本地卡片库或复习记录。
- 市场牌组保存在服务器 PostgreSQL 和文件存储目录中。
- 客户端登录市场后获得 JWT，之后使用 JWT 调用牌组浏览、下载、上传和管理接口。
- 牌组每次更新都会保存为新的不可变版本，旧版本文件不会被覆盖。
- 牌组版本拥有独立审核状态；新上传版本不会自动替换当前公开版本。
- 当前默认服务地址为 `http://127.0.0.1:4000`，API 前缀为 `/api/v1`。

当前已实现的角色：

| 角色 | 能力 |
| --- | --- |
| `USER` | 登录市场、浏览公开牌组、查看详情、下载公开牌组、上传自己的牌组、上传新版本 |
| `ADMIN` | 拥有普通用户全部能力，并可创建/停用许可账户、审核牌组、发布或下架牌组 |

## 2. 服务和依赖

- Node.js 22
- TypeScript
- Fastify 5
- PostgreSQL 16
- Prisma 6
- JWT：登录令牌有效期为 12 小时
- Argon2：用户密码只保存哈希，不保存明文
- `@fastify/multipart`：接收牌组 ZIP 文件
- `adm-zip`：校验 ZIP 内容
- 本地文件存储：保存上传的牌组包

服务启动时会检查：

- `MARKET_ACCESS_KEY` 至少 24 个字符。
- `JWT_SECRET` 至少 32 个字符。
- 上传文件必须是 ZIP。
- 默认最大上传大小为 250 MB，可通过 `MAX_UPLOAD_MB` 调整。

## 3. 环境变量

参考文件：`.env.example`

```env
NODE_ENV=development
PORT=4000
HOST=0.0.0.0
DATABASE_URL=postgresql://market:market_password@postgres:5432/market?schema=public
MARKET_ACCESS_KEY=replace-with-a-long-random-key
JWT_SECRET=replace-with-another-long-random-secret
STORAGE_DIR=/app/storage
MAX_UPLOAD_MB=250
CORS_ORIGIN=http://localhost:5173
MAX_ARCHIVE_ENTRIES=10000
MAX_UNCOMPRESSED_MB=1024
MAX_ARCHIVE_ENTRY_MB=100
LOGIN_RATE_LIMIT_MAX=10
LOGIN_RATE_LIMIT_WINDOW_SECONDS=900
DOWNLOAD_RATE_LIMIT_MAX=30
DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS=60
UPLOAD_RATE_LIMIT_MAX=5
UPLOAD_RATE_LIMIT_WINDOW_SECONDS=3600
```

字段说明：

- `PORT`：HTTP 服务端口。
- `HOST`：监听地址。Docker 中使用 `0.0.0.0`。
- `DATABASE_URL`：PostgreSQL 连接字符串。
- `MARKET_ACCESS_KEY`：所有市场用户都必须输入的服务器密钥。它不是用户密码。
- `JWT_SECRET`：签发和校验 JWT 的服务端密钥，不应暴露给客户端。
- `STORAGE_DIR`：牌组 ZIP 文件的存储目录。
- `MAX_UPLOAD_MB`：单个 ZIP 上传大小上限。
- `MAX_ARCHIVE_ENTRIES`：单个 ZIP 的最大目录项数量。
- `MAX_UNCOMPRESSED_MB`：ZIP 解压后的总大小上限，用于降低 ZIP 炸弹风险。
- `MAX_ARCHIVE_ENTRY_MB`：ZIP 内单个文件的解压大小上限。
- `*_RATE_LIMIT_*`：登录、下载和上传的单进程内存限流参数；多实例部署时应在网关或 Redis 层增加共享限流。
- `MAX_ARCHIVE_ENTRIES`：单个 ZIP 最大目录项数量。
- `MAX_UNCOMPRESSED_MB`：ZIP 解压后的总大小上限。
- `MAX_ARCHIVE_ENTRY_MB`：ZIP 内单个文件的解压大小上限。
- `*_RATE_LIMIT_*`：登录、下载和上传的单进程内存限流参数。
- `CORS_ORIGIN`：允许的浏览器来源；Electron 的 `file://`/`null` 来源由服务端特殊允许。

## 4. 认证机制

### 4.1 登录流程

客户端向登录接口同时提交：

1. 服务器密钥 `accessKey`
2. 许可账户名 `username`
3. 账户密码 `password`

服务端依次校验市场密钥、账户是否存在、账户是否启用以及 Argon2 密码哈希。成功后返回 JWT。

```http
POST /api/v1/auth/login
Content-Type: application/json
```

请求体：

```json
{
  "accessKey": "your-market-access-key",
  "username": "tester",
  "password": "your-password"
}
```

成功响应 `200`：

```json
{
  "token": "eyJ...",
  "user": {
    "id": "uuid",
    "username": "tester",
    "role": "USER"
  }
}
```

之后所有需要认证的接口都必须发送：

```http
Authorization: Bearer eyJ...
```

### 4.2 令牌和账户状态

- JWT 有效期为 12 小时。
- 每次调用受保护接口，服务端会重新查询数据库中的用户状态。
- 管理员停用账户后，该账户现有 JWT 也会立即失效。
- 账户登录成功会更新 `lastLoginAt`。
- 登录成功会写入 `AuditLog`，记录 `auth.login`。

### 4.3 通用错误格式

接口发生可预期错误时返回：

```json
{
  "error": "错误说明"
}
```

常见状态码：

| 状态码 | 含义 |
| --- | --- |
| `400` | 请求参数、JSON、牌组包格式或版本号错误 |
| `401` | 未登录、令牌无效、市场密钥错误或账户已停用 |
| `403` | 当前账户不是管理员 |
| `404` | 牌组、牌组版本或账户不存在 |
| `413` | 上传文件超过大小限制 |
| `429` | 超过登录、下载或上传频率限制；响应包含 `Retry-After` |
| `503` | 数据库记录存在，但服务器牌组文件暂时不可用 |
| `500` | 服务端内部错误 |

| `429` | 超过登录、下载或上传频率限制；响应包含 `Retry-After` |
| `503` | 数据库记录存在，但服务器牌组文件暂时不可用 |

## 5. 基础接口

### 5.1 健康检查

```http
GET /health
```

不需要认证。

响应：

```json
{
  "ok": true,
  "service": "knowledge-review-market",
  "time": "2026-07-21T00:00:00.000Z"
}
```

该接口只说明 Node 服务正在运行，不代表数据库迁移、文件存储或牌组业务完全正常。

### 5.2 获取当前登录用户

```http
GET /api/v1/me
Authorization: Bearer <token>
```

响应：

```json
{
  "id": "uuid",
  "username": "tester",
  "role": "USER"
}
```

## 6. 公开牌组接口

公开牌组接口只返回状态为 `PUBLISHED` 且存在已发布版本的牌组。`DRAFT`、`PENDING` 和 `DISABLED` 牌组不会出现在普通市场列表中。

牌组状态和版本状态分开管理：新上传版本为 `PENDING`，旧的公开版本会继续对外提供；管理员发布新版本后，`publishedVersion` 才切换。

### 6.1 获取公开牌组列表

```http
GET /api/v1/decks
Authorization: Bearer <token>
```

### 6.1.1 获取已启用分类

```http
GET /api/v1/categories
Authorization: Bearer <token>
```

只返回管理员已通过的分类，以及历史已公开牌组正在使用的分类。普通用户上传时可以直接填写新分类；新分类会随牌组提交进入 `PENDING` 审核，不会因为不在此列表中而被拒绝。

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `q` | string | 否 | 搜索标题或描述，大小写不敏感 |
| `category` | string | 否 | 精确匹配分类 |
| `sort` | `latest\|popular\|cards` | 否 | 默认 `latest` |
| `page` | positive integer | 否 | 页码，默认 `1` |
| `pageSize` | 1-100 | 否 | 每页数量，默认 `20` |

示例：

```http
GET /api/v1/decks?q=JavaScript&category=编程开发&sort=popular
Authorization: Bearer <token>
```

响应：

```json
{
  "items": [
    {
    "id": "uuid",
    "title": "JavaScript Core",
    "description": "Core JavaScript concepts",
    "category": "Programming",
    "author": "tester",
    "version": 2,
    "downloads": 12,
    "manifest": {
      "format": "knowledge-review-deck",
      "title": "JavaScript Core",
      "description": "Core JavaScript concepts",
      "category": "Programming",
      "version": 2,
      "cardCount": 120
    }
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 42,
  "totalPages": 3
}
```

### 6.2 获取公开牌组详情

```http
GET /api/v1/decks/:id
Authorization: Bearer <token>
```

只允许读取 `PUBLISHED` 牌组。响应包含当前公开版本号和公开版本的 `manifest`，不直接返回 ZIP 内容。

### 6.3 检查牌组更新

```http
GET /api/v1/decks/:id/update?version=1
Authorization: Bearer <token>
```

`version` 是客户端当前已下载的版本号，不填写时按 `0` 处理。接口只返回已发布版本，不会暴露待审核版本。

响应：

```json
{
  "deckId": "uuid",
  "hasUpdate": true,
  "currentVersion": 1,
  "latestVersion": 2,
  "packageSize": "2048000",
  "sha256": "64-character-sha256",
  "changelog": "修复卡片内容并新增图片",
  "publishedAt": "2026-07-21T10:00:00.000Z",
  "manifest": {}
}
```

### 6.4 下载公开牌组

```http
GET /api/v1/decks/:id/download
Authorization: Bearer <token>
```

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `version` | positive integer | 否 | 指定版本；不填时下载最新版本 |

响应：

- `Content-Type: application/zip`
- `Content-Length: ZIP 文件大小`
- `Content-Disposition: attachment; filename="deck-<id>-v<version>.zip"`
- `X-Deck-Version: 当前下载版本`
- 响应体为文件流，不会把整个 ZIP 转换成 JSON。
- 指定版本也必须是状态为 `PUBLISHED` 的版本。

下载成功后写入一条 `DeckDownload` 记录，用于统计下载次数。

注意：当前下载接口要求牌组当前仍为 `PUBLISHED`。管理员下架后，即使指定历史版本，也不能继续从公开下载接口读取。

## 7. 用户牌组接口

用户只能管理自己创建的牌组。新上传牌组默认状态为 `PENDING`，需要管理员发布后才会出现在公开市场。

### 7.1 获取我的牌组

```http
GET /api/v1/my-decks
Authorization: Bearer <token>
```

返回当前用户创建的所有牌组，包括 `DRAFT`、`PENDING`、`PUBLISHED` 和 `DISABLED`，并附带全部版本记录。

由于 PostgreSQL `BigInt` 不能直接安全序列化，返回的 `packageSize` 是字符串：

```json
[
  {
    "id": "uuid",
    "ownerId": "uuid",
    "title": "JavaScript Core",
    "description": "Core JavaScript concepts",
    "category": "Programming",
    "status": "PENDING",
    "currentVersion": 1,
    "createdAt": "2026-07-21T01:00:00.000Z",
    "updatedAt": "2026-07-21T01:00:00.000Z",
    "versions": [
      {
        "id": "uuid",
        "version": 1,
        "packagePath": "/app/storage/decks/.../package.zip",
        "packageSize": "404",
        "sha256": "64-character-sha256",
        "manifest": {},
        "createdAt": "2026-07-21T01:00:00.000Z"
      }
    ]
  }
]
```

生产环境不建议把 `packagePath` 直接展示给前端；当前接口主要用于管理界面和调试，后续可以改成只返回文件大小、哈希和时间。

### 7.2 上传新牌组

```http
POST /api/v1/my-decks
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

multipart 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `metadata` | JSON 字符串 | 否 | 覆盖牌组标题、描述和分类 |
| `package` | ZIP 文件 | 是 | 牌组包，字段名必须为 `package` |

`metadata` 示例：

```json
{
  "title": "JavaScript Core",
  "description": "Core JavaScript concepts",
  "category": "Programming"
}
```

牌组包中的 `manifest.json` 还可以包含版本说明：

```json
{
  "version": 2,
  "changelog": "新增图片卡片，修正第 12 张卡片的答案"
}
```

命令行示例：

```powershell
curl.exe -X POST http://localhost:4000/api/v1/my-decks `
  -H "Authorization: Bearer <token>" `
  -F 'metadata={"title":"JavaScript Core","category":"Programming"}' `
  -F "package=@market-test.zip"
```

成功响应 `201`：

```json
{
  "id": "uuid",
  "version": 1,
  "sha256": "64-character-sha256",
  "status": "PENDING"
}
```

处理步骤：

1. 流式接收 multipart 文件到临时文件。
2. 检查文件扩展名为 `.zip`。
3. 检查文件大小不能超过 `MAX_UPLOAD_MB`。
4. 解压内存中的 ZIP 并检查 `manifest.json` 和 `cards.json`。
5. 校验 `manifest.cardCount` 与 `cards.json` 数量一致。
6. 创建牌组记录。
7. 计算 ZIP 的 SHA-256。
8. 把 ZIP 移动到版本目录。
9. 创建不可变 `DeckVersion` 并更新牌组当前版本。

### 7.3 上传已有牌组的新版本

```http
POST /api/v1/my-decks/:id/versions
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

multipart 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `package` | ZIP 文件 | 是 | 新版本牌组包 |

新版本号来自 ZIP 中的 `manifest.version`，并且必须大于当前版本号。服务端拒绝：

- 版本号小于或等于当前版本。
- 同一牌组重复使用已有版本号。
- 非牌组所有者上传该牌组版本。
- 无效 ZIP 或缺少必需文件。

成功响应：

```json
{
  "id": "uuid",
  "version": 2,
  "sha256": "64-character-sha256",
  "status": "PENDING"
}
```

上传新版本不会自动发布。已发布牌组上传新版本后，新版本进入 `PENDING`，旧的公开版本继续提供下载；管理员发布新版本后，客户端的更新检查接口才会返回新版本。版本说明保存在该版本的 `manifest.changelog` 中，公开更新接口会返回最新已发布版本的说明。

普通用户只能通过 `POST /api/v1/my-decks/:id/versions` 更新自己已有的牌组；重复调用新建接口创建同名牌组会返回 `409`。

## 8. 牌组包格式

牌组必须是 ZIP 文件，至少包含：

```text
deck.zip
├── manifest.json
├── cards.json
└── assets/
    ├── image-1.png
    └── ...
```

最小 `manifest.json`：

```json
{
  "format": "knowledge-review-deck",
  "title": "JavaScript Core",
  "description": "Core JavaScript concepts",
  "category": "Programming",
  "version": 1,
  "cardCount": 2
}
```

服务端当前强制校验的字段：

- `title`：1 到 160 个字符。
- `description`：最多 2000 个字符，默认空字符串。
- `category`：1 到 80 个字符。
- `version`：正整数。
- `cardCount`：可选；如果提供，必须等于 `cards.json` 数组长度。

`cards.json` 必须是 JSON 数组。服务端目前不深入验证每张卡片的业务字段，只验证它是数组以及数量是否匹配。

图片和其他资源可以放入 `assets/`。服务端会把 ZIP 原样保存，客户端负责根据牌组包内的相对路径读取资源。

## 9. 管理员接口

管理员接口全部要求：

```http
Authorization: Bearer <admin-token>
```

普通用户调用时返回 `403 Administrator access required`。

### 9.1 获取许可用户

```http
GET /api/v1/admin/users
Authorization: Bearer <admin-token>
```

返回所有许可账户：

管理员工作区可以使用 `?page=1&pageSize=20` 获取分页结果；不带分页参数时保留数组格式兼容旧客户端。

```json
[
  {
    "id": "uuid",
    "username": "tester",
    "role": "USER",
    "enabled": true,
    "createdAt": "2026-07-21T01:00:00.000Z",
    "lastLoginAt": "2026-07-21T02:00:00.000Z"
  }
]
```

### 9.2 创建许可账户

```http
POST /api/v1/admin/users
Authorization: Bearer <admin-token>
Content-Type: application/json
```

请求体：

```json
{
  "username": "new-user",
  "password": "a-password-at-least-8-chars"
}
```

规则：

- 用户名长度 3 到 80。
- 用户名只允许英文字母、数字、下划线、点和短横线。
- 密码长度 8 到 200。
- 密码使用 Argon2 哈希后写入数据库。
- 新账户默认角色为 `USER`，默认启用。

### 9.3 启用或停用许可账户

```http
PATCH /api/v1/admin/users/:id/enable
PATCH /api/v1/admin/users/:id/disable
Authorization: Bearer <admin-token>
```

停用账户后：

- 该用户不能再次登录。
- 该用户已有 JWT 在下一次请求时会被拒绝。
- 用户拥有的牌组记录不会被删除。
- 用户历史下载记录不会被删除。

### 9.4 获取牌组审核列表

```http
GET /api/v1/admin/decks
Authorization: Bearer <admin-token>
```

可选查询参数：

```http
GET /api/v1/admin/decks?status=PENDING
```

支持的状态：

- `DRAFT`
- `PENDING`
- `PUBLISHED`
- `DISABLED`

返回内容包含牌组所有者、最新版本、下载统计和版本文件大小。

### 9.5 发布牌组或当前待审核版本

```http
PATCH /api/v1/admin/decks/:id/publish
Authorization: Bearer <admin-token>
```

存在待审核版本时，该接口会发布最新的 `PENDING` 版本；没有待审核版本时，会发布当前最新的已发布版本。

### 9.6 发布或拒绝指定版本

```http
PATCH /api/v1/admin/decks/:id/versions/:version/publish
PATCH /api/v1/admin/decks/:id/versions/:version/reject
Authorization: Bearer <admin-token>
```

只有 `PENDING` 版本可以审核。发布会更新 `Deck.publishedVersion`；拒绝只将版本标记为 `REJECTED`，不会删除 ZIP，也不会影响旧的公开版本。

### 9.7 下架牌组

```http
PATCH /api/v1/admin/decks/:id/disable
Authorization: Bearer <admin-token>
```

下架只修改牌组状态为 `DISABLED`，不会删除：

- 牌组数据库记录。
- 历史版本。
- ZIP 文件。
- 下载统计。

下架后普通用户的公开列表、详情和下载接口均不再返回该牌组。

### 9.8 永久删除停用牌组

```http
DELETE /api/v1/admin/decks/:id
Authorization: Bearer <admin-token>
```

安全限制：

- 只有状态为 `DISABLED` 的牌组允许永久删除。
- `PUBLISHED`、`PENDING`、`DRAFT` 牌组会返回 `409`，必须先停用。
- 删除前服务端会把牌组文件目录移入临时隔离目录。
- 数据库事务删除牌组及其关联的版本、下载记录。
- 数据库删除成功后，再永久删除隔离目录中的所有 ZIP 文件。
- 如果数据库删除失败，服务端会尝试恢复文件目录。

删除成功响应：

```json
{
  "id": "uuid",
  "deleted": true,
  "storageCleanupPending": false
}
```

`storageCleanupPending=true` 表示数据库记录已经删除，但服务器文件暂时无法移除，管理员应在“存储检查”中清理对应的隔离目录。

数据库关联行为：

- `DeckVersion`：级联删除。
- `DeckDownload`：级联删除。
- `AuditLog`：保留管理员删除操作记录，不因牌组删除而丢失。
- 用户本地牌组、卡片和复习记录：完全不受影响。

### 9.9 分类管理

```http
GET /api/v1/admin/categories
POST /api/v1/admin/categories
PATCH /api/v1/admin/categories/:id
DELETE /api/v1/admin/categories/:id
PATCH /api/v1/admin/categories/:id/approve
PATCH /api/v1/admin/categories/:id/reject
PATCH /api/v1/admin/decks/:id/category
Authorization: Bearer <admin-token>
```

`PATCH /api/v1/admin/categories/:id` 修改分类名称，并同步更新使用该分类的牌组。分类名称不能与已有分类重复。

`DELETE /api/v1/admin/categories/:id` 删除分类。为避免牌组失去分类，分类仍被牌组使用时接口返回 `409`，管理员需要先调整这些牌组的分类。

- 用户上传一个数据库中不存在的新分类时，服务端创建 `PENDING` 分类记录。
- 管理员可以创建立即生效的公开分类，也可以审核用户提交的分类。
- 只有分类为 `PUBLISHED` 后，使用该分类的待审核版本才允许发布。
- 管理员调整牌组分类时会创建或启用对应分类，并更新牌组的公开分类。

所有管理员创建账户、启用/停用账户、发布/拒绝版本、发布/下架牌组、创建/审核分类和调整牌组分类的操作都会写入 `AuditLog`。

## 10. 数据模型

### 10.1 User

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `username` | 唯一账户名 |
| `passwordHash` | Argon2 密码哈希 |
| `role` | `USER` 或 `ADMIN` |
| `enabled` | 是否允许登录 |
| `createdAt` | 创建时间 |
| `lastLoginAt` | 最近登录时间 |

### 10.2 Deck

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `ownerId` | 所有者用户 ID |
| `title` | 牌组标题 |
| `description` | 牌组描述 |
| `category` | 分类 |
| `status` | `DRAFT`、`PENDING`、`PUBLISHED`、`DISABLED` |
| `currentVersion` | 当前最新版本号 |
| `publishedVersion` | 当前对外公开的版本号，可以为空 |
| `createdAt` | 创建时间 |
| `updatedAt` | 更新时间 |

### 10.3 DeckVersion

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `deckId` | 所属牌组 |
| `version` | 版本号；同一牌组内唯一 |
| `status` | `PENDING`、`PUBLISHED`、`REJECTED` |
| `packagePath` | 服务器 ZIP 路径 |
| `packageSize` | ZIP 文件大小 |
| `sha256` | ZIP SHA-256 |
| `manifest` | 上传时解析的清单 JSON |
| `createdAt` | 版本创建时间 |

数据库约束 `deckId + version` 唯一，保证一个牌组不会出现重复版本。

### 10.4 DeckDownload

记录每次成功发起的牌组下载：

- 牌组 ID。
- 用户 ID。
- 下载版本。
- 下载时间。

### 10.5 AuditLog

当前已记录的主要操作：

- `auth.login`
- `admin.user.create`
- `admin.user.enable`
- `admin.user.disable`
- `admin.deck.publish`
- `admin.deck.disable`
- `admin.deck.version.publish`
- `admin.deck.version.reject`
- `admin.deck.delete`
- `admin.category.create`
- `admin.category.approve`
- `admin.category.reject`
- `admin.deck.category.update`

日志接口支持真正的服务端分页：

```http
GET /api/v1/admin/audit-logs?page=2&pageSize=25
Authorization: Bearer <admin-token>
```

响应包含 `items`、`page`、`pageSize`、`total` 和 `totalPages`，不会一次性加载全部日志。

### 10.6 MarketCategory

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `name` | 唯一分类名称 |
| `status` | `PENDING`、`PUBLISHED` 或 `REJECTED` |
| `createdById` | 提交用户，可为空 |
| `createdAt` / `updatedAt` | 创建和更新时间 |

## 11. 文件存储结构

默认存储目录由 `STORAGE_DIR` 决定。牌组版本通常保存为：

```text
storage/
└── decks/
    └── <deck-id>/
        ├── v1/
        │   └── package.zip
        └── v2/
            └── package.zip
```

数据库保存文件路径、大小、哈希和清单；文件本体保存在 `STORAGE_DIR`。

更新版本时不会覆盖 `v1/package.zip`，而是创建新的 `v2`、`v3` 目录。

## 12. 部署

### 12.1 本地开发

```powershell
cd backend
Copy-Item .env.example .env
# 修改 .env 中的 DATABASE_URL、MARKET_ACCESS_KEY、JWT_SECRET
npm install
npm run db:generate
npm run db:deploy
$env:ADMIN_USERNAME = 'admin'
$env:ADMIN_PASSWORD = 'change-this-to-a-long-password'
npm run admin:create
npm run dev
```

### 12.2 Docker

```powershell
cd backend
Copy-Item .env.example .env
# 如果宿主机 PostgreSQL 使用默认参数，可直接使用默认值；否则修改 .env
# POSTGRES_USER、POSTGRES_PASSWORD、POSTGRES_DB
# 或直接设置 DOCKER_DATABASE_URL
docker compose up -d --build
docker compose logs -f api
```

当前 Docker 部署只启动 API 容器，并连接宿主机上已经运行的 PostgreSQL：

- `api`：牌组市场 API，默认映射到宿主机 `4000` 端口。
- PostgreSQL：通过 `host.docker.internal:5432` 访问宿主机上的现有数据库。

API 镜像基于 `node:22-bookworm-slim`，构建阶段和运行阶段都会安装 OpenSSL，以保证 Prisma 在 Docker 中可以正常生成客户端并连接 PostgreSQL。

首次启动时，`docker-entrypoint.sh` 会等待数据库可连接，并自动执行 `prisma migrate deploy`，成功后再启动 API。该过程不会清空或重建数据库。

牌组文件存储通过 `HOST_STORAGE_DIR` 挂载到容器的 `/app/storage`。默认值为 `backend/storage`：

```powershell
$env:HOST_STORAGE_DIR = 'D:\knowledge-review\market-storage'
docker compose up -d --build
```

如果使用现有宿主机数据库，建议在 `backend/.env` 中明确配置：

```dotenv
POSTGRES_USER=admin
POSTGRES_PASSWORD=yang12345
POSTGRES_DB=mydb
DOCKER_DATABASE_URL=postgresql://admin:yang12345@host.docker.internal:5432/mydb?schema=public
HOST_STORAGE_DIR=./storage
```

验证 API 和数据库连接：

```powershell
Invoke-RestMethod http://127.0.0.1:4000/health
docker compose ps
```

健康检查返回 `ok: true` 后，客户端才可以进入牌组市场。若宿主机 `4000` 已被本地 Node API 占用，先停止该进程，或使用其他端口映射：

```powershell
$env:API_PORT = '4001'
docker compose up -d
Invoke-RestMethod http://127.0.0.1:4001/health
```

注意：修改了 `API_PORT` 后，客户端的市场 API 地址也必须改为对应端口。不要删除 `state.json`、`backend/storage` 或数据库中的牌组记录来解决启动问题。

正式环境维护前必须同时备份 PostgreSQL 数据库和 `HOST_STORAGE_DIR` 文件目录。数据库只保存牌组元数据、版本和文件路径，ZIP 和图片等文件本体保存在文件目录中；只备份其中一项可能造成记录存在但文件无法下载。

## 13. 当前客户端调用关系

Electron 客户端目前的主要调用流程：

```text
输入服务器密钥、账号、密码
        |
        v
POST /auth/login
        |
        v
保存 JWT 到当前运行内存
        |
        +--> GET /decks              公开牌组列表
        +--> GET /categories         已通过的公开分类
        +--> GET /decks/:id          牌组详情
        +--> GET /decks/:id/update    检查公开版本更新
        +--> GET /decks/:id/download  下载 ZIP 并导入本地卡片库
        +--> POST /my-decks           上传本地牌组
        +--> POST /my-decks/:id/versions 上传新版本
        |
        +--> 管理员：GET /admin/decks
                    PATCH /admin/decks/:id/publish|disable
                    PATCH /admin/decks/:id/versions/:version/publish|reject
                    GET/POST /admin/categories
                    PATCH/DELETE /admin/categories/:id
                    PATCH /admin/categories/:id/approve|reject
                    PATCH /admin/decks/:id/category
```

客户端的“记住密钥、账号和密码”由 Electron `safeStorage` 加密保存，不属于后端存储功能。后端只接收登录请求，不保存市场密钥副本。

## 14. 当前未实现或需要后续增强的功能

以下功能目前没有完整实现，文档不应把它们当作已有接口：

- 断点续传、分片上传和断点下载。
- 牌组删除接口和物理文件回收策略。
- 服务器端用户头像、昵称和个人资料接口。目前头像/昵称保存在 Electron 本地资料中。
- 牌组点赞、评论、收藏和举报。
- 细粒度管理员权限，例如审核员、超级管理员、只读管理员。
   - 管理后台更细粒度的日志筛选、导出和归档策略。当前已经提供 `GET /api/v1/admin/audit-logs`，支持分页、操作类型、用户、目标和时间范围筛选。
- 牌组包内每一张卡片的完整业务字段校验。
- 病毒扫描、内容审核和 ZIP 路径安全扫描。
- 对象存储（S3/OSS/COS）适配。目前使用本地或 Docker volume 文件存储。
- 反向代理、HTTPS、限流、登录失败锁定和更细的安全审计。
- 公开牌组的增量更新。当前客户端更新时下载完整的新版本 ZIP。

## 15. 文档变更记录

### 2026-07-21

- 增加 `DeckVersionStatus`：`PENDING`、`PUBLISHED`、`REJECTED`。
- 增加 `Deck.publishedVersion`，区分最新上传版本和当前公开版本。
- 新上传版本默认进入 `PENDING`，不会自动替换公开版本。
- 增加 `GET /api/v1/decks/:id/update` 更新检查接口。
- 增加管理员指定版本发布和拒绝接口。
- 公开列表、详情和下载接口改为只使用已发布版本。
- 增加 Prisma 迁移 `0002_version_review`。

- 增加版本 `manifest.changelog`，公开更新接口会返回最新已发布版本的版本说明。
- 普通用户重复新建同名牌组会被拒绝，已有牌组只能上传新版本。
- 增加 `MarketCategory` 和迁移 `0003_market_categories`，支持用户提交待审核分类、管理员创建/审核分类和调整牌组分类。
- 操作日志页面改为按服务端分页加载，不再固定只显示第一页。

- 市场列表和管理员用户/牌组审核增加服务端分页。
- 管理员新增操作日志和存储检查页面，修复异步切换页面时旧请求覆盖新页面的问题。

## Phase 2 batch 1 implementation notes

- Added ZIP archive path, entry count, per-entry size and total uncompressed size validation.
- Added in-memory rate limits for login, download and upload routes.
- Disabled decks now reject new version uploads.
- Downloads verify package availability before recording download history and disable client caching.

## Phase 2 batch 2 implementation notes

- Added paginated published-deck search with `page`, `pageSize`, keyword, category and sort parameters.
- Added `PATCH /api/v1/me/password` for authenticated password changes.
- Added administrator statistics, audit-log query, storage health and guarded temporary-file cleanup endpoints.
- Added administrator protections against disabling the current administrator or the last enabled administrator.
- Added administrator workspace cards for operational statistics, recent audit logs and storage checks.
- Permanent deletion now reports whether server-file cleanup is pending.
- Published-deck search uses database-level pagination instead of loading the entire market into memory.

## 16. 建议的上线检查

### 第二阶段第一批安全保护

已实现：

- 登录按 IP 和账号分别限流，默认 15 分钟最多 10 次。
- 下载按用户限流，默认每分钟最多 30 次，并禁止客户端缓存。
- 上传按用户限流，默认每小时最多 5 次。
- ZIP 禁止绝对路径、`..` 路径和重复路径，并限制目录项数量、单文件解压大小和总解压大小。
- 停用牌组不能继续上传新版本。
- 下载前检查服务器 ZIP 是否可读；文件缺失时返回 `503`，不会写入下载记录。
- 版本号查询限制为不超过 `1000000000`。

限流当前保存在单个 API 进程内存中。多实例生产环境应在反向代理或 Redis 层增加共享限流。

上线前至少确认：

1. `MARKET_ACCESS_KEY` 和 `JWT_SECRET` 使用随机长字符串，且没有提交到 Git。
2. `.env` 不进入仓库，生产环境使用独立密钥。
3. PostgreSQL 和 `STORAGE_DIR` 已配置持久化卷。
4. `/health`、登录、普通用户下载、管理员发布和管理员下架流程全部测试通过。
5. 下架牌组后，普通用户重新请求 `/api/v1/decks` 不再看到该牌组。
6. 牌组更新后，数据库 `DeckVersion` 和实际 ZIP 文件同时存在。
7. 定期备份 `market-db` 和 `market-storage`，并实际演练恢复。
8. 正式部署使用 HTTPS 或可信反向代理，不直接把开发端口暴露到公网。
