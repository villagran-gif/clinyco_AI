#!/usr/bin/env node
import { knowledgeSheetDefinitions } from "../knowledge/sheet-definitions.js";
import {
  normalizeBooleanLike,
  normalizeCurrencyClp,
  normalizeDurationMinutes,
  normalizeTelemedicine,
  summarizeRowForAi
} from "../knowledge/normalizers.js";

function clean(value) {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function parseBoolean(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return ["si", "s", "true", "1", "yes"].includes(text);
}

function parseList(value) {
  const text = clean(value);
  if (!text) return [];
  return text
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRecord(definition, row) {
  const record = {};
  for (const column of definition.columns) {
    const rawValue = row[column.header] ?? row[column.key] ?? "";
    if (column.type === "boolean") {
      record[column.key] = parseBoolean(rawValue);
      continue;
    }
    if (column.type === "list") {
      record[column.key] = parseList(rawValue);
      continue;
    }
    record[column.key] = clean(rawValue);
  }

  if (record.valor) {
    const currency = normalizeCurrencyClp(record.valor);
    record.valor_normalizado_clp = currency.amount;
    record.valor_interpretado = currency.label;
    record.valor_observaciones = currency.notes;
  }

  if (record.duracion) {
    const duration = normalizeDurationMinutes(record.duracion);
    record.duracion_minutos = duration.minutes;
    record.duracion_interpretada = duration.label;
    record.duracion_observaciones = duration.notes;
  }

  if (record.previo_pago !== undefined && record.previo_pago !== null) {
    const prev = normalizeBooleanLike(record.previo_pago);
    record.previo_pago_interpretado = prev.label;
    record.previo_pago_observaciones = prev.notes;
  }

  if (record.telemedicina) {
    const tele = normalizeTelemedicine(record.telemedicina);
    record.telemedicina_interpretada = tele.label;
    record.telemedicina_codigo = tele.mode;
    record.telemedicina_observaciones = tele.notes;
  }

  const ai = summarizeRowForAi(record, definition.key);
  record.interpretacion_ia = ai.preview || null;
  record.observaciones_ia = ai.notes;

  return record;
}

function main() {
  const [, , tabName, jsonInput] = process.argv;
  if (!tabName || !jsonInput) {
    console.error('Uso: node scripts/preview-knowledge-row.js "profesionales" \'{"Valor":"70000"}\'');
    process.exit(1);
  }

  const definition = knowledgeSheetDefinitions.find((item) => item.tabName === tabName);
  if (!definition) {
    console.error(`Pestana no soportada: ${tabName}`);
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(jsonInput);
  } catch (error) {
    console.error(`JSON invalido: ${error.message}`);
    process.exit(1);
  }

  const normalized = normalizeRecord(definition, payload);
  console.log(JSON.stringify(normalized, null, 2));
}

main();
