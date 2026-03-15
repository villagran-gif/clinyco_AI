import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

// =========================
// In-memory state
// =========================
const conversationMemory = new Map();
const aiStateByConversation = new Map();

// =========================
// Helpers
// =========================
function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHistory(conversationId) {
  if (!conversationMemory.has(conversationId)) {
    conversationMemory.set(conversationId, []);
  }
  return conversationMemory.get(conversationId);
}

function addToHistory(conversationId, role, content) {
  const history = getHistory(conversationId);

  history.push({
    role,
    content: String(content || "").trim()
  });

  const MAX_MESSAGES = 12;
  if (history.length > MAX_MESSAGES) {
    history.splice(0, history.length - MAX_MESSAGES);
  }
}

function getConversationState(conversationId) {
  if (!aiStateByConversation.has(conversationId)) {
    aiStateByConversation.set(conversationId, {
      aiEnabled: true,
      humanTakenOver: false,
      assigneeId: null
    });
  }
  return aiStateByConversation.get(conversationId);
}

function calculateHumanDelay(text) {
  const cleanText = String(text || "").trim();
  if (!cleanText) return 1000;

  const chars = cleanText.length;

  let delay = 700 + chars * 18 + Math.floor(Math.random() * 700);

  if (chars < 25) delay += 150;
  if (chars > 120) delay += 400;

  delay = Math.max(900, delay);
  delay = Math.min(delay, 4500);

  return delay;
}

function extractConversationInfo(payload) {
  const appId =
    payload?.app?.id ||
    payload?.app?._id ||
    payload?.appId ||
    process.env.SUNCO_APP_ID ||
    null;

  const event = Array.isArray(payload?.events) ? payload.events[0] : null;
  const eventPayload = event?.payload || {};
  const message = eventPayload?.message || payload?.message || null;
  const source = message?.source || {};

  const conversationId =
    eventPayload?.conversation?.id ||
    eventPayload?.conversation?._id ||
    payload?.conversation?.id ||
    payload?.conversation?._id ||
    null;

  let userText = "";

  if (
    message?.author?.type === "user" &&
    message?.content?.type === "text"
  ) {
    userText = message?.content?.text || "";
  }

  return {
    appId,
    conversationId,
    userText: String(userText || "").trim(),
    eventType: event?.type || null,
    authorType: message?.author?.type || null,
    messageId: message?.id || null,
    sourceType: source?.type || null
  };
}

// =========================
// OpenAI
// =========================
async function askOpenAI(conversationId) {
  const history = getHistory(conversationId);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Eres Antonia, asistente de Clinyco.

Objetivo:
- guiar al paciente para calificarlo y acercarlo a evaluación o agendamiento
- no repetir preguntas ya respondidas
- avanzar paso a paso
- máximo 2 frases
- hacer solo 1 pregunta a la vez
- sonar humana, cercana y natural
- responder en español chileno neutral, profesional y cálido

Datos importantes:
- Clinyco tiene presencia en Antofagasta, Calama y Santiago
- Servicios principales:
  - cirugía bariátrica
  - colecistectomía
  - balón gástrico
  - cirugía plástica
  - endoscopía
  - agenda médica
  - resultados de examen
  - telemedicina
- Endoscopía solo en Antofagasta
- La agenda médica completa está disponible en Antofagasta
- En Santiago por ahora solo hay telemedicina
- En Calama las consultas presenciales con cirujanos se realizan en DiagnoSalud, Av. Granaderos #1483
- El Dr. Rodrigo Villagran atiende en Antofagasta, Calama y Santiago por telemedicina
- Las cirugías en Santiago con el Dr. Rodrigo Villagran se realizan en Clínica Tabancura, RedSalud Vitacura

Reglas de conversación:
- si preguntan por cirugía y aún no se sabe la previsión, preguntar si es Fonasa o Isapre
- si es bariátrica y ya sabemos previsión, pedir peso y estatura
- si quiere avanzar, cotizar, agendar o resolver su caso, pedir teléfono
- no repetir preguntas ya contestadas en el historial
- si ya sabemos previsión, no volver a preguntarla
- si ya sabemos cirugía de interés, avanzar a la siguiente pregunta útil
- si el usuario solo responde con una palabra, interpretar usando el contexto del historial
- cuando ya entregó teléfono, cerrar cordialmente y decir que cuando ya entregó teléfono, cerrar cordialmente y decir que el equipo lo contactará
- no prometer acciones que no estén automatizadas, salvo que el equipo lo contactará

No inventes precios.
No des diagnósticos médicos.
No digas que eres una IA.
`
        },
        ...history
      ]
    })
  });

  const raw = await response.text();
  console.log("OpenAI raw:", raw);

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${raw}`);
  }

  const data = JSON.parse(raw);
  return data?.choices?.[0]?.message?.content?.trim() || "Gracias por escribirnos.";
}

// =========================
// Sunshine Conversations send
// =========================
async function sendConversationReply(appId, conversationId, reply) {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const keyId = process.env.SUNCO_KEY_ID;
  const keySecret = process.env.SUNCO_KEY_SECRET;

  if (!subdomain || !keyId || !keySecret) {
    throw new Error("Missing ZENDESK_SUBDOMAIN or SUNCO credentials");
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  const response = await fetch(
    `https://${subdomain}.zendesk.com/sc/v2/apps/${appId}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        author: {
          type: "business"
        },
        content: {
          type: "text",
          text: reply
        }
      })
    }
  );

  const raw = await response.text();
  console.log("Conversations send raw:", raw);

  if (!response.ok) {
    throw new Error(`Conversations send failed: ${raw}`);
  }

  return JSON.parse(raw);
}

// =========================
// Health check
// =========================
app.get("/", (req, res) => {
  res.send("Clinyco Conversations AI OK");
});

// =========================
// Human takeover webhook
// =========================
app.post("/ticket-assigned", (req, res) => {
  try {
    console.log("===== /ticket-assigned webhook =====");
    console.log("Body:", safeJson(req.body));

    const { event, conversation_id, assignee_id } = req.body || {};

    if (!conversation_id) {
      return res.status(400).json({
        ok: false,
        error: "Missing conversation_id"
      });
    }

    const state = getConversationState(conversation_id);
    state.aiEnabled = false;
    state.humanTakenOver = true;
    state.assigneeId = assignee_id || null;

    console.log("AI disabled for conversation:", conversation_id);
    console.log("Conversation state:", safeJson(state));

    return res.json({
      ok: true,
      event: event || "human_takeover",
      conversation_id,
      aiEnabled: state.aiEnabled
    });
  } catch (error) {
    console.error("ERROR /ticket-assigned:", error.message);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// =========================
// Main messaging webhook
// =========================
app.post("/messages", async (req, res) => {
  try {
    console.log("===== /messages webhook =====");
    console.log("Headers:", safeJson(req.headers));
    console.log("Body:", safeJson(req.body));

    const {
      appId,
      conversationId,
      userText,
      eventType,
      authorType,
      messageId,
      sourceType
    } = extractConversationInfo(req.body);

    console.log("Extracted appId:", appId);
    console.log("Extracted conversationId:", conversationId);
    console.log("Extracted userText:", userText);
    console.log("Extracted eventType:", eventType);
    console.log("Extracted authorType:", authorType);
    console.log("Extracted messageId:", messageId);
    console.log("Extracted sourceType:", sourceType);

    if (eventType !== "conversation:message") {
      return res.json({
        ok: true,
        skipped: "non_message_event"
      });
    }

    if (!conversationId) {
      return res.status(400).json({
        ok: false,
        error: "Missing conversationId"
      });
    }

    // Inicializa estado de conversación
    const state = getConversationState(conversationId);

    // Si ya la tomó un humano, bloquear IA para cualquier mensaje nuevo
    if (!state.aiEnabled) {
      console.log("AI blocked: human takeover active for", conversationId);

      return res.json({
        ok: true,
        skipped: "human_takeover_active"
      });
    }

    // Ignorar mensajes business del bot o de Zendesk
    if (authorType !== "user") {
      return res.json({
        ok: true,
        skipped: "non_user_message"
      });
    }

    if (!appId || !userText) {
      return res.json({
        ok: true,
        skipped: "payload_not_parsed_yet"
      });
    }

    addToHistory(conversationId, "user", userText);

    console.log("Conversation history:", safeJson(getHistory(conversationId)));
    console.log("Conversation state:", safeJson(state));

    const reply = await askOpenAI(conversationId);

    addToHistory(conversationId, "assistant", reply);

    const delayMs = calculateHumanDelay(reply);
    console.log("Human delay ms:", delayMs);

    await sleep(delayMs);

    // Re-chequea por si un humano tomó la conversación durante el delay
    const latestState = getConversationState(conversationId);
    if (!latestState.aiEnabled) {
      console.log("AI send cancelled after delay due to human takeover:", conversationId);

      return res.json({
        ok: true,
        skipped: "human_takeover_after_delay"
      });
    }

    await sendConversationReply(appId, conversationId, reply);

    return res.json({
      ok: true,
      reply,
      delayMs
    });
  } catch (error) {
    console.error("ERROR /messages:", error.message);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// =========================
// Server start
// =========================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Clinyco Conversations AI running on port ${PORT}`);
});
