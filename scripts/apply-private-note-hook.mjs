import { readFileSync, writeFileSync } from "node:fs";

const path = "server.js";
let source = readFileSync(path, "utf8");

const importLine = 'import { sendChatwootReply, sendChatwootAttachment } from "./chatwoot-adapter/client.js";';
const newImport = 'import { maybeSyncPrivateLeadNote } from "./chatwoot-adapter/private-lead-note.js";';
if (!source.includes(newImport)) {
  if (!source.includes(importLine)) throw new Error("private-note patch: import anchor not found");
  source = source.replace(importLine, `${importLine}\n${newImport}`);
}

const anchor = `    state.leadScore = calculateLeadScore(state);\n    await upsertConversationState(conversationId, channel, state);`;
const replacement = `    state.leadScore = calculateLeadScore(state);\n    // Best-effort: maintain one private agent card with the facts Antonia already knows.\n    // This must never block persistence or a patient reply if Chatwoot notes are unavailable.\n    await maybeSyncPrivateLeadNote({ conversationId, channel, state });\n    await upsertConversationState(conversationId, channel, state);`;
if (!source.includes("await maybeSyncPrivateLeadNote({ conversationId, channel, state });")) {
  if (!source.includes(anchor)) throw new Error("private-note patch: persistence anchor not found");
  source = source.replace(anchor, replacement);
}

writeFileSync(path, source, "utf8");
console.log("private-note hook applied");
