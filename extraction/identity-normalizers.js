import { normalizeKey, normalizeSpaces, titleCaseWords } from "../utils/text.js";

export function normalizePhone(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  const digits = value.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("56") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("9") && digits.length === 9) return `+56${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return value.startsWith("+") ? value : `+${digits}`;
  return null;
}

export function extractEmail(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].trim().toLowerCase() : null;
}

export function extractPhone(text) {
  const source = String(text || "");
  const matches = source.match(/(?:\+?56\s*)?9\s*\d(?:[\s.-]*\d){7,8}/g);
  if (!matches || !matches.length) return null;
  return normalizePhone(matches[0]);
}

function computeRutVerifierDigit(bodyDigits) {
  const digits = String(bodyDigits || "").replace(/\D/g, "");
  if (!digits) return null;

  let factor = 2;
  let total = 0;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    total += Number(digits[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }

  const remainder = 11 - (total % 11);
  if (remainder === 11) return "0";
  if (remainder === 10) return "K";
  return String(remainder);
}

export function validateRut(value) {
  const raw = String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (raw.length < 8 || raw.length > 9) return false;

  const body = raw.slice(0, -1);
  const dv = raw.slice(-1);
  if (!/^\d{7,8}$/.test(body)) return false;

  return computeRutVerifierDigit(body) === dv;
}

export function normalizeRut(value) {
  const raw = String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (!validateRut(raw)) return null;
  return `${raw.slice(0, -1)}-${raw.slice(-1)}`;
}

export function extractRut(text) {
  const source = String(text || "").toUpperCase();
  const matches = source.match(/\b\d{1,2}[.]?\d{3}[.]?\d{3}[-\s.]?[\dK]\b/g) || [];

  for (const candidate of matches) {
    const normalized = normalizeRut(candidate);
    if (normalized) return normalized;
  }

  return null;
}

export function formatRutHuman(rut) {
  const normalized = normalizeRut(rut);
  if (!normalized) return null;

  const clean = normalized.replace(/[^0-9K]/g, "");
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${withDots}-${dv}`;
}

export function splitNames(value) {
  const parts = normalizeSpaces(value).split(" ").filter(Boolean);
  if (!parts.length) return { nombres: null, apellidos: null };
  if (parts.length === 1) return { nombres: titleCaseWords(parts[0]), apellidos: null };
  return {
    nombres: titleCaseWords(parts.slice(0, -1).join(" ")),
    apellidos: titleCaseWords(parts.slice(-1).join(" "))
  };
}

export function extractName(text) {
  const source = String(text || "");
  const fullNameMatch = source.match(/(?:nombre(?:\s+completo)?|full\s*name)\s*:?\s*([^\n]+)/i);
  if (fullNameMatch) return fullNameMatch[1].trim();
  const asName = source.match(/\bmi nombre es\s+([^\n]+)/i);
  if (asName) return asName[1].trim();
  return null;
}

export function detectExistingPatientIntent(text) {
  return [
    "YA SOY PACIENTE",
    "YA SOY CLIENTE",
    "YA ME ATENDI",
    "YA TENGO FICHA",
    "TENGO FICHA",
    "SOY PACIENTE CLINYCO",
    "SOY PACIENTE"
  ].some((phrase) => normalizeKey(text).includes(phrase));
}
