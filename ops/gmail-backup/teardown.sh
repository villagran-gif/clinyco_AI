#!/usr/bin/env bash
# teardown.sh <server-name-or-id>
# Borra la VM Hetzner creada por provision.sh.
# Solo acepta nombres que empiecen con "gyb-backup-" como safety.
set -euo pipefail

TARGET="${1:?uso: ./teardown.sh <nombre-o-id>   (ej: gyb-backup-villagran)}"
FORCE="${2:-}"

: "${HETZNER_TOKEN:?HETZNER_TOKEN no esta en env}"

if [[ "$TARGET" =~ ^[0-9]+$ ]]; then
  SID="$TARGET"
  SNAME=$(curl -sS -H "Authorization: Bearer $HETZNER_TOKEN" \
    "https://api.hetzner.cloud/v1/servers/$SID" | jq -r '.server.name // empty')
else
  SNAME="$TARGET"
  SID=$(curl -sS -H "Authorization: Bearer $HETZNER_TOKEN" \
    "https://api.hetzner.cloud/v1/servers?name=$SNAME" \
    | jq -r '.servers[0].id // empty')
fi

if [[ -z "${SID:-}" || "$SID" == "null" ]]; then
  echo "No se encontro servidor '$TARGET'"; exit 1
fi

echo "A borrar: name=$SNAME id=$SID"

if [[ "$SNAME" != gyb-backup-* ]]; then
  echo "REFUSANDO: solo borro servidores con nombre 'gyb-backup-*'."
  exit 1
fi

if [[ "$FORCE" != "--force" ]]; then
  read -r -p "Confirmar borrado de $SNAME (id=$SID)? [yes/NO] " ANS
  [[ "$ANS" == "yes" ]] || { echo "Cancelado"; exit 0; }
fi

RESP=$(curl -sS -X DELETE \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  "https://api.hetzner.cloud/v1/servers/$SID")

echo "$RESP" | jq .
