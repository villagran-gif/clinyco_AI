import { pool } from "./db.js";

// ── Message Quality Score (Rita et al. 2026) ──
// Weights from standardized β coefficients in the PLS-SEM paper:
//   Information Quality  β=0.409  → 0.40
//   Problem Solving      β=0.315  → 0.30
//   Understanding        β=0.173  → 0.17
//   Clarity              (Gikko)  → 0.13
//   Timing is tracked separately (not in composite — it's a moderator).

const W_INFO = 0.40;
const W_PROBLEM = 0.30;
const W_UNDERSTAND = 0.17;
const W_CLARITY = 0.13;

const EXPECTED_RESPONSE_SECONDS = 300; // 5 min = timing score 0
const MAX_WORDS_PER_SENTENCE = 25;      // above this, clarity drops to 0

const NUMBER_RE = /\b\d[\d.,:]*\b/;
const DATE_RE = /\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b|\b(lunes|martes|miércoles|jueves|viernes|sábado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i;
const URL_RE = /https?:\/\/|www\./i;

const COMMITMENT_KEYWORDS = [
  "listo", "dale", "perfecto", "confirmo", "agendado", "nos vemos",
  "de acuerdo", "ok", "genial", "excelente", "gracias",
];
const OBJECTION_KEYWORDS = [
  "lo voy a pensar", "no estoy segur", "caro", "costoso", "no puedo",
  "después te aviso", "déjame ver",
];

const STOP_WORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "y", "o", "pero",
  "de", "del", "en", "a", "al", "que", "qué", "es", "son", "se", "lo",
  "mi", "tu", "su", "con", "por", "para", "si", "no", "yo", "tú",
  "me", "te", "le", "nos", "les", "como", "muy", "ya", "más",
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function scoreInformationQuality(body) {
  if (!body) return 0;
  let score = 0;
  const wc = body.trim().split(/\s+/).filter(Boolean).length;

  // Concrete data signals
  if (NUMBER_RE.test(body)) score += 0.3;
  if (DATE_RE.test(body)) score += 0.3;
  if (URL_RE.test(body)) score += 0.2;

  // Sufficiency: 8–80 words sweet spot
  if (wc >= 8 && wc <= 80) score += 0.3;
  else if (wc >= 4 && wc < 8) score += 0.15;
  else if (wc > 80 && wc <= 150) score += 0.15;

  return Math.min(1, score);
}

function scoreProblemSolving(body, nextClientBody) {
  if (!body) return 0;
  let score = 0;

  // Actionable content in agent msg
  const low = body.toLowerCase();
  if (/(puede|podría|puedes|te recomiendo|te sugiero|agenda|reserva|confirma|ingresa|completa)/i.test(low))
    score += 0.3;
  if (NUMBER_RE.test(body) || DATE_RE.test(body) || URL_RE.test(body))
    score += 0.2;

  // Did next client msg indicate resolution?
  if (nextClientBody) {
    const lowNext = nextClientBody.toLowerCase();
    if (COMMITMENT_KEYWORDS.some((k) => lowNext.includes(k))) score += 0.5;
    else if (OBJECTION_KEYWORDS.some((k) => lowNext.includes(k))) score += 0.1;
    else score += 0.25; // neutral continuation
  } else {
    score += 0.1; // no reply yet — partial credit
  }

  return Math.min(1, score);
}

function scoreUnderstanding(body, prevClientBody) {
  if (!body || !prevClientBody) return 0.5; // no prior msg to compare
  const a = tokenize(body);
  const b = tokenize(prevClientBody);
  const sim = jaccard(a, b);
  // Light overlap already indicates topical relevance; cap at 1.
  return Math.min(1, sim * 3);
}

function scoreClarity(body) {
  if (!body) return 0;
  const sentences = body.split(/[.!?¿¡]+/).map((s) => s.trim()).filter(Boolean);
  if (!sentences.length) return 0;
  const avgWords =
    sentences.reduce((sum, s) => sum + s.split(/\s+/).filter(Boolean).length, 0) /
    sentences.length;
  return Math.max(0, 1 - Math.min(avgWords / MAX_WORDS_PER_SENTENCE, 1));
}

function scoreTiming(responseTimeSeconds) {
  if (responseTimeSeconds == null) return null;
  return Math.max(0, 1 - Math.min(responseTimeSeconds / EXPECTED_RESPONSE_SECONDS, 1));
}

async function main() {
  console.log("[mqs] Loading agent_to_client messages...");

  const { rows: messages } = await pool.query(
    `SELECT id, conversation_id, body, sent_at
       FROM agent_direct_messages
      WHERE direction = 'agent_to_client'
        AND mqs_composite IS NULL
      ORDER BY conversation_id ASC, sent_at ASC`
  );

  console.log(`[mqs] ${messages.length} messages to score`);

  // Group by conversation to look up context efficiently
  const byConv = new Map();
  for (const m of messages) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }

  let processed = 0;
  let errors = 0;

  for (const [convId, convMsgs] of byConv) {
    // Load full conversation timeline once
    const { rows: allMsgs } = await pool.query(
      `SELECT id, direction, body, sent_at
         FROM agent_direct_messages
        WHERE conversation_id = $1
        ORDER BY sent_at ASC, id ASC`,
      [convId]
    );

    for (const target of convMsgs) {
      try {
        const idx = allMsgs.findIndex((m) => m.id === target.id);

        // Previous client message
        let prevClient = null;
        for (let i = idx - 1; i >= 0; i--) {
          if (allMsgs[i].direction === "client_to_agent") {
            prevClient = allMsgs[i];
            break;
          }
        }

        // Next client message
        let nextClient = null;
        for (let i = idx + 1; i < allMsgs.length; i++) {
          if (allMsgs[i].direction === "client_to_agent") {
            nextClient = allMsgs[i];
            break;
          }
        }

        // Response time: delta from prev client msg to this agent msg
        let responseTime = null;
        if (prevClient) {
          responseTime = (new Date(target.sent_at) - new Date(prevClient.sent_at)) / 1000;
          if (responseTime < 0) responseTime = null;
        }

        const info = scoreInformationQuality(target.body);
        const problem = scoreProblemSolving(target.body, nextClient?.body);
        const understand = scoreUnderstanding(target.body, prevClient?.body);
        const clarity = scoreClarity(target.body);
        const timing = scoreTiming(responseTime);

        const composite =
          W_INFO * info +
          W_PROBLEM * problem +
          W_UNDERSTAND * understand +
          W_CLARITY * clarity;

        await pool.query(
          `UPDATE agent_direct_messages SET
             mqs_information_quality = $2,
             mqs_problem_solving = $3,
             mqs_understanding = $4,
             mqs_clarity = $5,
             mqs_timing_score = $6,
             mqs_composite = $7
           WHERE id = $1`,
          [
            target.id,
            info.toFixed(2),
            problem.toFixed(2),
            understand.toFixed(2),
            clarity.toFixed(2),
            timing == null ? null : timing.toFixed(2),
            composite.toFixed(2),
          ]
        );

        processed++;
        if (processed % 200 === 0) {
          console.log(`[mqs] ${processed}/${messages.length} scored`);
        }
      } catch (err) {
        errors++;
        console.error(`[mqs] msg ${target.id} failed:`, err.message);
      }
    }
  }

  console.log(`[mqs] Complete: ${processed} scored, ${errors} errors`);
  await pool.end();
}

main().catch((err) => {
  console.error("[mqs] Fatal:", err);
  process.exit(1);
});
