#!/bin/bash
# FieldGovern VPS Bootstrap — Ubuntu 22.04 / 24.04 LTS
# Works on: DigitalOcean, Hetzner, Oracle Cloud, Vultr, AWS EC2, any Ubuntu VPS
# Supports both AMD64 and ARM64 (Oracle Cloud Ampere A1 free tier)
#
# Run once as root on a fresh server:
#   curl -sL https://raw.githubusercontent.com/apranjipavan2-spec/DataCollectTool/main/deploy/server-setup.sh | bash
set -euo pipefail

DOMAIN="app.fieldgovern.com"
APP_DIR="/opt/fieldgovern"
DEPLOY_USER="fieldgovern"

echo "=== 1. System update ==="
apt-get update && apt-get upgrade -y

echo "=== 2. Install Docker ==="
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "=== 3. Install certbot ==="
apt-get install -y certbot

echo "=== 4. Firewall ==="
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "=== 5. Create deploy user ==="
id -u "$DEPLOY_USER" &>/dev/null || useradd -m -s /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"

echo "=== 6. Create app directory ==="
mkdir -p "$APP_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

echo "=== 7. Copy deploy files ==="
cp docker-compose.prod.yml "$APP_DIR/docker-compose.yml"
cp nginx.conf "$APP_DIR/nginx.conf"
cp backup-db.sh "$APP_DIR/backup-db.sh"
chmod +x "$APP_DIR/backup-db.sh"

echo "=== 8. Create .env (FILL IN VALUES BEFORE STARTING) ==="
cat > "$APP_DIR/.env" << 'ENVEOF'
# PostgreSQL
POSTGRES_USER=fieldgovern
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD
POSTGRES_DB=fieldgovern

# App
DATABASE_URL=postgresql+psycopg2://fieldgovern:CHANGE_ME_STRONG_PASSWORD@postgres:5432/fieldgovern
JWT_SECRET=CHANGE_ME_MIN_32_CHARS_RANDOM_STRING
REDIS_URL=redis://localhost:6379
CORS_ORIGINS=https://app.fieldgovern.com,http://localhost:5173
STORAGE_BACKEND=local
APP_URL=https://app.fieldgovern.com

# SMTP (optional — for digest emails)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=noreply@fieldgovern.app
ENVEOF
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

echo ""
echo "=== 9. Get SSL certificate ==="
echo "    Starting temporary HTTP server for ACME challenge..."
certbot certonly --standalone \
  --non-interactive \
  --agree-tos \
  --email pallavi@dataworx.co.in \
  -d "$DOMAIN"

echo "=== 10. Auto-renew SSL via cron ==="
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --deploy-hook 'cd $APP_DIR && docker compose restart nginx'") | crontab -

echo "=== 11. Daily DB backup at 2 AM ==="
(crontab -l 2>/dev/null; echo "0 2 * * * $APP_DIR/backup-db.sh >> /var/log/fieldgovern-backup.log 2>&1") | crontab -

echo ""
echo "======================================================"
echo "  Bootstrap complete!"
echo "======================================================"
echo ""
echo "NEXT STEPS:"
echo "  1. Edit $APP_DIR/.env — set real passwords + JWT_SECRET"
echo "  2. Add GitHub Actions secrets (see deploy-app.yml comments)"
echo "  3. Push to main — GitHub Actions will build + deploy"
echo ""
echo "  Manual first deploy:"
echo "    cd $APP_DIR"
echo "    docker login ghcr.io -u YOUR_GITHUB_USERNAME --password YOUR_PAT"
echo "    docker compose pull && docker compose up -d"
echo ""
