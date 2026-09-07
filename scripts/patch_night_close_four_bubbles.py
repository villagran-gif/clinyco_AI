from pathlib import Path

# after-hours: four real WhatsApp bubbles, first one personalized when a name exists
p = Path('after-hours.js')
s = p.read_text()
old = '''export function buildAfterHoursClosureReply() {
  return [
    "por la hora\\nmañana continuamos\\nescribem am o pm",
    `${CONTACT_NAME}\\n${CONTACT_PHONE}`,
  ].join("[[MSG]]");
}
'''
new = '''export function buildAfterHoursClosureReply(patientName = "") {
  const safeName = String(patientName || "").trim().split(/\\s+/)[0] || "";
  return [
    `Me queda bastanta claro${safeName ? ` ${safeName}` : ""}`,
    "por la hora",
    "mañana escribeme am o pm",
    `${CONTACT_NAME}\\n${CONTACT_PHONE}`,
  ].join("[[MSG]]");
}
'''
assert old in s, 'after-hours block not found'
s = s.replace(old, new, 1)
p.write_text(s)

# server: pass first patient name to every nocturnal close
p = Path('server.js')
s = p.read_text()
s = s.replace('buildAfterHoursClosureReply()', 'buildAfterHoursClosureReply(state?.contactDraft?.c_nombres || "")')
p.write_text(s)

# tests
p = Path('after-hours.test.js')
s = p.read_text()
if 'cierre nocturno son cuatro burbujas humanas' not in s:
    s += '''\n\ntest("cierre nocturno son cuatro burbujas humanas", () => {\n  const reply = buildAfterHoursClosureReply("Lorena Patricia");\n  const parts = reply.split("[[MSG]]");\n  assert.equal(parts.length, 4);\n  assert.equal(parts[0], "Me queda bastanta claro Lorena");\n  assert.equal(parts[1], "por la hora");\n  assert.equal(parts[2], "mañana escribeme am o pm");\n  assert.match(parts[3], /^Carolin\\n\\+56973763009$/);\n});\n'''
p.write_text(s)
