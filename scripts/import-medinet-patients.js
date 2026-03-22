#!/usr/bin/env node

const sourcePath = process.argv[2] || null;

if (!sourcePath) {
  console.error("Usage: node scripts/import-medinet-patients.js <patients.csv>");
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      ok: false,
      status: "pending",
      message: "CSV import placeholder for future Medinet patient export",
      sourcePath
    })
  );
}
