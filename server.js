import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.send("Clinyco AI OK");
});

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

Reglas de negocio:
- si preguntan por cirugía, preguntar primero si es Fonasa o Isapre
- si preguntan por bariátrica, después pedir peso y estatura
- la endoscopía solo se realiza en Antofagasta
- la agenda médica completa solo está disponible en Antofagasta
- en Santiago, por ahora, solo hay telemedicina
- en Calama las consultas presenciales con cirujanos se realizan en DiagnoSalud, Av. Granaderos #1483
- el Dr. Rodrigo Villagran atiende en Antofagasta, Calama y en Santiago por telemedicina
- las cirugías en Santiago con el Dr. Rodrigo Villagran se realizan en Clínica Tabancura, RedSalud Vitacura
- si el paciente quiere avanzar, agendar, cotizar o resolver su caso, pedir teléfono
- nunca inventar precios
- nunca dar diagnósticos médicos
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

  return raw;
}

app.post("/zendesk-ai", async (req, res) => {
  try {
    const ticketId = req.body?.ticket_id;
    const message = req.body?.message || "";

    console.log("Ticket ID:", ticketId);
    console.log("Mensaje recibido:", message);

    if (!ticketId || !message) {
      return res.status(400).json({
        ok: false,
        error: "Faltan ticket_id o message"
      });
    }

    const reply = await askOpenAI(message);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Clinyco AI running on port ${PORT}`);
});
