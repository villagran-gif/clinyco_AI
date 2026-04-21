// WhatsApp message templates (Spanish, Chile). Interpolation uses {token}.

function interp(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
}

export function confirmation({ patientName, starts, professional, specialty, paymentUrl }) {
  return interp(
    "Hola {patientName}, soy Clínyco.\n\n" +
      "Tu hora de telemedicina quedó reservada:\n" +
      "• Profesional: {professional}\n" +
      "• Especialidad: {specialty}\n" +
      "• Fecha y hora: {starts}\n\n" +
      "Para confirmar tu reserva debes completar el pago aquí:\n" +
      "{paymentUrl}\n\n" +
      "Cuando el pago sea confirmado te enviaremos el link de la videoconsulta.",
    { patientName, starts, professional, specialty, paymentUrl }
  );
}

export function reminder5d({ patientName, starts, professional, paymentUrl, isPaid }) {
  const payLine = isPaid
    ? "Tu pago ya está confirmado. Te enviaremos el link 16 horas antes de la cita."
    : "Aún no registramos tu pago. Completa aquí: {paymentUrl}";
  return interp(
    "Hola {patientName}, te recordamos que tienes una hora de telemedicina en 5 días.\n\n" +
      "• Profesional: {professional}\n" +
      "• Fecha y hora: {starts}\n\n" +
      payLine,
    { patientName, starts, professional, paymentUrl }
  );
}

export function reminder2d({ patientName, starts, professional, paymentUrl, isPaid }) {
  const payLine = isPaid
    ? "Tu pago ya está confirmado."
    : "Recuerda pagar antes de la cita: {paymentUrl}";
  return interp(
    "Hola {patientName}, tu hora de telemedicina es en 2 días.\n\n" +
      "• Profesional: {professional}\n" +
      "• Fecha y hora: {starts}\n\n" +
      payLine,
    { patientName, starts, professional, paymentUrl }
  );
}

export function reminder16h({ patientName, starts, professional, sessionUrl, paymentUrl, isPaid }) {
  if (isPaid && sessionUrl) {
    return interp(
      "Hola {patientName}, tu videoconsulta con {professional} es en 16 horas ({starts}).\n\n" +
        "Ingresa en el horario acordado a:\n{sessionUrl}",
      { patientName, starts, professional, sessionUrl }
    );
  }
  return interp(
    "Hola {patientName}, tu hora de telemedicina es en 16 horas ({starts}).\n\n" +
      "Aún no confirmamos tu pago. Si no pagas antes, tu hora podría liberarse.\n" +
      "Paga aquí: {paymentUrl}",
    { patientName, starts, paymentUrl }
  );
}

export function sessionLinkToPatient({ patientName, starts, professional, sessionUrl }) {
  return interp(
    "Hola {patientName}, tu pago fue confirmado. ¡Gracias!\n\n" +
      "Este es el link de tu videoconsulta con {professional} ({starts}):\n" +
      "{sessionUrl}\n\n" +
      "Recuerda ingresar unos minutos antes con buena conexión a internet.",
    { patientName, starts, professional, sessionUrl }
  );
}

export function professionalNotify({ professionalName, patientName, patientRut, starts, specialty, sessionUrl }) {
  return interp(
    "Hola Dr/a {professionalName}, confirmamos una nueva videoconsulta:\n\n" +
      "• Paciente: {patientName} ({patientRut})\n" +
      "• Especialidad: {specialty}\n" +
      "• Fecha y hora: {starts}\n" +
      "• Link: {sessionUrl}",
    { professionalName, patientName, patientRut, starts, specialty, sessionUrl }
  );
}
