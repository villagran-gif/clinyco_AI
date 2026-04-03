-- ============================================================
-- Agent Observer: Schema Migration
-- Etapa 1 — Captura de conversaciones directas vía WAHA
-- ============================================================

-- ── 1. Emoji Sentiment Lookup (reference table, 751 rows) ──
-- Source: Novak et al., PLOS ONE — Emoji Sentiment Ranking
-- Dataset: CLARIN.SI (http://hdl.handle.net/11356/1048)

create table if not exists emoji_sentiment_lookup (
  id serial primary key,
  emoji text not null,
  unicode_codepoint text not null unique,
  unicode_name text not null,
  unicode_block text,
  occurrences integer not null default 0,
  negative numeric(6,3) not null default 0,
  neutral numeric(6,3) not null default 0,
  positive numeric(6,3) not null default 0,
  sentiment_score numeric(4,3) not null,
  position numeric(4,3)
);

create unique index if not exists emoji_sentiment_emoji_idx
  on emoji_sentiment_lookup (emoji);


-- ── 2. Agent WAHA Sessions ──
-- Links WAHA sessions to sales agents

create table if not exists agent_waha_sessions (
  id bigserial primary key,
  session_name text not null unique,          -- WAHA session name (e.g. "piloto-agente-1")
  agent_name text not null,                    -- Agent display name
  agent_phone text,                            -- Corporate phone number
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);


-- ── 3. Agent Direct Conversations ──
-- Each unique agent-session + client-phone pair

create table if not exists agent_direct_conversations (
  id bigserial primary key,
  conversation_key text not null unique,       -- "session:clientPhone" (stable key)
  session_name text not null references agent_waha_sessions(session_name),
  client_phone text not null,                  -- Client phone (without @c.us)
  customer_id bigint references customers(id), -- FK auto-match (nullable)
  match_status text not null default 'pending', -- pending | matched | unmatched
  message_count integer not null default 0,
  first_message_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_direct_conv_client_phone_idx
  on agent_direct_conversations (client_phone);
create index if not exists agent_direct_conv_customer_id_idx
  on agent_direct_conversations (customer_id)
  where customer_id is not null;


-- ── 4. Agent Direct Messages ──
-- Raw bidirectional messages with per-message analysis + MQS

create table if not exists agent_direct_messages (
  id bigserial primary key,
  conversation_id bigint not null references agent_direct_conversations(id),
  waha_message_id text,                        -- WAHA message ID for dedup
  direction text not null,                     -- 'agent_to_client' | 'client_to_agent'
  body text,                                   -- Message text
  has_media boolean not null default false,
  media_type text,                             -- image, audio, video, document
  push_name text,                              -- Sender's pushName from WAHA
  raw_json jsonb,                              -- Full WAHA payload

  -- ── Per-message analysis (inspired by soan.whatsapp) ──
  body_clean text,                             -- Body without URLs, extra whitespace
  body_text_only text,                         -- Body without emojis, URLs
  emoji_list text[],                           -- Array of emojis found
  emoji_count integer not null default 0,
  emoji_sentiment_avg numeric(4,3),            -- Avg sentiment of emojis (Novak et al.)
  emoji_sentiment_min numeric(4,3),
  emoji_sentiment_max numeric(4,3),
  text_sentiment_score numeric(4,3),           -- Basic text sentiment heuristic
  word_count integer not null default 0,
  has_question boolean not null default false,
  has_url boolean not null default false,
  detected_signals text[],                     -- buying_signal, objection_signal, etc.
  hour_of_day smallint,                        -- 0-23
  day_of_week smallint,                        -- 0=Sunday, 6=Saturday

  -- ── Message Quality Score (MQS) ──
  -- Rita et al. (2026) + Gikko (2026)
  mqs_information_quality numeric(3,2),        -- 0-1: Info accuracy & relevance (beta=0.409)
  mqs_problem_solving numeric(3,2),            -- 0-1: Advances toward solving (beta=0.315)
  mqs_understanding numeric(3,2),              -- 0-1: Comprehension of user intent (beta=0.173)
  mqs_clarity numeric(3,2),                    -- 0-1: Message clarity
  mqs_timing_score numeric(3,2),              -- 0-1: Temporal opportuneness
  mqs_composite numeric(3,2),                  -- Weighted composite (beta weights)

  sent_at timestamptz not null,                -- Original message timestamp
  created_at timestamptz not null default now()
);

create unique index if not exists agent_direct_messages_waha_id_idx
  on agent_direct_messages (waha_message_id)
  where waha_message_id is not null;
create index if not exists agent_direct_messages_conv_sent_idx
  on agent_direct_messages (conversation_id, sent_at);


-- ── 5. Agent Behavior Metrics ──
-- Computed metrics per conversation for pattern analysis

create table if not exists agent_behavior_metrics (
  id bigserial primary key,
  conversation_id bigint not null references agent_direct_conversations(id),
  metric_type text not null,                   -- response_time, emoji_count, buying_signal, etc.
  metric_value numeric not null,
  context_json jsonb,                          -- Additional calculation context
  calculated_at timestamptz not null default now()
);

create index if not exists agent_behavior_metrics_conv_idx
  on agent_behavior_metrics (conversation_id, metric_type);


-- ── 6. ALTER existing conversation_messages — add MQS columns ──
-- Applies to bot messages AND human agent messages via Zendesk

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  mqs_information_quality numeric(3,2);

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  mqs_problem_solving numeric(3,2);

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  mqs_understanding numeric(3,2);

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  mqs_clarity numeric(3,2);

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  mqs_timing_score numeric(3,2);

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  mqs_composite numeric(3,2);
