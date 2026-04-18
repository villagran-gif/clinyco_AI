-- 014-waha-sentiment-meta.sql
-- Adds sentiment metadata columns to agent_direct_messages for the
-- continuous improvement pipeline (confidence tracking, model provenance,
-- analysis versioning).

ALTER TABLE agent_direct_messages
  ADD COLUMN IF NOT EXISTS sentiment_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS sentiment_model      TEXT,
  ADD COLUMN IF NOT EXISTS sentiment_rationale  TEXT,
  ADD COLUMN IF NOT EXISTS sentiment_scored_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS analysis_version     SMALLINT DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_adm_sentiment_confidence
  ON agent_direct_messages (sentiment_confidence)
  WHERE sentiment_confidence < 0.7;

CREATE INDEX IF NOT EXISTS idx_adm_analysis_version
  ON agent_direct_messages (analysis_version);
