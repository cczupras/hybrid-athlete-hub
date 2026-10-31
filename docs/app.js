// Frontend App Logic
/**
 * ============================================================================
 *  Hybrid Athlete Hub – docs/app.js
 *  Vanilla ES6, kein Build-Step. Tailwind / Chart.js / Marked.js via CDN.
 *
 *  - GAS-Kommunikation: POST + 'text/plain;charset=utf-8' (CORS-preflight-frei)
 *  - Keine Secrets im Code: GAS_URL & APP_PIN kommen aus localStorage (Settings)
 *  - MOCK_MODE: aktiv, wenn GAS_URL leer / "mock" ist oder im Settings-Modal erzwungen
 * ============================================================================
 */
'use strict';

/* ==========================================================================
 *  1) Konstanten
 * ======================================================================= */
const STORAGE_KEYS = { url: 'GAS_URL', pin: 'APP_PIN', mock: 'MOCK_MODE' };

const EXERCISES = ['Back Squat', 'Front Squat', 'Deadlift', 'Bench Press', 'Overhead Press', 'Barbell Row', 'Weighted Pull-Up'];
const EXERCISE_SHORT = {
  'Back Squat': 'SQ', 'Front Squat': 'FSQ', 'Deadlift': 'DL', 'Bench Press': 'BP',
  'Overhead Press': 'OHP', 'Barbell Row': 'ROW', 'Weighted Pull-Up': 'WPU'
};
const EXERCISE_FOCUS = {
  'Back Squat': 'Lower_Heavy', 'Front Squat': 'Lower_Heavy', 'Deadlift': 'Lower_Heavy',
  'Bench Press': 'Upper_Push', 'Overhead Press': 'Upper_Push',
  'Barbell Row': 'Upper_Pull', 'Weighted Pull-Up': 'Upper_Pull'
};
const EXERCISE_COLORS = {
  'Back Squat': '#34d399', 'Front Squat': '#2dd4bf', 'Deadlift': '#f472b6', 'Bench Press': '#38bdf8',
  'Overhead Press': '#a78bfa', 'Barbell Row': '#fbbf24', 'Weighted Pull-Up': '#fb923c'
};

const BUCKETS = {
  Engine: { label: 'Engine', hex: '#38bdf8', rgb: '56,189,248', text: 'text-sky-300', icon: '🫀', desc: 'Laufen & Rad' },
  Heavy: { label: 'Heavy', hex: '#34d399', rgb: '52,211,153', text: 'text-emerald-300', icon: '🏋️', desc: 'Rack · Langhantel' },
  Metcon: { label: 'Metcon', hex: '#fb923c', rgb: '251,146,60', text: 'text-orange-300', icon: '🔥', desc: 'CrossFit WODs' }
};
const TARGET_BUCKETS = { Engine_Weekly: 'Engine', Heavy_Weekly: 'Heavy', Metcon_Weekly: 'Metcon' };

const MUSCLE_FOCUS = {
  Lower_Heavy: 'Beine schwer', Upper_Push: 'Push', Upper_Pull: 'Pull',
  Full_Body: 'Ganzkörper', Cardio_Z2: 'Cardio Z2', Cardio_High: 'Cardio hoch'
};
const TYPE_META = {
  Run: { label: 'Lauf', icon: '🏃' }, Bike: { label: 'Rad', icon: '🚴' }, CrossFit: { label: 'CrossFit', icon: '🔥' },
  Rack_Strength: { label: 'Rack Strength', icon: '🏋️' }, Other: { label: 'Sonstiges', icon: '⚡' }
};
const READINESS_META = {
  Green: { label: 'Grün', title: 'Bereit für Intensität', advice: 'Gute Erholung – harte Einheit oder schwere Rack-Session möglich.', hex: '#10b981', cls: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10' },
  Yellow: { label: 'Gelb', title: 'Kontrolliert trainieren', advice: 'Moderate Last: Volumen leicht reduzieren, RIR ≥ 2, kein Max-Testing.', hex: '#f59e0b', cls: 'text-amber-300 border-amber-400/30 bg-amber-400/10' },
  Red: { label: 'Rot', title: 'Regeneration priorisieren', advice: 'Ruhetag, Mobility oder lockere Z2-Einheit. Keine schweren Lifts.', hex: '#f43f5e', cls: 'text-rose-300 border-rose-400/30 bg-rose-400/10' },
  '': { label: '–', title: 'Keine Daten', advice: 'Noch keine Garmin-Werte für heute. Starte einen Garmin Sync.', hex: '#64748b', cls: 'text-slate-300 border-white/10 bg-white/5' }
};
const FATIGUE_REGIONS = {
  Lower_Heavy: { label: 'Beine', icon: '🦵' }, Upper_Push: { label: 'Push', icon: '💪' }, Upper_Pull: { label: 'Pull', icon: '🧗' },
  CNS: { label: 'ZNS', icon: '🧠' }, Cardio: { label: 'Cardio', icon: '🫁' }
};
const FATIGUE_SPILLOVER = {
  Lower_Heavy: { Lower_Heavy: 1, CNS: 0.5 },
  Upper_Push: { Upper_Push: 1, CNS: 0.3 },
  Upper_Pull: { Upper_Pull: 1, CNS: 0.3 },
  Full_Body: { CNS: 1, Lower_Heavy: 0.6, Upper_Push: 0.5, Upper_Pull: 0.5, Cardio: 0.4 },
  Cardio_Z2: { Cardio: 0.6, Lower_Heavy: 0.15 },
  Cardio_High: { Cardio: 1, Lower_Heavy: 0.5, CNS: 0.3 }
};
const FATIGUE_DECAY = [1, 0.75, 0.35];
const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
const PLATE_STYLE = {
  25: 'bg-rose-500 h-16', 20: 'bg-sky-500 h-16', 15: 'bg-amber-400 h-14', 10: 'bg-emerald-500 h-12',
  5: 'bg-slate-100 h-9', 2.5: 'bg-slate-500 h-7', 1.25: 'bg-zinc-300 h-6'
};
const BAR_WEIGHT = 20;

/* ==========================================================================
 *  2) Utilities
 * ======================================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round1 = (v) => Math.round(v * 10) / 10;
const round25 = (v) => Math.round(v / 2.5) * 2.5;
const fmt = (v, digits = 1) => (v === null || v === undefined || isNaN(v) ? '–' : Number(v).toLocaleString('de-DE', { maximumFractionDigits: digits }));
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => toIso(new Date());
const isoToUtc = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (iso, n) => { const d = isoToUtc(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((isoToUtc(b) - isoToUtc(a)) / 864e5);
const weekStartIso = (iso) => addDays(iso, -((isoToUtc(iso).getUTCDay() + 6) % 7));
const fmtShortDate = (iso) => { const d = isoToUtc(iso); return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.`; };
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const relDay = (iso) => {
  const diff = daysBetween(iso, todayIso());
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  return `${WEEKDAYS[isoToUtc(iso).getUTCDay()]} ${fmtShortDate(iso)}`;
};
const isoWeekNo = (iso) => {
  const d = isoToUtc(iso);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
};
const sortByDateDesc = (rows) => rows.slice().reverse().sort((a, b) => (a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : 0));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const vibrate = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) { /* ignore */ } };

/* ==========================================================================
 *  3) Analytics (identisch zur Logik in gas-backend/Code.gs)
 * ======================================================================= */
const Analytics = {
  /** Epley e1RM, gerundet auf 1 Nachkommastelle. */
  e1rm: (weight, reps) => Math.round(Number(weight) * (1 + Number(reps) / 30) * 10) / 10,

  /** Gewicht für Ziel-Wdh. + RIR aus e1RM (Epley invertiert). */
  weightFor: (e1rm, reps, rir = 2) => e1rm / (1 + (reps + rir) / 30),

  readiness(m, rhrBaseline) {
    const scores = [];
    const sleepS = num(m.Sleep_Score), hrv = num(m.HRV_Night), hrvAvg = num(m.HRV_7d_Avg), rhr = num(m.Resting_HR);
    if (sleepS !== null) scores.push(sleepS >= 75 ? 2 : sleepS >= 60 ? 1 : 0);
    if (hrv !== null && hrvAvg) { const r = hrv / hrvAvg; scores.push(r >= 0.97 ? 2 : r >= 0.88 ? 1 : 0); }
    if (rhr !== null && rhrBaseline) { const d = rhr - rhrBaseline; scores.push(d <= 2 ? 2 : d <= 5 ? 1 : 0); }
    if (!scores.length) return '';
    const zeros = scores.filter((s) => s === 0).length;
    const avg = scores.reduce((a, b) => a + b, 0) / (2 * scores.length);
    if (zeros >= 2 || avg < 0.45) return 'Red';
    if (avg >= 0.75 && zeros === 0) return 'Green';
    return 'Yellow';
  },

  rhrBaseline(metricsAsc, idx) {
    const vals = metricsAsc.slice(Math.max(0, idx - 7), idx).map((m) => num(m.Resting_HR)).filter((v) => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  },

  todayReadiness(metricsAsc, today) {
    if (!metricsAsc.length) return { status: '', date: null };
    const idx = metricsAsc.length - 1;
    const m = metricsAsc[idx];
    const baseline = this.rhrBaseline(metricsAsc, idx);
    // Der neueste Tag hat oft noch keinen Ruhepuls (Garmin liefert ihn verzögert) → letzten vorhandenen Wert nutzen
    const lastRhr = [...metricsAsc].reverse().map((x) => num(x.Resting_HR)).find((v) => v !== null && v > 0);
    const restingHr = num(m.Resting_HR) > 0 ? num(m.Resting_HR) : (lastRhr ?? null);
    return {
      status: m.Readiness_Status || this.readiness(m, baseline),
      date: m.Date, isToday: m.Date === today,
      sleepScore: num(m.Sleep_Score), hrvNight: num(m.HRV_Night), hrv7dAvg: num(m.HRV_7d_Avg),
      restingHr, rhrBaseline: baseline === null ? null : round1(baseline),
      bodyBatteryMax: num(m.Body_Battery_Max)
    };
  },

  weeklyCompass(activities, targets, today) {
    const ws = weekStartIso(today), we = addDays(ws, 6);
    const counts = { Engine: 0, Heavy: 0, Metcon: 0 };
    activities.forEach((a) => { if (a.Date >= ws && a.Date <= we && a.Bucket in counts) counts[a.Bucket]++; });
    const t = { Engine: 2, Heavy: 2, Metcon: 1 };
    (targets || []).forEach((row) => { const b = TARGET_BUCKETS[row.Metric]; const v = num(row.Target_Value); if (b && v !== null) t[b] = v; });
    const buckets = {};
    Object.keys(counts).forEach((b) => { buckets[b] = { done: counts[b], target: t[b], deficit: Math.max(0, t[b] - counts[b]) }; });
    return { weekStart: ws, weekEnd: we, buckets, daysLeft: daysBetween(today, we) };
  },

  defaultFocus(a) {
    if (a.Type === 'CrossFit' || a.Bucket === 'Metcon') return 'Full_Body';
    if (a.Type === 'Rack_Strength' || a.Bucket === 'Heavy') return 'Lower_Heavy';
    if (a.Type === 'Run' || a.Type === 'Bike') return (num(a.Garmin_Load) || 0) >= 120 ? 'Cardio_High' : 'Cardio_Z2';
    return '';
  },
  defaultRpe: (a) => (a.Bucket === 'Metcon' || a.Bucket === 'Heavy' || a.Muscle_Focus === 'Cardio_High' ? 8 : 6),

  fatigue48h(activities, today) {
    const regions = { Lower_Heavy: 0, Upper_Push: 0, Upper_Pull: 0, CNS: 0, Cardio: 0 };
    const legSources = [];
    activities.forEach((a) => {
      const age = daysBetween(a.Date, today);
      if (age < 0 || age >= FATIGUE_DECAY.length) return;
      const focus = a.Muscle_Focus || this.defaultFocus(a);
      const spill = FATIGUE_SPILLOVER[focus];
      if (!spill) return;
      const rpe = num(a.RPE) || this.defaultRpe(a);
      const dur = num(a.Duration_Min);
      const durFactor = dur ? clamp(dur / 60, 0.5, 1.5) : 1;
      const load = (rpe / 10) * durFactor * FATIGUE_DECAY[age];
      Object.keys(spill).forEach((r) => { regions[r] += load * spill[r]; });
      if (a.Type === 'Run') regions.Lower_Heavy += load * 0.15;
      if (a.Bucket === 'Heavy') regions.CNS += load * 0.2;
      const legHeavy = (a.Bucket === 'Metcon' && (focus === 'Full_Body' || focus === 'Lower_Heavy')) ||
        focus === 'Cardio_High' || (a.Type === 'Run' && rpe >= 7) || focus === 'Lower_Heavy';
      if (legHeavy && age <= 1) legSources.push({ date: a.Date, type: a.Type, bucket: a.Bucket, focus, rpe, notes: a.Notes });
    });
    const out = {};
    Object.keys(regions).forEach((r) => {
      const s = Math.round(regions[r] * 100) / 100;
      out[r] = { score: s, level: s >= 0.7 ? 'high' : s >= 0.35 ? 'moderate' : 'low' };
    });
    const warn = out.Lower_Heavy.score >= 0.6 || legSources.length > 0;
    return { regions: out, interferenceWarning: warn, legSources };
  },

  personalBests(strengthRows, serverBests = {}) {
    const bests = {};
    Object.entries(serverBests || {}).forEach(([ex, b]) => { if (b && num(b.e1RM)) bests[ex] = { ...b, e1RM: num(b.e1RM) }; });
    strengthRows.forEach((r) => {
      const e = num(r.e1RM) ?? this.e1rm(r.Weight_kg, r.Reps);
      if (!r.Exercise || !e) return;
      if (!bests[r.Exercise] || e > bests[r.Exercise].e1RM) bests[r.Exercise] = { e1RM: e, date: r.Date, weight: num(r.Weight_kg), reps: num(r.Reps) };
    });
    return bests;
  },

  /** Training Load: Garmin_Load oder sRPE-Schätzung (RPE × Dauer × 0,25). */
  activityLoad(a) {
    const g = num(a.Garmin_Load);
    if (g) return g;
    const rpe = num(a.RPE) || this.defaultRpe(a);
    const dur = num(a.Duration_Min) || 45;
    return Math.round(rpe * dur * 0.25);
  },

  isUntagged: (a) => !num(a.RPE) || !a.Muscle_Focus || !a.Bucket
};

/* ==========================================================================
 *  4) Mock Backend – realistische 14-Tage-Daten eines Hybrid-Athleten
 * ======================================================================= */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildMockDb() {
  const rand = mulberry32(20261024);
  const today = todayIso();
  const d = (daysAgo) => addDays(today, -daysAgo);
  const gid = () => 'G-' + (17390000000 + Math.floor(rand() * 9000000));
  const rackId = (iso) => 'RACK-' + iso.replace(/-/g, '');

  // --- Daily_Metrics (Index 0 = vor 13 Tagen, 13 = heute) ---
  const sleepS = [82, 78, 71, 85, 80, 88, 76, 83, 79, 74, 81, 77, 66, 68];
  const hrvN = [64, 61, 57, 63, 62, 66, 60, 65, 62, 59, 63, 61, 55, 56];
  const rhr = [49, 50, 52, 49, 50, 48, 50, 49, 50, 51, 49, 50, 53, 53];
  const bb = [88, 82, 70, 90, 84, 95, 78, 87, 80, 72, 85, 79, 62, 66];
  const hrvHist = [62, 63, 61, 62, 64, 61, 62];
  const dailyMetrics = [];
  for (let i = 0; i < 14; i++) {
    hrvHist.push(hrvN[i]);
    const last7 = hrvHist.slice(-7);
    const m = {
      Date: d(13 - i), Sleep_Score: sleepS[i], HRV_7d_Avg: Math.round(last7.reduce((a, b) => a + b, 0) / 7),
      HRV_Night: hrvN[i], Resting_HR: rhr[i], Body_Battery_Max: bb[i], Readiness_Status: ''
    };
    dailyMetrics.push(m);
    const prevRhr = [50, 49, 50, 51, 50, 49, 50, ...rhr.slice(0, i)].slice(-7);
    m.Readiness_Status = Analytics.readiness(m, prevRhr.reduce((a, b) => a + b, 0) / prevRhr.length);
  }

  // --- Strength_Log: 6 Wochen Progression (A: Squat/Bench/Row · B: Deadlift/OHP/Pull-Up/Front Squat) ---
  const strengthLog = [];
  const sessionsA = [40, 33, 26, 19, 12, 6];
  const sessionsB = [37, 30, 23, 16, 9, 3];
  const prog = {
    'Back Squat': { w: [120, 122.5, 125, 127.5, 130, 132.5], sets: 5, reps: 5, rir: [3, 2, 2, 2, 2, 1] },
    'Bench Press': { w: [82.5, 85, 85, 87.5, 87.5, 90], sets: 5, reps: 5, rir: [2, 2, 1, 2, 1, 1] },
    'Barbell Row': { w: [70, 70, 72.5, 72.5, 75, 75], sets: 4, reps: 8, rir: [2, 2, 2, 2, 2, 1] },
    'Deadlift': { w: [150, 155, 160, 160, 165, 170], sets: 3, reps: 5, rir: [3, 3, 2, 2, 2, 2] },
    'Overhead Press': { w: [52.5, 52.5, 55, 55, 57.5, 57.5], sets: 5, reps: 5, rir: [2, 1, 2, 1, 2, 1] },
    'Weighted Pull-Up': { w: [10, 12.5, 12.5, 15, 15, 17.5], sets: 4, reps: 5, rir: [2, 2, 2, 1, 2, 1] }
  };
  const frontSquat = { 0: 95, 2: 100, 4: 102.5 };
  const rackNotes = {};
  const addSet = (daysAgo, ex, sets, reps, w, rir) => {
    const date = d(daysAgo);
    strengthLog.push({
      Log_ID: 'L-' + strengthLog.length.toString().padStart(4, '0'), Date: date, Activity_ID: rackId(date),
      Exercise: ex, Sets: sets, Reps: reps, Weight_kg: w, RIR: rir, e1RM: Analytics.e1rm(w, reps)
    });
    (rackNotes[date] = rackNotes[date] || []).push(`${ex} ${sets}x${reps}@${w}kg`);
  };
  for (let k = 0; k < 6; k++) {
    ['Back Squat', 'Bench Press', 'Barbell Row'].forEach((ex) => { const p = prog[ex]; addSet(sessionsA[k], ex, p.sets, p.reps, p.w[k], p.rir[k]); });
    ['Deadlift', 'Overhead Press', 'Weighted Pull-Up'].forEach((ex) => { const p = prog[ex]; addSet(sessionsB[k], ex, p.sets, p.reps, p.w[k], p.rir[k]); });
    if (frontSquat[k]) addSet(sessionsB[k], 'Front Squat', 3, 5, frontSquat[k], 2);
  }
  strengthLog.sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0));

  // --- Activities (letzte 14 Tage) ---
  const A = (daysAgo, o) => ({
    Activity_ID: o.id || gid(), Date: d(daysAgo), Source: o.src || 'Garmin', Bucket: o.bucket || '', Type: o.type,
    Duration_Min: o.dur ?? '', Garmin_Load: o.load ?? '', Avg_HR: o.hr ?? '', RPE: o.rpe ?? '', Muscle_Focus: o.focus ?? '', Notes: o.notes ?? ''
  });
  const rack = (daysAgo, dur, rpe, hr) => A(daysAgo, {
    id: rackId(d(daysAgo)), src: 'Manual', bucket: 'Heavy', type: 'Rack_Strength', dur, hr, rpe,
    focus: 'Lower_Heavy', notes: (rackNotes[d(daysAgo)] || []).join(' | ')
  });
  const activities = [
    A(13, { bucket: 'Engine', type: 'Run', dur: 52, load: 78, hr: 142, rpe: 4, focus: 'Cardio_Z2', notes: 'Easy Run 9,4 km' }),
    rack(12, 68, 8, 108),
    A(11, { bucket: 'Metcon', type: 'CrossFit', dur: 60, load: 165, hr: 158, rpe: 9, focus: 'Full_Body', notes: 'WOD „Fran“ – Thrusters & Pull-Ups' }),
    A(10, { bucket: 'Engine', type: 'Bike', dur: 85, load: 110, hr: 136, rpe: 5, focus: 'Cardio_Z2', notes: 'Z2 Ride 42 km' }),
    rack(9, 62, 8, 112),
    A(7, { bucket: 'Engine', type: 'Run', dur: 82, load: 142, hr: 148, rpe: 6, focus: 'Cardio_Z2', notes: 'Long Run 15,1 km' }),
    rack(6, 70, 8, 110),
    A(5, { bucket: 'Engine', type: 'Bike', dur: 60, load: 168, hr: 155, rpe: 8, focus: 'Cardio_High', notes: 'VO2max 5×4 min' }),
    A(4, { bucket: 'Metcon', type: 'CrossFit', dur: 55, load: 150, hr: 152, focus: 'Full_Body', notes: 'HIIT (Garmin)' }),
    rack(3, 58, 7, 106),
    A(2, { bucket: 'Engine', type: 'Run', dur: 48, load: 132, hr: 162, focus: 'Cardio_High', notes: 'Tempo Run 10 km' }),
    A(1, { bucket: 'Metcon', type: 'CrossFit', dur: 60, load: 158, hr: 156, rpe: 9, focus: 'Full_Body', notes: 'WOD 21-15-9 Thrusters & Wall Balls' })
  ];

  // Wird erst beim ersten "Garmin Sync" importiert (demonstriert Upsert)
  const pendingSync = A(0, { id: 'G-17399990001', bucket: 'Engine', type: 'Bike', dur: 35, load: 38, hr: 118, focus: 'Cardio_Z2', notes: 'Recovery Spin (Garmin)' });

  const configTargets = [
    { Metric: 'Engine_Weekly', Target_Value: 2, Notes: 'Laufen & Radfahren (Garmin)' },
    { Metric: 'Heavy_Weekly', Target_Value: 2, Notes: 'Langhantel-Training im Rack (Home Gym)' },
    { Metric: 'Metcon_Weekly', Target_Value: 1, Notes: 'CrossFit WODs (1–2x pro Woche)' }
  ];
  return { dailyMetrics, activities, strengthLog, configTargets, pendingSync };
}

const MockBackend = {
  db: null,
  ensure() { if (!this.db) this.db = buildMockDb(); return this.db; },

  async handle(action, data = {}) {
    const db = this.ensure();
    const today = todayIso();
    switch (action) {
      case 'getDashboard': {
        await sleep(350);
        const cutoff = addDays(today, -13);
        return structuredClone({
          today,
          dailyMetrics: db.dailyMetrics.filter((m) => m.Date >= cutoff),
          activities: sortByDateDesc(db.activities).slice(0, 30),
          strengthLog: sortByDateDesc(db.strengthLog).slice(0, 50),
          configTargets: db.configTargets,
          personalBests: Analytics.personalBests(db.strengthLog)
        });
      }
      case 'logStrength': {
        await sleep(300);
        const weight = num(data.weight), reps = num(data.reps);
        if (!EXERCISES.includes(data.exercise)) throw new Error('Ungültige Übung.');
        if (weight === null || reps === null || reps < 1) throw new Error('Gewicht/Wdh. ungültig.');
        const e1rm = Analytics.e1rm(weight, reps);
        const prev = Analytics.personalBests(db.strengthLog)[data.exercise]?.e1RM || 0;
        const date = data.date || today;
        const sets = Math.max(1, Math.round(num(data.sets) || 1));
        const fragment = `${data.exercise} ${sets}x${reps}@${weight}kg`;
        let act = db.activities.find((a) => a.Date === date && a.Type === 'Rack_Strength');
        if (!act) {
          act = { Activity_ID: 'RACK-' + date.replace(/-/g, ''), Date: date, Source: 'Manual', Bucket: 'Heavy', Type: 'Rack_Strength',
            Duration_Min: 0, Garmin_Load: '', Avg_HR: '', RPE: '', Muscle_Focus: EXERCISE_FOCUS[data.exercise], Notes: '' };
          db.activities.push(act);
        } else {
          const f = EXERCISE_FOCUS[data.exercise];
          if (act.Muscle_Focus !== f) act.Muscle_Focus = (act.Muscle_Focus === 'Lower_Heavy' || f === 'Lower_Heavy') ? 'Lower_Heavy' : 'Full_Body';
        }
        act.Duration_Min = (num(act.Duration_Min) || 0) + sets * 3;
        act.Notes = act.Notes ? `${act.Notes} | ${fragment}` : fragment;
        const entry = { Log_ID: uuid(), Date: date, Activity_ID: act.Activity_ID, Exercise: data.exercise, Sets: sets,
          Reps: reps, Weight_kg: weight, RIR: num(data.rir) ?? '', e1RM: e1rm };
        db.strengthLog.push(entry);
        return structuredClone({ logId: entry.Log_ID, e1RM: e1rm, previousBest: prev, isPR: e1rm > prev, activityId: act.Activity_ID, entry });
      }
      case 'tagActivity': {
        await sleep(250);
        const act = db.activities.find((a) => a.Activity_ID === data.activityId);
        if (!act) throw new Error(`Activity_ID "${data.activityId}" nicht gefunden.`);
        if (data.bucket) act.Bucket = data.bucket;
        if (data.rpe) act.RPE = Number(data.rpe);
        if (data.muscleFocus) act.Muscle_Focus = data.muscleFocus;
        if (data.notes !== undefined) act.Notes = String(data.notes);
        return structuredClone({ activity: act });
      }
      case 'triggerGarminSync': {
        await sleep(1400);
        const summary = { metrics: { inserted: 0, updated: 0, unchanged: 0 }, activities: { inserted: 0, updated: 0, unchanged: 0 }, errors: [] };
        const exists = db.activities.find((a) => a.Activity_ID === db.pendingSync.Activity_ID);
        if (exists) summary.activities.unchanged = 3; else { db.activities.push({ ...db.pendingSync }); summary.activities.inserted = 1; summary.activities.unchanged = 2; }
        const tm = db.dailyMetrics.find((m) => m.Date === today);
        if (tm && tm.Body_Battery_Max < 71) { tm.Body_Battery_Max = 71; summary.metrics.updated = 1; summary.metrics.unchanged = 2; } else summary.metrics.unchanged = 3;
        summary.message = `Mock-Sync: ${summary.metrics.inserted} neue / ${summary.metrics.updated} aktualisierte Tage, ` +
          `${summary.activities.inserted} neue / ${summary.activities.updated} aktualisierte Aktivitäten (keine Dubletten).`;
        return summary;
      }
      case 'askGemini': {
        await sleep(900 + Math.random() * 700);
        const dash = await this.handle('getDashboard');
        return { reply: MockCoach.reply(String(data.prompt || ''), buildDerived(dash)) };
      }
      case 'initSheets':
        await sleep(500);
        return { sheets: Object.keys({ Daily_Metrics: 1, Activities: 1, Strength_Log: 1, Config_Targets: 1 }).map((name) => ({ name, created: false })), targetsAdded: [], mock: true };
      default:
        throw new Error(`Unbekannte Action: ${action}`);
    }
  }
};

/* ==========================================================================
 *  5) Mock Coach – generiert deutsche Markdown-Antworten aus den Daten
 * ======================================================================= */
const MockCoach = {
  reply(prompt, ctx) {
    const p = prompt.trim();
    const body = p === 'today' ? this.today(ctx) : p === 'rack' ? this.rack(ctx) : p === 'week' ? this.week(ctx) : this.custom(p, ctx);
    return `${body}\n\n> 💡 *Demo-Modus: Diese Antwort wurde lokal aus deinen Mock-Daten generiert. Mit hinterlegter GAS_URL antwortet gemini-2.5-flash.*`;
  },

  lagebild(ctx) {
    const r = ctx.readiness, f = ctx.fatigue, c = ctx.compass;
    const meta = READINESS_META[r.status] || READINESS_META[''];
    const hrvPct = r.hrvNight && r.hrv7dAvg ? Math.round((r.hrvNight / r.hrv7dAvg - 1) * 100) : null;
    const rhrDiff = r.restingHr && r.rhrBaseline ? round1(r.restingHr - r.rhrBaseline) : null;
    const legs = f.regions.Lower_Heavy;
    const src = f.legSources[0];
    return [
      `- **Readiness:** ${meta.label} (Schlaf ${fmt(r.sleepScore)}, HRV ${fmt(r.hrvNight)} ms vs. Ø ${fmt(r.hrv7dAvg)}${hrvPct !== null ? ` → ${hrvPct > 0 ? '+' : ''}${hrvPct} %` : ''}, Ruhepuls ${rhrDiff !== null ? (rhrDiff > 0 ? '+' : '') + fmt(rhrDiff) : '–'} bpm)`,
      `- **48h-Ermüdung:** Beine ${levelDe(legs.level)}${src ? ` (${TYPE_META[src.type]?.label || src.type} ${relDay(src.date).toLowerCase()}, RPE ${src.rpe})` : ''}`,
      `- **Wochen-Kompass:** ${Object.entries(c.buckets).map(([b, v]) => `${b} ${v.done}/${v.target}${v.deficit ? '' : ' ✓'}`).join(' · ')} – noch ${c.daysLeft} Tag(e)`
    ].join('\n');
  },

  adj(status) { return { Green: 1, Yellow: 0.95, Red: 0.88 }[status] || 0.93; },

  workRow(ctx, ex, sets, reps, rir = 2) {
    const best = ctx.bests[ex]?.e1RM;
    if (!best) return `| ${ex} | ${sets}×${reps} | – | RIR ${rir} |`;
    const w = round25(Analytics.weightFor(best, reps, rir) * this.adj(ctx.readiness.status));
    return `| ${ex} | ${sets}×${reps} | **${fmt(w)} kg** | RIR ${rir} |`;
  },

  pickSession(ctx) {
    const legWarn = ctx.fatigue.interferenceWarning;
    if (legWarn) return { name: 'Upper-Body-Rack', list: [['Bench Press', 5, 5], ['Overhead Press', 3, 6], ['Barbell Row', 4, 8]] };
    const lastDl = ctx.strength.find((s) => s.Exercise === 'Deadlift')?.Date || '';
    const lastSq = ctx.strength.find((s) => s.Exercise === 'Back Squat')?.Date || '';
    return lastSq <= lastDl
      ? { name: 'Squat-Tag', list: [['Back Squat', 5, 5], ['Bench Press', 5, 5], ['Barbell Row', 4, 8]] }
      : { name: 'Deadlift-Tag', list: [['Deadlift', 3, 5], ['Overhead Press', 5, 5], ['Weighted Pull-Up', 4, 5]] };
  },

  today(ctx) {
    const r = ctx.readiness, c = ctx.compass.buckets, legWarn = ctx.fatigue.interferenceWarning;
    let headline, table, why;
    if (r.status === 'Red') {
      headline = 'Heute: Regeneration – lockere Z2-Einheit oder Mobility, keine schweren Lifts.';
      table = '| Block | Inhalt | Intensität |\n|---|---|---|\n| Engine light | 30–40 min Rad locker | Z1–Z2, RPE 3 |\n| Mobility | Hüfte, T-Spine, Sprunggelenk | 15 min |';
      why = 'Mehrere Recovery-Marker sind im roten Bereich. Ein harter Reiz würde die Anpassung eher stören als fördern.';
    } else if (legWarn && c.Heavy.deficit > 0) {
      const s = this.pickSession(ctx);
      headline = `Heute: ${s.name} statt Squats – deine Beine sind vom letzten WOD/Lauf noch belastet.`;
      table = '| Übung | Sätze×Wdh | Gewicht | Ziel |\n|---|---|---|---|\n' + s.list.map(([e, st, rp]) => this.workRow(ctx, e, st, rp)).join('\n') +
        '\n| Finisher | 10 min Z2 Rad | – | locker |';
      why = `Heavy liegt bei ${c.Heavy.done}/${c.Heavy.target}. Mit Upper Body holst du den Bucket nach, ohne die 48h-Interferenz für Kniebeugen/Kreuzheben zu verletzen.`;
    } else if (c.Engine.deficit > 0) {
      headline = 'Heute: Engine-Tag – Z2-Ausdauer füllt dein Wochendefizit am schonendsten.';
      table = '| Block | Inhalt | Intensität |\n|---|---|---|\n| Hauptteil | 50–60 min Rad oder Lauf | Z2, RPE 4–5 |\n| Strides | 4×20 s locker-schnell (nur Lauf) | kontrolliert |';
      why = `Engine steht bei ${c.Engine.done}/${c.Engine.target}. Rad ist wegen geringerer Exzentrik die bessere Wahl, falls die Beine schwer sind.`;
    } else if (c.Heavy.deficit > 0) {
      const s = this.pickSession(ctx);
      headline = `Heute: ${s.name} im Rack – Readiness passt, Heavy-Bucket ist noch offen.`;
      table = '| Übung | Sätze×Wdh | Gewicht | Ziel |\n|---|---|---|---|\n' + s.list.map(([e, st, rp]) => this.workRow(ctx, e, st, rp)).join('\n');
      why = 'Keine relevante Beinvorbelastung in den letzten 48h – gute Gelegenheit für Progressive Overload.';
    } else {
      headline = 'Heute: Alle Wochenziele erfüllt – optionaler Metcon oder aktiver Ruhetag.';
      table = '| Option | Inhalt | Intensität |\n|---|---|---|\n| A | CrossFit-Klasse, Skalierung nach Gefühl | RPE ≤ 8 |\n| B | 45 min Spaziergang + Mobility | locker |';
      why = 'Du bist im Soll. Qualität vor Quantität – Regeneration zahlt auf die nächste Woche ein.';
    }
    return `**${headline}**\n\n### Lagebild\n${this.lagebild(ctx)}\n\n### Empfehlung\n${table}\n\n### Warum?\n${why}`;
  },

  rack(ctx) {
    const s = this.pickSession(ctx);
    const main = s.list[0][0];
    const best = ctx.bests[main]?.e1RM || 100;
    const work = round25(Analytics.weightFor(best, s.list[0][2], 2) * this.adj(ctx.readiness.status));
    const isPullUp = main === 'Weighted Pull-Up';
    const warm = isPullUp ? '' : [0.4, 0.6, 0.8].map((pct, i) => `| Warm-up ${i + 1} | ${[5, 3, 2][i]} | ${fmt(Math.max(BAR_WEIGHT, round25(work * pct)))} kg |`).join('\n');
    return `**${s.name}: ${main} ist heute deine Hauptübung – Arbeitsgewicht ${fmt(work)} kg.**\n\n` +
      `### Aufwärmen ${main}\n| Satz | Wdh | Gewicht |\n|---|---|---|\n| Leere Stange | 10 | 20 kg |\n${warm}\n\n` +
      `### Arbeitssätze\n| Übung | Sätze×Wdh | Gewicht | Ziel |\n|---|---|---|---|\n${s.list.map(([e, st, rp]) => this.workRow(ctx, e, st, rp)).join('\n')}\n\n` +
      `### Steuerung\n- Readiness **${READINESS_META[ctx.readiness.status]?.label || '–'}** → Last-Faktor ${Math.round(this.adj(ctx.readiness.status) * 100)} % der e1RM-basierten Zielgewichte.\n` +
      `- Fühlt sich der erste Arbeitssatz wie RIR ≥ 3 an: **+2,5 kg**. Bei RIR 0–1: **−5 %** und Satzzahl halten.\n` +
      (ctx.fatigue.interferenceWarning ? '- ⚠️ **48h-Interferenz aktiv:** Squats & Deadlifts heute bewusst ausgelassen.\n' : '') +
      `- Bestwert ${main}: **${fmt(best)} kg e1RM** – ein PR wäre z. B. ${fmt(round25(best / (1 + 3 / 30) + 2.5))} kg × 3.`;
  },

  week(ctx) {
    const m = ctx.metrics;
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const last7 = m.slice(-7), prev7 = m.slice(-14, -7);
    const hrvNow = avg(last7.map((x) => num(x.HRV_Night)).filter(Boolean));
    const hrvPrev = avg(prev7.map((x) => num(x.HRV_Night)).filter(Boolean));
    const sleepNow = avg(last7.map((x) => num(x.Sleep_Score)).filter(Boolean));
    const sleepPrev = avg(prev7.map((x) => num(x.Sleep_Score)).filter(Boolean));
    const trend = (a, b) => (a && b ? `${a >= b ? '↗' : '↘'} ${a >= b ? '+' : ''}${fmt(((a / b) - 1) * 100, 0)} %` : '–');
    const progressRows = EXERCISES.map((ex) => {
      const rows = ctx.strength.filter((s) => s.Exercise === ex).slice().reverse();
      if (rows.length < 2) return null;
      const first = num(rows[0].e1RM), last = num(rows[rows.length - 1].e1RM);
      return `| ${ex} | ${fmt(first)} | ${fmt(last)} | ${last >= first ? '+' : ''}${fmt(last - first)} kg |`;
    }).filter(Boolean).join('\n');
    const c = ctx.compass.buckets;
    const open = Object.entries(c).filter(([, v]) => v.deficit > 0).map(([b, v]) => `${v.deficit}× ${b}`);
    return `**Solide Woche – Kraft steigt, aber HRV und Schlaf zeigen beginnende Ermüdung.**\n\n` +
      `### Bucket-Bilanz (KW ${isoWeekNo(todayIso())})\n| Bucket | Ist | Ziel | Status |\n|---|---|---|---|\n` +
      Object.entries(c).map(([b, v]) => `| ${b} | ${v.done} | ${v.target} | ${v.deficit ? `${v.deficit} offen` : '✓'} |`).join('\n') +
      `\n\n### Recovery-Trend (7 Tage vs. Vorwoche)\n- **HRV Nacht:** Ø ${fmt(hrvNow, 0)} ms (${trend(hrvNow, hrvPrev)})\n- **Schlaf-Score:** Ø ${fmt(sleepNow, 0)} (${trend(sleepNow, sleepPrev)})\n` +
      `- Zwei Metcons + Tempo-Lauf innerhalb von 4 Tagen haben die HRV gedrückt.\n\n` +
      `### Kraft-Progression (e1RM)\n| Übung | Start | Aktuell | Δ |\n|---|---|---|---|\n${progressRows}\n\n` +
      `### Plan für die restlichen Tage\n${open.length ? `1. Offen: **${open.join(', ')}** – priorisiere Heavy (Upper Body), solange die Beine belastet sind.\n` : '1. Alle Buckets erfüllt – nimm einen echten Ruhetag.\n'}` +
      `2. Max. **ein** hartes Metcon pro 72h, nie direkt vor dem Squat-Tag.\n3. Zwei Nächte mit ≥ 7,5 h Schlaf anpeilen, um die HRV wieder über Ø zu bringen.`;
  },

  custom(q, ctx) {
    const lower = q.toLowerCase();
    let answer;
    if (/dead|kreuz|squat|kniebeu|bein/.test(lower)) {
      answer = ctx.fatigue.interferenceWarning
        ? 'Aktuell **nicht schwer**: In den letzten 48h gab es beinlastige Belastung. Plane Squats/Deadlifts frühestens in 24–48h, heute höchstens Technik mit ≤ 70 % e1RM.'
        : 'Ja – keine relevante Beinvorbelastung in den letzten 48h. Starte konservativ mit RIR 2 und steigere nur bei guter Bar-Speed.';
    } else if (/lauf|run|rad|bike|z2|ausdauer/.test(lower)) {
      answer = 'Engine-Einheiten in Z2 sind fast immer kompatibel. Hart (Intervalle/Tempo) nur mit Readiness Grün und mind. 48h Abstand zum Squat-Tag.';
    } else if (/crossfit|wod|metcon/.test(lower)) {
      answer = 'Metcon ja, aber skaliere beinlastige Movements (Thrusters, Wall Balls, Box Jumps), wenn innerhalb von 48h ein Heavy-Lower-Tag geplant ist.';
    } else {
      answer = 'Basierend auf deinen Daten: Halte die Intensität heute moderat und priorisiere den offenen Bucket mit der geringsten Interferenz.';
    }
    return `**Kurz gesagt:** ${answer}\n\n### Deine Frage\n> ${escapeHtml(q)}\n\n### Lagebild\n${this.lagebild(ctx)}`;
  }
};

function levelDe(level) { return { low: 'frisch', moderate: 'moderat belastet', high: 'stark belastet' }[level] || level; }

/* ==========================================================================
 *  6) API Layer (CORS-frei)
 * ======================================================================= */
function getConfig() {
  return {
    url: (localStorage.getItem(STORAGE_KEYS.url) || '').trim(),
    pin: localStorage.getItem(STORAGE_KEYS.pin) || '',
    forceMock: localStorage.getItem(STORAGE_KEYS.mock) === 'true'
  };
}
function isMockMode(cfg = getConfig()) {
  return cfg.forceMock || !cfg.url || cfg.url.toLowerCase() === 'mock';
}

/**
 * Zentrale API-Funktion. POST + text/plain verhindert den CORS-Preflight bei GAS.
 * @param {string} action
 * @param {Object} data
 * @param {{url?:string,pin?:string,forceMock?:boolean}} override optionale Werte (z. B. Verbindungstest)
 */
async function api(action, data = {}, override = null) {
  const cfg = override ? { ...getConfig(), ...override } : getConfig();
  if (isMockMode(cfg)) return MockBackend.handle(action, data);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ pin: cfg.pin, action, data }),
      redirect: 'follow',
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} vom Apps Script`);
    let json;
    try { json = await res.json(); } catch (_) { throw new Error('Antwort ist kein JSON – ist die Web App für „Jeder“ freigegeben?'); }
    if (!json.ok) throw new Error(json.error || 'Unbekannter Backend-Fehler');
    return json.data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Zeitüberschreitung beim Apps Script (60 s).');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/* ==========================================================================
 *  7) State
 * ======================================================================= */
const state = {
  data: { today: todayIso(), dailyMetrics: [], activities: [], strengthLog: [], configTargets: [], personalBests: {} },
  derived: null,
  logger: { exercise: 'Back Squat', weight: 100, reps: 5, sets: 1, rir: 2 },
  loggerInitialized: false,
  taggerFilter: 'all',
  expandedId: null,
  draft: {},
  hiddenExercises: new Set(['Front Squat', 'Weighted Pull-Up']),
  prLogIds: new Set(),
  charts: {},
  coach: [],
  coachBusy: false,
  lastE1rmWasPr: false
};

/** Normalisiert die Backend-Antwort und berechnet abgeleitete Kennzahlen. */
function buildDerived(raw) {
  const today = todayIso();
  const metrics = (raw.dailyMetrics || []).filter((m) => m.Date).sort((a, b) => (a.Date < b.Date ? -1 : 1));
  const activities = sortByDateDesc((raw.activities || []).filter((a) => a.Activity_ID));
  const strength = sortByDateDesc((raw.strengthLog || []).filter((s) => s.Exercise));
  return {
    today, metrics, activities, strength,
    readiness: Analytics.todayReadiness(metrics, today),
    compass: Analytics.weeklyCompass(activities, raw.configTargets || [], today),
    fatigue: Analytics.fatigue48h(activities, today),
    bests: Analytics.personalBests(strength, raw.personalBests)
  };
}

/* ==========================================================================
 *  8) Laden & Rendern
 * ======================================================================= */
async function loadDashboard({ silent = false } = {}) {
  try {
    const raw = await api('getDashboard', { days: 14 });
    state.data = raw;
    state.derived = buildDerived(raw);
    if (!state.loggerInitialized) { selectExercise(state.logger.exercise, false); state.loggerInitialized = true; }
    renderAll();
    $('#lastUpdated').textContent = `Aktualisiert ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    console.error(err);
    if (!silent) toast(`Dashboard konnte nicht geladen werden: ${err.message}`, 'error', 6000);
    if (!state.derived) { state.derived = buildDerived(state.data); renderAll(); }
  }
}

function renderAll() {
  renderHeader();
  renderReadiness();
  renderCompass();
  renderFatigue();
  renderLogger();
  renderTagger();
  renderCharts();
  if (!state.coach.length) renderCoach();
}

function renderHeader() {
  const mock = isMockMode();
  const badge = $('#modeBadge');
  badge.textContent = mock ? 'Demo' : 'Live';
  badge.className = `ml-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider inline-flex ${mock ? 'border-amber-400/30 bg-amber-400/10 text-amber-300' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'}`;

  const now = new Date();
  $('#headerDate').textContent = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const h = now.getHours();
  $('#greeting').textContent = h < 11 ? 'Guten Morgen, Athlet 💪' : h < 18 ? 'Guten Tag, Athlet 💪' : 'Guten Abend, Athlet 💪';

  const r = state.derived.readiness;
  const meta = READINESS_META[r.status] || READINESS_META[''];
  const pill = $('#headerReadiness');
  pill.innerHTML = `<span class="relative flex h-2.5 w-2.5"><span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style="background:${meta.hex}"></span><span class="relative inline-flex h-2.5 w-2.5 rounded-full" style="background:${meta.hex}"></span></span>Readiness: ${meta.label}`;
}

async function loadBuildInfo() {
  const label = $('#headerBuild');
  try {
    const response = await fetch('./version.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Build-Version konnte nicht geladen werden');
    const build = await response.json();
    const builtAt = new Date(build.builtAt);
    const version = Number(build.version);
    if (!Number.isInteger(version) || version < 1 || !Number.isFinite(builtAt.getTime())) {
      throw new Error('Ungültige Build-Version');
    }
    label.textContent = `Version ${version} · ${builtAt.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`;
    label.title = builtAt.toISOString();
  } catch (error) {
    label.textContent = 'Build-Version nicht verfügbar';
  }
}

function renderReadiness() {
  const r = state.derived.readiness;
  const meta = READINESS_META[r.status] || READINESS_META[''];
  const light = (key, hex) => {
    const on = r.status === key;
    return `<span class="block h-6 w-6 rounded-full transition-all ${on ? 'animate-glow' : ''}" style="background:${on ? hex : hex + '22'};${on ? `box-shadow:0 0 18px 4px ${hex}88` : ''}"></span>`;
  };
  const hrvPct = r.hrvNight && r.hrv7dAvg ? Math.round((r.hrvNight / r.hrv7dAvg - 1) * 100) : null;
  const rhrDiff = r.restingHr && r.rhrBaseline ? round1(r.restingHr - r.rhrBaseline) : null;
  const tile = (label, value, unit, sub, subCls = 'text-slate-500') => `
    <div class="rounded-xl border border-white/[0.05] bg-slate-950/40 p-2.5">
      <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">${label}</div>
      <div class="mt-0.5 font-display text-lg font-bold text-white tabular">${value}<span class="ml-0.5 text-xs font-medium text-slate-500">${unit}</span></div>
      <div class="text-[11px] ${subCls}">${sub}</div>
    </div>`;
  $('#readinessCard').innerHTML = `
    <div class="flex items-start justify-between">
      <div>
        <h2 class="card-title">Readiness</h2>
        <p class="mt-0.5 text-xs text-slate-500">${r.date ? (r.isToday ? 'Heute · Garmin' : `Stand ${relDay(r.date)}`) : 'Keine Daten'}</p>
      </div>
      <span class="rounded-full border px-2.5 py-1 text-xs font-bold ${meta.cls}">${meta.label}</span>
    </div>
    <div class="mt-4 flex items-center gap-5">
      <div class="flex flex-col gap-2 rounded-2xl border border-white/10 bg-slate-950/80 p-2.5 shadow-inner">
        ${light('Red', '#f43f5e')}${light('Yellow', '#f59e0b')}${light('Green', '#10b981')}
      </div>
      <div class="min-w-0">
        <div class="font-display text-2xl font-bold leading-tight text-white">${meta.title}</div>
        <p class="mt-1 text-sm text-slate-400">${meta.advice}</p>
      </div>
    </div>
    <div class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      ${tile('Schlaf', fmt(r.sleepScore, 0), '/100', r.sleepScore >= 75 ? 'erholsam' : r.sleepScore >= 60 ? 'mittel' : 'kurz/unruhig', r.sleepScore >= 75 ? 'text-emerald-400' : r.sleepScore >= 60 ? 'text-amber-400' : 'text-rose-400')}
      ${tile('HRV Nacht', fmt(r.hrvNight, 0), 'ms', hrvPct === null ? '–' : `Ø ${fmt(r.hrv7dAvg, 0)} · ${hrvPct > 0 ? '+' : ''}${hrvPct}%`, hrvPct >= -3 ? 'text-emerald-400' : hrvPct >= -12 ? 'text-amber-400' : 'text-rose-400')}
      ${tile('Ruhepuls', fmt(r.restingHr, 0), 'bpm', rhrDiff === null ? '–' : `${rhrDiff > 0 ? '+' : ''}${fmt(rhrDiff)} vs. Ø`, rhrDiff <= 2 ? 'text-emerald-400' : rhrDiff <= 5 ? 'text-amber-400' : 'text-rose-400')}
      ${tile('Body Battery', fmt(r.bodyBatteryMax, 0), '', 'Tagesmax.')}
    </div>`;
}

function renderCompass() {
  const c = state.derived.compass;
  const total = Object.values(c.buckets).reduce((a, b) => a + Math.min(b.done, b.target), 0);
  const totalTarget = Object.values(c.buckets).reduce((a, b) => a + b.target, 0);
  const rows = Object.entries(c.buckets).map(([key, v]) => {
    const b = BUCKETS[key];
    const pct = v.target ? clamp((v.done / v.target) * 100, 0, 100) : 0;
    const done = v.done >= v.target;
    return `
      <div>
        <div class="mb-1.5 flex items-center justify-between text-sm">
          <span class="flex items-center gap-2 font-semibold text-white"><span>${b.icon}</span>${b.label}<span class="hidden text-xs font-normal text-slate-500 sm:inline">${b.desc}</span></span>
          <span class="tabular font-display font-bold ${done ? b.text : 'text-slate-300'}">${v.done}<span class="text-slate-500"> / ${v.target}</span>${done ? ' ✓' : ''}${v.done > v.target ? ` <span class="text-xs text-slate-500">(+${v.done - v.target})</span>` : ''}</span>
        </div>
        <div class="h-3 overflow-hidden rounded-full bg-white/[0.05]">
          <div class="h-full rounded-full transition-all duration-700 ease-out" style="width:${Math.max(pct, 4)}%;background:linear-gradient(90deg, rgba(${b.rgb},.55), ${b.hex});box-shadow:0 0 12px rgba(${b.rgb},.45)"></div>
        </div>
      </div>`;
  }).join('');
  $('#compassCard').innerHTML = `
    <div class="flex items-start justify-between">
      <div>
        <h2 class="card-title">Wochen-Kompass</h2>
        <p class="mt-0.5 text-xs text-slate-500">KW ${isoWeekNo(c.weekStart)} · ${fmtShortDate(c.weekStart)} – ${fmtShortDate(c.weekEnd)}</p>
      </div>
      <div class="text-right">
        <div class="font-display text-2xl font-bold text-white tabular">${total}<span class="text-base text-slate-500">/${totalTarget}</span></div>
        <div class="text-[11px] text-slate-500">noch ${c.daysLeft} Tag${c.daysLeft === 1 ? '' : 'e'}</div>
      </div>
    </div>
    <div class="mt-5 space-y-4">${rows}</div>`;
}

function renderFatigue() {
  const f = state.derived.fatigue;
  const levelColor = { low: '#10b981', moderate: '#f59e0b', high: '#f43f5e' };
  const levelLabel = { low: 'frisch', moderate: 'moderat', high: 'hoch' };
  const tiles = Object.entries(FATIGUE_REGIONS).map(([key, meta]) => {
    const r = f.regions[key];
    const pct = clamp((r.score / 1.2) * 100, 4, 100);
    const col = levelColor[r.level];
    return `
      <div class="flex flex-col items-center gap-1.5 rounded-xl border border-white/[0.05] bg-slate-950/40 p-2" title="${meta.label}: Score ${r.score}">
        <span class="text-base">${meta.icon}</span>
        <div class="relative h-16 w-full overflow-hidden rounded-lg bg-white/[0.04]">
          <div class="absolute inset-x-0 bottom-0 rounded-lg transition-all duration-700" style="height:${pct}%;background:linear-gradient(0deg, ${col}, ${col}55);box-shadow:0 0 14px ${col}66"></div>
        </div>
        <span class="text-[11px] font-semibold text-white">${meta.label}</span>
        <span class="text-[10px] font-medium" style="color:${col}">${levelLabel[r.level]}</span>
      </div>`;
  }).join('');
  const src = f.legSources[0];
  const warning = f.interferenceWarning ? `
    <div class="mt-4 flex gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-3 text-sm">
      <span class="text-lg leading-none">⚠️</span>
      <div><div class="font-semibold text-amber-200">Interferenz: Heavy Squats/Deadlifts meiden</div>
      <div class="text-xs text-amber-200/70">${src ? `${escapeHtml(TYPE_META[src.type]?.label || src.type)} ${relDay(src.date).toLowerCase()} (RPE ${src.rpe}${src.notes ? ` · ${escapeHtml(src.notes)}` : ''})` : 'Beinlastige Belastung'} &lt; 48h. Heute Upper Body oder Z2.</div></div>
    </div>` : `
    <div class="mt-4 flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-sm text-emerald-200">
      <span class="text-lg leading-none">✅</span>Keine Bein-Interferenz – schwere Lower-Body-Lifts möglich.
    </div>`;
  $('#fatigueCard').innerHTML = `
    <div class="flex items-start justify-between">
      <div>
        <h2 class="card-title">48h Ermüdung</h2>
        <p class="mt-0.5 text-xs text-slate-500">Muskel- &amp; ZNS-Heatmap</p>
      </div>
      <div class="flex gap-2 text-[10px] text-slate-500">
        <span class="flex items-center gap-1"><i class="h-2 w-2 rounded-full bg-emerald-500"></i>frisch</span>
        <span class="flex items-center gap-1"><i class="h-2 w-2 rounded-full bg-amber-500"></i>moderat</span>
        <span class="flex items-center gap-1"><i class="h-2 w-2 rounded-full bg-rose-500"></i>hoch</span>
      </div>
    </div>
    <div class="mt-4 grid grid-cols-5 gap-2">${tiles}</div>
    ${warning}`;
}

/* ---------------- Rack Logger ---------------- */
function selectExercise(ex, render = true) {
  state.logger.exercise = ex;
  const last = state.derived?.strength.find((s) => s.Exercise === ex);
  if (last) {
    state.logger.weight = num(last.Weight_kg) ?? state.logger.weight;
    state.logger.reps = num(last.Reps) ?? state.logger.reps;
    state.logger.sets = num(last.Sets) ?? 1;
    state.logger.rir = num(last.RIR) ?? 2;
  } else {
    state.logger.weight = ex === 'Weighted Pull-Up' ? 10 : 60;
  }
  if (render) renderLogger();
}

function renderLogger() {
  const L = state.logger;
  $('#exerciseChips').innerHTML = EXERCISES.map((ex) => `
    <button data-exercise="${ex}" class="chip shrink-0 ${ex === L.exercise ? 'chip-on' : 'chip-off'}">
      <span class="h-2 w-2 rounded-full" style="background:${EXERCISE_COLORS[ex]}"></span>${ex}
    </button>`).join('');
  $('#weightLabel').textContent = L.exercise === 'Weighted Pull-Up' ? 'Zusatzgewicht' : 'Gewicht';
  if (document.activeElement !== $('#weightInput')) $('#weightInput').value = L.weight;
  if (document.activeElement !== $('#repsInput')) $('#repsInput').value = L.reps;
  if (document.activeElement !== $('#setsInput')) $('#setsInput').value = L.sets;
  $('#rirSlider').value = L.rir;
  updateLoggerLive();
  renderTodaySets();
}

function updateLoggerLive() {
  const L = state.logger;
  const d = state.derived;
  $('#rirValue').textContent = `RIR ${L.rir} · RPE ${10 - L.rir}`;

  // Interferenz-Warnung für Lower-Body-Übungen
  const warnEl = $('#loggerWarning');
  if (d.fatigue.interferenceWarning && EXERCISE_FOCUS[L.exercise] === 'Lower_Heavy') {
    warnEl.className = 'mb-4 flex gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-3 text-xs text-amber-200';
    warnEl.innerHTML = '<span class="text-base leading-none">⚠️</span><span><b>48h-Interferenz:</b> Beinlastige Belastung in den letzten 48h. Heute Bench/OHP/Row – oder Last um 10–15 % reduzieren.</span>';
  } else {
    warnEl.className = 'mb-4 hidden';
  }

  // e1RM
  const e1rm = L.reps > 0 ? Analytics.e1rm(L.weight, L.reps) : 0;
  const best = d.bests[L.exercise];
  const bestVal = best?.e1RM || 0;
  const delta = bestVal ? round1(e1rm - bestVal) : null;
  const deltaPct = bestVal ? ((e1rm / bestVal - 1) * 100) : null;
  const isPr = bestVal > 0 && e1rm > bestVal;
  const ratio = bestVal ? clamp((e1rm / bestVal) * 100, 0, 110) : 0;
  const intensity = bestVal ? Math.round((L.weight / bestVal) * 100) : null;
  const deltaCls = delta === null ? 'text-slate-400' : delta > 0 ? 'text-emerald-300' : delta === 0 ? 'text-slate-300' : 'text-rose-300';
  $('#e1rmPanel').innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-300/80">Live e1RM
          ${isPr ? `<span class="${state.lastE1rmWasPr ? '' : 'animate-pop'} rounded-full bg-gradient-to-r from-amber-300 to-orange-400 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-slate-950">🏆 Neuer PR</span>` : ''}
        </div>
        <div class="font-display text-4xl font-bold tracking-tight text-white tabular">${fmt(e1rm)}<span class="ml-1 text-base font-medium text-slate-400">kg</span></div>
        <div class="text-sm font-semibold ${deltaCls} tabular">${delta === null ? 'Erster Eintrag für diese Übung' : `${delta > 0 ? '+' : ''}${fmt(delta)} kg (${deltaPct > 0 ? '+' : ''}${fmt(deltaPct)} %) vs. Bestwert`}</div>
      </div>
      <div class="text-right">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Bestwert</div>
        <div class="font-display text-xl font-bold text-slate-200 tabular">${bestVal ? fmt(bestVal) + ' kg' : '–'}</div>
        <div class="text-[11px] text-slate-500">${best ? `${fmt(best.weight)} × ${best.reps} · ${fmtShortDate(best.date)}` : ''}</div>
      </div>
    </div>
    <div class="relative mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
      <div class="h-full rounded-full transition-all duration-300 ${isPr ? 'bg-gradient-to-r from-amber-300 to-orange-400' : 'bg-gradient-to-r from-emerald-500 to-teal-300'}" style="width:${(ratio / 110) * 100}%"></div>
      <div class="absolute top-0 h-full w-0.5 bg-white/60" style="left:${(100 / 110) * 100}%" title="Bestwert"></div>
    </div>
    <div class="mt-2 flex justify-between text-[11px] text-slate-400">
      <span>Intensität: <b class="text-slate-200">${intensity === null ? '–' : intensity + ' %'}</b> vom Best-e1RM</span>
      <span>Volumen: <b class="text-slate-200">${fmt(L.sets * L.reps * L.weight, 0)} kg</b></span>
    </div>`;
  state.lastE1rmWasPr = isPr;

  renderPlates();
}

function renderPlates() {
  const L = state.logger;
  const el = $('#plateViz');
  if (L.exercise === 'Weighted Pull-Up') {
    el.innerHTML = `<div class="flex items-center justify-center gap-2 rounded-xl bg-white/[0.03] py-3 text-xs text-slate-400">⛓️ Zusatzgewicht am Dip-Gürtel: <b class="text-slate-200">${fmt(L.weight)} kg</b></div>`;
    return;
  }
  let perSide = (L.weight - BAR_WEIGHT) / 2;
  if (perSide < 0) {
    el.innerHTML = '<div class="rounded-xl bg-white/[0.03] py-3 text-center text-xs text-slate-400">Unter Stangengewicht (20 kg)</div>';
    return;
  }
  const plates = [];
  PLATES.forEach((p) => { while (perSide >= p - 1e-9) { plates.push(p); perSide = round1((perSide - p) * 100) / 100; } });
  const rest = round1(perSide * 2);
  el.innerHTML = `
    <div class="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
      <div class="flex h-16 flex-1 items-center">
        <div class="h-2 w-8 shrink-0 rounded-l-full bg-slate-500"></div>
        <div class="h-5 w-1.5 shrink-0 rounded-sm bg-slate-400"></div>
        ${plates.map((p) => `<div class="${PLATE_STYLE[p]} mx-[1px] w-2.5 shrink-0 rounded-[3px] shadow-md ring-1 ring-black/30" title="${fmt(p, 2)} kg"></div>`).join('')}
        <div class="h-3 flex-1 rounded-r-md bg-gradient-to-r from-slate-400 to-slate-500"></div>
      </div>
      <div class="text-right text-[11px] leading-tight text-slate-400">
        <div class="font-semibold uppercase tracking-wider text-slate-500">pro Seite</div>
        <div class="font-semibold text-slate-200">${plates.length ? plates.map((p) => fmt(p, 2)).join(' + ') : 'leere Stange'}</div>
        ${rest > 0 ? `<div class="text-amber-300">+${fmt(rest, 2)} kg Rest</div>` : ''}
      </div>
    </div>`;
}

function renderTodaySets() {
  const today = todayIso();
  const sets = state.derived.strength.filter((s) => s.Date === today);
  const totalSets = sets.reduce((a, s) => a + (num(s.Sets) || 1), 0);
  $('#todaySetCount').textContent = `${totalSets} ${totalSets === 1 ? 'Satz' : 'Sätze'} heute`;
  $('#todaySets').innerHTML = sets.length ? `
    <div class="text-xs font-semibold uppercase tracking-wider text-slate-500">Heute geloggt</div>
    ${sets.map((s) => `
      <div class="flex items-center justify-between rounded-xl border border-white/[0.05] bg-slate-950/40 px-3 py-2 text-sm animate-fade-up">
        <div class="flex items-center gap-2 min-w-0">
          <span class="h-2 w-2 shrink-0 rounded-full" style="background:${EXERCISE_COLORS[s.Exercise]}"></span>
          <span class="truncate font-semibold text-white">${escapeHtml(s.Exercise)}</span>
          <span class="text-slate-400 tabular">${s.Sets}×${s.Reps} @ ${fmt(num(s.Weight_kg))} kg</span>
        </div>
        <div class="flex items-center gap-2 text-xs tabular">
          ${state.prLogIds.has(s.Log_ID) ? '<span title="PR">🏆</span>' : ''}
          ${s.RIR !== '' && s.RIR !== undefined ? `<span class="text-slate-500">RIR ${s.RIR}</span>` : ''}
          <span class="font-semibold text-emerald-300">${fmt(num(s.e1RM))}</span>
        </div>
      </div>`).join('')}` : '';
}

async function logSet() {
  const L = state.logger;
  if (!(L.weight >= 0) || !(L.reps >= 1)) { toast('Bitte gültiges Gewicht und Wdh. eingeben.', 'error'); return; }
  const btn = $('#btnLogSet');
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<svg class="h-5 w-5 spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.2-8.6" stroke-linecap="round"/></svg> Speichere…';
  try {
    const res = await api('logStrength', { exercise: L.exercise, weight: L.weight, reps: L.reps, sets: L.sets, rir: L.rir, date: todayIso() });
    vibrate(res.isPR ? [20, 40, 20] : 12);
    if (res.isPR) state.prLogIds.add(res.logId);
    // Optimistisches Update, danach stiller Reload für konsistente Aktivitäten
    if (res.entry) state.data.strengthLog = [res.entry, ...(state.data.strengthLog || [])];
    state.derived = buildDerived(state.data);
    renderLogger();
    toast(res.isPR ? `🏆 Neuer PR! ${L.exercise}: e1RM ${fmt(res.e1RM)} kg (vorher ${fmt(res.previousBest)})` : `✓ ${L.exercise} ${L.sets}×${L.reps} @ ${fmt(L.weight)} kg · e1RM ${fmt(res.e1RM)} kg`, 'success');
    loadDashboard({ silent: true });
  } catch (err) {
    toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/* ---------------- Activity Tagger ---------------- */
function renderTagger() {
  const acts = state.derived.activities;
  const open = acts.filter(Analytics.isUntagged);
  $('#openCount').textContent = open.length;
  const filterBtn = (el, active) => { el.className = `rounded-lg px-2.5 py-1 transition ${active ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`; };
  filterBtn($('#filterAll'), state.taggerFilter === 'all');
  filterBtn($('#filterOpen'), state.taggerFilter === 'open');

  const list = (state.taggerFilter === 'open' ? open : acts).slice(0, 12);
  if (!list.length) {
    $('#activityList').innerHTML = `<li class="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">${state.taggerFilter === 'open' ? '🎉 Alles getaggt!' : 'Noch keine Aktivitäten – starte einen Garmin Sync.'}</li>`;
    return;
  }
  $('#activityList').innerHTML = list.map((a) => activityItem(a)).join('');
}

function activityItem(a) {
  const b = BUCKETS[a.Bucket];
  const t = TYPE_META[a.Type] || TYPE_META.Other;
  const untagged = Analytics.isUntagged(a);
  const expanded = state.expandedId === String(a.Activity_ID);
  const rpe = num(a.RPE);
  const meta = [relDay(a.Date), a.Duration_Min ? `${a.Duration_Min} min` : null, num(a.Garmin_Load) ? `Load ${a.Garmin_Load}` : null, num(a.Avg_HR) ? `Ø ${a.Avg_HR} bpm` : null].filter(Boolean).join(' · ');
  const rgb = b ? b.rgb : '148,163,184';
  return `
  <li class="overflow-hidden rounded-2xl border transition-colors ${expanded ? 'border-emerald-400/30 bg-slate-950/60' : 'border-white/[0.06] bg-slate-950/30 hover:border-white/15'}">
    <button type="button" data-act-toggle="${escapeHtml(a.Activity_ID)}" class="flex w-full items-center gap-3 p-3 text-left" aria-expanded="${expanded}">
      <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl" style="background:rgba(${rgb},.12);box-shadow:inset 0 0 0 1px rgba(${rgb},.25)">${t.icon}</span>
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2">
          <span class="truncate text-sm font-semibold text-white">${escapeHtml(a.Notes || t.label)}</span>
          ${untagged ? '<span class="shrink-0 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">Offen</span>' : ''}
        </span>
        <span class="block truncate text-xs text-slate-400">${escapeHtml(t.label)} · ${meta}</span>
      </span>
      <span class="flex shrink-0 flex-col items-end gap-1">
        ${b ? `<span class="rounded-full px-2 py-0.5 text-[10px] font-bold ${b.text}" style="background:rgba(${rgb},.12)">${b.label}</span>` : '<span class="text-[10px] text-slate-500">kein Bucket</span>'}
        <span class="text-[11px] tabular ${rpe ? 'text-slate-300' : 'text-slate-600'}">RPE ${rpe ?? '–'}${a.Muscle_Focus ? ` · ${MUSCLE_FOCUS[a.Muscle_Focus] || a.Muscle_Focus}` : ''}</span>
      </span>
    </button>
    ${expanded ? tagEditor(a) : ''}
  </li>`;
}

function tagEditor(a) {
  const d = state.draft;
  const rpeColor = (n) => (n <= 4 ? '16,185,129' : n <= 6 ? '56,189,248' : n <= 8 ? '245,158,11' : '244,63,94');
  const rpeDesc = { 1: 'sehr leicht', 2: 'leicht', 3: 'locker', 4: 'moderat', 5: 'mittel', 6: 'fordernd', 7: 'hart', 8: 'sehr hart', 9: 'fast max.', 10: 'maximal' };
  return `
    <div class="space-y-4 border-t border-white/[0.06] p-3 animate-fade-up">
      <div>
        <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Bucket</div>
        <div class="grid grid-cols-3 gap-2">
          ${Object.entries(BUCKETS).map(([k, b]) => `
            <button type="button" data-draft-bucket="${k}" class="rounded-xl border px-2 py-2.5 text-sm font-semibold transition active:scale-95 ${d.bucket === k ? b.text : 'border-white/10 text-slate-300 hover:bg-white/5'}"
              style="${d.bucket === k ? `border-color:rgba(${b.rgb},.6);background:rgba(${b.rgb},.15)` : ''}">${b.icon} ${b.label}</button>`).join('')}
        </div>
      </div>
      <div>
        <div class="mb-1.5 flex justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500"><span>RPE</span><span class="normal-case tracking-normal text-slate-300">${d.rpe ? `${d.rpe} · ${rpeDesc[d.rpe]}` : 'wählen'}</span></div>
        <div class="grid grid-cols-10 gap-1">
          ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `
            <button type="button" data-draft-rpe="${n}" class="h-10 rounded-lg text-sm font-bold transition active:scale-90 ${d.rpe === n ? 'text-slate-950' : 'text-slate-300'}"
              style="background:rgba(${rpeColor(n)},${d.rpe === n ? '1' : '.1'});box-shadow:inset 0 0 0 1px rgba(${rpeColor(n)},.35)">${n}</button>`).join('')}
        </div>
      </div>
      <div>
        <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Muscle Focus</div>
        <div class="flex flex-wrap gap-1.5">
          ${Object.entries(MUSCLE_FOCUS).map(([k, label]) => `<button type="button" data-draft-focus="${k}" class="chip ${d.focus === k ? 'chip-on' : 'chip-off'}">${label}</button>`).join('')}
        </div>
      </div>
      <div>
        <label for="draftNotes" class="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Notiz</label>
        <input id="draftNotes" class="input" maxlength="500" value="${escapeHtml(d.notes ?? '')}" placeholder="z. B. WOD-Name, Gefühl, Skalierung" />
      </div>
      <div class="flex gap-2">
        <button type="button" data-act-save="${escapeHtml(a.Activity_ID)}" class="btn btn-primary flex-1">Speichern</button>
        <button type="button" data-act-cancel class="btn btn-ghost">Abbrechen</button>
      </div>
    </div>`;
}

function toggleActivity(id) {
  if (state.expandedId === String(id)) { state.expandedId = null; renderTagger(); return; }
  const a = state.derived.activities.find((x) => String(x.Activity_ID) === String(id));
  if (!a) return;
  state.expandedId = String(id);
  state.draft = { bucket: a.Bucket || '', rpe: num(a.RPE), focus: a.Muscle_Focus || Analytics.defaultFocus(a), notes: a.Notes || '' };
  renderTagger();
}

async function saveActivityTag(id, btn) {
  const d = state.draft;
  const notesEl = $('#draftNotes');
  if (notesEl) d.notes = notesEl.value;
  if (!d.bucket || !d.rpe || !d.focus) { toast('Bitte Bucket, RPE und Muscle Focus wählen.', 'error'); return; }
  btn.disabled = true;
  btn.textContent = 'Speichere…';
  try {
    const res = await api('tagActivity', { activityId: String(id), bucket: d.bucket, rpe: d.rpe, muscleFocus: d.focus, notes: d.notes });
    const updated = res.activity || {};
    state.data.activities = (state.data.activities || []).map((a) => (String(a.Activity_ID) === String(id) ? { ...a, ...updated, Bucket: d.bucket, RPE: d.rpe, Muscle_Focus: d.focus, Notes: d.notes } : a));
    state.derived = buildDerived(state.data);
    state.expandedId = null;
    vibrate(12);
    renderAll();
    toast('✓ Aktivität getaggt – Kompass & Ermüdung aktualisiert', 'success');
  } catch (err) {
    toast(`Tagging fehlgeschlagen: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Speichern';
  }
}

/* ---------------- Charts ---------------- */
function setupChartDefaults() {
  if (!window.Chart) return;
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.borderColor = 'rgba(148,163,184,0.08)';
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(2,6,23,0.92)';
  Chart.defaults.plugins.tooltip.borderColor = 'rgba(148,163,184,0.2)';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.boxHeight = 8;
}

function renderCharts() {
  if (!window.Chart) return;
  renderReadinessChart();
  renderStrengthChart();
}

function renderReadinessChart() {
  const d = state.derived;
  const today = todayIso();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const mByDate = Object.fromEntries(d.metrics.map((m) => [m.Date, m]));
  const loadBy = (bucket) => days.map((day) => d.activities.filter((a) => a.Date === day && a.Bucket === bucket).reduce((s, a) => s + Analytics.activityLoad(a), 0) || null);
  const series = (key) => days.map((day) => num(mByDate[day]?.[key]));

  const datasets = [
    ...Object.entries(BUCKETS).map(([k, b]) => ({
      type: 'bar', label: `Load ${b.label}`, data: loadBy(k), backgroundColor: `rgba(${b.rgb},0.55)`, hoverBackgroundColor: b.hex,
      borderRadius: 5, borderSkipped: false, stack: 'load', yAxisID: 'yLoad', order: 3, maxBarThickness: 26
    })),
    { type: 'line', label: 'HRV Nacht (ms)', data: series('HRV_Night'), borderColor: '#34d399', backgroundColor: '#34d399', yAxisID: 'yScore', tension: 0.35, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2.5, order: 1, spanGaps: true },
    { type: 'line', label: 'HRV 7d Ø', data: series('HRV_7d_Avg'), borderColor: 'rgba(52,211,153,0.45)', borderDash: [5, 5], yAxisID: 'yScore', tension: 0.35, pointRadius: 0, borderWidth: 1.5, order: 2, spanGaps: true },
    { type: 'line', label: 'Schlaf-Score', data: series('Sleep_Score'), borderColor: '#a78bfa', backgroundColor: '#a78bfa', yAxisID: 'yScore', tension: 0.35, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2.5, order: 1, spanGaps: true }
  ];
  const labels = days.map((day) => `${WEEKDAYS[isoToUtc(day).getUTCDay()]} ${fmtShortDate(day)}`);

  // Kennzahlen
  const loads7 = days.slice(-7).map((day) => d.activities.filter((a) => a.Date === day).reduce((s, a) => s + Analytics.activityLoad(a), 0));
  const loadsPrev = days.slice(0, 7).map((day) => d.activities.filter((a) => a.Date === day).reduce((s, a) => s + Analytics.activityLoad(a), 0));
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const ratio = sum(loadsPrev) ? sum(loads7) / sum(loadsPrev) : null;
  $('#loadStats').innerHTML = `
    <span class="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1">7T Load <b class="text-white tabular">${fmt(sum(loads7), 0)}</b></span>
    <span class="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1">vs. Vorwoche <b class="tabular ${ratio > 1.3 ? 'text-rose-300' : ratio > 1.1 ? 'text-amber-300' : 'text-emerald-300'}">${ratio ? (ratio >= 1 ? '+' : '') + fmt((ratio - 1) * 100, 0) + ' %' : '–'}</b></span>`;

  const chart = state.charts.readiness;
  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets.forEach((ds, i) => { ds.data = datasets[i].data; });
    chart.update();
    return;
  }
  state.charts.readiness = new Chart($('#chartReadiness'), {
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { padding: 14 } } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 8 } },
        yLoad: { type: 'linear', position: 'left', stacked: true, beginAtZero: true, title: { display: true, text: 'Training Load' }, grid: { color: 'rgba(148,163,184,0.07)' } },
        yScore: { type: 'linear', position: 'right', min: 30, max: 100, title: { display: true, text: 'HRV (ms) / Schlaf' }, grid: { drawOnChartArea: false } }
      }
    }
  });
}

function renderStrengthChart() {
  const d = state.derived;
  const asc = d.strength.slice().reverse();
  const dates = [...new Set(asc.map((s) => s.Date))].sort();
  const exercisesWithData = EXERCISES.filter((ex) => asc.some((s) => s.Exercise === ex));

  $('#strengthFilter').innerHTML = exercisesWithData.map((ex) => {
    const on = !state.hiddenExercises.has(ex);
    return `<button data-strength-toggle="${ex}" class="chip shrink-0 ${on ? 'border-white/20 bg-white/[0.06] text-white' : 'chip-off opacity-50'}">
      <span class="h-2 w-2 rounded-full" style="background:${EXERCISE_COLORS[ex]}"></span>${EXERCISE_SHORT[ex]}</button>`;
  }).join('');

  $('#prBadges').innerHTML = ['Back Squat', 'Bench Press', 'Deadlift'].filter((ex) => d.bests[ex]).map((ex) =>
    `<span class="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-xs"><span class="text-slate-400">${EXERCISE_SHORT[ex]}</span> <b class="text-white tabular">${fmt(d.bests[ex].e1RM)}</b></span>`).join('');

  const datasets = exercisesWithData.map((ex) => ({
    label: ex,
    data: dates.map((day) => {
      const vals = asc.filter((s) => s.Exercise === ex && s.Date === day).map((s) => num(s.e1RM) ?? Analytics.e1rm(s.Weight_kg, s.Reps));
      return vals.length ? Math.max(...vals) : null;
    }),
    borderColor: EXERCISE_COLORS[ex], backgroundColor: EXERCISE_COLORS[ex] + '33',
    tension: 0.35, spanGaps: true, pointRadius: 3.5, pointHoverRadius: 7, borderWidth: 2.5,
    hidden: state.hiddenExercises.has(ex)
  }));
  const labels = dates.map(fmtShortDate);

  if (state.charts.strength) state.charts.strength.destroy();
  state.charts.strength = new Chart($('#chartStrength'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)} kg e1RM` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 10 } },
        y: { title: { display: true, text: 'e1RM (kg)' }, grid: { color: 'rgba(148,163,184,0.07)' }, ticks: { callback: (v) => fmt(v, 0) } }
      }
    }
  });
}

/* ---------------- Gemini Coach ---------------- */
const COACH_PRESET_LABELS = { today: '☀️ Was steht heute an?', rack: '🏋️ Rack-Session planen', week: '📊 Wochen-Analyse' };

function setupMarked() {
  if (!window.marked) return;
  // Rohes HTML aus der KI-Antwort wird escaped (XSS-Schutz ohne zusätzliche Library)
  marked.use({
    gfm: true, breaks: true,
    renderer: { html(token) { return escapeHtml(typeof token === 'string' ? token : (token && token.text) || ''); } }
  });
}
function renderMarkdown(md) {
  if (!window.marked) return `<pre class="whitespace-pre-wrap">${escapeHtml(md)}</pre>`;
  return marked.parse(md);
}

function renderCoach() {
  const box = $('#coachMessages');
  const coachAvatar = '<span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500/40 to-emerald-400/40 text-sm">✨</span>';
  const welcome = `
    <div class="flex gap-3 animate-fade-up">
      ${coachAvatar}
      <div class="rounded-2xl rounded-tl-sm border border-white/[0.06] bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
        Hi! Ich bin dein <b class="text-white">Hybrid Coach</b>. Ich kenne deine letzten 10 Tage – Readiness, 48h-Ermüdung, Wochen-Buckets und e1RM-Verlauf.
        Wähle einen Schnell-Button oder stell mir eine Frage.
      </div>
    </div>`;
  const msgs = state.coach.map((m) => m.role === 'user' ? `
    <div class="flex justify-end animate-fade-up">
      <div class="max-w-[85%] rounded-2xl rounded-tr-sm bg-emerald-500/15 px-4 py-2.5 text-sm text-emerald-50 ring-1 ring-emerald-400/20">${escapeHtml(m.text)}</div>
    </div>` : m.role === 'error' ? `
    <div class="flex gap-3 animate-fade-up">${coachAvatar}
      <div class="rounded-2xl rounded-tl-sm border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">⚠️ ${escapeHtml(m.text)}</div>
    </div>` : `
    <div class="flex gap-3 animate-fade-up">${coachAvatar}
      <div class="prose prose-invert prose-sm min-w-0 max-w-none flex-1 rounded-2xl rounded-tl-sm border border-white/[0.06] bg-slate-950/50 px-4 py-3
        prose-headings:font-display prose-headings:text-white prose-h3:mt-4 prose-h3:mb-2 prose-h3:text-base prose-strong:text-white
        prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-table:text-xs prose-th:text-slate-300 prose-td:py-1.5 prose-blockquote:border-emerald-400/50 prose-blockquote:text-slate-400 prose-a:text-emerald-300">
        ${renderMarkdown(m.text)}
      </div>
    </div>`).join('');
  const typing = state.coachBusy ? `
    <div class="flex gap-3">${coachAvatar}
      <div class="dot-typing flex items-center gap-1 rounded-2xl rounded-tl-sm border border-white/[0.06] bg-slate-950/50 px-4 py-3">
        <span class="h-2 w-2 rounded-full bg-emerald-300"></span><span class="h-2 w-2 rounded-full bg-emerald-300"></span><span class="h-2 w-2 rounded-full bg-emerald-300"></span>
        <span class="ml-2 text-xs text-slate-500">Coach analysiert deine Daten…</span>
      </div>
    </div>` : '';
  box.innerHTML = welcome + msgs + typing;
  box.scrollTop = box.scrollHeight;
  $$('#coachPresets button').forEach((b) => { b.disabled = state.coachBusy; });
  $('#coachSend').disabled = state.coachBusy;
}

async function askCoach(prompt, display) {
  if (state.coachBusy || !prompt.trim()) return;
  state.coach.push({ role: 'user', text: display || prompt });
  state.coachBusy = true;
  renderCoach();
  try {
    const res = await api('askGemini', { prompt });
    state.coach.push({ role: 'coach', text: res.reply || '_(leere Antwort)_' });
  } catch (err) {
    state.coach.push({ role: 'error', text: `Coach nicht erreichbar: ${err.message}` });
  } finally {
    state.coachBusy = false;
    renderCoach();
  }
}

/* ---------------- Settings ---------------- */
function openSettings() {
  const cfg = getConfig();
  $('#gasUrlInput').value = cfg.url;
  $('#appPinInput').value = cfg.pin;
  $('#mockToggle').checked = cfg.forceMock;
  updateSettingsHint();
  $('#settingsModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#gasUrlInput').focus(), 50);
}
function closeSettings() {
  $('#settingsModal').classList.add('hidden');
  document.body.style.overflow = '';
}
function settingsFormValues() {
  return { url: $('#gasUrlInput').value.trim(), pin: $('#appPinInput').value, forceMock: $('#mockToggle').checked };
}
function setSettingsStatus(msg, type = 'info') {
  const el = $('#settingsStatus');
  const cls = { info: 'bg-white/5 text-slate-300', success: 'bg-emerald-400/10 text-emerald-300', error: 'bg-rose-400/10 text-rose-300', warn: 'bg-amber-400/10 text-amber-300' }[type];
  el.className = `rounded-xl px-3 py-2 text-xs ${cls}`;
  el.textContent = msg;
}
function updateSettingsHint() {
  const v = settingsFormValues();
  if (isMockMode(v)) setSettingsStatus(v.forceMock ? '🧪 Demo-Modus erzwungen – es werden lokale Mock-Daten verwendet.' : '🧪 Keine GAS_URL hinterlegt – Demo-Modus ist automatisch aktiv.', 'warn');
  else setSettingsStatus('🔗 Live-Modus: Daten kommen aus deinem Google Sheet via Apps Script.', 'success');
}
async function testConnection() {
  const v = settingsFormValues();
  if (isMockMode(v)) { setSettingsStatus('🧪 Demo-Modus aktiv – keine Verbindung nötig.', 'warn'); return; }
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(v.url)) setSettingsStatus('Hinweis: URL sieht nicht nach einer Apps-Script-Web-App aus. Teste trotzdem…', 'warn');
  else setSettingsStatus('Teste Verbindung…', 'info');
  try {
    const res = await api('getDashboard', { days: 14 }, v);
    setSettingsStatus(`✓ Verbunden: ${res.dailyMetrics?.length ?? 0} Tage, ${res.activities?.length ?? 0} Aktivitäten, ${res.strengthLog?.length ?? 0} Kraft-Einträge.`, 'success');
  } catch (err) {
    setSettingsStatus(`✗ ${err.message}`, 'error');
  }
}
async function initSheets() {
  const v = settingsFormValues();
  setSettingsStatus('Lege Tabellenblätter an…', 'info');
  try {
    const res = await api('initSheets', {}, v);
    const created = (res.sheets || []).filter((s) => s.created).map((s) => s.name);
    setSettingsStatus(res.mock ? '🧪 Demo: Im Live-Modus würden jetzt die 4 Tabellenblätter angelegt.' :
      `✓ Sheets bereit. Neu: ${created.length ? created.join(', ') : 'keine'} · Targets ergänzt: ${(res.targetsAdded || []).join(', ') || 'keine'}`, 'success');
  } catch (err) {
    setSettingsStatus(`✗ ${err.message}`, 'error');
  }
}
function saveSettings() {
  const v = settingsFormValues();
  localStorage.setItem(STORAGE_KEYS.url, v.url);
  localStorage.setItem(STORAGE_KEYS.pin, v.pin);
  localStorage.setItem(STORAGE_KEYS.mock, String(v.forceMock));
  closeSettings();
  state.coach = [];
  state.loggerInitialized = false;
  toast(isMockMode() ? '🧪 Demo-Modus aktiv' : '🔗 Live-Modus aktiv – lade Daten…', 'info');
  loadDashboard();
}

/* ---------------- Garmin Sync ---------------- */
async function garminSync() {
  const btn = $('#btnSync');
  btn.disabled = true;
  $('#syncIcon').classList.add('spin');
  try {
    const res = await api('triggerGarminSync', { days: 3 });
    toast(res.message || 'Garmin Sync abgeschlossen', res.errors?.length ? 'warn' : 'success', 5000);
    await loadDashboard({ silent: true });
  } catch (err) {
    toast(`Garmin Sync fehlgeschlagen: ${err.message}`, 'error', 6000);
  } finally {
    btn.disabled = false;
    $('#syncIcon').classList.remove('spin');
  }
}

/* ---------------- Toasts ---------------- */
function toast(msg, type = 'info', ms = 3200) {
  const cls = {
    info: 'border-white/10 bg-slate-900/95 text-slate-100',
    success: 'border-emerald-400/30 bg-emerald-950/95 text-emerald-100',
    warn: 'border-amber-400/30 bg-amber-950/95 text-amber-100',
    error: 'border-rose-400/30 bg-rose-950/95 text-rose-100'
  }[type];
  const el = document.createElement('div');
  el.className = `pointer-events-auto w-full rounded-xl border px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl transition-all duration-300 animate-fade-up ${cls}`;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(-6px)'; setTimeout(() => el.remove(), 300); }, ms);
}

/* ==========================================================================
 *  9) Events
 * ======================================================================= */
function bindStepper(btn, fn) {
  let t1, t2;
  const stop = () => { clearTimeout(t1); clearInterval(t2); };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    fn(); vibrate(6);
    t1 = setTimeout(() => { t2 = setInterval(fn, 90); }, 420);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
  btn.addEventListener('click', (e) => { if (e.detail === 0) fn(); }); // Tastatur
}

function changeLogger(field, delta, min, max) {
  const L = state.logger;
  L[field] = clamp(Math.round((L[field] + delta) * 100) / 100, min, max);
  renderLoggerInputs();
}
function renderLoggerInputs() {
  const L = state.logger;
  $('#weightInput').value = L.weight;
  $('#repsInput').value = L.reps;
  $('#setsInput').value = L.sets;
  updateLoggerLive();
}

function bindEvents() {
  // Header
  $('#btnSync').addEventListener('click', garminSync);
  $('#btnSettings').addEventListener('click', openSettings);

  // Settings
  $$('[data-close-settings]').forEach((el) => el.addEventListener('click', closeSettings));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#settingsModal').classList.contains('hidden')) closeSettings(); });
  $('#togglePin').addEventListener('click', () => {
    const inp = $('#appPinInput');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('#togglePin').textContent = inp.type === 'password' ? 'Zeigen' : 'Verbergen';
  });
  ['#gasUrlInput', '#mockToggle'].forEach((s) => $(s).addEventListener('input', updateSettingsHint));
  $('#btnTestConnection').addEventListener('click', testConnection);
  $('#btnInitSheets').addEventListener('click', initSheets);
  $('#btnSaveSettings').addEventListener('click', saveSettings);

  // Logger
  $('#exerciseChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-exercise]');
    if (b) { selectExercise(b.dataset.exercise); vibrate(6); }
  });
  bindStepper($('#weightMinus'), () => changeLogger('weight', -2.5, 0, 500));
  bindStepper($('#weightPlus'), () => changeLogger('weight', 2.5, 0, 500));
  bindStepper($('#repsMinus'), () => changeLogger('reps', -1, 1, 50));
  bindStepper($('#repsPlus'), () => changeLogger('reps', 1, 1, 50));
  bindStepper($('#setsMinus'), () => changeLogger('sets', -1, 1, 20));
  bindStepper($('#setsPlus'), () => changeLogger('sets', 1, 1, 20));
  $$('[data-weight-delta]').forEach((b) => b.addEventListener('click', () => changeLogger('weight', Number(b.dataset.weightDelta), 0, 500)));
  const bindInput = (sel, field, min, max) => {
    $(sel).addEventListener('input', (e) => { const v = num(e.target.value.replace(',', '.')); if (v !== null) { state.logger[field] = clamp(v, min, max); updateLoggerLive(); } });
    $(sel).addEventListener('blur', () => { $(sel).value = state.logger[field]; });
  };
  bindInput('#weightInput', 'weight', 0, 500);
  bindInput('#repsInput', 'reps', 1, 50);
  bindInput('#setsInput', 'sets', 1, 20);
  $('#rirSlider').addEventListener('input', (e) => { state.logger.rir = Number(e.target.value); updateLoggerLive(); });
  $('#btnLogSet').addEventListener('click', logSet);

  // Tagger
  $('#filterAll').addEventListener('click', () => { state.taggerFilter = 'all'; renderTagger(); });
  $('#filterOpen').addEventListener('click', () => { state.taggerFilter = 'open'; renderTagger(); });
  $('#activityList').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const notesEl = $('#draftNotes');
    if (notesEl) state.draft.notes = notesEl.value;
    if (t.dataset.actToggle) toggleActivity(t.dataset.actToggle);
    else if (t.dataset.draftBucket) { state.draft.bucket = t.dataset.draftBucket; vibrate(6); renderTagger(); }
    else if (t.dataset.draftRpe) { state.draft.rpe = Number(t.dataset.draftRpe); vibrate(6); renderTagger(); }
    else if (t.dataset.draftFocus) { state.draft.focus = t.dataset.draftFocus; vibrate(6); renderTagger(); }
    else if (t.dataset.actSave) saveActivityTag(t.dataset.actSave, t);
    else if (t.hasAttribute('data-act-cancel')) { state.expandedId = null; renderTagger(); }
  });

  // Strength chart filter
  $('#strengthFilter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-strength-toggle]');
    if (!b) return;
    const ex = b.dataset.strengthToggle;
    state.hiddenExercises.has(ex) ? state.hiddenExercises.delete(ex) : state.hiddenExercises.add(ex);
    renderStrengthChart();
  });

  // Coach
  $$('#coachPresets [data-preset]').forEach((b) => b.addEventListener('click', () => askCoach(b.dataset.preset, COACH_PRESET_LABELS[b.dataset.preset])));
  $('#coachForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#coachInput');
    const q = inp.value.trim();
    if (!q) return;
    inp.value = '';
    inp.style.height = '';
    askCoach(q);
  });
  $('#coachInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#coachForm').requestSubmit(); }
  });
  $('#coachInput').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; });
  $('#btnClearCoach').addEventListener('click', () => { state.coach = []; renderCoach(); });

  // Bottom-Nav: aktiver Abschnitt
  const sections = ['overview', 'logger', 'tagger', 'analysis', 'coach'].map((id) => document.getElementById(id));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) $$('#bottomNav [data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === en.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => s && io.observe(s));
}

/* ==========================================================================
 *  10) Init
 * ======================================================================= */
function renderSkeletons() {
  const sk = '<div class="animate-pulse space-y-3"><div class="h-4 w-24 rounded bg-white/10"></div><div class="h-16 rounded-xl bg-white/5"></div><div class="h-10 rounded-xl bg-white/5"></div></div>';
  ['#readinessCard', '#compassCard', '#fatigueCard'].forEach((s) => { $(s).innerHTML = sk; });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW Registrierung fehlgeschlagen', e)));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupChartDefaults();
  setupMarked();
  loadBuildInfo();
  renderSkeletons();
  bindEvents();
  renderCoach();
  loadDashboard();
  registerServiceWorker();
});
