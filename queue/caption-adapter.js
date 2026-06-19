// queue/caption-adapter.js
//
// Adapta el caption original de @clinyco.cl o @doctorvillagran a la voz
// editorial de @fonasapad: foco en cobertura FONASA + Bono PAD, tono
// claro/educativo, CTA orientado a guardar/compartir (algoritmo 2026).
//
// Llamada a Claude Haiku 4.5 (rápido + barato, suficiente para reescribir
// captions de ~200-400 palabras). Si la llamada falla por cualquier razón
// (rate limit, error de red, falta de API key) hace fallback al caption
// original — la cola NO se rompe nunca por una mala adaptación.
//
// Ejecutado on-demand: al hacer "Aprobar" en el dashboard, el handler ya
// llama publishApproved(row) que usa row.adapted_caption || row.source_caption.
// Para que tenga sentido, el adapter SE LLAMA AL MOMENTO DE ENCOLAR (en
// selectNextCandidate) — así el editor ve la versión Fonasa lista para
// revisar, y puede comparar contra source_caption si quiere editar más.

import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `Eres editor de redes sociales de @fonasapad — la cuenta de Instagram/Facebook de Clínyco enfocada en explicar Bono PAD FONASA para cirugía bariátrica, plástica y especialidades médicas.

Tu trabajo: reescribir captions originales de @clinyco.cl o @doctorvillagran adaptándolos a la voz @fonasapad. Reglas duras:

1) Voz: cercana, directa, explicativa. Sin jerga médica innecesaria. Habla de tú a la persona.
2) Ángulo Fonasa+Bono PAD: cuando el contenido lo permita, conecta con "lo puedes hacer con Bono PAD FONASA", "el copago promedio es X", "necesitas tramo C o D", etc. NO inventes cifras: si el caption original no tiene un número, no agregues uno nuevo. Si el contenido es puramente educativo (qué es la cirugía X, qué esperar), agrega un párrafo final que mencione "muchos de nuestros pacientes lo cubren con Bono PAD; consulta si te corresponde" como puente.
3) CTA del algoritmo 2026: cerrar con invitación a GUARDAR o COMPARTIR (no a likear). Ejemplos: "Guarda este post para acordarte cuando lo necesites", "¿Conoces a alguien que necesite esta info? Compártela".
4) Hashtags: 3-5 hashtags relevantes. Siempre incluir #BonoPAD #Fonasa #Clinyco. No más de 5 totales.
5) Largo: similar al original o un poco más corto. Nunca más del doble.
6) Emojis: úsalos como el original. Si el original no tenía, usa máximo 2-3 sutiles.
7) Si el caption original menciona a @doctorvillagran o a @clinyco.cl o a un cirujano por nombre, mantén la mención pero como cita del equipo (NO te identifiques como ellos).
8) Si el contenido es promocional de Clínyco (bienvenida de equipo, nueva sucursal), reescríbelo como noticia para el seguidor desde el ángulo "lo que esto significa para tu acceso a Bono PAD".

OUTPUT FORMAT: devuelve SOLO el caption final reescrito. Sin "Aquí tienes:", sin explicación, sin markdown — solo el texto exacto que va a Instagram/Facebook.`;

const MODEL = process.env.FONASAPAD_ADAPTER_MODEL || "claude-haiku-4-5-20251001";

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// Reescribe el caption original adaptado a voz @fonasapad. Si algo falla,
// devuelve null y el caller cae al source_caption original.
export async function adaptCaptionForFonasapad({
  sourceCaption,
  sourceAccount,
  sourceMediaType,
} = {}) {
  if (!sourceCaption || sourceCaption.length < 20) return null;
  const c = getClient();
  if (!c) return null;
  try {
    const resp = await c.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Cuenta origen: @${sourceAccount}\nTipo: ${sourceMediaType || "POST"}\n\nCaption original:\n"""\n${sourceCaption}\n"""`,
      }],
    });
    const txt = resp?.content?.[0]?.text?.trim();
    if (!txt) return null;
    return txt.slice(0, 2200); // límite de IG es 2.200 caracteres
  } catch (err) {
    console.warn(`[caption-adapter] falló, usando caption original. ${err.message}`);
    return null;
  }
}
