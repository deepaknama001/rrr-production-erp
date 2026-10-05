# Deployment

1. Open `RRR Production ERP Database` Google Sheet.
2. Extensions → Apps Script.
3. Paste `apps-script/Code.gs`, `Setup.gs`, and optionally `appsscript.json`.
4. Run `setupProductionERP()` once.
5. Run `createOrResetAdmin()`.
6. Deploy → New deployment → Web app → Execute as Me → Anyone.
7. Copy `/exec` URL.
8. Connect this repo to Cloudflare Pages: framework None, build blank, output directory `public`.
9. Set Cloudflare secrets: `GAS_WEB_APP_URL`, `GAS_API_SECRET`, `SESSION_SECRET`.
