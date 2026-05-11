/**
 * ZAP: Meta Conversion Leads
 * Original Zapier id: 334996070
 *
 * Trigger : Zendesk Sell "New Deal"
 * Effects :
 *   1. Read contact_id from the deal.
 *   2. Hash the contact_id (SHA-256) per Facebook requirements.
 *   3. POST a "Lead" event to Facebook Conversions API.
 *
 * The original Zapier zap sends contact_id as phone_number directly
 * (not the actual phone). We replicate the exact same behavior.
 *
 * Env vars:
 *   META_ACCESS_TOKEN          — Facebook Conversions API long-lived token (required)
 *   META_PIXEL_ID              — override pixel (default: 1513925433070873)
 */

import { createHash } from "node:crypto";

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

  const hashedPhone = sha256(String(contactId));

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
        },
      },
    ],
  };

  if (dryRun) {
    logger.info(`[meta-conversion-leads:dry-run] would POST to pixel ${PIXEL_ID}`, eventPayload);
    return { sent: false, dryRun: true, contactId, dealId };
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
    `[meta-conversion-leads] deal ${dealId} contact ${contactId} → Lead event sent, events_received: ${result.events_received ?? "?"}`
  );

  return { sent: true, dealId, contactId, eventsReceived: result.events_received };
}
