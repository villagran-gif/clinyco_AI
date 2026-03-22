-- ═══════════════════════════════════════════════════════════════
-- CUSTOMER MEMORY: Ficha persistente del cliente (cross-conversation)
-- ═══════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════
-- CONVERSATIONS
-- ═══════════════════════════════════════════════════════════════

create table if not exists conversations (
  id bigserial primary key,
  conversation_id text not null unique,
  customer_id bigint references customers(id),
  channel text,
  channel_external_id text,
  channel_display_name text,
  source_profile_name text,
  whatsapp_phone text,
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

create index if not exists idx_conversations_customer on conversations(customer_id);

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
on conversation_messages (conversation_id, message_id, role)
where message_id is not null;

create index if not exists conversation_messages_conversation_created_idx
on conversation_messages (conversation_id, created_at desc);
