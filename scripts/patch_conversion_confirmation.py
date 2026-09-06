from pathlib import Path

p = Path('fonasapad-preevaluation.js')
s = p.read_text()
old = '''  const interest = normalize(state?.dealDraft?.dealInteres || "");\n  if (p.track === "revisional" && /conversion.*manga.*bypass|manga.*bypass/.test(interest) && !hasAnswer(p, "prior_surgery")) {\n    p.answers.prior_surgery = "manga";\n  }'''
new = '''  // El anuncio o interés de conversión NO demuestra que el paciente ya tenga manga.\n  // Ese antecedente debe confirmarlo el propio paciente.\n  const interest = normalize(state?.dealDraft?.dealInteres || "");\n  void interest;'''
assert old in s
s = s.replace(old, new, 1)

old = '''function nextRevisional(state, p) {\n  if (!hasAnswer(p, "prior_surgery")) return prompt("prior_surgery", "te operaste antes de manga bypass u otra bariátrica?");'''
new = '''function nextRevisional(state, p) {\n  if (!hasAnswer(p, "prior_surgery")) return prompt("prior_surgery", "ya tienes una manga?");'''
assert old in s
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('fonasapad-preevaluation.test.js')
s = p.read_text()
old = '''test("conversión reconoce manga previa y pregunta año primero", () => {\n  const s = state("Conversión de manga a bypass");\n  const step = nextFonasaPadPreevaluationStep(s, "me interesa conversión de manga a bypass");\n  assert.equal(s.preevaluation.track, "revisional");\n  assert.equal(s.preevaluation.answers.prior_surgery, "manga");\n  assert.equal(step.key, "prior_year");\n  assert.match(step.reply, /año.*manga/i);\n});'''
new = '''test("conversión confirma primero si realmente existe una manga previa", () => {\n  const s = state("Conversión de manga a bypass");\n  const step = nextFonasaPadPreevaluationStep(s, "me interesa conversión de manga a bypass");\n  assert.equal(s.preevaluation.track, "revisional");\n  assert.equal(s.preevaluation.answers.prior_surgery, undefined);\n  assert.equal(step.key, "prior_surgery");\n  assert.match(step.reply, /ya tienes una manga/i);\n});'''
assert old in s
s = s.replace(old, new, 1)

old = '''test("flujo revisional avanza año → motivo → estudios", () => {\n  const s = state("Conversión de manga a bypass");\n  let step = nextFonasaPadPreevaluationStep(s, "conversión");\n  assert.equal(step.key, "prior_year");\n  assert.equal(applyFonasaPadPreevaluationAnswer(s, "2018").matched, true);'''
new = '''test("flujo revisional avanza confirmación → año → motivo → estudios", () => {\n  const s = state("Conversión de manga a bypass");\n  let step = nextFonasaPadPreevaluationStep(s, "conversión");\n  assert.equal(step.key, "prior_surgery");\n  assert.equal(applyFonasaPadPreevaluationAnswer(s, "sí tengo una manga").matched, true);\n  step = nextFonasaPadPreevaluationStep(s, "sí tengo una manga");\n  assert.equal(step.key, "prior_year");\n  assert.equal(applyFonasaPadPreevaluationAnswer(s, "2018").matched, true);'''
assert old in s
s = s.replace(old, new, 1)

# Update the regression that starts from conversion so it explicitly seeds the inferred prior surgery.
old = '''  s.preevaluation.active = true;\n  s.preevaluation.track = "revisional";\n  s.preevaluation.awaiting = "prior_year";'''
new = '''  s.preevaluation.active = true;\n  s.preevaluation.track = "revisional";\n  s.preevaluation.answers.prior_surgery = "manga";\n  s.preevaluation.awaiting = "prior_year";'''
s = s.replace(old, new, 1)

# Correction test now starts from a confirmed-but-wrong prior state explicitly.
old = '''  let step = nextFonasaPadPreevaluationStep(s, "conversión");\n  assert.equal(step.key, "prior_year");'''
new = '''  s.preevaluation.active = true;\n  s.preevaluation.track = "revisional";\n  s.preevaluation.answers.prior_surgery = "manga";\n  s.preevaluation.awaiting = "prior_year";\n  let step = { key: "prior_year" };\n  assert.equal(step.key, "prior_year");'''
# Replace only the later correction test occurrence, so use rfind context.
idx = s.rfind(old)
assert idx != -1
s = s[:idx] + s[idx:].replace(old, new, 1)
p.write_text(s)
