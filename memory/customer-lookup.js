import { findCustomerByRut, findCustomerByWhatsapp, upsertCustomer, linkConversationToCustomer, addCustomerChannel, dbEnabled } from "../db.js";
import { normalizePhone } from "../extraction/identity-normalizers.js";

/**
 * Resuelve o crea un customer usando identificadores fuertes.
 * Prioridad 1: RUT (singularidad ~99%)
 * Prioridad 2: WhatsApp (singularidad ~90%)
 * Email NO es criterio de merge — solo dato accesorio.
 */
export async function resolveCustomerFromIdentifiers({ whatsappPhone = null, rut = null, conversationId = null }) {
  if (!dbEnabled()) return { customer: null, isNew: false, matchedBy: null };

  const normalizedPhone = whatsappPhone ? normalizePhone(whatsappPhone) : null;

  let customer = null;
  let matchedBy = null;

  // Prioridad 1: RUT (el más estable, no cambia nunca)
  if (rut) {
    customer = await findCustomerByRut(rut);
    if (customer) matchedBy = "rut";
  }

  // Prioridad 2: WhatsApp
  if (!customer && normalizedPhone) {
    customer = await findCustomerByWhatsapp(normalizedPhone);
    if (customer) matchedBy = "whatsapp";
  }

  const isNew = !customer;

  if (!customer) {
    if (!normalizedPhone && !rut) {
      return { customer: null, isNew: false, matchedBy: null };
    }
    customer = await upsertCustomer({
      rut: rut || null,
      whatsappPhone: normalizedPhone
    });
    matchedBy = rut ? "rut" : "whatsapp";
  } else {
    // Enriquecer: si encontramos por RUT pero no tenía WhatsApp (o viceversa)
    const updates = {};
    if (normalizedPhone && !customer.whatsapp_phone) updates.whatsappPhone = normalizedPhone;
    if (rut && !customer.rut) updates.rut = rut;
    if (Object.keys(updates).length > 0) {
      customer = await upsertCustomer({ rut: customer.rut, whatsappPhone: customer.whatsapp_phone, ...updates });
    }
  }

  // Vincular conversación al customer
  if (conversationId && customer?.id) {
    await linkConversationToCustomer(conversationId, customer.id);
  }

  // Registrar WhatsApp como canal si existe
  if (normalizedPhone && customer?.id) {
    await addCustomerChannel(customer.id, "whatsapp", normalizedPhone, true);
  }

  return { customer, isNew, matchedBy };
}
