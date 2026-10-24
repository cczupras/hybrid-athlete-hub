# Technical Specification: Hybrid Athlete Hub

## 1. System Overview
A serverless training analysis and planning tool combining **Garmin Connect Personal API** data with manual strength logs (Home Gym Rack & Barbell) and **CrossFit** tagging. Powered by **Gemini API** as an intelligent hybrid coach.

### Architecture
- **Database:** Google Sheets (4 Tabs: `Daily_Metrics`, `Activities`, `Strength_Log`, `Config_Targets`)
- **Backend / API Gateway:** Google Apps Script (Web App with `doPost` CORS-free `text/plain` routing & daily Cron Trigger)
- **Frontend:** Responsive PWA hosted on GitHub Pages (`docs/`), built with Vanilla JS, Tailwind CSS (CDN), Chart.js, and Marked.js.

## 2. Data Schema (Google Sheets)

### Tab 1: `Daily_Metrics`
`Date` | `Sleep_Score` | `HRV_7d_Avg` | `HRV_Night` | `Resting_HR` | `Body_Battery_Max` | `Readiness_Status`

### Tab 2: `Activities`
`Activity_ID` | `Date` | `Source` | `Bucket` | `Type` | `Duration_Min` | `Garmin_Load` | `Avg_HR` | `RPE` | `Muscle_Focus` | `Notes`
- **Buckets:** `Engine` (Run, Bike), `Heavy` (Home Gym Rack), `Metcon` (CrossFit)
- **Muscle_Focus:** `Lower_Heavy`, `Upper_Push`, `Upper_Pull`, `Full_Body`, `Cardio_Z2`, `Cardio_High`

### Tab 3: `Strength_Log`
`Log_ID` | `Date` | `Activity_ID` | `Exercise` | `Sets` | `Reps` | `Weight_kg` | `RIR` | `e1RM`
- **Formula e1RM:** `Weight * (1 + Reps / 30)`

### Tab 4: `Config_Targets`
`Metric` | `Target_Value` | `Current_Week_Value` | `Notes`

## 3. API Contract (Frontend <-> Google Apps Script)
All requests use `POST` with `Content-Type: text/plain;charset=utf-8` to bypass CORS preflight.

### Request Payload Structure
```json
{
  "pin": "SECRET_APP_PIN",
  "action": "getDashboard | logStrength | tagActivity | askGemini",
  "data": {}
}   

4. Implementation Milestones
[ ] Step 1: Set up Google Sheet & Script Properties (GARMIN_API_KEY, GEMINI_API_KEY, APP_PIN)

[ ] Step 2: Implement & deploy gas-backend/Code.gs

[ ] Step 3: Build Mobile Rack-Logger & Desktop Analytics UI in docs/index.html & docs/app.js

[ ] Step 4: Configure Garmin Personal API mapping in gas-backend/GarminSync.gs
