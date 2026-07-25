#!/bin/bash
set -eu

# ═════════════════════════════════════════════════════
#  Notion Card 后端一键部署脚本
#  适用于 Ubuntu/Debian VPS
#  用法：SSH 登录服务器后执行 bash deploy.sh
# ═════════════════════════════════════════════════════

echo "🚀 开始部署 Notion Card 后端..."

# ─── 1. 安装 Docker ───
if ! command -v docker &> /dev/null; then
  echo "📦 正在安装 Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "✅ Docker 安装完成"
else
  echo "✅ Docker 已安装: $(docker --version)"
fi

# 确认 docker compose 可用
if ! docker compose version &> /dev/null; then
  echo "❌ docker compose 不可用，请手动安装 Docker Compose 插件"
  exit 1
fi

# ─── 2. 拉取代码 ───
APP_DIR="/opt/knowledge-review-electron"
if [ -d "$APP_DIR" ]; then
  echo "📂 已有代码目录，拉取最新..."
  cd "$APP_DIR" && git pull
else
  echo "📂 克隆代码仓库..."
  git clone https://github.com/shenxiao233/knowledge-review-electron.git "$APP_DIR"
  cd "$APP_DIR"
fi
cd backend

# ─── 3. 生成随机密钥 ───
echo "🔐 生成安全密钥..."
JWT_SECRET=$(openssl rand -hex 32)
MARKET_ACCESS_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | head -c 16)

# ─── 4. 创建 .env.prod ───
echo "📝 写入配置文件..."
cat > .env.prod << 'ENVEOF'
NODE_ENV=production
PORT=4000
HOST=0.0.0.0

POSTGRES_USER=market
POSTGRES_PASSWORD=__PG_PASS__
POSTGRES_DB=market

MARKET_ACCESS_KEY=__MARKET_KEY__
JWT_SECRET=__JWT_SECRET__

STORAGE_DIR=/app/storage
HOST_STORAGE_DIR=./storage
MAX_UPLOAD_MB=250
MAX_ARCHIVE_ENTRIES=10000
MAX_UNCOMPRESSED_MB=1024
MAX_ARCHIVE_ENTRY_MB=100

CORS_ORIGIN=*

LOGIN_RATE_LIMIT_MAX=60
LOGIN_RATE_LIMIT_WINDOW_SECONDS=900
REGISTER_RATE_LIMIT_MAX=20
REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600
DOWNLOAD_RATE_LIMIT_MAX=120
DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS=60
UPLOAD_RATE_LIMIT_MAX=20
UPLOAD_RATE_LIMIT_WINDOW_SECONDS=3600
PASSWORD_CHANGE_RATE_LIMIT_MAX=10
PASSWORD_CHANGE_RATE_LIMIT_WINDOW_SECONDS=3600
COLLAB_PUSH_RATE_LIMIT_MAX=30
COLLAB_PUSH_RATE_LIMIT_WINDOW_SECONDS=300
INVITATION_VALIDATE_RATE_LIMIT_MAX=30
INVITATION_VALIDATE_RATE_LIMIT_WINDOW_SECONDS=60

REDIS_URL=

ALLOW_SELF_REGISTER=true
DECK_CHANGE_TRACKING=false
AUDIT_RETENTION_DAYS=30
AUDIT_ARCHIVE_INTERVAL_HOURS=24

TRUST_PROXY=false
API_PORT=4000

ADMIN_USERNAME=admin
ADMIN_PASSWORD=__ADMIN_PASS__
ENVEOF

# 替换占位符
sed -i "s/__PG_PASS__/$POSTGRES_PASSWORD/g" .env.prod
sed -i "s/__MARKET_KEY__/$MARKET_ACCESS_KEY/g" .env.prod
sed -i "s/__JWT_SECRET__/$JWT_SECRET/g" .env.prod
sed -i "s/__ADMIN_PASS__/$ADMIN_PASSWORD/g" .env.prod

# ─── 5. 构建并启动 ───
echo "🏗️  构建并启动容器（首次约 3-5 分钟）..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# ─── 6. 等待服务就绪 ───
echo "⏳ 等待 API 服务就绪..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:4000/health > /dev/null 2>&1; then
    echo "✅ API 服务已就绪"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "⚠️  API 未在 60 秒内就绪，查看日志："
    docker compose -f docker-compose.prod.yml logs --tail=20 api
  fi
  sleep 2
done

# ─── 7. 创建管理员账号 ───
echo "👤 创建管理员账号..."
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
  --entrypoint node api dist/scripts/create-admin.js

# ─── 8. 防火墙 ───
if command -v ufw &> /dev/null; then
  ufw allow 4000/tcp 2>/dev/null || true
  echo "✅ 已开放防火墙 4000 端口"
fi

# ─── 9. 输出部署信息 ───
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "your-server-ip")

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ 部署完成！"
echo "═══════════════════════════════════════════════════"
echo ""
echo "📋 客户端配置信息（在 Electron 应用设置中填写）："
echo "   服务器地址: http://$SERVER_IP:4000"
echo "   市场密钥:   $MARKET_ACCESS_KEY"
echo ""
echo "🔑 管理员账号："
echo "   用户名: admin"
echo "   密码:   $ADMIN_PASSWORD"
echo ""
echo "📌 以上信息已保存到: $APP_DIR/backend/.env.prod"
echo ""
echo "🛠️  常用命令："
echo "   查看日志: docker compose -f docker-compose.prod.yml logs -f api"
echo "   重启服务: docker compose -f docker-compose.prod.yml restart api"
echo "   停止服务: docker compose -f docker-compose.prod.yml down"
echo "═══════════════════════════════════════════════════"
