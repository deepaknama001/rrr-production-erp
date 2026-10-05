# RRR Production ERP

Pre-inventory production ERP for RRR. It covers Raw Fabric → Dyeing → Production/Cutting → Stitching → QC/Rework → Warehouse Handover.

Architecture matches the existing RRR Warehouse system:
- Cloudflare Pages frontend
- Cloudflare Pages Functions secure gateway
- Google Apps Script business logic/auth
- Google Sheets permanent database
- No business data stored in Cloudflare

Google database spreadsheet ID currently targeted by setup: `1iTKvM-KaGd3HuoknpyYz9IYpFRw1dtFlmv2f8sZo-HA`

Cloudflare secrets required: `GAS_WEB_APP_URL`, `GAS_API_SECRET`, `SESSION_SECRET`.
