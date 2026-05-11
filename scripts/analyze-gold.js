#!/usr/bin/env node
import "dotenv/config";
/**
 * scripts/analyze-gold.js — Analyze gold standard conversations with Claude Opus.
 * Gold = deals CERRADO OPERADO/AGENDADO/INSTALADO that have conversation messages.
 *
 * Evaluates first 5 messages of each conversation to find winning patterns.
 * Stores results in a new table: conversation_evaluations
 *
 * Usage: DATABASE_URL=... ANTHROPIC_API_KEY=... node scripts/analyze-gold.js [--limit 50]
 */
import pg from "pg";
import { evaluateMessage } from "../analysis/evaluate.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY required"); process.exit(1); }

const args = process.argv.slice(2);
const LIMIT = parseInt(args[args.indexOf("--limit") + 1]) || 999;
const MSGS_PER_CONV = 8; // First N messages per conversation

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Create evaluation table if not exists
await pool.query(`
  CREATE TABLE IF NOT EXISTS conversation_evaluations (
    id bigserial PRIMARY KEY,
    conversation_id text NOT NULL,
    message_id bigint,
    deal_id text,
    deal_phase text,
    role text,
    content text,
    evaluation jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS conv_eval_conv_idx ON conversation_evaluations (conversation_id);
  CREATE INDEX IF NOT EXISTS conv_eval_deal_idx ON conversation_evaluations (deal_id);
`);

// Find gold conversations
const { rows: goldDeals } = await pool.query(`
  SELECT d.deal_id, d.deal_name, d.pipeline_phase, d.pipeline_name, d.contact_phone,
         d.colaborador1, d.colaborador2, d.colaborador3,
         c.conversation_id
  FROM deals d
  JOIN conversations c ON c.whatsapp_phone = d.contact_phone
  WHERE d.pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')
    AND d.contact_phone IS NOT NULL
    AND d.synced_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM conversation_evaluations ce WHERE ce.deal_id = d.deal_id
    )
  ORDER BY d.pipeline_phase, d.deal_name
  LIMIT $1
`, [LIMIT]);

console.log(`[analyze-gold] Found ${goldDeals.length} gold conversations to analyze`);
console.log(`[analyze-gold] ${MSGS_PER_CONV} messages per conversation, Opus evaluation`);

let totalEvals = 0;
let totalTokens = 0;

for (let g = 0; g < goldDeals.length; g++) {
  const deal = goldDeals[g];

  // Get messages for this conversation
  const { rows: msgs } = await pool.query(`
    SELECT m.id, m.role, left(m.content, 500) AS content, m.created_at
    FROM conversation_messages m
    WHERE m.conversation_id = $1
    ORDER BY m.created_at ASC
    LIMIT $2
  `, [deal.conversation_id, MSGS_PER_CONV]);

  if (!msgs.length) continue;

  console.log(`\n[${g+1}/${goldDeals.length}] ${deal.deal_name} | ${deal.pipeline_phase} | ${msgs.length} msgs | C1=${deal.colaborador1 || '-'} C2=${deal.colaborador2 || '-'} C3=${deal.colaborador3 || '-'}`);

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const prev = msgs.slice(Math.max(0, i - 3), i).map(p => ({ role: p.role, content: p.content }));

    try {
      const evaluation = await evaluateMessage({
        message: m.content,
        role: m.role,
        authorName: m.role === "assistant" ? "Antonia" : null,
        pipeline: deal.pipeline_name || "Cirugía Bariátricas",
        previousMessages: prev,
      });

      if (evaluation) {
        await pool.query(`
          INSERT INTO conversation_evaluations (conversation_id, message_id, deal_id, deal_phase, role, content, evaluation)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [deal.conversation_id, m.id, deal.deal_id, deal.pipeline_phase, m.role, m.content, JSON.stringify(evaluation)]);

        totalEvals++;
        const tokens = (evaluation._tokens?.input || 0) + (evaluation._tokens?.output || 0);
        totalTokens += tokens;

        // Print summary
        const state = evaluation.patient_state;
        const mqs = evaluation.mqs;
        const signals = evaluation.signals;
        const lbl = m.role === "user" ? "PACIENTE" : "ANTONIA";

        let summary = `  [${lbl}] `;
        if (state) summary += `${state.estado_dominante} | motiv=${state.motivacion} miedo=${state.miedo} comp=${state.compromiso}`;
        if (mqs) summary += `MQS=${mqs.composite} emp=${evaluation.antonia_eval?.empathy_level || '-'}`;
        if (signals?.patient_signals?.length) summary += ` signals=[${signals.patient_signals}]`;
        console.log(summary);
      }
    } catch (err) {
      console.error(`  ERROR msg ${m.id}: ${err.message}`);
    }
  }
}

const costEstimate = (totalTokens * 0.000015).toFixed(2); // rough Opus pricing
console.log(`\n[analyze-gold] Done: ${totalEvals} evaluations, ~${totalTokens} tokens, ~$${costEstimate} estimated cost`);
await pool.end();
