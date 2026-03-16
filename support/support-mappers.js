import { supportFieldLooksGeneric } from "./support-cleaning.js";

export function mapSupportToKnownData(payload = {}) {
  const firstUser = payload?.users?.[0] || null;
  const firstTicket = payload?.tickets?.[0] || null;

  return {
    c_nombres: firstUser?.name || null,
    c_email: firstUser?.email || null,
    c_tel1: firstUser?.phone || null,
    c_rut: firstUser?.user_fields?.user_rut || null,
    c_aseguradora: supportFieldLooksGeneric(firstTicket?.subject) ? null : firstTicket?.subject || null,
    c_modalidad: null,
    dealInteres: supportFieldLooksGeneric(firstTicket?.description) ? null : firstTicket?.description || null
  };
}
