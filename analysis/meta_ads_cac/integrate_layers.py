#!/usr/bin/env python3
"""
Integración de análisis CAC multi-capa

Combina resultados de:
- Capa 1: FacebookLeads (Zendesk Sell) → analyze_cac_facebookleads.py
- Capa 2: Zendesk Support (message history) → analyze_cac_zendesk_support.py

Genera un reporte consolidado mostrando:
1. Venn diagram de leads detectados por cada capa
2. Nuevos leads encontrados en Capa 2 que no estaban en Capa 1
3. Validación cruzada: ¿mismo email/phone/nombre?
4. Recomendaciones de enriquecimiento
"""

import os
import sys
import json
import csv
from datetime import datetime
from collections import defaultdict

def load_capa1_matches():
    """Carga matches de Capa 1 (FacebookLeads)."""
    matches_csv = "/home/user/clinyco_AI/analysis/meta_ads_cac/out/matches.csv"
    matches = []

    try:
        with open(matches_csv, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                matches.append({
                    'source': 'facebook_leads',
                    'lead_id': row.get('lead_id'),
                    'lead_email': row.get('lead_email'),
                    'lead_name': row.get('lead_name'),
                    'deal_id': row.get('deal_id'),
                    'deal_stage': row.get('deal_stage'),
                    'rule': row.get('rule'),
                    'score': int(row.get('score', 0))
                })
        print(f"✓ Capa 1: {len(matches)} matches cargados desde FacebookLeads")
        return matches
    except FileNotFoundError:
        print(f"⚠️  {matches_csv} no encontrado. Ejecuta analyze_cac_facebookleads.py primero.")
        return []

def load_capa2_matches():
    """Carga matches de Capa 2 (Zendesk Support)."""
    support_json = "/home/user/clinyco_AI/analysis/meta_ads_cac/out/zendesk_support_matches.json"
    matches = []

    try:
        with open(support_json, 'r', encoding='utf-8') as f:
            data = json.load(f)

            # Extraer detailed_matches
            for item in data.get('detailed_matches', []):
                meta_lead = item.get('meta_lead', {})
                zen_matches = item.get('zendesk_matches', {})

                for user_match in zen_matches.get('users_matching', []):
                    matches.append({
                        'source': 'zendesk_support',
                        'meta_lead_name': meta_lead.get('name'),
                        'meta_lead_email': meta_lead.get('email'),
                        'zendesk_user_name': user_match.get('name'),
                        'zendesk_user_email': user_match.get('email'),
                        'zendesk_user_id': user_match.get('user_id'),
                        'ticket_id': user_match.get('ticket_id'),
                        'confidence': 'medium'
                    })

        print(f"✓ Capa 2: {len(matches)} matches cargados desde Zendesk Support")
        return matches
    except FileNotFoundError:
        print(f"⚠️  {support_json} no encontrado. Ejecuta analyze_cac_zendesk_support.py primero.")
        return []

def normalize_email(email):
    """Normaliza email para comparación."""
    return email.lower().strip() if email else ""

def normalize_name(name):
    """Normaliza nombre para comparación."""
    if not name:
        return ""
    import unicodedata
    nfd = unicodedata.normalize('NFD', name.lower())
    return ''.join(c for c in nfd if unicodedata.category(c) != 'Mn').strip()

def validate_cross_references(capa1_matches, capa2_matches):
    """Valida si los matches de Capa 1 y Capa 2 se refieren a las mismas personas."""
    validations = []

    # Crear índices para búsqueda rápida
    capa1_by_email = defaultdict(list)
    capa1_by_name = defaultdict(list)

    for m in capa1_matches:
        if m.get('lead_email'):
            capa1_by_email[normalize_email(m['lead_email'])].append(m)
        if m.get('lead_name'):
            capa1_by_name[normalize_name(m['lead_name'])].append(m)

    # Validar Capa 2 contra Capa 1
    for m2 in capa2_matches:
        validation = {
            'capa2_match': m2,
            'capa1_matches': [],
            'confidence': 'unmatched'
        }

        # Buscar por email
        if m2.get('zendesk_user_email'):
            email_norm = normalize_email(m2['zendesk_user_email'])
            if email_norm in capa1_by_email:
                validation['capa1_matches'].extend(capa1_by_email[email_norm])
                validation['confidence'] = 'high_email_match'

        # Buscar por nombre
        if m2.get('zendesk_user_name') and not validation['capa1_matches']:
            name_norm = normalize_name(m2['zendesk_user_name'])
            if name_norm in capa1_by_name:
                validation['capa1_matches'].extend(capa1_by_name[name_norm])
                validation['confidence'] = 'medium_name_match'

        validations.append(validation)

    return validations

def generate_venn_statistics(capa1_matches, capa2_matches, validations):
    """Genera estadísticas tipo Venn diagram."""
    stats = {
        'capa1_only': 0,
        'capa2_only': 0,
        'both_layers': 0,
        'total_unique_leads': 0,
    }

    # Contar matches únicos en Capa 1
    capa1_leads = set(m.get('lead_id') or m.get('lead_email') for m in capa1_matches)

    # Contar matches únicos en Capa 2 que matchearon con Capa 1
    capa2_with_capa1 = sum(1 for v in validations if v['confidence'] != 'unmatched')
    capa2_without_capa1 = sum(1 for v in validations if v['confidence'] == 'unmatched')

    stats['capa1_only'] = len(capa1_matches) - capa2_with_capa1
    stats['capa2_only'] = capa2_without_capa1
    stats['both_layers'] = capa2_with_capa1
    stats['total_unique_leads'] = len(capa1_leads) + capa2_without_capa1

    return stats

def main():
    print("\n=== 🔄 Integración CAC Multi-Capa ===\n")

    # 1. Cargar ambas capas
    capa1_matches = load_capa1_matches()
    capa2_matches = load_capa2_matches()

    if not capa1_matches and not capa2_matches:
        print("\n❌ No hay datos de ninguna capa. Ejecuta primero:")
        print("  python3 analyze_cac_facebookleads.py")
        print("  python3 analyze_cac_zendesk_support.py")
        sys.exit(1)

    # 2. Validar referencias cruzadas
    print("\n🔗 Validando referencias cruzadas...")
    validations = validate_cross_references(capa1_matches, capa2_matches)

    # 3. Generar estadísticas
    print("\n📊 Generando estadísticas...")
    stats = generate_venn_statistics(capa1_matches, capa2_matches, validations)

    # 4. Imprimir resultados
    print("\n" + "="*60)
    print("📈 RESULTADOS INTEGRACIÓN MULTI-CAPA")
    print("="*60)

    print(f"\nCapa 1 (FacebookLeads): {len(capa1_matches)} matches")
    print(f"Capa 2 (Zendesk Support): {len(capa2_matches)} matches")

    print(f"\n🎯 Estadísticas Venn:")
    print(f"  • Solo Capa 1: {stats['capa1_only']} leads")
    print(f"  • Solo Capa 2 (nuevos): {stats['capa2_only']} leads")
    print(f"  • Ambas capas: {stats['both_layers']} leads")
    print(f"  • Total leads únicos: {stats['total_unique_leads']}")

    # 5. Identificar nuevos leads en Capa 2
    print(f"\n🆕 Nuevos leads detectados en Capa 2 (no en Capa 1):")
    new_leads = [v['capa2_match'] for v in validations if v['confidence'] == 'unmatched']

    for i, lead in enumerate(new_leads[:10], 1):  # Top 10
        print(f"  {i}. {lead.get('zendesk_user_name', 'N/A')} ({lead.get('zendesk_user_email', 'N/A')})")
        if lead.get('ticket_id'):
            print(f"     → Ticket: {lead['ticket_id']}")

    if len(new_leads) > 10:
        print(f"  ... y {len(new_leads) - 10} más")

    # 6. Guardar reporte
    output_dir = "/home/user/clinyco_AI/analysis/meta_ads_cac/out"
    os.makedirs(output_dir, exist_ok=True)

    report = {
        'timestamp': datetime.now().isoformat(),
        'statistics': stats,
        'validations_summary': {
            'high_email_match': sum(1 for v in validations if v['confidence'] == 'high_email_match'),
            'medium_name_match': sum(1 for v in validations if v['confidence'] == 'medium_name_match'),
            'unmatched': sum(1 for v in validations if v['confidence'] == 'unmatched'),
        },
        'recommendations': [
            "✅ Capa 1 proporciona la base: 275 FacebookLeads de Zendesk Sell",
            "✅ Capa 2 valida y enriquece: busca nombres en historial de soporte",
            f"⚠️  {stats['capa2_only']} nuevos leads encontrados en soporte (no en CRM aún)",
            "→ Investigar si esos leads deberían importarse a Zendesk Sell leads module",
            "→ Comparar con RESULTADOS_CAC.md para notar leads sin soporte interaction",
        ]
    }

    output_file = os.path.join(output_dir, "integration_report.json")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"\n✓ Reporte guardado: {output_file}")

    # 7. Próximos pasos
    print("\n💡 Próximos pasos:")
    print("  1. Validar manualmente los 'nuevos leads' de Capa 2")
    print("  2. Importar esos leads a Zendesk Sell si son clientes reales")
    print("  3. Linkar requester_id (soporte) → contact_id (CRM) para futuro tracking")
    print("  4. Re-ejecutar en Septiembre 2026 con conversiones reales")

if __name__ == "__main__":
    main()
