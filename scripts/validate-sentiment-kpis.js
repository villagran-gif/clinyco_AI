#!/usr/bin/env node
/**
 * scripts/validate-sentiment-kpis.js
 *
 * Validates that the rule-based sentiment KPIs in analysis/sentiment.js
 * produce sensible results across realistic Chilean Spanish healthcare messages.
 *
 * Checks:
 *  1. Text sentiment scoring (positive/negative keyword matching)
 *  2. Emoji sentiment averaging (with mock DB lookup)
 *  3. Sales signal detection (buying, objection, commitment, referral, urgency)
 *  4. Question detection
 *  5. Edge cases & known pitfalls
 *
 * Run:  node scripts/validate-sentiment-kpis.js
 */

import { analyzeMessage } from "../analysis/sentiment.js";

// ── Mock emoji sentiment DB (Novak et al. scores) ──
const EMOJI_DB = new Map([
  ["❤️", { sentiment_score: "0.746" }],
  ["😂", { sentiment_score: "0.659" }],
  ["😍", { sentiment_score: "0.678" }],
  ["🎉", { sentiment_score: "0.657" }],
  ["👍", { sentiment_score: "0.521" }],
  ["🙏", { sentiment_score: "0.500" }],
  ["🤔", { sentiment_score: "0.120" }],
  ["😐", { sentiment_score: "0.000" }],
  ["😞", { sentiment_score: "-0.152" }],
  ["😢", { sentiment_score: "-0.317" }],
  ["💔", { sentiment_score: "-0.421" }],
  ["😡", { sentiment_score: "-0.500" }],
  ["🔥", { sentiment_score: "0.120" }],
  ["✅", { sentiment_score: "0.400" }],
  ["💪", { sentiment_score: "0.431" }],
]);

async function mockGetEmojiSentimentBatch(emojis) {
  const result = new Map();
  for (const e of emojis) {
    if (EMOJI_DB.has(e)) result.set(e, EMOJI_DB.get(e));
  }
  return result;
}

// ── Test infrastructure ──
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, detail = "") {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push({ testName, detail });
    console.log(`  FAIL: ${testName}${detail ? " — " + detail : ""}`);
  }
}

// ── Test cases ──

async function testTextSentiment() {
  console.log("\n=== 1. TEXT SENTIMENT SCORE ===\n");

  // Clearly positive
  const t1 = await analyzeMessage("Muchas gracias, excelente atención, todo perfecto 😊");
  assert(t1.textSentimentScore > 0, "Clearly positive message scores > 0",
    `got ${t1.textSentimentScore}`);

  // Clearly negative
  const t2 = await analyzeMessage("Horrible experiencia, pésimo servicio, estoy furiosa");
  assert(t2.textSentimentScore < 0, "Clearly negative message scores < 0",
    `got ${t2.textSentimentScore}`);

  // Neutral / no keywords
  const t3 = await analyzeMessage("Hola, quería consultar por una cirugía bariátrica");
  assert(t3.textSentimentScore === 0, "Neutral message scores 0",
    `got ${t3.textSentimentScore}`);

  // Mixed sentiment — 2 pos (increíble, feliz) vs 2 neg (dolor, terrible) = 0
  const t4 = await analyzeMessage("El dolor fue terrible pero el resultado es increíble y estoy feliz");
  assert(t4.textSentimentScore === 0, "Mixed equal pos/neg scores 0",
    `got ${t4.textSentimentScore} (2 pos vs 2 neg)`);

  // Chilean slang positive
  const t5 = await analyzeMessage("Quedó bacán el resultado, pulento todo");
  assert(t5.textSentimentScore > 0, "Chilean slang positive detected",
    `got ${t5.textSentimentScore}`);

  // Chilean slang negative
  const t6 = await analyzeMessage("La atención fue super fome y penca");
  assert(t6.textSentimentScore < 0, "Chilean slang negative detected",
    `got ${t6.textSentimentScore}`);

  // KNOWN ISSUE: Negation not handled
  const t7 = await analyzeMessage("No estoy feliz con el resultado, no fue bueno");
  console.log(`  [INFO] Negation test: "No estoy feliz... no fue bueno" → score=${t7.textSentimentScore}`);
  console.log(`         (Expected negative, but keyword-only approach gives positive — KNOWN LIMITATION)`);
  assert(t7.textSentimentScore > 0, "Negation NOT handled (known limitation) — positive words still counted",
    `got ${t7.textSentimentScore}`);

  // Short affirmation
  const t8 = await analyzeMessage("Bien");
  assert(t8.textSentimentScore > 0, "Single positive word scores > 0",
    `got ${t8.textSentimentScore}`);

  // Empty / null
  const t9 = await analyzeMessage("");
  assert(t9.textSentimentScore === 0, "Empty message scores 0",
    `got ${t9.textSentimentScore}`);
  const t10 = await analyzeMessage(null);
  assert(t10.textSentimentScore === 0, "Null message scores 0",
    `got ${t10.textSentimentScore}`);
}

async function testEmojiSentiment() {
  console.log("\n=== 2. EMOJI SENTIMENT ===\n");

  // Positive emojis
  const e1 = await analyzeMessage("Todo genial ❤️😍🎉", mockGetEmojiSentimentBatch);
  assert(e1.emojiSentimentAvg > 0.5, "Positive emojis average > 0.5",
    `got ${e1.emojiSentimentAvg?.toFixed(3)}`);

  // Negative emojis
  const e2 = await analyzeMessage("Me siento mal 😢💔😡", mockGetEmojiSentimentBatch);
  assert(e2.emojiSentimentAvg < 0, "Negative emojis average < 0",
    `got ${e2.emojiSentimentAvg?.toFixed(3)}`);

  // Mixed emojis
  const e3 = await analyzeMessage("No sé 🤔😐", mockGetEmojiSentimentBatch);
  assert(e3.emojiSentimentAvg !== null && e3.emojiSentimentAvg < 0.3,
    "Neutral emojis average near 0",
    `got ${e3.emojiSentimentAvg?.toFixed(3)}`);

  // Repeated emoji weighted correctly (all occurrences count)
  const e4 = await analyzeMessage("😍😍😍😢", mockGetEmojiSentimentBatch);
  assert(e4.emojiCount === 4, "Repeated emojis counted correctly",
    `got emojiCount=${e4.emojiCount}`);
  assert(e4.emojiList.length === 2, "Unique emojis deduped",
    `got emojiList.length=${e4.emojiList.length}`);
  // avg should be weighted: 3*0.678 + 1*(-0.317) / 4 = 0.4293
  assert(e4.emojiSentimentAvg > 0.3, "Repeated positive emoji weights correctly",
    `got ${e4.emojiSentimentAvg?.toFixed(3)} (expected ~0.429)`);

  // No emojis
  const e5 = await analyzeMessage("Solo texto sin emojis", mockGetEmojiSentimentBatch);
  assert(e5.emojiSentimentAvg === null, "No emojis → null avg",
    `got ${e5.emojiSentimentAvg}`);

  // Unknown emojis not in DB
  const e6 = await analyzeMessage("Raro 🦄🪐", mockGetEmojiSentimentBatch);
  assert(e6.emojiList.length > 0 && e6.emojiSentimentAvg === null,
    "Unknown emojis extracted but avg is null (not in DB)",
    `got list=${e6.emojiList.length}, avg=${e6.emojiSentimentAvg}`);

  // No DB function → emoji extraction still works
  const e7 = await analyzeMessage("Hola 👍❤️");
  assert(e7.emojiList.length === 2 && e7.emojiSentimentAvg === null,
    "No DB function → emojis extracted, avg null",
    `got list=${e7.emojiList.length}, avg=${e7.emojiSentimentAvg}`);
}

async function testSignalDetection() {
  console.log("\n=== 3. SALES SIGNAL DETECTION ===\n");

  // ── Buying signals ──
  const s1 = await analyzeMessage("Hola, cuánto cuesta la manga gástrica?");
  assert(s1.detectedSignals.includes("buying_signal"), "Buying: 'cuánto cuesta'",
    `got ${JSON.stringify(s1.detectedSignals)}`);

  const s2 = await analyzeMessage("Me interesa la liposucción, quiero agendar una hora");
  assert(s2.detectedSignals.includes("buying_signal"), "Buying: 'me interesa' + 'agendar'",
    `got ${JSON.stringify(s2.detectedSignals)}`);

  const s3 = await analyzeMessage("Tienen formas de pago? Aceptan cuotas?");
  assert(s3.detectedSignals.includes("buying_signal"), "Buying: 'formas de pago' + 'cuotas'",
    `got ${JSON.stringify(s3.detectedSignals)}`);

  // ── Objection signals ──
  const s4 = await analyzeMessage("Mmm lo voy a pensar, es muy caro para mí");
  assert(s4.detectedSignals.includes("objection_signal"), "Objection: 'lo voy a pensar' + 'es muy caro'",
    `got ${JSON.stringify(s4.detectedSignals)}`);

  const s5 = await analyzeMessage("No estoy segura, me da miedo la anestesia");
  assert(s5.detectedSignals.includes("objection_signal"), "Objection: 'no estoy segur' + 'me da miedo'",
    `got ${JSON.stringify(s5.detectedSignals)}`);

  // ── Commitment signals ──
  const s6 = await analyzeMessage("Dale, perfecto, nos vemos el martes entonces");
  assert(s6.detectedSignals.includes("commitment_signal"), "Commitment: 'dale' + 'perfecto' + 'nos vemos'",
    `got ${JSON.stringify(s6.detectedSignals)}`);

  const s7 = await analyzeMessage("Confirmo la hora para el jueves, ya está agendado");
  assert(s7.detectedSignals.includes("commitment_signal"), "Commitment: 'confirmo' + 'ya está' + 'agendado'",
    `got ${JSON.stringify(s7.detectedSignals)}`);

  // ── Referral signals ──
  const s8 = await analyzeMessage("Me recomendaron con ustedes, una amiga se operó ahí");
  assert(s8.detectedSignals.includes("referral_signal"), "Referral: 'me recomendaron' + 'una amiga'",
    `got ${JSON.stringify(s8.detectedSignals)}`);

  const s9 = await analyzeMessage("Mi doctora me dijo que consultara con ustedes");
  assert(s9.detectedSignals.includes("referral_signal"), "Referral: 'mi doctora'",
    `got ${JSON.stringify(s9.detectedSignals)}`);

  // ── Urgency signals ──
  const s10 = await analyzeMessage("Necesito operarme lo antes posible, es urgente");
  assert(s10.detectedSignals.includes("urgency_signal"), "Urgency: 'lo antes posible' + 'urgente'",
    `got ${JSON.stringify(s10.detectedSignals)}`);

  // ── Multi-signal ──
  const s11 = await analyzeMessage("Me interesa, cuánto cuesta? Necesito hacerlo esta semana, urgente");
  assert(
    s11.detectedSignals.includes("buying_signal") && s11.detectedSignals.includes("urgency_signal"),
    "Multi-signal: buying + urgency",
    `got ${JSON.stringify(s11.detectedSignals)}`
  );

  // ── No signals ──
  const s12 = await analyzeMessage("Hola, buenas tardes, tengo una consulta general");
  assert(s12.detectedSignals.length === 0, "No signals in generic greeting",
    `got ${JSON.stringify(s12.detectedSignals)}`);

  // ── FALSE POSITIVE CHECKS ──
  console.log("\n  -- False positive checks --");

  // "ya" was removed as urgency signal — too common in Chilean Spanish
  const fp1 = await analyzeMessage("Ya, gracias por la información");
  assert(!fp1.detectedSignals.includes("urgency_signal"),
    "No false-positive urgency from 'ya' (removed from keywords)",
    `got ${JSON.stringify(fp1.detectedSignals)}`);

  // "listo" is a commitment signal — but also used as casual acknowledgment
  const fp2 = await analyzeMessage("Listo, gracias por responder");
  const fp2HasCommitment = fp2.detectedSignals.includes("commitment_signal");
  console.log(`  [WARN] "Listo, gracias" detected commitment=${fp2HasCommitment} — "listo" often means just "ok"`);

  // "vamos" is a commitment signal — but also casual
  const fp3 = await analyzeMessage("Vamos a ver qué pasa");
  const fp3HasCommitment = fp3.detectedSignals.includes("commitment_signal");
  console.log(`  [WARN] "Vamos a ver" detected commitment=${fp3HasCommitment} — "vamos" is ambiguous`);

  // "mañana" was replaced by "mañana mismo" to reduce false positives
  const fp4 = await analyzeMessage("Mañana tengo que ir al médico por otra cosa");
  assert(!fp4.detectedSignals.includes("urgency_signal"),
    "No false-positive urgency from casual 'mañana' (now requires 'mañana mismo')",
    `got ${JSON.stringify(fp4.detectedSignals)}`);
  // But "mañana mismo" should still trigger
  const fp4b = await analyzeMessage("Necesito la hora mañana mismo");
  assert(fp4b.detectedSignals.includes("urgency_signal"),
    "'mañana mismo' still triggers urgency",
    `got ${JSON.stringify(fp4b.detectedSignals)}`);

  // "dolor" is negative — but expected in medical context
  const fp5 = await analyzeMessage("El dolor post-operatorio fue mínimo, estoy muy contenta");
  assert(fp5.textSentimentScore >= 0, "Medical 'dolor' context: score should still be >= 0 if rest is positive",
    `got ${fp5.textSentimentScore} (dolor + contenta)`);

  // "problema" is negative — but "sin problema" is positive
  const fp6 = await analyzeMessage("Sin problema, todo salió bien");
  console.log(`  [WARN] "Sin problema" sentiment=${fp6.textSentimentScore} — "problema" counted as negative despite positive context`);

  // "bien" alone
  const fp7 = await analyzeMessage("Bien, nos vemos");
  assert(fp7.textSentimentScore > 0, "'Bien' detected as positive",
    `got ${fp7.textSentimentScore}`);
}

async function testQuestionDetection() {
  console.log("\n=== 4. QUESTION DETECTION ===\n");

  const q1 = await analyzeMessage("Cuánto cuesta la cirugía?");
  assert(q1.hasQuestion, "Question mark detected");

  const q2 = await analyzeMessage("Cómo es el proceso de recuperación");
  assert(q2.hasQuestion, "Spanish question word without ? detected",
    `got ${q2.hasQuestion}`);

  const q3 = await analyzeMessage("Quiero agendar una hora");
  assert(!q3.hasQuestion, "Statement not flagged as question",
    `got ${q3.hasQuestion}`);

  const q4 = await analyzeMessage("Qué opciones hay para financiamiento");
  assert(q4.hasQuestion, "'Qué' at start detected as question",
    `got ${q4.hasQuestion}`);
}

async function testWordCount() {
  console.log("\n=== 5. WORD COUNT ===\n");

  const w1 = await analyzeMessage("Hola buenas tardes");
  assert(w1.wordCount === 3, "Simple 3-word count",
    `got ${w1.wordCount}`);

  // URLs should not count
  const w2 = await analyzeMessage("Mira este link https://example.com/something para info");
  assert(w2.wordCount < 7, "URL excluded from word count",
    `got ${w2.wordCount}`);

  // Emojis should not count as words
  const w3 = await analyzeMessage("Gracias 😍❤️🎉");
  assert(w3.wordCount === 1, "Emojis excluded from word count",
    `got ${w3.wordCount}`);
}

async function testEdgeCases() {
  console.log("\n=== 6. EDGE CASES ===\n");

  // Only emojis
  const ec1 = await analyzeMessage("😍❤️👍", mockGetEmojiSentimentBatch);
  assert(ec1.wordCount === 0, "Emoji-only: word count is 0",
    `got ${ec1.wordCount}`);
  assert(ec1.textSentimentScore === 0, "Emoji-only: text sentiment is 0",
    `got ${ec1.textSentimentScore}`);
  assert(ec1.emojiSentimentAvg > 0, "Emoji-only: emoji sentiment is positive",
    `got ${ec1.emojiSentimentAvg?.toFixed(3)}`);

  // Only URL
  const ec2 = await analyzeMessage("https://www.clinyco.cl/cirugia-bariatrica");
  assert(ec2.wordCount === 0, "URL-only: word count is 0",
    `got ${ec2.wordCount}`);
  assert(ec2.textSentimentScore === 0, "URL-only: text sentiment is 0",
    `got ${ec2.textSentimentScore}`);

  // Very long message
  const longMsg = "Hola, quería contarles que la experiencia fue excelente. " +
    "El doctor fue muy bueno, la atención increíble. " +
    "Estoy feliz con el resultado, todo perfecto. " +
    "Gracias por todo, los recomiendo a todos.";
  const ec3 = await analyzeMessage(longMsg);
  assert(ec3.textSentimentScore === 1, "All-positive long message maxes at 1.0",
    `got ${ec3.textSentimentScore}`);

  // Accent variations — both should now work
  const ec4 = await analyzeMessage("cuanto cuesta"); // no accent
  const ec4Accent = await analyzeMessage("cuánto cuesta"); // with accent
  assert(ec4.detectedSignals.includes("buying_signal"),
    "Buying signal works WITHOUT accents",
    `got ${JSON.stringify(ec4.detectedSignals)}`);
  assert(ec4Accent.detectedSignals.includes("buying_signal"),
    "Buying signal works WITH accents",
    `got ${JSON.stringify(ec4Accent.detectedSignals)}`);

  // Case insensitivity
  const ec5 = await analyzeMessage("ME INTERESA LA CIRUGÍA, CUÁNTO CUESTA??");
  assert(ec5.detectedSignals.includes("buying_signal"), "UPPERCASE buying signal detected",
    `got ${JSON.stringify(ec5.detectedSignals)}`);
  assert(ec5.hasQuestion, "UPPERCASE question marks detected");
}

async function testRealisticConversations() {
  console.log("\n=== 7. REALISTIC CONVERSATION FLOWS ===\n");

  // Simulated patient journey
  const journey = [
    { role: "patient", text: "Hola, me interesa la manga gástrica, cuánto cuesta?", expected: { buying: true } },
    { role: "agent",   text: "Hola! El valor de la cirugía de manga gástrica parte desde los 4 millones. Tenemos facilidades de pago 😊", expected: {} },
    { role: "patient", text: "Es muy caro 😞 No sé si me alcanza, lo voy a pensar", expected: { objection: true, negative: true } },
    { role: "agent",   text: "Entiendo, tenemos financiamiento hasta en 24 cuotas sin interés 🙏", expected: {} },
    { role: "patient", text: "Ah ok, eso me sirve. Mi doctora me dijo que era bueno operarse con ustedes", expected: { referral: true } },
    { role: "patient", text: "Dale, quiero agendar una hora lo antes posible", expected: { commitment: true, buying: true, urgency: true } },
    { role: "agent",   text: "Perfecto! Te agendo para el próximo martes a las 10am ✅", expected: {} },
    { role: "patient", text: "Genial, gracias, nos vemos! ❤️", expected: { commitment: true, positive: true } },
  ];

  console.log("  Patient journey simulation:\n");
  for (let i = 0; i < journey.length; i++) {
    const step = journey[i];
    const result = await analyzeMessage(step.text, mockGetEmojiSentimentBatch);
    const signals = result.detectedSignals;

    console.log(`  [${i + 1}] ${step.role.toUpperCase()}: "${step.text}"`);
    console.log(`      sentiment=${result.textSentimentScore}, emoji_avg=${result.emojiSentimentAvg?.toFixed(3) ?? "null"}, signals=${JSON.stringify(signals)}, question=${result.hasQuestion}`);

    if (step.expected.buying) {
      assert(signals.includes("buying_signal"), `Journey step ${i + 1}: buying signal detected`, `got ${JSON.stringify(signals)}`);
    }
    if (step.expected.objection) {
      assert(signals.includes("objection_signal"), `Journey step ${i + 1}: objection signal detected`, `got ${JSON.stringify(signals)}`);
    }
    if (step.expected.commitment) {
      assert(signals.includes("commitment_signal"), `Journey step ${i + 1}: commitment signal detected`, `got ${JSON.stringify(signals)}`);
    }
    if (step.expected.referral) {
      assert(signals.includes("referral_signal"), `Journey step ${i + 1}: referral signal detected`, `got ${JSON.stringify(signals)}`);
    }
    if (step.expected.urgency) {
      assert(signals.includes("urgency_signal"), `Journey step ${i + 1}: urgency signal detected`, `got ${JSON.stringify(signals)}`);
    }
    if (step.expected.negative) {
      assert(result.textSentimentScore < 0 || (result.emojiSentimentAvg !== null && result.emojiSentimentAvg < 0),
        `Journey step ${i + 1}: negative sentiment detected`,
        `text=${result.textSentimentScore}, emoji=${result.emojiSentimentAvg?.toFixed(3)}`);
    }
    if (step.expected.positive) {
      assert(result.textSentimentScore > 0 || (result.emojiSentimentAvg !== null && result.emojiSentimentAvg > 0),
        `Journey step ${i + 1}: positive sentiment detected`,
        `text=${result.textSentimentScore}, emoji=${result.emojiSentimentAvg?.toFixed(3)}`);
    }
  }
}

// ── Run all tests ──
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     SENTIMENT KPI VALIDATION — analysis/sentiment.js       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  await testTextSentiment();
  await testEmojiSentiment();
  await testSignalDetection();
  await testQuestionDetection();
  await testWordCount();
  await testEdgeCases();
  await testRealisticConversations();

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);

  if (failures.length > 0) {
    console.log("\n  FAILURES:");
    for (const f of failures) {
      console.log(`    - ${f.testName}${f.detail ? ": " + f.detail : ""}`);
    }
  }

  console.log("\n  KNOWN LIMITATIONS (remaining after fixes):");
  console.log("    1. No negation handling ('no estoy feliz' scores positive)");
  console.log("    2. 'listo'/'vamos' trigger commitment in casual contexts");
  console.log("    3. Medical terms like 'dolor'/'problema' always count negative");
  console.log("    4. No contextual weighting or multi-word phrase sentiment");
  console.log("══════════════════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
