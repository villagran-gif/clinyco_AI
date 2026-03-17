function clean(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function stripDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(value) {
  return stripDiacritics(String(value || ""))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function compactNumber(value) {
  return new Intl.NumberFormat("es-CL").format(Number(value || 0));
}

export function normalizeBooleanLike(value) {
  const raw = clean(value);
  const key = normalizeKey(raw);
  if (!key) {
    return { value: null, label: null, confidence: "empty", notes: [] };
  }

  if (["SI", "S", "TRUE", "1", "CON", "ACTIVO"].includes(key)) {
    return { value: true, label: "Si", confidence: "high", notes: [] };
  }

  if (["NO", "N", "FALSE", "0", "SIN", "INACTIVO"].includes(key)) {
    return { value: false, label: "No", confidence: "high", notes: [] };
  }

  if (key.includes("SOLO TELEMEDICINA") || key.includes("TELEMEDICINA SI")) {
    return { value: true, label: "Si", confidence: "medium", notes: ["Interpretado desde texto libre."] };
  }

  if (key.includes("NO REALIZA TELEMEDICINA") || key.includes("TELEMEDICINA NO")) {
    return { value: false, label: "No", confidence: "medium", notes: ["Interpretado desde texto libre."] };
  }

  return { value: null, label: null, confidence: "low", notes: ["No se pudo interpretar claramente como Si o No."] };
}

export function normalizeCurrencyClp(value) {
  const raw = clean(value);
  const key = normalizeKey(raw);
  if (!raw) {
    return { amount: null, label: null, confidence: "empty", notes: [] };
  }

  const notes = [];
  const hasMilWord = key.includes("MIL");
  const matches = String(raw).match(/\d[\d.,]*/g) || [];

  if (!matches.length) {
    return { amount: null, label: null, confidence: "low", notes: ["No encontré un monto claro."] };
  }

  const parsedAmounts = matches
    .map((token) => {
      let digits = token.replace(/[^\d]/g, "");
      if (!digits) return null;
      let amount = Number(digits);
      if (!Number.isFinite(amount)) return null;
      if (hasMilWord && amount < 1000) amount *= 1000;
      return amount;
    })
    .filter((item) => Number.isFinite(item) && item > 0);

  if (!parsedAmounts.length) {
    return { amount: null, label: null, confidence: "low", notes: ["No encontré un monto usable."] };
  }

  const uniqueAmounts = [...new Set(parsedAmounts)];
  if (uniqueAmounts.length > 1) {
    notes.push(`Detecté varios valores: ${uniqueAmounts.map((item) => `$${compactNumber(item)}`).join(", ")}.`);
  }

  const amount = uniqueAmounts[0];
  if (/,/.test(raw) || /\./.test(raw) || hasMilWord) {
    notes.push("Monto normalizado a pesos chilenos.");
  }
  if (amount < 1000 && !hasMilWord) {
    notes.push("Monto muy bajo para CLP. Revisar si faltó escribir mil o miles.");
  }

  return {
    amount,
    label: `$${compactNumber(amount)} CLP`,
    confidence: uniqueAmounts.length > 1 || (amount < 1000 && !hasMilWord) ? "medium" : "high",
    notes
  };
}

export function normalizeDurationMinutes(value) {
  const raw = clean(value);
  if (!raw) {
    return { minutes: null, label: null, confidence: "empty", notes: [] };
  }

  const notes = [];
  const matches = [...String(raw).matchAll(/(\d{1,3})\s*(?:MIN|MINUTOS?)/gi)];
  if (!matches.length) {
    return { minutes: null, label: null, confidence: "low", notes: ["No encontré minutos claros."] };
  }

  const values = [...new Set(matches.map((match) => Number(match[1])).filter((item) => Number.isFinite(item)))];
  if (values.length > 1) {
    notes.push(`Detecté varias duraciones: ${values.map((item) => `${item} min`).join(", ")}.`);
  }

  return {
    minutes: values[0],
    label: `${values[0]} min`,
    confidence: values.length > 1 ? "medium" : "high",
    notes
  };
}

export function normalizeTelemedicine(value) {
  const raw = clean(value);
  const key = normalizeKey(raw);
  if (!raw) {
    return { mode: null, label: null, confidence: "empty", notes: [] };
  }

  if (key.includes("NO REALIZA TELEMEDICINA") || key === "NO") {
    return { mode: "no", label: "No", confidence: "high", notes: [] };
  }

  if (key.includes("SOLO TELEMEDICINA")) {
    return { mode: "solo_telemedicina", label: "Solo telemedicina", confidence: "high", notes: [] };
  }

  if (key.includes("HIBRIDO") || (key.includes("TELEMEDICINA") && key.includes("PRESENCIAL"))) {
    return { mode: "mixto", label: "Presencial y telemedicina", confidence: "medium", notes: ["Detecté modalidad mixta."] };
  }

  if (key.includes("TELEMEDICINA") || key === "SI") {
    return { mode: "si", label: "Si", confidence: "medium", notes: ["Detecté telemedicina desde texto libre."] };
  }

  const booleanLike = normalizeBooleanLike(raw);
  if (booleanLike.label) {
    return { mode: booleanLike.value ? "si" : "no", label: booleanLike.label, confidence: booleanLike.confidence, notes: booleanLike.notes };
  }

  return { mode: null, label: null, confidence: "low", notes: ["No se pudo interpretar la modalidad de telemedicina."] };
}

export function summarizeRowForAi(record = {}, sheetKey = "") {
  const notes = [];
  const chunks = [];

  if (record.valor) {
    const currency = normalizeCurrencyClp(record.valor);
    if (currency.label) chunks.push(`valor=${currency.label}`);
    notes.push(...currency.notes);
  }

  if (record.duracion) {
    const duration = normalizeDurationMinutes(record.duracion);
    if (duration.label) chunks.push(`duracion=${duration.label}`);
    notes.push(...duration.notes);
  }

  if (record.previo_pago) {
    const prev = normalizeBooleanLike(record.previo_pago);
    if (prev.label) chunks.push(`previo_pago=${prev.label}`);
    notes.push(...prev.notes);
  }

  if (record.telemedicina) {
    const tele = normalizeTelemedicine(record.telemedicina);
    if (tele.label) chunks.push(`telemedicina=${tele.label}`);
    notes.push(...tele.notes);
  }

  if (record.activo !== undefined) {
    const active = normalizeBooleanLike(record.activo);
    if (active.label) chunks.push(`activo=${active.label}`);
  }

  const title =
    record.profesional ||
    record.procedimiento ||
    record.sede ||
    record.cobertura ||
    record.pregunta_frecuente ||
    sheetKey;

  return {
    preview: title ? `${title}: ${chunks.join(" | ")}` : chunks.join(" | "),
    notes: [...new Set(notes)].filter(Boolean)
  };
}
