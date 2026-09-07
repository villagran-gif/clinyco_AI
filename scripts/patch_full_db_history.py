from pathlib import Path
import re

# --- db.js: historial completo desde chatwoot.raw_events con fallback ---
p = Path('db.js')
s = p.read_text()
marker = 'export async function getRecentConversationMessages(conversationId, limit = 14) {'
assert marker in s, 'getRecentConversationMessages marker missing'
if 'getRecentCompleteConversationHistory' not in s:
    insert = r'''
function normalizeChatwootConversationId(conversationId) {
  return String(conversationId || "").replace(/^cw:/i, "").trim();
}

export async function getRecentCompleteConversationHistory(conversationId, limit = 60) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 60, 200));
  const chatwootConversationId = normalizeChatwootConversationId(conversationId);

  if (dbEnabled() && chatwootConversationId) {
    try {
      const { rows } = await getPool().query(
        `
        select
          case
            when payload->>'message_type' = 'incoming' then 'user'
            else 'assistant'
          end as role,
          nullif(trim(payload->>'content'), '') as content,
          received_at as created_at,
          payload->>'id' as message_id,
          payload->'sender'->>'name' as author_display_name,
          payload->'sender'->>'type' as author_type
        from chatwoot.raw_events
        where event_type = 'message_created'
          and payload->>'event' = 'message_created'
          and payload->'conversation'->>'id' = $1
          and payload->>'message_type' in ('incoming', 'outgoing')
          and nullif(trim(coalesce(payload->>'content', '')), '') is not null
        order by received_at desc
        limit $2
        `,
        [chatwootConversationId, safeLimit]
      );

      if (rows.length > 0) return rows.reverse();
    } catch (error) {
      console.warn(`[history] chatwoot.raw_events unavailable for ${conversationId}; fallback conversation_messages:`, error.message);
    }
  }

  return getRecentConversationMessages(conversationId, safeLimit);
}

'''
    s = s.replace(marker, insert + marker, 1)
p.write_text(s)

# --- server.js: usar historial completo + persistir mensajes humanos normalizados ---
p = Path('server.js')
s = p.read_text()
old_import = '  getConversationRecord,\n  getRecentConversationMessages,\n'
new_import = '  getConversationRecord,\n  getRecentConversationMessages,\n  getRecentCompleteConversationHistory,\n'
assert old_import in s or 'getRecentCompleteConversationHistory' in s, 'db import block missing'
if 'getRecentCompleteConversationHistory' not in s:
    s = s.replace(old_import, new_import, 1)

s = s.replace(
    'const recentMessages = await getRecentConversationMessages(conversationId, MAX_HISTORY_MESSAGES);',
    'const recentMessages = await getRecentCompleteConversationHistory(conversationId, MAX_HISTORY_MESSAGES);',
    1,
)
s = s.replace(
    '? await getRecentConversationMessages(conversationId, 60)',
    '? await getRecentCompleteConversationHistory(conversationId, 80)',
    1,
)
# En DB refrescamos en cada turno FONASAPAD para incorporar intervenciones humanas recientes.
s = s.replace(
    'if (Number(state.preevaluation?.historyHydratedVersion || 0) < 2) {',
    'if (dbEnabled() || Number(state.preevaluation?.historyHydratedVersion || 0) < 3) {',
    1,
)
s = s.replace(
    'console.log(`[fonasapad] history hydrated conversation=${conversationId} messages=${preevalHistory.length}`);',
    'console.log(`[fonasapad] history hydrated conversation=${conversationId} messages=${preevalHistory.length} source=complete-db`);',
    1,
)

business_marker = '''    if (authorType === "business" && isRealHumanBusinessTakeover(info)) {\n      state.system.aiEnabled = false;'''
if business_marker in s and 'humanBusinessText' not in s:
    business_new = '''    if (authorType === "business" && isRealHumanBusinessTakeover(info)) {\n      const humanBusinessText = String(info?.businessText || "").trim();\n      if (humanBusinessText) {\n        addToHistory(conversationId, "assistant", humanBusinessText);\n        if (dbEnabled()) {\n          try {\n            await insertConversationMessage({\n              conversationId,\n              role: "assistant",\n              messageId: messageId || null,\n              channel: info.sourceType || info.entryPoint || null,\n              sourceType: info.sourceType || null,\n              content: humanBusinessText,\n              rawJson: { transport: "chatwoot", senderType: info.senderType || "user", humanAgent: true },\n              authorDisplayName: null,\n            });\n          } catch (humanHistoryError) {\n            console.warn(`[history] no se pudo normalizar mensaje humano ${conversationId}:`, humanHistoryError.message);\n          }\n        }\n      }\n      state.system.aiEnabled = false;'''
    s = s.replace(business_marker, business_new, 1)
else:
    assert 'humanBusinessText' in s, 'human takeover marker missing'

p.write_text(s)

# --- FONASAPAD: parser de talla natural + nueva version de rehidratacion ---
p = Path('fonasapad-preevaluation.js')
s = p.read_text()
if 'function parseHeightValue' not in s:
    height_helper = r'''
function parseHeightValue(text) {
  const raw = String(text || "").trim();
  const key = normalize(raw);
  if (!raw) return null;

  const words = key.match(/\b(?:mido|modo|soy|estatura(?: es)?|altura(?: es)?)\s+(?:un|1)\s+metro(?:s)?\s+(\d{1,2})\b/);
  if (words) {
    const cm = Number(words[1]);
    if (cm >= 20 && cm <= 99) return Math.round((1 + cm / 100) * 100) / 100;
  }

  const direct = raw.match(/^\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:cm|m|mt|mts|metros?)?\s*$/i);
  const prefixed = raw.match(/\b(?:mido|modo|soy|estatura(?:\s+es)?|altura(?:\s+es)?)\s*[:=]?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:cm|m|mt|mts|metros?)?\b/i);
  const m = direct || prefixed;
  if (!m) return null;

  let value = Number(m[1].replace(",", "."));
  if (value >= 100 && value <= 220) value = value / 100;
  if (value >= 1.2 && value <= 2.2) return Math.round(value * 100) / 100;
  return null;
}

'''
    s = s.replace('function answerExpected(p, state, text) {', height_helper + 'function answerExpected(p, state, text) {', 1)

pattern = re.compile(r'''  if \(key === "height"\) \{.*?\n  \}\n  if \(key === "insurance"\) \{''', re.S)
match = pattern.search(s)
assert match, 'height answer block missing'
new_height_block = '''  if (key === "height") {\n    if (state?.measurements?.heightM) return { matched: true, value: state.measurements.heightM };\n    const value = parseHeightValue(text);\n    if (value) {\n      state.measurements.heightM = value;\n      state.measurements.heightCm = Math.round(value * 100);\n      state.dealDraft.dealEstatura = String(state.measurements.heightCm);\n      if (state.measurements.weightKg) state.measurements.bmi = Math.round((state.measurements.weightKg / (value * value)) * 10) / 10;\n      return { matched: true, value };\n    }\n    return { matched: false };\n  }\n  if (key === "insurance") {'''
s = s[:match.start()] + new_height_block + s[match.end():]

# Captura explícita de talla aunque venga junto con otros datos.
weight_anchor = '''  if (/tengo\\s+\\d{2}\\s+anos|tengo\\s+\\d{2}\\s+años|edad\\s*[:=]?\\s*\\d{2}/i.test(raw)) {'''
if 'const explicitHeight = parseHeightValue(raw);' not in s:
    insert_height = '''  const explicitHeight = parseHeightValue(raw);\n  if (explicitHeight && /mido|modo|estatura|altura|metro|metros|\\bcm\\b/.test(key)) {\n    state.measurements.heightM = explicitHeight;\n    state.measurements.heightCm = Math.round(explicitHeight * 100);\n    state.dealDraft.dealEstatura = String(state.measurements.heightCm);\n    p.answers.height = explicitHeight;\n    if (state.measurements.weightKg) state.measurements.bmi = Math.round((state.measurements.weightKg / (explicitHeight * explicitHeight)) * 10) / 10;\n    if (p.awaiting === "height") p.awaiting = null;\n  }\n\n'''
    assert weight_anchor in s, 'age anchor missing'
    s = s.replace(weight_anchor, insert_height + weight_anchor, 1)

s = s.replace('p.historyHydratedVersion = 2;', 'p.historyHydratedVersion = 3;', 1)
p.write_text(s)

# --- tests ---
p = Path('fonasapad-preevaluation.test.js')
ts = p.read_text()
if 'absorbe peso y talla entregados durante atencion humana' not in ts:
    ts += r'''

test("absorbe peso y talla entregados durante atencion humana", () => {
  const s = state("Abdominoplastia");
  hydrateFonasaPadPreevaluationFromHistory(s, [
    { role: "assistant", content: "comentame tu peso y estatura", created_at: "2026-09-07T13:30:00Z" },
    { role: "user", content: "Hola buenos dias modo un metro 65 y peso 88 kilos", created_at: "2026-09-07T13:31:00Z" },
  ]);
  assert.equal(s.measurements.weightKg, 88);
  assert.equal(s.measurements.heightM, 1.65);
  assert.equal(s.preevaluation.answers.weight, 88);
  assert.equal(s.preevaluation.answers.height, 1.65);
  assert.equal(s.preevaluation.historyHydratedVersion, 3);
});

test("acepta mido 1.65 como respuesta de talla", () => {
  const s = state("Manga gástrica");
  s.preevaluation.active = true;
  s.preevaluation.track = "bariatric";
  s.preevaluation.awaiting = "height";
  s.preevaluation.answers.weight = 88;
  s.measurements.weightKg = 88;
  const result = applyFonasaPadPreevaluationAnswer(s, "Mido 1.65");
  assert.equal(result.matched, true);
  assert.equal(s.measurements.heightM, 1.65);
  assert.equal(s.preevaluation.answers.height, 1.65);
});
'''
p.write_text(ts)
