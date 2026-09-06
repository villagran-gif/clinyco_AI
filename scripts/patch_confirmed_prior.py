from pathlib import Path

p = Path('fonasapad-preevaluation.js')
s = p.read_text()

old = '''  if (key === "prior_surgery") {\n    const value = parsePriorSurgery(text);\n    return value ? { matched: true, value } : { matched: false };\n  }'''
new = '''  if (key === "prior_surgery") {\n    const value = parsePriorSurgery(text);\n    if (value) return { matched: true, value };\n\n    // En conversión preguntamos específicamente si YA tiene manga.\n    // Un "sí" a esa pregunta confirma manga; no depende del anuncio.\n    const yn = parseYesNo(text);\n    const promptKey = normalize(p.lastPrompt || "");\n    if (yn === true && /ya tienes una manga/.test(promptKey)) return { matched: true, value: "manga" };\n    if (yn === true && /ya tienes un bypass/.test(promptKey)) return { matched: true, value: "bypass" };\n    return { matched: false };\n  }'''
assert old in s
s = s.replace(old, new, 1)

old = '''        const parsed = parseAnswerForKey(p, state, questionKey, content);\n        if (parsed.matched) p.answers[questionKey] = parsed.value;\n        p.askedKeys[questionKey] = Math.max(1, Number(p.askedKeys[questionKey] || 0));'''
new = '''        const parsed = parseAnswerForKey(p, state, questionKey, content);\n        if (parsed.matched) {\n          p.answers[questionKey] = parsed.value;\n\n          // Si el paciente entregó un año como respuesta a "tu manga", eso\n          // confirma el antecedente. A diferencia del anuncio, esta inferencia\n          // está anclada en una respuesta explícita del propio paciente.\n          if (questionKey === "prior_year") {\n            const promptKey = normalize(previousAssistant);\n            if (/manga/.test(promptKey)) {\n              p.answers.prior_surgery = "manga";\n              p.track = "revisional";\n            } else if (/bypass/.test(promptKey)) {\n              p.answers.prior_surgery = "bypass";\n              p.track = "revisional";\n            }\n          }\n        }\n        p.askedKeys[questionKey] = Math.max(1, Number(p.askedKeys[questionKey] || 0));'''
assert old in s
s = s.replace(old, new, 1)

old = '''  if (!hasAnswer(p, "prior_surgery")) return prompt("prior_surgery", "te has operado antes de manga bypass u otra bariátrica?");'''
new = '''  if (!hasAnswer(p, "prior_surgery")) return prompt("prior_surgery", "te operaste antes?[[MSG]]manga bypass otra o no?");'''
# generic bariatric route only; revisional already says ya tienes una manga?
if old in s:
    s = s.replace(old, new, 1)

p.write_text(s)

p = Path('fonasapad-preevaluation.test.js')
s = p.read_text()
s += r'''

test("sí a ya tienes una manga confirma manga", () => {
  const s = state("Conversión de manga a bypass");
  let step = nextFonasaPadPreevaluationStep(s, "conversión");
  assert.equal(step.key, "prior_surgery");
  assert.match(step.reply, /ya tienes una manga/i);
  const answer = applyFonasaPadPreevaluationAnswer(s, "Si");
  assert.equal(answer.matched, true);
  assert.equal(s.preevaluation.answers.prior_surgery, "manga");
  step = nextFonasaPadPreevaluationStep(s, "Si");
  assert.equal(step.key, "prior_year");
});

test("año respondido a tu manga rehidrata también antecedente manga", () => {
  const s = state("Conversión de manga a bypass");
  s.preevaluation.active = true;
  s.preevaluation.track = "revisional";
  const history = [
    { role: "assistant", content: "de qué año es tu manga?", created_at: "2026-09-06T23:47:49Z" },
    { role: "user", content: "2022", created_at: "2026-09-06T23:52:52Z" },
  ];
  hydrateFonasaPadPreevaluationFromHistory(s, history);
  assert.equal(s.preevaluation.answers.prior_year, 2022);
  assert.equal(s.preevaluation.answers.prior_surgery, "manga");
  const next = nextFonasaPadPreevaluationStep(s, "");
  assert.notEqual(next?.key, "prior_surgery");
  assert.notEqual(next?.key, "prior_year");
});
'''
p.write_text(s)
