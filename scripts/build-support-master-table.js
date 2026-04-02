#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const DEFAULT_OUT_DIR = path.resolve(process.cwd(), "data/output/support-master");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function printUsage() {
  console.error(
    [
      "Uso:",
      "  node scripts/build-support-master-table.js \\",
      "    --support-export <zip tickets/users> \\",
      "    --support-events <zip ticket-updates/field-changes> \\",
      "    [--resolved-view <csv>] \\",
      "    [--satisfaction <csv>] \\",
      "    [--out-dir <dir>]",
      "",
      "Salida:",
      "  support_ticket_master.csv",
      "  support_requester_master.csv",
      "  support_ticket_updates_enriched.csv",
      "  support_ticket_field_changes_enriched.csv",
    ].join("\n"),
  );
}

function normalize(value) {
  return String(value ?? "").trim();
}

function detectDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function stripBom(value) {
  if (!value) return value;
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function createCsvTokenizer(delimiter, onRow) {
  const state = {
    delimiter,
    onRow,
    field: "",
    row: [],
    inQuotes: false,
  };

  function pushField() {
    state.row.push(state.field);
    state.field = "";
  }

  function emitRow() {
    if (!state.row.length && !state.field) return;
    pushField();
    const normalized = state.row.map((value, index) => (index === 0 ? stripBom(value) : value));
    state.onRow(normalized);
    state.row = [];
  }

  return {
    write(chunk) {
      const text = String(chunk ?? "");
      for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        const next = text[i + 1];

        if (state.inQuotes) {
          if (char === '"') {
            if (next === '"') {
              state.field += '"';
              i += 1;
            } else {
              state.inQuotes = false;
            }
          } else {
            state.field += char;
          }
          continue;
        }

        if (char === '"') {
          state.inQuotes = true;
          continue;
        }
        if (char === state.delimiter) {
          pushField();
          continue;
        }
        if (char === "\n") {
          if (state.field.endsWith("\r")) {
            state.field = state.field.slice(0, -1);
          }
          emitRow();
          continue;
        }
        state.field += char;
      }
    },
    finish() {
      if (state.field.endsWith("\r")) {
        state.field = state.field.slice(0, -1);
      }
      emitRow();
    },
  };
}

function rowsToObjects(rows) {
  const [headerRow, ...dataRows] = rows;
  const headers = (headerRow || []).map((value) => normalize(value));
  return dataRows
    .filter((row) => row.some((cell) => normalize(cell)))
    .map((row) =>
      headers.reduce((acc, header, index) => {
        acc[header] = row[index] ?? "";
        return acc;
      }, {}),
    );
}

function parseCsvText(text, delimiter) {
  const rows = [];
  const tokenizer = createCsvTokenizer(delimiter, (row) => rows.push(row));
  tokenizer.write(text);
  tokenizer.finish();
  return rowsToObjects(rows);
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (!/[",\n]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, "\"\"")}"`;
}

function writeCsvRow(stream, values) {
  stream.write(`${values.map(csvEscape).join(",")}\n`);
}

function appendListEntry(map, key, value) {
  const normalizedKey = normalize(key);
  const normalizedValue = normalize(value);
  if (!normalizedKey || !normalizedValue) return;
  if (!map.has(normalizedKey)) map.set(normalizedKey, []);
  map.get(normalizedKey).push(normalizedValue);
}

function uniqueSorted(values) {
  return [...new Set(values.map(normalize).filter(Boolean))].sort();
}

function joinUnique(values, separator = " | ") {
  return uniqueSorted(values).join(separator);
}

function inferCaseFamily({
  subject = "",
  form = "",
  tags = "",
  fieldPairs = "",
  consultationHint = "",
}) {
  const haystack = [subject, form, tags, fieldPairs, consultationHint]
    .map((part) => normalize(part).toUpperCase())
    .join(" | ");

  if (/(ALLURION|ORBERA|BALON)/.test(haystack)) return "balones";
  if (/(ABDOMIN|PLASTIC|MASTO|LIPO|PANNICULECT)/.test(haystack)) return "plastica";
  if (/(MANGA|BYPASS|BARIATR|SLEEVE)/.test(haystack)) return "bariatrica";
  if (/(COLECIST|HERNIA|DIGEST|GENERAL|GASTRO)/.test(haystack)) return "cirugia_general";
  if (/(CIRUGIA|BALON)/.test(haystack)) return "cirugia_o_balon";
  return "";
}

function buildSupportUserMap(userRecords) {
  const map = new Map();
  for (const row of userRecords) {
    const id = normalize(row.id);
    if (!id) continue;
    map.set(id, {
      id,
      name: normalize(row.name),
      email: normalize(row.email),
      phone: normalize(row.phone),
      externalId: normalize(row.external_id),
      role: normalize(row.role),
      status: normalize(row.status),
    });
  }
  return map;
}

function readZipCsvRecords(zipPath, entryName) {
  const result = spawnSync("unzip", ["-p", zipPath, entryName], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512,
  });
  if (result.status !== 0) {
    throw new Error(`No pude leer ${entryName} desde ${zipPath}: ${result.stderr || result.stdout}`);
  }
  return parseCsvText(result.stdout, ";");
}

function readPlainCsvRecords(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return parseCsvText(content, detectDelimiter(content));
}

async function streamZipCsvRows(zipPath, entryName, onRow) {
  const child = spawn("unzip", ["-p", zipPath, entryName], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  let headers = null;
  const tokenizer = createCsvTokenizer(";", (row) => {
    if (!headers) {
      headers = row.map((value) => normalize(value));
      return;
    }
    if (!row.some((cell) => normalize(cell))) return;
    const objectRow = headers.reduce((acc, header, index) => {
      acc[header] = row[index] ?? "";
      return acc;
    }, {});
    onRow(objectRow);
  });

  child.stdout.on("data", (chunk) => {
    tokenizer.write(chunk.toString("utf8"));
  });

  await once(child.stdout, "end");
  tokenizer.finish();

  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(`No pude leer ${entryName} desde ${zipPath}: ${stderr}`.trim());
  }
}

function buildRequesterStats(tickets) {
  const stats = new Map();
  for (const ticket of tickets) {
    const requesterId = normalize(ticket.requester_id);
    if (!requesterId) continue;
    const createdAt = normalize(ticket.created_at);
    if (!stats.has(requesterId)) {
      stats.set(requesterId, {
        requesterId,
        ticketIds: [],
        channels: [],
        statuses: [],
        forms: [],
        latestTicketAt: "",
        latestTicketId: "",
      });
    }
    const current = stats.get(requesterId);
    current.ticketIds.push(normalize(ticket.id));
    current.channels.push(normalize(ticket.channel));
    current.statuses.push(normalize(ticket.status));
    current.forms.push(normalize(ticket.form));
    if (createdAt >= current.latestTicketAt) {
      current.latestTicketAt = createdAt;
      current.latestTicketId = normalize(ticket.id);
    }
  }
  return stats;
}

function buildResolvedViewMap(records) {
  const map = new Map();
  for (const row of records) {
    const ticketId = normalize(row.ID);
    if (!ticketId) continue;
    map.set(ticketId, {
      consulta: normalize(row["Consulta Cirugia/Balon"]),
      assignee: normalize(row["Agente asignado"]),
      requesterName: normalize(row.Solicitante),
      requestedAt: normalize(row.Solicitado),
      status: normalize(row["Estado del ticket"]),
    });
  }
  return map;
}

function buildSatisfactionMap(records) {
  const map = new Map();
  for (const row of records) {
    const ticketId = normalize(row["ID del ticket"]);
    if (!ticketId) continue;
    map.set(ticketId, {
      assigneeName: normalize(row["Nombre del agente asignado"]),
      requesterName: normalize(row["Nombre del solicitante"]),
      comment: normalize(row["Comentario de satisfacción del ticket"]),
      goodScore: normalize(row["Tickets con satisfacción buena"]),
    });
  }
  return map;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["support-export"] || !args["support-events"]) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const supportExportZip = path.resolve(args["support-export"]);
  const supportEventsZip = path.resolve(args["support-events"]);
  const resolvedViewPath = args["resolved-view"] ? path.resolve(args["resolved-view"]) : null;
  const satisfactionPath = args.satisfaction ? path.resolve(args.satisfaction) : null;
  const outDir = path.resolve(args["out-dir"] || DEFAULT_OUT_DIR);

  ensureDirectory(outDir);

  const tickets = readZipCsvRecords(supportExportZip, "tickets.csv");
  const users = readZipCsvRecords(supportExportZip, "users.csv");
  const ticketTags = readZipCsvRecords(supportExportZip, "ticket-tags.csv");
  const ticketFieldStrings = readZipCsvRecords(supportExportZip, "ticket-fields-string.csv");
  const userFieldStrings = readZipCsvRecords(supportExportZip, "user-fields-string.csv");

  const userMap = buildSupportUserMap(users);
  const requesterStats = buildRequesterStats(tickets);

  const ticketTagsMap = new Map();
  for (const row of ticketTags) {
    appendListEntry(ticketTagsMap, row.ticket_id, row.tag);
  }

  const ticketFieldMap = new Map();
  for (const row of ticketFieldStrings) {
    const pair = `${normalize(row.custom_field_id)}=${normalize(row.custom_field_value)}`;
    appendListEntry(ticketFieldMap, row.ticket_id, pair);
  }

  const userFieldMap = new Map();
  for (const row of userFieldStrings) {
    const pair = `${normalize(row.custom_field_id)}=${normalize(row.custom_field_value)}`;
    appendListEntry(userFieldMap, row.user_id, pair);
  }

  const resolvedViewMap = resolvedViewPath ? buildResolvedViewMap(readPlainCsvRecords(resolvedViewPath)) : new Map();
  const satisfactionMap = satisfactionPath ? buildSatisfactionMap(readPlainCsvRecords(satisfactionPath)) : new Map();

  const ticketMasterPath = path.join(outDir, "support_ticket_master.csv");
  const requesterMasterPath = path.join(outDir, "support_requester_master.csv");
  const updatesPath = path.join(outDir, "support_ticket_updates_enriched.csv");
  const fieldChangesPath = path.join(outDir, "support_ticket_field_changes_enriched.csv");

  const ticketMasterStream = fs.createWriteStream(ticketMasterPath, "utf8");
  writeCsvRow(ticketMasterStream, [
    "ticket_id",
    "requester_id",
    "requester_name",
    "requester_email",
    "requester_phone",
    "requester_external_id",
    "requester_user_fields",
    "requester_ticket_count",
    "requester_all_ticket_ids",
    "submitter_id",
    "assignee_id",
    "assignee_name",
    "subject",
    "created_at",
    "updated_at",
    "solved_at",
    "assigned_at",
    "channel",
    "type",
    "status",
    "priority",
    "brand",
    "group",
    "form",
    "custom_status_id",
    "satisfaction_score",
    "satisfaction_comment",
    "satisfaction_reason",
    "tags",
    "ticket_field_pairs",
    "resolved_view_consulta",
    "resolved_view_assignee",
    "resolved_view_requested_at",
    "good_rating_assignee",
    "good_rating_comment",
    "case_family_hint",
  ]);

  for (const ticket of tickets) {
    const ticketId = normalize(ticket.id);
    const requesterId = normalize(ticket.requester_id);
    const assigneeId = normalize(ticket.assignee_id);
    const requester = userMap.get(requesterId) || {};
    const assignee = userMap.get(assigneeId) || {};
    const tags = joinUnique(ticketTagsMap.get(ticketId) || []);
    const ticketFields = joinUnique(ticketFieldMap.get(ticketId) || []);
    const requesterFields = joinUnique(userFieldMap.get(requesterId) || []);
    const stats = requesterStats.get(requesterId) || {
      ticketIds: [],
      channels: [],
      statuses: [],
      forms: [],
      latestTicketAt: "",
      latestTicketId: "",
    };
    const resolvedView = resolvedViewMap.get(ticketId) || {};
    const satisfaction = satisfactionMap.get(ticketId) || {};
    const caseFamilyHint = inferCaseFamily({
      subject: ticket.subject,
      form: ticket.form,
      tags,
      fieldPairs: ticketFields,
      consultationHint: resolvedView.consulta,
    });

    writeCsvRow(ticketMasterStream, [
      ticketId,
      requesterId,
      requester.name,
      requester.email,
      requester.phone,
      requester.externalId,
      requesterFields,
      stats.ticketIds.length,
      stats.ticketIds.join(" | "),
      normalize(ticket.submitter_id),
      assigneeId,
      assignee.name,
      normalize(ticket.subject),
      normalize(ticket.created_at),
      normalize(ticket.updated_at),
      normalize(ticket.solved_at),
      normalize(ticket.assigned_at),
      normalize(ticket.channel),
      normalize(ticket.type),
      normalize(ticket.status),
      normalize(ticket.priority),
      normalize(ticket.brand),
      normalize(ticket.group),
      normalize(ticket.form),
      normalize(ticket.custom_status_id),
      normalize(ticket.satisfaction_score),
      normalize(ticket.satisfaction_comment),
      normalize(ticket.satisfaction_reason),
      tags,
      ticketFields,
      resolvedView.consulta || "",
      resolvedView.assignee || "",
      resolvedView.requestedAt || "",
      satisfaction.assigneeName || "",
      satisfaction.comment || "",
      caseFamilyHint,
    ]);
  }
  ticketMasterStream.end();

  const requesterMasterStream = fs.createWriteStream(requesterMasterPath, "utf8");
  writeCsvRow(requesterMasterStream, [
    "requester_id",
    "requester_name",
    "requester_email",
    "requester_phone",
    "requester_external_id",
    "requester_user_fields",
    "ticket_count",
    "ticket_ids",
    "channels",
    "statuses",
    "forms",
    "latest_ticket_at",
    "latest_ticket_id",
  ]);

  for (const [requesterId, stats] of [...requesterStats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const requester = userMap.get(requesterId) || {};
    writeCsvRow(requesterMasterStream, [
      requesterId,
      requester.name,
      requester.email,
      requester.phone,
      requester.externalId,
      joinUnique(userFieldMap.get(requesterId) || []),
      stats.ticketIds.length,
      joinUnique(stats.ticketIds),
      joinUnique(stats.channels),
      joinUnique(stats.statuses),
      joinUnique(stats.forms),
      stats.latestTicketAt,
      stats.latestTicketId,
    ]);
  }
  requesterMasterStream.end();

  const ticketIndex = new Map();
  for (const ticket of tickets) {
    ticketIndex.set(normalize(ticket.id), ticket);
  }

  const updatesStream = fs.createWriteStream(updatesPath, "utf8");
  writeCsvRow(updatesStream, [
    "update_id",
    "ticket_id",
    "ticket_subject",
    "requester_id",
    "requester_name",
    "requester_phone",
    "updater_id",
    "updater_name",
    "assignee_id",
    "assignee_name",
    "update_timestamp",
    "update_via",
    "status",
    "previous_status",
    "group_name",
    "brand_name",
    "comment_present",
    "public_comment",
    "ticket_channel",
    "ticket_form",
    "ticket_tags",
    "ticket_field_pairs",
    "resolved_view_consulta",
    "case_family_hint",
  ]);

  let updatesCount = 0;
  await streamZipCsvRows(supportEventsZip, "ticket-updates.csv", async (row) => {
    const ticketId = normalize(row.ticket_id);
    const ticket = ticketIndex.get(ticketId) || {};
    const requesterId = normalize(ticket.requester_id);
    const requester = userMap.get(requesterId) || {};
    const updater = userMap.get(normalize(row.updater_id)) || {};
    const assignee = userMap.get(normalize(row.assignee_id)) || {};
    const tags = joinUnique(ticketTagsMap.get(ticketId) || []);
    const ticketFields = joinUnique(ticketFieldMap.get(ticketId) || []);
    const resolvedView = resolvedViewMap.get(ticketId) || {};
    const caseFamilyHint = inferCaseFamily({
      subject: ticket.subject,
      form: ticket.form,
      tags,
      fieldPairs: ticketFields,
      consultationHint: resolvedView.consulta,
    });

    writeCsvRow(updatesStream, [
      normalize(row.id),
      ticketId,
      normalize(ticket.subject),
      requesterId,
      requester.name,
      requester.phone,
      normalize(row.updater_id),
      normalize(row.updater_name) || updater.name,
      normalize(row.assignee_id),
      normalize(row.assignee_name) || assignee.name,
      normalize(row.ticket_updated_at),
      normalize(row.update_via),
      normalize(row.status),
      normalize(row.previous_status),
      normalize(row.group_name),
      normalize(row.brand_name),
      normalize(row.comment_present),
      normalize(row.public_comment),
      normalize(ticket.channel),
      normalize(ticket.form),
      tags,
      ticketFields,
      resolvedView.consulta || "",
      caseFamilyHint,
    ]);
    updatesCount += 1;
  });
  updatesStream.end();

  const fieldChangesStream = fs.createWriteStream(fieldChangesPath, "utf8");
  writeCsvRow(fieldChangesStream, [
    "ticket_update_id",
    "ticket_id",
    "ticket_subject",
    "requester_id",
    "requester_name",
    "field_name",
    "field_type",
    "new_value",
    "previous_value",
    "change_date",
    "duration_in_minutes",
    "ticket_channel",
    "ticket_form",
    "ticket_tags",
    "resolved_view_consulta",
    "case_family_hint",
  ]);

  let fieldChangesCount = 0;
  await streamZipCsvRows(supportEventsZip, "ticket-field-changes.csv", async (row) => {
    const ticketId = normalize(row.ticket_id);
    const ticket = ticketIndex.get(ticketId) || {};
    const requesterId = normalize(ticket.requester_id);
    const requester = userMap.get(requesterId) || {};
    const tags = joinUnique(ticketTagsMap.get(ticketId) || []);
    const ticketFields = joinUnique(ticketFieldMap.get(ticketId) || []);
    const resolvedView = resolvedViewMap.get(ticketId) || {};
    const caseFamilyHint = inferCaseFamily({
      subject: ticket.subject,
      form: ticket.form,
      tags,
      fieldPairs: ticketFields,
      consultationHint: resolvedView.consulta,
    });

    writeCsvRow(fieldChangesStream, [
      normalize(row.ticket_update_id),
      ticketId,
      normalize(ticket.subject),
      requesterId,
      requester.name,
      normalize(row.field_name),
      normalize(row.field_type),
      normalize(row.new_value),
      normalize(row.previous_value),
      normalize(row.change_date),
      normalize(row.duration_in_minutes),
      normalize(ticket.channel),
      normalize(ticket.form),
      tags,
      resolvedView.consulta || "",
      caseFamilyHint,
    ]);
    fieldChangesCount += 1;
  });
  fieldChangesStream.end();

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir,
        tickets: tickets.length,
        requesters: requesterStats.size,
        updates: updatesCount,
        fieldChanges: fieldChangesCount,
        outputs: {
          ticketMaster: ticketMasterPath,
          requesterMaster: requesterMasterPath,
          updates: updatesPath,
          fieldChanges: fieldChangesPath,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
