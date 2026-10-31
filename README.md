# 🏋️‍♂️ Hybrid Athlete Hub

Ein serverloses Trainings-Analyse- und Planungssystem für Hybrid-Athleten (**Running, Cycling, CrossFit & Home Gym Barbell Training**). Kombiniert Daten aus der **Garmin Connect Personal API** mit schnellem Langhantel-Logging im Home Gym und einem **Gemini Hybrid Coach (`gemini-2.5-flash`)** – komplett gehostet über **Google Sheets + Google Apps Script** und **GitHub Pages**.

---

## ✨ Features

- **🚦 Readiness-Ampel:** Automatische Tagesbewertung (`Grün` / `Gelb` / `Rot`) aus Garmin `Sleep_Score`, `HRV_Night` vs. `HRV_7d_Avg` und `Resting_HR` vs. 7-Tage-Baseline.
- **🧭 Wochen-Kompass:** Fortschrittsbalken für die drei konkurrierenden Trainings-Buckets (**Engine**, **Heavy**, **Metcon**) gegen die Wochenziele in `Config_Targets`.
- **🔥 48h-Muskel- & ZNS-Interferenz-Heatmap:** Berechnet die Restbelastung auf *Beine, Push, Pull, ZNS* und *Cardio* und warnt vor schweren Kniebeugen/Kreuzheben innerhalb von 48 Stunden nach einem beinlastigen CrossFit-WOD oder harten Lauf.
- **🏋️ Home Gym Rack Logger (Mobile First):** Schnelle Gewichtseingabe (±2,5 kg Stepper, ±5/10 kg Quick-Chips), visueller **Hantelscheiben-Rechner** (pro Seite), RIR-Slider (0–5), Live-Epley-**e1RM** (`Gewicht × (1 + Wdh / 30)`) und automatischer PR-Vergleich.
- **🏷️ Activity Tagger:** Schnelles Nachpflegen von `Bucket`, `RPE (1–10)`, `Muscle_Focus` und Notizen für importierte Garmin-Aktivitäten oder CrossFit-WODs.
- **📈 Desktop-Analytics:** Zwei interaktive Chart.js-Graphen (*HRV & Schlaf vs. gestapelter Training Load* sowie *e1RM-Kraftprogression pro Langhantel-Übung*).
- **✨ Gemini Hybrid Coach:** Analysiert die letzten 10 Tage und liefert auf Knopfdruck (*„Was steht heute an?“*, *„Rack-Session planen“*, *„Wochen-Analyse“*) oder per Freitext konkrete Empfehlungen auf Deutsch.
- **🧪 Demo-/Mock-Modus ab Werk:** Solange keine `GAS_URL` hinterlegt ist, läuft die App automatisch mit realistischen 14-Tage-Hybrid-Daten zum sofortigen Testen.

---

## 📁 Projektstruktur

```text
hybrid-athlete-hub/
├── docs/                      # Zero-Build PWA Frontend (GitHub Pages Root)
│   ├── index.html             # UI (Tailwind CSS, Chart.js & Marked.js via CDN)
│   ├── app.js                 # Frontend-Logik, Analytics, Mock-Backend & API-Client
│   ├── sw.js                  # Service Worker (App-Shell Offline-Caching)
│   ├── manifest.json          # Web App Manifest für PWA-Installation
│   └── icon.svg               # App-Icon (Langhantel + HRV-Welle)
├── gas-backend/               # Google Apps Script Backend (V8 Runtime)
│   ├── Code.gs                # doPost-Router, setupDatabase(), Sheet- & Analyse-Helfer
│   ├── GarminSync.gs          # Garmin Personal API Sync mit Dubletten-freiem Upsert
│   └── GeminiCoach.gs         # Gemini 2.5 Flash Integration & System-Prompt
├── AGENTS.md                  # Architektur-Guardrails
└── SPEC.md                    # Technische Spezifikation & Datenbankschema
```

---

## 🚀 Live-System einrichten (Schritt-für-Schritt)

### Schritt 1: Google Sheet & Apps Script anlegen
1. Öffne [sheets.new](https://sheets.new) und erstelle ein neues Google Sheet (z. B. **„Hybrid Athlete Hub DB“**).
2. Klicke im Menü auf **Erweiterungen → Apps Script**.
3. Lege im Apps-Script-Editor folgende drei Skriptdateien an und kopiere jeweils den gesamten Dateiinhalt aus `gas-backend/` hinein:
   - **`Code.gs`** ← Inhalt aus `gas-backend/Code.gs`
   - **`GarminSync.gs`** *(über `+` → Skript hinzufügen)* ← Inhalt aus `gas-backend/GarminSync.gs`
   - **`GeminiCoach.gs`** *(über `+` → Skript hinzufügen)* ← Inhalt aus `gas-backend/GeminiCoach.gs`
4. Speichere das Projekt (`Strg + S`).

---

### Schritt 2: Script Properties (Geheimnisse) hinterlegen
1. Klicke im Apps-Script-Editor links auf das **Zahnrad-Symbol (Projekteinstellungen)**.
2. Scrolle nach unten zu **Skripteigenschaften (Script Properties)** → **Skripteigenschaft hinzufügen** und lege diese Keys an:

| Eigenschaft (Key) | Wert (Value) | Beschreibung |
| :--- | :--- | :--- |
| `APP_PIN` | z. B. `MeinGeheimerPin2026!` | Dein frei gewähltes Shared-Secret für das Frontend (Pflicht) |
| `GEMINI_API_KEY` | `AIzaSy...` | API-Key aus dem [Google AI Studio](https://aistudio.google.com/apikey) |
| `GARMIN_API_KEY` | Dein Garmin Key | Personal API Key aus Garmin Connect |
| `SPREADSHEET_ID` | *(optional)* | Nur nötig, falls das Script **nicht** direkt über *Erweiterungen → Apps Script* im Sheet angelegt wurde |

---

### Schritt 3: Tabellenblätter initialisieren & Berechtigungen erteilen
1. Wechsle im Apps-Script-Editor in die Datei **`Code.gs`**.
2. Wähle oben in der Funktionsauswahl (neben „Ausführen“) die Funktion **`setupDatabase`** aus und klicke auf **Ausführen**.
3. Bestätige beim ersten Aufruf den Google-Berechtigungsdialog:
   - **Berechtigungen prüfen** → Google-Konto wählen → **Erweitert** → **Zu „… (unsicher)“ wechseln** → **Zulassen**.
4. Im Google Sheet werden daraufhin automatisch alle 4 Tabellenblätter inkl. Spaltenüberschriften, Fettdruck, eingefrorener Zeile 1, Dropdown-Validierungen und Standardwerten angelegt:
   - `Daily_Metrics`
   - `Activities`
   - `Strength_Log`
   - `Config_Targets` *(Standard: 2× Engine, 2× Heavy, 1× Metcon pro Woche)*

> **💡 Alternativ:** Du kannst `setupDatabase()` auch später direkt aus der Web-App über **Einstellungen → „Sheets initialisieren“** ausführen.

---

### Schritt 4: Optional – Täglichen Garmin-Auto-Sync aktivieren
Damit deine Schlaf-, HRV-, Ruhepuls- und Aktivitätsdaten jeden Morgen automatisch importiert werden:
1. Öffne im Apps-Script-Editor **`GarminSync.gs`**.
2. Wähle oben die Funktion **`installDailyGarminTrigger`** aus und klicke einmalig auf **Ausführen**.
3. Es wird ein zeitgesteuerter Trigger eingerichtet, der `syncGarminData()` täglich um ca. **06:00 Uhr** ausführt (dank Upsert-Logik entstehen auch bei mehrfacher Ausführung niemals doppelte Zeilen).

---

### Schritt 5: Als Web-App bereitstellen (Deployment)
1. Klicke im Apps-Script-Editor oben rechts auf **Bereitstellen → Neue Bereitstellung**.
2. Klicke beim Zahnrad „Typ auswählen“ auf **Web-App**.
3. Konfiguriere die Bereitstellung **exakt so** (wichtig, damit der Browser ohne CORS-Fehler kommunizieren kann):
   - **Beschreibung:** z. B. `v1`
   - **Ausführen als:** `Ich (deine@email.de)`
   - **Zugriff hat:** `Jeder` *(Unautorisierte Aufrufe ohne gültige `APP_PIN` werden in `doPost` sofort mit `401` abgewiesen)*
4. Klicke auf **Bereitstellen** und kopiere die **Web-App-URL** (Format: `https://script.google.com/macros/s/.../exec`).

> **⚠️ Wichtig bei späteren Code-Änderungen in Apps Script:**
> Klicke nach Änderungen im `.gs`-Code immer auf **Bereitstellen → Bereitstellungen verwalten → Stift-Icon (Bearbeiten) → Version: „Neue Version“ → Bereitstellen**, damit die bestehende Web-App-URL den neuen Code ausführt.

---

### Schritt 6: Frontend verbinden & als PWA nutzen

#### Option A: Hosting auf GitHub Pages (empfohlen fürs Smartphone im Home Gym)
1. Pushe dieses Repository auf GitHub.
2. Öffne auf GitHub **Settings → Pages**.
3. Stelle unter **Build and deployment** als **Source** `GitHub Actions` ein.
4. Der Workflow veröffentlicht jeden Push auf `main` automatisch. Die App zeigt im Header die fortlaufende Build-Nummer und Datum/Uhrzeit; ein neuer Build aktualisiert auch den PWA-Cache.
5. Öffne die veröffentlichte GitHub-Pages-URL im Browser (oder füge sie auf iOS via *Teilen → Zum Home-Bildschirm* bzw. auf Android via *App installieren* als Vollbild-PWA hinzu).

#### Option B: Lokal starten
Da das Frontend keinen Build-Step benötigt, reicht jeder beliebige statische HTTP-Server für den Ordner `docs/`:

```bash
# Mit Python
python -m http.server 8080 --directory docs

# Oder mit Node.js (npx)
npx serve docs -l 8080
```
Danach im Browser `http://localhost:8080` öffnen.

#### Live-Verbindung in der App aktivieren
1. Klicke in der App oben rechts auf das **Einstellungen-Icon**.
2. Trage die kopierte **GAS Web App URL** und deine **App PIN** ein.
3. Stelle sicher, dass *„Demo-/Mock-Modus erzwingen“* deaktiviert ist.
4. Klicke auf **„Verbindung testen“** (Status wechselt auf `✓ Verbunden`) und anschließend auf **„Speichern & neu laden“**.
5. Das Badge im Header wechselt von **DEMO** (gelb) auf **LIVE** (grün). Die Zugangsdaten werden ausschließlich lokal im `localStorage` deines Endgeräts gespeichert.
