from pathlib import Path
import re

# 1) FONASAPAD conversational engine
p = Path('fonasapad-preevaluation.js')
s = p.read_text()

old = '''function isQuestion(text) {\n  const raw = String(text || "").trim();\n  const key = normalize(raw);\n  if (!raw) return false;\n  if (/[?¿]/.test(raw)) return true;\n  return /^(cuanto|cuanto vale|valor|precio|donde|como|porque|por que|puedo|pueden|hay|tienen|tienes|sirve|cubre|cobertura)\\b/.test(key);\n}\n'''
new = '''function isQuestion(text) {\n  const raw = String(text || "").trim();\n  const key = normalize(raw);\n  if (!raw) return false;\n  if (/[?¿]/.test(raw)) return true;\n\n  // Si la persona no entendió, no repetimos literalmente la misma pregunta.\n  // Se conserva el campo pendiente y se deja a AntonIA reformularlo con contexto.\n  if (/^(no entiendo|no 3ntiendo|no entendi|no cache|no cacho|no comprendo|como asi|que significa|a que te refieres|que quieres decir)\\b/.test(key)) return true;\n\n  return /^(cuanto|cuanto vale|valor|precio|donde|como|porque|por que|puedo|pueden|hay|tienen|tienes|sirve|cubre|cobertura)\\b/.test(key);\n}\n'''
assert old in s, 'isQuestion block not found'
s = s.replace(old, new, 1)

# Aceptar abreviatura humana "110k" como 110 kg.
s = s.replace('(?:kg|kilo|kilos)\\b', '(?:kg|kilo|kilos|k)\\b')

# Antes de cerrar una ruta revisional manga -> bypass, canonizar el procedimiento.
needle = '''  if (!next) {\n    p.completed = true;'''
replacement = '''  if (!next) {\n    if (p.track === "revisional" && p.answers?.prior_surgery === "manga") {\n      state.dealDraft.dealInteres = "Conversión de manga a bypass";\n    }\n    p.completed = true;'''
assert needle in s, 'completion block not found'
s = s.replace(needle, replacement, 1)

# El resumen visible debe mostrar el procedimiento revisional real, no "Cirugía bariátrica".
old = '  if (state?.dealDraft?.dealInteres) lines.push(`procedimiento ${state.dealDraft.dealInteres}`);'
new = '''  const procedureLabel = p.track === "revisional" && a.prior_surgery === "manga"\n    ? "Conversión de manga a bypass"\n    : state?.dealDraft?.dealInteres;\n  if (procedureLabel) lines.push(`procedimiento ${procedureLabel}`);'''
assert old in s, 'patient summary procedure line not found'
s = s.replace(old, new, 1)

# También normalizar el resumen interno usado por memoria/dealValidacionPad.
old = '  if (state?.dealDraft?.dealInteres) rows.push(`interes=${state.dealDraft.dealInteres}`);'
new = '''  const summaryInterest = p.track === "revisional" && a.prior_surgery === "manga"\n    ? "Conversión de manga a bypass"\n    : state?.dealDraft?.dealInteres;\n  if (summaryInterest) rows.push(`interes=${summaryInterest}`);'''
assert old in s, 'internal summary interest line not found'
s = s.replace(old, new, 1)

p.write_text(s)

# 2) Server guard: conversion/revisional must not fall back to generic PAD-tramo logic
p = Path('server.js')
s = p.read_text()
needle = '''function shouldAskForFonasaTramo(state, latestUserText) {\n  const key = normalizeKey(latestUserText || "");'''
replacement = '''function shouldAskForFonasaTramo(state, latestUserText) {\n  // Una conversión manga -> bypass no usa el PAD bariátrico estándar.\n  // No volver al interrogatorio genérico de tramo después de completar la ruta revisional.\n  if (state?.preevaluation?.track === "revisional") return false;\n\n  const key = normalizeKey(latestUserText || "");'''
assert needle in s, 'shouldAskForFonasaTramo not found'
s = s.replace(needle, replacement, 1)

# Si el usuario dice que no entendió, GPT debe reformular, no repetir textual.
prompt_anchor = '- si la persona ya dijo lo que necesita y tú puedes orientar, responde primero y pregunta después solo si hace falta\n'
if prompt_anchor in s:
    s = s.replace(prompt_anchor, prompt_anchor + '- si dice "no entiendo", "no cacho", "cómo así" o similar, reformula con palabras más simples; nunca repitas exactamente la misma pregunta\n', 1)

p.write_text(s)

# 3) Structured extraction: a tramo in revisional context must not become generic PAD eligibility
p = Path('extraction/updateDraftsFromText.js')
s = p.read_text()
old = '''    state.dealDraft.dealValidacionPad = tramo.isPadEligible\n      ? "Posible evaluación PAD Fonasa"\n      : "No aplica PAD Fonasa por Tramo A";'''
new = '''    if (state?.preevaluation?.track === "revisional") {\n      state.dealDraft.dealValidacionPad = "Cirugía revisional: no corresponde al PAD bariátrico estándar";\n    } else {\n      state.dealDraft.dealValidacionPad = tramo.isPadEligible\n        ? "Posible evaluación PAD Fonasa"\n        : "No aplica PAD Fonasa por Tramo A";\n    }'''
assert old in s, 'tramo validation block not found'
s = s.replace(old, new, 1)
p.write_text(s)

# 4) Tests
p = Path('fonasapad-preevaluation.test.js')
ts = p.read_text()
ts += '''\n\ntest("110k se entiende como 110 kg", () => {\n  const s = state("Manga gástrica");\n  const step = nextFonasaPadPreevaluationStep(s, "manga");\n  assert.equal(step.key, "weight");\n  const result = applyFonasaPadPreevaluationAnswer(s, "110k");\n  assert.equal(result.matched, true);\n  assert.equal(s.measurements.weightKg, 110);\n});\n\ntest("no entiendo difiere a AntonIA y mantiene el campo", () => {\n  const s = state("Conversión de manga a bypass");\n  const step = nextFonasaPadPreevaluationStep(s, "conversión");\n  assert.equal(step.key, "prior_surgery");\n  const result = applyFonasaPadPreevaluationAnswer(s, "No 3ntiendo");\n  assert.equal(result.matched, false);\n  assert.equal(result.deferToAssistant, true);\n  assert.equal(s.preevaluation.awaiting, "prior_surgery");\n});\n\ntest("resumen revisional muestra conversión y canoniza interés", () => {\n  const s = state("Conversión de manga a bypass");\n  s.preevaluation.active = true;\n  s.preevaluation.track = "revisional";\n  s.preevaluation.answers = {\n    prior_surgery: "manga", prior_year: 2014, revision_reason: "ambos", studies: "endoscopia",\n    weight: 110, height: 1.76, age: 45, comorbidities: "presión alta", smoking: "no_fuma",\n    safety: "No", insurance: "FONASA", city: "San Vicente de Tagua Tagua"\n  };\n  s.measurements.weightKg = 110;\n  s.measurements.heightM = 1.76;\n  s.measurements.bmi = 35.5;\n  const final = nextFonasaPadPreevaluationStep(s, "");\n  assert.equal(final.completed, true);\n  assert.equal(s.dealDraft.dealInteres, "Conversión de manga a bypass");\n  assert.match(final.reply, /procedimiento Conversión de manga a bypass/i);\n});\n'''
p.write_text(ts)

p = Path('extraction/updateDraftsFromText.test.js')
ts = p.read_text()
ts += '''\n\ntest("tramo Fonasa en revisional no se marca como PAD bariátrico", () => {\n  const s = state();\n  s.preevaluation = { track: "revisional" };\n  updateDraftsFromText(s, "Tramo C");\n  assert.equal(s.contactDraft.c_modalidad, "Tramo C");\n  assert.match(s.dealDraft.dealValidacionPad, /revisional/i);\n  assert.doesNotMatch(s.dealDraft.dealValidacionPad, /Posible evaluación PAD/i);\n});\n'''
p.write_text(ts)
