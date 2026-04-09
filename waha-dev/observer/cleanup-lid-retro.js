// Retroactive cleanup: resolve existing "lid:*" conversations to real phone
// numbers using the WAHA Lids API.
//
// For every agent_direct_conversations row whose client_phone starts with
// "lid:", we ask WAHA's /api/{session}/lids/{digits} endpoint for the real
// phone number of that contact. If WAHA knows it, we either:
//   (A) MERGE this conversation into an existing "+phone" conversation for
//       the same agent — moving messages + metrics, summing counts, then
//       deleting the LID row; or
//   (B) RENAME this conversation in place — updating conversation_key and
//       client_phone, and re-running customer auto-match against
//       customers.whatsapp_phone.
//
// LIDs that WAHA still can't resolve (contact not in the agent's phone
// book) are left untouched — the RUT fallback already handled them or
// they remain unmatched.
//
// Run inside the observer container so it can reach each waha-* host:
//   docker compose exec observer node cleanup-lid-retro.js
//
// Env:
//   CLEANUP_DRY_RUN=true   — log the planned actions without modifying DB
//   CLEANUP_AGENT=<id>     — restrict to a single Zendesk session id

import * as db from "./db.js";
import { refreshAllLidCaches, resolveLid } from "./lid-resolver.js";

const DRY_RUN = String(process.env.CLEANUP_DRY_RUN || "").toLowerCase() === "true";
const TARGET_AGENT = process.env.CLEANUP_AGENT || null;

function normalizePhoneToE164(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("569") && d.length === 11) return `+${d}`;
  if (d.startsWith("9") && d.length === 9) return `+56${d}`;
  if (d.length >= 10 && d.length <= 13) return `+${d}`;
  return null;
}

async function fetchLidConversations() {
  const params = [];
  let where = "client_phone LIKE 'lid:%'";
  if (TARGET_AGENT) {
    params.push(TARGET_AGENT);
    where += ` AND session_name = $${params.length}`;
  }
  const { rows } = await db.pool.query(
    `SELECT id, session_name, client_phone, customer_id, match_status,
            message_count, first_message_at, last_message_at
     FROM agent_direct_conversations
     WHERE ${where}
     ORDER BY id`,
    params
  );
  return rows;
}

async function findPhoneConversation(sessionName, phoneKey) {
  const { rows } = await db.pool.query(
    `SELECT id, customer_id, match_status, message_count,
            first_message_at, last_message_at
     FROM agent_direct_conversations
     WHERE conversation_key = $1`,
    [`${sessionName}:${phoneKey}`]
  );
  return rows[0] || null;
}

async function mergeConversations(sourceId, targetId, targetRow, sourceRow) {
  if (DRY_RUN) {
    console.log(
      `    [dry-run] MERGE conv #${sourceId} → #${targetId} ` +
        `(source msgs=${sourceRow.message_count}, target msgs=${targetRow.message_count})`
    );
    return;
  }

  // All of this runs in a single transaction so the merge is atomic.
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    // Messages: rewire to target. Collisions on waha_message_id are
    // resolved by deleting the source-side duplicate (target wins).
    await client.query(
      `DELETE FROM agent_direct_messages
       WHERE conversation_id = $1
         AND waha_message_id IS NOT NULL
         AND waha_message_id IN (
           SELECT waha_message_id FROM agent_direct_messages
           WHERE conversation_id = $2 AND waha_message_id IS NOT NULL
         )`,
      [sourceId, targetId]
    );
    const msgRes = await client.query(
      `UPDATE agent_direct_messages SET conversation_id = $1
       WHERE conversation_id = $2`,
      [targetId, sourceId]
    );

    // Behavior metrics: just rewire, there is no uniqueness constraint.
    const metricRes = await client.query(
      `UPDATE agent_behavior_metrics SET conversation_id = $1
       WHERE conversation_id = $2`,
      [targetId, sourceId]
    );

    // Recompute message_count and timestamps on the target from the
    // union of both old sets (now all pointing at target).
    await client.query(
      `UPDATE agent_direct_conversations
       SET message_count = (
             SELECT count(*) FROM agent_direct_messages WHERE conversation_id = $1
           ),
           first_message_at = (
             SELECT min(sent_at) FROM agent_direct_messages WHERE conversation_id = $1
           ),
           last_message_at = (
             SELECT max(sent_at) FROM agent_direct_messages WHERE conversation_id = $1
           ),
           updated_at = now()
       WHERE id = $1`,
      [targetId]
    );

    // Drop the now-empty LID row.
    await client.query(
      `DELETE FROM agent_direct_conversations WHERE id = $1`,
      [sourceId]
    );

    await client.query("COMMIT");
    console.log(
      `    MERGED conv #${sourceId} → #${targetId} ` +
        `(moved ${msgRes.rowCount} messages, ${metricRes.rowCount} metrics)`
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function renameConversation(lidRow, newPhone) {
  const newKey = `${lidRow.session_name}:${newPhone}`;
  if (DRY_RUN) {
    console.log(
      `    [dry-run] RENAME conv #${lidRow.id}: ${lidRow.client_phone} → ${newPhone}`
    );
    return;
  }

  // Try to match a customer for the resolved phone. If found, upgrade
  // match_status too.
  const customer = await db.findCustomerByPhone(newPhone);

  await db.pool.query(
    `UPDATE agent_direct_conversations
     SET conversation_key = $1,
         client_phone     = $2,
         customer_id      = COALESCE($3, customer_id),
         match_status     = CASE
                              WHEN $3::bigint IS NOT NULL THEN 'matched'
                              ELSE match_status
                            END,
         updated_at       = now()
     WHERE id = $4`,
    [newKey, newPhone, customer?.id ?? null, lidRow.id]
  );

  console.log(
    `    RENAMED conv #${lidRow.id}: ${lidRow.client_phone} → ${newPhone}` +
      (customer ? ` (matched customer #${customer.id})` : "")
  );
}

async function main() {
  console.log(`[cleanup-lid-retro] Dry run: ${DRY_RUN}`);
  if (TARGET_AGENT) console.log(`[cleanup-lid-retro] Restricted to agent: ${TARGET_AGENT}`);

  console.log("[cleanup-lid-retro] Preloading LID caches from WAHA...");
  await refreshAllLidCaches();

  const lidRows = await fetchLidConversations();
  console.log(`[cleanup-lid-retro] Found ${lidRows.length} lid:* conversations to examine`);

  const stats = {
    total: lidRows.length,
    resolved: 0,
    merged: 0,
    renamed: 0,
    unresolved: 0,
    rejected: 0,
    errors: 0,
  };

  for (const row of lidRows) {
    const lidDigits = row.client_phone.replace(/^lid:/, "");
    console.log(
      `\n→ conv #${row.id} session=${row.session_name} ${row.client_phone} (msgs=${row.message_count})`
    );

    let resolvedDigits;
    try {
      resolvedDigits = await resolveLid(row.session_name, lidDigits);
    } catch (err) {
      console.error(`    resolveLid failed: ${err.message}`);
      stats.errors++;
      continue;
    }

    if (!resolvedDigits) {
      console.log(`    WAHA has no phone for this LID — leaving as-is`);
      stats.unresolved++;
      continue;
    }

    const newPhone = normalizePhoneToE164(resolvedDigits);
    if (!newPhone) {
      console.warn(
        `    LID resolved to "${resolvedDigits}" but failed E.164 normalization`
      );
      stats.rejected++;
      continue;
    }

    stats.resolved++;

    try {
      const target = await findPhoneConversation(row.session_name, newPhone);
      if (target) {
        await mergeConversations(row.id, target.id, target, row);
        stats.merged++;
      } else {
        await renameConversation(row, newPhone);
        stats.renamed++;
      }
    } catch (err) {
      console.error(`    ${err.message}`);
      stats.errors++;
    }
  }

  console.log("\n═══ SUMMARY ═══");
  console.log(`  total examined : ${stats.total}`);
  console.log(`  resolved via API: ${stats.resolved}`);
  console.log(`    merged        : ${stats.merged}`);
  console.log(`    renamed       : ${stats.renamed}`);
  console.log(`  unresolved      : ${stats.unresolved}`);
  console.log(`  rejected (bad #): ${stats.rejected}`);
  console.log(`  errors          : ${stats.errors}`);
  if (DRY_RUN) console.log("\n  (DRY RUN — no DB changes were committed)");

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[cleanup-lid-retro] Fatal:", err);
  process.exit(1);
});
