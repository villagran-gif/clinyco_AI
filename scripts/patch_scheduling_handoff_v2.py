from pathlib import Path
import re

# Chatwoot: assignment API
p = Path('chatwoot-adapter/client.js')
s = p.read_text()
if 'assignChatwootConversation' not in s:
    s += '''\n\nexport async function assignChatwootConversation({ conversationId, assigneeId = null, teamId = null }) {\n  const realId = stripConversationNamespace(conversationId);\n  if (!realId) throw new Error("assignChatwootConversation: conversationId requerido");\n  if (!assigneeId && !teamId) throw new Error("assignChatwootConversation: assigneeId o teamId requerido");\n  if (isDryRun()) {\n    console.log("[chatwoot-adapter/dry-run] assignChatwootConversation", { conversationId: realId, assigneeId, teamId });\n    return { assigned: true, dryRun: true };\n  }\n  const body = {};\n  if (assigneeId) body.assignee_id = Number(assigneeId);\n  if (teamId) body.team_id = Number(teamId);\n  const url = `${baseUrl()}/api/v1/accounts/${accountId()}/conversations/${realId}/assignments`;\n  const res = await fetch(url, {\n    method: "POST",\n    headers: { "Content-Type": "application/json", api_access_token: token() },\n    body: JSON.stringify(body),\n  });\n  const text = await res.text();\n  if (!res.ok) throw new Error(`Chatwoot assignment failed ${res.status}: ${text.slice(0, 300)}`);\n  return { assigned: true };\n}\n'''
p.write_text(s)

p = Path('server.js')
s = p.read_text()

old = 'import { sendChatwootReply, sendChatwootAttachment } from "./chatwoot-adapter/client.js";'
new = 'import { sendChatwootReply, sendChatwootAttachment, assignChatwootConversation } from "./chatwoot-adapter/client.js";'
assert old in s
s = s.replace(old, new, 1)

anchor = 'const MEDINET_AGENDA_WEB_URL = "https://clinyco.medinetapp.com/agendaweb/planned/";'
assert anchor in s
s = s.replace(anchor, 'const MELANIA_LEGACY_MENU_ENABLED = process.env.MELANIA_LEGACY_MENU_ENABLED === "true";\nconst CHATWOOT_SCHEDULING_ASSIGNEE_ID = Number(process.env.CHATWOOT_SCHEDULING_ASSIGNEE_ID || 179952);\n' + anchor, 1)

legacy = '    // --- MelanIA activation: when Antonia detects booking intent ---\n    if (!state.melania?.active) {'
assert legacy in s
s = s.replace(legacy, '    // --- MelanIA headless: el menú legacy queda apagado salvo opt-in explícito. ---\n    if (MELANIA_LEGACY_MENU_ENABLED && !state.melania?.active) {', 1)

helper_anchor = 'const handleInboundWebhook = async (req, res) => {'
assert helper_anchor in s
helper = r'''async function handoffSchedulingToCarolin({ conversationId, state, channelLabel, reason = "scheduling_fallback" }) {
  let assigned = false;
  try {
    await assignChatwootConversation({ conversationId, assigneeId: CHATWOOT_SCHEDULING_ASSIGNEE_ID });
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
  return { assigned, reply: "ok[[MSG]]te lo dejo con Carolin para que revise las horas" };
}

'''
s = s.replace(helper_anchor, helper + helper_anchor, 1)

handoff_block = r'''        if (!antoniaResponse?.available_slots?.length) {
          const schedulingHandoff = await handoffSchedulingToCarolin({ conversationId, state, channelLabel, reason: "medinet_no_slots_or_search_failed" });
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
pat1 = r'        const searchReply = antoniaResponse\?\.patient_reply.*?        if \(searchReply\) \{'
s, n1 = re.subn(pat1, handoff_block, s, count=1, flags=re.S)
assert n1 == 1, f'searchReply replace count={n1}'

handoff_block2 = handoff_block.replace('const searchReply =', 'const searchReply2 =').replace('if (searchReply) {', 'if (searchReply2) {')
pat2 = r'        const searchReply2 = antoniaResponse\?\.patient_reply.*?        if \(searchReply2\) \{'
s, n2 = re.subn(pat2, handoff_block2, s, count=1, flags=re.S)
assert n2 == 1, f'searchReply2 replace count={n2}'

old_else = '''        let reply;\n        if (bookingResult?.success) {\n          reply = bookingResult.patient_reply || "Tu hora fue agendada correctamente.";\n        } else {\n          reply = bookingFailureMessage;\n        }'''
new_else = '''        let reply;\n        if (bookingResult?.success) {\n          reply = bookingResult.patient_reply || "Tu hora fue agendada correctamente.";\n        } else {\n          const schedulingHandoff = await handoffSchedulingToCarolin({ conversationId, state, channelLabel, reason: "medinet_booking_failed" });\n          reply = schedulingHandoff.reply;\n        }'''
assert old_else in s
s = s.replace(old_else, new_else, 1)

pat_err = r'        const errorReply = "No fue posible concretar tu agendamiento.*?Antonia, soy una IA mejorando cada día\.";'
repl_err = '''        const schedulingHandoff = await handoffSchedulingToCarolin({ conversationId, state, channelLabel, reason: "medinet_booking_exception" });\n        const errorReply = schedulingHandoff.reply;'''
s, nerr = re.subn(pat_err, repl_err, s, count=1, flags=re.S)
assert nerr == 1, f'error fallback replace count={nerr}'

p.write_text(s)

Path('scripts/check_scheduling_handoff.mjs').write_text(r'''import fs from "node:fs";
const server = fs.readFileSync("server.js", "utf8");
const client = fs.readFileSync("chatwoot-adapter/client.js", "utf8");
for (const expected of [
  "assignChatwootConversation",
  "MELANIA_LEGACY_MENU_ENABLED && !state.melania?.active",
  "CHATWOOT_SCHEDULING_ASSIGNEE_ID || 179952",
  "te lo dejo con Carolin para que revise las horas",
  "medinet_no_slots_or_search_failed",
]) {
  if (!(server + client).includes(expected)) throw new Error(`missing: ${expected}`);
}
console.log("scheduling handoff checks ok");
''')
