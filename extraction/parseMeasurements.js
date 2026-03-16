import { normalizeSpaces } from "../utils/text.js";

export function normalizeMeasurementNumber(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/,/g, ".").replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

export function calculateBMI(weightKg, heightM) {
  if (!weightKg || !heightM || heightM <= 0) return null;
  const bmi = weightKg / (heightM * heightM);
  return Math.round(bmi * 10) / 10;
}

export function getBMICategory(bmi) {
  if (bmi === null || bmi === undefined) return null;
  if (bmi < 18.5) return "Bajo peso";
  if (bmi < 25) return "Peso normal";
  if (bmi < 30) return "Sobrepeso";
  if (bmi < 35) return "Obesidad grado 1";
  if (bmi < 40) return "Obesidad grado 2";
  return "Obesidad grado 3";
}

export function parseMeasurements(text) {
  const source = String(text || "");
  const normalized = normalizeSpaces(source.toLowerCase());
  let weightKg = null;
  let heightM = null;
  let fromCm = false;
  let ambiguous = false;
  let reason = null;

  const explicitWeight = normalized.match(/(?:peso\s*:?\s*)?(\d{2,3})(?:\s*(?:kg|kilo|kilos))\b/i);
  if (explicitWeight) weightKg = normalizeMeasurementNumber(explicitWeight[1]);

  const explicitHeightMeters = normalized.match(/(?:altura|estatura|mido)\s*:?\s*(1[.,]\d{1,2}|2[.,]0{1,2})\s*(?:m|metro|metros)?\b/i)
    || normalized.match(/\b(1[.,]\d{1,2}|2[.,]0{1,2})\s*(?:m|metro|metros)\b/i);
  if (explicitHeightMeters) heightM = normalizeMeasurementNumber(explicitHeightMeters[1]);

  const explicitHeightCm = normalized.match(/(?:altura|estatura|mido)\s*:?\s*(\d{3})\s*cm\b/i)
    || normalized.match(/\b(\d{3})\s*cm\b/i);
  if (!heightM && explicitHeightCm) {
    const cm = normalizeMeasurementNumber(explicitHeightCm[1]);
    if (cm) {
      heightM = Math.round((cm / 100) * 100) / 100;
      fromCm = true;
    }
  }

  if (weightKg && heightM) {
    if (weightKg < 25 || weightKg > 350 || heightM < 1.2 || heightM > 2.2) return null;
    return { weightKg, heightM, heightCm: Math.round(heightM * 100), ambiguous: false, fromCm, reason: null };
  }

  const pairMatches = Array.from(normalized.matchAll(/\b(\d{2,3}(?:[.,]\d{1,2})?)\b/g)).map((m) => m[1]);
  if (pairMatches.length >= 2) {
    const numbers = pairMatches.slice(0, 3).map((v) => normalizeMeasurementNumber(v)).filter(Boolean);
    if (numbers.length >= 2) {
      const [a, b] = numbers;
      if (!weightKg && !heightM) {
        if (a >= 40 && a <= 250 && b >= 120 && b <= 220) {
          weightKg = a;
          heightM = Math.round((b / 100) * 100) / 100;
          fromCm = true;
          ambiguous = true;
          reason = "pair_weight_cm";
        } else if (a >= 120 && a <= 220 && b >= 40 && b <= 250) {
          weightKg = b;
          heightM = Math.round((a / 100) * 100) / 100;
          fromCm = true;
          ambiguous = true;
          reason = "pair_cm_weight";
        } else if (a >= 40 && a <= 250 && b >= 1.2 && b <= 2.2) {
          weightKg = a;
          heightM = b;
          ambiguous = true;
          reason = "pair_weight_m";
        } else if (a >= 1.2 && a <= 2.2 && b >= 40 && b <= 250) {
          weightKg = b;
          heightM = a;
          ambiguous = true;
          reason = "pair_m_weight";
        }
      }
    }
  }

  if (!weightKg && !heightM) return null;
  if (weightKg && (weightKg < 25 || weightKg > 350)) return null;
  if (heightM && (heightM < 1.2 || heightM > 2.2)) return null;

  return {
    weightKg: weightKg || null,
    heightM: heightM || null,
    heightCm: heightM ? Math.round(heightM * 100) : null,
    ambiguous,
    fromCm,
    reason
  };
}

export function buildBMIContext(text) {
  const parsed = parseMeasurements(text);
  if (!parsed || !parsed.weightKg || !parsed.heightM) return null;
  const bmi = calculateBMI(parsed.weightKg, parsed.heightM);
  if (!bmi) return null;
  return {
    weightKg: parsed.weightKg,
    heightM: parsed.heightM,
    heightCm: parsed.heightCm,
    bmi,
    category: getBMICategory(bmi),
    ambiguous: parsed.ambiguous,
    fromCm: parsed.fromCm,
    reason: parsed.reason
  };
}
