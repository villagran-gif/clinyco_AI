import fs from "node:fs";
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
