# Campos seleccionados del DEAL

La selección del usuario se implementa en `review/site/deal-fields.json` con 34 campos editables adicionales, más embudo, etapa, sede, responsable y etiquetas existentes. La ficha agrupa identificación, cobertura/procedimiento, documentos, gestión comercial, equipo médico y colaboradores. El nombre del trato puede diferir del nombre de contacto; nunca cambia el contacto en Chatwoot.

RUT o ID / RUT O ID se consolidan en idDocument; las tres variantes de previsión usan coverage. Los documentos extranjeros se conservan como texto; solo un RUT válido genera normalizedRut internamente, sin vincular por sí solo una ficha médica. Peso usa kg, estatura cm e IMC es peso/(estatura/100)^2; edad usa fecha de nacimiento y fecha de Santiago. Valor usa pesos chilenos enteros. WhatsApp deriva del teléfono, normalizando el celular chileno de nueve dígitos.

ID y creación se asignan al guardar. Fecha de cambio de fase se actualiza solo cuando cambia la etapa. Fecha de cierre se registra al entrar en CERRADO o DESCALIFICADO y se conserva entre etapas cerradas; se limpia al reabrir. CERRADO AGENDADO no implica cirugía realizada ni completa la fecha de cirugía. Las fechas históricas desconocidas permanecen vacías hasta una transición nueva. Próxima tarea y vencimiento se obtienen de las tareas pendientes (primero vencimiento más temprano); tareas vencidas excluye completadas. El tablero refresca estos indicadores al modificar tareas.

La ficha Medinet acepta únicamente URLs HTTPS de clinyco.medinetapp.com/pacientes/ficha/{id}/{sección}, o /pacientes/ficha/{uuid} (con sección numérica opcional). Exámenes acepta HTTPS de drive.google.com. Los enlaces se guardan, no se consultan ni modifican archivos. Los enlaces Medinet suministrados manualmente por un operador se mantienen en el DEAL y no crean una correspondencia verificada global de contactos.

Migración aditiva: details JSONB, stage_changed_at y closed_at en crm_opportunities. Campos omitidos se preservan; null borra explícitamente; la versión sigue evitando sobrescrituras concurrentes. No se importan datos históricos adicionales ni se cambia el control de acceso. No se guardaron pacientes de prueba en producción.

Validación: 23 pruebas, incluidas PostgreSQL/PGlite con persistencia y navegador JSDOM, validación de destinos, cálculo de edad/IMC/RUT/WhatsApp y autenticación.


## Distribución de la ficha según referencias del equipo

La ficha existente abre en lectura, con Editar junto al nombre. La columna izquierda reúne dueño, enlaces, RUT, cirujano bariátrico, pipeline/fase/sucursal, datos de contacto, previsión, fechas y demás campos. El valor monetario usa tipografía normal de 13 px. La columna central muestra notas internas y actividad; la derecha contiene conversaciones de Chatwoot, datos de contacto, colaboradores, acceso a citas en Medinet, tareas activas y documentos. Los colaboradores vacíos se resumen durante la lectura y todos son editables.

Medinet, Google Drive de exámenes y conversaciones abren enlaces HTTPS en una pestaña nueva; teléfono usa tel:, correo mailto: y WhatsApp wa.me con código de país. Un dato ausente no genera un enlace. Los enlaces no envían mensajes ni realizan llamadas automáticamente. Citas y documentos son accesos externos; no se presenta una agenda o listado de Drive como si se hubiera sincronizado.

Las notas se guardan en crm_deal_notes, asociadas al DEAL mediante clave foránea; el autor proviene de la sesión autenticada. El historial combina estas notas con los cambios del DEAL y sus tareas, con paginación de 100 elementos. Las notas se representan como texto, sin interpretar HTML. Los cambios anteriores sin autor conocido muestran Equipo Clinyco.

La creación conserva los seis campos de identificación actuales. Su equivalencia exacta con los campos obligatorios de creación de pacientes de Medinet sigue pendiente de confirmar; esta entrega no introduce requisitos desconocidos.

Verificación de esta revisión: pruebas de campos, destinos de enlaces y persistencia en PostgreSQL/PGlite; interacciones de formulario y notas en JSDOM. La revisión visual en el navegador compartido está pendiente: el acceso de Google fue bloqueado por la política del navegador y la vista local de prueba devolvió ERR_BLOCKED_BY_CLIENT. Mantener este cambio en borrador hasta completar esa revisión antes de publicar.
