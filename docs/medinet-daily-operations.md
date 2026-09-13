# Agenda diaria y cuadratura

## Fuentes verificables

- Citas y estados: Medinet API pública `all-appointments/{desde}/{hasta}/`; filtro exacto por fecha chilena, profesional y sede.
- Disponibilidad: instantánea del sincronizador VPS, exclusivamente cupos web, vigente hasta 30 minutos. Un día ausente o una instantánea vencida es desconocido, no cero.
- Bloqueos: la API consultada no los informa. Requiere fuente adicional de agenda interna.
- Confirmación: estado de Medinet y registro histórico por ID de cita y fecha. El registro de WhatsApp antiguo no recibe citas nuevas desde mayo; no se presenta como flujo activo.
- Asistencia: estado Atendido de Medinet, sin inferirla del paso del tiempo.
- Esperado agenda: arancel configurable por profesional y tipo de cita; excluye canceladas y reagendadas. Los importes sin configurar se muestran como pendientes. No es caja efectivamente recibida ni un libro contable histórico: cambiar un arancel modifica la estimación consultada.
- Recibido y diferencia: pendientes de integración de pagos. Nunca se sustituyen por el esperado.

## Agenda por WhatsApp

El tablero permite preparar la agenda de hoy y mañana al seleccionar un profesional. El envío automático queda desactivado hasta verificar destinatario, conversación y plantilla aprobada. No crea contactos ni conversaciones al azar.

Crear con el proveedor de WhatsApp una plantilla UTILITY `cly_professional_daily_agenda_v1`, idioma `es_CL`, con cuerpo exacto:

> Hola {{1}}, soy Antonia de Clínyco. Tu agenda de hoy: {{2}}. Tu agenda de mañana: {{3}}. Revisa el detalle actualizado: {{4}}

Variables: nombre del profesional; resumen de hoy; resumen de mañana; URL de SELL. Cuando una agenda excede el espacio disponible, el resumen contiene el número de citas y remite al detalle autenticado de SELL.

Configurar en Render, sin almacenar destinatarios ni credenciales en el repositorio:

- MEDINET_AGENDA_PROFESSIONAL: nombre completo exacto de Medinet.
- MEDINET_AGENDA_PHONE: número autorizado E.164.
- MEDINET_AGENDA_CONVERSATION_ID y MEDINET_AGENDA_INBOX_ID: conversación y canal verificados del destinatario.
- MEDINET_AGENDA_TEMPLATE y MEDINET_AGENDA_LANGUAGE.
- MEDINET_AGENDA_HOUR: 8 por defecto, America/Santiago; ventana de envío de una hora, sin mensajes atrasados fuera de ella.
- MEDINET_AGENDA_SEND_ENABLED: false hasta completar esas verificaciones.
- CHATWOOT_API_TOKEN, CHATWOOT_API_URL y CHATWOOT_ACCOUNT_ID existentes.

El proceso verifica teléfono, canal y plantilla antes de enviar. PostgreSQL reserva una entrega por destinatario y día. Un timeout queda incierto y requiere revisar Chatwoot; no se reintenta a ciegas. “accepted” significa aceptado por Chatwoot, no entregado ni leído por WhatsApp.

## Recuperación del flujo de confirmaciones de pacientes

No activar el tick histórico sin sincronización actual. Orden de implementación:

1. Sincronizar citas actuales de Medinet por ID, incluyendo cambios de hora y cancelaciones. No recrear contactos existentes. Guardar ID de conversación para la fila del tablero.
2. Reutilizar las plantillas de confirmación y recordatorio aprobadas después de comprobar su texto y canal. Programar recordatorios a 72 h, 24 h, 12 h y 08:00 del día de la cita, solamente si la cita es futura. Unificar ventanas superpuestas y cancelar los envíos anteriores al reagendar.
3. Una respuesta SÍ confirma exclusivamente la cita identificada: actualizar Medinet, volver a leer el estado y entonces responder “Tu cita quedó confirmada para [fecha/hora] con [profesional]”. Si hay varias citas, pedir cuál.
4. REAGENDAR: registrar solicitud, consultar cupos actuales y ofrecer alternativas. Conservar la reserva original hasta que el nuevo agendamiento quede confirmado. Responder “Revisemos otra hora. ¿Qué día te acomoda?”.
5. NO: distinguir cancelación de una respuesta a otra pregunta. Pedir confirmación si el contexto es ambiguo. Tras actualizar y verificar Medinet, confirmar la cancelación.
6. En errores de API no afirmar que una cita fue modificada. Registrar la incidencia y derivar a un agente, evitando respuestas simultáneas de Antonia y el módulo de confirmaciones.
7. Actualizar asistencia desde Medinet. No clasificar automáticamente como ausente una cita que terminó.

Este documento describe la recuperación pendiente; no declara activados esos envíos a pacientes.

## Pagos

Distinguir recaudación de pacientes de pagos a profesionales. Para recaudación se necesita un medio de pago con comprobantes y estado verificable; para pagar profesionales, un convenio de pago a proveedores y autorización bancaria. Una sesión de navegador permanente no sustituye una integración ni garantiza continuidad.
