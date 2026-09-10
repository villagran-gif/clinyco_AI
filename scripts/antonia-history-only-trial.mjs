// Isolated replay: GET Chatwoot history, optionally ask the configured model.
// Never imports server.js, reads saved state, writes the DB, or sends a reply.
import { pathToFileURL } from "node:url";

export function buildTrial(messages, throughId) {
  const ordered = [...messages].sort((a, b) => Number(a.id) - Number(b.id));
  const cutoff = ordered.find(m => String(m.id) === String(throughId));
  const incoming = m => m.message_type === 0 || m.message_type === "incoming";
  const outgoing = m => m.message_type === 1 || m.message_type === "outgoing";
  const visible = m => ![true, "true", 1].includes(m.private)
    && m.content_attributes?.kind !== "live_lead_card"
    && !/^\s*📋\s*FICHA VIVA/u.test(m.content || "")
    && (incoming(m) || outgoing(m));
  if (!cutoff || !incoming(cutoff) || !visible(cutoff)) {
    throw new Error("--through must identify a public incoming message in the full history");
  }
  const prior = ordered.filter(m => Number(m.id) <= Number(cutoff.id) && visible(m));
  // Do not silently pretend attachments were read by this text-only experiment.
  if (prior.some(m => m.attachments?.length)) {
    throw new Error("History includes attachments; transcribe/review them before a text-only comparison");
  }
  const history = prior.filter(m => String(m.content || "").trim()).map(m => ({
    role: incoming(m) ? "user" : "assistant", content: m.content,
  }));
  if (!history.length || history.at(-1).role !== "user") throw new Error("Empty user turn");
  const next = ordered.find(m => Number(m.id) > Number(cutoff.id) && visible(m));
  return {
    // This is the observed next message, not a reconstructed baseline model call.
    observedNextReply: next && outgoing(next) ? next.content : null,
    messages: [{ role: "system", content: [
      "Eres Antonia, asistente de atención de Clinyco. Esta es una evaluación offline.",
      "Reconstruye los datos exclusivamente desde el historial real adjunto, sin ficha previa ni paso pendiente.",
      "Distingue peso actual, mínimo posoperatorio y pesos históricos. Las correcciones explícitas prevalecen.",
      "Las respuestas anteriores del asistente pueden contener errores; no son evidencia de datos del paciente.",
      "Incorpora todos los mensajes consecutivos. Responde la solicitud actual antes de preguntar algo más.",
      "No repitas datos ya respondidos. Conserva sospechas como sospechas, sin convertirlas en diagnósticos.",
      "No inventes precios, disponibilidad ni acciones realizadas. No diagnostiques ni indiques tratamiento.",
      "Devuelve JSON con datos_extraidos, correcciones_detectadas, necesidad_actual y respuesta_propuesta.",
    ].join("\n") }, ...history],
  };
}

export async function readCompleteHistory({ token, conversationId, fetchImpl = fetch }) {
  const all = new Map();
  let before = null;
  for (let page = 0; page < 1000; page++) {
    const url = new URL(`https://app.chatwoot.com/api/v1/accounts/162472/conversations/${conversationId}/messages`);
    if (before !== null) url.searchParams.set("before", before);
    const response = await fetchImpl(url, { headers: { api_access_token: token }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Chatwoot history HTTP ${response.status}`);
    const body = await response.json();
    const batch = body.payload;
    if (!Array.isArray(batch)) throw new Error("Unexpected Chatwoot history payload");
    if (!batch.length) return [...all.values()];
    if (batch.some(m => !/^\d+$/.test(String(m.id)))) throw new Error("Invalid message ID");
    for (const m of batch) all.set(String(m.id), m);
    const oldest = Math.min(...batch.map(m => Number(m.id)));
    if (before !== null && oldest >= Number(before)) throw new Error("History pagination stalled; refusing partial replay");
    before = String(oldest);
  }
  throw new Error("History pagination limit exceeded; refusing partial replay");
}

async function main() {
  const args = process.argv.slice(2);
  const through = args.find(a => a.startsWith("--through="))?.split("=")[1];
  const conversationId = "11175"; // Explicitly scoped trial; no live webhook flag.
  if (!through || !process.env.CHATWOOT_API_TOKEN) {
    throw new Error("Requires CHATWOOT_API_TOKEN and --through=<incoming-message-id>. Add --run for model evaluation.");
  }
  const history = await readCompleteHistory({ token: process.env.CHATWOOT_API_TOKEN, conversationId });
  const trial = buildTrial(history, through);
  if (!args.includes("--run")) {
    console.log(JSON.stringify({ conversationId, through, mode: "prepared_only", ...trial }, null, 2));
    return;
  }
  // Require explicit runtime configuration; do not silently change model.
  const model = process.env.OPENAI_MODEL;
  if (!model || !process.env.OPENAI_API_KEY) throw new Error("Requires configured OPENAI_MODEL and OPENAI_API_KEY");
  const request = { model, messages: trial.messages, max_completion_tokens: 2400 };
  if (model.startsWith("gpt-5.6")) request.reasoning_effort = process.env.ANTONIA_REASONING_EFFORT || "none";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(request), signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Model HTTP ${response.status}`);
  const result = await response.json();
  const proposed = result.choices?.[0]?.message?.content;
  if (!proposed) throw new Error("Model returned no text; trial inconclusive");
  console.log(JSON.stringify({ conversationId, through, model, observedNextReply: trial.observedNextReply, proposed, usage: result.usage }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
