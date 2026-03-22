#!/usr/bin/env node

import pg from "pg";

import {
  initDb,
  upsertCustomer,
  linkConversationToCustomer,
  addCustomerChannel,
  insertConversationSummary,
  refreshCustomerConversationStats,
  findCustomerByRut,
  findCustomerByWhatsapp
} from "../db.js";
import { normalizePhone, normalizeRut } from "../extraction/identity-normalizers.js";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || null;
const DATABASE_SSL = String(process.env.DATABASE_SSL || "false").toLowerCase() === "true";

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeEmail(value) {
  return cleanText(value)?.toLowerCase() || null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function buildSeedProfile(row) {
  const state = row.state_json || {};
  const contact = state.contactDraft || {};
  const deal = state.dealDraft || {};
  const measurements = state.measurements || {};
  const identity = state.identity || {};

  return {
    rut: normalizeRut(firstNonEmpty(contact.c_rut, row.rut)),
    whatsappPhone: normalizePhone(
      firstNonEmpty(
        row.whatsapp_phone,
        identity.whatsappPhone,
        row.channel_external_id,
        row.telefono,
        contact.c_tel1
      )
    ),
    nombres: cleanText(contact.c_nombres),
    apellidos: cleanText(contact.c_apellidos),
    email: normalizeEmail(firstNonEmpty(contact.c_email, row.email)),
    fechaNacimiento: cleanText(contact.c_fecha),
    aseguradora: cleanText(firstNonEmpty(contact.c_aseguradora, row.prevision)),
    modalidad: cleanText(firstNonEmpty(contact.c_modalidad, row.modalidad)),
    direccion: cleanText(contact.c_direccion),
    comuna: cleanText(firstNonEmpty(contact.c_comuna, row.ciudad)),
    telefonoPrincipal: normalizePhone(firstNonEmpty(contact.c_tel1, row.telefono)),
    ultimoProcedimiento: cleanText(firstNonEmpty(deal.dealInteres, row.procedimiento)),
    peso: firstNonEmpty(measurements.weightKg, deal.dealPeso, row.peso),
    alturaCm: firstNonEmpty(measurements.heightCm, deal.dealEstatura, row.altura_cm),
    imc: firstNonEmpty(measurements.bmi, row.imc),
    categoriaImc: cleanText(firstNonEmpty(measurements.bmiCategory, row.categoria_imc))
  };
}

function inferStageFinal(row) {
  const state = row.state_json || {};
  return cleanText(
    state?.identity?.lastResolvedStage ||
    state?.identity?.lastResolvedContext?.stage ||
    state?.identity?.caseType
  );
}

function inferOutcome(row) {
  const state = row.state_json || {};
  if (state?.system?.handoffReason) return `handoff:${state.system.handoffReason}`;
  if (row.handoff_reason) return `handoff:${row.handoff_reason}`;
  if (row.human_taken_over) return "human_takeover";
  if (Number(row.bot_messages_sent || 0) >= 10) return "max_bot_messages_reached";
  return "seeded_from_history";
}

function buildKeyFacts(row, profile, customerId) {
  const state = row.state_json || {};
  const identity = state.identity || {};

  return {
    customer_id: customerId,
    rut: profile.rut,
    whatsapp_phone: profile.whatsappPhone,
    telefono_principal: profile.telefonoPrincipal,
    email: profile.email,
    nombres: profile.nombres,
    apellidos: profile.apellidos,
    comuna: profile.comuna,
    aseguradora: profile.aseguradora,
    modalidad: profile.modalidad,
    procedimiento: profile.ultimoProcedimiento,
    peso: profile.peso,
    altura_cm: profile.alturaCm,
    imc: profile.imc,
    categoria_imc: profile.categoriaImc,
    handoff_reason: cleanText(state?.system?.handoffReason || row.handoff_reason),
    case_type: cleanText(identity.caseType),
    next_action: cleanText(identity.nextAction)
  };
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error("Missing DATABASE_URL");
  }

  await initDb();

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
    max: Number(process.env.DATABASE_POOL_MAX || 5)
  });

  const counters = {
    processed: 0,
    created: 0,
    updated: 0,
    summaries: 0,
    skipped: 0,
    errors: 0
  };
  const touchedCustomerIds = new Set();

  try {
    const { rows } = await pool.query(`
      select
        c.conversation_id,
        c.channel,
        c.channel_external_id,
        c.channel_display_name,
        c.source_profile_name,
        c.whatsapp_phone,
        c.handoff_reason,
        c.bot_messages_sent,
        c.human_taken_over,
        c.created_at as conversation_created_at,
        c.state_json,
        s.canal,
        s.nombre,
        s.ciudad,
        s.procedimiento,
        s.prevision,
        s.modalidad,
        s.peso,
        s.altura_cm,
        s.imc,
        s.categoria_imc,
        s.telefono,
        s.email,
        s.rut
      from conversations c
      left join structured_leads s on s.conversation_id = c.conversation_id
      where coalesce(
        s.rut,
        c.whatsapp_phone,
        c.channel_external_id,
        s.telefono,
        c.state_json->'contactDraft'->>'c_rut',
        c.state_json->'contactDraft'->>'c_tel1'
      ) is not null
      order by c.created_at asc, c.id asc
    `);

    for (const row of rows) {
      counters.processed += 1;

      try {
        const profile = buildSeedProfile(row);
        if (!profile.rut && !profile.whatsappPhone) {
          counters.skipped += 1;
          continue;
        }

        let existingCustomer = null;
        if (profile.rut) {
          existingCustomer = await findCustomerByRut(profile.rut);
        }
        if (!existingCustomer && profile.whatsappPhone) {
          existingCustomer = await findCustomerByWhatsapp(profile.whatsappPhone);
        }

        const customer = await upsertCustomer(profile, {
          customerId: existingCustomer?.id || null,
          conversationAt: row.conversation_created_at || new Date().toISOString()
        });

        if (!customer) {
          counters.skipped += 1;
          continue;
        }

        if (existingCustomer) counters.updated += 1;
        else counters.created += 1;

        touchedCustomerIds.add(customer.id);

        await linkConversationToCustomer(row.conversation_id, customer.id, {
          channel: row.channel || row.canal || null,
          channelExternalId: row.channel_external_id || null,
          channelDisplayName: row.channel_display_name || null,
          sourceProfileName: row.source_profile_name || null,
          whatsappPhone: profile.whatsappPhone
        });

        if (profile.whatsappPhone || row.channel_external_id) {
          await addCustomerChannel({
            customerId: customer.id,
            channelType: "whatsapp",
            channelValue: profile.whatsappPhone,
            isPrimary: true,
            sourceSystem: row.channel || "sunco",
            externalId: row.channel_external_id || null,
            metadata: {
              conversationId: row.conversation_id,
              channelDisplayName: row.channel_display_name || null,
              sourceProfileName: row.source_profile_name || null
            }
          });
        }

        if (profile.telefonoPrincipal) {
          await addCustomerChannel({
            customerId: customer.id,
            channelType: "phone",
            channelValue: profile.telefonoPrincipal,
            isPrimary: profile.telefonoPrincipal === profile.whatsappPhone,
            sourceSystem: "seed",
            metadata: { conversationId: row.conversation_id }
          });
        }

        if (profile.email) {
          await addCustomerChannel({
            customerId: customer.id,
            channelType: "email",
            channelValue: profile.email,
            sourceSystem: "seed",
            metadata: { conversationId: row.conversation_id }
          });
        }

        const summary = await insertConversationSummary({
          customerId: customer.id,
          conversationId: row.conversation_id,
          canal: row.channel || row.canal || null,
          procedimiento: profile.ultimoProcedimiento,
          stageFinal: inferStageFinal(row),
          outcome: inferOutcome(row),
          keyFacts: buildKeyFacts(row, profile, customer.id)
        });

        if (summary) counters.summaries += 1;
      } catch (error) {
        counters.errors += 1;
        console.error("SEED ROW ERROR:", row.conversation_id, error.message);
      }
    }

    for (const customerId of touchedCustomerIds) {
      await refreshCustomerConversationStats(customerId);
    }

    console.log("CUSTOMER SEED SUMMARY", JSON.stringify({
      ...counters,
      touchedCustomers: touchedCustomerIds.size
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("CUSTOMER SEED FAILED:", error.message);
  process.exitCode = 1;
});
