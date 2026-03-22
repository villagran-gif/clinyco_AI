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

    // Customer memory tables
    await client.query(`
      create table if not exists customers (
        id bigserial primary key,
        rut text unique,
        whatsapp_phone text unique,
        nombres text,
        apellidos text,
        email text,
        tel1 text,
        fecha_nacimiento text,
        aseguradora text,
        modalidad text,
        direccion text,
        comuna text,
        ultimo_procedimiento text,
        peso numeric(6,2),
        altura_cm integer,
        imc numeric(5,2),
        categoria_imc text,
        total_conversaciones integer not null default 0,
        primera_conversacion_at timestamptz,
        ultima_conversacion_at timestamptz,
        notas_contexto jsonb not null default '[]'::jsonb,
        source_data jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create index if not exists idx_customers_whatsapp on customers(whatsapp_phone);
      create index if not exists idx_customers_rut on customers(rut);

      create table if not exists customer_channels (
        id bigserial primary key,
        customer_id bigint not null references customers(id) on delete cascade,
        channel_type text not null,
        channel_value text not null,
        is_primary boolean not null default false,
        verified boolean not null default false,
        source_system text,
        external_id text,
        metadata_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        unique(channel_type, channel_value)
      );

      create index if not exists idx_customer_channels_lookup on customer_channels(channel_type, channel_value);

      create table if not exists customer_conversation_summaries (
        id bigserial primary key,
        customer_id bigint not null references customers(id) on delete cascade,
        conversation_id text not null,
        canal text,
        procedimiento text,
        stage_final text,
        outcome text,
        key_facts jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default now()
      );

      create unique index if not exists idx_ccs_conversation_unique
        on customer_conversation_summaries(conversation_id);
      create index if not exists idx_ccs_customer on customer_conversation_summaries(customer_id);

      -- Add customer_id and channel metadata to conversations if missing
      do $$ begin
        alter table conversations add column if not exists customer_id bigint references customers(id);
      exception when others then null; end $$;
      do $$ begin
        alter table conversations add column if not exists channel_external_id text;
      exception when others then null; end $$;
      do $$ begin
        alter table conversations add column if not exists channel_display_name text;
      exception when others then null; end $$;
      do $$ begin
        alter table conversations add column if not exists source_profile_name text;
      exception when others then null; end $$;
      do $$ begin
        alter table conversations add column if not exists whatsapp_phone text;
      exception when others then null; end $$;

      create index if not exists idx_conversations_customer on conversations(customer_id);
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
  const result = await getPool().query(
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
    returning id
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

  return result.rowCount > 0;
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

// ─── Customer Memory CRUD ───────────────────────────────────────

export async function findCustomerByWhatsapp(whatsappPhone) {
  if (!dbEnabled() || !whatsappPhone) return null;
  const { rows } = await getPool().query(
    `select * from customers where whatsapp_phone = $1 limit 1`,
    [whatsappPhone]
  );
  return rows[0] || null;
}

export async function findCustomerByRut(rut) {
  if (!dbEnabled() || !rut) return null;
  const { rows } = await getPool().query(
    `select * from customers where rut = $1 limit 1`,
    [rut]
  );
  return rows[0] || null;
}

// Email NO es criterio de merge/lookup — solo dato accesorio.

export async function upsertCustomer({
  rut = null, whatsappPhone = null, nombres = null, apellidos = null,
  email = null, tel1 = null, fechaNacimiento = null,
  aseguradora = null, modalidad = null, direccion = null, comuna = null,
  ultimoProcedimiento = null, peso = null, alturaCm = null,
  imc = null, categoriaBmi = null
}) {
  if (!dbEnabled()) return null;

  // Lookup solo por RUT y WhatsApp — email excluido del merge
  let existing = null;
  if (rut) existing = await findCustomerByRut(rut);
  if (!existing && whatsappPhone) existing = await findCustomerByWhatsapp(whatsappPhone);

  if (existing) {
    const { rows } = await getPool().query(
      `update customers set
        rut = coalesce($2, rut),
        whatsapp_phone = coalesce($3, whatsapp_phone),
        nombres = coalesce($4, nombres),
        apellidos = coalesce($5, apellidos),
        email = coalesce($6, email),
        tel1 = coalesce($7, tel1),
        fecha_nacimiento = coalesce($8, fecha_nacimiento),
        aseguradora = coalesce($9, aseguradora),
        modalidad = coalesce($10, modalidad),
        direccion = coalesce($11, direccion),
        comuna = coalesce($12, comuna),
        ultimo_procedimiento = coalesce($13, ultimo_procedimiento),
        peso = coalesce($14, peso),
        altura_cm = coalesce($15, altura_cm),
        imc = coalesce($16, imc),
        categoria_imc = coalesce($17, categoria_imc),
        ultima_conversacion_at = now(),
        updated_at = now()
      where id = $1
      returning *`,
      [
        existing.id, rut, whatsappPhone, nombres, apellidos,
        email, tel1, fechaNacimiento, aseguradora, modalidad,
        direccion, comuna, ultimoProcedimiento, peso, alturaCm,
        imc, categoriaBmi
      ]
    );
    return rows[0];
  }

  const { rows } = await getPool().query(
    `insert into customers (
      rut, whatsapp_phone, nombres, apellidos, email, tel1,
      fecha_nacimiento, aseguradora, modalidad, direccion, comuna,
      ultimo_procedimiento, peso, altura_cm, imc, categoria_imc,
      total_conversaciones, primera_conversacion_at, ultima_conversacion_at
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
      0, now(), now()
    )
    returning *`,
    [
      rut, whatsappPhone, nombres, apellidos, email, tel1,
      fechaNacimiento, aseguradora, modalidad, direccion, comuna,
      ultimoProcedimiento, peso, alturaCm, imc, categoriaBmi
    ]
  );
  return rows[0];
}

export async function linkConversationToCustomer(conversationId, customerId) {
  if (!dbEnabled()) return;
  await getPool().query(
    `update conversations set customer_id = $2, updated_at = now()
     where conversation_id = $1`,
    [conversationId, customerId]
  );
}

export async function addCustomerChannel(customerId, channelType, channelValue, isPrimary = false, sourceSystem = null, metadataJson = null) {
  if (!dbEnabled()) return;
  await getPool().query(
    `insert into customer_channels (customer_id, channel_type, channel_value, is_primary, source_system, metadata_json)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (channel_type, channel_value) do nothing`,
    [customerId, channelType, channelValue, isPrimary, sourceSystem || null, JSON.stringify(metadataJson || {})]
  );
}

export async function insertConversationSummary({ customerId, conversationId, canal, procedimiento, stageFinal, outcome, keyFacts }) {
  if (!dbEnabled() || !customerId) return null;
  const { rows } = await getPool().query(
    `insert into customer_conversation_summaries
       (customer_id, conversation_id, canal, procedimiento, stage_final, outcome, key_facts)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)
     on conflict (conversation_id) do nothing
     returning *`,
    [customerId, conversationId, canal || null, procedimiento || null, stageFinal || null, outcome || null, JSON.stringify(keyFacts || [])]
  );
  return rows[0] || null;
}

export async function getCustomerSummaries(customerId, limit = 5) {
  if (!dbEnabled() || !customerId) return [];
  const { rows } = await getPool().query(
    `select * from customer_conversation_summaries
     where customer_id = $1
     order by created_at desc
     limit $2`,
    [customerId, limit]
  );
  return rows;
}

export async function getCustomerConversationHistory(customerId, limit = 5) {
  if (!dbEnabled() || !customerId) return [];
  const { rows } = await getPool().query(
    `select conversation_id, channel, handoff_reason, bot_messages_sent,
            created_at, updated_at
     from conversations
     where customer_id = $1
     order by updated_at desc
     limit $2`,
    [customerId, limit]
  );
  return rows;
}

export async function recalcTotalConversaciones(customerId) {
  if (!dbEnabled() || !customerId) return;
  await getPool().query(
    `update customers set
       total_conversaciones = (
         select count(*) from customer_conversation_summaries where customer_id = $1
       ),
       updated_at = now()
     where id = $1`,
    [customerId]
  );
}

export async function saveConversationChannelMeta(conversationId, { channelExternalId, channelDisplayName, sourceProfileName, whatsappPhone }) {
  if (!dbEnabled()) return;
  await getPool().query(
    `update conversations set
       channel_external_id = coalesce($2, channel_external_id),
       channel_display_name = coalesce($3, channel_display_name),
       source_profile_name = coalesce($4, source_profile_name),
       whatsapp_phone = coalesce($5, whatsapp_phone),
       updated_at = now()
     where conversation_id = $1`,
    [conversationId, channelExternalId || null, channelDisplayName || null, sourceProfileName || null, whatsappPhone || null]
  );
}
