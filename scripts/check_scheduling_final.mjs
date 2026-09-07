import fs from "node:fs";
const s = fs.readFileSync("server.js", "utf8");
if (!s.includes("const isSchedulingHandoffReply = Boolean(latestState.booking?.handoffToScheduling)")) throw new Error("handoff send guard missing");
if (!s.includes("branchId: slot.branchId || DEFAULT_BRANCH_ID")) throw new Error("slot branchId not propagated to booking");
if (s.includes("state.booking.awaitingScheduleQuery = true;\n        state.booking.awaitingScheduleQuery = true;")) throw new Error("duplicate schedule query flag remains");
const count = (s.match(/if \(state\.booking\?\.awaitingScheduleQuery\)/g) || []).length;
if (count !== 1) throw new Error(`expected one schedule query interceptor, found ${count}`);
console.log("final scheduling checks ok");
