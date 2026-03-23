import { findCustomerByRut, findCustomerByWhatsapp } from "../db.js";
import { normalizePhone, normalizeRut } from "../extraction/identity-normalizers.js";

export async function resolveCustomerFromIdentifiers({ whatsappPhone = null, rut = null } = {}) {
  const normalizedRut = normalizeRut(rut);
  if (normalizedRut) {
    const customer = await findCustomerByRut(normalizedRut);
    if (customer) {
      return {
        customer,
        isNew: false,
        matchedBy: "rut",
        matchStatus: "identity_confirmed"
      };
    }
  }

  const normalizedWhatsapp = normalizePhone(whatsappPhone);
  if (normalizedWhatsapp) {
    const customer = await findCustomerByWhatsapp(normalizedWhatsapp);
    if (customer) {
      return {
        customer,
        isNew: false,
        matchedBy: "whatsapp",
        matchStatus: "probable_context_from_whatsapp"
      };
    }
  }

  return {
    customer: null,
    isNew: true,
    matchedBy: null,
    matchStatus: "no_context"
  };
}
