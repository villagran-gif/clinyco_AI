# Campos seleccionados del DEAL

La selección del usuario se implementa en `review/site/deal-fields.json` con 34 campos editables adicionales, más embudo, etapa, sede, responsable y etiquetas existentes. La ficha agrupa identificación, cobertura/procedimiento, documentos, gestión comercial, equipo médico y colaboradores. El nombre del trato puede diferir del nombre de contacto; nunca cambia el contacto en Chatwoot.

RUT o ID / RUT O ID se consolidan en idDocument; las tres variantes de previsión usan coverage. Los documentos extranjeros se conservan como texto; solo un RUT válido genera normalizedRut internamente, sin vincular por sí solo una ficha médica. Peso usa kg, estatura cm e IMC es peso/(estatura/100)^2; edad usa fecha de nacimiento y fecha de Santiago. Valor usa pesos chilenos enteros. WhatsApp deriva del teléfono, normalizando el celular chileno de nueve dígitos.

ID y creación se asignan al guardar. Fecha de cambio de fase se actualiza solo cuando cambia la etapa. Fecha de cierre se registra al entrar en CERRADO o DESCALIFICADO y se conserva entre etapas cerradas; se limpia al reabrir. CERRADO AGENDADO no implica cirugía realizada ni completa la fecha de cirugía. Las fechas históricas desconocidas permanecen vacías hasta una transición nueva. Próxima tarea y vencimiento se obtienen de las tareas pendientes (primero vencimiento más temprano); tareas vencidas excluye completadas. El tablero refresca estos indicadores al modificar tareas.

La ficha Medinet acepta únicamente URLs HTTPS de clinyco.medinetapp.com/pacientes/ficha/{id}/{sección}. Exámenes acepta HTTPS de drive.google.com. Los enlaces se guardan, no se consultan ni modifican archivos. Los enlaces Medinet suministrados manualmente por un operador se mantienen en el DEAL y no crean una correspondencia verificada global de contactos.

Migración aditiva: details JSONB, stage_changed_at y closed_at en crm_opportunities. Campos omitidos se preservan; null borra explícitamente; la versión sigue evitando sobrescrituras concurrentes. No se importan datos históricos adicionales ni se cambia el control de acceso. No se guardaron pacientes de prueba en producción.

Validación: 23 pruebas, incluidas PostgreSQL/PGlite con persistencia y navegador JSDOM, validación de destinos, cálculo de edad/IMC/RUT/WhatsApp y autenticación.
