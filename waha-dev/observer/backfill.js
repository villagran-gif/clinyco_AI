// Historical backfill for WAHA chats → agent_direct_messages
//
// Reads the WAHA chat history for each connected agent and replays each
// message through the same pipeline the live webhooks use
// (customer-matcher → message-store → behavior-tracker), so metrics,
// emoji sentiment, and signals are computed identically.
//
// Run it from inside the observer container (so it can reach the
// WAHA containers by their docker-network hostnames):
//
//   docker compose exec observer node backfill.js
//
// Env vars:
//   BACKFILL_DAYS      — window in days (default 90)
//   BACKFILL_MSG_LIMIT — max messages per chat to request from WAHA (default 50)
//                        NOTE: WAHA Core 2026.3.x's WEBJS engine (whatsapp-web.js)
//                        keeps only ~50 messages per chat in memory. Requests with
//                        limit>=75 consistently fail with the "waitForChatLoading"
//                        bug. So 50 is the practical ceiling for historical fetches.
//   BACKFILL_AGENT     — run only for this Zendesk ID (optional)

import * as db from "./db.js";
import {
  findOrCreateConversation,
  parseClientId,
} from "./customer-matcher.js";
import { save as saveMessage } from "./message-store.js";
import { onMessage as trackBehavior } from "./behavior-tracker.js";
import { refreshAgentPhones, isAgentPhone } from "./agent-phones.js";
import { refreshAllLidCaches } from "./lid-resolver.js";

// Agent registry: Zendesk ID → { name, wahaHost }
// wahaHost is the docker-network hostname of the WAHA container for that agent.
const AGENTS = {
  "39403066594317": { name: "Gabriela Heck",    wahaHost: "waha-gabriela" },
  "29866913338893": { name: "Allison Contreras", wahaHost: "waha-allison"  },
  "30229490880397": { name: "Carolin Cornejo",   wahaHost: "waha-carolin"  },
  "30229583958797": { name: "Camila Alcayaga",   wahaHost: "waha-camila"   },
  "13578942560141": { name: "Giselle Santander", wahaHost: "waha-giselle"  },
};

const SESSION_NAME = "default";
const API_KEY = process.env.WAHA_API_KEY || "";
const DAYS_BACK = parseInt(process.env.BACKFILL_DAYS || "90", 10);
// Capped at 50: WAHA Core 2026.3.x WEBJS engine only keeps ~50 msgs per chat
// in memory; higher limits trigger the whatsapp-web.js waitForChatLoading bug.
const MSG_LIMIT_PER_CHAT = Math.min(parseInt(process.env.BACKFILL_MSG_LIMIT || "50", 10), 50);
const SINCE_MS = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000;

// ── WAHA API helpers ──────────────────────────────────────────────────

async function wahaFetch(host, path, { timeoutMs = 30_000 } = {}) {
  const url = `http://${host}:3000${path}`;
  // whatsapp-web.js sometimes hangs forever on /api/messages when its
  // internal chat state is bad. Without a timeout the entire backfill
  // stalls on that one chat. 30s is generous — healthy responses come
  // back in tens of milliseconds.
  const res = await fetch(url, {
    headers: { "X-Api-Key": API_KEY },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WAHA ${url} → ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getSessionStatus(host) {
  try {
    const sessions = await wahaFetch(host, `/api/sessions`);
    const session = sessions.find?.((s) => s.name === SESSION_NAME);
    return session?.status || null;
  } catch (err) {
    console.error(`  [${host}] session check failed: ${err.message}`);
    return null;
  }
}

async function getChats(host) {
  return wahaFetch(host, `/api/${SESSION_NAME}/chats?limit=500`);
}

async function getMessages(host, chatId) {
  // Use the legacy /api/messages endpoint because the newer
  // /api/{session}/chats/{chatId}/messages endpoint triggers a
  // "waitForChatLoading" bug in whatsapp-web.js on WAHA Core 2026.3.x.
  const qs = new URLSearchParams({
    session: SESSION_NAME,
    chatId,
    limit: String(MSG_LIMIT_PER_CHAT),
    downloadMedia: "false",
  });
  return wahaFetch(host, `/api/messages?${qs}`);
}

// ── Helpers ───────────────────────────────────────────────────────────

function getChatId(chat) {
  if (!chat) return "";
  if (typeof chat.id === "string") return chat.id;
  if (chat.id?._serialized) return chat.id._serialized;
  return "";
}

// Contact label as saved on the agent's phone — e.g. "gabriela 26.507.289-5".
// Used as the pushName for LID chats so we can parse the RUT and match
// against the customers table.
function getChatPushName(chat) {
  if (!chat) return null;
  return (
    chat.name ||
    chat.pushName ||
    chat.lastMessage?.pushName ||
    chat.lastMessage?._data?.notifyName ||
    null
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Backfill one agent ────────────────────────────────────────────────

async function backfillAgent(agentId, { name, wahaHost }) {
  console.log(`\n═══ ${name} (${agentId}) @ ${wahaHost} ═══`);

  // 1. Check that the WAHA session is WORKING
  const status = await getSessionStatus(wahaHost);
  if (status !== "WORKING") {
    console.log(`  ⊘ Session status: ${status || "unknown"} — skipping`);
    return { agent: name, skipped: true, reason: status || "no session" };
  }

  // 2. Make sure the agent has a row in agent_waha_sessions
  await db.ensureSession(agentId, name, null);

  // 3. Fetch chats
  let chats;
  try {
    chats = await getChats(wahaHost);
  } catch (err) {
    console.error(`  ✗ Failed to fetch chats: ${err.message}`);
    return { agent: name, error: err.message };
  }

  if (!Array.isArray(chats)) {
    console.error(`  ✗ Unexpected chats response:`, chats);
    return { agent: name, error: "invalid chats response" };
  }

  // 4. Keep only direct 1:1 chats (@c.us or @lid). Drop groups, broadcasts,
  //    malformed ids, and agent-to-agent chats.
  let skippedInvalid = 0;
  let skippedAgentPeer = 0;
  let countPhone = 0;
  let countLid = 0;
  const privateChats = chats.filter((c) => {
    const id = getChatId(c);
    const parsed = parseClientId(id);
    if (!parsed) {
      skippedInvalid++;
      return false;
    }
    if (parsed.kind === "phone" && isAgentPhone(parsed.value)) {
      skippedAgentPeer++;
      return false;
    }
    if (parsed.kind === "phone") countPhone++;
    else countLid++;
    return true;
  });
  console.log(
    `  Found ${privateChats.length} direct chats of ${chats.length} total ` +
    `(${countPhone} @c.us, ${countLid} @lid; ` +
    `skipped ${skippedInvalid} invalid, ${skippedAgentPeer} agent-peer)`
  );

  let chatsProcessed = 0;
  let totalSaved = 0;
  let totalDeduped = 0;
  let totalSkippedOld = 0;
  let totalErrors = 0;

  for (const chat of privateChats) {
    const chatId = getChatId(chat);
    if (!chatId) continue;

    let messages;
    try {
      messages = await getMessages(wahaHost, chatId);
    } catch (err) {
      console.error(`  chat ${chatId} fetch error: ${err.message}`);
      totalErrors++;
      continue;
    }

    if (!Array.isArray(messages) || messages.length === 0) continue;

    // Filter by time window and sort chronologically (oldest first)
    const recentMessages = messages
      .filter((m) => {
        const ts = (m.timestamp || 0) * 1000;
        if (ts < SINCE_MS) {
          totalSkippedOld++;
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (recentMessages.length === 0) continue;

    // Resolve conversation once per chat. pushName carries the agent's
    // saved label for the contact (e.g. "gabriela 26.507.289-5"), used
    // by the matcher to parse the RUT on LID chats.
    const pushName = getChatPushName(chat);
    const conversation = await findOrCreateConversation(agentId, chatId, { pushName });
    if (!conversation) continue;

    // Insert messages in chronological order
    for (const wahaMsg of recentMessages) {
      const direction = wahaMsg.fromMe ? "agent_to_client" : "client_to_agent";
      try {
        const saved = await saveMessage(conversation, wahaMsg, direction);
        if (saved) {
          totalSaved++;
          await trackBehavior(conversation.id, saved, direction);
        } else {
          totalDeduped++;
        }
      } catch (msgErr) {
        console.error(`    msg error: ${msgErr.message}`);
        totalErrors++;
      }
    }

    chatsProcessed++;
    if (chatsProcessed % 10 === 0 || chatsProcessed === privateChats.length) {
      console.log(
        `  ... ${chatsProcessed}/${privateChats.length} chats  ` +
        `saved=${totalSaved} deduped=${totalDeduped} old=${totalSkippedOld}`
      );
    }

    // Small delay so we don't hammer WAHA
    await sleep(100);
  }

  console.log(
    `  ✓ Done: ${chatsProcessed} chats, ${totalSaved} saved, ` +
    `${totalDeduped} deduped, ${totalSkippedOld} outside window, ${totalErrors} errors`
  );

  return {
    agent: name,
    chatsProcessed,
    saved: totalSaved,
    deduped: totalDeduped,
    skippedOld: totalSkippedOld,
    errors: totalErrors,
  };
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`[backfill] Starting historical backfill`);
  console.log(`[backfill] Window: last ${DAYS_BACK} days (since ${new Date(SINCE_MS).toISOString()})`);
  console.log(`[backfill] Messages per chat limit: ${MSG_LIMIT_PER_CHAT}`);

  if (!API_KEY) {
    console.error("[backfill] WAHA_API_KEY is not set; aborting");
    process.exit(1);
  }

  // Discover agent phones from every WAHA instance so agent-to-agent
  // chats are filtered out as we ingest historical messages.
  console.log("[backfill] Discovering agent phones from WAHA...");
  await refreshAgentPhones();

  // Preload the LID → phone mapping cache from each WAHA instance so the
  // matcher can resolve @lid chats to real numbers during ingestion.
  console.log("[backfill] Preloading WAHA Lids API cache...");
  await refreshAllLidCaches();

  const targetAgentId = process.env.BACKFILL_AGENT || null;
  if (targetAgentId && !AGENTS[targetAgentId]) {
    console.error(`[backfill] Unknown agent ID: ${targetAgentId}`);
    console.error(`[backfill] Known IDs: ${Object.keys(AGENTS).join(", ")}`);
    process.exit(1);
  }

  const agentsToProcess = targetAgentId
    ? { [targetAgentId]: AGENTS[targetAgentId] }
    : AGENTS;

  const results = [];
  for (const [agentId, agent] of Object.entries(agentsToProcess)) {
    try {
      const result = await backfillAgent(agentId, agent);
      results.push(result);
    } catch (err) {
      console.error(`[backfill] ${agent.name} fatal:`, err);
      results.push({ agent: agent.name, fatal: err.message });
    }
  }

  console.log(`\n═══ SUMMARY ═══`);
  for (const r of results) {
    if (r.fatal) {
      console.log(`  ✗ ${r.agent}: FATAL (${r.fatal})`);
    } else if (r.skipped) {
      console.log(`  ⊘ ${r.agent}: skipped (${r.reason})`);
    } else if (r.error) {
      console.log(`  ✗ ${r.agent}: error (${r.error})`);
    } else {
      console.log(
        `  ✓ ${r.agent}: ${r.saved} saved, ${r.deduped} deduped, ` +
        `${r.skippedOld} outside window, ${r.chatsProcessed} chats, ${r.errors} errors`
      );
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});
