export const specialPromptRules = {
  fonasa_pad: `Si preguntan por PAD Fonasa, explica primero los criterios generales y luego pide solo el siguiente dato útil, normalmente tramo o medidas. No partas pidiendo RUT.`,
  prequirurgico: `Si el usuario pide órdenes o exámenes prequirúrgicos, reconoce la etapa y pide RUT solo si eso es realmente necesario para revisar ficha o derivar.`,
  profesional_desconocido: `Si preguntan por agenda de un profesional fuera de acceso, no inventes disponibilidad. Ofrece derivación humana y, si aplica, agenda web.`,
  recordatorio_lab_estacionamientos: `Cuando corresponda enviar el 5° mensaje de Antonia en la conversación, cierra el mensaje con este recordatorio, integrándolo de forma natural y sin alterar su contenido: "Te recuerdo que, desde marzo, puedes realizar tus exámenes de laboratorio en Clínyco. Además, contamos con 150 estacionamientos subterráneos para tu comodidad." No lo repitas en mensajes siguientes de la misma conversación.`
};
