/**
 * analysis/sentiment-llm.js — Claude Haiku 4.5 sentiment classifier with
 * prompt caching and few-shot from gold samples.
 *
 * Exports classifyWithLLM(text, getGoldSamples) → { score, confidence, label, rationale, model }
 * Falls back to null if LLM unavailable (caller uses keyword fallback).
 */
import { getAnthropicClient } from "./anthropic-client.js";

const MODEL = process.env.SENTIMENT_LLM_MODEL || "claude-haiku-4-5-20251001";
const TIMEOUT_MS = parseInt(process.env.SENTIMENT_LLM_TIMEOUT_MS) || 3000;
const FEWSHOT_SIZE = parseInt(process.env.SENTIMENT_FEWSHOT_SIZE) || 15;

const SYSTEM_PROMPT = `Eres un clasificador de sentimiento para mensajes de pacientes y agentes de una clínica de cirugía en Chile.

TAREA: Clasifica el sentimiento del mensaje en una de tres categorías: positive, neutral, negative.

REGLAS:
- Considera el contexto clínico (consultas médicas, agendamiento, costos).
- Maneja modismos chilenos: "bacán", "penca", "fome", "po", "cachai".
- Detecta NEGACIÓN: "no es malo" = positive, "no me gustó" = negative.
- Detecta SARCASMO leve: "qué maravilla, otra vez lo mismo" = negative.
- Mensajes informativos sin carga emocional = neutral.
- Saludos simples ("hola", "buenos días") = neutral.

Responde SOLO con JSON válido:
{
  "label": "positive" | "neutral" | "negative",
  "score": -1.0 a 1.0,
  "confidence": 0.0 a 1.0,
  "rationale": "una frase corta explicando por qué"
}`;

let cachedGoldSamples = null;
let cachedGoldTimestamp = 0;
const GOLD_CACHE_TTL_MS = 5 * 60 * 1000;

async function getGoldFewShot(getGoldSamples) {
  if (!getGoldSamples) return "";
  const now = Date.now();
  if (cachedGoldSamples && (now - cachedGoldTimestamp) < GOLD_CACHE_TTL_MS) {
    return cachedGoldSamples;
  }
  try {
    const samples = await getGoldSamples(FEWSHOT_SIZE);
    if (!samples || samples.length === 0) {
      cachedGoldSamples = "";
      cachedGoldTimestamp = now;
      return "";
    }
    const lines = samples.map((s) =>
      `Mensaje: "${s.body}"\n→ ${JSON.stringify({ label: s.human_label, score: parseFloat(s.human_score ?? s.predicted_score), rationale: s.rationale || "" })}`
    ).join("\n\n");
    cachedGoldSamples = `\n\nEJEMPLOS DE REFERENCIA (clasificaciones confirmadas):\n${lines}`;
    cachedGoldTimestamp = now;
    return cachedGoldSamples;
  } catch {
    return "";
  }
}

export async function classifyWithLLM(text, getGoldSamples) {
  const client = getAnthropicClient();
  if (!client) return null;
  if (!text || text.trim().length === 0) return null;

  const fewShot = await getGoldFewShot(getGoldSamples);

  const systemContent = SYSTEM_PROMPT + fewShot;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      temperature: 0.1,
      system: [
        {
          type: "text",
          text: systemContent,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: `Clasifica el sentimiento:\n"${text}"` },
      ],
    }, { signal: controller.signal });

    clearTimeout(timeout);

    const raw = response.content?.[0]?.text;
    if (!raw) return null;

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score: Math.max(-1, Math.min(1, parseFloat(parsed.score) || 0)),
      confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.5)),
      label: parsed.label || "neutral",
      rationale: parsed.rationale || null,
      model: MODEL,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name !== "AbortError") {
      console.error(`[sentiment-llm] Error: ${err.message}`);
    }
    return null;
  }
}
