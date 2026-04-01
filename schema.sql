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

create table if not exists eugenia_predictions (
  id bigserial primary key,
  conversation_id text not null,
  turn_number integer not null default 1,

  -- Step 1: EugenIA prediction (at human takeover or each patient message)
  ai_suggested_action text not null,
  ai_suggested_intent text,
  ai_confidence numeric(3,2),
  lead_score_at_prediction integer,
  pipeline text,
  predicted_at timestamptz not null default now(),

  -- Step 2: Human agent actual action
  human_actual_action text,
  human_actual_intent text,
  observed_at timestamptz,

  -- Step 3: Comparison
  match_type text,
  match_score numeric(3,2),
  compared_at timestamptz,

  -- Step 4: Outcome (from Sell pipeline phase)
  outcome_phase text,
  outcome_score integer,
  outcome_at timestamptz,
  is_gold_sample boolean not null default false,
  gold_reason text,

  state_snapshot_json jsonb,
  created_at timestamptz not null default now()
);

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

create table if not exists lead_score_history (
  id bigserial primary key,
  conversation_id text not null,
  score integer not null,
  previous_score integer,
  delta integer not null default 0,
  category text not null,
  pipeline text,
  reasons text[],
  trigger_type text,
  message_number integer,
  created_at timestamptz not null default now()
);

create index if not exists lead_score_history_conversation_idx
on lead_score_history (conversation_id, created_at);

create index if not exists eugenia_predictions_conversation_idx
on eugenia_predictions (conversation_id, turn_number);

create index if not exists eugenia_predictions_gold_idx
on eugenia_predictions (is_gold_sample)
where is_gold_sample = true;
