import fs from "node:fs";
const s = fs.readFileSync("server.js", "utf8");
for (const x of [
  "awaitingScheduleQuery = true",
  "medinet_direct_search_no_slots",
  "santiago_medinet_branch_not_configured",
  "? [2, 3]",
  ": [39]",
  "kind: \"schedule_direct_slots\"",
]) if (!s.includes(x)) throw new Error(`missing ${x}`);
console.log("scheduling query checks ok");
