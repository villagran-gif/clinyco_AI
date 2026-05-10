#!/usr/bin/env python3
"""
Investigar estructura de CRM Lead en Frappe para entender:
1. ¿Existen leads en la base de datos?
2. ¿Tienen un campo 'source' que identifique leads de Meta Ads?
3. ¿Hay alguna relación entre leads y deals?
4. ¿Qué información está disponible para matching/conversión?
"""

import os
import json
import urllib.request
import urllib.error
import urllib.parse

# Frappe Cloud API
FRAPPE_URL = os.environ.get("FRAPPE_CLOUD_SITE_URL", "").rstrip("/")
FRAPPE_KEY = os.environ.get("FRAPPE_CLOUD_API_KEY", "")
FRAPPE_SECRET = os.environ.get("FRAPPE_CLOUD_API_SECRET", "")

if not (FRAPPE_URL and FRAPPE_KEY and FRAPPE_SECRET):
    print("⚠️  Env vars no seteadas:")
    print("  FRAPPE_CLOUD_SITE_URL")
    print("  FRAPPE_CLOUD_API_KEY")
    print("  FRAPPE_CLOUD_API_SECRET")
    exit(1)

def frappe_api(method, path, body=None):
    """Simple Frappe API call."""
    auth = f"token {FRAPPE_KEY}:{FRAPPE_SECRET}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        f"{FRAPPE_URL}{path}",
        data=data,
        method=method,
        headers={"Authorization": auth, "Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"❌ {method} {path} → {e.code}: {body[:500]}")
        return None

# 1. Get CRM Lead Meta (fields, doctype structure)
print("\n=== 1. CRM Lead Meta ===")
meta = frappe_api("GET", "/api/resource/CRM%20Lead/meta")
if meta:
    print("✓ CRM Lead fields:")
    fields = meta.get("data", {}).get("fields", [])
    for f in fields:
        fname = f.get("fieldname")
        ftype = f.get("fieldtype")
        flabel = f.get("label")
        print(f"  - {fname:30} ({ftype:15}) : {flabel}")

# 2. List first 10 leads
print("\n=== 2. Sample Leads (first 10) ===")
leads_list = frappe_api("GET", "/api/resource/CRM%20Lead?fields=%5B%22name%22,%22first_name%22,%22last_name%22,%22email%22,%22phone%22,%22status%22%5D&limit_page_length=10")
if leads_list:
    leads = leads_list.get("data", [])
    print(f"Total leads returned: {len(leads)}")
    for lead in leads[:5]:
        print(f"\n  Lead: {lead.get('name')}")
        print(f"    Name: {lead.get('first_name')} {lead.get('last_name')}")
        print(f"    Email: {lead.get('email')}")
        print(f"    Phone: {lead.get('phone')}")
        print(f"    Status: {lead.get('status')}")

# 3. Check if there's a 'source' field in any lead
print("\n=== 3. Full Lead Details (with all fields) ===")
if leads_list:
    leads = leads_list.get("data", [])
    if leads:
        first_lead_name = leads[0].get("name")
        print(f"Fetching full details of: {first_lead_name}")
        full_lead = frappe_api("GET", f"/api/resource/CRM%20Lead/{urllib.parse.quote(first_lead_name)}")
        if full_lead:
            lead_data = full_lead.get("data", {})
            print("\nAll fields in this lead:")
            for key, value in lead_data.items():
                if value not in (None, "", []):
                    val_str = str(value)[:100]
                    print(f"  {key:30} = {val_str}")

# 4. Check CRM Lead Source doctype
print("\n=== 4. Available Lead Sources ===")
sources = frappe_api("GET", "/api/resource/CRM%20Lead%20Source?fields=%5B%22name%22,%22source_name%22,%22is_for_lead%22%5D&limit_page_length=50")
if sources:
    for src in sources.get("data", []):
        print(f"  - {src.get('name'):30} ({src.get('source_name')})")

# 5. Check if leads can be filtered by source
print("\n=== 5. Leads with 'Meta' source (if exists) ===")
meta_leads = frappe_api("GET", '/api/resource/CRM%20Lead?filters=%5B%5B"source","like","Meta"%5D%5D&limit_page_length=10&fields=%5B"name","first_name","source","status"%5D')
if meta_leads:
    leads = meta_leads.get("data", [])
    print(f"Found {len(leads)} leads matching 'Meta'")
    for lead in leads[:5]:
        print(f"  {lead.get('name'):30} | source={lead.get('source')} | status={lead.get('status')}")

# 6. Check link_doc fields (relationship to deals)
print("\n=== 6. Check for link_doc fields (source/converted field) ===")
if meta:
    fields = meta.get("data", {}).get("fields", [])
    link_fields = [f for f in fields if f.get("fieldtype") in ("Link", "Data", "Select")]
    print("Link/Reference fields that might indicate conversion:")
    for f in link_fields:
        fname = f.get("fieldname")
        if any(x in fname.lower() for x in ["source", "convert", "deal", "contact"]):
            print(f"  - {fname:30} ({f.get('fieldtype'):15}) → {f.get('options', '')}")

print("\n✓ Investigation complete")
