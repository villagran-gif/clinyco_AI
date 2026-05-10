#!/usr/bin/env python3
"""
Análisis CAC: Meta Ads → Zendesk Support message history matching

Este script complementa el análisis de FacebookLeads usando una segunda fuente:
el historial de mensajes en Zendesk Support.

Objetivo:
- Extraer nombres de perfil del CSV Meta Ads
- Buscar esos nombres en el historial de Zendesk Support
- Matchear con requesters/usuarios en el sistema
- **Analizar TODOS los mensajes y verificar quién INICIÓ la conversación**
  (cliente desde Meta Ads vs agente proactivo)
- Enriquecer el análisis CAC con interacciones de soporte

Lógica de "conversation initiator":
- Cada ticket tiene un orden cronológico de comments
- El PRIMER comment determina quién inició la conversación
- author_id == requester_id → CLIENTE inició (inbound lead real)
- author_id != requester_id (es agente) → AGENTE inició (outbound proactivo)
- Channel del primer comment indica origen: email/web/chat/messenger/instagram/etc.

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


# ──────────────────────────────────────────────────────────────────────
# CACHE de roles de usuarios (evitar re-fetch del mismo agente N veces)
# ──────────────────────────────────────────────────────────────────────
USER_ROLE_CACHE = {}


def get_user_role(user_id):
    """
    Obtiene el rol de un usuario: 'end-user' (cliente), 'agent', 'admin'.
    Con caché para no re-pedir el mismo agente N veces.
    """
    if user_id in USER_ROLE_CACHE:
        return USER_ROLE_CACHE[user_id]

    data, err = zendesk_api("GET", f"/users/{user_id}.json")
    if data and 'user' in data:
        role = data['user'].get('role', 'unknown')
        USER_ROLE_CACHE[user_id] = role
        return role

    USER_ROLE_CACHE[user_id] = 'unknown'
    return 'unknown'


def fetch_ticket_comments(ticket_id):
    """
    Obtiene TODOS los comentarios de un ticket en orden cronológico.
    El primer comment es el que inició la conversación.
    """
    all_comments = []
    page = 1

    while True:
        data, err = zendesk_api("GET", f"/tickets/{ticket_id}/comments.json", {
            "page": page,
            "per_page": 100,
            "include_inline_images": "false"
        })

        if not data or 'comments' not in data:
            break

        comments = data['comments']
        if not comments:
            break

        all_comments.extend(comments)

        if not data.get('next_page'):
            break
        page += 1

    return all_comments


def analyze_conversation_initiator(ticket, comments):
    """
    Analiza quién inició la conversación basándose en el primer comment.

    Retorna dict con:
    - initiator_role: 'customer' | 'agent' | 'unknown'
    - initiator_id: user_id del primer autor
    - initiator_channel: canal del primer comment (email/web/messenger/etc.)
    - first_message_at: timestamp del primer comment
    - first_message_preview: primeros 200 chars del primer comment
    - total_messages: total de comentarios
    - customer_messages: cuántos son del cliente
    - agent_messages: cuántos son de agentes
    - response_time_seconds: tiempo entre primer y segundo mensaje (si existe)
    """
    if not comments:
        return {
            'initiator_role': 'unknown',
            'initiator_id': None,
            'initiator_channel': None,
            'first_message_at': None,
            'first_message_preview': None,
            'total_messages': 0,
            'customer_messages': 0,
            'agent_messages': 0,
            'response_time_seconds': None,
        }

    # Comments vienen ordenados cronológicamente por Zendesk
    first = comments[0]
    requester_id = ticket.get('requester_id')
    first_author_id = first.get('author_id')

    # Determinar rol del iniciador
    if first_author_id == requester_id:
        initiator_role = 'customer'
    else:
        # Es alguien diferente al requester → seguramente agente
        # Verificamos consultando el user role
        role = get_user_role(first_author_id)
        if role in ('agent', 'admin'):
            initiator_role = 'agent'
        elif role == 'end-user':
            # Otro cliente respondiendo (caso raro, e.g. CC)
            initiator_role = 'customer'
        else:
            initiator_role = 'unknown'

    # Canal del primer mensaje
    via = first.get('via', {})
    channel = via.get('channel', 'unknown') if isinstance(via, dict) else 'unknown'

    # Body preview
    body = first.get('plain_body') or first.get('body', '')
    body_preview = body[:200] if body else ''

    # Contar mensajes por tipo
    customer_count = 0
    agent_count = 0

    for c in comments:
        author = c.get('author_id')
        if author == requester_id:
            customer_count += 1
        else:
            role = get_user_role(author)
            if role in ('agent', 'admin'):
                agent_count += 1
            else:
                customer_count += 1

    # Tiempo de respuesta: primer mensaje → segundo mensaje
    response_time = None
    if len(comments) >= 2:
        try:
            t1 = datetime.fromisoformat(comments[0]['created_at'].replace('Z', '+00:00'))
            t2 = datetime.fromisoformat(comments[1]['created_at'].replace('Z', '+00:00'))
            response_time = (t2 - t1).total_seconds()
        except Exception:
            pass

    return {
        'initiator_role': initiator_role,
        'initiator_id': first_author_id,
        'initiator_channel': channel,
        'first_message_at': first.get('created_at'),
        'first_message_preview': body_preview,
        'total_messages': len(comments),
        'customer_messages': customer_count,
        'agent_messages': agent_count,
        'response_time_seconds': response_time,
    }


def search_zendesk_support_for_name(profile_name):
    """
    Busca tickets que mencionen el nombre del perfil y analiza sus mensajes.
    """
    results = {
        'tickets_with_analysis': [],
        'users_matching': [],
    }

    # 1. Buscar tickets con el nombre
    search_query = f'type:ticket "{profile_name}"'
    data, err = zendesk_api("GET", "/search.json", {"query": search_query})

    if data and 'results' in data:
        tickets = data['results'][:5]  # Top 5 tickets por nombre

        for ticket in tickets:
            ticket_id = ticket.get('id')
            if not ticket_id:
                continue

            # Obtener todos los comentarios del ticket
            comments = fetch_ticket_comments(ticket_id)

            # Analizar quién inició la conversación
            initiator_analysis = analyze_conversation_initiator(ticket, comments)

            results['tickets_with_analysis'].append({
                'ticket_id': ticket_id,
                'subject': ticket.get('subject'),
                'status': ticket.get('status'),
                'requester_id': ticket.get('requester_id'),
                'created_at': ticket.get('created_at'),
                'tags': ticket.get('tags', []),
                **initiator_analysis,
            })

    # 2. Buscar usuarios con ese nombre
    users_data, err = zendesk_api("GET", "/users/search.json", {
        "query": f'name:"{profile_name}"'
    })

    if users_data and 'users' in users_data:
        for user in users_data['users']:
            results['users_matching'].append({
                'user_id': user.get('id'),
                'name': user.get('name'),
                'email': user.get('email'),
                'phone': user.get('phone'),
                'role': user.get('role'),
                'created_at': user.get('created_at'),
            })

    return results


def main():
    print("\n=== 📊 Meta Ads → Zendesk Support: Conversation Initiator Analysis ===\n")

    # 1. Cargar CSV Meta
    csv_path = "/home/user/clinyco_AI/analysis/meta_ads_cac/leads_enero_mayo.csv"
    meta_leads = load_meta_csv(csv_path)

    if not meta_leads:
        print("❌ No se cargaron leads desde CSV")
        return

    # 2. Conectar a Zendesk Support
    print("\n📡 Conectando a Zendesk Support...")
    check, err = zendesk_api("GET", "/users/me.json")
    if check:
        me = check.get('user', {})
        print(f"✓ Conectado como: {me.get('name')} ({me.get('email')})")
    else:
        print(f"❌ Error conectando a Zendesk: {err}")
        return

    # 3. Buscar nombres + analizar quién inició cada conversación
    print("\n🔍 Buscando + analizando mensajes para detectar iniciador...\n")

    summary = defaultdict(int)
    initiator_breakdown = defaultdict(int)
    channel_breakdown = defaultdict(int)
    lead_results = []

    sample_leads = meta_leads[:30]

    for i, lead in enumerate(sample_leads, 1):
        profile_name = lead['name']
        print(f"[{i}/{len(sample_leads)}] {profile_name}...", end=" ", flush=True)

        results = search_zendesk_support_for_name(profile_name)
        tickets = results['tickets_with_analysis']

        if not tickets and not results['users_matching']:
            print("—")
            summary['no_match'] += 1
            continue

        summary['matched'] += 1

        # Acumular stats por iniciador y canal
        for t in tickets:
            initiator_breakdown[t['initiator_role']] += 1
            channel_breakdown[t.get('initiator_channel', 'unknown')] += 1

        # Resumen por lead
        if tickets:
            initiators = [t['initiator_role'] for t in tickets]
            customer_initiated = sum(1 for x in initiators if x == 'customer')
            agent_initiated = sum(1 for x in initiators if x == 'agent')

            label = []
            if customer_initiated:
                label.append(f"{customer_initiated} cliente")
            if agent_initiated:
                label.append(f"{agent_initiated} agente")

            print(f"✓ {len(tickets)} tickets [{', '.join(label) or 'unknown'}]")
        else:
            print(f"✓ {len(results['users_matching'])} usuarios (sin tickets)")

        lead_results.append({
            'meta_lead': lead,
            'tickets': tickets,
            'users': results['users_matching'],
        })

    # 4. Reporte final
    print("\n" + "="*70)
    print("📈 RESUMEN: ¿Quién inició las conversaciones?")
    print("="*70)

    total_tickets = sum(initiator_breakdown.values())

    print(f"\nLeads analizados: {len(sample_leads)}")
    print(f"  • Matcheados: {summary['matched']}")
    print(f"  • Sin match: {summary['no_match']}")

    print(f"\n🎯 Tickets analizados: {total_tickets}")
    if total_tickets > 0:
        for role, count in sorted(initiator_breakdown.items(), key=lambda x: -x[1]):
            pct = 100 * count / total_tickets
            emoji = {'customer': '👤', 'agent': '🧑‍💼', 'unknown': '❓'}.get(role, '•')
            print(f"  {emoji} {role:10}: {count} ({pct:.1f}%)")

    print(f"\n📡 Canal del primer mensaje:")
    if total_tickets > 0:
        for ch, count in sorted(channel_breakdown.items(), key=lambda x: -x[1]):
            pct = 100 * count / total_tickets
            print(f"  • {ch:15}: {count} ({pct:.1f}%)")

    # 5. Guardar resultados
    output_dir = "/home/user/clinyco_AI/analysis/meta_ads_cac/out"
    os.makedirs(output_dir, exist_ok=True)

    output_file = os.path.join(output_dir, "zendesk_support_matches.json")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'summary': {
                'total_leads_sampled': len(sample_leads),
                'matched': summary['matched'],
                'no_match': summary['no_match'],
                'total_tickets_analyzed': total_tickets,
                'initiator_breakdown': dict(initiator_breakdown),
                'channel_breakdown': dict(channel_breakdown),
            },
            'lead_results': lead_results,
        }, f, indent=2, ensure_ascii=False, default=str)

    print(f"\n✓ Resultados guardados en: {output_file}")

    # 6. Insights
    print("\n💡 Insights clave:")
    customer_initiated = initiator_breakdown.get('customer', 0)
    agent_initiated = initiator_breakdown.get('agent', 0)

    if total_tickets > 0:
        if customer_initiated > agent_initiated:
            print(f"  ✓ Mayoría de leads ({customer_initiated}/{total_tickets}) escribieron PRIMERO")
            print(f"    → Indica interés genuino desde Meta Ads")
        else:
            print(f"  ⚠️  Mayoría de tickets ({agent_initiated}/{total_tickets}) iniciados por agentes")
            print(f"    → Equipo está haciendo outreach proactivo")
            print(f"    → Lead quality desde Meta puede ser baja")

        if 'instagram' in channel_breakdown or 'facebook' in channel_breakdown:
            ig_fb = channel_breakdown.get('instagram', 0) + channel_breakdown.get('facebook', 0)
            print(f"  📲 {ig_fb} tickets vienen directamente de IG/FB → confirma origen Meta Ads")

if __name__ == "__main__":
    main()
