export const knowledgeSheetDefinitions = [
  {
    key: "professionals_detail",
    fileName: "professionals_detail.json",
    tabName: "Equipo medico",
    description: "Detalle operativo completo de cada profesional: valor, horario, duracion, telemedicina, limites de edad, sobrecupo, revision de examenes y notas operativas.",
    agentHelp: "Una fila por profesional. Incluye datos operativos confirmados y pendientes. Los campos de feedback IA se generan automaticamente.",
    columns: [
      { header: "Orden web", key: "orden_web", type: "string", description: "Posicion del profesional en la agenda web.", example: "1" },
      { header: "Nombre profesional", key: "nombre_profesional", type: "string", description: "Nombre completo del profesional.", example: "Peggy Huerta Pizarro" },
      { header: "Nombre en validacion", key: "nombre_validacion", type: "string", description: "Nombre usado internamente para validacion.", example: "Peggy Huerta Pizarro" },
      { header: "Categoria operativa", key: "categoria_operativa", type: "string", description: "Categoria del profesional.", example: "Psicologos" },
      { header: "Especialidad informada en pagina web", key: "especialidad_web", type: "string", description: "Especialidad mostrada en la pagina web.", example: "Psicóloga" },
      { header: "Descripcion del profesional en página web", key: "descripcion_web", type: "string", description: "Descripcion publica del profesional.", example: "Profesional que evalúa y apoya la salud mental..." },
      { header: "Estado validacion", key: "estado_validacion", type: "string", description: "Estado de la validacion: POR CONFIRMAR, Pendiente, etc.", example: "POR CONFIRMAR" },
      { header: "Horario", key: "horario", type: "string", description: "Horario de atencion.", example: "Lunes a Viernes (09:20 a 15:00)" },
      { header: "Valor", key: "valor", type: "string", description: "Valor de la consulta.", example: "35.000 CLP" },
      { header: "VALOR OBSERVACION", key: "valor_observacion", type: "string", description: "Detalle adicional del valor.", example: "$35.000 Particular" },
      { header: "PAGO PREVIO A CONSULTA", key: "previo_pago", type: "string", description: "SI o NO, si requiere pago previo.", example: "NO" },
      { header: "DURACION DE CONSULTA", key: "duracion", type: "string", description: "Duracion de la consulta.", example: "40 min" },
      { header: "LIMITES DE EDAD. (Si no tiene límite superior=sin limite superior)", key: "limites_edad", type: "string", description: "Rango de edad que atiende.", example: "desde los 15 años" },
      { header: "Atención Presencial y/o Telemedicina", key: "telemedicina", type: "string", description: "Modalidad de atencion.", example: "SI PRESENCIAL - SI TELEMEDICINA" },
      { header: "Sobrecupo", key: "sobrecupo", type: "string", description: "Si permite sobrecupo.", example: "NO" },
      { header: "Revision de examenes sin costo. SI o NO.", key: "revision_examenes", type: "string", description: "SI o NO.", example: "SI" },
      { header: "Revi. Exam sin costo. Cuantos dÍas ?", key: "revision_examenes_dias", type: "string", description: "Plazo para revision sin costo.", example: "15 días post consulta" },
      { header: "Observaciones operativas", key: "observaciones", type: "string", description: "Observaciones internas.", example: "SIN OBSERVACIONES" },
      { header: "Notas", key: "notas", type: "string", description: "Notas adicionales.", example: "3 sobrecupos por dia" },
      { header: "AGENDAMIENTO WEB VISIBLE Y PERMITIDO", key: "agendamiento_web", type: "string", description: "SI si el profesional esta visible en agenda web.", example: "SI" },
      { header: "Coincidencia fuente", key: "coincidencia_fuente", type: "string", description: "Tipo de match con fuente de datos.", example: "exacto" }
    ]
  },
  {
    key: "procedures",
    fileName: "procedures.json",
    tabName: "examenes",
    description: "Examenes, procedimientos y evaluaciones con orientacion segura.",
    agentHelp: "Una fila por examen, procedimiento o evaluacion. No poner diagnosticos ni promesas medicas.",
    columns: [
      { header: "Activo", key: "activo", type: "boolean", description: "Escribir SI o NO.", example: "SI" },
      { header: "Examen o evaluacion", key: "procedimiento", type: "string", description: "Nombre simple.", example: "Test de aire espirado para Helicobacter" },
      { header: "Categoria", key: "categoria", type: "string", description: "Categoria simple.", example: "Bariatrica" },
      { header: "Requiere peso y estatura", key: "requiere_peso_estatura", type: "boolean", description: "SI cuando el bot debe pedir estos datos.", example: "SI" },
      { header: "Se puede orientar sin RUT", key: "se_puede_orientar_sin_rut", type: "boolean", description: "SI cuando no hace falta pedir RUT al inicio.", example: "SI" },
      { header: "Profesionales sugeridos", key: "profesionales_sugeridos", type: "list", description: "Separar con |.", example: "Nelson Aros|Rodrigo Villagran|Alberto Sirabo" },
      { header: "Sedes sugeridas", key: "sedes_sugeridas", type: "list", description: "Separar con |.", example: "Antofagasta|Santiago" },
      { header: "Observaciones", key: "observaciones", type: "string", description: "Dato corto y operativo.", example: "Si hay interes y cobertura, priorizar derivacion." },
      { header: "Notas para el bot", key: "notas_para_bot", type: "string", description: "Regla corta para orientar.", example: "Explicar que el IMC es solo referencia inicial." }
    ]
  },
  {
    key: "faq_medical_safe",
    fileName: "faq_medical_safe.json",
    tabName: "preguntas frecuentes",
    description: "Respuestas seguras y aprobadas para preguntas frecuentes.",
    agentHelp: "Una fila por pregunta frecuente. No incluir diagnosticos ni promesas no confirmadas.",
    columns: [
      { header: "Activo", key: "activo", type: "boolean", description: "Escribir SI o NO.", example: "SI" },
      { header: "Pregunta frecuente", key: "pregunta_frecuente", type: "string", description: "Pregunta que suele hacer el paciente.", example: "Como funciona PAD Fonasa" },
      { header: "Respuesta aprobada", key: "respuesta_aprobada", type: "string", description: "Respuesta simple, humana y segura.", example: "Podemos orientarte primero y luego pedir el dato minimo necesario." },
      { header: "Cuando derivar a persona", key: "cuando_derivar", type: "string", description: "Si corresponde, indicar cuando pasar a un agente.", example: "Si pregunta por hora exacta o caso clinico puntual." },
      { header: "No prometer", key: "no_prometer", type: "string", description: "Algo que el bot no debe prometer.", example: "No prometer cupos ni valores no confirmados." },
      { header: "Notas para el bot", key: "notas_para_bot", type: "string", description: "Regla corta adicional.", example: "Responder primero y pedir un dato a la vez." }
    ]
  }
];
