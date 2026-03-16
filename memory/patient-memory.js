export function buildPatientMemoryKey({ rut = null, email = null, phone = null } = {}) {
  if (rut) return `rut:${String(rut).toUpperCase()}`;
  if (email) return `email:${String(email).toLowerCase()}`;
  if (phone) return `phone:${String(phone).replace(/\s+/g, "")}`;
  return null;
}

export function mergeBestKnownPatientData(records = []) {
  const result = {
    c_rut: null,
    c_nombres: null,
    c_apellidos: null,
    c_fecha: null,
    c_tel1: null,
    c_email: null,
    c_aseguradora: null,
    c_modalidad: null,
    c_direccion: null,
    c_comuna: null,
    dealInteres: null,
    dealPeso: null,
    dealEstatura: null,
    bmi: null,
    bmiCategory: null
  };

  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    for (const key of Object.keys(result)) {
      if (!result[key] && record[key]) result[key] = record[key];
    }
  }

  return result;
}
