#!/usr/bin/env python3
"""
Análisis CAC real: leads Meta Ads → conversiones Zendesk Sell.

Flujo:
  1. Lee CSV de leads de Meta Ads (Lead Center export).
  2. Descarga deals de Zendesk Sell vía API (o lee export CSV alternativo).
  3. Normaliza nombres, emails, teléfonos chilenos.
  4. Matching multi-capa (email > teléfono > nombre+fecha > fuzzy).
  5. Calcula CAC real, tasa conversión, LTV, payback, ciclo de venta.
  6. Genera reportes Excel/CSV y resumen ejecutivo Markdown.

Uso:
  # Vía API Zendesk Sell
  ZENDESK_SELL_API_TOKEN=xxx python3 analyze_cac.py \\
      --leads-csv leads_enero_mayo.csv \\
      --gasto-clp 4529962 \\
      --periodo-inicio 2026-01-01 --periodo-fin 2026-05-10 \\
      --output-dir ./out

  # Sin API: usar export CSV de deals (col first_name,last_name,email,mobile,phone,id,stage_id,value,created_at)
  python3 analyze_cac.py \\
      --leads-csv leads_enero_mayo.csv \\
      --deals-csv export_deals_zendesk.csv \\
      --gasto-clp 4529962 \\
      --periodo-inicio 2026-01-01 --periodo-fin 2026-05-10
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import pandas as pd
import requests
from dateutil import parser as dtparser
from rapidfuzz import fuzz

TZ_CHILE = "America/Santiago"
ZENDESK_BASE = "https://api.getbase.com/v2"

# Pipelines en Zendesk Sell (extraído de sell-medinet-backend/migration/import-from-zendesk.py)
PIPELINES = {
    1290779: "Bariátrica",
    4823817: "Balón",
    4959507: "Plástica",
    5049979: "General",
}

# Stages que cuentan como conversión (won/cerrado-ganado).
# Se resuelven dinámicamente desde la API; estos nombres son fallback heurístico.
WON_STAGE_NAMES = {"won", "ganado", "cerrado-ganado", "cerrado ganado", "closed won"}

# ─────────────────────────────────────────────────────────────────────────────
# Normalización
# ─────────────────────────────────────────────────────────────────────────────

_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"  # symbols & pictographs
    "\U00002600-\U000027BF"  # misc symbols & dingbats
    "\U0001F000-\U0001F02F"
    "\U0001F680-\U0001F6FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA70-\U0001FAFF"
    "]+",
    flags=re.UNICODE,
)


def strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )


def normalize_name(s) -> str:
    """Lowercase, sin acentos/emojis/caracteres mathematical-alphanum, single-spaced."""
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    s = str(s)
    # Reemplazar variantes Unicode mathematical-alphanum por su equivalente ASCII
    s = unicodedata.normalize("NFKC", s)
    s = _EMOJI_RE.sub(" ", s)
    s = strip_accents(s)
    s = s.lower()
    # Quitar todo lo que no sea letra/dígito/espacio
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_email(s) -> str:
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    s = str(s).strip().lower()
    if "@" not in s:
        return ""
    return re.sub(r"\s+", "", s)


def normalize_phone_cl(s) -> str:
    """Normaliza a E.164 chileno (+569XXXXXXXX). Devuelve '' si inválido."""
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    digits = re.sub(r"\D", "", str(s))
    if not digits:
        return ""
    # Móvil chileno: 9 dígitos comenzando en 9 (sin código país)
    if len(digits) == 9 and digits.startswith("9"):
        return f"+56{digits}"
    # Con código país
    if len(digits) == 11 and digits.startswith("56"):
        return f"+{digits}"
    if len(digits) == 12 and digits.startswith("569"):  # raro pero ocurre
        return f"+{digits[1:]}"  # quita un dígito espurio
    # Fijo chileno (8 dígitos) o desconocido: devolver +56 + dígitos
    if 8 <= len(digits) <= 12:
        return f"+{digits}" if digits.startswith("56") else f"+56{digits}"
    return ""


def parse_dt(s) -> pd.Timestamp | None:
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return None
    if isinstance(s, pd.Timestamp):
        return s.tz_convert(TZ_CHILE) if s.tzinfo else s.tz_localize(TZ_CHILE)
    try:
        dt = dtparser.parse(str(s), dayfirst=False)
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)  # asumimos UTC si naive
    return pd.Timestamp(dt).tz_convert(TZ_CHILE)


# ─────────────────────────────────────────────────────────────────────────────
# Carga de leads Meta
# ─────────────────────────────────────────────────────────────────────────────

LEAD_COLS = {
    "Fecha de creación": "fecha_lead",
    "Nombre": "nombre",
    "Correo electrónico": "email",
    "Origen": "origen",
    "Formulario": "formulario",
    "Canal": "canal",
    "Etapa": "etapa_lead",
    "Etiquetas": "etiquetas",
    "Teléfono": "telefono",
    "Número de teléfono secundario": "telefono_2",
    "Número de WhatsApp": "whatsapp",
}


def load_meta_leads(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8-sig", dtype=str).fillna("")
    df.columns = [c.strip() for c in df.columns]
    df = df.rename(columns=LEAD_COLS)
    # Algunos exports vienen con doble espacio al final (visible en el snippet original)
    df = df.applymap(lambda v: v.strip() if isinstance(v, str) else v)

    df["fecha_lead_dt"] = df["fecha_lead"].apply(parse_dt)
    df["nombre_norm"] = df["nombre"].apply(normalize_name)
    df["email_norm"] = df["email"].apply(normalize_email)
    df["telefono_norm"] = df.apply(
        lambda r: normalize_phone_cl(r["telefono"])
        or normalize_phone_cl(r["whatsapp"])
        or normalize_phone_cl(r["telefono_2"]),
        axis=1,
    )
    # Extraer ad_id de etiquetas (ej: "ad_id.120236558435240044")
    df["ad_id"] = df["etiquetas"].apply(
        lambda s: (m.group(1) if (m := re.search(r"ad_id[._](\d+)", str(s))) else "")
    )
    df["lead_id_meta"] = df.index.astype(str)
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Zendesk Sell API
# ─────────────────────────────────────────────────────────────────────────────


def zendesk_get(path: str, token: str) -> dict:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    url = f"{ZENDESK_BASE}{path}"
    for attempt in range(4):
        r = requests.get(url, headers=headers, timeout=30)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 429 or r.status_code >= 500:
            wait = 2 ** attempt
            print(f"  retry {attempt+1}/4 [{r.status_code}] sleep {wait}s", file=sys.stderr)
            time.sleep(wait)
            continue
        raise RuntimeError(f"Zendesk {url} → {r.status_code}: {r.text[:200]}")
    raise RuntimeError(f"Zendesk {url} → exhausted retries")


def fetch_all_deals(token: str, since: pd.Timestamp | None = None) -> pd.DataFrame:
    """Pagina /v2/deals. Trae sólo los necesarios: id, name, contact_id, value,
    pipeline_id, stage_id, created_at, last_activity_at, custom_fields.
    """
    print("Descargando deals desde Zendesk Sell...")
    rows = []
    page = 1
    per_page = 100
    while True:
        data = zendesk_get(f"/deals?per_page={per_page}&page={page}", token)
        items = data.get("items", [])
        if not items:
            break
        for it in items:
            d = it.get("data", {})
            cf = d.get("custom_fields") or {}
            rows.append({
                "deal_id": d.get("id"),
                "deal_name": d.get("name"),
                "contact_id": d.get("contact_id"),
                "value": d.get("value"),
                "currency": d.get("currency"),
                "pipeline_id": d.get("pipeline_id"),
                "stage_id": d.get("stage_id"),
                "created_at": d.get("created_at"),
                "last_stage_change_at": d.get("last_stage_change_at"),
                "estimated_close_date": d.get("estimated_close_date"),
                "fecha_cirugia": cf.get("FECHA DE CIRUGÍA"),
                "honorarios": cf.get("HONORARIOS"),
                "rut": cf.get("RUT_normalizado") or cf.get("RUT o ID") or cf.get("RUT O ID"),
                "prevision": cf.get("Previsión") or cf.get("previsión") or cf.get("PREVISION"),
                "cirugia_procedimiento": cf.get("CIRUGIA / PROCEDIMIENTO"),
            })
        print(f"  page {page}: {len(items)} deals (acum {len(rows)})")
        if len(items) < per_page:
            break
        page += 1
    return pd.DataFrame(rows)


def fetch_all_contacts(token: str, ids: Iterable[int]) -> pd.DataFrame:
    """Trae contacts en lotes de 100 por ?ids=1,2,3..."""
    ids = sorted({int(i) for i in ids if i is not None and not pd.isna(i)})
    print(f"Descargando {len(ids)} contacts...")
    rows = []
    for i in range(0, len(ids), 100):
        chunk = ids[i:i+100]
        data = zendesk_get(f"/contacts?ids={','.join(map(str,chunk))}", token)
        for it in data.get("items", []):
            c = it.get("data", {})
            rows.append({
                "contact_id": c.get("id"),
                "first_name": c.get("first_name"),
                "last_name": c.get("last_name"),
                "name": c.get("name"),
                "email": c.get("email"),
                "phone": c.get("phone"),
                "mobile": c.get("mobile"),
            })
    return pd.DataFrame(rows)


def fetch_pipelines_and_stages(token: str) -> pd.DataFrame:
    print("Descargando pipelines y stages...")
    pls = zendesk_get("/pipelines", token).get("items", [])
    stages = zendesk_get("/stages?per_page=100", token).get("items", [])
    rows = []
    pl_by_id = {p["data"]["id"]: p["data"] for p in pls}
    for s in stages:
        d = s.get("data", {})
        rows.append({
            "stage_id": d.get("id"),
            "stage_name": d.get("name"),
            "category": d.get("category"),  # incoming|qualifying|won|lost|unqualified
            "pipeline_id": d.get("pipeline_id"),
            "pipeline_name": pl_by_id.get(d.get("pipeline_id"), {}).get("name"),
            "position": d.get("position"),
        })
    return pd.DataFrame(rows)


# ─────────────────────────────────────────────────────────────────────────────
# Carga alternativa: deals export CSV (si no hay API)
# ─────────────────────────────────────────────────────────────────────────────


def load_deals_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str).fillna("")
    df.columns = [c.strip() for c in df.columns]
    return df


def enrich_deals(deals: pd.DataFrame, contacts: pd.DataFrame, stages: pd.DataFrame) -> pd.DataFrame:
    df = deals.merge(contacts, on="contact_id", how="left")
    df = df.merge(stages[["stage_id", "stage_name", "category", "pipeline_name"]],
                  on="stage_id", how="left")

    # Construir nombre desde first/last si "name" está vacío
    def _name(r):
        if r.get("name"):
            return r["name"]
        fn = (r.get("first_name") or "").strip()
        ln = (r.get("last_name") or "").strip()
        return (fn + " " + ln).strip()
    df["contact_name"] = df.apply(_name, axis=1)

    df["created_at_dt"] = df["created_at"].apply(parse_dt)
    df["fecha_cirugia_dt"] = df["fecha_cirugia"].apply(parse_dt)
    df["last_stage_change_dt"] = df["last_stage_change_at"].apply(parse_dt)

    # Una conversión = stage category 'won' o fecha_cirugia presente
    df["is_won"] = (
        df["category"].fillna("").str.lower().eq("won")
        | df["fecha_cirugia_dt"].notna()
    )
    df["fecha_conversion"] = df.apply(
        lambda r: r["fecha_cirugia_dt"] or r["last_stage_change_dt"] or r["created_at_dt"],
        axis=1,
    )

    df["contact_name_norm"] = df["contact_name"].apply(normalize_name)
    df["email_norm"] = df["email"].apply(normalize_email)
    df["phone_norm"] = df.apply(
        lambda r: normalize_phone_cl(r.get("mobile")) or normalize_phone_cl(r.get("phone")),
        axis=1,
    )

    def _value_clp(r):
        v = r.get("value")
        h = r.get("honorarios")
        try:
            if h not in (None, "", "0"):
                return float(str(h).replace(",", "."))
            if v not in (None, ""):
                return float(v)
        except (ValueError, TypeError):
            pass
        return 0.0
    df["valor_clp"] = df.apply(_value_clp, axis=1)

    return df


# ─────────────────────────────────────────────────────────────────────────────
# Matching multi-capa
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class MatchResult:
    lead_idx: int
    deal_idx: int
    score: int  # 100/90/70/40
    rule: str
    days_to_conv: float | None = None


def build_indexes(deals: pd.DataFrame) -> dict:
    """Indexes para lookup O(1) por email y teléfono."""
    by_email = {}
    by_phone = {}
    for i, r in deals.iterrows():
        if r["email_norm"]:
            by_email.setdefault(r["email_norm"], []).append(i)
        if r["phone_norm"]:
            by_phone.setdefault(r["phone_norm"], []).append(i)
    return {"email": by_email, "phone": by_phone}


def pick_best_deal(lead_dt, candidates_idx, deals: pd.DataFrame) -> tuple[int, float]:
    """Entre candidatos, elige el deal cuya fecha_creación esté más cerca
    (y posterior) al lead. Devuelve (idx, days_to_conv)."""
    best = None
    best_days = None
    for di in candidates_idx:
        d_dt = deals.at[di, "fecha_conversion"] or deals.at[di, "created_at_dt"]
        if d_dt is None or lead_dt is None:
            continue
        days = (d_dt - lead_dt).total_seconds() / 86400
        # Preferir conversiones posteriores al lead, pero permitir negativas pequeñas (-7 días)
        # para tolerar leads tardíos cargados al CRM antes que Meta los registre.
        score_days = abs(days) if days >= -7 else float("inf")
        if best is None or score_days < (abs(best_days) if best_days is not None else float("inf")):
            best = di
            best_days = days
    return (best, best_days) if best is not None else (None, None)


def match(leads: pd.DataFrame, deals: pd.DataFrame, fuzzy_threshold: int = 88,
          name_window_days: int = 90) -> tuple[list[MatchResult], set[int]]:
    idx = build_indexes(deals)
    matched_deal_ids: set[int] = set()
    results: list[MatchResult] = []

    for li, lead in leads.iterrows():
        lead_dt = lead["fecha_lead_dt"]

        # Capa 1: email
        if lead["email_norm"] and lead["email_norm"] in idx["email"]:
            cand = [c for c in idx["email"][lead["email_norm"]] if c not in matched_deal_ids]
            di, days = pick_best_deal(lead_dt, cand, deals)
            if di is not None:
                matched_deal_ids.add(di)
                results.append(MatchResult(li, di, 100, "email_exacto", days))
                continue

        # Capa 2: teléfono
        if lead["telefono_norm"] and lead["telefono_norm"] in idx["phone"]:
            cand = [c for c in idx["phone"][lead["telefono_norm"]] if c not in matched_deal_ids]
            di, days = pick_best_deal(lead_dt, cand, deals)
            if di is not None:
                matched_deal_ids.add(di)
                results.append(MatchResult(li, di, 90, "telefono_exacto", days))
                continue

        # Capa 3 + 4: nombre (exacto o fuzzy) en ventana temporal
        if lead["nombre_norm"] and lead_dt is not None:
            best_idx = None
            best_score = 0
            best_days = None
            best_rule = ""
            for di, deal in deals.iterrows():
                if di in matched_deal_ids:
                    continue
                d_name = deal["contact_name_norm"]
                d_dt = deal["fecha_conversion"] or deal["created_at_dt"]
                if not d_name or d_dt is None:
                    continue
                days = (d_dt - lead_dt).total_seconds() / 86400
                if abs(days) > name_window_days:
                    continue
                if d_name == lead["nombre_norm"]:
                    score, rule = 70, "nombre_exacto+ventana"
                else:
                    sim = fuzz.token_set_ratio(d_name, lead["nombre_norm"])
                    if sim < fuzzy_threshold:
                        continue
                    score, rule = 40, f"nombre_fuzzy({sim})+ventana"
                # Empata por proximidad temporal
                if score > best_score or (score == best_score and (best_days is None or abs(days) < abs(best_days))):
                    best_idx, best_score, best_days, best_rule = di, score, days, rule
            if best_idx is not None:
                matched_deal_ids.add(best_idx)
                results.append(MatchResult(li, best_idx, best_score, best_rule, best_days))

    return results, matched_deal_ids


# ─────────────────────────────────────────────────────────────────────────────
# Métricas y reportes
# ─────────────────────────────────────────────────────────────────────────────


def compute_metrics(
    leads: pd.DataFrame,
    deals: pd.DataFrame,
    matches: list[MatchResult],
    matched_deals: set[int],
    gasto_clp: float,
    inicio: pd.Timestamp,
    fin: pd.Timestamp,
) -> dict:
    total_leads = len(leads)
    # Conversiones = deals con is_won=True que matchearon con un lead
    won_matched = [m for m in matches if deals.at[m.deal_idx, "is_won"]]
    conversiones = len(won_matched)
    cpl_meta = gasto_clp / total_leads if total_leads else 0
    cac_real = gasto_clp / conversiones if conversiones else float("inf")
    tasa = conversiones / total_leads * 100 if total_leads else 0

    valor_total = sum(deals.at[m.deal_idx, "valor_clp"] for m in won_matched)
    ltv = valor_total / conversiones if conversiones else 0
    ratio_ltv_cac = (ltv / cac_real) if cac_real and cac_real != float("inf") else 0

    ciclos = [m.days_to_conv for m in won_matched if m.days_to_conv is not None]
    ciclo_promedio = sum(ciclos) / len(ciclos) if ciclos else 0

    return {
        "periodo": f"{inicio.date()} a {fin.date()}",
        "gasto_clp": int(round(gasto_clp)),
        "total_leads": total_leads,
        "conversiones": conversiones,
        "tasa_conversion_pct": round(tasa, 2),
        "cpl_meta_clp": int(round(cpl_meta)),
        "cac_real_clp": int(round(cac_real)) if cac_real != float("inf") else None,
        "brecha_cac_vs_cpl": (
            int(round(cac_real - cpl_meta)) if cac_real != float("inf") else None
        ),
        "valor_total_clp": int(round(valor_total)),
        "ltv_promedio_clp": int(round(ltv)),
        "ratio_ltv_cac": round(ratio_ltv_cac, 2),
        "ciclo_venta_dias_promedio": round(ciclo_promedio, 1),
        "matches_total": len(matches),
        "matches_score_100": sum(1 for m in matches if m.score == 100),
        "matches_score_90": sum(1 for m in matches if m.score == 90),
        "matches_score_70": sum(1 for m in matches if m.score == 70),
        "matches_score_40": sum(1 for m in matches if m.score == 40),
    }


def breakdown_by_pipeline(deals: pd.DataFrame, matches: list[MatchResult],
                          gasto_clp: float, total_leads: int) -> pd.DataFrame:
    # Asume gasto distribuido proporcional a leads por pipeline (heurística);
    # mejor: dividir el gasto Meta por campaña/conjunto si hay metadata.
    won = [m for m in matches if deals.at[m.deal_idx, "is_won"]]
    rows = []
    for pl_name in deals["pipeline_name"].dropna().unique():
        won_pl = [m for m in won if deals.at[m.deal_idx, "pipeline_name"] == pl_name]
        if not won_pl:
            continue
        # leads: aproximación = matches_pl/total_matches × total_leads
        leads_pl = len(won_pl) / max(len(won), 1) * total_leads
        gasto_pl = leads_pl / total_leads * gasto_clp if total_leads else 0
        cac_pl = gasto_pl / len(won_pl) if won_pl else 0
        rows.append({
            "pipeline": pl_name,
            "conversiones": len(won_pl),
            "leads_aprox": round(leads_pl),
            "gasto_aprox_clp": int(round(gasto_pl)),
            "cac_clp": int(round(cac_pl)),
            "valor_total_clp": int(round(
                sum(deals.at[m.deal_idx, "valor_clp"] for m in won_pl)
            )),
        })
    return pd.DataFrame(rows).sort_values("cac_clp")


def breakdown_by_ad(leads: pd.DataFrame, matches: list[MatchResult],
                    deals: pd.DataFrame) -> pd.DataFrame:
    matched_lead_ids = {m.lead_idx for m in matches if deals.at[m.deal_idx, "is_won"]}
    rows = []
    for ad_id, grp in leads.groupby("ad_id"):
        if not ad_id:
            ad_id = "(sin ad_id)"
        leads_n = len(grp)
        conv_n = sum(1 for li in grp.index if li in matched_lead_ids)
        rows.append({
            "ad_id": ad_id,
            "leads": leads_n,
            "conversiones": conv_n,
            "tasa_conv_pct": round(conv_n / leads_n * 100, 2) if leads_n else 0,
        })
    return pd.DataFrame(rows).sort_values(["conversiones", "leads"], ascending=False)


def detect_anomalies(matches: list[MatchResult], deals: pd.DataFrame,
                     leads: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for m in matches:
        days = m.days_to_conv
        if days is None:
            continue
        if days < -7:
            rows.append({
                "motivo": "deal_anterior_a_lead",
                "lead_nombre": leads.at[m.lead_idx, "nombre"],
                "deal_nombre": deals.at[m.deal_idx, "contact_name"],
                "deal_id": deals.at[m.deal_idx, "deal_id"],
                "days": round(days, 1),
                "score": m.score,
                "rule": m.rule,
            })
    return pd.DataFrame(rows)


def write_excel(out_path: Path, sheets: dict[str, pd.DataFrame]) -> None:
    with pd.ExcelWriter(out_path, engine="openpyxl") as w:
        for name, df in sheets.items():
            (df if isinstance(df, pd.DataFrame) else pd.DataFrame(df)).to_excel(
                w, sheet_name=name[:31], index=False
            )


def render_resumen_md(metrics: dict, by_pl: pd.DataFrame, by_ad: pd.DataFrame,
                      anomalias: pd.DataFrame) -> str:
    parts = []
    parts.append("# Análisis CAC: Meta Ads → Conversiones Zendesk Sell\n")
    parts.append(f"**Periodo:** {metrics['periodo']}  ")
    parts.append(f"**Gasto Meta Ads:** ${metrics['gasto_clp']:,} CLP\n")
    parts.append("## Embudo\n")
    parts.append(f"- Leads totales (Meta): **{metrics['total_leads']:,}**")
    parts.append(f"- Conversiones (CRM, won): **{metrics['conversiones']:,}**")
    parts.append(f"- Tasa de conversión: **{metrics['tasa_conversion_pct']}%**")
    parts.append(f"- CPL reportado por Meta: **${metrics['cpl_meta_clp']:,} CLP**")
    cac_str = (f"${metrics['cac_real_clp']:,} CLP"
               if metrics['cac_real_clp'] is not None else "N/A (0 conversiones)")
    parts.append(f"- **CAC real**: **{cac_str}**")
    if metrics['brecha_cac_vs_cpl'] is not None:
        parts.append(f"- Brecha CAC − CPL: **${metrics['brecha_cac_vs_cpl']:,} CLP**")
    parts.append(f"- Valor facturado total: ${metrics['valor_total_clp']:,} CLP")
    parts.append(f"- LTV inicial promedio: ${metrics['ltv_promedio_clp']:,} CLP")
    parts.append(f"- Ratio LTV/CAC: {metrics['ratio_ltv_cac']}")
    parts.append(f"- Ciclo de venta promedio: {metrics['ciclo_venta_dias_promedio']} días\n")
    parts.append("## Calidad del matching\n")
    parts.append(f"- Matches totales: {metrics['matches_total']}")
    parts.append(f"  - Email exacto (score 100): {metrics['matches_score_100']}")
    parts.append(f"  - Teléfono exacto (90): {metrics['matches_score_90']}")
    parts.append(f"  - Nombre+ventana (70): {metrics['matches_score_70']}")
    parts.append(f"  - Fuzzy (40, validar manual): {metrics['matches_score_40']}\n")
    if not by_pl.empty:
        parts.append("## CAC por Pipeline (orden ascendente)\n")
        parts.append(by_pl.to_markdown(index=False))
        parts.append("")
    if not by_ad.empty:
        parts.append("## Top 10 ad_id por conversiones\n")
        parts.append(by_ad.head(10).to_markdown(index=False))
        parts.append("")
    if not anomalias.empty:
        parts.append(f"## Anomalías ({len(anomalias)})\n")
        parts.append(anomalias.head(20).to_markdown(index=False))
        parts.append("")
    return "\n".join(parts) + "\n"


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--leads-csv", required=True, type=Path,
                    help="CSV exportado de Meta Lead Center")
    ap.add_argument("--deals-csv", type=Path,
                    help="CSV alternativo de deals si no se usa API")
    ap.add_argument("--gasto-clp", required=True, type=float,
                    help="Gasto total Meta Ads en CLP")
    ap.add_argument("--periodo-inicio", required=True,
                    help="Fecha inicio YYYY-MM-DD")
    ap.add_argument("--periodo-fin", required=True,
                    help="Fecha fin YYYY-MM-DD")
    ap.add_argument("--output-dir", type=Path, default=Path("./out"))
    ap.add_argument("--fuzzy-threshold", type=int, default=88,
                    help="Umbral 0-100 fuzzy nombre (default 88)")
    ap.add_argument("--ventana-dias", type=int, default=90,
                    help="Ventana ± días para matching por nombre (default 90)")
    args = ap.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)

    inicio = pd.Timestamp(args.periodo_inicio, tz=TZ_CHILE)
    fin = pd.Timestamp(args.periodo_fin, tz=TZ_CHILE)

    print(f"\n=== Cargando leads de Meta desde {args.leads_csv} ===")
    leads = load_meta_leads(args.leads_csv)
    leads_in = leads[(leads["fecha_lead_dt"] >= inicio) & (leads["fecha_lead_dt"] <= fin)].reset_index(drop=True)
    print(f"  Leads totales: {len(leads)} | dentro del periodo: {len(leads_in)}")
    print(f"  Con email: {(leads_in['email_norm']!='').sum()} | con tel: {(leads_in['telefono_norm']!='').sum()}")

    # Cargar deals
    if args.deals_csv:
        print(f"\n=== Cargando deals desde {args.deals_csv} ===")
        deals = load_deals_csv(args.deals_csv)
        # Asume export con cols: id,name,contact_id,email,mobile,phone,value,pipeline_id,stage_id,stage_name,category,created_at,fecha_cirugia,honorarios
        # Renombrar para compatibilidad con enrich_deals
        rename = {"id": "deal_id", "name": "deal_name"}
        deals = deals.rename(columns=rename)
        contacts = pd.DataFrame()
        stages = pd.DataFrame()
        deals = enrich_deals(deals, contacts, stages)
    else:
        token = os.environ.get("ZENDESK_SELL_API_TOKEN")
        if not token:
            sys.exit("ERROR: ZENDESK_SELL_API_TOKEN no seteado y no se pasó --deals-csv")
        stages = fetch_pipelines_and_stages(token)
        deals_raw = fetch_all_deals(token)
        contacts = fetch_all_contacts(token, deals_raw["contact_id"].dropna().unique())
        deals = enrich_deals(deals_raw, contacts, stages)
        # Guardar caches por si se quiere re-ejecutar sin volver a llamar API
        deals.to_csv(args.output_dir / "_cache_deals.csv", index=False)
        contacts.to_csv(args.output_dir / "_cache_contacts.csv", index=False)
        stages.to_csv(args.output_dir / "_cache_stages.csv", index=False)

    print(f"\n=== Deals: {len(deals)} | Won: {deals['is_won'].sum()} ===")

    print(f"\n=== Matching (fuzzy>={args.fuzzy_threshold}, ventana ±{args.ventana_dias}d) ===")
    matches, matched_deal_ids = match(
        leads_in, deals,
        fuzzy_threshold=args.fuzzy_threshold,
        name_window_days=args.ventana_dias,
    )
    print(f"  matches: {len(matches)}")

    metrics = compute_metrics(leads_in, deals, matches, matched_deal_ids,
                              args.gasto_clp, inicio, fin)
    by_pl = breakdown_by_pipeline(deals, matches, args.gasto_clp, len(leads_in))
    by_ad = breakdown_by_ad(leads_in, matches, deals)
    anomalias = detect_anomalies(matches, deals, leads_in)

    # DataFrames de output
    matches_df = pd.DataFrame([{
        "lead_idx": m.lead_idx,
        "lead_nombre": leads_in.at[m.lead_idx, "nombre"],
        "lead_canal": leads_in.at[m.lead_idx, "canal"],
        "lead_fecha": leads_in.at[m.lead_idx, "fecha_lead"],
        "deal_id": deals.at[m.deal_idx, "deal_id"],
        "deal_nombre": deals.at[m.deal_idx, "contact_name"],
        "deal_pipeline": deals.at[m.deal_idx, "pipeline_name"],
        "deal_stage": deals.at[m.deal_idx, "stage_name"],
        "is_won": deals.at[m.deal_idx, "is_won"],
        "valor_clp": deals.at[m.deal_idx, "valor_clp"],
        "days_to_conv": round(m.days_to_conv, 1) if m.days_to_conv is not None else None,
        "score": m.score,
        "rule": m.rule,
    } for m in matches])

    matched_lead_ids = {m.lead_idx for m in matches}
    leads_no_conv = leads_in.loc[~leads_in.index.isin(matched_lead_ids),
                                   ["fecha_lead", "nombre", "canal", "email", "telefono", "ad_id"]]

    deals_sin_lead = deals.loc[
        deals["is_won"] & ~deals.index.isin(matched_deal_ids),
        ["deal_id", "contact_name", "pipeline_name", "stage_name", "fecha_cirugia", "valor_clp"]
    ]

    # Escribir Excel
    write_excel(args.output_dir / "reporte_cac.xlsx", {
        "resumen": pd.DataFrame([metrics]).T.reset_index().rename(columns={"index": "métrica", 0: "valor"}),
        "matches": matches_df,
        "leads_no_convertidos": leads_no_conv,
        "deals_sin_lead": deals_sin_lead,
        "by_pipeline": by_pl,
        "by_ad_id": by_ad,
        "anomalias": anomalias,
    })

    # CSVs individuales
    matches_df.to_csv(args.output_dir / "matches.csv", index=False)
    leads_no_conv.to_csv(args.output_dir / "leads_no_convertidos.csv", index=False)
    deals_sin_lead.to_csv(args.output_dir / "deals_sin_lead.csv", index=False)
    anomalias.to_csv(args.output_dir / "anomalias.csv", index=False)

    # Resumen markdown
    md = render_resumen_md(metrics, by_pl, by_ad, anomalias)
    (args.output_dir / "RESUMEN_EJECUTIVO.md").write_text(md, encoding="utf-8")

    # Métricas JSON para CI o dashboards
    (args.output_dir / "metrics.json").write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"\n=== Listo ===")
    print(f"  Output dir: {args.output_dir}")
    print(f"  CAC real: ${metrics['cac_real_clp']:,} CLP (vs CPL Meta ${metrics['cpl_meta_clp']:,})"
          if metrics['cac_real_clp'] else "  CAC real: N/A (0 conversiones matcheadas)")
    print(f"  Tasa conv: {metrics['tasa_conversion_pct']}%")


if __name__ == "__main__":
    main()
