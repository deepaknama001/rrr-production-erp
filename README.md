# RRR Production ERP

Pre-inventory production ERP for RRR covering Raw Fabric → Dyeing → Production/Cutting → Stitching → QC/Rework → Warehouse Handover.

## Architecture

### Current / fallback
- Cloudflare Pages frontend
- Cloudflare Pages Functions secure API
- Google Apps Script + Google Sheets

### D1 primary mode
- Cloudflare Pages frontend
- Cloudflare Pages Functions business logic
- Cloudflare D1 primary transactional database
- Google Sheets retained as migration source / rollback source / optional reporting mirror

The API is hybrid. Until D1 migration is explicitly activated, Google Sheets remains the live backend. After activation, the same frontend/API URLs use D1 automatically. Admin can rollback to Google Sheets without deleting D1 data.

## D1 migration safety

1. Create a D1 database in the same Cloudflare account/project environment.
2. Bind it to the Pages project using binding name `DB`.
3. Deploy the latest Apps Script `Code.gs` so the secure snapshot-export action exists.
4. Login as Admin → Users → Database Migration.
5. Click **Load Sheet → D1**.
6. Confirm every table row count matches.
7. Click **Activate D1** only after reconciliation passes.
8. If needed, **Rollback to Sheets** immediately switches API reads/writes back to GAS/Sheets.

Migration copies Users, Vendors, Fabrics, Colors, Styles, Sizes, Defect Reasons, Raw Inward, Dye Jobs, Dye Receipts, Production, Stitching, QC, Warehouse Handover, Audit Log, and Settings. Existing PIN hashes are migrated securely at runtime and are never committed to Git.

## D1 files

- `migrations/0001_d1_schema.sql` — canonical SQL schema
- `functions/_lib/d1-schema.js` — runtime bootstrap schema
- `functions/_lib/d1.js` — D1 auth, business logic, stock math, idempotency, migration/reconciliation
- `functions/api/admin/d1-migrate.js` — admin migration/load/activate/rollback endpoint

Google database spreadsheet ID currently used for migration/fallback:
`1iTKvM-KaGd3HuoknpyYz9IYpFRw1dtFlmv2f8sZo-HA`

Cloudflare secrets still required during migration/fallback:
- `GAS_WEB_APP_URL`
- `GAS_API_SECRET`
- `SESSION_SECRET`

After final D1 cutover and a deliberate retirement period, GAS secrets can be removed only if Google Sheets fallback/mirroring is no longer required.
