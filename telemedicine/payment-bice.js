// BICE payment client — STUB.
//
// Until the real BICE API spec arrives from the bank, this module exposes the
// minimal interface the lifecycle depends on. Do NOT remove these functions;
// replace their internals when the spec is delivered.
//
//   createPaymentIntent({ appointmentId, amount, patient }) → { paymentReference, paymentUrl }
//   verifyPayment(paymentReference)                         → { status: "pending"|"paid"|"failed", raw }
//
// Env vars used once the real integration lands:
//   BICE_API_BASE_URL
//   BICE_API_KEY
//   BICE_MERCHANT_ID
//   BICE_CHECKOUT_BASE_URL   (checkout URL the user clicks — already used here)
//   BICE_WEBHOOK_SECRET      (for inbound webhook, future)

import { randomBytes } from "crypto";

function getCheckoutBaseUrl() {
  return (process.env.BICE_CHECKOUT_BASE_URL || "https://clinyco-ai.onrender.com/pay/bice").replace(/\/$/, "");
}

function getApiBaseUrl() {
  return (process.env.BICE_API_BASE_URL || "").replace(/\/$/, "");
}

function isRealModeEnabled() {
  return Boolean(getApiBaseUrl() && process.env.BICE_API_KEY);
}

export async function createPaymentIntent({ appointmentId, amount, patient }) {
  const paymentReference = `CLY-${appointmentId}-${randomBytes(4).toString("hex")}`;

  if (!isRealModeEnabled()) {
    return {
      paymentReference,
      paymentUrl: `${getCheckoutBaseUrl()}/${paymentReference}`,
      mode: "stub",
    };
  }

  // Real mode placeholder — replace once spec arrives.
  // Expected: POST ${BICE_API_BASE_URL}/payments with {merchantId, amount, reference, return_url}
  // returning {payment_url, reference_id}.
  const res = await fetch(`${getApiBaseUrl()}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.BICE_API_KEY}`,
    },
    body: JSON.stringify({
      merchant_id: process.env.BICE_MERCHANT_ID,
      reference: paymentReference,
      amount,
      metadata: { appointmentId, patientRut: patient?.rut || null },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`BICE createPaymentIntent ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    paymentReference: data.reference || paymentReference,
    paymentUrl: data.payment_url || `${getCheckoutBaseUrl()}/${paymentReference}`,
    mode: "live",
    raw: data,
  };
}

export async function verifyPayment(paymentReference) {
  if (!isRealModeEnabled()) {
    // Stub: keep appointment in payment_pending until BICE is wired up.
    // Operators can mark paid manually via SQL for pilot testing.
    return { status: "pending", mode: "stub" };
  }

  // Real mode placeholder.
  const res = await fetch(`${getApiBaseUrl()}/payments/${encodeURIComponent(paymentReference)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.BICE_API_KEY}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`BICE verifyPayment ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const status = String(data.status || "").toLowerCase();
  const normalized = status === "paid" || status === "approved" ? "paid"
    : status === "failed" || status === "rejected" ? "failed"
    : "pending";
  return { status: normalized, mode: "live", raw: data };
}
