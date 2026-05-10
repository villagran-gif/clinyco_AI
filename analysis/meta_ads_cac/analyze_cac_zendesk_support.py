#!/usr/bin/env python3
"""
Análisis CAC: Meta Ads → Zendesk Support message history matching

Este script complementa el análisis de FacebookLeads usando una segunda fuente:
el historial de mensajes en Zendesk Support.

Objetivo:
- Extraer nombres de perfil del CSV Meta Ads
- Buscar esos nombres en el historial de Zendesk Support
- Matchear con requesters/usuarios en el sistema
- Enriquecer el análisis CAC con interacciones de soporte

Requisitos:
- ZENDESK_SUBDOMAIN
- ZENDESK_EMAIL
- ZENDESK_API_TOKEN
"""

import os
import sys
import json
import csv
import re
from datetime import datetime, timedelta
from urllib.parse import quote
import urllib.request
import urllib.error
import base64
from collections import defaultdict

# Environment
ZENDESK_SUBDOMAIN = os.environ.get("ZENDESK_SUBDOMAIN", "").rstrip("/")
ZENDESK_EMAIL = os.environ.get("ZENDESK_EMAIL", "")
ZENDESK_API_TOKEN = os.environ.get("ZENDESK_API_TOKEN", "")

if not (ZENDESK_SUBDOMAIN and ZENDESK_EMAIL and ZENDESK_API_TOKEN):
    print("❌ Env vars faltantes:")
    print("  - ZENDESK_SUBDOMAIN")
    print("  - ZENDESK_EMAIL")
    print("  - ZENDESK_API_TOKEN")
    sys.exit(1)

ZENDESK_BASE = f"https://{ZENDESK_SUBDOMAIN}.zendesk.com/api/v2"

# Basic Auth para Zendesk Support API
auth_string = base64.b64encode(
    f"{ZENDESK_EMAIL}/token:{ZENDESK_API_TOKEN}".encode()
).decode()

def zendesk_api(method, path, params=None):
    """Llama Zendesk Support API con autenticación."""
    url = f"{ZENDESK_BASE}{path}"
    if params:
        param_str = "&".join(f"{k}={quote(str(v))}" for k, v in params.items())
        url += f"?{param_str}"

    headers = {
        "Authorization": f"Basic {auth_string}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    req = urllib.request.Request(url, method=method, headers=headers)

    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            return data, None
    except urllib.error.HTTPError as e:
        try:
            error_body = json.loads(e.read().decode())
        except:
            error_body = e.read().decode()
        return None, f"{e.code}: {error_body}"
    except Exception as e:
        return None, str(e)

def normalize_name(name):
    """Normaliza nombre para búsqueda."""
    if not name:
        return ""
    # Lowercase, quita acentos, caracteres especiales
    import unicodedata
    nfd = unicodedata.normalize('NFD', name.lower())
    return ''.join(c for c in nfd if unicodedata.category(c) != 'Mn').strip()

def load_meta_csv(csv_path):
    """Carga CSV de Meta Ads y extrae nombres."""
    leads = []
    try:
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row.get('Nombre', '').strip()
                channel = row.get('Canal', '').strip()
                created = row.get('Fecha de creación', '').strip()

                if name:
                    leads.append({
                        'name': name,
                        'normalized_name': normalize_name(name),
                        'channel': channel,
                        'created': created,
                        'email': row.get('Correo electrónico', '').strip(),
                        'phone': row.get('Teléfono', '').strip(),
                    })

        print(f"✓ Cargados {len(leads)} leads del CSV Meta")
        return leads
    except Exception as e:
        print(f"❌ Error cargando CSV: {e}")
        return []

def search_zendesk_support_for_name(profile_name, normalized_name):
    """
    Busca en Zendesk Support tickets/comments que mencionen el nombre del perfil.
    Retorna lista de usuarios/requesters que matchearon.
    """
    # Estrategia: buscar el nombre en tickets via search API
    # También listar usuarios y checkear si el nombre existe

    results = {
        'tickets_found': [],
        'users_matching': [],
        'comments_with_name': []
    }

    # 1. Buscar tickets con el nombre en asunto o descripción
    search_query = f'text:"{profile_name}"'
    data, err = zendesk_api("GET", "/search.json", {"query": search_query})

    if data and 'results' in data:
        results['tickets_found'] = data['results'][:10]  # top 10

        # Para cada ticket encontrado, extraer el requester
        for ticket in results['tickets_found']:
            if 'requester_id' in ticket:
                results['users_matching'].append({
                    'ticket_id': ticket.get('id'),
                    'requester_id': ticket.get('requester_id'),
                    'name': ticket.get('subject'),
                })

    # 2. Buscar usuarios con ese nombre
    users_data, err = zendesk_api("GET", "/users/search.json", {
        "query": f"name:{profile_name}"
    })

    if users_data and 'users' in users_data:
        for user in users_data['users']:
            results['users_matching'].append({
                'user_id': user.get('id'),
                'name': user.get('name'),
                'email': user.get('email'),
                'phone': user.get('phone'),
            })

    return results

def fetch_all_tickets_sample(limit=100):
    """Obtiene una muestra de tickets para análisis."""
    all_tickets = []
    page = 1

    while len(all_tickets) < limit:
        data, err = zendesk_api("GET", "/tickets.json", {
            "page": page,
            "per_page": 100,
            "sort_by": "updated_at",
            "sort_order": "desc"
        })

        if not data or 'tickets' not in data:
            break

        tickets = data['tickets']
        if not tickets:
            break

        all_tickets.extend(tickets)
        page += 1

    return all_tickets[:limit]

def main():
    print("\n=== 📊 Meta Ads → Zendesk Support CAC Analysis ===\n")

    # 1. Cargar CSV Meta
    csv_path = "/home/user/clinyco_AI/analysis/meta_ads_cac/leads_enero_mayo.csv"
    meta_leads = load_meta_csv(csv_path)

    if not meta_leads:
        print("❌ No se cargaron leads desde CSV")
        return

    # 2. Conectar a Zendesk Support y obtener estadísticas
    print("\n📡 Conectando a Zendesk Support...")

    # Verificar acceso a API
    check, err = zendesk_api("GET", "/users/me.json")
    if check:
        me = check.get('user', {})
        print(f"✓ Conectado como: {me.get('name')} ({me.get('email')})")
    else:
        print(f"❌ Error conectando a Zendesk: {err}")
        return

    # 3. Buscar nombres en tickets
    print("\n🔍 Buscando nombres de Meta leads en Zendesk Support...\n")

    matches_summary = defaultdict(int)
    lead_support_matches = []

    # Muestra de los primeros 30 leads
    sample_leads = meta_leads[:30]

    for i, lead in enumerate(sample_leads, 1):
        profile_name = lead['name']
        normalized = lead['normalized_name']

        print(f"[{i}/{len(sample_leads)}] Buscando: {profile_name}...", end=" ", flush=True)

        results = search_zendesk_support_for_name(profile_name, normalized)

        if results['tickets_found'] or results['users_matching']:
            print(f"✓ MATCH ({len(results['tickets_found'])} tickets, {len(results['users_matching'])} usuarios)")
            lead_support_matches.append({
                'meta_lead': lead,
                'zendesk_matches': results
            })
            matches_summary['found'] += 1
        else:
            print("—")
            matches_summary['not_found'] += 1

    # 4. Resumen
    print(f"\n📈 Resultados (muestra de {len(sample_leads)} leads):")
    print(f"  • Matcheados con Zendesk Support: {matches_summary['found']}")
    print(f"  • Sin match: {matches_summary['not_found']}")
    print(f"  • Tasa: {100 * matches_summary['found'] / len(sample_leads):.1f}%")

    # 5. Guardar matches
    output_dir = "/home/user/clinyco_AI/analysis/meta_ads_cac/out"
    os.makedirs(output_dir, exist_ok=True)

    output_file = os.path.join(output_dir, "zendesk_support_matches.json")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'total_meta_leads_sampled': len(sample_leads),
            'matches_found': matches_summary['found'],
            'matches_not_found': matches_summary['not_found'],
            'detailed_matches': lead_support_matches[:10]  # top 10 matches
        }, f, indent=2, ensure_ascii=False)

    print(f"\n✓ Resultados guardados en: {output_file}")

    # 6. Recomendación siguiente
    print("\n💡 Próximos pasos:")
    print("  1. Validar manualmente los matches encontrados")
    print("  2. Extraer requester_id de los tickets para linkear con Zendesk Sell contacts")
    print("  3. Comparar con FacebookLeads matches para detectar leads no capturados")
    print("  4. Investigar si hay interacciones de soporte previas al lead en Meta")

if __name__ == "__main__":
    main()
