import pg from "pg";

import { normalizePhone, normalizeRut } from "./extraction/identity-normalizers.js";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || null;
const DATABASE_SSL = String(process.env.DATABASE_SSL || "false").toLowerCase() === "true";

let pool = null;

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeOptionalEmail(value) {
  const email = cleanText(value)?.toLowerCase() || null;
  return email;
}

function normalizeOptionalDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function buildCustomerProfile(state = {}) {
  const contact = state?.contactDraft || {};
  const deal = state?.dealDraft || {};
  const measurements = state?.measurements || {};
  const identity = state?.identity || {};
  const whatsappPhone = normalizePhone(identity.whatsappPhone);
  const normalizedRut = normalizeRut(contact.c_rut);
  const canPersistRut = Boolean(
    identity.verifiedRutAt ||
    identity.verifiedPairAt ||
    identity.safeToUseHistoricalContext
  );

  return {
    rut: canPersistRut ? normalizedRut : null,
    whatsappPhone,
    nombres: cleanText(contact.c_nombres),
    apellidos: cleanText(contact.c_apellidos),
    email: normalizeOptionalEmail(contact.c_email),
    fechaNacimiento: normalizeOptionalDate(contact.c_fecha),
    aseguradora: cleanText(contact.c_aseguradora),
    modalidad: cleanText(contact.c_modalidad),
    direccion: cleanText(contact.c_direccion),
    comuna: cleanText(contact.c_comuna),
    telefonoPrincipal: normalizePhone(firstNonEmpty(contact.c_tel1, whatsappPhone)),
    ultimoProcedimiento: cleanText(deal.dealInteres),
    peso: measurements.weightKg ?? deal.dealPeso ?? null,
    alturaCm: measurements.heightCm ?? deal.dealEstatura ?? null,
    imc: measurements.bmi ?? null,
    categoriaImc: cleanText(measurements.bmiCategory),
    channelExternalId: cleanText(identity.channelExternalId),
    channelDisplayName: cleanText(identity.channelDisplayName),
    sourceProfileName: cleanText(identity.sourceProfileName),
    channelSourceType: cleanText(identity.channelSourceType)
  };
}

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

async function queryOne(text, params = []) {
  const { rows } = await getPool().query(text, params);
  return rows[0] || null;
}

export async function initDb() {
  if (!dbEnabled()) {
    console.log("Database persistence disabled: DATABASE_URL not configured");
    return;
  }

  const client = await getPool().connect();
  try {
    await client.query(`
      create table if not exists customers (
        id bigserial primary key,
        rut text,
        whatsapp_phone text,
        nombres text,
        apellidos text,
        email text,
        fecha_nacimiento date,
        aseguradora text,
        modalidad text,
        direccion text,
        comuna text,
        telefono_principal text,
        ultimo_procedimiento text,
        peso numeric(6,2),
        altura_cm integer,
        imc numeric(5,2),
        categoria_imc text,
        total_conversaciones integer not null default 0,
        primera_conversacion_at timestamptz,
        ultima_conversacion_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists customer_channels (
        id bigserial primary key,
        customer_id bigint not null references customers(id) on delete cascade,
        channel_type text not null,
        channel_value text,
        is_primary boolean not null default false,
        verified boolean not null default false,
        source_system text,
        external_id text,
        metadata_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists conversations (
        id bigserial primary key,
        conversation_id text not null unique,
        customer_id bigint references customers(id) on delete set null,
        channel text,
        channel_external_id text,
        channel_display_name text,
        source_profile_name text,
        whatsapp_phone text,
        ai_enabled boolean not null default true,
        human_taken_over boolean not null default false,
        assignee_id text,
        zendesk_ticket_id text,
        zendesk_requester_id text,
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

      create table if not exists customer_conversation_summaries (
        id bigserial primary key,
        customer_id bigint not null references customers(id) on delete cascade,
        conversation_id text not null references conversations(conversation_id) on delete cascade,
        canal text,
        procedimiento text,
        stage_final text,
        outcome text,
        key_facts jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
    `);

    await client.query(`
      alter table conversations add column if not exists customer_id bigint references customers(id) on delete set null;
      alter table conversations add column if not exists channel_external_id text;
      alter table conversations add column if not exists channel_display_name text;
      alter table conversations add column if not exists source_profile_name text;
      alter table conversations add column if not exists whatsapp_phone text;
      alter table conversations add column if not exists zendesk_ticket_id text;
      alter table conversations add column if not exists zendesk_requester_id text;

      alter table customers add column if not exists rut text;
      alter table customers add column if not exists whatsapp_phone text;
      alter table customers add column if not exists nombres text;
      alter table customers add column if not exists apellidos text;
      alter table customers add column if not exists email text;
      alter table customers add column if not exists fecha_nacimiento date;
      alter table customers add column if not exists aseguradora text;
      alter table customers add column if not exists modalidad text;
      alter table customers add column if not exists direccion text;
      alter table customers add column if not exists comuna text;
      alter table customers add column if not exists telefono_principal text;
      alter table customers add column if not exists ultimo_procedimiento text;
      alter table customers add column if not exists peso numeric(6,2);
      alter table customers add column if not exists altura_cm integer;
      alter table customers add column if not exists imc numeric(5,2);
      alter table customers add column if not exists categoria_imc text;
      alter table customers add column if not exists total_conversaciones integer not null default 0;
      alter table customers add column if not exists primera_conversacion_at timestamptz;
      alter table customers add column if not exists ultima_conversacion_at timestamptz;

      alter table customer_channels add column if not exists is_primary boolean not null default false;
      alter table customer_channels add column if not exists verified boolean not null default false;
      alter table customer_channels add column if not exists source_system text;
      alter table customer_channels add column if not exists external_id text;
      alter table customer_channels add column if not exists metadata_json jsonb not null default '{}'::jsonb;

      alter table customer_conversation_summaries add column if not exists canal text;
      alter table customer_conversation_summaries add column if not exists procedimiento text;
      alter table customer_conversation_summaries add column if not exists stage_final text;
      alter table customer_conversation_summaries add column if not exists outcome text;
      alter table customer_conversation_summaries add column if not exists key_facts jsonb not null default '{}'::jsonb;
    `);

    await client.query(`
      delete from customer_conversation_summaries a
      using customer_conversation_summaries b
      where a.conversation_id = b.conversation_id
        and a.id < b.id;
    `);

    await client.query(`
      create unique index if not exists conversation_messages_unique_message
      on conversation_messages (conversation_id, message_id, role)
      where message_id is not null;

      create index if not exists conversation_messages_conversation_created_idx
      on conversation_messages (conversation_id, created_at desc);

      create unique index if not exists customers_rut_unique_idx
      on customers (rut)
      where rut is not null;

      create unique index if not exists customers_whatsapp_phone_unique_idx
      on customers (whatsapp_phone)
      where whatsapp_phone is not null;

      create unique index if not exists customer_channels_value_unique_idx
      on customer_channels (channel_type, channel_value)
      where channel_value is not null;

      create unique index if not exists customer_channels_external_unique_idx
      on customer_channels (source_system, external_id)
      where source_system is not null and external_id is not null;

      create index if not exists conversations_customer_id_idx
      on conversations (customer_id);

      create index if not exists customer_conversation_summaries_customer_id_idx
      on customer_conversation_summaries (customer_id, created_at desc);

      create unique index if not exists customer_conversation_summaries_conversation_unique_idx
      on customer_conversation_summaries (conversation_id);
    `);

    console.log("Database ready");
  } finally {
    client.release();
  }
}

export async function getConversationRecord(conversationId) {
  return queryOne(
    `select * from conversations where conversation_id = $1 limit 1`,
    [conversationId]
  );
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
  const identity = state?.identity || {};
  const customerProfile = buildCustomerProfile(state);

  const { rows } = await getPool().query(
    `
    insert into conversations (
      conversation_id,
      customer_id,
      channel,
      channel_external_id,
      channel_display_name,
      source_profile_name,
      whatsapp_phone,
      ai_enabled,
      human_taken_over,
      assignee_id,
      zendesk_ticket_id,
      zendesk_requester_id,
      bot_messages_sent,
      introduced_as_antonia,
      handoff_reason,
      state_json
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
    on conflict (conversation_id)
    do update set
      customer_id = excluded.customer_id,
      channel = excluded.channel,
      channel_external_id = excluded.channel_external_id,
      channel_display_name = excluded.channel_display_name,
      source_profile_name = excluded.source_profile_name,
      whatsapp_phone = excluded.whatsapp_phone,
      ai_enabled = excluded.ai_enabled,
      human_taken_over = excluded.human_taken_over,
      assignee_id = excluded.assignee_id,
      zendesk_ticket_id = excluded.zendesk_ticket_id,
      zendesk_requester_id = excluded.zendesk_requester_id,
      bot_messages_sent = excluded.bot_messages_sent,
      introduced_as_antonia = excluded.introduced_as_antonia,
      handoff_reason = excluded.handoff_reason,
      state_json = excluded.state_json,
      updated_at = now()
    returning *
    `,
    [
      conversationId,
      identity.customerId || null,
      channel || null,
      identity.channelExternalId || null,
      identity.channelDisplayName || null,
      identity.sourceProfileName || null,
      customerProfile.whatsappPhone,
      Boolean(system.aiEnabled),
      Boolean(system.humanTakenOver),
      system.assigneeId || null,
      identity.zendeskTicketId || null,
      identity.zendeskRequesterId || null,
      Number(system.botMessagesSent || 0),
      Boolean(system.introducedAsAntonia),
      system.handoffReason || null,
      JSON.stringify(state || {})
    ]
  );

  return rows[0] || null;
}

export async function insertConversationMessage({
  conversationId,
  role,
  messageId = null,
  channel = null,
  sourceType = null,
  content = "",
  rawJson = null
}) {
  if (messageId) {
    const existing = await getPool().query(
      `
      select id
      from conversation_messages
      where conversation_id = $1
        and message_id = $2
        and role = $3
      limit 1
      `,
      [conversationId, messageId, role]
    );

    if (existing.rowCount > 0) {
      return false;
    }
  }

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
      normalizePhone(state?.contactDraft?.c_tel1) || null,
      normalizeOptionalEmail(state?.contactDraft?.c_email),
      normalizeRut(state?.contactDraft?.c_rut),
      JSON.stringify({
        contactDraft: state?.contactDraft || {},
        dealDraft: state?.dealDraft || {},
        identity: state?.identity || {},
        system: state?.system || {}
      })
    ]
  );
}

export async function getCustomerById(customerId) {
  if (!customerId) return null;
  return queryOne(`select * from customers where id = $1 limit 1`, [customerId]);
}

export async function findCustomerByRut(rut) {
  const normalized = normalizeRut(rut);
  if (!normalized) return null;
  return queryOne(`select * from customers where rut = $1 limit 1`, [normalized]);
}

export async function findCustomerByWhatsapp(whatsappPhone) {
  const normalized = normalizePhone(whatsappPhone);
  if (!normalized) return null;
  return queryOne(`select * from customers where whatsapp_phone = $1 limit 1`, [normalized]);
}

async function updateExistingCustomer(customerId, profile, conversationAt = null) {
  const { rows } = await getPool().query(
    `
    update customers
    set
      rut = coalesce(customers.rut, $2),
      whatsapp_phone = coalesce(customers.whatsapp_phone, $3),
      nombres = coalesce(customers.nombres, $4),
      apellidos = coalesce(customers.apellidos, $5),
      email = coalesce(customers.email, $6),
      fecha_nacimiento = coalesce(customers.fecha_nacimiento, $7::date),
      aseguradora = coalesce(customers.aseguradora, $8),
      modalidad = coalesce(customers.modalidad, $9),
      direccion = coalesce(customers.direccion, $10),
      comuna = coalesce(customers.comuna, $11),
      telefono_principal = coalesce(customers.telefono_principal, $12),
      ultimo_procedimiento = coalesce($13, customers.ultimo_procedimiento),
      peso = coalesce($14, customers.peso),
      altura_cm = coalesce($15, customers.altura_cm),
      imc = coalesce($16, customers.imc),
      categoria_imc = coalesce($17, customers.categoria_imc),
      primera_conversacion_at = case
        when $18::timestamptz is null then customers.primera_conversacion_at
        when customers.primera_conversacion_at is null then $18::timestamptz
        else least(customers.primera_conversacion_at, $18::timestamptz)
      end,
      ultima_conversacion_at = case
        when $18::timestamptz is null then customers.ultima_conversacion_at
        when customers.ultima_conversacion_at is null then $18::timestamptz
        else greatest(customers.ultima_conversacion_at, $18::timestamptz)
      end,
      updated_at = now()
    where id = $1
    returning *
    `,
    [
      customerId,
      profile.rut,
      profile.whatsappPhone,
      profile.nombres,
      profile.apellidos,
      profile.email,
      profile.fechaNacimiento,
      profile.aseguradora,
      profile.modalidad,
      profile.direccion,
      profile.comuna,
      profile.telefonoPrincipal,
      profile.ultimoProcedimiento,
      profile.peso,
      profile.alturaCm,
      profile.imc,
      profile.categoriaImc,
      conversationAt
    ]
  );

  return rows[0] || null;
}

async function insertNewCustomer(profile, conversationAt = null) {
  const { rows } = await getPool().query(
    `
    insert into customers (
      rut,
      whatsapp_phone,
      nombres,
      apellidos,
      email,
      fecha_nacimiento,
      aseguradora,
      modalidad,
      direccion,
      comuna,
      telefono_principal,
      ultimo_procedimiento,
      peso,
      altura_cm,
      imc,
      categoria_imc,
      total_conversaciones,
      primera_conversacion_at,
      ultima_conversacion_at
    )
    values (
      $1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 0,
      coalesce($17::timestamptz, now()),
      coalesce($17::timestamptz, now())
    )
    returning *
    `,
    [
      profile.rut,
      profile.whatsappPhone,
      profile.nombres,
      profile.apellidos,
      profile.email,
      profile.fechaNacimiento,
      profile.aseguradora,
      profile.modalidad,
      profile.direccion,
      profile.comuna,
      profile.telefonoPrincipal,
      profile.ultimoProcedimiento,
      profile.peso,
      profile.alturaCm,
      profile.imc,
      profile.categoriaImc,
      conversationAt
    ]
  );

  return rows[0] || null;
}

export async function upsertCustomer(profileInput = {}, options = {}) {
  const profile = {
    rut: normalizeRut(profileInput.rut),
    whatsappPhone: normalizePhone(profileInput.whatsappPhone),
    nombres: cleanText(profileInput.nombres),
    apellidos: cleanText(profileInput.apellidos),
    email: normalizeOptionalEmail(profileInput.email),
    fechaNacimiento: normalizeOptionalDate(profileInput.fechaNacimiento),
    aseguradora: cleanText(profileInput.aseguradora),
    modalidad: cleanText(profileInput.modalidad),
    direccion: cleanText(profileInput.direccion),
    comuna: cleanText(profileInput.comuna),
    telefonoPrincipal: normalizePhone(profileInput.telefonoPrincipal),
    ultimoProcedimiento: cleanText(profileInput.ultimoProcedimiento),
    peso: profileInput.peso ?? null,
    alturaCm: profileInput.alturaCm ?? null,
    imc: profileInput.imc ?? null,
    categoriaImc: cleanText(profileInput.categoriaImc)
  };

  const customerId = options.customerId || null;
  const conversationAt = options.conversationAt || null;

  if (!customerId && !profile.rut && !profile.whatsappPhone) {
    return null;
  }

  let existingCustomer = null;
  if (customerId) {
    existingCustomer = await getCustomerById(customerId);
  }
  if (!existingCustomer && profile.rut) {
    existingCustomer = await findCustomerByRut(profile.rut);
  }
  if (!existingCustomer && profile.whatsappPhone) {
    existingCustomer = await findCustomerByWhatsapp(profile.whatsappPhone);
  }

  if (existingCustomer) {
    return updateExistingCustomer(existingCustomer.id, profile, conversationAt);
  }

  return insertNewCustomer(profile, conversationAt);
}

export async function linkConversationToCustomer(
  conversationId,
  customerId,
  options = {}
) {
  const whatsappPhone = normalizePhone(options.whatsappPhone) || null;

  const { rows } = await getPool().query(
    `
    insert into conversations (
      conversation_id,
      customer_id,
      channel,
      channel_external_id,
      channel_display_name,
      source_profile_name,
      whatsapp_phone
    )
    values ($1, $2, $3, $4, $5, $6, $7)
    on conflict (conversation_id)
    do update set
      customer_id = excluded.customer_id,
      channel = coalesce(excluded.channel, conversations.channel),
      channel_external_id = coalesce(excluded.channel_external_id, conversations.channel_external_id),
      channel_display_name = coalesce(excluded.channel_display_name, conversations.channel_display_name),
      source_profile_name = coalesce(excluded.source_profile_name, conversations.source_profile_name),
      whatsapp_phone = coalesce(excluded.whatsapp_phone, conversations.whatsapp_phone),
      updated_at = now()
    returning *
    `,
    [
      conversationId,
      customerId,
      options.channel || null,
      options.channelExternalId || null,
      options.channelDisplayName || null,
      options.sourceProfileName || null,
      whatsappPhone
    ]
  );

  return rows[0] || null;
}

export async function addCustomerChannel({
  customerId,
  channelType,
  channelValue = null,
  isPrimary = false,
  verified = false,
  sourceSystem = null,
  externalId = null,
  metadata = {}
}) {
  if (!customerId || !channelType) return null;

  const normalizedValue = channelType === "whatsapp" || channelType === "phone"
    ? normalizePhone(channelValue)
    : channelType === "email"
      ? normalizeOptionalEmail(channelValue)
      : cleanText(channelValue);

  if (!normalizedValue && !externalId) return null;

  const existing = await getPool().query(
    `
    select *
    from customer_channels
    where (
      $1::text is not null
      and channel_type = $2
      and channel_value = $1
    ) or (
      $3::text is not null
      and $4::text is not null
      and source_system = $3
      and external_id = $4
    )
    order by
      case
        when $1::text is not null and channel_type = $2 and channel_value = $1 then 0
        else 1
      end,
      id asc
    limit 1
    `,
    [
      normalizedValue || null,
      channelType,
      sourceSystem || null,
      externalId || null
    ]
  );

  if (existing.rowCount > 0) {
    const { rows } = await getPool().query(
      `
      update customer_channels
      set
        customer_id = $2,
        channel_type = $3,
        channel_value = coalesce($4, channel_value),
        is_primary = is_primary or $5,
        verified = verified or $6,
        source_system = coalesce($7, source_system),
        external_id = coalesce($8, external_id),
        metadata_json = metadata_json || $9::jsonb,
        updated_at = now()
      where id = $1
      returning *
      `,
      [
        existing.rows[0].id,
        customerId,
        channelType,
        normalizedValue || null,
        Boolean(isPrimary),
        Boolean(verified),
        sourceSystem || null,
        externalId || null,
        JSON.stringify(metadata || {})
      ]
    );

    return rows[0] || null;
  }

  const { rows } = await getPool().query(
    `
    insert into customer_channels (
      customer_id,
      channel_type,
      channel_value,
      is_primary,
      verified,
      source_system,
      external_id,
      metadata_json
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    returning *
    `,
    [
      customerId,
      channelType,
      normalizedValue || null,
      Boolean(isPrimary),
      Boolean(verified),
      sourceSystem || null,
      externalId || null,
      JSON.stringify(metadata || {})
    ]
  );

  return rows[0] || null;
}

export async function insertConversationSummary({
  customerId,
  conversationId,
  canal = null,
  procedimiento = null,
  stageFinal = null,
  outcome = null,
  keyFacts = {}
}) {
  if (!customerId || !conversationId) return null;

  const { rows } = await getPool().query(
    `
    insert into customer_conversation_summaries (
      customer_id,
      conversation_id,
      canal,
      procedimiento,
      stage_final,
      outcome,
      key_facts
    )
    values ($1, $2, $3, $4, $5, $6, $7::jsonb)
    on conflict (conversation_id)
    do nothing
    returning *
    `,
    [
      customerId,
      conversationId,
      canal || null,
      procedimiento || null,
      stageFinal || null,
      outcome || null,
      JSON.stringify(keyFacts || {})
    ]
  );

  return rows[0] || null;
}

export async function getCustomerSummaries(customerId, limit = 3) {
  if (!customerId) return [];

  const { rows } = await getPool().query(
    `
    select *
    from customer_conversation_summaries
    where customer_id = $1
    order by created_at desc, id desc
    limit $2
    `,
    [customerId, limit]
  );

  return rows;
}

export async function getCustomerConversationHistory(customerId, limit = 10) {
  if (!customerId) return [];

  const { rows } = await getPool().query(
    `
    select
      c.conversation_id,
      c.channel,
      c.handoff_reason,
      c.created_at,
      c.updated_at
    from conversations c
    where c.customer_id = $1
    order by c.updated_at desc, c.id desc
    limit $2
    `,
    [customerId, limit]
  );

  return rows;
}

export async function refreshCustomerConversationStats(customerId) {
  if (!customerId) return null;

  const { rows } = await getPool().query(
    `
    update customers c
    set
      total_conversaciones = stats.total_conversaciones,
      primera_conversacion_at = stats.primera_conversacion_at,
      ultima_conversacion_at = stats.ultima_conversacion_at,
      updated_at = now()
    from (
      select
        $1::bigint as customer_id,
        count(*)::integer as total_conversaciones,
        min(created_at) as primera_conversacion_at,
        max(created_at) as ultima_conversacion_at
      from customer_conversation_summaries
      where customer_id = $1
    ) stats
    where c.id = stats.customer_id
    returning c.*
    `,
    [customerId]
  );

  return rows[0] || null;
}

export { buildCustomerProfile };
