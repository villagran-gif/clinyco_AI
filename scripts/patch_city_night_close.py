from pathlib import Path

# 1) FONASAPAD city wording
p = Path('fonasapad-preevaluation.js')
s = p.read_text()
old = '  if (!hasAnswer(p, "city")) return prompt("city", "en qué ciudad estás?");'
new = '  if (!hasAnswer(p, "city")) return prompt("city", "en que ciudad vives?[[MSG]]porque estamos en Santiago y Antofagasta");'
assert old in s, 'city prompt not found'
s = s.replace(old, new, 1)
p.write_text(s)

# 2) Night closure tone + one intentional typo only in the non-clinical close
p = Path('after-hours.js')
s = p.read_text()
s = s.replace('const CONTACT_PHONE = "+56 9 7376 3009";', 'const CONTACT_PHONE = "+56973763009";')
old = '''export function buildAfterHoursClosureReply() {
  return [
    "mañana continuamos",
    "prefieres horario am o pm?",
    `${CONTACT_NAME}\\n${CONTACT_PHONE}`,
    "saludos",
  ].join("[[MSG]]");
}
'''
new = '''export function buildAfterHoursClosureReply() {
  return [
    "por la hora\\nmañana continuamos\\nescribem am o pm",
    `${CONTACT_NAME}\\n${CONTACT_PHONE}\\nsaludos`,
  ].join("[[MSG]]");
}
'''
assert old in s, 'night closure block not found'
s = s.replace(old, new, 1)
p.write_text(s)

# 3) Preserve separate WhatsApp bubbles for the after-hours sequence.
p = Path('server.js')
s = p.read_text()
old = '''  if (parts.length > 2) {
    parts = [parts[0], cleanHumanBubble(parts.slice(1).join("\\n"))];
  }

  return parts.slice(0, 2);
}
'''
new = '''  const isAfterHoursSequence = /Carolin/i.test(clean) && /\\+56973763009/.test(clean);
  if (parts.length > 2 && !isAfterHoursSequence) {
    parts = [parts[0], cleanHumanBubble(parts.slice(1).join("\\n"))];
  }

  return parts.slice(0, isAfterHoursSequence ? 4 : 2);
}
'''
assert old in s, 'split bubble block not found'
s = s.replace(old, new, 1)
p.write_text(s)

# 4) Tests
p = Path('after-hours.test.js')
ts = p.read_text()
ts = ts.replace(r'assert.match(reply, /\+56 9 7376 3009/);', r'assert.match(reply, /\+56973763009/);')
if 'escribem am o pm' not in ts:
    ts += '''\n\ntest("cierre nocturno mantiene typo humano y contacto separado", () => {\n  const reply = buildAfterHoursClosureReply();\n  assert.match(reply, /escribem am o pm/);\n  assert.match(reply, /Carolin\\n\\+56973763009\\nsaludos/);\n});\n'''
p.write_text(ts)

p = Path('fonasapad-preevaluation.test.js')
ts = p.read_text()
if 'pregunta ciudad usa vive y explica sedes' not in ts:
    ts += '''\n\ntest("pregunta ciudad usa vive y explica sedes", () => {\n  const s = state("Manga gástrica");\n  s.preevaluation.active = true;\n  s.preevaluation.track = "bariatric";\n  s.preevaluation.answers = { weight: 90, height: 1.7, age: 40, prior_surgery: "ninguna", comorbidities: "no", smoking: "no_fuma", safety: "no", insurance: "FONASA" };\n  s.measurements.weightKg = 90;\n  s.measurements.heightM = 1.7;\n  const step = nextFonasaPadPreevaluationStep(s, "");\n  assert.equal(step.key, "city");\n  assert.match(step.reply, /en que ciudad vives/i);\n  assert.match(step.reply, /Santiago y Antofagasta/i);\n});\n'''
p.write_text(ts)
