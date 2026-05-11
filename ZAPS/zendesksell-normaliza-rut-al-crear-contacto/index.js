/**
 * ZAP: ZENDESKSELL NORMALIZA RUT AL CREAR CONTACTO
 * Original Zapier id: 350571847
 *
 * Trigger : Zendesk Sell "New Contact"
 * Effects :
 *   1. Read custom_fields["RUT o ID"] from the new contact.
 *   2. Strip dots + hyphens.
 *   3. PUT /contacts/:id with custom_fields.RUT_normalizado set to the cleaned value.
 *
 * No-op if the contact has no RUT to normalize.
 *
 * Env vars:
 *   SELL_ACCESS_TOKEN (or ZENDESK_SELL_API_TOKEN / ZENDESK_API_TOKEN_SELL)
 */

import * as sell from "../_shared/sell-client.js";
import { normalizeRut } from "../_shared/normalize.js";

/**
 * @param {object} contact  - payload from Zendesk Sell "contact_created" webhook (contact object).
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {Console} [opts.logger=console]
 * @returns {Promise<{ contactUpdated: boolean, normalized: string, skipped?: string }>}
 */
export async function handleNormalizeRutOnContactCreate(contact, opts = {}) {
  const { dryRun = false, logger = console } = opts;
  if (!contact || typeof contact !== "object") {
    throw new Error("handleNormalizeRutOnContactCreate: contact payload is required");
  }

  const contactId = contact.id;
  if (!contactId) {
    return { contactUpdated: false, normalized: "", skipped: "missing contact id" };
  }

  const rawRut = contact.custom_fields?.["RUT o ID"];
  const normalized = normalizeRut(rawRut);

  if (!normalized) {
    return { contactUpdated: false, normalized: "", skipped: "no RUT to normalize" };
  }

  // Only write if the value actually changed — avoids pointless API traffic
  // when a contact is re-saved without touching the RUT.
  const already = String(contact.custom_fields?.RUT_normalizado || "").trim();
  if (already === normalized) {
    return { contactUpdated: false, normalized, skipped: "already normalized" };
  }

  const patch = { custom_fields: { RUT_normalizado: normalized } };

  if (dryRun) {
    logger.info(`[normaliza-rut-contacto:dry-run] would PUT /contacts/${contactId}`, patch);
    return { contactUpdated: false, normalized };
  }

  await sell.updateContact(contactId, patch);
  return { contactUpdated: true, normalized };
}
