import express from "express";

const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.send("Clinyco AI OK");
});

function cleanIncomingMessage(message = "", requesterName = "") {
  let text = String(message || "").trim();

  if (requesterName) {
    const escaped = requesterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped}\\s*`, "i");
    text = text.replace(regex, "").trim();
  }

  text = text.replace(/⌘/g, "").trim();
  text = text.replace(/\[\[AI_SENT\]\]/g, "").trim();

  return text;
}

async function askOpenAI(message) {
  const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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

Reglas de estilo:
- responde corto
- tono humano y cercano
- no sonar como robot
- máximo 2 frases por mensaje
- hacer 1 sola pregunta a la vez
- no usar párrafos largos
- hablar simple y amable
- evitar frases demasiado formales
- evitar frases como "para brindarte más información"

Reglas generales:
- tu objetivo es orientar, filtrar y ayudar a avanzar la conversación
- si el paciente muestra interés real, intenta moverlo al siguiente paso
- si el paciente quiere avanzar, agendar, cotizar o resolver su caso, pedir teléfono
- si no sabes algo, di que un asesor lo confirmará
- nunca inventar precios
- nunca inventar disponibilidad exacta
- nunca dar diagnósticos médicos
- nunca reemplazar a un médico
- no saludes de nuevo si ya hay contexto en la conversación

Reglas de cirugía:
- si preguntan por cirugía, preguntar primero si es Fonasa o Isapre
- si preguntan por bariátrica, después de previsión pedir peso y estatura
- si preguntan por colecistectomía o vesícula, preguntar primero si es Fonasa o Isapre
- si preguntan por balón gástrico, preguntar primero si es Fonasa o Isapre
- si preguntan por PAD o Fonasa, explicar breve y luego preguntar qué cirugía le interesa
- si preguntan por precio de cirugía, no inventar precio; primero preguntar si es Fonasa o Isapre

Reglas de endoscopía:
- la endoscopía solo se realiza en Antofagasta
- si preguntan por endoscopía, indicar primero que solo se realiza en Antofagasta
- luego preguntar si quiere agendar, saber el valor o resolver dudas de preparación

Reglas de agenda médica:
- la agenda médica completa solo está disponible en Antofagasta
- en Santiago, por ahora, solo hay telemedicina
- si preguntan por agenda médica en Santiago, informar que solo está disponible telemedicina
- si preguntan por agenda médica general, preguntar especialidad o ciudad solo cuando sea necesario

Reglas Dr. Rodrigo Villagran:
- si el paciente menciona "Dr Rodrigo Villagran", "Rodrigo Villagran" o "Villagran", asumir que quiere agendar con él
- el Dr. Rodrigo Villagran atiende presencialmente en Antofagasta
- el Dr. Rodrigo Villagran atiende presencialmente en Calama en DiagnoSalud, Av. Granaderos #1483
- en Santiago, el Dr. Rodrigo Villagran atiende solo por telemedicina
- las cirugías en Santiago con el Dr. Rodrigo Villagran se realizan en Clínica Tabancura, RedSalud Vitacura
- si preguntan por agenda con el Dr. Rodrigo Villagran, preguntar primero si prefiere Antofagasta, Calama o telemedicina en Santiago
- no preguntar Fonasa o Isapre en ese caso hasta después

Reglas de Calama:
- en Calama las consultas presenciales con cirujanos se realizan en DiagnoSalud
- la dirección es Av. Granaderos #1483, Calama
- en Calama hay atención presencial con el Dr. Rodrigo Villagran y el Dr. Nelson Aros

Reglas de resultados:
- si preguntan por resultados, pedir nombre completo o RUT

Ejemplos de tono:
- "claro 🙂 ¿eres Fonasa o Isapre?"
- "sí, la endoscopía la realizamos solo en Antofagasta 🙂 ¿quieres agendar, saber el valor o tienes dudas de preparación?"
- "claro 🙂 el dr rodrigo villagran atiende en Antofagasta, en Calama en DiagnoSalud y en Santiago por telemedicina. ¿qué opción prefieres?"
- "si quieres te podemos orientar mejor por whatsapp 🙂 ¿me dejas tu numero?"
`
        },
        {
          role: "user",
          content: message
        }
      ]
    })
  });

  const raw = await openaiResponse.text();
  console.log("OpenAI response raw:", raw);

  if (!openaiResponse.ok) {
    throw new Error(`OpenAI request failed: ${raw}`);
  }

  const data = JSON.parse(raw);
  return data?.choices?.[0]?.message?.content || "Gracias por escribirnos.";
}

async function postReplyToZendesk(ticketId, reply) {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const email = process.env.ZENDESK_EMAIL;
  const apiToken = process.env.ZENDESK_API_TOKEN;

  const auth = Buffer.from(`${email}/token:${apiToken}`).toString("base64");

  const response = await fetch(
    `https://${subdomain}.zendesk.com/api/v2/tickets/${ticketId}.json`,
    {
      method: "PUT",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ticket: {
          comment: {
            public: true,
            body: reply
          }
        }
      })
    }
  );

  const raw = await response.text();
  console.log("Zendesk update raw:", raw);

  if (!response.ok) {
    throw new Error(`Zendesk update failed: ${raw}`);
  }
}

app.post("/zendesk-ai", async (req, res) => {
  try {
    const ticketId = req.body?.ticket_id;
    const requesterName = req.body?.requester_name || "";
    const rawMessage = req.body?.message || "";

    console.log("Ticket ID:", ticketId);
    console.log("Mensaje recibido:", rawMessage);

    if (!ticketId || !rawMessage) {
      return res.status(400).json({
        ok: false,
        error: "Faltan ticket_id o message"
      });
    }

    // Evitar loop: si ya es mensaje de la IA, salir
    if (rawMessage.includes("⌘")) {
      console.log("Loop evitado por marcador ⌘");
      return res.json({ ok: true, skipped: "ai_message" });
    }

    // Ignorar texto automático de creación de ticket
    if (
      rawMessage.startsWith("Conversation with ") ||
      rawMessage.startsWith("Conversación con ")
    ) {
      console.log("Ignorado texto automático de creación de ticket");
      return res.json({ ok: true, skipped: "auto_subject" });
    }

    const message = cleanIncomingMessage(rawMessage, requesterName);

    if (!message) {
      console.log("Mensaje vacío después de limpieza");
      return res.json({ ok: true, skipped: "empty_after_clean" });
    }

    const rawReply = await askOpenAI(message);
    const reply = `${rawReply} ⌘`;

    await postReplyToZendesk(ticketId, reply);

    return res.json({
      ok: true,
      reply
    });
  } catch (error) {
    console.error("ERROR /zendesk-ai:", error.message);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.use((err, req, res, next) => {
  console.error("Invalid JSON:", err.message);
  res.status(400).json({
    ok: false,
    error: "Invalid JSON"
  });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Clinyco AI running on port ${PORT}`);
});
