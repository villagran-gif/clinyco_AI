# Antonia y MelanIA: agendas — línea de trabajo 2

Fecha: 2026-09-09. Rama: `feat/antonia-agendas`.
Base: `89909b5c6be4efc0b4f5cf7f2aca0ca63f255d98`.
Estado: rama inicial con plan y contrato de integración. No modifica el motor de reservas, no despliega y no crea citas.

## Prioridad

La mejora comercial prioritaria es cirugía bariátrica en `feat/antonia-cirugia-bariatrica`. Esta rama permite perfeccionar después agendas sin mezclar cambios. La corrección compartida de latencia, historial y turnos es un requisito técnico previo a producción, no una tercera línea comercial competidora.

## División de responsabilidades

Antonia detecta intención y acompaña. MelanIA es el motor operativo de agenda. No todas las horas son quirúrgicas: consultas, controles, otras especialidades, cambios y cancelaciones tienen sus propios flujos. Nunca exigir una preevaluación quirúrgica para una consulta general. Una solicitud explícita de hora interrumpe el flujo comercial.

## Contrato de traspaso

Recibir cuenta/inbox/conversación verificados; intención; prestación solicitada; profesional; sede; modalidad presencial/telemedicina; previsión; preferencias de fecha; hechos mínimos ya conocidos; procedencia y fecha de cada dato. El contexto quirúrgico compartido debe limitarse a lo necesario y no volcar una ficha clínica a logs.

No volver a pedir ciudad, modalidad, médico o prestación ya conocidos. No crear identidad legal desde un nombre informal de WhatsApp. Solicitar únicamente los campos realmente requeridos por la operación y la verificación de identidad correspondiente.

## Reglas heredadas que deben conservarse

- Ofrecer exclusivamente profesionales, prestaciones y cupos publicados en Agenda Web.
- No reservar endoscopias automáticamente; derivar su coordinación.
- No ofrecer exámenes cuya prestación no esté publicada/verificada.
- Revalidar el cupo exacto inmediatamente antes de reservar.
- No decir «agendado» sin confirmación y referencia real de Medinet.
- Prevenir reservas duplicadas mediante idempotencia y reconciliación tras timeouts.
- Ante no disponibilidad, excepción/sobrecupo, prestación no reconocida, conflicto o fallas repetidas, derivar con todo el contexto útil.
- Respetar solicitud de humano y toma humana sin mensajes de Antonia simultáneos.

## Etapas futuras

A. Auditar prestaciones y sesiones de agenda en el código vigente.
B. Recibir el contrato de cirugía y saltar preguntas satisfechas.
C. Disponibilidad con búsqueda acotada por sede, modalidad y profesional.
D. Reserva idempotente, recuperación ante timeouts y cupo que desaparece.
E. Reagendamiento/cancelación con autorización explícita y verificación.
F. Confirmación breve con fecha, hora, sede/modalidad, instrucciones verificadas y «cómo llegar» contextual. No inventar estacionamiento, accesos, pisos ni horarios.

## Casos obligatorios de pruebas

Una persona pide nutricionista sin interés quirúrgico; un candidato revisional acepta evaluación; existen ciudad y médico previos; cupo ocupado entre consulta y confirmación; proveedor devuelve timeout; dos mensajes de confirmación iguales; control/reagendamiento de paciente existente; endoscopia o examen no publicado; toma humana en medio de la operación. Distinguir agenda iniciada, reserva confirmada y atención realizada.

## Forma de trabajo

Ambas ramas parten de la misma base y tienen ámbitos separados. Integrar primero cambios técnicos pequeños y revisados en `main`; actualizar ambas ramas desde esa base para evitar dos implementaciones incompatibles de memoria o turnos. No fusionar cirugía entera dentro de agendas. No tocar credenciales, configuración de Render ni producción desde este documento.
