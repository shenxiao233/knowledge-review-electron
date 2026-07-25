# 后端部署指南

将 knowledge-review-market-api 部署到远程 VPS，使用 Docker Compose（含 PostgreSQL）。

## 前置条件

- VPS/云服务器，已安装 Docker 和 Docker Compose（`docker` + `docker compose` 命令可用）
- SSH 访问权限
- 一个开放端口供 API 使用（默认 4000）

如果 VPS 还没装 Docker，一行命令安装：

```bash
curl -fsSL https://get.docker.com | sh
```

## 部署步骤

### 1. SSH 登录服务器并拉取代码

```bash
ssh user@your-server-ip
sudo -i                          # 如果需要 root 权限
cd /opt
git clone https://github.com/shenxiao233/knowledge-review-electron.git
cd knowledge-review-electron/backend
```

如果仓库是私有的，可能需要先配置 SSH key 或使用 token。

### 2. 配置环境变量

```bash
cp .env.prod.example .env.prod
nano .env.prod                    # 或用 vim
```

**必须修改的项：**

| 变量 | 说明 |
|------|------|
| `POSTGRES_PASSWORD` | 数据库密码，设一个强密码 |
| `MARKET_ACCESS_KEY` | API 访问密钥，≥ 32 字符随机字符串。**客户端的 `marketServerKey` 必须与此值一致** |
| `JWT_SECRET` | JWT 签名密钥，≥ 32 字符随机字符串 |
| `ADMIN_USERNAME` | 管理员用户名 |
| `ADMIN_PASSWORD` | 管理员密码，≥ 12 字符 |

生成随机字符串的方法：

```bash
openssl rand -hex 32    # 生成 64 字符的十六进制字符串
```

### 3. 启动服务

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

首次构建需要几分钟（拉取镜像 + npm 安装 + 编译）。构建完成后容器会自动启动。Docker 内部流程：PostgreSQL 先启动 → 健康检查通过后 API 启动 → 自动执行 `prisma migrate deploy` 建表 → 启动 Fastify 服务。

### 4. 检查服务状态

```bash
# 查看容器状态（两个容器都应该 Up）
docker compose -f docker-compose.prod.yml ps

# 查看 API 日志
docker compose -f docker-compose.prod.yml logs -f api

# 健康检查
curl http://127.0.0.1:4000/health
# 应返回 {"status":"ok",...}
```

### 5. 创建管理员账号

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
  --entrypoint node api dist/scripts/create-admin.js
```

这会读取 `.env.prod` 中的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 创建管理员。可以重复运行，会 upsert（存在则更新密码）。

### 6. 防火墙放行端口

```bash
# Ubuntu UFW — 开放 Nginx 端口（HTTP + HTTPS）
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 如果不使用 Nginx，直接暴露 API 端口：
# sudo ufw allow 4000/tcp
```

### 7. 客户端配置

在 Electron 应用中，打开 设置 → 服务器地址，填入：

```
http://your-server-ip:4000
```

以及对应的 `marketServerKey`（必须和 `.env.prod` 中的 `MARKET_ACCESS_KEY` 一致）。

## Nginx 反向代理 + HTTPS（推荐）

仓库已包含针对 1 vCore / 2GB VPS 调优的 Nginx 配置和 PostgreSQL 参数。生产环境建议使用 Nginx 作为反向代理，原因如下：

- **TLS 终结**：Nginx 处理 HTTPS 加解密，释放 Node.js 的 CPU
- **请求缓冲**：250MB 上传时 Nginx 先接收完整请求体再转发后端，慢客户端不占用 Node.js 事件循环
- **超时控制**：防止慢客户端长时间挂住连接
- **gzip 压缩**：与 Fastify 的压缩互补
- **安全**：隐藏 Node.js 直接暴露的端口

### 1. 安装 Nginx 并部署配置

```bash
sudo apt update && sudo apt install -y nginx

# 部署仓库内的配置文件
sudo cp nginx/nginx.conf /etc/nginx/sites-available/market-api
sudo ln -s /etc/nginx/sites-available/market-api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 创建 certbot 挑战目录（用于 Let's Encrypt）
sudo mkdir -p /var/www/certbot

# 测试配置并重载
sudo nginx -t && sudo systemctl reload nginx
```

### 2. 申请 HTTPS 证书

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.your-domain.com
```

Certbot 会自动修改 Nginx 配置添加 443/SSL 并设置自动续期。

### 3. 设置 TRUST_PROXY

在 `.env.prod` 中确保：

```bash
TRUST_PROXY=true
```

这样 Fastify 会从 `X-Forwarded-For` 读取真实客户端 IP，rate limiting 才能正常工作。

### 4. 重启服务

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod restart api
```

### 5. 客户端配置

在 Electron 应用中，打开 设置 → 服务器地址，填入：

```
https://api.your-domain.com
```

以及对应的 `marketServerKey`（必须和 `.env.prod` 中的 `MARKET_ACCESS_KEY` 一致）。

## PostgreSQL 调优 & Prisma 连接池

仓库已包含针对 2GB VPS 调优的 PostgreSQL 配置（`postgres/postgresql.conf`），通过 `docker-compose.prod.yml` 自动挂载，无需手动操作。

| 参数 | 值 | 说明 |
|------|-----|------|
| `max_connections` | 50 | 1 个 API 进程 + 迁移 + 管理查询 |
| `shared_buffers` | 256MB | ~12.5% 总内存 |
| `effective_cache_size` | 512MB | 提示查询规划器可用缓存 |
| `work_mem` | 2MB | 每连接排序内存 |

Prisma 连接池已通过 `DATABASE_URL` 中的 `connection_limit=8&pool_timeout=20` 参数控制。在 1 vCore 机器上，Prisma 默认只开 3 个连接（`CPU × 2 + 1`），8 个连接能更好处理并发请求，同时 50 个 PG max_connections 留有充裕余量。

### 内存分配概览（2GB VPS）

```
PostgreSQL:  ~350MB  (shared_buffers 256MB + work_mem × conns + overhead)
Node.js API: ~250MB
Nginx:       ~20MB
OS + 缓存:   ~400MB
剩余:        ~980MB  (OS page cache 补充数据库缓存)
```

## 常用运维命令

```bash
# 查看日志
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f postgres

# 重启 API
docker compose -f docker-compose.prod.yml restart api

# 停止所有服务
docker compose -f docker-compose.prod.yml down

# 停止并删除数据卷（⚠️ 会删除所有数据）
docker compose -f docker-compose.prod.yml down -v

# 更新代码后重新部署
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

## 数据备份

```bash
# 备份数据库
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U market market > backup_$(date +%Y%m%d).sql

# 备份存储文件（卡组 ZIP 等）
tar -czf storage_backup_$(date +%Y%m%d).tar.gz ./storage
```
