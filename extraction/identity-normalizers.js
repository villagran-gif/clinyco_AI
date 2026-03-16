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

export function extractRut(text) {
  const source = String(text || "").toUpperCase();
  const match = source.match(/\b(\d{7,8})[-\s.]?([\dK])\b/);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

export function formatRutHuman(rut) {
  const clean = String(rut || "").replace(/[^0-9Kk]/g, "").toUpperCase();
  if (clean.length < 2) return null;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  return `${body}-${dv}`;
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
