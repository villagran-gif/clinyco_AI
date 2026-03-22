/**
 * seed-customers-from-leads.js
 *
 * Migra datos historicos de structured_leads + conversations -> customers,
 * customer_channels, customer_conversation_summaries.
 *
 * Idempotente: puede correrse multiples veces sin duplicar ni inflar conteos.
 * Email NO es criterio de lookup/merge — solo dato accesorio.
 *
 * Uso:
 *   DATABASE_URL="postgres://..." node scripts/seed-customers-from-leads.js
 *   DATABASE_URL="postgres://..." DATABASE_SSL=true node scripts/seed-customers-from-leads.js
 */

import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}

const sslConfig = String(process.env.DATABASE_SSL || "false").toLowerCase() === "true"
  ? { rejectUnauthorized: false }
  : undefined;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig,
  max: 3,
});

// --- Identity helpers (inlined to keep script self-contained) ---

function normalizePhone(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("56") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("9") && digits.length === 9) return `+56${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return value.startsWith("+") ? value : `+${digits}`;
  return null;
}

function validateRut(rut) {
  const clean = String(rut || "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (clean.length < 2) return null;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  const numBody = parseInt(body, 10);
  if (isNaN(numBody) || numBody < 1000000) return null;

  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expectedDv = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  if (dv !== expectedDv) return null;
  return `${body}-${dv}`;
}

function splitNames(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { nombres: null, apellidos: null };
  if (parts.length === 1) return { nombres: titleCase(parts[0]), apellidos: null };
  return {
    nombres: titleCase(parts.slice(0, -1).join(" ")),
    apellidos: titleCase(parts.slice(-1)[0]),
  };
}

function titleCase(str) {
  return String(str || "").replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// --- DB helpers ---

async function findCustomer(whatsappPhone, rut) {
  // Lookup solo por RUT y WhatsApp — email excluido del merge
  if (rut) {
    const { rows } = await pool.query("select * from customers where rut = $1 limit 1", [rut]);
    if (rows[0]) return rows[0];
  }
  if (whatsappPhone) {
    const { rows } = await pool.query("select * from customers where whatsapp_phone = $1 limit 1", [whatsappPhone]);
    if (rows[0]) return rows[0];
  }
  return null;
}

async function seedUpsertCustomer(data, conversationCreatedAt) {
  const existing = await findCustomer(data.whatsappPhone, data.rut);

  if (existing) {
    const { rows } = await pool.query(
      `update customers set
        rut = coalesce($2, rut),
        whatsapp_phone = coalesce($3, whatsapp_phone),
        nombres = coalesce($4, nombres),
        apellidos = coalesce($5, apellidos),
        email = coalesce($6, email),
        aseguradora = coalesce($7, aseguradora),
        modalidad = coalesce($8, modalidad),
        comuna = coalesce($9, comuna),
        ultimo_procedimiento = coalesce($10, ultimo_procedimiento),
        peso = coalesce($11, peso),
        altura_cm = coalesce($12, altura_cm),
        imc = coalesce($13, imc),
        categoria_imc = coalesce($14, categoria_imc),
        primera_conversacion_at = least(primera_conversacion_at, $15::timestamptz),
        ultima_conversacion_at = greatest(ultima_conversacion_at, $15::timestamptz),
        updated_at = now()
      where id = $1
      returning *`,
      [
        existing.id, data.rut, data.whatsappPhone, data.nombres, data.apellidos,
        data.email, data.prevision, data.modalidad, data.comuna,
        data.procedimiento, data.peso, data.alturaCm, data.imc, data.categoriaImc,
        conversationCreatedAt,
      ]
    );
    return { customer: rows[0], isNew: false };
  }

  const { rows } = await pool.query(
    `insert into customers (
      rut, whatsapp_phone, nombres, apellidos, email,
      aseguradora, modalidad, comuna,
      ultimo_procedimiento, peso, altura_cm, imc, categoria_imc,
      total_conversaciones, primera_conversacion_at, ultima_conversacion_at
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
      0, $14::timestamptz, $14::timestamptz
    )
    returning *`,
    [
      data.rut, data.whatsappPhone, data.nombres, data.apellidos, data.email,
      data.prevision, data.modalidad, data.comuna,
      data.procedimiento, data.peso, data.alturaCm, data.imc, data.categoriaImc,
      conversationCreatedAt,
    ]
  );
  return { customer: rows[0], isNew: true };
}

async function insertSummary(customerId, conversationId, canal, procedimiento, stageFinal, outcome, keyFacts) {
  const { rowCount } = await pool.query(
    `insert into customer_conversation_summaries
       (customer_id, conversation_id, canal, procedimiento, stage_final, outcome, key_facts)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)
     on conflict (conversation_id) do nothing`,
    [customerId, conversationId, canal || null, procedimiento || null, stageFinal || null, outcome || null, JSON.stringify(keyFacts || [])]
  );
  return rowCount > 0;
}

async function linkConversation(conversationId, customerId) {
  await pool.query(
    "update conversations set customer_id = $2, updated_at = now() where conversation_id = $1",
    [conversationId, customerId]
  );
}

async function addChannel(customerId, channelType, channelValue, isPrimary = false) {
  await pool.query(
    `insert into customer_channels (customer_id, channel_type, channel_value, is_primary)
     values ($1, $2, $3, $4)
     on conflict (channel_type, channel_value) do nothing`,
    [customerId, channelType, channelValue, isPrimary]
  );
}

async function fixTotalConversaciones() {
  await pool.query(
    `update customers c set
       total_conversaciones = (
         select count(*) from customer_conversation_summaries s where s.customer_id = c.id
       ),
       updated_at = now()`
  );
}

// --- Main ---

async function main() {
  console.log("Seed: structured_leads -> customers");
  console.log("  DB:", DATABASE_URL.replace(/:[^@]+@/, ":***@"));
  console.log();

  // Verify tables exist
  const { rows: tables } = await pool.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name in ('customers', 'customer_channels', 'customer_conversation_summaries')
     order by table_name`
  );
  if (tables.length < 3) {
    console.error("Customer tables not found. Deploy the new code first so initDb() creates them.");
    console.error("  Found:", tables.map((t) => t.table_name).join(", ") || "(none)");
    await pool.end();
    process.exit(1);
  }

  // Remove duplicates in summaries before adding unique index (safety for existing local DBs)
  await pool.query(`
    delete from customer_conversation_summaries a
    using customer_conversation_summaries b
    where a.id < b.id and a.conversation_id = b.conversation_id
  `);

  // Load all leads with conversations
  const { rows: leads } = await pool.query(
    `select
       sl.conversation_id,
       sl.nombre, sl.rut, sl.telefono, sl.email,
       sl.ciudad, sl.procedimiento, sl.prevision, sl.modalidad,
       sl.peso, sl.altura_cm, sl.imc, sl.categoria_imc,
       sl.canal as lead_canal,
       sl.estado_lead,
       c.channel as conv_channel,
       c.handoff_reason,
       c.bot_messages_sent,
       c.state_json,
       c.created_at as conv_created_at
     from structured_leads sl
     join conversations c on c.conversation_id = sl.conversation_id
     order by c.created_at asc`
  );

  console.log(`Found ${leads.length} leads to process\n`);

  let created = 0, updated = 0, summariesCreated = 0, summariesSkipped = 0;
  let channelsCreated = 0, linked = 0, skippedNoId = 0, errors = 0;

  for (const lead of leads) {
    try {
      const phone = normalizePhone(lead.telefono);
      const rut = validateRut(lead.rut);
      const email = lead.email ? String(lead.email).trim().toLowerCase() : null;

      if (!phone && !rut) {
        skippedNoId++;
        continue;
      }

      const { nombres, apellidos } = splitNames(lead.nombre);

      const data = {
        rut,
        whatsappPhone: phone,
        nombres,
        apellidos,
        email: email && email.includes("@") ? email : null,
        prevision: lead.prevision || null,
        modalidad: lead.modalidad || null,
        comuna: lead.ciudad || null,
        procedimiento: lead.procedimiento || null,
        peso: lead.peso || null,
        alturaCm: lead.altura_cm || null,
        imc: lead.imc || null,
        categoriaImc: lead.categoria_imc || null,
      };

      const { customer, isNew } = await seedUpsertCustomer(data, lead.conv_created_at);
      if (isNew) created++;
      else updated++;

      await linkConversation(lead.conversation_id, customer.id);
      linked++;

      if (phone) {
        await addChannel(customer.id, "whatsapp", phone, true);
        channelsCreated++;
      }

      if (data.email) {
        await addChannel(customer.id, "email", data.email, false);
      }

      // Create conversation summary (idempotent via ON CONFLICT DO NOTHING)
      const state = lead.state_json || {};
      const keyFacts = [];
      if (lead.handoff_reason) keyFacts.push(`Derivacion: ${lead.handoff_reason}`);
      if (state.stage) keyFacts.push(`Stage: ${state.stage}`);

      const canal = lead.lead_canal || lead.conv_channel || null;
      const stageFinal = state.stage || lead.estado_lead || null;
      const outcome = lead.handoff_reason ? "handoff" : (lead.estado_lead === "completado" ? "completed" : null);

      const inserted = await insertSummary(
        customer.id,
        lead.conversation_id,
        canal,
        lead.procedimiento || null,
        stageFinal,
        outcome,
        keyFacts
      );
      if (inserted) summariesCreated++;
      else summariesSkipped++;

    } catch (err) {
      errors++;
      console.error(`  Error processing lead ${lead.conversation_id}:`, err.message);
    }
  }

  // Fix total_conversaciones based on actual summary count
  console.log("\nFixing total_conversaciones counts...");
  await fixTotalConversaciones();

  console.log("\nSeed complete!");
  console.log(`  Customers created:    ${created}`);
  console.log(`  Customers updated:    ${updated}`);
  console.log(`  Conversations linked: ${linked}`);
  console.log(`  Summaries created:    ${summariesCreated}`);
  console.log(`  Summaries skipped:    ${summariesSkipped} (already existed)`);
  console.log(`  Channels registered:  ${channelsCreated}`);
  console.log(`  Skipped (no ID):      ${skippedNoId}`);
  console.log(`  Errors:               ${errors}`);

  // Verification queries
  console.log("\nVerification:");
  const { rows: [{ count: customerCount }] } = await pool.query("select count(*) from customers");
  const { rows: [{ count: summaryCount }] } = await pool.query("select count(*) from customer_conversation_summaries");
  const { rows: dupes } = await pool.query(
    `select whatsapp_phone, count(*) as n from customers
     where whatsapp_phone is not null
     group by whatsapp_phone having count(*) > 1`
  );
  console.log(`  Total customers:    ${customerCount}`);
  console.log(`  Total summaries:    ${summaryCount}`);
  console.log(`  Duplicate phones:   ${dupes.length} (should be 0)`);

  if (dupes.length > 0) {
    console.warn("  Duplicate phones found:");
    for (const d of dupes) console.warn(`    ${d.whatsapp_phone}: ${d.n} records`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  pool.end().finally(() => process.exit(1));
});
