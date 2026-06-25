#!/usr/bin/env bash
# /opt/gyb-backup/gyb-backup.sh
# Loop de respaldo GYB a StorageBox, ano por ano (o mes por mes si CHUNK_GRANULARITY=month).
# Invocado desde systemd: systemctl start gyb-backup@villagran.service
set -euo pipefail

LOCALPART="${1:?uso: gyb-backup.sh <localpart>}"
source /etc/gyb/accounts.env

ACCOUNT=""
for a in ${ACCOUNTS//,/ }; do
  if [[ "${a%@*}" == "$LOCALPART" ]]; then ACCOUNT="$a"; break; fi
done
[[ -z "$ACCOUNT" ]] && { echo "ERROR: $LOCALPART no esta en ACCOUNTS=$ACCOUNTS"; exit 2; }

DATA_DIR="/data/gyb/${LOCALPART}"
REMOTE_DIR="storagebox:backups/${LOCALPART}"
STATE_FILE="/var/log/gyb/${LOCALPART}.state"
CHUNK_GRANULARITY="${CHUNK_GRANULARITY:-year}"
MAX_RETRIES="${MAX_RETRIES:-3}"

GYB="/opt/gyb-venv/bin/python3 /opt/gyb/gyb.py"
SA_FILE="/etc/gyb/sa.json"

mkdir -p "$DATA_DIR" "$(dirname "$STATE_FILE")"

log() { echo "[$(date -Iseconds)] $*"; }

run_gyb_chunk() {
  local chunk="$1"
  local local_path="$DATA_DIR/$chunk"
  local remote_path="$REMOTE_DIR/$chunk"

  local search
  if [[ "$chunk" == *"-"* ]]; then
    local y="${chunk%-*}" m="${chunk#*-}"
    local next_m=$((10#$m + 1)) next_y="$y"
    [[ $next_m -gt 12 ]] && { next_m=1; next_y=$((y+1)); }
    search="after:${y}/${m}/01 before:${next_y}/$(printf %02d $next_m)/01"
  else
    search="after:${chunk}/01/01 before:$((chunk+1))/01/01"
  fi

  log "Chunk $chunk -> GYB backup (query: $search)"
  mkdir -p "$local_path"

  local try=0
  while (( try < MAX_RETRIES )); do
    if $GYB --email "$ACCOUNT" --action backup --search "$search" \
        --local-folder "$local_path" --service-account "$SA_FILE" \
        --batch-size 50 --memory-limit 2048; then
      break
    fi
    try=$((try+1))
    log "GYB fallo (intento $try/$MAX_RETRIES), reintentando en 30s"
    sleep 30
  done
  (( try == MAX_RETRIES )) && { log "GYB agoto reintentos en chunk $chunk"; return 1; }

  if [[ -z "$(ls -A "$local_path" 2>/dev/null)" ]]; then
    log "Chunk $chunk vacio, nada que subir"
    rmdir "$local_path"
    return 0
  fi

  log "Chunk $chunk -> rclone sync a $remote_path"
  try=0
  while (( try < MAX_RETRIES )); do
    if rclone sync "$local_path" "$remote_path" \
        --transfers=8 --checkers=16 --sftp-set-modtime=false \
        --stats=60s --stats-one-line; then
      break
    fi
    try=$((try+1))
    log "rclone fallo (intento $try/$MAX_RETRIES), reintentando en 30s"
    sleep 30
  done
  (( try == MAX_RETRIES )) && { log "rclone agoto reintentos"; return 1; }

  local local_size remote_size
  local_size=$(du -sb "$local_path" | awk '{print $1}')
  remote_size=$(rclone size "$remote_path" --json | jq -r '.bytes')
  log "Chunk $chunk: local=$local_size remote=$remote_size"
  if (( local_size != remote_size )); then
    log "MISMATCH de tamano en chunk $chunk, no se borra local"
    return 1
  fi

  rm -rf "$local_path"
  echo "$chunk DONE $(date -Iseconds)" >> "$STATE_FILE"
  log "Chunk $chunk completado y limpiado localmente"
}

log "Estimando rango de anos para $ACCOUNT..."
START_YEAR="${START_YEAR:-2005}"
END_YEAR="${END_YEAR:-$(date +%Y)}"
log "Rango: $START_YEAR..$END_YEAR (granularidad=$CHUNK_GRANULARITY)"

FAILED_CHUNKS=()
for year in $(seq "$START_YEAR" "$END_YEAR"); do
  if grep -q "^${year} DONE" "$STATE_FILE" 2>/dev/null; then
    log "Chunk $year ya completado, skip"
    continue
  fi
  if [[ "$CHUNK_GRANULARITY" == "month" ]]; then
    for m in 01 02 03 04 05 06 07 08 09 10 11 12; do
      chunk="${year}-${m}"
      if grep -q "^${chunk} DONE" "$STATE_FILE" 2>/dev/null; then continue; fi
      if ! run_gyb_chunk "$chunk"; then FAILED_CHUNKS+=("$chunk"); fi
    done
  else
    if ! run_gyb_chunk "$year"; then FAILED_CHUNKS+=("$year"); fi
  fi
done

if (( ${#FAILED_CHUNKS[@]} > 0 )); then
  log "TERMINADO CON FALLAS: ${FAILED_CHUNKS[*]}"
  exit 1
fi

log "Backup completo para $ACCOUNT. Resumen:"
rclone size "$REMOTE_DIR" --json | jq .
