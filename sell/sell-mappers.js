export function mapSellToKnownData(payload = {}) {
  return {
    c_rut: payload?.rut || null,
    c_nombres: payload?.name || null,
    c_email: payload?.email || null,
    c_tel1: payload?.phone || null,
    c_aseguradora: payload?.insurance || null,
    c_modalidad: payload?.modality || null,
    dealInteres: payload?.procedure || null,
    dealPeso: payload?.weight || null,
    dealEstatura: payload?.height || null
  };
}
