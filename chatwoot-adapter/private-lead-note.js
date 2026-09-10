import { createHash } from "node:crypto";
import { sendChatwootPrivateNote, deleteChatwootMessage } from "./client.js";

const FIELD_LABELS = Object.freeze({
  name: "nombre", procedure: "procedimiento", weight: "peso", height: "estatura",
  bmi: "IMC", insurance: "previsión", city: "ciudad", prior_surgery: "cirugía previa",
  prior_year: "año de cirugía", revision_reason: "motivo revisional", studies: "estudios",
  age: "edad", comorbidities: "antecedentes", smoking: "tabaco"
});

const SUSPICIOUS_NAME_WORDS = new Set([
  "quiero", "quisiera", "consultar", "consulta", "saber", "preguntar", "necesito",
  "cotizar", "agendar", "informacion", "valor", "precio"
]);

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function clean(value) {
  return present(value) ? String(value).trim().replace(/\s+/g, " ") : null;
}

function cleanProfileName(value) {
  const text = clean(value);
  if (!text) return null;
  return text.replace(/^#+\s*/, "").replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, "").replace(/\s+/g, " ").trim() || null;
}

function safeDraftName(contact = {}) {
  const value = clean([contact.c_nombres, contact.c_apellidos].filter(Boolean).join(" "));
  if (!value) return null;
  const words = value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/);
  return words.some((word) => SUSPICIOUS_NAME_WORDS.has(word)) ? null : value;
}

function normalizePriorSurgery(value) {
  const raw = clean(value);
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (key === "manga") return "Manga gástrica";
  if (key === "bypass") return "Bypass gástrico";
  if (key === "ninguna") return "Ninguna";
  return raw;
}

export function buildPrivateLeadSnapshot(state = {}) {
  const contact = state.contactDraft || {};
  const deal = state.dealDraft || {};
  const measurements = state.measurements || {};
  const answers = state.preevaluation?.answers || {};
  const identity = state.identity || {};

  const verifiedName = safeDraftName(contact);
  const profileName = !verifiedName ? cleanProfileName(identity.sourceProfileName || identity.channelDisplayName) : null;
  const insurance = clean(contact.c_aseguradora);
  const modality = clean(contact.c_modalidad);

  const data = {
    name: verifiedName,
    profile_name: profileName,
    procedure: clean(deal.dealInteres),
    weight: measurements.weightKg ?? (present(deal.dealPeso) ? deal.dealPeso : null),
    height: measurements.heightM ?? (present(measurements.heightCm) ? Number(measurements.heightCm) / 100 : null),
    bmi: measurements.bmi ?? null,
    insurance: insurance ? `${insurance}${modality ? ` — ${modality}` : ""}` : null,
    city: clean(contact.c_comuna || answers.city),
    prior_surgery: normalizePriorSurgery(answers.prior_surgery || deal.dealCirugiasPrevias),
    prior_year: answers.prior_year ?? null,
    revision_reason: clean(answers.revision_reason),
    studies: clean(answers.studies),
    age: answers.age ?? null,
    comorbidities: clean(answers.comorbidities),
    smoking: clean(answers.smoking)
  };

  const meaningfulKeys = Object.keys(FIELD_LABELS).filter((key) => present(data[key]));
  const useful = meaningfulKeys.some((key) => [
    "name", "procedure", "weight", "height", "insurance", "city", "prior_surgery", "prior_year",
    "revision_reason", "studies"
  ].includes(key)) || present(data.profile_name);

  return useful ? { data, meaningfulKeys } : null;
}

function formatHeight(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2).replace(".", ",")} m` : clean(value);
}

function formatWeight(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${String(n).replace(".", ",")} kg` : clean(value);
}

export function buildPrivateLeadNote(state = {}) {
  const snapshot = buildPrivateLeadSnapshot(state);
  if (!snapshot) return null;
  const { data } = snapshot;
  const lines = [];

  if (data.name) lines.push(`👤 Nombre: ${data.name}`);
  else if (data.profile_name) lines.push(`👤 Perfil: ${data.profile_name} (sin verificar)`);
  if (data.procedure) lines.push(`🎯 Interés: ${data.procedure}`);
  if (present(data.weight)) lines.push(`⚖️ Peso: ${formatWeight(data.weight)}`);
  if (present(data.height)) lines.push(`📏 Estatura: ${formatHeight(data.height)}`);
  if (present(data.bmi)) lines.push(`📊 IMC: ${String(data.bmi).replace(".", ",")}`);
  if (data.insurance) lines.push(`🏥 Previsión: ${data.insurance}`);
  if (data.city) lines.push(`📍 Ciudad: ${data.city}`);
  if (data.prior_surgery) lines.push(`🩺 Cirugía previa: ${data.prior_surgery}`);
  if (present(data.prior_year)) lines.push(`📅 Año cirugía: ${data.prior_year}`);
  if (data.revision_reason) lines.push(`🔎 Motivo: ${data.revision_reason}`);
  if (data.studies) lines.push(`🧪 Estudios: ${data.studies}`);
  if (present(data.age)) lines.push(`🎂 Edad: ${data.age}`);
  if (data.comorbidities) lines.push(`📌 Antecedentes: ${data.comorbidities}`);
  if (data.smoking) lines.push(`🚭 Tabaco: ${data.smoking}`);

  const content = lines.join("\n");
  const fingerprint = createHash("sha256").update(content).digest("hex").slice(0, 24);
  return { content, fingerprint, snapshot };
}

export async function maybeSyncPrivateLeadNote({ conversationId, state, channel = null } = {}) {
  try {
    if (!String(conversationId || "").startsWith("cw:")) return { skipped: "not_chatwoot" };
    if (channel && !/whatsapp|instagram|facebook|chatwoot/i.test(String(channel))) return { skipped: "unsupported_channel" };

    const built = buildPrivateLeadNote(state);
    if (!built) return { skipped: "no_meaningful_data" };
    state.system ||= {};
    if (state.system.privateLeadNoteFingerprint === built.fingerprint) return { skipped: "unchanged" };

    const previousMessageId = state.system.privateLeadNoteMessageId || null;
    const created = await sendChatwootPrivateNote({ conversationId, content: built.content });
    if (!created?.messageId) return { skipped: "create_unconfirmed" };

    state.system.privateLeadNoteFingerprint = built.fingerprint;
    state.system.privateLeadNoteMessageId = String(created.messageId);
    state.system.privateLeadNoteUpdatedAt = new Date().toISOString();

    if (previousMessageId && String(previousMessageId) !== String(created.messageId)) {
      try {
        await deleteChatwootMessage({ conversationId, messageId: previousMessageId });
      } catch (error) {
        console.warn("CHATWOOT_PRIVATE_NOTE_DELETE_WARNING", error.message);
      }
    }

    return { synced: true, messageId: String(created.messageId) };
  } catch (error) {
    console.warn("CHATWOOT_PRIVATE_NOTE_SYNC_WARNING", error.message);
    return { synced: false, error: error.message };
  }
}
