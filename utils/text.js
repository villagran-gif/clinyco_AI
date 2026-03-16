export function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function removeDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeKey(value) {
  return removeDiacritics(String(value || ""))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function titleCaseWords(value) {
  return normalizeSpaces(value)
    .toLowerCase()
    .replace(/(^|\s)([a-záéíóúñ])/g, (m, p1, p2) => `${p1}${p2.toUpperCase()}`);
}

export function includesAny(text, phrases) {
  const normalized = normalizeKey(text);
  return phrases.some((phrase) => normalized.includes(normalizeKey(phrase)));
}
