import fs from 'node:fs';

const serverPath = 'server.js';
let s = fs.readFileSync(serverPath, 'utf8');

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let mode = 'normal';
  let escaped = false;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (mode === 'line') { if (c === '\n') mode = 'normal'; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'normal'; i++; } continue; }
    if (mode === 'single') { if (escaped) { escaped = false; continue; } if (c === '\\') { escaped = true; continue; } if (c === "'") mode = 'normal'; continue; }
    if (mode === 'double') { if (escaped) { escaped = false; continue; } if (c === '\\') { escaped = true; continue; } if (c === '"') mode = 'normal'; continue; }
    if (mode === 'template') { if (escaped) { escaped = false; continue; } if (c === '\\') { escaped = true; continue; } if (c === '`') mode = 'normal'; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'single'; continue; }
    if (c === '"') { mode = 'double'; continue; }
    if (c === '`') { mode = 'template'; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error(`Unmatched brace at ${openIndex}`);
}

function locateFunction(text, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(text);
  if (!m) return null;
  const open = text.indexOf('{', m.index);
  if (open < 0) throw new Error(`No opening brace for ${name}`);
  const close = findMatchingBrace(text, open);
  let end = close + 1;
  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
  if (text[end] === '\r') end++;
  if (text[end] === '\n') end++;
  return { start: m.index, end };
}

function removeFunction(name, { required = true } = {}) {
  const loc = locateFunction(s, name);
  if (!loc) { if (required) throw new Error(`Expected function not found: ${name}`); return; }
  s = s.slice(0, loc.start) + s.slice(loc.end);
}

function replaceFunction(name, replacement) {
  const loc = locateFunction(s, name);
  if (!loc) throw new Error(`Expected function not found for replace: ${name}`);
  s = s.slice(0, loc.start) + replacement.trimEnd() + '\n\n' + s.slice(loc.end);
}

function removeBetween(startMarker, endMarker, replacement = '') {
  const start = s.indexOf(startMarker);
  if (start < 0) throw new Error(`Start marker not found: ${startMarker}`);
  const end = s.indexOf(endMarker, start);
  if (end < 0) throw new Error(`End marker not found: ${endMarker}`);
  s = s.slice(0, start) + replacement + s.slice(end);
}

function removeBlockStarting(marker, { required = true } = {}) {
  const start = s.indexOf(marker);
  if (start < 0) { if (required) throw new Error(`Block marker not found: ${marker}`); return; }
  const open = s.indexOf('{', start);
  if (open < 0) throw new Error(`No opening brace for block: ${marker}`);
  const close = findMatchingBrace(s, open);
  let end = close + 1;
  while (end < s.length && (s[end] === ' ' || s[end] === '\t')) end++;
  if (s[end] === ';') end++;
  if (s[end] === '\r') end++;
  if (s[end] === '\n') end++;
  s = s.slice(0, start) + s.slice(end);
}

function removeCallStatements(marker) {
  let count = 0;
  while (true) {
    const idx = s.indexOf(marker);
    if (idx < 0) break;
    const lineStart = s.lastIndexOf('\n', idx) + 1;
    let paren = s.indexOf('(', idx);
    if (paren < 0) throw new Error(`No paren for call ${marker}`);
    let depth = 0, mode = 'normal', escaped = false, end = -1;
    for (let i = paren; i < s.length; i++) {
      const c = s[i], n = s[i + 1];
      if (mode === 'line') { if (c === '\n') mode = 'normal'; continue; }
      if (mode === 'block') { if (c === '*' && n === '/') { mode = 'normal'; i++; } continue; }
      if (mode === 'single') { if (escaped) { escaped = false; continue; } if (c === '\\') { escaped = true; continue; } if (c === "'") mode = 'normal'; continue; }
      if (mode === 'double') { if (escaped) { escaped = false; continue; } if (c === '\\') { escaped = true; continue; } if (c === '"') mode = 'normal'; continue; }
      if (mode === 'template') { if (escaped) { escaped = false; continue; } if (c === '\\') { escaped = true; continue; } if (c === '`') mode = 'normal'; continue; }
      if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
      if (c === "'") { mode = 'single'; continue; }
      if (c === '"') { mode = 'double'; continue; }
      if (c === '`') { mode = 'template'; continue; }
      if (c === '(') depth++;
      if (c === ')') {
        depth--;
        if (depth === 0) {
          let j = i + 1;
          while (j < s.length && /[ \t]/.test(s[j])) j++;
          if (s[j] === ';') j++;
          if (s[j] === '\r') j++;
          if (s[j] === '\n') j++;
          end = j;
          break;
        }
      }
    }
    if (end < 0) throw new Error(`Could not find end of call ${marker}`);
    s = s.slice(0, lineStart) + s.slice(end);
    count++;
  }
  return count;
}

s = s.replace(
  /import \{\n\s*inferBestNextAction,[\s\S]*?onTicketAuditsObserved as onEugeniaTicketAuditsObserved\n\} from "\.\/eugenia\/index\.js";/,
  `import {\n  inferBestNextAction,\n  onHumanAgentMessage as onEugeniaHumanAgentMessage,\n  onMutedPatientMessage as onEugeniaMutedPatientMessage\n} from "./eugenia/index.js";`
);
s = s.replace(/^import zapsRouter from "\.\/ZAPS\/webhooks\/router\.js";\r?\n/m, '');
s = s.replace(/^import \{ startPoller as startZapsPoller \} from "\.\/ZAPS\/poller\.js";\r?\n/m, '');
s = s.replace(/^app\.use\("\/zaps", zapsRouter\);\r?\n/m, '');
s = s.replace(/^\s*startZapsPoller\(\);\r?\n/m, '');

const configNames = [
  'ZENDESK_SUBDOMAIN','SUNCO_APP_ID','SUNCO_KEY_ID','SUNCO_KEY_SECRET',
  'BOX_AI_BASE_URL','ENABLE_SELL_SEARCH','ENABLE_SUPPORT_SEARCH',
  'ZENDESK_SUPPORT_EMAIL','ZENDESK_SUPPORT_TOKEN','LEAD_SCORE_INFO_URL'
];
for (const name of configNames) {
  const re = new RegExp(`^const ${name} = .*?;\\r?\\n`, 'm');
  if (!re.test(s)) throw new Error(`Expected config not found: ${name}`);
  s = s.replace(re, '');
}

const legacyFunctions = [
  'isBlockedSupportUserName','looksLikeMeaningfulSupportText','sanitizeSupportTicketForResolver',
  'filterSupportUsers','extractSupportIdentityHints','filterSupportTickets',
  'normalizeZendeskEntityId','extractZendeskTicketAssignment',
  'searchSellByRut','getZendeskSupportAuthHeader','zendeskSupportGet','zendeskSupportPost',
  'zendeskSupportPut','zendeskSupportGetByUrl','extractConversationIdFromUnknown',
  'fetchZendeskTicketAudits','resolveConversationIdFromZendeskTicket','searchSupportByEmail',
  'searchSupportByPhone','searchSupportByName','searchTicketsForUserIds','searchSupportReal',
  'isSocialMessagingSource','normalizeZendeskContactEmail','buildZendeskContactSyncKey',
  'buildZendeskNotesSyncKey','normalizeZendeskNotes','formatPhoneForZendeskNotes',
  'formatZendeskNotesValue','calculateAgeFromBirthDate','buildZendeskUserNotesFromState',
  'hasConfirmedZendeskSyncData','buildZendeskSyncPayloadFromState','getZendeskUser',
  'listZendeskUserIdentities','createZendeskUserIdentity','updateZendeskUser',
  'syncZendeskUserContactsFromState','safelySyncZendeskUserContactsFromState',
  'updateStateFromSellSearch','maybeRunIdentitySearch','shouldTriggerCaseE','syncLeadScoreToSupport'
];
for (const name of legacyFunctions) removeFunction(name, { required: true });

s = s.replace(/^const lastSyncedLeadScore = new Map\(\);\r?\n/m, '');
s = s.replace(/^\s*await syncLeadScoreToSupport\(state, conversationId\);\r?\n/m, '');
s = s.replace(/^\s*await maybeRunIdentitySearch\(state, info\);\r?\n/m, '');
removeCallStatements('await safelySyncZendeskUserContactsFromState');
removeBlockStarting('if (shouldTriggerCaseE(state)) {', { required: true });

replaceFunction('isRealHumanBusinessTakeover', `function isRealHumanBusinessTakeover(info) {\n  return info?.transport === "chatwoot" && !!info?.isHumanAgent;\n}`);
replaceFunction('extractConversationInfo', `function extractConversationInfo(payload) {\n  if (!isChatwootPayload(payload)) return null;\n  return parseChatwootInbound(payload);\n}`);
replaceFunction('sendConversationReply', `async function sendConversationReply(_appId, conversationId, reply, info = null) {\n  if (info?.transport !== "chatwoot") {\n    throw new Error("Unsupported transport: Chatwoot is the only active conversation channel");\n  }\n  return sendChatwootReply({ conversationId, content: reply });\n}`);

s = s.replace(
  'sourceSystem: isWhatsappChannel ? identity.channelSourceType || "sunco" : "sunco",',
  'sourceSystem: isWhatsappChannel ? identity.channelSourceType || "chatwoot" : "conversation",'
);
s = s.replace(/Aplica igual a WhatsApp por Sunco y por Chatwoot\./g, 'Aplica al canal WhatsApp recibido por Chatwoot.');

removeBetween('app.get("/support-search-test"', 'const handleInboundWebhook =');

s = s.replace('console.log("===== /messages webhook =====");', 'console.log("===== /chatwoot/inbound =====");');
s = s.replace(/^\s*console\.log\("Headers:", safeJson\(req\.headers\)\);\r?\n/m, '');
s = s.replace(/^\s*console\.log\("Body:", safeJson\(req\.body\)\);\r?\n/m, '');
s = s.replace(
  '    const info = extractConversationInfo(req.body);',
  '    const info = extractConversationInfo(req.body);\n    if (!info) {\n      return res.status(400).json({ ok: false, error: "invalid_chatwoot_payload" });\n    }'
);
s = s.replace(
  /\s*console\.log\("Extracted appId:", appId\);[\s\S]*?console\.log\("Extracted sourceType:", sourceType\);/,
  '\n    console.log("[chatwoot] inbound", safeJson({ conversationId, messageId, authorType, sourceType }));'
);
s = s.replace(/^\s*console\.log\("Conversation history:", safeJson\(getHistory\(conversationId\)\)\);\r?\n/m, '');
s = s.replace(/^\s*console\.log\("Conversation state:", safeJson\(state\)\);\r?\n/gm, '');
s = s.replace(/ticketId: state\.identity\?\.zendeskTicketId \|\| null,/g, 'ticketId: null,');
s = s.replace(/^\s*zendeskSupportPut,\r?\n/gm, '');
s = s.replace('console.error("ERROR /messages:", error.message);', 'console.error("ERROR /chatwoot/inbound:", error.message);');

removeBetween(
  '// Sunshine Conversations (camino actual, intacto).',
  'const PORT = process.env.PORT || 10000;',
  `// Chatwoot Cloud is the single active conversational transport.\napp.post("/chatwoot/inbound", requireChatwootBearer, handleInboundWebhook);\nconsole.log("[chatwoot-adapter] mounted POST /chatwoot/inbound");\n\n`
);

const removePaths = [
  'ZENDESK_RESPALDO','ZAPS','scripts/zendesk','scripts/zendesk-backup',
  'scripts/export-audits.cjs','scripts/export-conversation-log.js',
  'scripts/sync-deals.js','scripts/sync-sell-notes.js','scripts/sync-outcomes.js',
  'scripts/import-sell-csv.js','scripts/import-deals.js','scripts/migration',
  'eugenia/zendesk-ticket.js'
];
for (const p of removePaths) if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const key of [
  'zendesk:export:good','zendesk:export:bad','outcomes:sync',
  'zap:update-comisiones','zap:normaliza-rut-contacto','zap:rut-normalizado-trato'
]) delete pkg.scripts?.[key];
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

for (const p of ['README.txt', 'README-modularization.md']) if (fs.existsSync(p)) fs.rmSync(p, { force: true });

for (const forbidden of [
  '.zendesk.com','SUNCO_','ZENDESK_SUBDOMAIN','ENABLE_SELL_SEARCH','ENABLE_SUPPORT_SEARCH',
  'BOX_AI_BASE_URL','zendeskSupportGet','zendeskSupportPut','searchSellByRut','searchSupportReal',
  'app.post("/messages"','/ticket-assigned','/ticket-updated','/support-search-test'
]) {
  if (s.includes(forbidden)) throw new Error(`Forbidden runtime token remains: ${forbidden}`);
}

fs.writeFileSync(serverPath, s);

for (const p of ['scripts/refactor-remove-zendesk.mjs', '.github/workflows/refactor-remove-zendesk.yml']) {
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}

console.log('Zendesk/Sunshine/Sell runtime refactor applied.');
