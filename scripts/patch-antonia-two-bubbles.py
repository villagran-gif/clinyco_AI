from pathlib import Path

server_path = Path('server.js')
s = server_path.read_text(encoding='utf-8')

# 1. Presentación inicial como burbuja separada y sin redacción ceremonial.
old_intro = '''function appendAntoniaIntroduction(state, reply) {
  if (state.system.botMessagesSent === 0 && !state.system.introducedAsAntonia) {
    state.system.introducedAsAntonia = true;
    const cleanReply = String(reply || "").trim();
    if (/^hola\\b/i.test(cleanReply)) return cleanReply;
    return `Hola, soy Antonia. ${cleanReply}`;
  }
  return reply;
}
'''
new_intro = '''function appendAntoniaIntroduction(state, reply) {
  if (state.system.botMessagesSent === 0 && !state.system.introducedAsAntonia) {
    state.system.introducedAsAntonia = true;
    const cleanReply = String(reply || "")
      .trim()
      .replace(/^hola[.!]?\\s*/i, "")
      .trim();
    return cleanReply ? `hola soy Antonia[[MSG]]${cleanReply}` : "hola soy Antonia";
  }
  return reply;
}
'''
if s.count(old_intro) != 1:
    raise SystemExit(f'intro mismatch: {s.count(old_intro)}')
s = s.replace(old_intro, new_intro, 1)

# 2. Tono: burbujas reales, pocas palabras y puntuación mínima.
old_style = '''- por defecto responde en UNA frase corta; usa dos solo cuando realmente haga falta
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
new_style = '''- escribe como chat real, no como texto redactado
- una respuesta normal tiene 1 o 2 burbujas de WhatsApp
- cada burbuja suele tener 2 a 9 palabras; intenta no superar 18 palabras en total
- si necesitas 2 burbujas sepáralas EXACTAMENTE con [[MSG]]
- la primera burbuja puede ser solo: claro / sí / perfecto / entiendo
- la segunda va directo al punto
- una sola pregunta por turno
- puedes escribir en minúsculas; no hace falta empezar cada mensaje con mayúscula
- usa puntuación mínima: evita comas, punto final, dos puntos y punto y coma
- en preguntas basta con ? al final; no necesitas escribir siempre el signo inicial ¿
- no escribas con faltas a propósito; la naturalidad viene del ritmo y la poca puntuación
- no recites menús ni listas largas salvo que el paciente las pida
- no sonar como bot, call center ni folleto
- no uses el nombre del paciente en cada respuesta
- evita emojis por defecto
- no agregues saludos, agradecimientos o despedidas en cada turno
- responde lo que preguntaron y deja espacio para que la persona siga conversando
'''
if s.count(old_style) != 1:
    raise SystemExit(f'style mismatch: {s.count(old_style)}')
s = s.replace(old_style, new_style, 1)

old_tone_examples = '''- si el usuario escribe "hola quiero info de bypass", una respuesta humana sería: "Claro. ¿Quieres saber cómo funciona o estás evaluando operarte?"
- si escribe "tengo reflujo después de la manga", responde al problema: "Sí, puede pasar después de una manga. ¿Es reflujo frecuente o ya estás usando medicamentos?"
'''
new_tone_examples = '''- si el usuario escribe "hola quiero info de bypass" responde por ejemplo: "claro[[MSG]]quieres saber cómo funciona o estás evaluando operarte?"
- si escribe "tengo reflujo después de la manga" responde por ejemplo: "sí puede pasar[[MSG]]te ocurre seguido o ya usas medicamentos?"
- si pregunta por conversión puedes responder: "claro[[MSG]]tu problema ahora es reflujo\\no reganancia\\no ambos?"
'''
if s.count(old_tone_examples) != 1:
    raise SystemExit(f'tone examples mismatch: {s.count(old_tone_examples)}')
s = s.replace(old_tone_examples, new_tone_examples, 1)

old_conversion_rule = '''- Si preguntan "¿por qué convertir manga a bypass?", responde primero: "Principalmente por reflujo persistente o reganancia de peso; a veces se combinan ambos." Luego pregunta cuál de esos problemas presenta
'''
new_conversion_rule = '''- Si preguntan por qué convertir manga a bypass responde corto: "sobre todo por reflujo o reganancia[[MSG]]a veces por ambos"
'''
if s.count(old_conversion_rule) != 1:
    raise SystemExit(f'conversion rule mismatch: {s.count(old_conversion_rule)}')
s = s.replace(old_conversion_rule, new_conversion_rule, 1)

old_measure_prompt = '''- para peso y estatura, si necesitas pedirlos, usa esta pauta exacta:
  Para orientarte mejor, indícame por favor:\\n• Peso en kilos, sin decimales\\n• Estatura en metros, usando punto o coma\\nEjemplo: 120 kg y 1.78 m
'''
new_measure_prompt = '''- si necesitas peso y estatura pregunta simple: "cuánto pesas?" y después "y cuánto mides?"
'''
if s.count(old_measure_prompt) != 1:
    raise SystemExit(f'measure prompt mismatch: {s.count(old_measure_prompt)}')
s = s.replace(old_measure_prompt, new_measure_prompt, 1)

# 3. Helpers para convertir la respuesta lógica en 1-2 burbujas reales.
anchor = '''function formatReplyForWhatsApp(text) {
  return String(text || "")
    .replace(/\\r/g, "")
    .replace(/[ \\t]+\\n/g, "\\n")
    .replace(/\\n[ \\t]+/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();
}
'''
helper = anchor + '''
function cleanHumanBubble(text) {
  let value = String(text || "").trim();
  if (!value) return "";
  value = value
    .replace(/^[¿¡]\\s*/, "")
    .replace(/[.!]+$/, "")
    .trim();
  if (/^(claro|sí|si|perfecto|entiendo|ya|ok)$/i.test(value)) {
    value = value.toLowerCase();
  }
  return value;
}

function splitAntoniaReplyBubbles(text) {
  const clean = formatReplyForWhatsApp(text);
  if (!clean) return [];

  let parts = clean
    .split(/\\s*\\[\\[MSG\\]\\]\\s*/i)
    .map(cleanHumanBubble)
    .filter(Boolean);

  if (parts.length === 1) {
    const ack = parts[0].match(/^(claro|sí|si|perfecto|entiendo|ya|ok)[.!]?\\s+([\\s\\S]+)$/i);
    if (ack?.[2]) {
      parts = [cleanHumanBubble(ack[1]), cleanHumanBubble(ack[2])].filter(Boolean);
    } else {
      const paragraphs = parts[0]
        .split(/\\n{2,}/)
        .map(cleanHumanBubble)
        .filter(Boolean);
      if (paragraphs.length > 1) parts = paragraphs;
    }
  }

  if (parts.length > 2) {
    parts = [parts[0], cleanHumanBubble(parts.slice(1).join("\\n"))];
  }

  return parts.slice(0, 2);
}
'''
if s.count(anchor) != 1:
    raise SystemExit(f'format anchor mismatch: {s.count(anchor)}')
s = s.replace(anchor, helper, 1)

# 4. Envío real en dos mensajes Chatwoot. Un solo turno lógico para contadores/estado.
old_final = '''  const finalReply = appendAntoniaIntroduction(latestState, reply);
  if (!allowDuplicateText && shouldSuppressOutboundReply(latestState, finalReply, kind)) {
'''
new_final = '''  const rawFinalReply = appendAntoniaIntroduction(latestState, reply);
  const replyBubbles = splitAntoniaReplyBubbles(rawFinalReply);
  const finalReply = replyBubbles.length
    ? replyBubbles.join("\\n\\n")
    : formatReplyForWhatsApp(rawFinalReply).replace(/\\[\\[MSG\\]\\]/g, "\\n").trim();
  if (!allowDuplicateText && shouldSuppressOutboundReply(latestState, finalReply, kind)) {
'''
if s.count(old_final) != 1:
    raise SystemExit(f'final reply anchor mismatch: {s.count(old_final)}')
s = s.replace(old_final, new_final, 1)

old_send = '''    if (!sentAsAudio) {
      await sendConversationReply(appId, conversationId, finalReply, info);
    }
'''
new_send = '''    if (!sentAsAudio) {
      const bubblesToSend = replyBubbles.length ? replyBubbles : [finalReply];
      for (let i = 0; i < bubblesToSend.length; i += 1) {
        if (i > 0) {
          await sleep(300 + Math.floor(Math.random() * 450));
          if (!getConversationState(conversationId).system.aiEnabled) break;
          if (!isStillLatestUserMessage(conversationId, messageId)) break;
        }
        await sendConversationReply(appId, conversationId, bubblesToSend[i], info);
      }
    }
'''
if s.count(old_send) != 1:
    raise SystemExit(f'send anchor mismatch: {s.count(old_send)}')
s = s.replace(old_send, new_send, 1)

server_path.write_text(s, encoding='utf-8')

# 5. Resolver determinístico también debe sonar a WhatsApp real.
resolver_path = Path('conversation-resolver.js')
r = resolver_path.read_text(encoding='utf-8')
replacements = {
    '"Claro. ¿Con qué profesional o especialidad buscas hora?"': '"claro[[MSG]]con qué profesional buscas hora?"',
    '"Claro. ¿Qué necesitas resolver hoy?"': '"claro[[MSG]]qué necesitas resolver hoy?"',
    '"Claro. ¿Qué necesitas resolver ahora?"': '"claro[[MSG]]qué necesitas resolver ahora?"',
    '"¿Me compartes tu correo? Si ya eres paciente, también puede ser tu RUT."': '"me compartes tu correo?[[MSG]]si ya eres paciente puede ser tu RUT"',
    '"¿Qué procedimiento te interesa?"': '"qué procedimiento te interesa?"',
    '"¿Tu previsión es Fonasa, Isapre o Particular?"': '"tu previsión es Fonasa Isapre o Particular?"',
    '"¿Qué tramo Fonasa tienes: A, B, C o D?"': '"qué tramo Fonasa tienes A B C o D?"',
    '"¿Cuánto pesas actualmente?"': '"cuánto pesas?"',
    '"¿Y cuánto mides?"': '"y cuánto mides?"',
    '"Cuéntame un poco más."': '"cuéntame un poco más"',
}
for old, new in replacements.items():
    if r.count(old) != 1:
        raise SystemExit(f'resolver replacement mismatch for {old}: {r.count(old)}')
    r = r.replace(old, new, 1)
resolver_path.write_text(r, encoding='utf-8')

# 6. Textos determinísticos en server.
s = server_path.read_text(encoding='utf-8')
server_replacements = {
    'return "Envíame tu peso y estatura. Ej: 88 kg y 1,69 m.";': 'return "envíame peso y estatura[[MSG]]por ejemplo 88 kg y 1,69 m";',
    'return `Confirmo: ${weightKg} kg y ${heightM} m, ¿correcto?`;': 'return `te tengo con ${weightKg} kg y ${heightM} m[[MSG]]está bien?`;',
    'reply: "¿Qué tramo Fonasa tienes: A, B, C o D?",': 'reply: "qué tramo Fonasa tienes A B C o D?",',
    'reply: "¿Cuál Isapre tienes?",': 'reply: "cuál Isapre tienes?",',
}
for old, new in server_replacements.items():
    if s.count(old) != 1:
        raise SystemExit(f'server replacement mismatch for {old}: {s.count(old)}')
    s = s.replace(old, new, 1)
server_path.write_text(s, encoding='utf-8')
