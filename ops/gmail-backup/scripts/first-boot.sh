#!/usr/bin/env bash
# /opt/gyb-backup/first-boot.sh (ejecutado una sola vez por cloud-init)
# - Reconstruye Service Account JSON desde PEM + email
# - Instala GYB en /opt/gyb
# - Genera keypair SSH para StorageBox
# - Configura rclone para SFTP al StorageBox
# - Imprime la pub para pegarla en el panel
set -euo pipefail
source /etc/gyb/accounts.env

mkdir -p /data /var/log/gyb /root/.gyb /root/.config/rclone /etc/gyb /root/.ssh
chmod 700 /root/.ssh

echo "-> Installing GYB..."
if [ ! -d /opt/gyb ]; then
  git clone --depth 1 https://github.com/GAM-team/got-your-back.git /opt/gyb
fi
python3 -m venv /opt/gyb-venv
/opt/gyb-venv/bin/pip install --upgrade pip wheel
if [ -f /opt/gyb/requirements.txt ]; then
  /opt/gyb-venv/bin/pip install -r /opt/gyb/requirements.txt
else
  /opt/gyb-venv/bin/pip install google-auth google-auth-oauthlib google-api-python-client httplib2
fi

echo "-> Building Service Account JSON from PEM + email..."
python3 <<'PY'
import base64, json, os
pem = base64.b64decode(open('/etc/gyb/sa-privkey.pem.b64','rb').read()).decode()
env = {}
for line in open('/etc/gyb/accounts.env'):
    line = line.strip()
    if line.startswith('#') or '=' not in line:
        continue
    k, v = line.split('=', 1)
    env[k] = v.strip().strip('"')
email = env['SA_EMAIL']
project_id = email.split('@', 1)[1].split('.iam.', 1)[0]
sa = {
    "type": "service_account",
    "project_id": project_id,
    "private_key": pem,
    "client_email": email,
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
}
with open('/etc/gyb/sa.json', 'w') as f:
    json.dump(sa, f)
os.chmod('/etc/gyb/sa.json', 0o600)
print(f"sa.json ready for {email}")
PY

echo "-> Validating SA credentials parse..."
/opt/gyb-venv/bin/python3 -c "
from google.oauth2 import service_account
c = service_account.Credentials.from_service_account_file('/etc/gyb/sa.json')
print('OK:', c.service_account_email)
"

echo "-> Generating StorageBox SSH keypair..."
if [ ! -f /root/.ssh/storagebox_ed25519 ]; then
  ssh-keygen -t ed25519 -N "" -C "gyb-backup-vm@$(hostname)" -f /root/.ssh/storagebox_ed25519
fi

echo "-> Configuring rclone..."
cat > /root/.config/rclone/rclone.conf <<RCLONE
[storagebox]
type = sftp
host = ${STORAGEBOX_HOST}
user = ${STORAGEBOX_USER}
key_file = /root/.ssh/storagebox_ed25519
shell_type = unix
RCLONE
chmod 600 /root/.config/rclone/rclone.conf

echo "=========================================================="
echo "STORAGEBOX_PUBKEY_BEGIN"
cat /root/.ssh/storagebox_ed25519.pub
echo "STORAGEBOX_PUBKEY_END"
echo "-> Pega la linea anterior en: robot.hetzner.com -> Storage Box -> SSH keys"
echo "-> Verifica despues con: rclone lsd storagebox:"
echo "=========================================================="
