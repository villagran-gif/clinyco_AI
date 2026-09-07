from pathlib import Path

# after-hours: cinco burbujas reales de WhatsApp.
# Carolin y el teléfono quedan separados para facilitar copiar/pegar o tocar el número.
p = Path('after-hours.js')
s = p.read_text()
old = '''export function buildAfterHoursClosureReply() {
  return [
    "por la hora\\nmañana continuamos\\nescribem am o pm",
    `${CONTACT_NAME}\\n${CONTACT_PHONE}\\nsaludos`,
  ].join("[[MSG]]");
}
'''
new = '''export function buildAfterHoursClosureReply(patientName = "") {
  const safeName = String(patientName || "").trim().split(/\\s+/)[0] || "";
  return [
    `Me queda bastanta claro${safeName ? ` ${safeName}` : ""}`,
    "por la hora",
    "mañana escribeme am o pm",
    CONTACT_NAME,
    CONTACT_PHONE,
  ].join("[[MSG]]");
}
'''
assert old in s, 'after-hours block not found'
s = s.replace(old, new, 1)
p.write_text(s)

# server: pasa el primer nombre del paciente a todos los cierres nocturnos
p = Path('server.js')
s = p.read_text()
s = s.replace('buildAfterHoursClosureReply()', 'buildAfterHoursClosureReply(state?.contactDraft?.c_nombres || "")')

# El formateador nocturno puede conservar hasta 5 burbujas.
s = s.replace('return parts.slice(0, isAfterHoursSequence ? 4 : 2);', 'return parts.slice(0, isAfterHoursSequence ? 5 : 2);')
p.write_text(s)

# tests
p = Path('after-hours.test.js')
s = p.read_text()
# Actualiza el test heredado del cierre anterior. El typo humano ahora es "bastanta".
s = s.replace('assert.match(reply, /escribem am o pm/);', 'assert.match(reply, /Me queda bastanta claro/);')
s = s.replace('assert.match(reply, /Carolin\\n\\+56973763009\\nsaludos/);', 'assert.match(reply, /Carolin\\[\\[MSG\\]\\]\\+56973763009/);')
if 'cierre nocturno son cinco burbujas humanas' not in s:
    s += '''\n\ntest("cierre nocturno son cinco burbujas humanas", () => {\n  const reply = buildAfterHoursClosureReply("Lorena Patricia");\n  const parts = reply.split("[[MSG]]");\n  assert.equal(parts.length, 5);\n  assert.equal(parts[0], "Me queda bastanta claro Lorena");\n  assert.equal(parts[1], "por la hora");\n  assert.equal(parts[2], "mañana escribeme am o pm");\n  assert.equal(parts[3], "Carolin");\n  assert.equal(parts[4], "+56973763009");\n});\n'''
p.write_text(s)
