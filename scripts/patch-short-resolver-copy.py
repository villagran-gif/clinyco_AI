from pathlib import Path

# Resolver: convertir preguntas tipo formulario en conversación breve.
p = Path('conversation-resolver.js')
s = p.read_text(encoding='utf-8')
replacements = {
    '"Entiendo que quieres revisar una hora, control o cambio de agenda. Cuéntame con qué profesional, especialidad o sede te gustaría atenderte para orientarte mejor."': '"Claro. ¿Con qué profesional o especialidad buscas hora?"',
    '"Perfecto, ya tengo tu contexto y no quiero hacerte repetir datos. Cuéntame qué necesitas resolver hoy para seguir ayudándote."': '"Claro. ¿Qué necesitas resolver hoy?"',
    '"Veo que ya habías conversado antes con nosotros. Cuéntame en qué etapa estás hoy o qué te gustaría resolver ahora."': '"Claro. ¿Qué necesitas resolver ahora?"',
    '"Si quieres que deje tu solicitud lista para seguimiento, ¿me compartes tu teléfono o correo? Si ya eres paciente, también puede ser tu RUT."': '"¿Me compartes tu correo? Si ya eres paciente, también puede ser tu RUT."',
    '"¿Qué procedimiento o evaluación te interesa?"': '"¿Qué procedimiento te interesa?"',
    '"¿Cuál es tu previsión o aseguradora? Por ejemplo Fonasa, Banmédica, Consalud, Cruz Blanca o Particular."': '"¿Tu previsión es Fonasa, Isapre o Particular?"',
    '"Si eres Fonasa, ¿me indicas tu tramo? Responde A, B, C o D."': '"¿Qué tramo Fonasa tienes: A, B, C o D?"',
    '"Para orientarte mejor, indícame por favor tu peso en kilos, sin decimales."': '"¿Cuánto pesas actualmente?"',
    '"¿Y tu estatura en metros? Puedes escribirla por ejemplo como 1.70."': '"¿Y cuánto mides?"',
    '"Cuéntame un poco más para poder orientarte mejor."': '"Cuéntame un poco más."',
}
for old, new in replacements.items():
    if s.count(old) != 1:
        raise SystemExit(f'resolver mismatch for {old[:45]}: {s.count(old)}')
    s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# Server: acortar las preguntas determinísticas que bypasséan el modelo.
p = Path('server.js')
s = p.read_text(encoding='utf-8')
replacements = {
    'reply: "Perfecto. ¿Me indicas tu tramo de Fonasa? Puede ser A, B, C o D.",': 'reply: "¿Qué tramo Fonasa tienes: A, B, C o D?",',
    'reply: "Perfecto. ¿Qué aseguradora tienes? Por ejemplo Banmédica, Colmena, Consalud o Cruz Blanca.",': 'reply: "¿Cuál Isapre tienes?",',
}
for old, new in replacements.items():
    if s.count(old) != 1:
        raise SystemExit(f'server reply mismatch: {s.count(old)} :: {old[:50]}')
    s = s.replace(old, new, 1)

old_measure = '''function getMeasurementInstructionMessage() {
  return [
    "Para orientarte mejor, envíame por favor:",
    "• Peso en kilos, sin decimales",
    "• Estatura en metros, con punto o coma",
    "Ejemplo: 120 kg y 1.78 m"
  ].join("\\n");
}

function getMeasurementConfirmationMessage(weightKg, heightM) {
  return [
    "Quiero confirmar los datos antes de continuar:",
    "",
    `Tu peso es ${weightKg} kilos y tu estatura ${heightM} metros. ¿Está correcto?`,
    "",
    "Responde:",
    "1 si",
    "2 no"
  ].join("\\n");
}
'''
new_measure = '''function getMeasurementInstructionMessage() {
  return "Envíame tu peso y estatura. Ej: 88 kg y 1,69 m.";
}

function getMeasurementConfirmationMessage(weightKg, heightM) {
  return `Confirmo: ${weightKg} kg y ${heightM} m, ¿correcto?`;
}
'''
if s.count(old_measure) != 1:
    raise SystemExit(f'measurement block mismatch: {s.count(old_measure)}')
s = s.replace(old_measure, new_measure, 1)
p.write_text(s, encoding='utf-8')
