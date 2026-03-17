#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="${CLINYCO_REPORT_DIR:-$ROOT_DIR/reports/ai-monitor}"
DEBUG_BASE_URL="${CLINYCO_DEBUG_BASE_URL:-https://clinyco-ai.onrender.com}"
DEBUG_KEY="${CLINYCO_DEBUG_KEY:-${DEBUG_DASHBOARD_KEY:-}}"
EVENT_LIMIT="${CLINYCO_DEBUG_LIMIT:-200}"
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

mkdir -p "$REPORT_DIR"

EVENTS_URL="${DEBUG_BASE_URL%/}/debug/events?key=${DEBUG_KEY}&limit=${EVENT_LIMIT}"
RAW_JSON="$REPORT_DIR/latest-events.json"
STAMPED_JSON="$REPORT_DIR/events-${STAMP_FILE_TS}.json"
SUMMARY_JSON="$REPORT_DIR/latest-summary.json"
STAMPED_SUMMARY_JSON="$REPORT_DIR/summary-${STAMP_FILE_TS}.json"
SUMMARY_MD="$REPORT_DIR/latest-summary.md"
STAMPED_SUMMARY_MD="$REPORT_DIR/summary-${STAMP_FILE_TS}.md"

curl -fsS "$EVENTS_URL" > "$RAW_JSON"
cp "$RAW_JSON" "$STAMPED_JSON"

jq --arg generatedAt "$TIMESTAMP" --arg source "$EVENTS_URL" '
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
  def suspicious_handoff:
    (.stage == "handoff:human_business_message_detected" and ((.user_text // "") | length > 0));
  def stuck_complete_missing:
    ((.stage == "resolver:complete_missing" or .next_action == "complete_missing")
      and ((contact.c_tel1 != null) or (contact.c_email != null) or (contact.c_rut != null))
      and ((.bot_reply // "") | length > 0));
  {
    generated_at: $generatedAt,
    source: $source,
    total_events: (.events | length),
    stage_counts: (
      .events
      | map(.stage // "unknown")
      | sort
      | group_by(.)
      | map({ stage: .[0], count: length })
      | sort_by(-.count, .stage)
    ),
    anomaly_counts: {
      suspicious_name: ([.events[] | select(suspicious_name)] | length),
      human_handoff_false_positive: ([.events[] | select(suspicious_handoff)] | length),
      asks_known_identity: ([.events[] | select(asks_known_identity)] | length),
      stuck_complete_missing: ([.events[] | select(stuck_complete_missing)] | length)
    },
    anomalies: {
      suspicious_name: (
        [.events[] | select(suspicious_name)
        | {
            id,
            created_at,
            conversation_id,
            user_name,
            user_text,
            stage,
            next_action,
            known_contact: contact
          }] | .[:8]
      ),
      human_handoff_false_positive: (
        [.events[] | select(suspicious_handoff)
        | {
            id,
            created_at,
            conversation_id,
            user_name,
            user_text,
            stage,
            next_action
          }] | .[:8]
      ),
      asks_known_identity: (
        [.events[] | select(asks_known_identity)
        | {
            id,
            created_at,
            conversation_id,
            user_name,
            user_text,
            bot_reply,
            stage,
            next_action,
            known_contact: contact
          }] | .[:8]
      ),
      stuck_complete_missing: (
        [.events[] | select(stuck_complete_missing)
        | {
            id,
            created_at,
            conversation_id,
            user_name,
            user_text,
            bot_reply,
            stage,
            next_action,
            known_contact: contact
          }] | .[:8]
      )
    }
  }
' "$RAW_JSON" > "$SUMMARY_JSON"

cp "$SUMMARY_JSON" "$STAMPED_SUMMARY_JSON"

{
  echo "# Clinyco AI Monitor"
  echo
  echo "- Generated at: $(jq -r '.generated_at' "$SUMMARY_JSON")"
  echo "- Events analyzed: $(jq -r '.total_events' "$SUMMARY_JSON")"
  echo "- Source: $(jq -r '.source' "$SUMMARY_JSON")"
  echo
  echo "## Stage counts"
  jq -r '.stage_counts[] | "- \(.stage): \(.count)"' "$SUMMARY_JSON"
  echo
  echo "## Alerts"
  echo "- suspicious_name: $(jq -r '.anomaly_counts.suspicious_name' "$SUMMARY_JSON")"
  echo "- human_handoff_false_positive: $(jq -r '.anomaly_counts.human_handoff_false_positive' "$SUMMARY_JSON")"
  echo "- asks_known_identity: $(jq -r '.anomaly_counts.asks_known_identity' "$SUMMARY_JSON")"
  echo "- stuck_complete_missing: $(jq -r '.anomaly_counts.stuck_complete_missing' "$SUMMARY_JSON")"

  for key in suspicious_name human_handoff_false_positive asks_known_identity stuck_complete_missing; do
    echo
    echo "## $key"
    count="$(jq -r ".anomaly_counts.${key}" "$SUMMARY_JSON")"
    if [[ "$count" == "0" ]]; then
      echo "- No anomalies detected."
      continue
    fi
    jq -r --arg key "$key" '
      .anomalies[$key][]
      | "- [\(.id)] \(.created_at) | conv=\(.conversation_id // "-") | user=\(.user_name // "-") | stage=\(.stage // "-") | next=\(.next_action // "-") | user_text=\((.user_text // "") | gsub("[\\r\\n]+"; " ") | .[0:140]) | bot_reply=\((.bot_reply // "") | gsub("[\\r\\n]+"; " ") | .[0:160])"
    ' "$SUMMARY_JSON"
  done
} > "$SUMMARY_MD"

cp "$SUMMARY_MD" "$STAMPED_SUMMARY_MD"

echo "Wrote:"
echo "  $RAW_JSON"
echo "  $SUMMARY_JSON"
echo "  $SUMMARY_MD"
