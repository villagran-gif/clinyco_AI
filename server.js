import express from "express";
import fetch from "node-fetch";

const app = express();

app.use(express.json({ limit: "1mb" }));

// Ruta raíz para evitar errores GET /
app.get("/", (req, res) => {
  res.send("Clinyco AI OK");
});

app.post("/zendesk-ai", async (req, res) => {
  try {

    const message = req.body?.message || "";

    console.log("Mensaje recibido:", message);

    if (!message) {
      return res.json({
        reply: "¿En qué puedo ayudarte?"
      });
    }

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
Eres asistente de Clinyco.

Clinyco es un hub de cirugías en Chile con presencia en:
Antofagasta, Calama y Santiago.

Servicios principales:
- cirugía bariátrica
- colecistectomía
- balón gástrico
- cirugía plástica
- endoscopía
- agenda médica
- resultados de examen

Objetivo:
orientar pacientes que escriben por chat.

Reglas:
- responde corto
- tono humano y cercano
- evita sonar como robot
- máximo 2-3 frases

Si preguntan por cirugía:
pregunta previsión (Fonasa / Isapre).

Si preguntan por agenda médica:
pregunta especialidad o ciudad.

Si preguntan por exámenes:
pide nombre completo o RUT.

Nunca inventes precios ni diagnósticos médicos.
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
      throw new Error("OpenAI request failed");
    }

    const data = JSON.parse(raw);

    const reply =
      data?.choices?.[0]?.message?.content ||
      "Gracias por escribirnos.";

    res.json({ reply });

  } catch (error) {

    console.error("ERROR /zendesk-ai:", error.message);

    res.json({
      reply: "Gracias por escribir a Clinyco. Un asesor responderá en breve."
    });

  }
});

// Manejo de JSON inválido
app.use((err, req, res, next) => {
  console.error("Invalid JSON:", err.message);

  res.status(400).json({
    reply: "No pude leer el mensaje correctamente."
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Clinyco AI running on port ${PORT}`);
});
