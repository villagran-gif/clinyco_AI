#!/usr/bin/env python3
"""
Análisis REAL: Meta Ads → Zendesk Support

Patrón identificado en los tickets:
  [1] PÁGINA (auto): "X respondió un anuncio."
  [2] PÁGINA (bot greeting): "¡Hola, X! ¿Cómo podemos ayudarte?"
  [3] CLIENTE (real): pregunta concreta
  [4] PÁGINA (bot info) o AGENTE (admin/agent role): respuesta
  [5+] conversación

Cada autor cae en uno de tres buckets:
  - "page"     → name contiene "Clinyco" o id == requester (Centro Médico)
  - "agent"    → role en {agent, admin}
  - "customer" → end-user que NO es la página

Métricas reales:
  - initiator_real = primer autor de bucket "customer"
  - has_real_agent_reply = ¿algún comment de bucket "agent"?
  - customer_message_count = comments de bucket "customer"
  - dropoff = customer_message_count == 1 (sólo escribió una vez)
  - cross_ref_csv: matching del nombre del customer con CSV Meta
"""

import os
import sys
import json
import csv
import time
import base64
import urllib.request
import urllib.error
from urllib.parse import quote
from datetime import datetime
from collections import defaultdict, Counter
import unicodedata

SUB = os.environ["ZENDESK_SUBDOMAIN"]
EMAIL = os.environ.get("ZENDESK_SUPPORT_EMAIL") or os.environ["ZENDESK_EMAIL"]
TOKEN = os.environ.get("ZENDESK_SUPPORT_TOKEN") or os.environ["ZENDESK_API_TOKEN"]

BASE = f"https://{SUB}.zendesk.com/api/v2"
AUTH = base64.b64encode(f"{EMAIL}/token:{TOKEN}".encode()).decode()

OUT_DIR = "/home/user/clinyco_AI/analysis/meta_ads_cac/out"
CSV_PATH = "/home/user/clinyco_AI/analysis/meta_ads_cac/leads_meta_actualizado.csv"

MAX_TICKETS = int(os.environ.get("MAX_TICKETS", "500"))


def api(path, retries=3):
    url = path if path.startswith("http") else f"{BASE}{path}"
    for attempt in range(retries):
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Basic {AUTH}", "Accept": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry = int(e.headers.get("retry-after", 60))
                time.sleep(retry)
                continue
            if e.code in (502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            return {"_error": f"{e.code}: {e.read().decode()[:200]}"}
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            return {"_error": str(e)}
    return {"_error": "max retries"}


USER_CACHE = {}


def get_user(uid):
    if uid is None:
        return {"role": "unknown", "name": None, "email": None}
    if uid in USER_CACHE:
        return USER_CACHE[uid]
    data = api(f"/users/{uid}.json")
    user = data.get("user", {}) if not data.get("_error") else {}
    info = {
        "role": user.get("role", "unknown"),
        "name": user.get("name"),
        "email": user.get("email"),
    }
    USER_CACHE[uid] = info
    return info


def classify_author(uid, requester_id):
    """Clasifica autor en: 'page', 'agent', 'customer', 'unknown'."""
    if uid is None:
        return "unknown"
    user = get_user(uid)
    name = (user.get("name") or "").lower()
    role = user.get("role", "unknown")

    # Es la página
    if uid == requester_id:
        # Verificar por nombre
        if "clinyco" in name or "centro" in name:
            return "page"
        # El requester es siempre la página en tickets de FB ads
        return "page"

    if "clinyco" in name or "centro médico" in name:
        return "page"

    if role in ("agent", "admin"):
        return "agent"

    if role == "end-user":
        return "customer"

    return "unknown"


def normalize_name(name):
    if not name:
        return ""
    nfd = unicodedata.normalize("NFD", name.lower())
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn").strip()


def extract_customer_from_subject(subject):
    """De 'Omar Morales respondió un anuncio.' → 'Omar Morales'."""
    if not subject:
        return None
    s = subject
    for marker in [" respondió un anuncio", " respondio un anuncio", " comentó", " envió un mensaje"]:
        if marker in s:
            return s.split(marker)[0].strip()
    return s.strip()


def load_meta_csv():
    by_name = defaultdict(list)
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            name = row.get("Nombre", "").strip()
            if not name:
                continue
            norm = normalize_name(name)
            by_name[norm].append({
                "name": name,
                "email": row.get("Correo electrónico", "").strip(),
                "phone": row.get("Teléfono", "").strip(),
                "channel": row.get("Canal", "").strip(),
                "stage": row.get("Etapa", "").strip(),
                "created": row.get("Fecha de creación", "").strip(),
                "form": row.get("Formulario", "").strip(),
            })
    print(f"✓ CSV Meta: {sum(len(v) for v in by_name.values())} leads, "
          f"{len(by_name)} nombres únicos")
    return by_name


def fetch_meta_ads_tickets(max_tickets):
    query = 'type:ticket subject:"respondió un anuncio"'
    tickets = []
    page = 1
    while len(tickets) < max_tickets:
        data = api(f"/search.json?query={quote(query)}&page={page}&per_page=100")
        if data.get("_error"):
            print(f"  ❌ {data['_error']}")
            break
        results = data.get("results", [])
        if not results:
            break
        tickets.extend(results)
        print(f"  page {page}: +{len(results)} (total: {len(tickets)})")
        if not data.get("next_page"):
            break
        page += 1
    return tickets[:max_tickets]


def fetch_comments(ticket_id):
    comments = []
    page = 1
    while True:
        data = api(f"/tickets/{ticket_id}/comments.json?page={page}&per_page=100")
        if data.get("_error"):
            return [], data["_error"]
        chunk = data.get("comments", [])
        if not chunk:
            break
        comments.extend(chunk)
        if not data.get("next_page"):
            break
        page += 1
    return comments, None


def analyze_ticket(ticket):
    tid = ticket.get("id")
    requester_id = ticket.get("requester_id")
    comments, err = fetch_comments(tid)

    customer_name_from_subject = extract_customer_from_subject(ticket.get("subject", ""))

    base = {
        "ticket_id": tid,
        "subject": ticket.get("subject"),
        "status": ticket.get("status"),
        "created_at": ticket.get("created_at"),
        "updated_at": ticket.get("updated_at"),
        "via_channel": (ticket.get("via") or {}).get("channel"),
        "tags": ticket.get("tags", []),
        "customer_name_from_subject": customer_name_from_subject,
        "total_messages": len(comments),
    }

    if err or not comments:
        base.update({
            "error": err,
            "real_initiator": "unknown",
            "page_messages": 0,
            "customer_messages": 0,
            "agent_messages": 0,
        })
        return base

    # Clasificar cada comment
    classified = []
    for c in comments:
        bucket = classify_author(c.get("author_id"), requester_id)
        classified.append({
            "author_id": c.get("author_id"),
            "bucket": bucket,
            "created_at": c.get("created_at"),
            "body": (c.get("plain_body") or c.get("body") or "")[:300],
        })

    # Identificar al cliente real (primer end-user que NO es página)
    real_customer_id = None
    real_customer_name = None
    real_first_msg_idx = None
    real_first_msg_at = None
    real_first_msg_body = None
    for i, c in enumerate(classified):
        if c["bucket"] == "customer":
            real_customer_id = c["author_id"]
            real_customer_name = get_user(c["author_id"])["name"]
            real_first_msg_idx = i
            real_first_msg_at = c["created_at"]
            real_first_msg_body = c["body"]
            break

    # Counts por bucket
    bucket_counts = Counter(c["bucket"] for c in classified)
    page_msgs = bucket_counts.get("page", 0)
    customer_msgs = bucket_counts.get("customer", 0)
    agent_msgs = bucket_counts.get("agent", 0)

    # ¿Hubo respuesta real de agente?
    has_agent_reply = agent_msgs > 0
    first_agent_at = None
    for c in classified:
        if c["bucket"] == "agent":
            first_agent_at = c["created_at"]
            break

    # Tiempo desde creación hasta respuesta real del agente
    time_to_agent_seconds = None
    if first_agent_at and ticket.get("created_at"):
        try:
            t0 = datetime.fromisoformat(ticket["created_at"].replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(first_agent_at.replace("Z", "+00:00"))
            time_to_agent_seconds = int((t1 - t0).total_seconds())
        except Exception:
            pass

    # Real initiator: technically es siempre el cliente (clickeó el ad), pero medimos
    # si el cliente realmente escribió algo (no solo el auto "respondió")
    if customer_msgs > 0:
        real_initiator = "customer_engaged"
    elif page_msgs > 0:
        real_initiator = "page_only"  # Solo auto-mensajes, cliente nunca escribió
    else:
        real_initiator = "unknown"

    # Engagement: cuántas veces el cliente escribió
    if customer_msgs == 0:
        engagement = "no_response"
    elif customer_msgs == 1:
        engagement = "single_question"
    elif customer_msgs <= 3:
        engagement = "brief_chat"
    else:
        engagement = "extended_chat"

    base.update({
        "real_initiator": real_initiator,
        "engagement_level": engagement,
        "real_customer_id": real_customer_id,
        "real_customer_name": real_customer_name,
        "real_first_msg_at": real_first_msg_at,
        "real_first_msg_preview": real_first_msg_body,
        "page_messages": page_msgs,
        "customer_messages": customer_msgs,
        "agent_messages": agent_msgs,
        "has_agent_reply": has_agent_reply,
        "time_to_agent_seconds": time_to_agent_seconds,
    })
    return base


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"\n{'='*70}")
    print(f"  ANÁLISIS REAL: Meta Ads → Zendesk Support")
    print(f"  MAX_TICKETS = {MAX_TICKETS}")
    print(f"{'='*70}\n")

    print("📂 Cargando CSV Meta...")
    meta_by_name = load_meta_csv()

    me = api("/users/me.json")
    print(f"📡 Conectado: {me.get('user', {}).get('name')}\n")

    print(f"🎯 Obteniendo tickets 'respondió un anuncio'...")
    tickets = fetch_meta_ads_tickets(MAX_TICKETS)
    print(f"  → {len(tickets)} tickets\n")

    print(f"🔍 Analizando mensajes...\n")
    analyses = []
    start = time.time()

    for i, t in enumerate(tickets, 1):
        a = analyze_ticket(t)

        # Cruce con CSV
        a["meta_csv_match"] = False
        for candidate in [a.get("real_customer_name"), a.get("customer_name_from_subject")]:
            norm = normalize_name(candidate or "")
            if norm and norm in meta_by_name:
                a["meta_csv_match"] = True
                a["meta_csv_data"] = meta_by_name[norm][0]
                break

        analyses.append(a)
        if i % 25 == 0 or i == len(tickets):
            elapsed = time.time() - start
            rate = i / elapsed if elapsed > 0 else 0
            eta = (len(tickets) - i) / rate if rate > 0 else 0
            print(f"  [{i}/{len(tickets)}] elapsed={int(elapsed)}s "
                  f"rate={rate:.1f}/s eta={int(eta)}s "
                  f"users_cached={len(USER_CACHE)}")

    # Métricas
    print(f"\n{'='*70}\n📊 MÉTRICAS REALES\n{'='*70}\n")

    n = len(analyses)
    initiators = Counter(a["real_initiator"] for a in analyses)
    engagements = Counter(a["engagement_level"] for a in analyses)
    statuses = Counter(a["status"] for a in analyses)

    customer_engaged = initiators.get("customer_engaged", 0)
    page_only = initiators.get("page_only", 0)

    has_agent = sum(1 for a in analyses if a.get("has_agent_reply"))
    no_agent = n - has_agent

    print(f"Tickets analizados: {n}")
    print()
    print("👥 ¿EL CLIENTE ESCRIBIÓ ALGO (no solo auto)?:")
    for k, c in initiators.most_common():
        pct = 100 * c / n
        emoji = {"customer_engaged": "✅", "page_only": "❌", "unknown": "❓"}.get(k, "•")
        label = {"customer_engaged": "Cliente escribió", "page_only": "Solo auto-mensajes (cliente NO respondió)"}.get(k, k)
        print(f"  {emoji} {label:55}: {c:5} ({pct:5.1f}%)")

    print(f"\n💬 ENGAGEMENT (cantidad de mensajes del cliente):")
    label_eng = {
        "no_response": "Cliente nunca escribió (clickeó pero no respondió)",
        "single_question": "Solo 1 mensaje (preguntó y se fue)",
        "brief_chat": "2-3 mensajes (conversación corta)",
        "extended_chat": "4+ mensajes (conversación seria)",
    }
    for k, c in engagements.most_common():
        pct = 100 * c / n
        print(f"  • {label_eng.get(k, k):55}: {c:5} ({pct:5.1f}%)")

    print(f"\n🧑‍💼 ¿RESPONDIÓ UN AGENTE REAL (no bot)?:")
    print(f"  ✅ Sí: {has_agent} ({100*has_agent/n:.1f}%)")
    print(f"  ❌ No (solo bot/página): {no_agent} ({100*no_agent/n:.1f}%)")

    times = [a["time_to_agent_seconds"] for a in analyses if a.get("time_to_agent_seconds")]
    if times:
        times.sort()
        median = times[len(times)//2]
        avg = sum(times) / len(times)
        print(f"\n⏱️  TIEMPO HASTA RESPUESTA DE AGENTE REAL:")
        print(f"  Mediana: {median//3600}h {(median%3600)//60}min")
        print(f"  Promedio: {int(avg)//3600}h")

    matched = sum(1 for a in analyses if a.get("meta_csv_match"))
    print(f"\n🔗 CRUCE CON CSV META ({sum(len(v) for v in meta_by_name.values())} leads):")
    print(f"  Tickets con cliente en CSV: {matched}/{n} ({100*matched/n:.1f}%)")

    print(f"\n📋 STATUS:")
    for s, c in statuses.most_common():
        print(f"  • {str(s):15}: {c:5} ({100*c/n:5.1f}%)")

    # Guardar
    print(f"\n💾 Guardando outputs...")
    with open(f"{OUT_DIR}/meta_tickets_full.json", "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": datetime.now().isoformat(),
            "max_tickets": MAX_TICKETS,
            "tickets_analyzed": n,
            "metrics": {
                "real_initiator": dict(initiators),
                "engagement_level": dict(engagements),
                "status": dict(statuses),
                "has_agent_reply": has_agent,
                "no_agent_reply": no_agent,
                "matched_with_csv": matched,
                "total_meta_csv_leads": sum(len(v) for v in meta_by_name.values()),
            },
            "tickets": analyses,
        }, f, indent=2, ensure_ascii=False, default=str)

    with open(f"{OUT_DIR}/meta_tickets_summary.csv", "w", encoding="utf-8", newline="") as f:
        cols = [
            "ticket_id", "created_at", "status", "subject",
            "customer_name_from_subject", "real_customer_name",
            "real_initiator", "engagement_level",
            "page_messages", "customer_messages", "agent_messages",
            "has_agent_reply", "time_to_agent_seconds",
            "meta_csv_match", "real_first_msg_preview",
        ]
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for a in analyses:
            w.writerow(a)

    print(f"  ✓ {OUT_DIR}/meta_tickets_full.json")
    print(f"  ✓ {OUT_DIR}/meta_tickets_summary.csv")

    write_report(analyses, initiators, engagements, statuses, has_agent, matched, meta_by_name)
    print(f"  ✓ {OUT_DIR}/conversation_initiators_report.md\n")
    print(f"⏱️  Tiempo total: {int(time.time() - start)}s")


def write_report(analyses, initiators, engagements, statuses, has_agent, matched, meta_by_name):
    n = len(analyses)
    no_agent = n - has_agent
    customer_engaged = initiators.get("customer_engaged", 0)
    page_only = initiators.get("page_only", 0)
    no_response = engagements.get("no_response", 0)
    single = engagements.get("single_question", 0)
    extended = engagements.get("extended_chat", 0)
    brief = engagements.get("brief_chat", 0)
    total_meta = sum(len(v) for v in meta_by_name.values())

    # Tiempo medio
    times = [a["time_to_agent_seconds"] for a in analyses if a.get("time_to_agent_seconds")]
    times.sort()
    median = times[len(times)//2] if times else None

    md = f"""# 📊 Análisis Real: ¿Quién inició las conversaciones de Meta Ads?

**Generado:** {datetime.now().strftime("%Y-%m-%d %H:%M")}
**Tickets analizados:** {n} (de un total de **6,644** con asunto "respondió un anuncio" en Zendesk Support)
**Leads CSV Meta:** {total_meta} (Abril 2024 → Mayo 2026)

---

## 🏗️ Arquitectura de la conversación (descubierta en el análisis)

Cada ticket de Meta Ads sigue este patrón en Zendesk Support (canal Facebook):

```
[1] PÁGINA (auto-system)   "X respondió un anuncio."
[2] PÁGINA (bot greeting)  "¡Hola, X! ¿Cómo podemos ayudarte?"
[3] CLIENTE (real)         pregunta concreta (¿costo? ¿requisitos?)
[4] PÁGINA (FAQ bot)       respuesta automática
[5] AGENTE REAL (admin)    intervención humana (si llega)
```

**El requester del ticket es la página de Facebook**, NO el cliente. El cliente
real aparece como un `end-user` separado cuya identidad sale en:
- El subject del ticket: `"X respondió un anuncio."`
- El author_id de los comments donde el cliente realmente escribe

---

## 🎯 ¿Quién INICIÓ realmente la conversación?

> Por construcción, todos los tickets se crean porque el cliente clickeó un anuncio.
> La pregunta real es: **¿el cliente escribió ALGO real, o solo se generó el ticket
> automático y nunca respondió?**

| Iniciador real | Tickets | % |
|---------------|---------|---|
| ✅ Cliente escribió mensajes reales | **{customer_engaged}** | **{100*customer_engaged/n:.1f}%** |
| ❌ Solo auto-mensajes (cliente nunca respondió) | {page_only} | {100*page_only/n:.1f}% |

"""

    if page_only > customer_engaged * 0.3:
        md += f"""
🚨 **{page_only} de {n} tickets ({100*page_only/n:.0f}%) son falsos leads**: el cliente
clickeó el anuncio (lo que disparó el ticket automático) pero NUNCA respondió
al saludo de la página. Estos leads son humo — no hay intención real.
"""
    else:
        md += f"""
✅ **{customer_engaged} de {n} ({100*customer_engaged/n:.0f}%) clientes sí escribieron** después
de clickear el anuncio. Esto es el universo real de leads de Meta.
"""

    md += f"""

---

## 💬 Profundidad del engagement del cliente

| Nivel | Tickets | % |
|-------|---------|---|
| ❌ Cliente nunca escribió | {no_response} | {100*no_response/n:.1f}% |
| 1️⃣ Solo 1 mensaje (preguntó y se fue) | {single} | {100*single/n:.1f}% |
| 💬 2-3 mensajes (conversación corta) | {brief} | {100*brief/n:.1f}% |
| ✅ 4+ mensajes (conversación seria) | {extended} | {100*extended/n:.1f}% |

**{extended} de {n} ({100*extended/n:.1f}%) tienen una conversación de calidad**
— estos son los leads reales con potencial de conversión a deal.

---

## 🧑‍💼 Atención del equipo: ¿respondió un agente real?

| | Tickets | % |
|--|---------|---|
| ✅ Agente real respondió | **{has_agent}** | **{100*has_agent/n:.1f}%** |
| ❌ Solo bot/página, sin humano | {no_agent} | {100*no_agent/n:.1f}% |

"""
    if median:
        md += f"""
⏱️  **Tiempo mediano hasta respuesta humana**: {median//3600}h {(median%3600)//60}min
"""

    md += f"""
---

## 🔗 Cruce con CSV Meta Ads

- Total leads en CSV: **{total_meta}**
- Tickets cuyo cliente real coincide con un nombre del CSV: **{matched}** ({100*matched/n:.1f}%)

> El cruce se hace tanto por **nombre del subject** ("X respondió un anuncio")
> como por **nombre del author del comment del cliente**, normalizado (sin acentos).

---

## 📋 Estado actual de los tickets

| Status | Tickets | % |
|--------|---------|---|
"""
    for s, c in statuses.most_common():
        md += f"| {s} | {c} | {100*c/n:.1f}% |\n"

    md += f"""

---

## 🎯 Conclusiones

1. **Falsos leads de Meta**: {page_only}/{n} ({100*page_only/n:.0f}%) clickearon
   el anuncio sin intención real — el ticket existe pero está vacío.

2. **Leads reales**: {customer_engaged}/{n} ({100*customer_engaged/n:.0f}%) escribieron
   al menos un mensaje. De estos:
   - {extended} ({100*extended/customer_engaged if customer_engaged else 0:.0f}%) tuvieron
     conversación seria (4+ mensajes) → candidatos a conversión.
   - {single + brief} ({100*(single+brief)/customer_engaged if customer_engaged else 0:.0f}%)
     conversación efímera → leads tibios.

3. **Capacidad de respuesta**: agentes reales respondieron en {has_agent}/{n}
   ({100*has_agent/n:.0f}%) tickets. Los otros {no_agent} ({100*no_agent/n:.0f}%) los
   manejó el bot/auto-reply o quedaron sin respuesta.

4. **CAC efectivo**: Si solo {customer_engaged} de cada {n} tickets son leads reales,
   el costo por lead REAL es ~{n/customer_engaged:.1f}× lo que reporta Meta.
   Cruzar con `analyze_cac_facebookleads.py` para ver cuántos de estos llegaron
   a deal "CERRADO OPERADO" → ese es el CAC verdadero.

---

## 🛠️ Para escalar a los 6,644 tickets totales

```bash
export MAX_TICKETS=6644
python3 run_real_analysis.py
```

A ~{n / (max(1, sum(1 for a in analyses if a.get('total_messages',0)>0)) / 60):.0f}s por ticket,
el análisis completo tarda aproximadamente {int(6644 * (sum(a.get('total_messages',0) for a in analyses) / max(1,n)) / 60)} minutos.
"""

    with open(f"{OUT_DIR}/conversation_initiators_report.md", "w", encoding="utf-8") as f:
        f.write(md)


if __name__ == "__main__":
    main()
