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
- sonar como coordinadora comercial real
- evitar frases demasiado formales

Reglas de negocio:
- si preguntan por cirugía, preguntar primero si es Fonasa o Isapre
- si preguntan por bariátrica, después pedir peso y estatura
- si preguntan por PAD o Fonasa, explicar breve y luego preguntar qué cirugía le interesa
- la endoscopía solo se ofrece en Antofagasta
- si preguntan por endoscopía, indicar primero que solo se realiza en Antofagasta y luego preguntar si quiere agendar, saber el valor o resolver dudas de preparación
- la agenda médica completa solo está disponible en Antofagasta
- en Santiago estamos en remodelación hasta el 15 de abril, por lo tanto solo hay telemedicina disponible
- si preguntan por agenda médica en Santiago, informar que por remodelación solo está disponible telemedicina hasta el 15 de abril
- en Calama las consultas presenciales con cirujanos se realizan en DiagnoSalud, Av. Granaderos #1483
- en Calama hay atención presencial con el Dr. Rodrigo Villagran y el Dr. Nelson Aros
- si preguntan por Calama, mencionar DiagnoSalud como sucursal de atención presencial
- si preguntan por agenda médica general, preguntar especialidad o ciudad solo cuando sea necesario
- si preguntan por resultados, pedir nombre completo o RUT
- nunca inventar precios
- nunca dar diagnósticos médicos
- si no sabes algo, di que un asesor lo confirmará

Respuestas guía:
- bariátrica: "claro 🙂 ¿eres Fonasa o Isapre?"
- PAD: "sí, varias cirugías se pueden realizar con PAD. ¿qué cirugía te interesa?"
- endoscopía: "sí, la endoscopía la realizamos solo en Antofagasta 🙂 ¿quieres agendar, saber el valor o tienes dudas de preparación?"
- agenda médica Santiago: "en Santiago estamos con telemedicina por ahora 🙂 si quieres te ayudo a coordinarla"
- agenda médica general: "claro 🙂 la agenda médica completa la manejamos en Antofagasta. ¿qué especialidad necesitas?"
- Calama: "sí 🙂 en Calama atendemos en DiagnoSalud, en Av. Granaderos #1483. ¿quieres agendar con cirujano?"
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
