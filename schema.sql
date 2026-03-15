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
on conversation_messages (conversation_id, message_id, role)
where message_id is not null;

create index if not exists conversation_messages_conversation_created_idx
on conversation_messages (conversation_id, created_at desc);
