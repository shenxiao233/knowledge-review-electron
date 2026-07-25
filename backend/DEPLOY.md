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
# Ubuntu UFW
sudo ufw allow 4000/tcp

# 或 firewalld (CentOS/RHEL)
sudo firewall-cmd --permanent --add-port=4000/tcp
sudo firewall-cmd --reload
```

### 7. 客户端配置

在 Electron 应用中，打开 设置 → 服务器地址，填入：

```
http://your-server-ip:4000
```

以及对应的 `marketServerKey`（必须和 `.env.prod` 中的 `MARKET_ACCESS_KEY` 一致）。

## 可选：Nginx 反向代理 + HTTPS

生产环境建议用域名 + HTTPS。安装 Nginx 后配置：

```nginx
server {
    listen 80;
    server_name api.your-domain.com;

    # Certbot 会自动添加 443/SSL 配置
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

然后申请 Let's Encrypt 证书：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.your-domain.com
```

使用 Nginx 反向代理时，在 `.env.prod` 中设置 `TRUST_PROXY=true`，这样 rate limit 会使用真实客户端 IP。

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
