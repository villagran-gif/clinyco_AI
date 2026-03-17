#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/scripts/monitor-debug-events.sh"
"$ROOT_DIR/scripts/build-curated-examples-from-debug.sh"

echo "AI observability run complete."
