from pathlib import Path

p = Path('server.js')
s = p.read_text()

# 1) El mensaje de handoff debe poder salir aun cuando el helper ya haya pausado AntonIA.
old = '''  const latestState = getConversationState(conversationId);
  if (!latestState.system.aiEnabled) {
    return resJsonSkip("ai_disabled_after_delay");
  }
'''
new = '''  const latestState = getConversationState(conversationId);
  const isSchedulingHandoffReply = Boolean(latestState.booking?.handoffToScheduling);
  if (!latestState.system.aiEnabled && !isSchedulingHandoffReply) {
    return resJsonSkip("ai_disabled_after_delay");
  }
'''
assert old in s, 'sendManagedReply ai-enabled guard not found'
s = s.replace(old, new, 1)

# 2) Reservar en la misma sucursal/agenda que produjo el slot (telemedicina 2/3, Antofagasta 39).
old = '''    const result = await callMedinetWorkerApiBook({
      slot,
      patientData,
      branchId: DEFAULT_BRANCH_ID
    }, timeoutMs);'''
new = '''    const result = await callMedinetWorkerApiBook({
      slot,
      patientData,
      branchId: slot.branchId || DEFAULT_BRANCH_ID
    }, timeoutMs);'''
assert old in s, 'API booking branch block not found'
s = s.replace(old, new, 1)

p.write_text(s)

Path('scripts/check_scheduling_final.mjs').write_text(r'''import fs from "node:fs";
const s = fs.readFileSync("server.js", "utf8");
if (!s.includes("const isSchedulingHandoffReply = Boolean(latestState.booking?.handoffToScheduling)")) throw new Error("handoff send guard missing");
if (!s.includes("branchId: slot.branchId || DEFAULT_BRANCH_ID")) throw new Error("slot branchId not propagated to booking");
if (s.includes("state.booking.awaitingScheduleQuery = true;\n        state.booking.awaitingScheduleQuery = true;")) throw new Error("duplicate schedule query flag remains");
const count = (s.match(/if \(state\.booking\?\.awaitingScheduleQuery\)/g) || []).length;
if (count !== 1) throw new Error(`expected one schedule query interceptor, found ${count}`);
console.log("final scheduling checks ok");
''')
