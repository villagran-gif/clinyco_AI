// lead-alerts/messages.js
//
// Construcción PURA de textos (alerta a María Paz + recordatorios) y del link Chatwoot.
// Sin DB ni red: testeable. El "chat resumido" v1 es determinista a partir de los
// campos estructurados del lead (structured_leads). Un resumen LLM queda como mejora futura.

const DEFAULT_ACCOUNT_ID = "162472";
const CHATWOOT_APP_URL = "https://app.chatwoot.com";

// Sólo las conversaciones de Chatwoot (prefijo cw:) tienen UI navegable por la agente.
export function chatwootConversationUrl(conversationId, opts = {}) {
  const accountId = opts.accountId || process.env.CHATWOOT_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
  const baseUrl = (opts.baseUrl || process.env.CHATWOOT_API_URL || CHATWOOT_APP_URL).replace(/\/+$/, "");
  const id = String(conversationId || "");
  if (!id.startsWith("cw:")) return null;
  return `${baseUrl}/app/accounts/${accountId}/conversations/${id.replace(/^cw:/, "")}`;
}

function fmtImc(lead) {
  if (lead.imc == null) return null;
  return `IMC ${lead.imc}${lead.categoriaImc ? ` (${lead.categoriaImc})` : ""}`;
}

export function buildSummary(lead = {}) {
  const cobertura = [lead.prevision, lead.modalidad].filter(Boolean).join(" ");
  return [
    lead.procedimiento && `Interés: ${lead.procedimiento}`,
    cobertura && `Previsión: ${cobertura}`,
    fmtImc(lead),
    lead.peso && lead.alturaCm && `${lead.peso} kg / ${lead.alturaCm} cm`,
    lead.ciudad && `Reside: ${lead.ciudad}`,
    lead.ciudadAtencion && `Se atiende en: ${lead.ciudadAtencion}`
  ].filter(Boolean).join(" · ");
}

export function buildMariaPazAlert(lead = {}, opts = {}) {
  const nombre = lead.nombre || "Lead";
  const score = lead.score != null
    ? ` (score ${lead.score}${lead.scoreCategory ? " " + lead.scoreCategory : ""})`
    : "";
  return [
    `🔔 Lead calificado${score}: ${nombre}`,
    opts.summary || buildSummary(lead),
    lead.telefono && `📱 ${lead.telefono}`,
    opts.url && `💬 Chat: ${opts.url}`
  ].filter(Boolean).join("\n");
}

export function buildAgentReminder(lead = {}, opts = {}) {
  const saludo = opts.agentName ? `Hola ${opts.agentName.split(" ")[0]}, ` : "";
  return `${saludo}tienes un lead pendiente por contactar: ${lead.nombre || ""} — ${lead.procedimiento || "consulta"}.${lead.telefono ? ` ${lead.telefono}` : ""}`.trim();
}

export function buildClientReminder(lead = {}) {
  const nombre = (lead.nombre || "").split(" ")[0];
  const saludo = nombre ? `Hola ${nombre}, ` : "Hola, ";
  return `${saludo}gracias por dejar tu solicitud en Clínyco. Una agente te contactará a la brevedad para coordinar tu ${lead.procedimiento || "atención"}. 💙`;
}
