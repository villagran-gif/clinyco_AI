-- 015-waha-sentiment-feedback.sql
-- Human-in-the-loop feedback table for sentiment corrections.
-- Used by dashboard HITL (👍/👎) and seed-sentiment-gold.js.

CREATE TABLE IF NOT EXISTS waha_sentiment_feedback (
  id                BIGSERIAL PRIMARY KEY,
  message_id        BIGINT NOT NULL REFERENCES agent_direct_messages(id) ON DELETE CASCADE,
  predicted_score   NUMERIC(4,3) NOT NULL,
  predicted_model   TEXT         NOT NULL,
  human_label       TEXT         NOT NULL CHECK (human_label IN ('positive','neutral','negative')),
  human_score       NUMERIC(4,3),
  corrected_by      TEXT         NOT NULL,
  rationale         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, corrected_by)
);

CREATE INDEX IF NOT EXISTS idx_wsf_created_at
  ON waha_sentiment_feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wsf_message_id
  ON waha_sentiment_feedback (message_id);
