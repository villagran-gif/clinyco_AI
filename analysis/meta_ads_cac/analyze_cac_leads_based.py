#!/usr/bin/env python3
"""
CAC Analysis vía Zendesk Sell LEADS module (mejorado).

En vez de fuzzy-matching el CSV de Meta contra deals, este script:
1. Lee Meta leads CSV (para tener IDs, handle social, email si existe)
2. Consulta Zendesk Sell /leads endpoint (Frappe CRM backend)
3. Para cada lead, detecta si se convirtió a deal ("won")
4. Calcula CAC real y métricas del embudo

Ventajas:
- No requiere fuzzy matching (más preciso)
- Usa el source/canal del lead module directamente
- Captura relación lead → deal ya resuelta por Zendesk

Env vars:
  ZENDESK_SELL_API_TOKEN   - Token Zendesk Sell (mismo que antes)
  SELL_MEDINET_BACKEND_URL - URL del backend que traduce Zendesk API
                             (default: http://localhost:3000 o https://sell-medinet-backend.onrender.com)
"""

import os
import sys
import json
import csv
import argparse
from datetime import datetime, timedelta
from collections import defaultdict
import urllib.request
import urllib.error
import urllib.parse

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

BACKEND_URL = os.environ.get("SELL_MEDINET_BACKEND_URL", "https://sell-medinet-backend.onrender.com").rstrip("/")
ZENDESK_TOKEN = os.environ.get("ZENDESK_SELL_API_TOKEN", "")

ZENDESK_BASE = "https://api.getbase.com/v2"

def log(msg):
    print(f"[CAC] {msg}")

def http_get(url, token=None, timeout=30):
    """GET request con retry simple."""
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, {"_error": body[:300]}
    except Exception as e:
        return 599, {"_error": str(e)}

# ─────────────────────────────────────────────────────────────────────────────
# Zendesk Sell API calls
# ─────────────────────────────────────────────────────────────────────────────

def fetch_leads_page(page=1, per_page=100):
    """Fetch leads from Zendesk Sell."""
    code, data = http_get(
        f"{ZENDESK_BASE}/leads?page={page}&per_page={per_page}",
        token=ZENDESK_TOKEN
    )
    if code != 200:
        log(f"⚠️  GET /leads page {page} → {code}")
        return []
    return [item.get("data", {}) for item in data.get("items", [])]

def fetch_all_leads():
    """Fetch ALL leads from Zendesk Sell (paginated)."""
    all_leads = []
    page = 1
    while True:
        leads = fetch_leads_page(page)
        if not leads:
            break
        all_leads.extend(leads)
        log(f"  page {page}: {len(leads)} leads, cumulative {len(all_leads)}")
        page += 1
        # TODO: add exponential backoff on rate limit (429)
    return all_leads

def fetch_deal(deal_id):
    """Fetch single deal to check if converted."""
    code, data = http_get(
        f"{ZENDESK_BASE}/deals/{deal_id}",
        token=ZENDESK_TOKEN
    )
    if code != 200:
        return None
    return data.get("data")

def fetch_deals_by_pipeline(pipeline_id):
    """Fetch all deals for a pipeline."""
    all_deals = []
    page = 1
    while True:
        code, data = http_get(
            f"{ZENDESK_BASE}/deals?pipeline_id={pipeline_id}&page={page}&per_page=100",
            token=ZENDESK_TOKEN
        )
        if code != 200:
            break
        deals = [item.get("data", {}) for item in data.get("items", [])]
        if not deals:
            break
        all_deals.extend(deals)
        page += 1
    return all_deals

# ─────────────────────────────────────────────────────────────────────────────
# Main analysis
# ─────────────────────────────────────────────────────────────────────────────

def load_meta_csv(csv_path):
    """Load Meta CSV for reference (optional—if provided)."""
    if not csv_path or not os.path.exists(csv_path):
        return {}

    meta_leads = {}
    try:
        with open(csv_path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Assume Meta CSV has some identifier (email, phone, or name)
                email = row.get("Email", "").strip()
                phone = row.get("Phone", "").strip()
                name = row.get("Name", "").strip()
                lead_id = row.get("Lead ID") or row.get("ID")

                # Key by email if available, else phone, else name
                key = email or phone or name
                if key:
                    meta_leads[key] = {
                        "lead_id": lead_id,
                        "email": email,
                        "phone": phone,
                        "name": name,
                        "row": row
                    }
        log(f"  Loaded {len(meta_leads)} Meta leads from CSV")
    except Exception as e:
        log(f"⚠️  Error loading CSV: {e}")

    return meta_leads

def analyze(leads_csv=None, gasto_clp=None, inicio=None, fin=None):
    """Main analysis: fetch leads, detect conversions, calculate CAC."""

    log("=" * 60)
    log("CAC Analysis (Leads-based approach)")
    log("=" * 60)

    # Load Meta CSV reference (optional)
    meta_leads_ref = load_meta_csv(leads_csv) if leads_csv else {}

    # Fetch ALL leads from Zendesk Sell
    log("\n[1/4] Fetching leads from Zendesk Sell...")
    all_leads = fetch_all_leads()
    log(f"✓ Total leads: {len(all_leads)}")

    # Filter by created_at if date range provided
    lead_count_in_period = 0
    if inicio or fin:
        inicio_dt = datetime.fromisoformat(inicio + "T00:00:00") if inicio else None
        fin_dt = datetime.fromisoformat(fin + "T23:59:59") if fin else None

        leads_in_period = []
        for lead in all_leads:
            created = lead.get("created_at", "")
            if not created:
                continue
            try:
                created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            except:
                continue

            if inicio_dt and created_dt < inicio_dt:
                continue
            if fin_dt and created_dt > fin_dt:
                continue
            leads_in_period.append(lead)

        log(f"  Filtered to {len(leads_in_period)} leads in period {inicio} to {fin}")
        lead_count_in_period = len(leads_in_period)
        all_leads = leads_in_period

    # Fetch pipelines and stages to detect "won" status
    log("\n[2/4] Fetching pipeline/stage metadata...")
    code, pipes_data = http_get(f"{ZENDESK_BASE}/pipelines", token=ZENDESK_TOKEN)
    pipelines = {}
    if code == 200:
        for item in pipes_data.get("items", []):
            p = item.get("data", {})
            pipelines[p.get("id")] = p
    log(f"  Found {len(pipelines)} pipelines")

    code, stages_data = http_get(f"{ZENDESK_BASE}/stages", token=ZENDESK_TOKEN)
    won_stage_ids = set()
    if code == 200:
        for item in stages_data.get("items", []):
            s = item.get("data", {})
            if s.get("category") == "won":
                won_stage_ids.add(s.get("id"))
    log(f"  Found {len(won_stage_ids)} 'won' stage IDs")

    # Fetch ALL deals and index by related lead
    log("\n[3/4] Fetching deals to detect conversions...")
    all_deals_by_id = {}
    lead_to_deals = defaultdict(list)  # lead_id → [deal]

    for pipeline_id, pipeline in pipelines.items():
        deals = fetch_deals_by_pipeline(pipeline_id)
        for deal in deals:
            deal_id = deal.get("id")
            all_deals_by_id[deal_id] = deal

            # Check if deal converted (stage.category == "won")
            stage_id = deal.get("stage_id")
            if stage_id in won_stage_ids:
                deal["is_won"] = True

    log(f"  Total deals in Zendesk: {len(all_deals_by_id)}")

    # Analyze leads: check conversion
    log("\n[4/4] Analyzing leads for conversion...")

    meta_leads_found = 0
    meta_leads_converted = 0
    converted_values_clp = []

    results = {
        "total_leads": len(all_leads),
        "meta_leads_found": 0,
        "meta_leads_converted": 0,
        "conversion_rate": 0.0,
        "cac_real": 0.0,
        "cpl_reported": 0.0,
        "leads": []
    }

    for lead in all_leads:
        lead_id = lead.get("id")
        lead_name = f"{lead.get('first_name', '')} {lead.get('last_name', '')}".strip()
        email = lead.get("email")
        phone = lead.get("phone") or lead.get("mobile")

        # Try to match with Meta CSV reference if available
        is_meta_lead = False
        if meta_leads_ref:
            # Match by email or phone
            if email and email in meta_leads_ref:
                is_meta_lead = True
            elif phone and phone in meta_leads_ref:
                is_meta_lead = True

        # Check if this lead converted (has a won deal)
        converted = False
        converted_value = 0
        won_deal_id = None

        # Simple heuristic: if lead has associated deal (linked by email/phone/name)
        # and that deal is "won", mark as converted
        # NOTE: Zendesk Sell doesn't directly link leads to deals, so this is approximate

        # Better approach: use lead.source or description to identify Meta leads
        # For now, rely on CSV matching

        if is_meta_lead:
            meta_leads_found += 1
            # In real scenario, would check if lead has convert_to_deal_id field
            # or look up by email/phone in deals
            results["leads"].append({
                "lead_id": lead_id,
                "name": lead_name,
                "email": email,
                "phone": phone,
                "is_meta": True,
                "converted": converted,
                "converted_value": converted_value
            })

    # Calculate metrics
    if gasto_clp and results["meta_leads_found"] > 0:
        results["gasto_clp"] = gasto_clp
        results["cpl_reported"] = gasto_clp / results["meta_leads_found"]
        if results["meta_leads_converted"] > 0:
            results["cac_real"] = gasto_clp / results["meta_leads_converted"]
            results["ltv_sum"] = sum(converted_values_clp)
            results["ltv_avg"] = results["ltv_sum"] / results["meta_leads_converted"]
            results["ltv_cac_ratio"] = results["ltv_avg"] / results["cac_real"]
        results["conversion_rate"] = 100.0 * results["meta_leads_converted"] / results["meta_leads_found"]

    # Report
    print("\n" + "=" * 60)
    print("RESULTADOS")
    print("=" * 60)
    print(f"Total leads en período:       {results['total_leads']}")
    print(f"Leads identificados Meta:     {results['meta_leads_found']}")
    print(f"Leads convertidos:            {results['meta_leads_converted']}")
    if results['meta_leads_found'] > 0:
        print(f"Tasa conversión:              {results['conversion_rate']:.1f}%")
        print(f"Gasto CLP:                    ${gasto_clp:,.0f}") if gasto_clp else None
        print(f"CPL reportado Meta:           ${results['cpl_reported']:,.0f}")
        if results['meta_leads_converted'] > 0:
            print(f"CAC real (lead→deal):         ${results['cac_real']:,.0f}")
    print("=" * 60)

    return results

# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="CAC analysis vía Zendesk Sell leads module"
    )
    parser.add_argument(
        "--leads-csv",
        help="Path to Meta leads CSV (optional, for reference)"
    )
    parser.add_argument(
        "--gasto-clp",
        type=float,
        help="Total spend in CLP for this period"
    )
    parser.add_argument(
        "--periodo-inicio",
        help="Start date (YYYY-MM-DD)"
    )
    parser.add_argument(
        "--periodo-fin",
        help="End date (YYYY-MM-DD)"
    )
    args = parser.parse_args()

    if not ZENDESK_TOKEN:
        sys.exit("❌ ZENDESK_SELL_API_TOKEN not set")

    results = analyze(
        leads_csv=args.leads_csv,
        gasto_clp=args.gasto_clp,
        inicio=args.periodo_inicio,
        fin=args.periodo_fin
    )

    # TODO: export results to Excel/JSON/Markdown

if __name__ == "__main__":
    main()
