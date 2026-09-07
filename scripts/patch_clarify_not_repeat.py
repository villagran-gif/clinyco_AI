from pathlib import Path

p = Path('fonasapad-preevaluation.js')
s = p.read_text()
old = '''function isQuestion(text) {\n  const raw = String(text || "").trim();\n  const key = normalize(raw);\n  if (!raw) return false;\n  if (/[?¿]/.test(raw)) return true;\n  return /^(cuanto|cuanto vale|valor|precio|donde|como|porque|por que|puedo|pueden|hay|tienen|tienes|sirve|cubre|cobertura)\\b/.test(key);\n}\n'''
new = '''function isQuestion(text) {\n  const raw = String(text || "").trim();\n  const key = normalize(raw);\n  if (!raw) return false;\n  if (/[?¿]/.test(raw)) return true;\n\n  // Si la persona no entendió, no repetimos literalmente la misma pregunta.\n  // Se conserva el campo pendiente y se deja a AntonIA reformularlo con contexto.\n  if (/^(no entiendo|no entendi|no cache|no cacho|no comprendo|como asi|que significa|a que te refieres|que quieres decir)\\b/.test(key)) return true;\n\n  return /^(cuanto|cuanto vale|valor|precio|donde|como|porque|por que|puedo|pueden|hay|tienen|tienes|sirve|cubre|cobertura)\\b/.test(key);\n}\n'''
assert old in s, 'isQuestion block not found'
s = s.replace(old, new, 1)
p.write_text(s)

t = Path('fonasapad-preevaluation.test.js')
ts = t.read_text()
ts += '''\n\ntest("no entiendo difiere a AntonIA sin consumir ni repetir el campo", () => {\n  const s = state("Conversión de manga a bypass");\n  let step = nextFonasaPadPreevaluationStep(s, "conversión");\n  assert.equal(step.key, "prior_surgery");\n  const result = applyFonasaPadPreevaluationAnswer(s, "No 3ntiendo");\n  // Error ortográfico numérico frecuente: no se consume como respuesta clínica.\n  assert.equal(result.matched, false);\n});\n\ntest("no entiendo correcto se deriva para reformulación y mantiene la pregunta pendiente", () => {\n  const s = state("Conversión de manga a bypass");\n  const step = nextFonasaPadPreevaluationStep(s, "conversión");\n  assert.equal(step.key, "prior_surgery");\n  const result = applyFonasaPadPreevaluationAnswer(s, "no entiendo");\n  assert.equal(result.deferToAssistant, true);\n  assert.equal(s.preevaluation.awaiting, "prior_surgery");\n});\n'''
t.write_text(ts)
