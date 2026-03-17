#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="${CLINYCO_REPORT_DIR:-$ROOT_DIR/reports/ai-monitor}"
DEBUG_BASE_URL="${CLINYCO_DEBUG_BASE_URL:-https://clinyco-ai.onrender.com}"
DEBUG_KEY="${CLINYCO_DEBUG_KEY:-${DEBUG_DASHBOARD_KEY:-}}"
GOOD_LIMIT="${CLINYCO_EVAL_GOOD_LIMIT:-6}"
BAD_LIMIT="${CLINYCO_EVAL_BAD_LIMIT:-6}"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
STAMP_FILE_TS="$(date -u +"%Y%m%dT%H%M%SZ")"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

if [[ -z "$DEBUG_KEY" ]]; then
  echo "Missing CLINYCO_DEBUG_KEY or DEBUG_DASHBOARD_KEY" >&2
  exit 1
fi

mkdir -p "$REPORT_DIR/evals"

RAW_JSON="$REPORT_DIR/latest-events.json"
if [[ ! -f "$RAW_JSON" ]]; then
  "$ROOT_DIR/scripts/monitor-debug-events.sh"
fi

LATEST_JSON="$REPORT_DIR/evals/curated-examples-latest.json"
STAMPED_JSON="$REPORT_DIR/evals/curated-examples-${STAMP_FILE_TS}.json"
LATEST_MD="$REPORT_DIR/evals/curated-examples-latest.md"
STAMPED_MD="$REPORT_DIR/evals/curated-examples-${STAMP_FILE_TS}.md"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

good_candidates() {
  jq -r '
    .events[]
    | select(((.stage == "resolver:derive_or_send_web") or (.next_action == "derive_or_send_web") or (.stage == "ready_for_handoff")) and ((.bot_reply // "") | length > 0))
    | [.conversation_id, "good", (.channel // "any"), (.stage // "general_guidance")]
    | @tsv
  ' "$RAW_JSON" | awk -F '\t' '!seen[$1]++'
}

bad_candidates() {
  jq -r '
    def contact: (.known_data.contactDraft // {});
    def full_name:
      [contact.c_nombres, contact.c_apellidos]
      | map(select(. != null and . != ""))
      | join(" ");
    def suspicious_name:
      (full_name | test("(^| )(DE|DEL|DESDE|HOLA|QUIERO|NECESITO|SOY|EN|PARA|Y)( |$)"; "i"))
      or (full_name | test("ANTOFAGASTA|SANTIAGO|CALAMA|COTIZ|HORA|DOCTOR|MEDICO|CIRUGIA|OPERACION"; "i"))
      or ((.user_name // "") | test("^De .+ Y .+$"; "i"));
    def asks_known_identity:
      (((.bot_reply // "") | test("telefono|teléfono|numero de telefono|número de teléfono"; "i")) and (contact.c_tel1 != null))
      or (((.bot_reply // "") | test("correo|email|mail"; "i")) and (contact.c_email != null))
      or (((.bot_reply // "") | test("rut"; "i")) and (contact.c_rut != null));
    .events[]
    | select((.stage == "handoff:human_business_message_detected" and ((.user_text // "") | length > 0)) or suspicious_name or asks_known_identity)
    | [.conversation_id, "bad", (.channel // "any"), (.stage // "general_guidance")]
    | @tsv
  ' "$RAW_JSON" | awk -F '\t' '!seen[$1]++'
}

{
  good_candidates | head -n "$GOOD_LIMIT"
  bad_candidates | head -n "$BAD_LIMIT"
} > "$TMP_DIR/candidates.tsv"

while IFS=$'\t' read -r conversation_id outcome channel stage; do
  [[ -n "$conversation_id" ]] || continue
  response_file="$TMP_DIR/${conversation_id}.json"
  curl -fsS "${DEBUG_BASE_URL%/}/debug/conversation/${conversation_id}?key=${DEBUG_KEY}" > "$response_file"
  jq \
    --arg exampleId "${outcome}:${conversation_id}" \
    --arg channel "$channel" \
    --arg stage "$stage" \
    --arg outcome "$outcome" \
    --arg generatedAt "$TIMESTAMP" '
      {
        exampleId: $exampleId,
        channel: $channel,
        intent: "live_debug_review",
        stage: $stage,
        outcome: $outcome,
        qualityScore: (if $outcome == "good" then 0.95 else 0.2 end),
        generatedAt: $generatedAt,
        messages: (
          (.events // [])
          | map(
              [
                (if (.user_text // "") != "" then {
                  role: "user",
                  content: .user_text,
                  stage: (.stage // null),
                  createdAt: (.created_at // null)
                } else empty end),
                (if (.bot_reply // "") != "" then {
                  role: "assistant",
                  content: .bot_reply,
                  stage: (.stage // null),
                  createdAt: (.created_at // null)
                } else empty end)
              ]
            )
          | flatten
        )
      }
    ' "$response_file" > "$TMP_DIR/${conversation_id}.example.json"
done < "$TMP_DIR/candidates.tsv"

if compgen -G "$TMP_DIR/*.example.json" >/dev/null; then
  jq -s '.' "$TMP_DIR"/*.example.json > "$LATEST_JSON"
else
  echo '[]' > "$LATEST_JSON"
fi

cp "$LATEST_JSON" "$STAMPED_JSON"

{
  echo "# Curated Examples From Debug"
  echo
  echo "- Generated at: $TIMESTAMP"
  echo "- Total examples: $(jq 'length' "$LATEST_JSON")"
  echo "- Good examples: $(jq '[.[] | select(.outcome == "good")] | length' "$LATEST_JSON")"
  echo "- Bad examples: $(jq '[.[] | select(.outcome == "bad")] | length' "$LATEST_JSON")"
  echo
  echo "## Example IDs"
  jq -r '.[] | "- \(.exampleId) | outcome=\(.outcome) | stage=\(.stage) | messages=\(.messages | length)"' "$LATEST_JSON"
} > "$LATEST_MD"

cp "$LATEST_MD" "$STAMPED_MD"

echo "Wrote:"
echo "  $LATEST_JSON"
echo "  $LATEST_MD"
