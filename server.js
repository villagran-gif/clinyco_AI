import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

app.post("/zendesk-ai", async (req, res) => {
  try {

    const message = req.body.message || "";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres asistente de Clinyco.

Clinyco es un hub de cirugías en Chile.

Servicios principales:
- cirugía bariátrica
- colecistectomía
- balón gástrico
- cirugía plástica
- endoscopía
- agenda médica

Si preguntan por cirugía:
pregunta previsión (Fonasa / Isapre).

Responde corto, natural y humano.
`
          },
          {
            role: "user",
            content: message
          }
        ]
      })
    });

    const data = await response.json();

    const reply = data.choices?.[0]?.message?.content || "Gracias por escribirnos.";

    res.json({
      reply
    });

  } catch (error) {

    console.error(error);

    res.json({
      reply: "Gracias por escribir a Clinyco. Un asesor responderá en breve."
    });

  }
});

app.listen(3000, () => {
  console.log("Clinyco AI running on port 3000");
});
