# MelanIA — mejora continua de agendas

Fecha: 2026-09-09
Rama: `mejoras/melania-agendas`
Repositorio: `villagran-gif/clinyco_AI`
Base compartida con cirugía: `89909b5c6be4efc0b4f5cf7f2aca0ca63f255d98` (PR #215).

## Estado real

Rama de desarrollo creada. Este primer commit documenta alcance y criterios; no modifica el agendamiento ejecutable, no crea citas, no modifica variables, no hace merge ni despliegue. No es una segunda instancia de Antonia ni otro servicio.

## Objetivo

Mejorar agenda web y conversación de Melania de forma independiente de la orientación quirúrgica. Antonia prioriza cirugía bariátrica, pero una persona que pide consulta, control, nutricionista, cambio o cancelación debe entrar al flujo de agendas, sin cuestionario quirúrgico obligatorio.

## Reglas que se conservan

- Ofrecer sólo profesionales, prestaciones y cupos publicados en Agenda Web, no cualquier disponibilidad interna de Medinet.
- Conservar la prohibición de agendamiento automático de endoscopias y la derivación de exámenes sin prestación publicada (PR #213–#215). No convertir un antecedente «tengo endoscopia» en una solicitud de reserva.
- Mantener autenticación y contexto de sesión correctos, incluida la sede Santiago 41 y modalidades publicadas. No publicar tokens en código, documentación o logs.
- Revalidar el cupo exacto antes de reservar. No confirmar una cita sin éxito verificable de Medinet e identificador de reserva.
- Ante timeout de una reserva, consultar/reconciliar el resultado antes de reintentar. La idempotencia debe evitar citas duplicadas.
- Pedir sólo los datos indispensables que realmente faltan. Un perfil de WhatsApp no es identidad clínica verificada.
- Intervención humana detiene respuestas automáticas pendientes.

## Secuencia de mejora

1. Clasificar intención: nueva consulta, control, reagendamiento, cancelación, dudas de agenda, examen o derivación quirúrgica a evaluación.
2. Extraer profesional, especialidad, sede y modalidad ya mencionados; hacer una única aclaración cuando sea imprescindible.
3. Consultar catálogo/cupos publicados y ofrecer un conjunto pequeño de alternativas reales.
4. Reutilizar contexto autorizado; recolectar faltantes; confirmar selección y datos relevantes.
5. Revalidar, reservar una sola vez y mostrar confirmación respaldada por Medinet.
6. Si no hay cupos, prestación habilitada o respuesta confiable del servicio, ofrecer alternativa publicada o derivación al equipo de agendamiento sin reiniciar la conversación.

## Contrato de transferencia desde cirugía

Transferir intención, procedimiento consultado, sede/modalidad preferida, profesional elegido si existe, hechos aportados por el paciente con procedencia, dudas pendientes y estado de verificación de identidad. No transferir etiquetas de marketing como diagnósticos. Una consulta de evaluación no confirma elegibilidad para cirugía ni financiación.

## Dependencia compartida P0

El incidente 11142 requiere resolver latencia de historial, recepción durable rápida, última revisión recibida antes del mutex, agrupación de mensajes y antirrepetición. Mantener un núcleo común; incorporar cambios revisados desde main, sin copiar dos implementaciones divergentes. No migrar bases ni desplegar desde esta rama automáticamente.

## Criterios de aceptación pendientes

- «Quiero hora con nutricionista» no inicia preevaluación bariátrica.
- «Quiero evaluación para conversión» conserva contexto al abrir agenda.
- Prestación no publicada o endoscopia: no reserva automática.
- Cupo desaparecido: no confirma, ofrece alternativas verificadas.
- Timeout de reserva y webhook duplicado: cero reservas duplicadas.
- Intervención humana: ninguna respuesta automática posterior.
- Ningún precio, cobertura ni horario inventado.

Esta rama se perfecciona con PRs pequeños, pruebas y despliegue explícito tras revisión. No reemplaza el trabajo prioritario de cirugía.