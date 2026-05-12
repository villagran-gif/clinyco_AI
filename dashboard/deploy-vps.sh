#!/bin/bash
# Deploy Medinet Dashboard to VPS Chile
# Run from local machine: bash dashboard/deploy-vps.sh
#
# Prerequisites:
#   - SSH access to VPS (69.6.226.132)
#   - Node.js 18+ on VPS

set -euo pipefail

VPS_HOST="${VPS_HOST:-69.6.226.132}"
VPS_USER="${VPS_USER:-root}"
VPS_DIR="${VPS_DIR:-/opt/clinyco-dashboard}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3001}"
DASHBOARD_PASS="${DASHBOARD_PASS:-}"

echo "==> Deploying Medinet Dashboard to ${VPS_USER}@${VPS_HOST}:${VPS_DIR}"

# Create directory structure on VPS
ssh "${VPS_USER}@${VPS_HOST}" "mkdir -p ${VPS_DIR}/public ${VPS_DIR}/data"

# Copy files
scp dashboard/medinet-dashboard-sync.cjs "${VPS_USER}@${VPS_HOST}:${VPS_DIR}/"
scp dashboard/medinet-dashboard-server.cjs "${VPS_USER}@${VPS_HOST}:${VPS_DIR}/"
scp dashboard/public/index.html "${VPS_USER}@${VPS_HOST}:${VPS_DIR}/public/"
scp dashboard/public/app.js "${VPS_USER}@${VPS_HOST}:${VPS_DIR}/public/"

echo "==> Files deployed. Setting up cron and systemd..."

# Create systemd service for the dashboard server
ssh "${VPS_USER}@${VPS_HOST}" "cat > /etc/systemd/system/clinyco-dashboard.service << 'UNIT'
[Unit]
Description=Clinyco Medinet Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=${VPS_DIR}
ExecStart=/usr/bin/node ${VPS_DIR}/medinet-dashboard-server.cjs
Restart=always
RestartSec=5
Environment=DASHBOARD_PORT=${DASHBOARD_PORT}
Environment=DASHBOARD_PASS=${DASHBOARD_PASS}
Environment=DASHBOARD_DATA_DIR=${VPS_DIR}/data

[Install]
WantedBy=multi-user.target
UNIT"

# Create cron job for sync every 15 minutes
ssh "${VPS_USER}@${VPS_HOST}" "(crontab -l 2>/dev/null | grep -v 'medinet-dashboard-sync' ; echo '*/15 * * * * cd ${VPS_DIR} && /usr/bin/node medinet-dashboard-sync.cjs >> /var/log/medinet-sync.log 2>&1') | crontab -"

# Enable and start services
ssh "${VPS_USER}@${VPS_HOST}" "systemctl daemon-reload && systemctl enable clinyco-dashboard && systemctl restart clinyco-dashboard"

# Run initial sync
ssh "${VPS_USER}@${VPS_HOST}" "cd ${VPS_DIR} && DASHBOARD_DATA_DIR=${VPS_DIR}/data /usr/bin/node medinet-dashboard-sync.cjs"

echo ""
echo "==> Dashboard deployed!"
echo "    URL: http://${VPS_HOST}:${DASHBOARD_PORT}"
echo "    Sync runs every 15 minutes via cron"
echo "    Logs: /var/log/medinet-sync.log"
echo "    Service: systemctl status clinyco-dashboard"
