from pathlib import Path

# --- chatwoot assignment helper ---
p = Path('chatwoot-adapter/client.js')
s = p.read_text()
if 'assignChatwootConversation' not in s:
    s += '''\n\n// Asigna una conversación de Chatwoot a un agente o equipo concreto.\n// Se usa para handoff real de agendamiento cuando Medinet no puede resolver.\nexport async function assignChatwootConversation({ conversationId, assigneeId = null, teamId = null }) {\n  const realId = stripConversationNamespace(conversationId);\n  if (!realId) throw new Error("assignChatwootConversation: conversationId requerido");\n  if (!assigneeId && !teamId) throw new Error("assignChatwootConversation: assigneeId o teamId requerido");\n\n  if (isDryRun()) {\n    console.log("[chatwoot-adapter/dry-run] assignChatwootConversation", {\n      conversationId: realId, assigneeId, teamId,\n    });\n    return { assigned: true, dryRun: true };\n  }\n\n  const body = {};\n  if (assigneeId) body.assignee_id = Number(assigneeId);\n  if (teamId) body.team_id = Number(teamId);\n\n  const url = `${baseUrl()}/api/v1/accounts/${accountId()}/conversations/${realId}/assignments`;\n  const res = await fetch(url, {\n    method: "POST",\n    headers: { "Content-Type": "application/json", api_access_token: token() },\n    body: JSON.stringify(body),\n  });\n  const text = await res.text();\n  if (!res.ok) {\n    throw new Error(`Chatwoot assignment failed ${res.status}: ${text.slice(0, 300)}`);\n  }\n  return { assigned: true };\n}\n'''
p.write_text(s)

# --- server.js ---
p = Path('server.js')
s = p.read_text()

old_import = 'import { sendChatwootReply, sendChatwootAttachment } from "./chatwoot-adapter/client.js";'
new_import = 'import { sendChatwootReply, sendChatwootAttachment, assignChatwootConversation } from "./chatwoot-adapter/client.js";'
assert old_import in s, 'chatwoot import not found'
s = s.replace(old_import, new_import, 1)

anchor = 'const MEDINET_AGENDA_WEB_URL = "https://clinyco.medinetapp.com/agendaweb/planned/";'
insert = '''const MELANIA_LEGACY_MENU_ENABLED = process.env.MELANIA_LEGACY_MENU_ENABLED === "true";\nconst CHATWOOT_SCHEDULING_ASSIGNEE_ID = Number(process.env.CHATWOOT_SCHEDULING_ASSIGNEE_ID || 179952);\n'''
assert anchor in s, 'MEDINET anchor not found'
s = s.replace(anchor, insert + anchor, 1)

legacy = '''    // --- MelanIA activation: when Antonia detects booking intent ---\n    if (!state.melania?.active) {'''
replacement = '''    // --- Legacy MelanIA menu disabled by default.\n    // AntonIA owns the conversation; MelanIA is used headless only for Medinet search/booking. ---\n    if (MELANIA_LEGACY_MENU_ENABLED && !state.melania?.active) {'''
assert legacy in s, 'legacy Melania activation block not found'
s = s.replace(legacy, replacement, 1)

helper_anchor = 'const handleInboundWebhook = async (req, res) => {'
helper = r'''async function handoffSchedulingToCarolin({ conversationId, state, channelLabel, reason = "scheduling_fallback" }) {
  let assigned = false;
  try {
    await assignChatwootConversation({
      conversationId,
      assigneeId: CHATWOOT_SCHEDULING_ASSIGNEE_ID,
    });
    assigned = true;
    console.log("[scheduling-handoff] assigned to Carolin", { conversationId, assigneeId: CHATWOOT_SCHEDULING_ASSIGNEE_ID, reason });
  } catch (error) {
    console.error("[scheduling-handoff] assignment failed:", error.message);
  }

  state.system ||= {};
  state.booking ||= {};
  state.system.aiEnabled = false;
  state.system.humanTakenOver = true;
  state.system.humanPauseUntil = new Date(Date.now() + HUMAN_HANDOFF_PAUSE_MS).toISOString();
  state.system.handoffReason = reason;
  state.booking.handoffToScheduling = true;
  state.booking.handoffAssigneeId = CHATWOOT_SCHEDULING_ASSIGNEE_ID;
  await persistConversationSnapshot(conversationId, state, channelLabel);

  return {
    assigned,
    reply: "ok[[MSG]]te lo dejo con Carolin para que revise las horas",
  };
}

'''
assert helper_anchor in s, 'handleInboundWebhook anchor not found'
s = s.replace(helper_anchor, helper + helper_anchor, 1)

# Replace the two no-slot self-service fallbacks with real scheduling handoff.
needle1 = r'''        const searchReply = antoniaResponse?.patient_reply
          || "No encontré horas disponibles para esa búsqueda.\
\
Puedes agendar directamente en https://clinyco.medinetapp.com/agendaweb/planned/";
        if (searchReply) {'''
repl1 = r'''        if (!antoniaResponse?.available_slots?.length) {
          const schedulingHandoff = await handoffSchedulingToCarolin({
            conversationId, state, channelLabel, reason: "medinet_no_slots_or_search_failed"
          });
          return res.json(await sendManagedReply({
            appId, conversationId, messageId, userText,
            reply: schedulingHandoff.reply,
            kind: "schedule_handoff_no_slots",
            state, info, channelLabel,
            resolverDecision: { stage: "scheduling_handoff", nextAction: "human_scheduling", reason: "Medinet did not return usable slots" }
          }));
        }

        const searchReply = antoniaResponse?.patient_reply;
        if (searchReply) {'''
assert needle1 in s, 'searchReply fallback block not found'
s = s.replace(needle1, repl1, 1)

needle2 = r'''        const searchReply2 = antoniaResponse?.patient_reply
          || "No encontré horas disponibles para esa búsqueda.\
\
Puedes agendar directamente en https://clinyco.medinetapp.com/agendaweb/planned/";
        if (searchReply2) {'''
repl2 = r'''        if (!antoniaResponse?.available_slots?.length) {
          const schedulingHandoff = await handoffSchedulingToCarolin({
            conversationId, state, channelLabel, reason: "medinet_no_slots_or_search_failed"
          });
          return res.json(await sendManagedReply({
            appId, conversationId, messageId, userText,
            reply: schedulingHandoff.reply,
            kind: "schedule_handoff_no_slots",
            state, info, channelLabel,
            resolverDecision: { stage: "scheduling_handoff", nextAction: "human_scheduling", reason: "Medinet did not return usable slots" }
          }));
        }

        const searchReply2 = antoniaResponse?.patient_reply;
        if (searchReply2) {'''
assert needle2 in s, 'searchReply2 fallback block not found'
s = s.replace(needle2, repl2, 1)

# Booking result failure: handoff instead of dead-end + web link.
old_else = r'''        let reply;
        if (bookingResult?.success) {
          reply = bookingResult.patient_reply || "Tu hora fue agendada correctamente.";
        } else {
          reply = bookingFailureMessage;
        }'''
new_else = r'''        let reply;
        if (bookingResult?.success) {
          reply = bookingResult.patient_reply || "Tu hora fue agendada correctamente.";
        } else {
          const schedulingHandoff = await handoffSchedulingToCarolin({
            conversationId, state, channelLabel, reason: "medinet_booking_failed"
          });
          reply = schedulingHandoff.reply;
        }'''
assert old_else in s, 'booking result failure block not found'
s = s.replace(old_else, new_else, 1)

# Exception path: same human fallback.
old_error_start = '        const errorReply = "No fue posible concretar tu agendamiento. Disculpas mil... 😔\\\n'
if old_error_start in s:
    start = s.index(old_error_start)
    end_marker = 'Antonia, soy una IA mejorando cada día.";'
    end = s.index(end_marker, start) + len(end_marker)
    replacement_error = r'''        const schedulingHandoff = await handoffSchedulingToCarolin({
          conversationId, state, channelLabel, reason: "medinet_booking_exception"
        });
        const errorReply = schedulingHandoff.reply;'''
    s = s[:start] + replacement_error + s[end:]

p.write_text(s)

# --- lightweight tests / assertions ---
p = Path('scripts/check_scheduling_handoff.mjs')
p.write_text(r'''import fs from "node:fs";
const server = fs.readFileSync("server.js", "utf8");
const client = fs.readFileSync("chatwoot-adapter/client.js", "utf8");
if (!client.includes("assignChatwootConversation")) throw new Error("missing Chatwoot assignment helper");
if (!server.includes("MELANIA_LEGACY_MENU_ENABLED && !state.melania?.active")) throw new Error("legacy MelanIA menu still active by default");
if (!server.includes("CHATWOOT_SCHEDULING_ASSIGNEE_ID || 179952")) throw new Error("Carolin scheduling assignee missing");
if (!server.includes("te lo dejo con Carolin para que revise las horas")) throw new Error("human scheduling handoff reply missing");
if (server.includes("Puedes agendar directamente en https://clinyco.medinetapp.com/agendaweb/planned/")) {
  console.warn("legacy web links remain in unrelated paths; verify manually");
}
console.log("scheduling handoff checks ok");
''')
