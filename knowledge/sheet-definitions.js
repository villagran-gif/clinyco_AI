export const knowledgeSheetDefinitions = [
  {
    key: "clinics",
    fileName: "clinics.json",
    tabName: "sedes",
    description: "Sedes y datos operativos simples para orientar al paciente.",
    agentHelp: "Una fila por sede. Escribir solo informacion vigente. Si no aplica, dejar vacio.",
    columns: [
      { header: "Activo", key: "activo", type: "boolean", description: "Escribir SI o NO.", example: "SI" },
      { header: "Sede", key: "sede", type: "string", description: "Nombre corto de la sede.", example: "Antofagasta" },
      { header: "Ciudad", key: "ciudad", type: "string", description: "Ciudad principal.", example: "Antofagasta" },
      { header: "Modalidad", key: "modalidad", type: "string", description: "Presencial, telemedicina o ambos.", example: "Presencial y telemedicina" },
      { header: "Direccion", key: "direccion", type: "string", description: "Direccion visible para el paciente.", example: "Av. Granaderos #1483" },
      { header: "Agenda web", key: "agenda_web", type: "string", description: "Link de agenda si existe.", example: "https://clinyco.medinetapp.com/agendaweb/planned/" },
      { header: "Solo telemedicina", key: "solo_telemedicina", type: "boolean", description: "Escribir SI solo si no hay atencion presencial.", example: "NO" },
      { header: "Observaciones", key: "observaciones", type: "string", description: "Dato corto y util para orientar.", example: "Endoscopia solo en esta sede." },
      { header: "Notas para el bot", key: "notas_para_bot", type: "string", description: "Regla corta para el bot.", example: "Si preguntan por endoscopia, orientar a Antofagasta." }
    ]
  },
  {
    key: "doctors",
    fileName: "doctors.json",
    tabName: "profesionales",
    description: "Profesionales y lo que si se puede orientar sin revisar agenda en vivo.",
    agentHelp: "Una fila por profesional. No poner horarios exactos aqui si cambian seguido.",
    columns: [
      { header: "Activo", key: "activo", type: "boolean", description: "Escribir SI o NO.", example: "SI" },
      { header: "Profesional", key: "profesional", type: "string", description: "Nombre y apellido.", example: "Rodrigo Villagran" },
      { header: "Especialidad", key: "especialidad", type: "string", description: "Especialidad simple.", example: "Cirugia bariatrica" },
      { header: "Sedes", key: "sedes", type: "list", description: "Separar varias sedes con |.", example: "Santiago|Telemedicina" },
      { header: "Modalidad", key: "modalidad", type: "string", description: "Presencial, telemedicina o ambos.", example: "Telemedicina y cirugia" },
      { header: "Procedimientos", key: "procedimientos", type: "list", description: "Separar con |.", example: "Balon gastrico|Manga gastrica|Bypass gastrico" },
      { header: "Agenda directa disponible", key: "agenda_directa_disponible", type: "boolean", description: "SI si el bot puede derivar a agenda web sin inventar horarios.", example: "NO" },
      { header: "Horario", key: "horario", type: "string", description: "Horario referencial u observacion breve. No escribir horas no confirmadas.", example: "Lunes a viernes, horario sujeto a confirmacion." },
      { header: "Valor", key: "valor", type: "string", description: "Escribir el valor en pesos chilenos. Ejemplo: 70000 o 70 mil.", example: "70000" },
      { header: "Previo pago", key: "previo_pago", type: "string", description: "Escribir SI o NO.", example: "SI" },
      { header: "Duracion", key: "duracion", type: "string", description: "Escribir minutos. Ejemplo: 30 min.", example: "30 min" },
      { header: "Telemedicina", key: "telemedicina", type: "string", description: "Usar: SI, NO, SOLO TELEMEDICINA o PRESENCIAL Y TELEMEDICINA.", example: "SI" },
      { header: "Motivo inactividad", key: "motivo_inactividad", type: "string", description: "Si esta inactivo, explicar el motivo en lenguaje simple.", example: "Licencia medica por 60 dias aprox." },
      { header: "Mensaje para el cliente", key: "mensaje_cliente_inactivo", type: "string", description: "Mensaje sugerido para responderle al paciente si el profesional esta inactivo.", example: "El doctor esta temporalmente sin agenda por licencia medica. Si quieres, te ayudo con otra alternativa." },
      { header: "Observaciones", key: "observaciones", type: "string", description: "Dato corto y real.", example: "Las cirugias en Santiago se realizan en Clinica Tabancura." },
      { header: "Notas para el bot", key: "notas_para_bot", type: "string", description: "Regla corta de uso.", example: "No prometer hora exacta si no hay acceso real a agenda." }
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
    key: "coverage_rules",
    fileName: "coverage_rules.json",
    tabName: "reglas_de_cobertura",
    description: "Reglas simples de previsiones, Fonasa e Isapre.",
    agentHelp: "Una fila por regla. Escribir la regla en lenguaje simple.",
    columns: [
      { header: "Activo", key: "activo", type: "boolean", description: "Escribir SI o NO.", example: "SI" },
      { header: "Cobertura o prevision", key: "cobertura", type: "string", description: "Ejemplo: FONASA, Isapre, Particular.", example: "FONASA" },
      { header: "Modalidad", key: "modalidad", type: "string", description: "Ejemplo: Tramo A, Tramo B o vacio.", example: "Tramo A" },
      { header: "Regla simple para el bot", key: "regla_simple", type: "string", description: "Explicacion corta para orientar.", example: "En Tramo A el PAD no aplica." },
      { header: "Que dato pedir despues", key: "siguiente_dato", type: "string", description: "Dato siguiente mas util.", example: "Tramo" },
      { header: "Observaciones internas", key: "observaciones", type: "string", description: "Solo detalle corto y claro.", example: "Para Isapre generica, pedir aseguradora exacta." }
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
