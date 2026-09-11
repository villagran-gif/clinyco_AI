# Restore archived Sell DEALS created in 2026

The import runs inside the existing application's database connection. It does not expose a public import route and does not create contacts. Source tables and CSV exports remain unchanged.

## Sources and safeguards

- Select `deals.added_at` in `[2026-01-01, 2027-01-01)`; use original Sell IDs, pipeline IDs and stage IDs.
- Complete missing valid fields from `sell_deals_cache` and the two existing April CSV exports, joined only by the original deal ID.
- Preserve source rows, rejected values, field provenance and CSV hashes in the private database. Do not add patient data to code, logs or PRs.
- Exclude records that exist only in the older cache. Their absence from the latest snapshot needs separate review.
- Abort if reviewed per-pipeline counts differ or a strong identity collides with a current manually created deal.
- Import in one transaction with an advisory lock, a unique source ID index and a completion ledger. A second run does not overwrite operator edits or re-create deliberately deleted records.

Historical DEALS have no `contact_id`; current Chatwoot flows keep their existing safeguards. Board and task queries support both. The table shows the original Sell ID and starts without a month filter; selecting a month filters historical creation dates or current Chatwoot activity.

## Running

Set `CRM_RESTORE_SELL_2026_COUNTS` to the reviewed JSON counts by CRM pipeline ID. Operational counts belong in environment configuration, not the public repository.

With the application's authorized database environment:

```sh
node scripts/restore-sell-2026.mjs --dry-run
node scripts/restore-sell-2026.mjs --apply
```

For the managed application deployment, `CRM_RESTORE_SELL_2026=dry-run` or `apply` runs the same job once at startup. Set it to `off` after verification. Missing counts or an unrecognized pipeline/stage fail the import. The job emits only aggregate summaries or redacted failure codes.

## Link validation

- Medinet: exact Clinyco hostname and a recognized patient ID path. Remove extra numeric tab suffixes, preserving the same patient and first section. Do not reconstruct incomplete hostnames or infer a patient from a name.
- Exams: a Google Drive folder or file resource. Normalize account-specific `/u/N/` paths and retain a supplied resource key. Text such as an IMC is not a URL.
- Phone: normalize country code and accepted number formatting, including the export's leading apostrophe; reject labels, dates and RUT-shaped strings. Generate `tel:` and `wa.me` destinations from the normalized number.
- Email: validate the address and use an encoded `mailto:` link.
- Chatwoot: only use existing, verified conversation references for account 162472. Sell contact IDs are not Chatwoot IDs. This archive does not establish new conversation associations.

Validation checks format and destination type. It does not open private clinical files or establish that a recipient, phone number or Drive permission is currently active.

Unlinked legacy notes and stale next-task snapshots remain source data; they are not turned into new notes or current pending tasks without reliable association and status. The interactive task list continues to show tasks created in this CRM.

## Verification

The PGlite integration test exercises rollback, dry runs, duplicate prevention, preservation of a live deal, independent same-person deals, original dates, General, editing legacy labels/branches, notes, tasks, and re-running after an operator edit. JSDOM checks the independent deal dialog and communication/document links. Production verification compares the ledger, source IDs, per-pipeline counts, stored dates and URL formats after deployment.
