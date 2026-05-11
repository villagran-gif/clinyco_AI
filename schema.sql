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

-- ── Lead Score History ──
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
on lead_score_history (conversation_id, created_at desc);

-- ── EugenIA Predictions ──
create table if not exists eugenia_predictions (
  id bigserial primary key,
  conversation_id text not null,
  turn_number integer not null default 1,
  prediction_type text not null default 'question',
  ai_suggested_action text not null,
  ai_suggested_intent text,
  ai_confidence numeric(3,2),
  lead_score_at_prediction integer,
  pipeline text,
  predicted_at timestamptz not null default now(),
  human_actual_action text,
  human_actual_intent text,
  observed_at timestamptz,
  match_type text,
  match_score numeric(3,2),
  compared_at timestamptz,
  outcome_phase text,
  outcome_score integer,
  outcome_at timestamptz,
  is_gold_sample boolean not null default false,
  gold_reason text,
  state_snapshot_json jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists eugenia_predictions_unique_turn_type_idx
on eugenia_predictions (conversation_id, turn_number, prediction_type);

create index if not exists eugenia_predictions_conversation_turn_idx
on eugenia_predictions (conversation_id, turn_number);

create index if not exists eugenia_predictions_gold_idx
on eugenia_predictions (is_gold_sample)
where is_gold_sample = true;

create table if not exists eugenia_ticket_notes (
  id bigserial primary key,
  conversation_id text not null,
  ticket_id text not null,
  turn_number integer,
  note_fingerprint text not null,
  note_body text not null,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists eugenia_ticket_notes_ticket_fingerprint_idx
on eugenia_ticket_notes (ticket_id, note_fingerprint);

create index if not exists eugenia_ticket_notes_conversation_idx
on eugenia_ticket_notes (conversation_id, created_at desc);

create table if not exists eugenia_directives (
  id bigserial primary key,
  conversation_id text not null,
  ticket_id text,
  source_kind text not null default 'ticket_comment',
  source_public boolean,
  directive_type text not null,
  parsed_field text,
  parsed_value text,
  raw_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists eugenia_directives_conversation_idx
on eugenia_directives (conversation_id, created_at desc);

create table if not exists eugenia_ticket_events (
  id bigserial primary key,
  conversation_id text not null,
  ticket_id text not null,
  audit_id text not null,
  event_type text not null,
  author_id text,
  source_public boolean,
  body text,
  created_at timestamptz not null default now()
);

create unique index if not exists eugenia_ticket_events_ticket_audit_event_idx
on eugenia_ticket_events (ticket_id, audit_id, event_type);

create index if not exists eugenia_ticket_events_conversation_idx
on eugenia_ticket_events (conversation_id, created_at desc);

create table if not exists eugenia_help_sessions (
  id bigserial primary key,
  conversation_id text not null,
  ticket_id text not null,
  agent_author_id text not null,
  trigger_audit_id text not null,
  trigger_text text not null,
  prompt_published_at timestamptz,
  feedback_audit_id text,
  feedback_text text,
  sheet_tab text,
  sheet_url text,
  sheet_row_number integer,
  sheet_synced_at timestamptz,
  sync_error text,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists eugenia_help_sessions_open_ticket_agent_idx
on eugenia_help_sessions (ticket_id, agent_author_id)
where closed_at is null;

create index if not exists eugenia_help_sessions_conversation_idx
on eugenia_help_sessions (conversation_id, created_at desc);
