-- ============================================================================
-- Cleanup bad conversations captured before the strict phone validator was
-- deployed.
--
-- DELETES two classes of garbage:
--   1. Conversations whose client_phone has more than 13 digits (WhatsApp LID
--      addresses disguised as phones).
--   2. Conversations whose client_phone is actually one of our own agents
--      (agent-to-agent chats).
--
-- PREREQUISITE:
--   The observer must have been restarted with the new code *before* running
--   this script, so agent_waha_sessions.agent_phone is populated via the
--   agent-phones discovery pass. Verify with:
--     SELECT session_name, agent_name, agent_phone FROM agent_waha_sessions;
--
-- USAGE:
--   psql "$DATABASE_URL" -f cleanup-bad-phones.sql
-- ============================================================================

BEGIN;

\echo ''
\echo '=== 1. Long phones (likely WhatsApp LID addresses, >13 digits) ==='
SELECT id,
       session_name,
       client_phone,
       length(regexp_replace(client_phone, '\D', '', 'g')) AS digit_count,
       message_count
FROM agent_direct_conversations
WHERE length(regexp_replace(client_phone, '\D', '', 'g')) > 13
ORDER BY digit_count DESC, id;

\echo ''
\echo '=== 2. Agent-to-agent conversations (client_phone matches a known agent) ==='
SELECT adc.id,
       adc.session_name,
       my_aws.agent_name        AS session_agent,
       adc.client_phone,
       peer_aws.agent_name      AS peer_agent,
       adc.message_count
FROM agent_direct_conversations adc
LEFT JOIN agent_waha_sessions my_aws   ON my_aws.session_name = adc.session_name
LEFT JOIN agent_waha_sessions peer_aws ON peer_aws.agent_phone = adc.client_phone
WHERE adc.client_phone IN (
  SELECT agent_phone FROM agent_waha_sessions WHERE agent_phone IS NOT NULL
)
ORDER BY adc.id;

-- Build the set of bad conversation IDs once, into a temp table.
CREATE TEMP TABLE bad_convs ON COMMIT DROP AS
SELECT id FROM agent_direct_conversations
WHERE length(regexp_replace(client_phone, '\D', '', 'g')) > 13
   OR client_phone IN (
     SELECT agent_phone FROM agent_waha_sessions WHERE agent_phone IS NOT NULL
   );

\echo ''
\echo '=== Summary ==='
SELECT count(*) AS conversations_to_delete FROM bad_convs;

SELECT count(*) AS messages_to_delete
FROM agent_direct_messages
WHERE conversation_id IN (SELECT id FROM bad_convs);

SELECT count(*) AS metrics_to_delete
FROM agent_behavior_metrics
WHERE conversation_id IN (SELECT id FROM bad_convs);

-- Delete in FK-safe order: metrics → messages → conversations.
DELETE FROM agent_behavior_metrics
WHERE conversation_id IN (SELECT id FROM bad_convs);

DELETE FROM agent_direct_messages
WHERE conversation_id IN (SELECT id FROM bad_convs);

DELETE FROM agent_direct_conversations
WHERE id IN (SELECT id FROM bad_convs);

\echo ''
\echo '=== Final counts after cleanup ==='
SELECT
  (SELECT count(*) FROM agent_direct_conversations) AS conversations,
  (SELECT count(*) FROM agent_direct_messages)      AS messages,
  (SELECT count(*) FROM agent_behavior_metrics)     AS metrics;

COMMIT;
