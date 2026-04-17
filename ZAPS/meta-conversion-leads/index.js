/**
 * ZAP: Meta Conversion Leads
 * Original Zapier id: 334996070
 *
 * Trigger : Zendesk Sell "New Deal"
 * Effects :
 *   1. Read contact_id from the deal.
 *   2. Fetch the contact from Sell to get phone / mobile.
 *   3. Hash the phone (SHA-256) per Facebook requirements.
 *   4. POST a "Lead" event to Facebook Conversions API.
 *
 * Env vars:
 *   META_ACCESS_TOKEN          — Facebook Conversions API long-lived token (required)
 *   META_PIXEL_ID              — override pixel (default: 1513925433070873)
 *   SELL_ACCESS_TOKEN           — Zendesk Sell token (shared)
 */

import { createHash } from "node:crypto";
import * as sell from "../_shared/sell-client.js";

const PIXEL_ID = process.env.META_PIXEL_ID || "1513925433070873";
const GRAPH_API_VERSION = "v21.0";

function getMetaToken() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new Error("Missing META_ACCESS_TOKEN — set it in environment variables");
  }
  return token;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePhone(raw) {
  if (!raw) return null;
  let phone = String(raw).replace(/[\s\-().]/g, "");
  if (phone.startsWith("+")) return phone;
  if (phone.startsWith("56") && phone.length >= 10) return `+${phone}`;
  if (phone.length === 9) return `+56${phone}`;
  return phone.startsWith("+") ? phone : `+${phone}`;
}

/**
 * @param {object} deal - payload from Zendesk Sell (deal object)
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {Console} [opts.logger=console]
 */
export async function handleMetaConversionLead(deal, opts = {}) {
  const { dryRun = false, logger = console } = opts;
  if (!deal || typeof deal !== "object") {
    throw new Error("handleMetaConversionLead: deal payload is required");
  }

  const dealId = deal.id || deal.entity_original_id;
  if (!dealId) {
    return { sent: false, skipped: "missing deal id" };
  }

  const contactId = deal.contact_id;
  if (!contactId) {
    return { sent: false, skipped: "no contact_id on deal" };
  }

  const contact = await sell.getContact(contactId);
  const phone = normalizePhone(contact.mobile || contact.phone);
  if (!phone) {
    logger.warn(`[meta-conversion-leads] deal ${dealId} contact ${contactId} has no phone`);
    return { sent: false, skipped: "contact has no phone number" };
  }

  const hashedPhone = sha256(phone);

  const eventPayload = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        action_source: "system_generated",
        user_data: {
          ph: [hashedPhone],
        },
        custom_data: {
          lifecycle_stage_name: "Lead",
          lead_event_source: "Zendesk Sell",
          deal_id: dealId,
          contact_id: contactId,
        },
      },
    ],
  };

  if (dryRun) {
    logger.info(`[meta-conversion-leads:dry-run] would POST to pixel ${PIXEL_ID}`, eventPayload);
    return { sent: false, dryRun: true, phone: phone.slice(0, 4) + "***", dealId };
  }

  const token = getMetaToken();
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PIXEL_ID}/events?access_token=${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(eventPayload),
    signal: AbortSignal.timeout(15_000),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Facebook Conversions API ${res.status}: ${body}`);
  }

  const result = JSON.parse(body);
  logger.log(
    `[meta-conversion-leads] deal ${dealId} → Lead event sent, events_received: ${result.events_received ?? "?"}`
  );

  return { sent: true, dealId, contactId, eventsReceived: result.events_received };
}
