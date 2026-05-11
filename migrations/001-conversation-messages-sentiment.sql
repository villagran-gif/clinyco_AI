-- ============================================================
-- Migration: Add sentiment analysis columns to conversation_messages
-- Enables WhatsApp Zendesk messages to have the same analysis
-- as WAHA observer messages (agent_direct_messages)
-- ============================================================

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  emoji_list text[];

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  emoji_count integer NOT NULL DEFAULT 0;

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  emoji_sentiment_avg numeric(4,3);

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  text_sentiment_score numeric(4,3);

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  word_count integer NOT NULL DEFAULT 0;

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  has_question boolean NOT NULL DEFAULT false;

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  detected_signals text[];

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS
  author_display_name text;
