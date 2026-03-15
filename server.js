import express from "express";

const app = express();

app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.send("Clinyco Conversations AI OK");
});

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function extractConversationInfo(payload) {
  // Variantes defensivas para distintos formatos
  const appId =
    payload?.app?._id ||
    payload?.app?.id ||
    payload?.appId ||
    process.env.SUNCO_APP_ID ||
    null;

  const conversationId =
    payload?.conversation?._id ||
    payload?.conversation?.id ||
    payload?.conversationId ||
    null;

  // Buscar mensaje de usuario final
  let userText = "";

  if (Array.isArray(payload?.messages) && payload.messages.length > 0) {
    const msg = payload.messages[0];
    if (
      (msg?.role === "appUser" || msg?.author?.type === "user") &&
      (msg?.type === "text" || msg?.content?.type === "text")
    ) {
      userText = msg?.text || msg?.content?.text || "";
    }
  }

  if (!userText && payload?.message) {
    const msg = payload.message;
    if (
      (msg?.role === "appUser" || msg?.author?.type === "user") &&
      (msg?.type === "text" || msg?.content?.type === "text")
    ) {
      userText = msg?.text || msg?.content?.text || "";
    }
  }

  return {
    appId,
    conversationId,
    userText: String(userText || "").trim()
  };
}

async function askOpenAI(message) {
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

Clinyco es un hub de cirugías en Chile con presencia en:
- Antofagasta
- Calama
- Santiago

Servicios principales:
- cirugía bariátrica
- colecistectomía
- balón gástrico
- cirugía plástica
- endoscopía
- agenda médica
- resultados de examen
- telemedicina

Reglas:
- responde corto
- tono humano y cercano
- no sonar como robot
- máximo 2 frases
- hacer 1 sola pregunta a la vez
- si preguntan por cirugía, preguntar primero si es Fonasa o Isapre
- si preguntan por bariátrica, después pedir peso y estatura
- la endoscopía solo se realiza en Antofagasta
- la agenda médica completa solo está disponible en Antofagasta
- en Santiago, por ahora, solo hay telemedicina
- en Calama las consultas presenciales con cirujanos se realizan en DiagnoSalud, Av. Granaderos #1483
- el Dr. Rodrigo Villagran atiende en Antofagasta, Calama y en Santiago por telemedicina
- las cirugías en Santiago con el Dr. Rodrigo Villagran se realizan en Clínica Tabancura, RedSalud Vitacura
- si el paciente quiere avanzar, agendar, cotizar o resolver su caso, pedir teléfono
- no inventes precios
- no des diagnósticos médicos
`
        },
        {
          role: "user",
          content: message
        }
      ]
    })
  });

  const raw = await response.text();
  console.log("OpenAI raw:", raw);

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${raw}`);
  }

  const data = JSON.parse(raw);
  return data?.choices?.[0]?.message?.content || "Gracias por escribirnos.";
}

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
}

app.post("/messages", async (req, res) => {
  try {
    console.log("===== /messages webhook =====");
    console.log("Headers:", safeJson(req.headers));
    console.log("Body:", safeJson(req.body));

    const { appId, conversationId, userText } = extractConversationInfo(req.body);

    console.log("Extracted appId:", appId);
    console.log("Extracted conversationId:", conversationId);
    console.log("Extracted userText:", userText);

    // Si todavía no sabemos leer el payload real, no fallar.
    if (!appId || !conversationId || !userText) {
      return res.json({
        ok: true,
        skipped: "payload_not_parsed_yet"
      });
    }

    const reply = await askOpenAI(userText);
    await sendConversationReply(appId, conversationId, reply);

    return res.json({
      ok: true,
      reply
    });
  } catch (error) {
    console.error("ERROR /messages:", error.message);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Clinyco Conversations AI running on port ${PORT}`);
});
