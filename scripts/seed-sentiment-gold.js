#!/usr/bin/env node
import "dotenv/config";
/**
 * seed-sentiment-gold.js — Generate initial gold samples for sentiment
 * by classifying representative messages with Claude Opus.
 *
 * Usage: node scripts/seed-sentiment-gold.js [--limit 50] [--dry-run]
 */
import pg from "pg";
import Anthropic from "@anthropic-ai/sdk";

const DATABASE_URL = process.env.DATABASE_URL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY required"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = parseInt(args[args.indexOf("--limit") + 1]) || 50;

const PROMPT = `Clasifica el sentimiento del siguiente mensaje de un paciente/cliente de clínica en Chile. Responde SOLO JSON válido:
{ "label": "positive" | "neutral" | "negative", "score": -1.0 a 1.0, "rationale": "una frase explicando por qué" }

Reglas:
- Maneja negación: "no es malo" = positive
- Modismos chilenos: "bacán" = positive, "penca" = negative, "fome" = negative
- Saludos simples = neutral
- Contexto clínico: consultas médicas, agendamiento, costos`;

async function classifyWithOpus(body) {
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 200,
    temperature: 0.1,
    messages: [
      { role: "user", content: `${PROMPT}\n\nMensaje: "${body}"` },
    ],
  });
  const raw = response.content?.[0]?.text;
  if (!raw) return null;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

async function main() {
  // Select representative messages
  const { rows: messages } = await pool.query(`
    (SELECT id, body, text_sentiment_score, emoji_sentiment_avg
     FROM agent_direct_messages
     WHERE body IS NOT NULL AND LENGTH(body) > 20 AND word_count >= 5
       AND text_sentiment_score > 0.3
     ORDER BY RANDOM() LIMIT $1)
    UNION ALL
    (SELECT id, body, text_sentiment_score, emoji_sentiment_avg
     FROM agent_direct_messages
     WHERE body IS NOT NULL AND LENGTH(body) > 20 AND word_count >= 5
       AND text_sentiment_score < -0.3
     ORDER BY RANDOM() LIMIT $1)
    UNION ALL
    (SELECT id, body, text_sentiment_score, emoji_sentiment_avg
     FROM agent_direct_messages
     WHERE body IS NOT NULL AND LENGTH(body) > 20 AND word_count >= 5
       AND text_sentiment_score BETWEEN -0.3 AND 0.3
     ORDER BY RANDOM() LIMIT $2)
    UNION ALL
    (SELECT id, body, text_sentiment_score, emoji_sentiment_avg
     FROM agent_direct_messages
     WHERE body IS NOT NULL AND LENGTH(body) > 20 AND word_count >= 5
       AND emoji_sentiment_avg IS NOT NULL
       AND SIGN(text_sentiment_score) != SIGN(emoji_sentiment_avg)
     ORDER BY RANDOM() LIMIT $2)
  `, [Math.ceil(LIMIT * 0.3), Math.ceil(LIMIT * 0.2)]);

  console.log(`[seed-gold] ${messages.length} representative messages selected (target: ${LIMIT})`);

  let inserted = 0, agreed = 0, disagreed = 0, errors = 0;
  const disagreements = [];

  for (const msg of messages) {
    try {
      const result = await classifyWithOpus(msg.body);
      if (!result) { errors++; continue; }

      const keywordLabel = msg.text_sentiment_score > 0.1 ? "positive"
        : msg.text_sentiment_score < -0.1 ? "negative" : "neutral";
      const opusLabel = result.label;
      const agrees = keywordLabel === opusLabel;

      if (agrees) agreed++;
      else {
        disagreed++;
        disagreements.push({
          id: msg.id,
          body: msg.body.substring(0, 80),
          keyword: `${keywordLabel} (${msg.text_sentiment_score})`,
          opus: `${opusLabel} (${result.score})`,
          rationale: result.rationale,
        });
      }

      if (!DRY_RUN) {
        await pool.query(
          `INSERT INTO waha_sentiment_feedback
             (message_id, predicted_score, predicted_model, human_label, human_score, corrected_by, rationale)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (message_id, corrected_by) DO UPDATE SET
             human_label = EXCLUDED.human_label,
             human_score = EXCLUDED.human_score,
             rationale = EXCLUDED.rationale`,
          [
            msg.id,
            msg.text_sentiment_score || 0,
            "keyword-v1",
            result.label,
            result.score,
            "opus-seed",
            result.rationale,
          ]
        );
      }
      inserted++;

      if (inserted % 10 === 0) console.log(`  ${inserted}/${messages.length}...`);
    } catch (err) {
      errors++;
      if (errors < 5) console.error(`  Error msg ${msg.id}:`, err.message);
    }
  }

  console.log(`\n[seed-gold] Results:`);
  console.log(`  Processed: ${inserted}`);
  console.log(`  Agreed (keyword == opus): ${agreed}`);
  console.log(`  Disagreed: ${disagreed}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Mode: ${DRY_RUN ? "DRY-RUN" : "INSERTED"}`);

  if (disagreements.length > 0) {
    console.log(`\n── Top disagreements (keyword vs Opus) ──`);
    console.table(disagreements.slice(0, 15));
  }

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
