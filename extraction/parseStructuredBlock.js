import { extractEmail, extractPhone, extractRut } from "./identity-normalizers.js";
import { parseAseguradora, parseFonasaTramo } from "./parseInsurance.js";
import { parseMeasurements, calculateBMI, getBMICategory } from "./parseMeasurements.js";
import { titleCaseWords } from "../utils/text.js";

export function parseStructuredBlock(text) {
  const source = String(text || "");
  const result = {};

  const nameMatch = source.match(/(?:full\s*name|nombre(?:\s+completo)?)\s*:?\s*([^\n]+)/i);
  if (nameMatch) result.fullName = titleCaseWords(nameMatch[1].trim());

  result.email = extractEmail(source);
  result.phone = extractPhone(source);
  result.rut = extractRut(source);

  const cityMatch = source.match(/(?:city|ciudad|comuna)\s*:?\s*([^\n]+)/i);
  if (cityMatch) result.city = titleCaseWords(cityMatch[1].trim());

  const dobMatch = source.match(/(?:fecha\s+de\s+nacimiento|birth(?:\s*date)?)\s*:?\s*([^\n]+)/i);
  if (dobMatch) result.birthDate = dobMatch[1].trim();

  const insurance = parseAseguradora(source);
  if (insurance?.aseguradora) result.insurance = insurance.aseguradora;

  const tramo = parseFonasaTramo(source);
  if (tramo?.modalidad) result.modality = tramo.modalidad;

  const measurements = parseMeasurements(source);
  if (measurements?.weightKg) result.weightKg = measurements.weightKg;
  if (measurements?.heightM) result.heightM = measurements.heightM;
  if (measurements?.heightCm) result.heightCm = measurements.heightCm;
  if (measurements?.weightKg && measurements?.heightM) {
    const bmi = calculateBMI(measurements.weightKg, measurements.heightM);
    result.bmi = bmi;
    result.bmiCategory = getBMICategory(bmi);
  }

  return result;
}
