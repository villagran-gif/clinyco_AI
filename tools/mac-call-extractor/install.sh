#!/bin/bash
# Install the Mac Call Extractor as a LaunchAgent (runs every 5 min).
#
# Usage:
#   1. Generate an API key:  openssl rand -hex 32
#   2. Add it to Render env vars as MAC_CALLS_API_KEY
#   3. Edit the plist: replace REPLACE_WITH_API_KEY and REPLACE_WITH_FULL_PATH
#   4. Run:  bash install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/com.clinyco.call-extractor.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.clinyco.call-extractor.plist"

if [ ! -f "$PLIST_SRC" ]; then
  echo "Error: plist not found at $PLIST_SRC"
  exit 1
fi

# Auto-replace the path placeholder
sed "s|REPLACE_WITH_FULL_PATH|$SCRIPT_DIR/../..|g" "$PLIST_SRC" > "$PLIST_DST"

echo "Installed plist to $PLIST_DST"
echo ""
echo "IMPORTANT: Edit $PLIST_DST and replace REPLACE_WITH_API_KEY with your actual key."
echo ""
echo "Then load it:"
echo "  launchctl load $PLIST_DST"
echo ""
echo "To test immediately:"
echo "  python3 $SCRIPT_DIR/extract.py --dry-run"
