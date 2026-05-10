#!/usr/bin/env python3
"""
CAC Analysis vía Zendesk Sell LEADS module.

Flujo:
1. Lee Meta leads CSV (para identificar leads de Meta)
2. Consulta Zendesk Sell /leads endpoint (todos los leads)
3. Matchea leads contra el CSV de Meta (por email, teléfono, nombre)
4. Para cada lead Meta, detecta si se convirtió a deal ("won")
5. Calcula CAC real, tasa conversión, LTV, embudo completo

Env vars:
  ZENDESK_SELL_API_TOKEN - Token Zendesk Sell (requerido)

Uso:
  export ZENDESK_SELL_API_TOKEN=xxx
  python3 analyze_cac_leads_based.py \\
      --leads-csv ./leads_enero_mayo.csv \\
      --gasto-clp 4529962 \\
      --periodo-inicio 2026-01-01 \\
      --periodo-fin 2026-05-10 \\
      --output-dir ./out
"""

import os
import sys
import json
import csv
import argparse
import re
import time
import unicodedata
from datetime import datetime
from pathlib import Path
from collections import defaultdict

import urllib.request
import urllib.error
import urllib.parse

try:
    import pandas as pd
except ImportError:
    pd = None

ZENDESK_BASE = "https://api.getbase.com/v2"

def log(msg):
    print(f"[CAC-leads] {msg}", flush=True)

def normalize_email(s):
    if not s or (isinstance(s, float) and str(s) == 'nan'):
        return ""
    s = str(s).strip().lower()
    if "@" not in s:
        return ""
    return re.sub(r'\s+', '', s)

def normalize_phone(s):
    if not s or (isinstance(s, float) and str(s) == 'nan'):
        return ""
    digits = re.sub(r'\D', '', str(s))
    if not digits or len(digits) < 7:
        return ""
    # Mobile Chilean: 9 dígitos sin código país → +569XXX
    if len(digits) == 9 and digits.startswith("9"):
        return f"+56{digits}"
    # Con código 56
    if len(digits) == 11 and digits.startswith("56"):
        return f"+{digits}"
    # Fallback
    if 7 <= len(digits) <= 12:
        return f"+{digits}" if digits.startswith("56") else f"+56{digits}"
    return ""

def normalize_name(s):
    if not s or (isinstance(s, float) and str(s) == 'nan'):
        return ""
    s = str(s).strip()
    # Remove accents
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    # Lowercase, remove non-alphanumeric
    s = s.lower()
    s = re.sub(r'[^a-z0-9\s]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def zendesk_get(path, token, timeout=30):
    """GET request to Zendesk Sell API."""
    headers = {"Authorization": f"Bearer {token}"}
    url = f"{ZENDESK_BASE}{path}"

    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                wait = 2 ** attempt
                log(f"  [retry {attempt+1}/4] HTTP {e.code}, wait {wait}s")
                time.sleep(wait)
                continue
            body = e.read().decode('utf-8', errors='replace')
            try:
                return e.code, json.loads(body)
            except:
                return e.code, {"_error": body[:200]}
        except Exception as e:
            if attempt < 3:
                time.sleep(2 ** attempt)
                continue
            return 599, {"_error": str(e)}

    return 599, {"_error": "exhausted retries"}

def load_meta_csv(path):
    """Load Meta CSV and normalize fields."""
    log(f"Loading Meta CSV from {path}")
    meta_leads = {}

    try:
        with open(path, encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                email = normalize_email(row.get("Correo electrónico", ""))
                phone = normalize_phone(row.get("Teléfono", ""))
                name = normalize_name(row.get("Nombre", ""))

                # Key by email if available, else phone, else name
                key = email or phone or name
                if key:
                    meta_leads[key] = {
                        "email": email,
                        "phone": phone,
                        "name": name,
                        "row": row
                    }

        log(f"  Loaded {len(meta_leads)} unique Meta leads")
        return meta_leads
    except Exception as e:
        log(f"  ERROR: {e}")
        sys.exit(1)

def fetch_all_leads(token):
    """Fetch all leads from Zendesk Sell."""
    log("Fetching all leads from Zendesk Sell...")
    all_leads = []
    page = 1
    per_page = 100

    while True:
        code, data = zendesk_get(f"/leads?per_page={per_page}&page={page}", token)
        if code != 200:
            log(f"  ERROR page {page}: HTTP {code}")
            break

        items = data.get("items", [])
        if not items:
            break

        for item in items:
            lead = item.get("data", {})
            all_leads.append({
                "id": lead.get("id"),
                "first_name": lead.get("first_name", ""),
                "last_name": lead.get("last_name", ""),
                "email": lead.get("email", ""),
                "phone": lead.get("phone", ""),
                "mobile": lead.get("mobile", ""),
                "created_at": lead.get("created_at", ""),
                "description": lead.get("description", ""),
            })

        log(f"  page {page}: {len(items)} leads (total: {len(all_leads)})")
        if len(items) < per_page:
            break
        page += 1

    return all_leads

def fetch_deals_for_lead(token, lead_id):
    """Try to find a deal linked to a lead (by contact email/phone)."""
    # Note: Zendesk Sell doesn't have direct lead→deal linking
    # This is a heuristic approach
    return None

def fetch_all_contacts(token):
    """Fetch all contacts to link with deals."""
    log("Fetching contacts...")
    contacts = {}
    page = 1

    while True:
        code, data = zendesk_get(f"/contacts?per_page=100&page={page}", token)
        if code != 200:
            break

        items = data.get("items", [])
        if not items:
            break

        for item in items:
            c = item.get("data", {})
            contact_id = c.get("id")
            contacts[contact_id] = {
                "id": contact_id,
                "first_name": c.get("first_name", ""),
                "last_name": c.get("last_name", ""),
                "email": normalize_email(c.get("email", "")),
                "phone": normalize_phone(c.get("phone") or c.get("mobile", "")),
                "name": f"{c.get('first_name', '')} {c.get('last_name', '')}".strip(),
            }

        log(f"  page {page}: {len(items)} contacts")
        if len(items) < 100:
            break
        page += 1

    return contacts

def fetch_all_deals(token):
    """Fetch all deals and mark won ones."""
    log("Fetching deals...")
    deals = {}
    page = 1

    # Fetch stages to identify "won"
    code, stages_data = zendesk_get("/stages?per_page=100", token)
    won_stage_ids = set()
    if code == 200:
        for item in stages_data.get("items", []):
            s = item.get("data", {})
            if s.get("category") == "won":
                won_stage_ids.add(s.get("id"))

    log(f"  Found {len(won_stage_ids)} 'won' stage IDs")

    while True:
        code, data = zendesk_get(f"/deals?per_page=100&page={page}", token)
        if code != 200:
            break

        items = data.get("items", [])
        if not items:
            break

        for item in items:
            d = item.get("data", {})
            deal_id = d.get("id")
            cf = d.get("custom_fields", {})

            deals[deal_id] = {
                "id": deal_id,
                "name": d.get("name", ""),
                "contact_id": d.get("contact_id"),
                "value": float(d.get("value") or 0),
                "currency": d.get("currency", ""),
                "stage_id": d.get("stage_id"),
                "is_won": d.get("stage_id") in won_stage_ids or bool(cf.get("FECHA DE CIRUGÍA")),
                "fecha_cirugia": cf.get("FECHA DE CIRUGÍA", ""),
                "honorarios": float(cf.get("HONORARIOS") or 0),
                "pipeline_id": d.get("pipeline_id"),
                "created_at": d.get("created_at", ""),
            }

        log(f"  page {page}: {len(items)} deals")
        if len(items) < 100:
            break
        page += 1

    won_count = sum(1 for d in deals.values() if d["is_won"])
    log(f"  Total deals: {len(deals)} | Won: {won_count}")
    return deals

def match_leads_to_meta(leads, meta_leads_dict):
    """Match Zendesk leads to Meta CSV leads."""
    log("Matching leads to Meta CSV...")
    matched = []

    for lead in leads:
        lead_email = normalize_email(lead.get("email", ""))
        lead_phone = normalize_phone(lead.get("phone") or lead.get("mobile", ""))
        lead_name = normalize_name(f"{lead.get('first_name', '')} {lead.get('last_name', '')}")

        # Try matching by email
        if lead_email and lead_email in meta_leads_dict:
            matched.append((lead, meta_leads_dict[lead_email], "email"))
            continue

        # Try matching by phone
        if lead_phone and lead_phone in meta_leads_dict:
            matched.append((lead, meta_leads_dict[lead_phone], "phone"))
            continue

        # Try matching by name
        if lead_name:
            for key, meta_lead in meta_leads_dict.items():
                if meta_lead["name"] == lead_name:
                    matched.append((lead, meta_lead, "name"))
                    break

    log(f"  Matched {len(matched)} leads to Meta CSV")
    return matched

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--leads-csv", required=True, type=Path, help="Meta CSV")
    ap.add_argument("--gasto-clp", required=True, type=float, help="Spend in CLP")
    ap.add_argument("--periodo-inicio", required=True, help="YYYY-MM-DD")
    ap.add_argument("--periodo-fin", required=True, help="YYYY-MM-DD")
    ap.add_argument("--output-dir", type=Path, default=Path("./out"))
    args = ap.parse_args()

    token = os.environ.get("ZENDESK_SELL_API_TOKEN")
    if not token:
        sys.exit("ERROR: ZENDESK_SELL_API_TOKEN not set")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    log(f"\n{'='*60}")
    log("CAC Analysis (Leads-based approach)")
    log(f"{'='*60}\n")

    # Load Meta CSV
    meta_leads_dict = load_meta_csv(args.leads_csv)

    # Fetch Zendesk data
    leads = fetch_all_leads(token)
    contacts = fetch_all_contacts(token)
    deals = fetch_all_deals(token)

    # Match leads
    matched_leads = match_leads_to_meta(leads, meta_leads_dict)

    # Calculate conversions
    conversions = 0
    valor_total = 0
    for zendesk_lead, meta_lead, match_type in matched_leads:
        contact_id = zendesk_lead.get("contact_id")
        if contact_id:
            # Find deals for this contact
            contact_deals = [d for d in deals.values() if d["contact_id"] == contact_id]
            won_deals = [d for d in contact_deals if d["is_won"]]
            if won_deals:
                conversions += len(won_deals)
                for deal in won_deals:
                    valor_total += deal.get("honorarios") or deal.get("value", 0)

    # Calculate metrics
    total_leads = len(meta_leads_dict)
    cpl = args.gasto_clp / total_leads if total_leads else 0
    cac = args.gasto_clp / conversions if conversions else float("inf")
    tasa = conversions / total_leads * 100 if total_leads else 0
    ltv = valor_total / conversions if conversions else 0

    # Report
    log(f"\n{'='*60}")
    log("RESULTADOS")
    log(f"{'='*60}\n")
    log(f"Leads Meta totales:           {total_leads:,}")
    log(f"Leads matcheados a Zendesk:   {len(matched_leads):,}")
    log(f"Conversiones (won deals):     {conversions:,}")
    if total_leads > 0:
        log(f"Tasa conversión:              {tasa:.1f}%")
    log(f"Gasto CLP:                    ${args.gasto_clp:,.0f}")
    log(f"CPL reportado Meta:           ${cpl:,.0f}")
    if conversions > 0:
        log(f"CAC real (lead→deal):         ${cac:,.0f}")
        log(f"LTV promedio:                 ${ltv:,.0f}")
        if ltv and cac != float("inf"):
            log(f"Ratio LTV/CAC:                {ltv/cac:.2f}x")
    log(f"\n{'='*60}\n")

if __name__ == "__main__":
    main()
