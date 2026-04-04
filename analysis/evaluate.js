/**
 * analysis/evaluate.js — Unified evaluation module using Claude Opus.
 *
 * Evaluates EVERY message across 7 dimensions:
 * 1. Intent comparison (EugenIA predict vs agent action)
 * 2. Message Quality Score (Rita et al. 2026 + Gikko 2026)
 * 3. Patient emotional state (Patient State Engine)
 * 4. Antonia (bot) quality evaluation
 * 5. Handoff quality (Antonia → Agent transition)
 * 6. Sales signal classification
 * 7. Clinical vs commercial boundary detection
 *
 * Cost: ~$15-20/month with Opus at current volume.
 *
 * References:
 * - Zheng et al. 2023 — MT-Bench / LLM-as-a-Judge (NeurIPS)
 * - Liu et al. 2023 — G-Eval (EMNLP)
 * - Wei et al. 2025 — Systematic Evaluation of LLM-as-a-Judge (ICLR)
 * - Gu et al. 2025 — Survey on LLM-as-a-Judge (The Innovation)
 * - Rita et al. 2026 — Information Quality β=0.409, Problem Solving β=0.315, Understanding β=0.173
 * - Gikko 2026 — Message clarity, timing, consistency, professionalism
 * - Novak et al. 2015 — Emoji Sentiment Ranking (PLOS ONE)
 * - Rafailov et al. 2023 — DPO (NeurIPS)
 * - Scissors et al. 2008 — Linguistic mimicry (CSCW)
 *
 * Bias mitigations (per Wei et al. 2025, Gu et al. 2025):
 * - Content shuffling: randomize order of prediction vs actual
 * - Structured JSON output: prevent verbosity bias
 * - Criteria decomposition: evaluate each dimension independently
 * - Explanatory evaluation: require reasoning before verdict
 * - Temperature 0.1: minimize flipping noise
 */

import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-opus-4-6";
const TEMPERATURE = 0.1;
const MAX_TOKENS = 1500;

let client = null;

function getClient() {
  if (!client && ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return client;
}

// ── System prompt ──
const SYSTEM_PROMPT = `Eres el módulo de evaluación integral de Clinyco, una plataforma de conversational intelligence para healthcare high-ticket en Chile.

Clinyco opera con DOS IAs simultáneamente:
- **Antonia**: Bot que conversa directamente con pacientes vía WhatsApp/Zendesk. Recopila datos, responde preguntas, deriva cuando es necesario.
- **EugenIA**: IA interna que OBSERVA a los agentes humanos, PREDICE qué deberían hacer, COMPARA con lo que realmente hicieron, y APRENDE de los desvíos valiosos.

Tu tarea es evaluar CADA mensaje en 7 dimensiones independientes. Evalúa cada dimensión POR SEPARADO antes de dar un juicio final.

═══════════════════════════════════════
PIPELINES QUE OPERA CLINYCO:
═══════════════════════════════════════
- Cirugía Bariátrica (manga, bypass) — alto componente emocional, miedo, vergüenza corporal
- Balones gástricos (Allurion, Orbera) — menos invasivo, objeciones de efectividad
- Cirugía Plástica — estética, autoestima, comparación con competencia
- Cirugía General — procedimientos electivos varios

═══════════════════════════════════════
DIMENSIÓN 1: COMPARACIÓN DE INTENCIÓN (EugenIA)
═══════════════════════════════════════
Solo aplica cuando hay una predicción de EugenIA para comparar.

PROCESO (Chain-of-Thought, Liu et al. 2023 G-Eval):
1. EXTRAER: ¿Cuál es la intención de la acción sugerida por EugenIA?
2. EXTRAER: ¿Cuál es la intención del mensaje real del agente?
3. COMPARAR: ¿Qué comparten?
4. CONTRASTAR: ¿Qué difiere?
5. CONTEXTUALIZAR: ¿Las diferencias son superficiales o de fondo?

ESCALA (0-4, inspirada en Rafailov et al. 2023 DPO):
0 = INCOMPATIBLE — intenciones opuestas o contraproducentes
1 = IRRELEVANTE — sin relación entre predicción y acción
2 = PARCIALMENTE ALINEADO — comparten algo pero divergen en lo central
3 = ALINEADO — misma intención central, diferencias superficiales
4 = SUPERIOR — el agente hizo algo mejor que la predicción de EugenIA

REGLAS (Gu et al. 2025 bias mitigation):
- Diferencias de redacción, tono o formalidad NO son diferencias de intención
- Una versión más específica = ALINEADO (3)
- Si el agente hace lo sugerido MÁS algo valioso = SUPERIOR (4)
- No favorecer mensajes largos sobre cortos (verbosity bias)
- No favorecer la predicción por aparecer primero (position bias)

═══════════════════════════════════════
DIMENSIÓN 2: MESSAGE QUALITY SCORE (MQS)
═══════════════════════════════════════
Aplica a TODOS los mensajes (bot Antonia + agente humano).
Basado en Rita et al. 2026 (ScienceDirect) + Gikko 2026.

Evalúa cada subdimensión de 0 a 1:
- information_quality (β=0.409): ¿La info es precisa, relevante, suficiente y útil?
- problem_solving (β=0.315): ¿Avanza hacia resolver lo que el paciente necesita?
- understanding (β=0.173): ¿Comprendió lo que el paciente quiso decir?
- clarity: ¿El mensaje es claro, sin ambigüedades, legible?
- timing_appropriateness: ¿El contenido es oportuno para este momento del journey?

composite = 0.40*information_quality + 0.30*problem_solving + 0.17*understanding + 0.13*clarity

═══════════════════════════════════════
DIMENSIÓN 3: ESTADO EMOCIONAL DEL PACIENTE (Patient State Engine)
═══════════════════════════════════════
Solo aplica a mensajes DEL PACIENTE.
No reducir a positivo/negativo. Evaluar estados específicos:

- confianza (0-1): ¿Confía en Clinyco/agente?
- miedo (0-1): ¿Tiene miedo al procedimiento?
- vergüenza (0-1): ¿Siente vergüenza por su cuerpo/situación?
- urgencia (0-1): ¿Necesita resolver rápido?
- confusion (0-1): ¿No entiende el proceso/pasos?
- frustracion (0-1): ¿Está molesto con la atención?
- motivacion (0-1): ¿Está motivado para avanzar?
- compromiso (0-1): ¿Está listo para el siguiente paso?
- sensibilidad_precio (0-1): ¿El precio es una barrera?
- readiness (0-1): ¿Está listo para decidir?

═══════════════════════════════════════
DIMENSIÓN 4: EVALUACIÓN DE ANTONIA (Bot)
═══════════════════════════════════════
Solo aplica a mensajes DEL BOT (role=assistant, author=Antonia).

- adherence_to_protocol: ¿Siguió el flujo correcto?
- empathy_level: ¿Fue empática sin ser condescendiente?
- data_collection_efficiency: ¿Recopiló datos sin ser intrusiva?
- escalation_correctness: ¿Debió escalar y no lo hizo? ¿Escaló innecesariamente?
- handoff_quality: Si derivó, ¿entregó buen contexto al agente?

═══════════════════════════════════════
DIMENSIÓN 5: CALIDAD DEL HANDOFF
═══════════════════════════════════════
Solo aplica en la transición Antonia → Agente humano.

- context_transferred: ¿El agente tiene suficiente contexto del paciente?
- patient_sentiment_at_handoff: ¿Cómo estaba el paciente cuando llegó el humano?
- continuity: ¿El agente retomó sin hacer repetir datos?

═══════════════════════════════════════
DIMENSIÓN 6: CLASIFICACIÓN DE SEÑALES
═══════════════════════════════════════
Para CADA mensaje, clasificar señales presentes:

Señales del PACIENTE:
- buying_signal: "me interesa", "cuánto cuesta", "quiero agendar"
- objection: "es muy caro", "me da miedo", "lo voy a pensar"
- commitment: "dale", "listo", "perfecto", "confirmo"
- referral: "me recomendaron", "mi doctor me dijo"
- urgency: "lo antes posible", "urgente", "esta semana"
- comparison: "en otra clínica me dijeron...", "vi en internet que..."
- family_involvement: "tengo que consultarlo con mi pareja/familia"
- financial_concern: "formas de pago", "cuotas", "Fonasa", "Isapre"

Señales del AGENTE:
- discovery: pregunta para entender contexto
- qualification: evalúa si es candidato
- rapport: genera confianza, empatía
- education: explica procedimiento, proceso
- objection_handling: responde a una objeción
- next_step_proposal: propone acción siguiente
- closing: intenta cerrar agenda/venta
- containment: contiene ansiedad/miedo
- escalation: deriva a clínico o superior

═══════════════════════════════════════
DIMENSIÓN 7: FRONTERA COMERCIAL / CLÍNICA
═══════════════════════════════════════
CRÍTICO para compliance en healthcare.

- is_clinical: ¿El mensaje toca temas clínicos (síntomas, diagnóstico, medicación)?
- is_commercial: ¿El mensaje toca temas comerciales (precio, agenda, financiamiento)?
- boundary_risk: ¿Se está cruzando la frontera? (agente comercial dando consejo clínico)
- escalation_needed: ¿Debería derivarse a un profesional de salud?

═══════════════════════════════════════
ESPAÑOL CHILENO — GUARDRAILS LINGÜÍSTICOS
═══════════════════════════════════════
(Wei et al. 2025: prompt template matters significantly)

- "po", "poh", "cachai", "altiro", "bacán", "fome", "penca" son modismos, no cambian intención
- "usted" vs "tú" es formalidad, no intención diferente
- Diminutivos (-ito/-ita) son rapport, no modifican intención
- "Es que..." precede al punto real — no tratar como intención separada
- "Sí po" = afirmación, no duda
- En ventas médicas chilenas, el rapport indirecto ES la estrategia comercial
- "Me tinca" = "me interesa/parece bien" (buying signal)
- "Ya po, dale" = commitment fuerte
- "Fonasa tramo A/B/C/D" y "Isapre" son previsiones de salud chilenas
- RUT = identificación única chilena (formato XX.XXX.XXX-X)

═══════════════════════════════════════
FORMATO DE RESPUESTA
═══════════════════════════════════════
Responde SOLO en JSON válido. Sin texto adicional.
Incluye SOLO las dimensiones que aplican al mensaje evaluado.`;

// ── User prompt builder ──
function buildUserPrompt({
  message,
  role,
  authorName,
  conversationHistory,
  pipeline,
  pipelinePhase,
  leadScore,
  eugeniaQuestion,
  eugeniaAction,
  isHandoff,
  previousMessages,
}) {
  // Bias mitigation: randomize order of prediction vs actual (Wei et al. 2025)
  const showPredictionFirst = Math.random() > 0.5;

  let prompt = `CONTEXTO DE CONVERSACIÓN:\n`;
  if (pipeline) prompt += `Pipeline: ${pipeline}\n`;
  if (pipelinePhase) prompt += `Fase: ${pipelinePhase}\n`;
  if (leadScore != null) prompt += `Lead Score: ${leadScore}\n`;
  prompt += `\n`;

  if (previousMessages?.length) {
    prompt += `HISTORIAL RECIENTE (últimos ${previousMessages.length} mensajes):\n`;
    for (const pm of previousMessages) {
      const r = pm.role === "user" ? "PACIENTE" : pm.role === "assistant" ? "ANTONIA" : "AGENTE";
      prompt += `[${r}]: ${(pm.content || "").slice(0, 200)}\n`;
    }
    prompt += `\n`;
  }

  prompt += `MENSAJE A EVALUAR:\n`;
  prompt += `Rol: ${role === "user" ? "PACIENTE" : role === "assistant" ? "ANTONIA (bot)" : "AGENTE HUMANO"}\n`;
  if (authorName) prompt += `Autor: ${authorName}\n`;
  prompt += `Texto: "${message}"\n\n`;

  if (eugeniaAction || eugeniaQuestion) {
    prompt += `PREDICCIÓN DE EUGENIA:\n`;
    if (showPredictionFirst) {
      if (eugeniaAction) prompt += `Acción sugerida: "${eugeniaAction}"\n`;
      if (eugeniaQuestion) prompt += `Pregunta sugerida: "${eugeniaQuestion}"\n`;
    } else {
      if (eugeniaQuestion) prompt += `Pregunta sugerida: "${eugeniaQuestion}"\n`;
      if (eugeniaAction) prompt += `Acción sugerida: "${eugeniaAction}"\n`;
    }
    prompt += `\n`;
  }

  if (isHandoff) {
    prompt += `NOTA: Este mensaje ocurre en la TRANSICIÓN Antonia→Agente humano. Evaluar calidad del handoff.\n\n`;
  }

  prompt += `Evalúa este mensaje en TODAS las dimensiones que apliquen. Responde SOLO en JSON:\n`;
  prompt += `{
  "intent_comparison": {                    // SOLO si hay predicción de EugenIA
    "intent_sugerida": "...",
    "intent_real": "...",
    "score": 0-4,
    "verdict": "INCOMPATIBLE|IRRELEVANTE|PARCIAL|ALINEADO|SUPERIOR",
    "confidence": 0.0-1.0,
    "reasoning": "...",
    "categoria_agente": "DISCOVERY|QUALIFICATION|RAPPORT|EDUCATION|OBJECTION_HANDLING|NEXT_STEP|CLOSING|CONTAINMENT|ESCALATION|OTHER"
  },
  "mqs": {                                 // SIEMPRE para mensajes de agente o bot
    "information_quality": 0.0-1.0,
    "problem_solving": 0.0-1.0,
    "understanding": 0.0-1.0,
    "clarity": 0.0-1.0,
    "timing_appropriateness": 0.0-1.0,
    "composite": 0.0-1.0,
    "reasoning": "..."
  },
  "patient_state": {                        // SOLO para mensajes del PACIENTE
    "confianza": 0.0-1.0,
    "miedo": 0.0-1.0,
    "vergüenza": 0.0-1.0,
    "urgencia": 0.0-1.0,
    "confusion": 0.0-1.0,
    "frustracion": 0.0-1.0,
    "motivacion": 0.0-1.0,
    "compromiso": 0.0-1.0,
    "sensibilidad_precio": 0.0-1.0,
    "readiness": 0.0-1.0,
    "estado_dominante": "...",
    "reasoning": "..."
  },
  "antonia_eval": {                         // SOLO para mensajes de ANTONIA (bot)
    "adherence_to_protocol": 0.0-1.0,
    "empathy_level": 0.0-1.0,
    "data_collection_efficiency": 0.0-1.0,
    "escalation_correctness": 0.0-1.0,
    "reasoning": "..."
  },
  "handoff_quality": {                      // SOLO en transición Antonia→Agente
    "context_transferred": 0.0-1.0,
    "patient_sentiment_at_handoff": "...",
    "continuity": 0.0-1.0,
    "reasoning": "..."
  },
  "signals": {                              // SIEMPRE
    "patient_signals": ["buying_signal", "objection", ...],
    "agent_signals": ["discovery", "rapport", ...],
    "pipeline_detected": "bariatrica|balones|plastica|general|unknown"
  },
  "boundary": {                             // SIEMPRE
    "is_clinical": true/false,
    "is_commercial": true/false,
    "boundary_risk": "none|low|medium|high",
    "escalation_needed": true/false,
    "reasoning": "..."
  }
}`;

  return prompt;
}

/**
 * Evaluate a single message using Claude Opus.
 * Returns the structured evaluation or null if API unavailable.
 */
export async function evaluateMessage({
  message,
  role,
  authorName = null,
  conversationHistory = null,
  pipeline = null,
  pipelinePhase = null,
  leadScore = null,
  eugeniaQuestion = null,
  eugeniaAction = null,
  isHandoff = false,
  previousMessages = [],
}) {
  const anthropic = getClient();
  if (!anthropic) return null;

  const userPrompt = buildUserPrompt({
    message,
    role,
    authorName,
    conversationHistory,
    pipeline,
    pipelinePhase,
    leadScore,
    eugeniaQuestion,
    eugeniaAction,
    isHandoff,
    previousMessages,
  });

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0]?.text || "";

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[evaluate] No JSON found in response");
      return null;
    }

    const evaluation = JSON.parse(jsonMatch[0]);
    evaluation._model = MODEL;
    evaluation._tokens = {
      input: response.usage?.input_tokens,
      output: response.usage?.output_tokens,
    };

    return evaluation;
  } catch (err) {
    console.error("[evaluate] Error:", err.message);
    return null;
  }
}

/**
 * Evaluate intent comparison only (lighter, for EugenIA predict-observe-compare).
 * Uses the same prompt but requests only intent_comparison dimension.
 */
export async function evaluateIntentOnly({
  predictedAction,
  predictedQuestion,
  actualMessage,
  conversationContext = null,
  pipeline = null,
  leadScore = null,
}) {
  return evaluateMessage({
    message: actualMessage,
    role: "business",
    eugeniaAction: predictedAction,
    eugeniaQuestion: predictedQuestion,
    pipeline,
    leadScore,
    previousMessages: conversationContext ? [{ role: "context", content: conversationContext }] : [],
  });
}
