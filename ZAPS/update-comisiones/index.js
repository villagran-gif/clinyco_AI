/**
 * ZAP: Update Comisiones
 * Original Zapier id: 331401022
 *
 * Trigger : Zendesk Sell "Deal Updated"
 * Effects :
 *   1. Normalize RUT from custom_fields["RUT o ID"] (strip dots + hyphens).
 *   2. Resolve pipeline_id + pipeline_name + stage_name from the stage.
 *   3. Resolve agent name from last_stage_change_by_id.
 *   4. Reformat FECHA DE CIRUGÍA (DD-MM-YYYY → YYYY-MM-DD),
 *      added_at / updated_at / *Fecha Hito 1* (ISO → YYYY-MM-DD).
 *   5. Upsert a row in the "Comisiones" Google Sheet, keyed by deal id (col A).
 *      - updateCells     → written on every run (live deal state)
 *      - insertOnlyCells → commission codes (J..O), written once so humans can edit them
 *   6. Write back to the Sell Deal: WhatsApp link, normalized RUT, commission codes.
 *   7. Write normalized RUT to the Sell Contact linked to the deal.
 *
 * Env vars:
 *   SELL_ACCESS_TOKEN (or ZENDESK_SELL_API_TOKEN / ZENDESK_API_TOKEN_SELL)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY
 *   COMISIONES_SHEET_ID   (optional, defaults to the Zap's hardcoded id)
 *   COMISIONES_SHEET_GID  (optional, defaults to the Zap's hardcoded gid)
 */

import * as sell from "../_shared/sell-client.js";
import * as sheets from "../_shared/sheets-client.js";
import {
  normalizeRut,
  resolvePipelineName,
  resolveStageName,
  formatDateDmyToYmd,
  formatDateToYmd,
  whatsappLink
} from "../_shared/normalize.js";

// Fixed commission codes (literal constants from the original Zap).
export const COMMISSION_CODES = {
  ComisionBAR1: "8001",
  ComisionBAR2: "5002",
  ComisionBAR3: "5003",
  ComisionBAR4: "9004",
  ComisionBAR5: "6005",
  ComisionBAR6: "6006"
};

const SHEET_SPREADSHEET_ID =
  process.env.COMISIONES_SHEET_ID || "1LaChp4TmV88-M6cLEnlvxImrxDKscLZBAdOFa6gb_sc";
const SHEET_GID = process.env.COMISIONES_SHEET_GID || "1997956572";

/**
 * @param {object} deal  - payload from Zendesk Sell "deal_updated" webhook (deal object).
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false]  - Skip all network writes; log planned actions.
 * @param {Console} [opts.logger=console]
 * @returns {Promise<{
 *   sheetRow: number|null,
 *   sheetInserted: boolean,
 *   dealUpdated: boolean,
 *   contactUpdated: boolean,
 *   normalized: { rut: string, pipelineName: string, stageName: string, agentName: string }
 * }>}
 */
export async function handleUpdateComisiones(deal, opts = {}) {
  const { dryRun = false, logger = console } = opts;
  if (!deal || typeof deal !== "object") {
    throw new Error("handleUpdateComisiones: deal payload is required");
  }

  const dealId = deal.entity_original_id || deal.id;
  const contactId = deal.contact_id;
  const stageId = deal.stage_id;
  const agentId = deal.last_stage_change_by_id;

  // -- Step 1: RUT normalization
  const rutNormalized = normalizeRut(deal.custom_fields?.["RUT o ID"]);

  // -- Steps 2+3: fetch fresh state from Sell (deal, stage, agent) in parallel
  const [freshDeal, stage, agent] = await Promise.all([
    dealId
      ? sell.getDeal(dealId).catch((e) => {
          logger.warn(`[update-comisiones] getDeal(${dealId}) failed: ${e.message}`);
          return null;
        })
      : null,
    stageId
      ? sell.getStage(stageId).catch((e) => {
          logger.warn(`[update-comisiones] getStage(${stageId}) failed: ${e.message}`);
          return null;
        })
      : null,
    agentId
      ? sell.getUser(agentId).catch((e) => {
          logger.warn(`[update-comisiones] getUser(${agentId}) failed: ${e.message}`);
          return null;
        })
      : null
  ]);

  const source = freshDeal || deal;
  const pipelineId = stage?.pipeline_id || null;
  const pipelineName = resolvePipelineName(pipelineId);
  const stageName = resolveStageName(stageId);
  const agentName =
    agent?.name ||
    [agent?.first_name, agent?.last_name].filter(Boolean).join(" ") ||
    "";

  // -- Step 4: date reformatting
  const fechaCirugiaYmd = formatDateDmyToYmd(source.custom_fields?.["FECHA DE CIRUGÍA"]);
  const updatedAtYmd = formatDateToYmd(source.updated_at);
  const fechaHito1Ymd = formatDateToYmd(
    source.custom_fields?.["*Fecha Hito 1* (agregado el)"]
  );

  // -- Step 5: build Google Sheet cells
  const updateCells = {
    A: String(dealId || ""),
    B: source.name || deal.name || "",
    D: pipelineName,
    E: stageName,
    F: fechaCirugiaYmd,
    G: source.custom_fields?.Colaborador1 || "",
    H: source.custom_fields?.Colaborador2 || "",
    I: source.custom_fields?.Colaborador3 || "",
    P: fechaHito1Ymd,
    R: source.custom_fields?.["FECHA DE CIRUGÍA"] || "",
    V: updatedAtYmd
  };
  const insertOnlyCells = {
    J: COMMISSION_CODES.ComisionBAR1,
    K: COMMISSION_CODES.ComisionBAR2,
    L: COMMISSION_CODES.ComisionBAR3,
    M: COMMISSION_CODES.ComisionBAR4,
    N: COMMISSION_CODES.ComisionBAR5,
    O: COMMISSION_CODES.ComisionBAR6
  };

  let sheetResult = { rowNumber: null, inserted: false };
  if (dryRun) {
    logger.info("[update-comisiones:dry-run] would upsert sheet row", {
      keyValue: String(dealId || ""),
      updateCells,
      insertOnlyCells
    });
  } else {
    const tabName = await sheets.resolveTabName({
      spreadsheetId: SHEET_SPREADSHEET_ID,
      gid: SHEET_GID
    });
    sheetResult = await sheets.upsertRowByKey({
      spreadsheetId: SHEET_SPREADSHEET_ID,
      tabName,
      lookupColumn: "A",
      keyValue: String(dealId || ""),
      updateCells,
      insertOnlyCells,
      maxRows: 2000
    });
  }

  // -- Step 6: write back to Sell deal
  const dealPatch = {
    custom_fields: {
      WhatsApp_Contactar_LINK: whatsappLink(source.custom_fields?.Telefono),
      Colaborador1: source.custom_fields?.Colaborador1 || "",
      Colaborador2: source.custom_fields?.Colaborador2 || "",
      Colaborador3: source.custom_fields?.Colaborador3 || "",
      // NOTE: original Zap literally writes "" to FECHA DE CIRUGÍA, which clears the
      //       field on every run. That looks like a latent bug, so we do NOT reproduce
      //       it here. Uncomment the next line if you need exact Zap parity.
      // "FECHA DE CIRUGÍA": "",
      ComisionBAR1: COMMISSION_CODES.ComisionBAR1,
      ComisionBAR2: COMMISSION_CODES.ComisionBAR2,
      ComisionBAR3: COMMISSION_CODES.ComisionBAR3,
      ComisionBAR4: COMMISSION_CODES.ComisionBAR4,
      ComisionBAR5: COMMISSION_CODES.ComisionBAR5,
      ComisionBAR6: COMMISSION_CODES.ComisionBAR6,
      RUT_normalizado: rutNormalized
    }
  };

  let dealUpdated = false;
  if (dryRun) {
    logger.info(`[update-comisiones:dry-run] would PUT /deals/${dealId}`, dealPatch);
  } else if (dealId) {
    await sell.updateDeal(dealId, dealPatch);
    dealUpdated = true;
  }

  // -- Step 7: write RUT_normalizado to contact
  let contactUpdated = false;
  if (rutNormalized && contactId) {
    const contactPatch = { custom_fields: { RUT_normalizado: rutNormalized } };
    if (dryRun) {
      logger.info(`[update-comisiones:dry-run] would PUT /contacts/${contactId}`, contactPatch);
    } else {
      await sell.updateContact(contactId, contactPatch);
      contactUpdated = true;
    }
  }

  return {
    sheetRow: sheetResult.rowNumber,
    sheetInserted: sheetResult.inserted,
    dealUpdated,
    contactUpdated,
    normalized: { rut: rutNormalized, pipelineName, stageName, agentName }
  };
}
