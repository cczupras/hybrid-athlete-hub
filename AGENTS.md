# Agent Instructions & Architecture Guardrails (Hybrid Athlete Hub)

You are building the **Hybrid Athlete Hub**, a serverless PWA and Google Apps Script backend for a hybrid athlete (Running, Cycling, CrossFit, and Home Gym barbell training).

## Strict Technical Constraints (DO NOT VIOLATE)
1. **Zero Build Step Frontend:** Located in docs/. Use strictly Vanilla HTML5, Vanilla ES6 JavaScript (docs/app.js), Tailwind CSS via CDN, Chart.js via CDN, and Marked.js via CDN. Do NOT initialize npm, Vite, Webpack, or React.
2. **CORS-Free GAS Communication:** All `fetch()` requests from docs/app.js to the Google Apps Script Web App MUST use:
   - Method: POST
   - Header: 'Content-Type': 'text/plain;charset=utf-8' (Strictly required to prevent browser CORS preflight failures with Google Apps Script doPost).
   - Body: JSON.stringify({ pin, action, data })
3. **Zero Hardcoded Secrets:** Never put API keys or the GAS Web App URL in the code. The frontend reads GAS_URL and APP_PIN from localStorage. Provide a clean Settings Modal in the UI to configure them.
4. **Demo / Mock Mode First:** In docs/app.js, implement a MOCK_MODE fallback (automatically active if GAS_URL is empty or set to "mock"). Populate it with realistic 14-day hybrid athlete data (Garmin runs/rides, CrossFit WODs, Home Gym squats/deadlifts, HRV/Sleep scores) so the UI can be previewed and verified in the browser immediately.
5. **Google Apps Script Environment:** Files in gas-backend/ (Code.gs, GarminSync.gs, GeminiCoach.gs) run in the V8 Apps Script runtime. Share functions globally across .gs files (no ES6 import/export). Use UrlFetchApp, SpreadsheetApp, and PropertiesService.
