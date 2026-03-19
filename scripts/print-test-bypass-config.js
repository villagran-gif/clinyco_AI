const enabled = String(process.env.TEST_BYPASS_ENABLED || "false").toLowerCase() === "true";
const rawIdentifiers = String(process.env.TEST_BYPASS_IDENTIFIERS || "");

const identifiers = rawIdentifiers
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

console.log("Test bypass status");
console.log(`- TEST_BYPASS_ENABLED: ${enabled ? "true" : "false"}`);
console.log(`- TEST_BYPASS_IDENTIFIERS: ${identifiers.length ? identifiers.join(", ") : "(empty)"}`);

if (enabled && identifiers.length) {
  console.log("- Effective mode: active");
} else if (enabled) {
  console.log("- Effective mode: enabled without identifiers");
} else {
  console.log("- Effective mode: inactive");
}
