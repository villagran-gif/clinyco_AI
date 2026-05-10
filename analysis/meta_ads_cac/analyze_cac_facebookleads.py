#!/usr/bin/env python3
"""
CAC Analysis FINAL: usa source FacebookLeads (id=2601247) en Zendesk Sell.

Hallazgo clave (2026-05-10):
- Zendesk Sell tiene un source "FacebookLeads" (id=2601247) con leads que SÍ
  tienen email (a diferencia del CSV de Meta Lead Center que solo tiene IG handles).
- Para CAC real: filtrar leads por source_id=2601247 + período + matchear con deals.

Flujo:
1. Fetch leads con source_id=2601247 ("FacebookLeads") en período
2. Fetch deals "won" (stage.category=won o FECHA DE CIRUGÍA)
3. Match por email exacto, teléfono, o nombre+ventana
4. Calcular CAC, tasa, LTV, embudo

Env vars:
  ZENDESK_SELL_API_TOKEN - Token Zendesk Sell

Uso:
  export ZENDESK_SELL_API_TOKEN=xxx
  python3 analyze_cac_facebookleads.py \\
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
from collections import defaultdict, Counter

import urllib.request
import urllib.error
import urllib.parse

ZENDESK_BASE = "https://api.getbase.com/v2"
FACEBOOK_LEADS_SOURCE_ID = 2601247

WON_STAGE_NAMES = {"cerrado-ganado", "cerrado ganado", "won", "ganado"}

PIPELINES = {
    1290779: "Bariátrica",
    4823817: "Balón",
    4959507: "Plástica",
    5049979: "General",
}


def log(msg):
    print(f"[CAC] {msg}", flush=True)


def normalize_email(s):
    if not s:
        return ""
    s = str(s).strip().lower()
    if "@" not in s:
        return ""
    return re.sub(r'\s+', '', s)


def normalize_phone(s):
    if not s:
        return ""
    digits = re.sub(r'\D', '', str(s))
    if not digits or len(digits) < 7:
        return ""
    if len(digits) == 9 and digits.startswith("9"):
        return f"+56{digits}"
    if len(digits) == 11 and digits.startswith("56"):
        return f"+{digits}"
    if 7 <= len(digits) <= 12:
        return f"+{digits}" if digits.startswith("56") else f"+56{digits}"
    return ""


def normalize_name(s):
    if not s:
        return ""
    s = str(s).strip()
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r'[^a-z0-9\s]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def zendesk_get(path, token, timeout=30):
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
                log(f"  retry {attempt+1}/4 HTTP {e.code} wait {wait}s")
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
    return 599, {"_error": "exhausted"}


def fetch_leads_by_source(token, source_id, inicio_dt, fin_dt):
    """Fetch all leads with given source_id within date range."""
    log(f"Fetching leads with source_id={source_id}...")
    all_leads = []
    page = 1

    # API doesn't support direct source_id filter with date filter combined,
    # so we paginate sorted by created_at desc and stop when out of range
    while True:
        code, data = zendesk_get(
            f"/leads?source_id={source_id}&per_page=100&page={page}&sort_by=created_at:desc",
            token
        )
        if code != 200:
            log(f"  ERROR page {page}: {code}")
            break

        items = data.get("items", [])
        if not items:
            break

        kept = 0
        passed_period = False
        for item in items:
            lead = item.get("data", {})
            created_str = lead.get("created_at", "")
            if not created_str:
                continue
            try:
                created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            except:
                continue

            # Stop early if we're way before the period
            if created_dt < inicio_dt:
                passed_period = True
                continue

            if created_dt > fin_dt:
                continue

            all_leads.append(lead)
            kept += 1

        log(f"  page {page}: {len(items)} fetched, {kept} in period")
        if passed_period and kept == 0:
            break
        if len(items) < 100:
            break
        page += 1

    log(f"  TOTAL: {len(all_leads)} leads in [{inicio_dt.date()}..{fin_dt.date()}]")
    return all_leads


def fetch_all_stages(token):
    """Get stages to identify 'won'."""
    code, data = zendesk_get("/stages?per_page=200", token)
    stages_by_id = {}
    won_ids = set()
    if code == 200:
        for item in data.get("items", []):
            s = item.get("data", {})
            sid = s.get("id")
            stages_by_id[sid] = s
            if s.get("category") == "won" or s.get("name", "").lower() in WON_STAGE_NAMES:
                won_ids.add(sid)
    return stages_by_id, won_ids


def fetch_all_deals(token, won_stage_ids, inicio_dt, fin_dt):
    """Fetch deals created in or relevant to the period."""
    log("Fetching deals...")
    deals = []
    page = 1

    while True:
        code, data = zendesk_get(f"/deals?per_page=100&page={page}&sort_by=created_at:desc", token)
        if code != 200:
            break

        items = data.get("items", [])
        if not items:
            break

        passed_period = False
        kept = 0
        for item in items:
            d = item.get("data", {})
            created_str = d.get("created_at", "")
            if not created_str:
                continue
            try:
                created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            except:
                continue

            # Allow deals up to 1 year before period (sales cycle could be long)
            # but stop if before that
            from datetime import timedelta
            if created_dt < (inicio_dt - timedelta(days=365)):
                passed_period = True
                continue

            cf = d.get("custom_fields") or {}
            def safe_float(v):
                if v is None or v == "":
                    return 0.0
                try:
                    return float(str(v).replace(",", ".").replace("$", "").strip())
                except (ValueError, TypeError):
                    return 0.0
            deals.append({
                "id": d.get("id"),
                "name": d.get("name"),
                "contact_id": d.get("contact_id"),
                "value": safe_float(d.get("value")),
                "stage_id": d.get("stage_id"),
                "is_won": d.get("stage_id") in won_stage_ids or bool(cf.get("FECHA DE CIRUGÍA")),
                "fecha_cirugia": cf.get("FECHA DE CIRUGÍA"),
                "honorarios": safe_float(cf.get("HONORARIOS")),
                "pipeline_id": d.get("pipeline_id"),
                "pipeline_name": PIPELINES.get(d.get("pipeline_id"), "Otros"),
                "created_at": created_str,
                "estimated_close_date": d.get("estimated_close_date"),
                "custom_fields": cf,
            })
            kept += 1

        log(f"  page {page}: {len(items)} fetched, {kept} kept")
        if passed_period and kept == 0:
            break
        if len(items) < 100:
            break
        page += 1
        if page > 100:  # safety
            log("  WARN: hit page limit")
            break

    log(f"  TOTAL: {len(deals)} deals (won: {sum(1 for d in deals if d['is_won'])})")
    return deals


def fetch_contacts(token, contact_ids):
    """Fetch contacts in batches by IDs (smaller chunks to avoid limits)."""
    log(f"Fetching {len(contact_ids)} contacts (in chunks of 25)...")
    contacts = {}
    ids_list = list(contact_ids)
    chunk_size = 25  # smaller chunks more reliable
    for i in range(0, len(ids_list), chunk_size):
        chunk = ids_list[i:i+chunk_size]
        ids_str = ",".join(str(c) for c in chunk)
        code, data = zendesk_get(f"/contacts?ids={ids_str}&per_page={chunk_size}", token)
        if code != 200:
            log(f"  ERROR chunk starting at {i}: {code}")
            continue
        for item in data.get("items", []):
            c = item.get("data", {})
            contacts[c.get("id")] = {
                "id": c.get("id"),
                "first_name": c.get("first_name", ""),
                "last_name": c.get("last_name", ""),
                "email": c.get("email", ""),
                "phone": c.get("phone", ""),
                "mobile": c.get("mobile", ""),
            }
        if (i // chunk_size) % 20 == 0:
            log(f"  fetched {len(contacts)}/{len(ids_list)} so far")
    return contacts


def match_leads_to_deals(leads, deals, contacts, lead_to_deal_max_days=365,
                          lead_to_deal_min_days=-7):
    """Match each FacebookLead to a deal that was created AFTER the lead (or up to 7d before).

    Args:
        lead_to_deal_max_days: deals must be created within this many days AFTER lead.
        lead_to_deal_min_days: deals can be created up to this many days BEFORE lead
                               (negative = allow earlier; tolerates lead-imported-late).
    """
    from datetime import timedelta
    log("Matching leads to deals (with temporal filter)...")

    # Build deal indexes by contact email/phone/name
    email_to_deals = defaultdict(list)
    phone_to_deals = defaultdict(list)
    name_to_deals = defaultdict(list)

    for deal in deals:
        cid = deal.get("contact_id")
        contact = contacts.get(cid, {})

        email = normalize_email(contact.get("email", ""))
        phone = normalize_phone(contact.get("mobile") or contact.get("phone", ""))
        name = normalize_name(f"{contact.get('first_name', '')} {contact.get('last_name', '')}")

        if email:
            email_to_deals[email].append(deal)
        if phone:
            phone_to_deals[phone].append(deal)
        if name:
            name_to_deals[name].append(deal)

    def best_temporal_match(candidates, lead_dt):
        """Pick best deal candidate respecting temporal constraints.
        Prefer: won + within window > non-won within window > anything within window."""
        valid = []
        for d in candidates:
            try:
                d_dt = datetime.fromisoformat(d["created_at"].replace("Z", "+00:00"))
            except:
                continue
            days_diff = (d_dt - lead_dt).total_seconds() / 86400
            if lead_to_deal_min_days <= days_diff <= lead_to_deal_max_days:
                valid.append((d, days_diff))
        if not valid:
            return None, None
        # Prefer won deals, then earliest (closest to lead date)
        valid.sort(key=lambda x: (not x[0]["is_won"], abs(x[1])))
        return valid[0][0], round(valid[0][1], 1)

    matches = []
    for lead in leads:
        lead_email = normalize_email(lead.get("email", ""))
        lead_phone = normalize_phone(lead.get("mobile") or lead.get("phone", ""))
        lead_name = normalize_name(f"{lead.get('first_name', '')} {lead.get('last_name', '')}")
        try:
            lead_dt = datetime.fromisoformat(lead.get("created_at", "").replace("Z", "+00:00"))
        except:
            lead_dt = None

        matched_deal = None
        rule = None
        days_to_conv = None

        if lead_dt:
            if lead_email and lead_email in email_to_deals:
                matched_deal, days_to_conv = best_temporal_match(email_to_deals[lead_email], lead_dt)
                if matched_deal:
                    rule = "email"
            if not matched_deal and lead_phone and lead_phone in phone_to_deals:
                matched_deal, days_to_conv = best_temporal_match(phone_to_deals[lead_phone], lead_dt)
                if matched_deal:
                    rule = "phone"
            if not matched_deal and lead_name and lead_name in name_to_deals:
                matched_deal, days_to_conv = best_temporal_match(name_to_deals[lead_name], lead_dt)
                if matched_deal:
                    rule = "name"

        matches.append((lead, matched_deal, rule, days_to_conv))

    matched_count = sum(1 for _, d, _, _ in matches if d is not None)
    won_count = sum(1 for _, d, _, _ in matches if d and d["is_won"])
    log(f"  Matched: {matched_count}/{len(leads)} | Won: {won_count}")
    return matches


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--gasto-clp", required=True, type=float, help="Gasto Meta CLP")
    ap.add_argument("--periodo-inicio", required=True, help="YYYY-MM-DD")
    ap.add_argument("--periodo-fin", required=True, help="YYYY-MM-DD")
    ap.add_argument("--output-dir", type=Path, default=Path("./out"))
    ap.add_argument("--source-id", type=int, default=FACEBOOK_LEADS_SOURCE_ID,
                    help=f"Lead source_id (default: {FACEBOOK_LEADS_SOURCE_ID}=FacebookLeads)")
    args = ap.parse_args()

    token = os.environ.get("ZENDESK_SELL_API_TOKEN")
    if not token:
        sys.exit("ERROR: ZENDESK_SELL_API_TOKEN not set")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    inicio_dt = datetime.fromisoformat(f"{args.periodo_inicio}T00:00:00+00:00")
    fin_dt = datetime.fromisoformat(f"{args.periodo_fin}T23:59:59+00:00")

    log(f"=== CAC Analysis FacebookLeads ===")
    log(f"Período: {args.periodo_inicio} → {args.periodo_fin}")
    log(f"Gasto CLP: ${args.gasto_clp:,.0f}")
    log(f"Source ID: {args.source_id} (FacebookLeads)\n")

    # 1. Fetch leads
    leads = fetch_leads_by_source(token, args.source_id, inicio_dt, fin_dt)

    if not leads:
        log("No leads found in period. Exiting.")
        return

    # 2. Fetch stages
    stages, won_ids = fetch_all_stages(token)
    log(f"Found {len(won_ids)} 'won' stage IDs")

    # 3. Fetch deals
    deals = fetch_all_deals(token, won_ids, inicio_dt, fin_dt)

    # 4. Fetch contacts referenced by deals
    contact_ids = {d["contact_id"] for d in deals if d.get("contact_id")}
    contacts = fetch_contacts(token, contact_ids)
    log(f"Fetched {len(contacts)} contacts")

    # 5. Match
    matches = match_leads_to_deals(leads, deals, contacts)

    # 6. Compute metrics
    total_leads = len(leads)
    matched_total = sum(1 for _, d, _, _ in matches if d)
    conversiones = sum(1 for _, d, _, _ in matches if d and d["is_won"])
    valor_total = sum(d["honorarios"] or d["value"] for _, d, _, _ in matches if d and d["is_won"])

    cpl_meta = args.gasto_clp / total_leads if total_leads else 0
    cac_real = args.gasto_clp / conversiones if conversiones else 0
    tasa = conversiones / total_leads * 100 if total_leads else 0
    ltv = valor_total / conversiones if conversiones else 0

    # Match rules breakdown
    rules = Counter(rule for _, d, rule, _ in matches if d)
    pipelines_won = Counter(d["pipeline_name"] for _, d, _, _ in matches if d and d["is_won"])

    # Stages of all matched deals (for funnel analysis)
    stages_dist = Counter()
    for _, d, _, _ in matches:
        if d:
            sid = d["stage_id"]
            stage = stages.get(sid, {})
            stage_name = stage.get("name", f"unknown_{sid}")
            stage_cat = stage.get("category", "?")
            stages_dist[f"{stage_cat}/{stage_name}"] += 1

    # Report
    print("\n" + "=" * 70)
    print("                        RESULTADOS CAC")
    print("=" * 70)
    print(f"Período:                      {args.periodo_inicio} → {args.periodo_fin}")
    print(f"Source:                       FacebookLeads (id={args.source_id})")
    print(f"Gasto Meta Ads:               ${args.gasto_clp:,.0f} CLP")
    print()
    print(f"Leads desde Meta (CRM):       {total_leads:,}")
    print(f"  ↳ Matcheados a deal:        {matched_total:,}")
    print(f"  ↳ Convertidos (won):        {conversiones:,}")
    print(f"  Tasa de conversión:         {tasa:.1f}%")
    print()
    print(f"CPL reportado Meta:           ${cpl_meta:,.0f} CLP")
    if conversiones > 0:
        print(f"CAC real (lead→won):          ${cac_real:,.0f} CLP")
        print(f"Brecha CAC vs CPL:            ${cac_real - cpl_meta:,.0f} CLP")
        print()
        print(f"Valor facturado total:        ${valor_total:,.0f} CLP")
        print(f"LTV promedio:                 ${ltv:,.0f} CLP")
        if cac_real > 0:
            print(f"Ratio LTV/CAC:                {ltv/cac_real:.2f}x")
    else:
        print(f"CAC real:                     N/A (0 conversiones)")
    print()
    print(f"Calidad del matching:")
    for r, c in rules.most_common():
        print(f"  {r:10}: {c}")
    print()
    print(f"Distribución de etapas de leads matcheados:")
    for stage_label, count in stages_dist.most_common():
        print(f"  {stage_label:50}: {count}")
    print()
    if pipelines_won:
        print(f"Conversiones por pipeline:")
        for p, c in pipelines_won.most_common():
            print(f"  {p:15}: {c}")
    print("=" * 70)

    # Save outputs
    metrics = {
        "periodo": f"{args.periodo_inicio} → {args.periodo_fin}",
        "gasto_clp": args.gasto_clp,
        "source": "FacebookLeads",
        "source_id": args.source_id,
        "total_leads": total_leads,
        "matched_total": matched_total,
        "conversiones": conversiones,
        "tasa_conversion_pct": round(tasa, 2),
        "cpl_meta_clp": round(cpl_meta),
        "cac_real_clp": round(cac_real) if cac_real else None,
        "brecha_cac_vs_cpl": round(cac_real - cpl_meta) if cac_real else None,
        "valor_total_clp": round(valor_total),
        "ltv_promedio_clp": round(ltv),
        "ratio_ltv_cac": round(ltv/cac_real, 2) if cac_real else None,
        "matches_by_rule": dict(rules),
        "conversiones_por_pipeline": dict(pipelines_won),
    }

    with open(args.output_dir / "metrics.json", "w") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)

    # Save matches CSV
    with open(args.output_dir / "matches.csv", "w", newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(["lead_id", "lead_name", "lead_email", "lead_created_at",
                    "deal_id", "deal_name", "deal_pipeline", "deal_stage_id",
                    "deal_stage_name", "deal_won", "deal_value_clp",
                    "deal_created_at", "days_lead_to_deal", "match_rule"])
        for lead, deal, rule, days in matches:
            stage_name = ""
            if deal and deal.get("stage_id"):
                stage_name = stages.get(deal["stage_id"], {}).get("name", "")
            w.writerow([
                lead.get("id"),
                f"{lead.get('first_name', '')} {lead.get('last_name', '')}".strip(),
                lead.get("email", ""),
                lead.get("created_at", ""),
                deal.get("id") if deal else "",
                deal.get("name") if deal else "",
                deal.get("pipeline_name") if deal else "",
                deal.get("stage_id") if deal else "",
                stage_name,
                "Y" if deal and deal["is_won"] else "N",
                deal.get("honorarios") or deal.get("value") if deal else 0,
                deal.get("created_at") if deal else "",
                days if days is not None else "",
                rule or "",
            ])

    log(f"\n✓ Outputs saved to {args.output_dir}/")
    log(f"  - metrics.json")
    log(f"  - matches.csv")


if __name__ == "__main__":
    main()
