#!/bin/bash
# Deploy Clinyco VPS API + Dashboard Sync to VPS Chile
# Run from project root: bash dashboard/deploy-vps.sh
#
# Prerequisites:
#   - SSH access to VPS (69.6.226.132)
#   - Node.js 18+ on VPS
#   - Playwright + Chromium installed on VPS (for search/book)
#
# Architecture:
#   VPS:3002  — Unified API (dashboard slots + Medinet gateway for Render)
#   Cron      — Sync job every 15 min (dashboard-slots.json)
#   Netlify   — Static frontend at clinyco-ai.netlify.app

set -euo pipefail

VPS_HOST="${VPS_HOST:-69.6.226.132}"
VPS_USER="${VPS_USER:-root}"
VPS_DIR="${VPS_DIR:-/opt/clinyco}"
API_PORT="${API_PORT:-3002}"
API_KEY="${API_KEY:-}"

echo "==> Deploying Clinyco VPS API to ${VPS_USER}@${VPS_HOST}:${VPS_DIR}"

# Create directory structure on VPS
ssh "${VPS_USER}@${VPS_HOST}" "mkdir -p ${VPS_DIR}/Antonia ${VPS_DIR}/dashboard/data"

# Copy API server + sync + Antonia script
scp dashboard/medinet-api-server.cjs "${VPS_USER}@${VPS_HOST}:${VPS_DIR}/dashboard/"
scp dashboard/medinet-dashboard-sync.cjs "${VPS_USER}@${VPS_HOST}:${VPS_DIR}/dashboard/"
scp Antonia/medinet-antonia.cjs "${VPS_USER}@${VPS_HOST}:${VPS_DIR}/Antonia/"

echo "==> Files deployed. Setting up systemd + cron..."

# Create systemd service for the unified API server
ssh "${VPS_USER}@${VPS_HOST}" "cat > /etc/systemd/system/clinyco-api.service << 'UNIT'
[Unit]
Description=Clinyco VPS API (Medinet Gateway + Dashboard)
After=network.target

[Service]
Type=simple
WorkingDirectory=${VPS_DIR}/dashboard
ExecStart=/usr/bin/node ${VPS_DIR}/dashboard/medinet-api-server.cjs
Restart=always
RestartSec=5
Environment=API_PORT=${API_PORT}
Environment=API_KEY=${API_KEY}
Environment=DASHBOARD_DATA_DIR=${VPS_DIR}/dashboard/data
Environment=CORS_ORIGINS=https://clinyco-ai.netlify.app
Environment=MEDINET_RUT=13580388k

[Install]
WantedBy=multi-user.target
UNIT"

# Create cron job for sync every 15 minutes
ssh "${VPS_USER}@${VPS_HOST}" "(crontab -l 2>/dev/null | grep -v 'medinet-dashboard-sync' ; echo '*/15 * * * * cd ${VPS_DIR}/dashboard && DASHBOARD_DATA_DIR=${VPS_DIR}/dashboard/data /usr/bin/node medinet-dashboard-sync.cjs >> /var/log/medinet-sync.log 2>&1') | crontab -"

# Enable and start service
ssh "${VPS_USER}@${VPS_HOST}" "systemctl daemon-reload && systemctl enable clinyco-api && systemctl restart clinyco-api"

# Run initial sync
echo "==> Running initial sync..."
ssh "${VPS_USER}@${VPS_HOST}" "cd ${VPS_DIR}/dashboard && DASHBOARD_DATA_DIR=${VPS_DIR}/dashboard/data /usr/bin/node medinet-dashboard-sync.cjs" || echo "    (sync failed — check manually)"

echo ""
echo "==> Deployment complete!"
echo ""
echo "    VPS API:      http://${VPS_HOST}:${API_PORT}"
echo "    Dashboard:    https://clinyco-ai.netlify.app"
echo "    Health check: curl http://${VPS_HOST}:${API_PORT}/health"
echo "    Slots API:    curl http://${VPS_HOST}:${API_PORT}/api/slots"
echo ""
echo "    Sync cron:    every 15 min"
echo "    Sync logs:    /var/log/medinet-sync.log"
echo "    Service:      systemctl status clinyco-api"
echo ""
echo "    Render env vars to set:"
echo "      MEDINET_VPS_URL=http://${VPS_HOST}:${API_PORT}"
echo "      MEDINET_VPS_API_KEY=${API_KEY}"
