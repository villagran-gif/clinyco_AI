/**
 * ZAP: RUT Normalizado CREAR Trato
 * Original Zapier id: 351937456
 *
 * Trigger : Zendesk Sell "New Deal"
 * Effects :
 *   1. Read custom_fields["RUT o ID"] from the new deal.
 *   2. Strip dots + hyphens.
 *   3. PUT /deals/:id with custom_fields.RUT_normalizado set to the cleaned value.
 *
 * No-op if the deal has no RUT to normalize or the value already matches.
 *
 * Env vars:
 *   SELL_ACCESS_TOKEN (or ZENDESK_SELL_API_TOKEN / ZENDESK_API_TOKEN_SELL)
 */

import * as sell from "../_shared/sell-client.js";
import { normalizeRut } from "../_shared/normalize.js";

/**
 * @param {object} deal  - payload from Zendesk Sell "deal_created" webhook (deal object).
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {Console} [opts.logger=console]
 * @returns {Promise<{ dealUpdated: boolean, normalized: string, skipped?: string }>}
 */
export async function handleNormalizeRutOnDealCreate(deal, opts = {}) {
  const { dryRun = false, logger = console } = opts;
  if (!deal || typeof deal !== "object") {
    throw new Error("handleNormalizeRutOnDealCreate: deal payload is required");
  }

  const dealId = deal.id || deal.entity_original_id;
  if (!dealId) {
    return { dealUpdated: false, normalized: "", skipped: "missing deal id" };
  }

  const rawRut = deal.custom_fields?.["RUT o ID"];
  const normalized = normalizeRut(rawRut);

  if (!normalized) {
    return { dealUpdated: false, normalized: "", skipped: "no RUT to normalize" };
  }

  const already = String(deal.custom_fields?.RUT_normalizado || "").trim();
  if (already === normalized) {
    return { dealUpdated: false, normalized, skipped: "already normalized" };
  }

  const patch = { custom_fields: { RUT_normalizado: normalized } };

  if (dryRun) {
    logger.info(`[rut-normalizado-crear-trato:dry-run] would PUT /deals/${dealId}`, patch);
    return { dealUpdated: false, normalized };
  }

  await sell.updateDeal(dealId, patch);
  return { dealUpdated: true, normalized };
}
