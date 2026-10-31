// Garmin Personal API Sync
/**
 * ============================================================================
 *  Hybrid Athlete Hub – GarminSync.gs
 *  Holt Wellness-Daten (Sleep, HRV, Resting HR, Body Battery) und Aktivitäten
 *  aus der Garmin Connect Personal API und schreibt sie per Upsert in
 *  Daily_Metrics (Key: Date) und Activities (Key: Activity_ID).
 *  → Mehrfaches Ausführen erzeugt NIE doppelte Zeilen.
 *
 *  Script Properties:
 *    GARMIN_API_KEY   – Pflicht. Personal API Key aus Garmin Connect.
 *    GARMIN_API_BASE  – optional. Basis-URL der Daten-Endpunkte
 *                       (Default: https://apis.garmin.com/wellness-api/rest)
 *    GARMIN_PATH_DAILIES / GARMIN_PATH_SLEEPS / GARMIN_PATH_HRV / GARMIN_PATH_ACTIVITIES
 *                     – optional. Pfad-Templates mit Platzhaltern {start}, {end}
 *                       (Unix-Sekunden) und {date} (YYYY-MM-DD).
 *
 *  Zeitgesteuert: installDailyGarminTrigger() einmal im Editor ausführen.
 * ============================================================================
 */

var GARMIN_TOKEN_URL = 'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token';
var GARMIN_DEFAULT_BASE = 'https://apis.garmin.com/wellness-api/rest';
var GARMIN_DEFAULT_PATHS = {
  dailies: '/dailies?uploadStartTimeInSeconds={start}&uploadEndTimeInSeconds={end}',
  sleeps: '/sleeps?uploadStartTimeInSeconds={start}&uploadEndTimeInSeconds={end}',
  hrv: '/hrv?uploadStartTimeInSeconds={start}&uploadEndTimeInSeconds={end}',
  activities: '/activities?uploadStartTimeInSeconds={start}&uploadEndTimeInSeconds={end}'
};
var GARMIN_TOKEN_CACHE_KEY = 'GARMIN_BEARER_TOKEN';

/** Felder, die beim Re-Sync nicht überschrieben werden, wenn sie bereits (manuell) gepflegt wurden. */
var GARMIN_PRESERVE_FIELDS = ['Bucket', 'Type', 'RPE', 'Muscle_Focus', 'Notes', 'Source'];

/**
 * Haupteinstieg: synchronisiert die letzten `days` Tage (Default 3).
 * Kann vom Frontend (Action triggerGarminSync), aus dem Editor oder per Trigger
 * aufgerufen werden (Trigger übergeben ein Event-Objekt → wird ignoriert).
 * @param {number=} days
 * @return {Object} Sync-Zusammenfassung
 */
function syncGarminData(days) {
  var nDays = (typeof days === 'number' || (typeof days === 'string' && days !== '')) ? clampInt_(days, 1, 30, 3) : 3;
  var started = new Date();
  var summary = {
    days: nDays,
    metrics: { inserted: 0, updated: 0, unchanged: 0 },
    activities: { inserted: 0, updated: 0, unchanged: 0 },
    fetched: { dailies: 0, sleeps: 0, hrv: 0, activities: 0 },
    errors: []
  };

  var token = getGarminBearerToken_();
  var today = todayIso_();
  var metricsByDate = {};
  var activities = [];

  for (var i = nDays - 1; i >= 0; i--) {
    var date = addDaysIso_(today, -i);
    var win = dayWindowSeconds_(date);

    collectGarmin_(summary, 'dailies', token, win, function (items) {
      items.forEach(function (d) { mergeMetric_(metricsByDate, mapGarminDaily_(d, date)); });
    });
    collectGarmin_(summary, 'sleeps', token, win, function (items) {
      items.forEach(function (s) { mergeMetric_(metricsByDate, mapGarminSleep_(s, date)); });
    });
    collectGarmin_(summary, 'hrv', token, win, function (items) {
      items.forEach(function (h) { mergeMetric_(metricsByDate, mapGarminHrv_(h, date)); });
    });
    collectGarmin_(summary, 'activities', token, win, function (items) {
      items.forEach(function (a) {
        var mapped = mapGarminActivity_(a);
        if (mapped) activities.push(mapped);
      });
    });
  }

  // Readiness berechnen (Baseline Resting HR aus vorhandenen Daten)
  var metricRows = Object.keys(metricsByDate).sort().map(function (d) { return metricsByDate[d]; });
  if (metricRows.length) {
    var existing = readObjects_('Daily_Metrics');
    metricRows.forEach(function (m) {
      var baseline = restingHrBaseline_(existing.concat(metricRows), m.Date);
      var status = computeReadiness(m, baseline);
      if (status) m.Readiness_Status = status;
    });
    summary.metrics = upsertObjects_('Daily_Metrics', metricRows);
  }

  if (activities.length) {
    summary.activities = upsertObjects_('Activities', activities, { preserveIfSet: GARMIN_PRESERVE_FIELDS });
  }

  summary.durationMs = new Date() - started;
  summary.message = 'Garmin Sync: ' +
    summary.metrics.inserted + ' neue / ' + summary.metrics.updated + ' aktualisierte Tage, ' +
    summary.activities.inserted + ' neue / ' + summary.activities.updated + ' aktualisierte Aktivitäten' +
    (summary.errors.length ? ' (' + summary.errors.length + ' Fehler)' : '') + '.';
  console.log('[syncGarminData] ' + JSON.stringify(summary));
  return summary;
}

/** Legt einen täglichen Trigger (06:00) für syncGarminData an. Einmalig im Editor ausführen. */
function installDailyGarminTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncGarminData') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncGarminData').timeBased().everyDays(1).atHour(6).create();
  return 'Täglicher Garmin-Sync um ca. 06:00 Uhr eingerichtet.';
}

/* ----------------------------------------------------------------------------
 *  Auth: API Key → Bearer Token (gecacht)
 * ------------------------------------------------------------------------- */

function getGarminBearerToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(GARMIN_TOKEN_CACHE_KEY);
  if (cached) return cached;

  var apiKey = getProp_('GARMIN_API_KEY');
  if (!apiKey) throw apiError_('GARMIN_API_KEY ist in den Script Properties nicht gesetzt.', 500);

  var res = UrlFetchApp.fetch(GARMIN_TOKEN_URL, {
    method: 'post',
    headers: { Authorization: 'ApiKey ' + apiKey, Accept: 'application/json' },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) {
    console.error('[Garmin Token] HTTP ' + code + ': ' + body.slice(0, 500));
    throw apiError_('Garmin Token-Austausch fehlgeschlagen (HTTP ' + code + '). API Key prüfen.', 502);
  }

  var json = safeJson_(body) || {};
  var token = json.access_token || json.accessToken || json.token || (json.data && json.data.access_token);
  if (!token && body && body.indexOf('{') === -1) token = body.trim(); // Plain-Text-Token
  if (!token) throw apiError_('Garmin Token-Antwort enthält keinen Access Token.', 502);

  var expiresIn = Number(json.expires_in || json.expiresIn || 3600);
  // CacheService max. 6h, 5 Min Sicherheitsabstand
  var ttl = Math.max(60, Math.min(21600, expiresIn - 300));
  cache.put(GARMIN_TOKEN_CACHE_KEY, token, ttl);
  return token;
}

/* ----------------------------------------------------------------------------
 *  Fetch-Helfer mit sauberem Error-Logging
 * ------------------------------------------------------------------------- */

/**
 * Holt einen Endpoint für ein Zeitfenster und reicht die Items an `onItems` weiter.
 * Fehler werden geloggt und in summary.errors gesammelt, brechen den Sync aber nicht ab.
 */
function collectGarmin_(summary, kind, token, win, onItems) {
  try {
    var items = garminFetch_(kind, token, win);
    summary.fetched[kind] += items.length;
    onItems(items);
  } catch (err) {
    var msg = kind + ' ' + win.date + ': ' + (err && err.message ? err.message : err);
    console.error('[Garmin] ' + msg);
    if (summary.errors.length < 20) summary.errors.push(msg);
  }
}

/** GET auf einen Garmin-Endpoint, liefert immer ein Array. Retry bei 429/5xx. */
function garminFetch_(kind, token, win) {
  var base = (getProp_('GARMIN_API_BASE') || GARMIN_DEFAULT_BASE).replace(/\/+$/, '');
  var tpl = getProp_('GARMIN_PATH_' + kind.toUpperCase()) || GARMIN_DEFAULT_PATHS[kind];
  var url = base + tpl
    .replace('{start}', String(win.start))
    .replace('{end}', String(win.end))
    .replace('{date}', win.date);

  var res, code;
  for (var attempt = 0; attempt < 3; attempt++) {
    res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      muteHttpExceptions: true
    });
    code = res.getResponseCode();
    if (code === 401) {
      CacheService.getScriptCache().remove(GARMIN_TOKEN_CACHE_KEY);
      throw new Error('HTTP 401 – Token abgelaufen/ungültig (Cache geleert, bitte erneut syncen).');
    }
    if (code === 429 || code >= 500) {
      Utilities.sleep(1000 * (attempt + 1));
      continue;
    }
    break;
  }
  if (code === 204 || code === 404) return [];
  if (code < 200 || code >= 300) {
    throw new Error('HTTP ' + code + ' ' + res.getContentText().slice(0, 200));
  }

  var json = safeJson_(res.getContentText());
  if (!json) return [];
  if (Array.isArray(json)) return json;
  var listKey = ['items', 'data', 'results', kind, 'activities', 'dailies', 'sleeps', 'hrvSummaries'].filter(function (k) {
    return Array.isArray(json[k]);
  })[0];
  return listKey ? json[listKey] : [json];
}

/* ----------------------------------------------------------------------------
 *  Mapping Garmin → Sheet-Schema (defensiv, mehrere Feldnamen-Varianten)
 * ------------------------------------------------------------------------- */

function mapGarminDaily_(d, fallbackDate) {
  return {
    Date: pickDate_(d, fallbackDate),
    Resting_HR: pick_(d, ['restingHeartRateInBeatsPerMinute', 'restingHeartRate', 'restingHR', 'restingHeartRateValue', 'averageRestingHeartRate']),
    Body_Battery_Max: pick_(d, ['bodyBatteryHighestValue', 'bodyBatteryChargedValue', 'maxBodyBattery', 'bodyBatteryMax'])
  };
}

function mapGarminSleep_(s, fallbackDate) {
  var score = pick_(s, ['overallSleepScore.value', 'sleepScores.overall.value', 'sleepScore', 'overallSleepScore', 'score']);
  return { Date: pickDate_(s, fallbackDate), Sleep_Score: score };
}

function mapGarminHrv_(h, fallbackDate) {
  return {
    Date: pickDate_(h, fallbackDate),
    HRV_Night: pick_(h, ['lastNightAvg', 'hrvSummary.lastNightAvg', 'lastNight', 'nightlyAvg']),
    HRV_7d_Avg: pick_(h, ['weeklyAvg', 'hrvSummary.weeklyAvg', 'sevenDayAvg', 'baseline.weeklyAvg'])
  };
}

/** Garmin-Aktivität → Activities-Zeile inkl. Auto-Klassifizierung (Bucket, Type, Muscle_Focus). */
function mapGarminActivity_(a) {
  var id = pick_(a, ['activityId', 'summaryId', 'activityUUID', 'id']);
  if (id === null) return null;

  var startSec = pick_(a, ['startTimeInSeconds', 'startTimeGMTSeconds']);
  var offsetSec = pick_(a, ['startTimeOffsetInSeconds']) || 0;
  var date = startSec !== null
    ? Utilities.formatDate(new Date((Number(startSec) + Number(offsetSec)) * 1000), 'UTC', 'yyyy-MM-dd')
    : normalizeDateInput_(pick_(a, ['startTimeLocal', 'calendarDate', 'startTimeGMT']));
  if (!date) return null;

  var rawType = String(pick_(a, ['activityType', 'activityType.typeKey', 'activityTypeKey', 'sport']) || '').toLowerCase();
  if (typeof a.activityType === 'object' && a.activityType) rawType = String(a.activityType.typeKey || '').toLowerCase();
  var cls = classifyGarminType_(rawType);

  var durationSec = pick_(a, ['durationInSeconds', 'duration', 'movingDurationInSeconds']);
  var load = pick_(a, ['activityTrainingLoad', 'trainingLoad', 'trainingEffectLoad']);
  var avgHr = pick_(a, ['averageHeartRateInBeatsPerMinute', 'averageHR', 'avgHr', 'averageHeartRate']);
  var name = pick_(a, ['activityName', 'activityDescription', 'name']);
  var anaerobicTE = pick_(a, ['anaerobicTrainingEffect']);

  var focus = cls.focus;
  if (cls.bucket === 'Engine') {
    focus = ((load !== null && load >= 120) || (anaerobicTE !== null && anaerobicTE >= 2.5)) ? 'Cardio_High' : 'Cardio_Z2';
  }

  return {
    Activity_ID: 'G-' + String(id),
    Date: date,
    Source: 'Garmin',
    Bucket: cls.bucket,
    Type: cls.type,
    Duration_Min: durationSec !== null ? Math.round(Number(durationSec) / 60) : '',
    Garmin_Load: load !== null ? Math.round(Number(load)) : '',
    Avg_HR: avgHr !== null ? Math.round(Number(avgHr)) : '',
    RPE: '',
    Muscle_Focus: focus,
    Notes: name ? String(name).slice(0, 200) : ''
  };
}

function classifyGarminType_(t) {
  if (/run|treadmill|track/.test(t)) return { type: 'Run', bucket: 'Engine', focus: 'Cardio_Z2' };
  if (/cycl|bike|biking|ride|spin/.test(t)) return { type: 'Bike', bucket: 'Engine', focus: 'Cardio_Z2' };
  if (/hiit|crossfit|cardio_training|boot_camp|functional/.test(t)) return { type: 'CrossFit', bucket: 'Metcon', focus: 'Full_Body' };
  if (/strength/.test(t)) return { type: 'Rack_Strength', bucket: 'Heavy', focus: 'Lower_Heavy' };
  return { type: 'Other', bucket: 'Engine', focus: 'Cardio_Z2' };
}

/* ----------------------------------------------------------------------------
 *  Kleine Helfer
 * ------------------------------------------------------------------------- */

/** Führt Teil-Metriken (Daily/Sleep/HRV) pro Datum zusammen. */
function mergeMetric_(byDate, partial) {
  if (!partial || !partial.Date) return;
  var row = byDate[partial.Date] || (byDate[partial.Date] = { Date: partial.Date });
  Object.keys(partial).forEach(function (k) {
    if (partial[k] !== null && partial[k] !== undefined && partial[k] !== '') {
      row[k] = typeof partial[k] === 'number' ? Math.round(partial[k]) : partial[k];
    }
  });
}

function restingHrBaseline_(rows, beforeDate) {
  var vals = rows
    .filter(function (r) { return r.Date && r.Date < beforeDate && toNumber_(r.Resting_HR) !== null; })
    .sort(function (a, b) { return a.Date < b.Date ? 1 : -1; })
    .slice(0, 7)
    .map(function (r) { return toNumber_(r.Resting_HR); });
  return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
}

/** Liest den ersten vorhandenen Wert (unterstützt Punkt-Pfade wie 'a.b.c'). */
function pick_(obj, paths) {
  for (var i = 0; i < paths.length; i++) {
    var v = paths[i].split('.').reduce(function (o, k) { return (o && o[k] !== undefined) ? o[k] : undefined; }, obj);
    if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') {
      var n = Number(v);
      return isFinite(n) && String(v).trim() !== '' && !/[a-z]/i.test(String(v)) ? n : v;
    }
  }
  return null;
}

function pickDate_(obj, fallback) {
  var d = pick_(obj, ['calendarDate', 'date', 'summaryDate']);
  return normalizeDateInput_(d) || fallback;
}

/** Unix-Sekunden-Fenster eines Kalendertages in der Script-Zeitzone. */
function dayWindowSeconds_(iso) {
  var tz = Session.getScriptTimeZone();
  var start = Utilities.parseDate(iso + ' 00:00:00', tz, 'yyyy-MM-dd HH:mm:ss');
  return {
    date: iso,
    start: Math.floor(start.getTime() / 1000),
    end: Math.floor(start.getTime() / 1000) + 86399
  };
}

function safeJson_(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}
