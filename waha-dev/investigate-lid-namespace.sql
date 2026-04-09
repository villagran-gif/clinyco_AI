-- ============================================================================
-- Investigación: ¿WAHA @lid y SunCo externalId viven en el mismo namespace?
--
-- Hipótesis (del análisis del código):
--   • SunCo (WhatsApp Business API via BSP) entrega el teléfono en E.164
--     → server.js pasa `sourceClient.externalId` a normalizePhone() y asume
--       que son dígitos de un número.
--   • WAHA (whatsapp-web.js) entrega `<phone>@c.us` si el contacto está
--     guardado, o `<randomDigits>@lid` si no. El LID NO es el teléfono —
--     es un identificador sintético local del device.
--   → Por lo tanto SunCo externalId y WAHA @lid son namespaces DISTINTOS
--     y no se pueden joinear directamente.
--
-- Esta query lo comprueba empíricamente con un teléfono real.
--
-- USO:
--   psql "$DATABASE_URL" -v phone="'+56987297033'" -f investigate-lid-namespace.sql
-- ============================================================================

\set ON_ERROR_STOP on
\echo ''
\echo '══════════════════════════════════════════════════════════════════════'
\echo '  Investigación de namespaces: ¿@lid WAHA == externalId SunCo?'
\echo '══════════════════════════════════════════════════════════════════════'
\echo ''

-- ── 0. Parámetro ──────────────────────────────────────────────────────────
\echo '--- 0. Teléfono a investigar ---'
SELECT :phone AS phone_under_test;

-- ── 1. ¿Existe en customers? ──────────────────────────────────────────────
\echo ''
\echo '--- 1. Cliente en customers (tabla principal) ---'
SELECT
  id            AS customer_id,
  nombres,
  apellidos,
  rut,
  whatsapp_phone,
  telefono_principal,
  email,
  created_at
FROM customers
WHERE whatsapp_phone     = :phone
   OR telefono_principal = :phone
ORDER BY id;

-- ── 2. customer_channels: todos los canales del mismo customer ────────────
\echo ''
\echo '--- 2. Canales asociados al customer (buscando el external_id guardado por SunCo) ---'
SELECT
  cc.id,
  cc.customer_id,
  cc.channel_type,
  cc.channel_value,
  cc.source_system,
  cc.external_id,
  cc.is_primary,
  cc.verified,
  cc.created_at
FROM customer_channels cc
WHERE cc.customer_id IN (
  SELECT id FROM customers WHERE whatsapp_phone = :phone OR telefono_principal = :phone
)
ORDER BY cc.channel_type, cc.created_at;

-- ── 3. conversations de ese cliente (main app / Zendesk SunCo) ───────────
\echo ''
\echo '--- 3. Conversations (SunCo) del cliente: qué formato tiene channel_external_id ---'
SELECT
  c.id,
  c.conversation_id,
  c.channel,
  c.channel_external_id,
  c.whatsapp_phone,
  c.channel_display_name,
  c.created_at
FROM conversations c
WHERE c.customer_id IN (
  SELECT id FROM customers WHERE whatsapp_phone = :phone OR telefono_principal = :phone
)
   OR c.whatsapp_phone = :phone
   OR c.channel_external_id LIKE replace(:phone, '+', '') || '%'
   OR c.channel_external_id LIKE '+%' || substr(replace(:phone, '+', ''), 3)
ORDER BY c.created_at DESC
LIMIT 10;

-- ── 4. ¿Algún channel_external_id con forma @lid en TODA la base? ────────
\echo ''
\echo '--- 4. ¿Zendesk/SunCo alguna vez guardó un @lid? (búsqueda global) ---'
SELECT
  count(*) FILTER (WHERE channel_external_id LIKE '%@lid%') AS sunco_lid_count,
  count(*) FILTER (WHERE channel_external_id LIKE '%@c.us%') AS sunco_cus_count,
  count(*) FILTER (WHERE channel_external_id ~ '^\+?\d+$') AS sunco_pure_digits_count,
  count(*) AS total_conversations
FROM conversations;

\echo ''
\echo '--- 4b. Muestra de channel_external_id en conversations (formato real) ---'
SELECT DISTINCT
  CASE
    WHEN channel_external_id LIKE '%@lid'   THEN 'ends-with-@lid'
    WHEN channel_external_id LIKE '%@c.us'  THEN 'ends-with-@c.us'
    WHEN channel_external_id ~ '^\+\d+$'    THEN 'E.164-plus'
    WHEN channel_external_id ~ '^\d+$'      THEN 'pure-digits'
    WHEN channel_external_id IS NULL        THEN 'NULL'
    ELSE 'other: ' || left(channel_external_id, 20)
  END AS format_family,
  count(*) AS n
FROM conversations
GROUP BY 1
ORDER BY n DESC;

-- ── 5. WAHA observer: ¿hay chats @c.us para este teléfono? ────────────────
\echo ''
\echo '--- 5. Observer WAHA: conversaciones @c.us para este teléfono ---'
SELECT
  adc.id,
  adc.session_name,
  aws.agent_name,
  adc.client_phone,
  adc.customer_id,
  adc.match_status,
  adc.message_count,
  adc.first_message_at,
  adc.last_message_at
FROM agent_direct_conversations adc
LEFT JOIN agent_waha_sessions aws ON aws.session_name = adc.session_name
WHERE adc.client_phone = :phone
ORDER BY adc.last_message_at DESC NULLS LAST;

-- ── 6. WAHA observer: ¿hay chats lid: para el mismo customer? ────────────
\echo ''
\echo '--- 6. Observer WAHA: conversaciones lid:* matcheadas al mismo customer ---'
SELECT
  adc.id,
  adc.session_name,
  aws.agent_name,
  adc.client_phone   AS lid_identifier,
  adc.customer_id,
  adc.match_status,
  adc.message_count,
  adc.last_message_at
FROM agent_direct_conversations adc
LEFT JOIN agent_waha_sessions aws ON aws.session_name = adc.session_name
WHERE adc.client_phone LIKE 'lid:%'
  AND adc.customer_id IN (
    SELECT id FROM customers WHERE whatsapp_phone = :phone OR telefono_principal = :phone
  )
ORDER BY adc.last_message_at DESC NULLS LAST;

-- ── 7. Cross-check: ¿alguno de los lid: aparece también en conversations? ─
\echo ''
\echo '--- 7. ¿Algún lid del observer aparece también como channel_external_id en SunCo? ---'
WITH observer_lids AS (
  SELECT DISTINCT replace(client_phone, 'lid:', '') AS lid_digits
  FROM agent_direct_conversations
  WHERE client_phone LIKE 'lid:%'
    AND customer_id IN (
      SELECT id FROM customers WHERE whatsapp_phone = :phone OR telefono_principal = :phone
    )
)
SELECT
  ol.lid_digits                 AS waha_lid_digits,
  c.conversation_id             AS sunco_conversation_id,
  c.channel_external_id         AS sunco_external_id,
  'MATCH!'                      AS verdict
FROM observer_lids ol
JOIN conversations c
  ON c.channel_external_id LIKE '%' || ol.lid_digits || '%';

\echo ''
\echo '--- 7b. (Si la consulta 7 devolvió 0 filas → namespaces DISTINTOS) ---'
\echo ''

-- ── 8. Resumen ────────────────────────────────────────────────────────────
\echo '══════════════════════════════════════════════════════════════════════'
\echo '  Interpretación:'
\echo '    • Si §4 muestra sunco_lid_count = 0  → SunCo NUNCA guarda @lid.'
\echo '      SunCo usa siempre teléfono E.164 (namespace "phone").'
\echo '    • Si §5 y §6 coexisten → el mismo customer aparece dos veces en'
\echo '      WAHA: una vez como +56... (agente que tenía el contacto guardado)'
\echo '      y otra como lid:XXX (agente que NO lo tenía guardado).'
\echo '    • Si §7 devuelve 0 filas → los dígitos del @lid de WAHA NO son el'
\echo '      teléfono ni matchean ningún externalId de SunCo.'
\echo '      CONCLUSIÓN: namespaces totalmente distintos, hay que'
\echo '      correlacionar por RUT o por nombre — NO por dígitos de LID.'
\echo '══════════════════════════════════════════════════════════════════════'
