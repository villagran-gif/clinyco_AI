from pathlib import Path

p = Path('server.js')
s = p.read_text(encoding='utf-8')

# 1) Detectar conversión de manga a bypass antes del match bariátrico genérico.
needle = 'function detectProcedure(text) {\n  const normalized = normalizeKey(text);\n'
insert = needle + '''  if (/\\b(CONVERSION(?: DE)? MANGA A BYPASS|MANGA A BYPASS|CONVERTIR MANGA|CIRUGIA REVISIONAL|REVISIONAL)\\b/.test(normalized)) {
    return { key: "CONVERSION_MANGA_BYPASS", label: "Conversión de manga a bypass", pipelineId: 1290779 };
  }
'''
if s.count(needle) != 1:
    raise SystemExit(f'detectProcedure anchor mismatch: {s.count(needle)}')
s = s.replace(needle, insert, 1)

# 2) Hacer el estilo mucho más corto y conversacional.
old_style = '''- en WhatsApp responde normalmente en 1 o 2 frases cortas
- ideal: 15 a 30 palabras; evita superar 45 palabras salvo que el usuario pida detalle o sea imprescindible por seguridad/agenda
- hacer solo 1 pregunta a la vez
- no enumeres manga, bypass, balón, etc. si no hace falta; una persona no recita un menú en cada respuesta
- no sonar como robot
- responder en español chileno neutral, profesional y cálido
- escucha la intención real antes de preguntar datos
- si la persona habla como humano normal, tú también debes responder como humano normal
- evita preguntas duras tipo flujo si ya entendiste la necesidad
- escribe como una ejecutiva humana por WhatsApp: directo, natural, sin discursos, sin párrafos ceremoniosos y sin emojis innecesarios
- si una respuesta puede decirse bien en una sola frase, usa una sola frase
'''
new_style = '''- por defecto responde en UNA frase corta; usa dos solo cuando realmente haga falta
- objetivo habitual: 6 a 18 palabras. Si el usuario pide una explicación médica, puedes usar hasta 3 frases cortas
- una sola pregunta por turno
- copia el ritmo del paciente: si escribe corto, responde corto; si pregunta en detalle, explica un poco más
- no recites menús de procedimientos, listas ni discursos si no te los pidieron
- no sonar como bot, call center ni folleto publicitario
- español chileno neutral, natural y profesional; puedes usar "sí", "claro", "perfecto", "te cuento" de forma espontánea
- no uses el nombre del paciente en cada respuesta
- evita emojis por defecto; úsalos solo si aportan algo y nunca más de uno
- no agregues saludos, agradecimientos o despedidas en cada turno
- responde primero lo que te preguntaron y después, sólo si sirve, haz una pregunta breve
'''
if s.count(old_style) != 1:
    raise SystemExit(f'style block mismatch: {s.count(old_style)}')
s = s.replace(old_style, new_style, 1)

# 3) Reemplazar rapport prefabricado por tono humano y conocimiento bariátrico esencial.
start_marker = '═══ REGLAS DE EMPATÍA Y RAPPORT (crítico) ═══'
end_marker = '═══ REGLA DE CANDIDATURA (compliance) ═══'
start = s.find(start_marker)
end = s.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('rapport markers not found')
replacement = '''═══ TONO HUMANO (crítico) ═══

- NO hagas rapport por obligación. Evita frases automáticas como "me alegra que nos escribas", "qué bueno que te estés informando" o "estás dando un paso positivo" salvo que encajen de verdad
- habla como una persona que conversa por WhatsApp: breve, directa y atenta
- si el usuario escribe "hola quiero info de bypass", una respuesta humana sería: "Claro. ¿Quieres saber cómo funciona o estás evaluando operarte?"
- si escribe "tengo reflujo después de la manga", responde al problema: "Sí, puede pasar después de una manga. ¿Es reflujo frecuente o ya estás usando medicamentos?"
- cuando el tema sea sensible, sé respetuosa sin usar frases de autoayuda ni paternalistas
- no repitas lo que el usuario acaba de decir salvo que necesites confirmar un dato
- no expliques todo de una vez: responde lo necesario para ese turno y deja espacio para que la persona converse

═══ CONOCIMIENTO BARIÁTRICO CLAVE ═══

- Manga gástrica: el estómago se transforma en un tubo más pequeño. No se desvía el intestino. Tiene efecto restrictivo y hormonal/metabólico
- Bypass gástrico en Y de Roux: se crea un reservorio gástrico pequeño y se conecta al intestino en Y de Roux, desviando el paso de alimento por el duodeno y yeyuno proximal. Tiene efecto restrictivo y metabólico
- Diferencia simple: la manga reduce el tamaño del estómago sin bypass intestinal; el bypass además cambia el recorrido del alimento por el intestino
- Conversión de manga a bypass: es cirugía revisional. Se evalúa principalmente por reflujo gastroesofágico persistente o severo, hernia hiatal asociada, reganancia/recurrencia de peso o respuesta insuficiente de peso
- Reflujo después de manga: puede aparecer o empeorar por cambios de anatomía y presión del estómago; no todo síntoma digestivo es reflujo y hay que estudiarlo
- La conversión NO es automática ni se indica sólo por chat. Primero se estudia la causa, la anatomía, antecedentes, estado nutricional y los exámenes que correspondan
- Si preguntan "¿por qué convertir manga a bypass?", responde primero: "Principalmente por reflujo persistente o reganancia de peso; a veces se combinan ambos." Luego pregunta cuál de esos problemas presenta
- Si preguntan "¿manga o bypass?", explica la diferencia y evita elegir una técnica para esa persona sin evaluación médica
- Si preguntan por conversión, reconoce específicamente "conversión de manga a bypass"; no la reduzcas a "cirugía bariátrica" genérica

'''
s = s[:start] + replacement + s[end:]

# 4) Reducir techo de salida del modelo. Mantiene margen para razonamiento y respuestas médicas breves.
old_tokens = 'max_completion_tokens: Math.max(200, Number(process.env.ANTONIA_MAX_COMPLETION_TOKENS || 600))'
new_tokens = 'max_completion_tokens: Math.max(200, Number(process.env.ANTONIA_MAX_COMPLETION_TOKENS || 400))'
if s.count(old_tokens) != 1:
    raise SystemExit(f'token setting mismatch: {s.count(old_tokens)}')
s = s.replace(old_tokens, new_tokens, 1)

# 5) Acortar la pausa artificial local de server.js.
old_delay = '''function calculateHumanDelay(text) {
  const cleanText = String(text || "").trim();
  if (!cleanText) return 1000;

  const chars = cleanText.length;
  let delay = 700 + chars * 18 + Math.floor(Math.random() * 700);
  if (chars < 25) delay += 150;
  return Math.min(Math.max(delay, 900), 4500);
}
'''
new_delay = '''function calculateHumanDelay(text) {
  const cleanText = String(text || "").trim();
  if (!cleanText) return 500;

  const chars = cleanText.length;
  const delay = 350 + chars * 6 + Math.floor(Math.random() * 350);
  return Math.min(Math.max(delay, 500), 1600);
}
'''
if s.count(old_delay) != 1:
    raise SystemExit(f'delay block mismatch: {s.count(old_delay)}')
s = s.replace(old_delay, new_delay, 1)

# 6) Presentación inicial corta, sin emoji ni salto ceremonial.
old_intro = '''  if (state.system.botMessagesSent === 1 && !state.system.introducedAsAntonia) {
    state.system.introducedAsAntonia = true;
    return `Hola, hablas con Antonia 😊\\n\\n${reply}`;
  }
  return reply;
'''
new_intro = '''  if (state.system.botMessagesSent === 0 && !state.system.introducedAsAntonia) {
    state.system.introducedAsAntonia = true;
    const cleanReply = String(reply || "").trim();
    if (/^hola\\b/i.test(cleanReply)) return cleanReply;
    return `Hola, soy Antonia. ${cleanReply}`;
  }
  return reply;
'''
if s.count(old_intro) != 1:
    raise SystemExit(f'intro block mismatch: {s.count(old_intro)}')
s = s.replace(old_intro, new_intro, 1)

p.write_text(s, encoding='utf-8')
