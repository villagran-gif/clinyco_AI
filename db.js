import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || null;
const DATABASE_SSL = String(process.env.DATABASE_SSL || "false").toLowerCase() === "true";

let pool = null;

export function dbEnabled() {
  return Boolean(DATABASE_URL);
}

function getPool() {
  if (!dbEnabled()) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
      max: Number(process.env.DATABASE_POOL_MAX || 5)
    });
  }

  return pool;
}

export async function initDb() {
  if (!dbEnabled()) {
    console.log("Database persistence disabled: DATABASE_URL not configured");
    return;
  }

  const client = await getPool().connect();
  try {
    await client.query(`
      create table if not exists conversations (
        id bigserial primary key,
        conversation_id text not null unique,
        channel text,
        ai_enabled boolean not null default true,
        human_taken_over boolean not null default false,
        assignee_id text,
        bot_messages_sent integer not null default 0,
        introduced_as_antonia boolean not null default false,
        handoff_reason text,
        state_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists conversation_messages (
        id bigserial primary key,
        conversation_id text not null references conversations(conversation_id) on delete cascade,
        role text not null,
        message_id text,
        channel text,
        source_type text,
        content text not null,
        raw_json jsonb,
        created_at timestamptz not null default now()
      );

      create table if not exists structured_leads (
        id bigserial primary key,
        conversation_id text not null unique references conversations(conversation_id) on delete cascade,
        canal text,
        nombre text,
        ciudad text,
        procedimiento text,
        prevision text,
        modalidad text,
        peso numeric(6,2),
        altura_m numeric(4,2),
        altura_cm integer,
        imc numeric(5,2),
        categoria_imc text,
        telefono text,
        email text,
        rut text,
        estado_lead text not null default 'en_proceso',
        score integer not null default 0,
        source_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create unique index if not exists conversation_messages_unique_message
      on conversation_messages (conversation_id, message_id, role);

      create index if not exists conversation_messages_conversation_created_idx
      on conversation_messages (conversation_id, created_at desc);
    `);
    console.log("Database ready");
  } finally {
    client.release();
  }
}

export async function getConversationRecord(conversationId) {
  const { rows } = await getPool().query(
    `select * from conversations where conversation_id = $1 limit 1`,
    [conversationId]
  );
  return rows[0] || null;
}

export async function getRecentConversationMessages(conversationId, limit = 14) {
  const { rows } = await getPool().query(
    `
    select role, content, created_at
    from conversation_messages
    where conversation_id = $1
    order by created_at desc, id desc
    limit $2
    `,
    [conversationId, limit]
  );
  return rows.reverse();
}

export async function upsertConversationState(conversationId, channel, state) {
  const system = state?.system || {};

  const { rows } = await getPool().query(
    `
    insert into conversations (
      conversation_id,
      channel,
      ai_enabled,
      human_taken_over,
      assignee_id,
      bot_messages_sent,
      introduced_as_antonia,
      handoff_reason,
      state_json
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    on conflict (conversation_id)
    do update set
      channel = excluded.channel,
      ai_enabled = excluded.ai_enabled,
      human_taken_over = excluded.human_taken_over,
      assignee_id = excluded.assignee_id,
      bot_messages_sent = excluded.bot_messages_sent,
      introduced_as_antonia = excluded.introduced_as_antonia,
      handoff_reason = excluded.handoff_reason,
      state_json = excluded.state_json,
      updated_at = now()
    returning *
    `,
    [
      conversationId,
      channel || null,
      Boolean(system.aiEnabled),
      Boolean(system.humanTakenOver),
      system.assigneeId || null,
      Number(system.botMessagesSent || 0),
      Boolean(system.introducedAsAntonia),
      system.handoffReason || null,
      JSON.stringify(state || {})
    ]
  );

  return rows[0] || null;
}

export async function insertConversationMessage({ conversationId, role, messageId = null, channel = null, sourceType = null, content = "", rawJson = null }) {
  await getPool().query(
    `
    insert into conversation_messages (
      conversation_id,
      role,
      message_id,
      channel,
      source_type,
      content,
      raw_json
    )
    values ($1, $2, $3, $4, $5, $6, $7::jsonb)
    on conflict (conversation_id, message_id, role)
    do nothing
    `,
    [
      conversationId,
      role,
      messageId,
      channel,
      sourceType,
      content,
      JSON.stringify(rawJson || {})
    ]
  );
}

export async function upsertStructuredLead(conversationId, channel, state) {
  const fullName = [state?.contactDraft?.c_nombres, state?.contactDraft?.c_apellidos]
    .filter(Boolean)
    .join(" ") || null;

  const weight = state?.measurements?.weightKg ?? state?.dealDraft?.dealPeso ?? null;
  const heightM = state?.measurements?.heightM ?? null;
  const heightCm = state?.measurements?.heightCm ?? state?.dealDraft?.dealEstatura ?? null;
  const bmi = state?.measurements?.bmi ?? null;
  const bmiCategory = state?.measurements?.bmiCategory ?? null;

  await getPool().query(
    `
    insert into structured_leads (
      conversation_id,
      canal,
      nombre,
      ciudad,
      procedimiento,
      prevision,
      modalidad,
      peso,
      altura_m,
      altura_cm,
      imc,
      categoria_imc,
      telefono,
      email,
      rut,
      source_json
    )
    values (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb
    )
    on conflict (conversation_id)
    do update set
      canal = excluded.canal,
      nombre = excluded.nombre,
      ciudad = excluded.ciudad,
      procedimiento = excluded.procedimiento,
      prevision = excluded.prevision,
      modalidad = excluded.modalidad,
      peso = excluded.peso,
      altura_m = excluded.altura_m,
      altura_cm = excluded.altura_cm,
      imc = excluded.imc,
      categoria_imc = excluded.categoria_imc,
      telefono = excluded.telefono,
      email = excluded.email,
      rut = excluded.rut,
      source_json = excluded.source_json,
      updated_at = now()
    `,
    [
      conversationId,
      channel || null,
      fullName,
      state?.contactDraft?.c_comuna || null,
      state?.dealDraft?.dealInteres || null,
      state?.contactDraft?.c_aseguradora || null,
      state?.contactDraft?.c_modalidad || null,
      weight,
      heightM,
      heightCm,
      bmi,
      bmiCategory,
      state?.contactDraft?.c_tel1 || null,
      state?.contactDraft?.c_email || null,
      state?.contactDraft?.c_rut || null,
      JSON.stringify({
        contactDraft: state?.contactDraft || {},
        dealDraft: state?.dealDraft || {},
        identity: state?.identity || {},
        system: state?.system || {}
      })
    ]
  );
}
