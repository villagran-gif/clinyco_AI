#!/usr/bin/env bash
# provision.sh <account-localpart>   (ej: villagran)
# Crea una VM Hetzner Cloud cpx22/nbg1/ubuntu-24.04 con cloud-init que instala
# GYB + rclone y prepara keypair StorageBox. NO ejecuta el backup.
#
# Requiere en env:
#   HETZNER_TOKEN, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY,
#   STORAGEBOX_USER (ej u581747)
# Opcionales:
#   STORAGEBOX_HOST (default <user>.your-storagebox.de)
#   GYB_DOMAIN (default clinyco.cl)
#   SERVER_TYPE (cpx22)  LOCATION (nbg1)  IMAGE (ubuntu-24.04)
#   SSH_KEY_ID (111054138)
#   DRY_RUN=1 para validar sin llamar API
set -euo pipefail

ACCOUNT="${1:?uso: ./provision.sh <account-localpart>  (ej: villagran)}"
DOMAIN="${GYB_DOMAIN:-clinyco.cl}"
SERVER_NAME="gyb-backup-${ACCOUNT}"
SERVER_TYPE="${SERVER_TYPE:-cpx22}"
LOCATION="${LOCATION:-nbg1}"
IMAGE="${IMAGE:-ubuntu-24.04}"
SSH_KEY_ID="${SSH_KEY_ID:-111054138}"

: "${HETZNER_TOKEN:?HETZNER_TOKEN no esta en env}"
: "${GOOGLE_SERVICE_ACCOUNT_EMAIL:?GOOGLE_SERVICE_ACCOUNT_EMAIL no esta en env}"
: "${GOOGLE_PRIVATE_KEY:?GOOGLE_PRIVATE_KEY no esta en env}"
: "${STORAGEBOX_USER:?exporta STORAGEBOX_USER (ej u581747)}"
STORAGEBOX_HOST="${STORAGEBOX_HOST:-${STORAGEBOX_USER}.your-storagebox.de}"
DOMAIN_ADMIN_EMAIL="${DOMAIN_ADMIN_EMAIL:-admin@${DOMAIN}}"

HERE="$(cd "$(dirname "$0")" && pwd)"
CLOUD_INIT_SRC="$HERE/cloud-init.yaml"
GYB_BACKUP_SRC="$HERE/scripts/gyb-backup.sh"
FIRST_BOOT_SRC="$HERE/scripts/first-boot.sh"

for f in "$CLOUD_INIT_SRC" "$GYB_BACKUP_SRC" "$FIRST_BOOT_SRC"; do
  [[ -f "$f" ]] || { echo "Falta $f"; exit 1; }
done

if [[ -z "${DRY_RUN:-}" ]]; then
  EXISTING=$(curl -sS -H "Authorization: Bearer $HETZNER_TOKEN" \
    "https://api.hetzner.cloud/v1/servers?name=${SERVER_NAME}" \
    | jq -r '.servers[0].id // empty')
  if [[ -n "$EXISTING" ]]; then
    echo "Ya existe servidor $SERVER_NAME (id=$EXISTING). Abortando."
    exit 1
  fi
fi

GPK_B64=$(printf '%s' "$GOOGLE_PRIVATE_KEY" | base64 -w0)
GYB_B64=$(base64 -w0 < "$GYB_BACKUP_SRC")
FB_B64=$(base64 -w0 < "$FIRST_BOOT_SRC")

export GPK_B64 GYB_B64 FB_B64
export ACCOUNTS_CSV="${ACCOUNT}@${DOMAIN}"
export STORAGEBOX_HOST DOMAIN_ADMIN_EMAIL

TMP_CI=$(mktemp)
trap 'rm -f "$TMP_CI"' EXIT

python3 - "$CLOUD_INIT_SRC" "$TMP_CI" <<'PY'
import os, sys, re
src, dst = sys.argv[1], sys.argv[2]
repl = {
    "__GOOGLE_SERVICE_ACCOUNT_EMAIL__": os.environ["GOOGLE_SERVICE_ACCOUNT_EMAIL"],
    "__GOOGLE_PRIVATE_KEY_B64__":       os.environ["GPK_B64"],
    "__ACCOUNTS_CSV__":                 os.environ["ACCOUNTS_CSV"],
    "__STORAGEBOX_USER__":              os.environ["STORAGEBOX_USER"],
    "__STORAGEBOX_HOST__":              os.environ["STORAGEBOX_HOST"],
    "__DOMAIN_ADMIN_EMAIL__":           os.environ["DOMAIN_ADMIN_EMAIL"],
    "__GYB_BACKUP_SH_B64__":            os.environ["GYB_B64"],
    "__FIRST_BOOT_SH_B64__":            os.environ["FB_B64"],
}
text = open(src).read()
for k, v in repl.items():
    text = text.replace(k, v)
leftover = re.findall(r"__[A-Z_]+__", text)
if leftover:
    sys.stderr.write(f"ERROR: placeholders no sustituidos: {leftover}\n")
    sys.exit(1)
open(dst, "w").write(text)
PY

if [[ -n "${DRY_RUN:-}" ]]; then
  SIZE=$(wc -c < "$TMP_CI")
  echo "DRY_RUN ok. size=$SIZE bytes (limite 32768)"
  (( SIZE > 32768 )) && echo "  WARN: excede limite"
  echo "  sections:"
  grep -E '^[a-z_]+:' "$TMP_CI" | sed 's/^/    /'
  echo "  write_files paths:"
  grep -E '^\s+- path:' "$TMP_CI" | sed 's/^/    /'
  echo "  runcmd entries: $(grep -cE '^\s+- \[' "$TMP_CI")"
  exit 0
fi

SIZE=$(wc -c < "$TMP_CI")
if (( SIZE > 32768 )); then
  echo "ERROR: cloud-init pesa ${SIZE}B (> 32 KB)."
  exit 1
fi

PAYLOAD=$(jq -n \
  --arg name "$SERVER_NAME" \
  --arg type "$SERVER_TYPE" \
  --arg loc "$LOCATION" \
  --arg img "$IMAGE" \
  --argjson key "$SSH_KEY_ID" \
  --rawfile ud "$TMP_CI" \
  '{name:$name, server_type:$type, location:$loc, image:$img,
    ssh_keys:[$key], user_data:$ud, start_after_create:true,
    labels:{purpose:"gmail-backup", account:$name}}')

echo "-> Creando $SERVER_NAME ($SERVER_TYPE @ $LOCATION)..."
RESP=$(curl -sS -X POST \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "https://api.hetzner.cloud/v1/servers")

if echo "$RESP" | jq -e '.error' >/dev/null 2>&1; then
  echo "ERROR al crear servidor:"
  echo "$RESP" | jq .
  exit 1
fi

SID=$(echo "$RESP" | jq -r '.server.id')
SIP=$(echo "$RESP" | jq -r '.server.public_net.ipv4.ip')

echo "Servidor creado: id=$SID  name=$SERVER_NAME  ip=$SIP"
echo ""
echo "Proximos pasos desde tu laptop:"
echo "  ssh root@$SIP 'cloud-init status --wait'"
echo "  ssh root@$SIP 'grep -A1 STORAGEBOX_PUBKEY_BEGIN /var/log/cloud-init-output.log'"
echo "  # pega esa pub en robot.hetzner.com -> Storage Box -> SSH keys"
echo "  ssh root@$SIP 'rclone lsd storagebox:'"
echo "  ssh root@$SIP 'systemctl start gyb-backup@${ACCOUNT}.service'"
echo "  ssh root@$SIP 'journalctl -u gyb-backup@${ACCOUNT} -f'"
echo ""
echo "Teardown: ./teardown.sh $SERVER_NAME"
