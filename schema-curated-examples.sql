create table if not exists historical_conversations (
  id bigserial primary key,
  conversation_id text not null unique,
  ticket_id text,
  channel text,
  outcome text,
  effective_conversation boolean not null default false,
  source_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists historical_messages (
  id bigserial primary key,
  conversation_id text not null,
  role text not null,
  message_text text not null,
  message_ts timestamptz,
  source_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists historical_outcomes (
  id bigserial primary key,
  conversation_id text not null,
  sell_status text,
  result_type text,
  effectiveness_level text,
  created_at timestamptz not null default now()
);

create table if not exists curated_examples (
  id bigserial primary key,
  example_id text not null unique,
  channel text not null default 'any',
  intent text not null default 'generic',
  stage text not null,
  outcome text,
  quality_score integer not null default 0,
  messages_json jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
