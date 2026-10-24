# Complete Technical Specification: Hybrid Athlete Hub

## 1. Domain Logic & Hybrid Training Concept
The athlete trains across three buckets that compete for recovery (especially CNS and lower body):
- **Engine**: Running & Cycling (synced via Garmin API).
- **Heavy**: Home Gym barbell training in the rack (Back Squat, Front Squat, Deadlift, Bench Press, Overhead Press, Pull-Ups). Low average HR, high CNS/structural load.
- **Metcon**: CrossFit classes/WODs. High metabolic and muscular fatigue.

### Key Features to Implement
1. **48h Muscle & CNS Interference Heatmap:** Tracks recent load on Lower_Heavy, Upper_Push, Upper_Pull, Full_Body, and Cardio_Z2/High. Warns if Heavy Squats are planned within 48h of a leg-heavy CrossFit WOD or hard run.
2. **Weekly Compass (Buckets):** Progress bars comparing current week sessions (Monday–Sunday) against targets in Config_Targets (e.g., 2x Engine, 2x Heavy, 1-2x Metcon).
3. **Readiness Auto-Regulator:** Evaluates today's Garmin Sleep_Score, HRV_Night vs HRV_7d_Avg, and Resting_HR into a Green / Yellow / Red badge.
4. **Home Gym Quick-Logger (Mobile View):** Fast set/rep/weight logger with +/- stepper buttons, RIR (Reps in Reserve), automatic Epley e1RM calculation (Weight * (1 + Reps / 30)), and instant PR/trend comparison.
5. **Activity Tagger:** Allows tagging imported Garmin activities with Bucket, RPE (1-10), and Muscle_Focus.
6. **Gemini Hybrid Coach:** Sends the last 10 days of Daily_Metrics, Activities, and Strength_Log to Gemini (gemini-2.5-flash) via Apps Script and renders the Markdown advice in the UI.

---

## 2. Google Sheets Database Schema (Exact Column Order)

### Tab 1: Daily_Metrics
1. Date (YYYY-MM-DD)
2. Sleep_Score (Number 0-100)
3. HRV_7d_Avg (Number ms)
4. HRV_Night (Number ms)
5. Resting_HR (Number bpm)
6. Body_Battery_Max (Number 0-100)
7. Readiness_Status (Green | Yellow | Red)

### Tab 2: Activities
1. Activity_ID (String / Garmin ID or UUID)
2. Date (YYYY-MM-DD)
3. Source (Garmin | Manual)
4. Bucket (Engine | Heavy | Metcon)
5. Type (Run | Bike | CrossFit | Rack_Strength | Other)
6. Duration_Min (Number)
7. Garmin_Load (Number)
8. Avg_HR (Number)
9. RPE (Number 1-10)
10. Muscle_Focus (Lower_Heavy | Upper_Push | Upper_Pull | Full_Body | Cardio_Z2 | Cardio_High)
11. Notes (String)

### Tab 3: Strength_Log
1. Log_ID (UUID)
2. Date (YYYY-MM-DD)
3. Activity_ID (Optional link to Activities)
4. Exercise (Back Squat | Front Squat | Deadlift | Bench Press | Overhead Press | Barbell Row | Weighted Pull-Up)
5. Sets (Number)
6. Reps (Number)
7. Weight_kg (Number)
8. RIR (Number 0-5)
9. e1RM (Number, rounded to 1 decimal: Math.round(weight * (1 + reps / 30) * 10) / 10)

### Tab 4: Config_Targets
1. Metric (Engine_Weekly | Heavy_Weekly | Metcon_Weekly)
2. Target_Value (Number, default: 2, 2, 1)
3. Notes (String)

---

## 3. Backend API Specification (gas-backend/)

### Script Properties Required
- GARMIN_API_KEY: Personal API key from Garmin Connect
- GEMINI_API_KEY: Google AI Studio API Key
- APP_PIN: Shared secret token for frontend authentication

### Code.gs (doPost(e) Router)
Parses JSON.parse(e.postData.contents). Verifies 
equest.pin === APP_PIN.
Supports actions:
- initSheets: Automatically creates the 4 tabs and headers if they don't exist yet, plus default rows in Config_Targets.
- getDashboard: Returns last 14 days of Daily_Metrics, last 30 Activities, last 50 Strength_Log entries, and Config_Targets as arrays of objects (mapped by header names).
- logStrength: Appends a set/session to Strength_Log (and optionally creates/updates today's Rack_Strength entry in Activities), returns calculated e1RM.
- 	TagActivity: Updates Bucket, RPE, Muscle_Focus, and Notes for an existing Activity_ID in Activities.
- 	TriggerGarminSync: Calls syncGarminData() manually from the UI and returns sync summary.
- askGemini: Calls askGeminiCoach(request.prompt, contextData) and returns { reply: markdownString }.

### GarminSync.gs
- Implements syncGarminData().
- Exchanges GARMIN_API_KEY at https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token (Authorization: ApiKey <key>) for a Bearer token.
- Includes modular fetch helpers with clean error logging and upserts (by Date for Daily_Metrics and Activity_ID for Activities so running the sync multiple times never creates duplicate rows).

### GeminiCoach.gs
- Calls https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent.
- System instruction configures Gemini as a pragmatic hybrid strength & conditioning coach in German, checking 48h muscle interference, HRV readiness, weekly bucket deficits, and barbell progressive overload.
- Supports quick preset prompts (e.g. "Tagesempfehlung", "Rack-Gewichte für heute", "Wochen-Review") as well as custom user questions.
