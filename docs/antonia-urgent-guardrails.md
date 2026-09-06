# Guardrails urgentes de AntonIA

Casos reales que motivan este cambio:

- Conversación 10935: AntonIA inventó sedes/ciudades (Los Andes, San Felipe) y franjas mañana/tarde sin resultado real de Medinet.
- Conversación 10939: lead desde anuncio "NO CALIFICO para FONASA PAD" recibió como primera pregunta el tramo Fonasa, sin persuasión previa.

Cambios:

1. No inventar sedes, ciudades, cercanía, mañana/tarde ni disponibilidad.
2. Preguntas de ubicación/sede sin fuente verificada se derivan a una agente.
3. Respuestas OpenAI con claims de agenda no verificados se bloquean antes de enviarse.
4. Leads que dicen no calificar PAD reciben primero orientación/persuasión y continúan preevaluación; el tramo se difiere.
5. Normalización de voseo rioplatense a español chileno neutro.
