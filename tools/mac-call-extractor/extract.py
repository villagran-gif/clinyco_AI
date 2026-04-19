#!/usr/bin/env python3
"""
Mac WhatsApp Desktop Call Extractor

Reads call history from WhatsApp Desktop's local SQLite databases,
resolves LIDs to real phone numbers via the contacts DB, and POSTs
new calls to the Clinyco server for "best time to call" analytics.

Databases read (unencrypted):
  ~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/CallHistory.sqlite
  ~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ContactsV2.sqlite

Auth: Bearer token via MAC_CALL_IMPORT_SECRET env var.
"""

import sqlite3
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

APPLE_EPOCH_OFFSET = 978307200  # seconds between 1970-01-01 and 2001-01-01

# Candidate group containers for WhatsApp (personal) and WhatsApp Business.
# We probe each in order and use the first one that has CallHistory.sqlite.
CANDIDATE_CONTAINERS = [
    "group.net.whatsapp.WhatsApp.shared",       # Personal WhatsApp (Mac App Store + direct)
    "group.net.whatsapp.WhatsAppSMB.shared",    # WhatsApp Business (likely)
    "group.net.whatsapp.WhatsAppBusiness.shared",
    "group.net.whatsapp.family",                # Some newer builds
]

STATE_FILE = Path.home() / ".clinyco-call-extractor.ts"


def find_wa_databases():
    """Return (call_db, contacts_db, which_app) for the first container that exists.

    Also tries a glob fallback so we catch any container we haven't seen yet.
    """
    base = Path.home() / "Library/Group Containers"

    for name in CANDIDATE_CONTAINERS:
        container = base / name
        call_db = container / "CallHistory.sqlite"
        contacts_db = container / "ContactsV2.sqlite"
        if call_db.exists() and contacts_db.exists():
            label = "business" if "SMB" in name or "Business" in name else "personal"
            return call_db, contacts_db, f"{label} ({name})"

    # Fallback: glob ALL whatsapp-related containers
    matches = list(base.glob("*whatsapp*"))
    for container in matches:
        call_db = container / "CallHistory.sqlite"
        contacts_db = container / "ContactsV2.sqlite"
        if call_db.exists() and contacts_db.exists():
            return call_db, contacts_db, f"detected ({container.name})"

    return None, None, None


def cmd_discover():
    """Print all WhatsApp-related SQLite files on this Mac."""
    base = Path.home() / "Library/Group Containers"
    print(f"[discover] Scanning {base}")
    if not base.exists():
        print(f"[discover] Directory does not exist: {base}")
        return
    matches = list(base.glob("*whatsapp*"))
    if not matches:
        print("[discover] No WhatsApp containers found.")
        print("[discover] Is WhatsApp (or WhatsApp Business) installed?")
        return
    for container in matches:
        print(f"\n[discover] Container: {container.name}")
        sqlite_files = list(container.glob("*.sqlite"))
        if not sqlite_files:
            print("  (no .sqlite files)")
            continue
        for f in sqlite_files:
            size_kb = f.stat().st_size // 1024
            print(f"  {f.name}  ({size_kb} KB)")

API_URL = os.environ.get("MAC_CALLS_API_URL", "https://clinyco-ai.onrender.com/api/review/mac-calls-import")
API_KEY = os.environ.get("MAC_CALL_IMPORT_SECRET", "")

AGENT_PHONE = os.environ.get("MAC_AGENT_PHONE", "")


def load_last_timestamp():
    if STATE_FILE.exists():
        try:
            return float(STATE_FILE.read_text().strip())
        except ValueError:
            pass
    return 0.0


def save_last_timestamp(ts):
    STATE_FILE.write_text(str(ts))


def extract_calls(since_apple_ts=0.0):
    """Extract calls from CallHistory.sqlite joined with ContactsV2.sqlite."""
    call_db, contacts_db, which = find_wa_databases()
    if not call_db:
        print("[extract] No WhatsApp databases found.")
        print("[extract] Run with --discover to see what's on this Mac.")
        return []

    print(f"[extract] Using {which}")
    print(f"[extract]   calls:    {call_db}")
    print(f"[extract]   contacts: {contacts_db}")

    conn = sqlite3.connect(str(call_db))
    conn.execute(f"ATTACH '{contacts_db}' AS co")

    query = """
    SELECT
      a.Z_PK              AS aggregate_pk,
      a.ZFIRSTDATE         AS apple_ts,
      a.ZINCOMING          AS is_incoming,
      a.ZMISSED            AS is_missed,
      a.ZVIDEO             AS is_video,
      e.ZDURATION          AS duration_s,
      e.ZCALLIDSTRING      AS call_id,
      p.ZJIDSTRING         AS peer_lid,
      c.ZPHONENUMBER       AS real_phone,
      c.ZFULLNAME          AS contact_name,
      c.ZWHATSAPPID        AS whatsapp_id
    FROM ZWAAGGREGATECALLEVENT a
    LEFT JOIN ZWACDCALLEVENT e            ON e.Z1CALLEVENTS  = a.Z_PK
    LEFT JOIN ZWACDCALLEVENTPARTICIPANT p ON p.Z1PARTICIPANTS = e.Z_PK
    LEFT JOIN co.ZWAADDRESSBOOKCONTACT c  ON c.ZLID = p.ZJIDSTRING
    WHERE a.ZFIRSTDATE > ?
    ORDER BY a.ZFIRSTDATE ASC
    """

    rows = conn.execute(query, (since_apple_ts,)).fetchall()
    conn.close()

    calls = []
    for row in rows:
        (aggregate_pk, apple_ts, is_incoming, is_missed, is_video,
         duration_s, call_id, peer_lid, real_phone, contact_name, whatsapp_id) = row

        unix_ts = apple_ts + APPLE_EPOCH_OFFSET
        dt = datetime.fromtimestamp(unix_ts, tz=timezone.utc)

        direction = "client_to_agent" if is_incoming else "agent_to_client"

        if is_missed:
            status = "missed"
        elif duration_s and duration_s > 0:
            status = "ended"
        else:
            status = "rejected"

        phone = real_phone or ""
        if phone and not phone.startswith("+"):
            phone = f"+{phone}"

        lid = peer_lid or ""
        if lid and "@" in lid:
            lid = lid.split("@")[0]

        stable_call_id = call_id or f"mac-{aggregate_pk}-{int(unix_ts)}"

        calls.append({
            "call_id": stable_call_id,
            "direction": direction,
            "client_phone": phone,
            "client_lid": lid,
            "contact_name": contact_name or "",
            "is_video": bool(is_video),
            "is_missed": bool(is_missed),
            "duration_seconds": int(duration_s) if duration_s else 0,
            "status": status,
            "received_at": dt.isoformat(),
            "hour_of_day": dt.hour,
            "day_of_week": (dt.weekday() + 1) % 7,  # Python: Mon=0; DB: Sun=0
            "apple_ts": apple_ts,
        })

    return calls


def post_calls(calls):
    """POST calls to the Clinyco API."""
    if not API_KEY:
        print("[extract] MAC_CALL_IMPORT_SECRET not set, skipping POST")
        return None

    payload = json.dumps({
        "agentPhone": AGENT_PHONE,
        "calls": calls,
    }).encode("utf-8")

    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )

    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                return body
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            print(f"[extract] HTTP {e.code}: {error_body}")
            return None
        except (urllib.error.URLError, OSError) as e:
            wait = 2 ** (attempt + 1)
            print(f"[extract] Network error (attempt {attempt + 1}/4): {e}. Retrying in {wait}s...")
            time.sleep(wait)

    print("[extract] All retries exhausted")
    return None


def main():
    if "--discover" in sys.argv:
        cmd_discover()
        return

    dry_run = "--dry-run" in sys.argv
    since_apple = load_last_timestamp()

    if since_apple > 0:
        since_dt = datetime.fromtimestamp(since_apple + APPLE_EPOCH_OFFSET, tz=timezone.utc)
        print(f"[extract] Extracting calls since {since_dt.isoformat()}")
    else:
        print("[extract] First run — extracting ALL calls")

    calls = extract_calls(since_apple)
    print(f"[extract] Found {len(calls)} new calls")

    if not calls:
        return

    if dry_run:
        print("[extract] DRY RUN — not posting. Sample:")
        for c in calls[:5]:
            print(f"  {c['received_at']} {c['direction']:20s} {c['client_phone']:15s} "
                  f"{c['contact_name']:20s} {c['status']:8s} {c['duration_seconds']}s")
        if len(calls) > 5:
            print(f"  ... and {len(calls) - 5} more")
        return

    result = post_calls(calls)
    if result:
        print(f"[extract] Server response: inserted={result.get('inserted', '?')}, "
              f"skipped={result.get('skipped', '?')}, lid_maps={result.get('lidMapsCreated', '?')}")

        max_apple_ts = max(c["apple_ts"] for c in calls)
        save_last_timestamp(max_apple_ts)
        print(f"[extract] Saved checkpoint: apple_ts={max_apple_ts}")
    else:
        print("[extract] POST failed — checkpoint NOT updated (will retry next run)")


if __name__ == "__main__":
    main()
