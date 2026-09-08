const norm = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export const EXAM_HANDOFF = "Para agendar ese examen, nuestro equipo debe revisar la solicitud. AntonIA y MelanIA solo pueden ofrecer prestaciones con cupos publicados en Agenda Web; no puedo ofrecer ni confirmar una hora para este examen.";
export function requestedExam(text) {
  const t = norm(text);
  // Information about results/preparation is not a request to book an exam.
  if (/\b(resultado|interpret|preparacion|significa|riesgo)/.test(t) && !/agend|reserv|cupo|hora para|hacerme/.test(t)) return null;
  const name = t.match(/manometr\w*|colonoscop\w*|endoscop\w*|gastroscop\w*|ph[\s-]*metri\w*|calorimetr\w*|espirometr\w*|electrocardiogra\w*|ecograf\w*|densitometr\w*|holter|test de (?:hidrogeno|helicobacter)/)?.[0];
  if (name) return name;
  return /(?:para|agendar|reservar|necesito|quiero|hacerme)\s+(?:un |el |una |la )?examen\b/.test(t) ? "examen" : null;
}
export function publishedExamProfessionals(rows, request) {
  if (!request || request === "examen") return [];
  const stem = norm(request).replace(/(?:ia|ias|o|os|a|as)$/, "");
  return (rows || []).filter(p => [p.appointmentTypeName,p.tipoNombre,p.prestacion,p.tipo_cita_nombre]
    .some(label => typeof label === "string" && norm(label).includes(stem)));
}
export function examFollowup(text) {
  return /^(si|no|ok|gracias|antofagasta|santiago|presencial|telemedicina|tengo la orden|si tengo la orden)[.! ]*$/.test(norm(text));
}
