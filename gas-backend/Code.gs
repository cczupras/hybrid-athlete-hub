// Google Apps Script Router (doPost)
/**
 * ============================================================================
 *  Hybrid Athlete Hub – Code.gs
 *  doPost-Router, Datenbank-Setup, Sheet-Helfer (Header-Mapping, Upsert)
 *  und gemeinsame Analyse-Logik (Readiness, Wochen-Kompass, 48h-Ermüdung).
 *
 *  Läuft in der V8 Apps Script Runtime. Alle Funktionen sind global und
 *  werden von GarminSync.gs und GeminiCoach.gs mitgenutzt (kein import/export).
 *
 *  Script Properties:
 *    APP_PIN         – Shared Secret für das Frontend (Pflicht)
 *    GARMIN_API_KEY  – Garmin Connect Personal API Key
 *    GEMINI_API_KEY  – Google AI Studio API Key
 *    SPREADSHEET_ID  – optional, falls das Script nicht an das Sheet gebunden ist
 * ============================================================================
 */

/* ----------------------------------------------------------------------------
 *  Schema & Konstanten (exakte Spaltenreihenfolge laut SPEC.md)
 * ------------------------------------------------------------------------- */
var SCHEMA = {
  Daily_Metrics: ['Date', 'Sleep_Score', 'HRV_7d_Avg', 'HRV_Night', 'Resting_HR', 'Body_Battery_Max', 'Readiness_Status'],
  Activities: ['Activity_ID', 'Date', 'Source', 'Bucket', 'Type', 'Duration_Min', 'Garmin_Load', 'Avg_HR', 'RPE', 'Muscle_Focus', 'Notes'],
  Strength_Log: ['Log_ID', 'Date', 'Activity_ID', 'Exercise', 'Sets', 'Reps', 'Weight_kg', 'RIR', 'e1RM'],
  Config_Targets: ['Metric', 'Target_Value', 'Notes']
};

/** Primärschlüssel je Tabelle (für Upsert / Updates). */
var SHEET_KEYS = {
  Daily_Metrics: 'Date',
  Activities: 'Activity_ID',
  Strength_Log: 'Log_ID',
  Config_Targets: 'Metric'
};

/** Spalten, die als Plain-Text formatiert werden (verhindert Auto-Konvertierung von Datum/IDs). */
var TEXT_COLUMNS = {
  Daily_Metrics: ['Date', 'Readiness_Status'],
  Activities: ['Activity_ID', 'Date', 'Source', 'Bucket', 'Type', 'Muscle_Focus', 'Notes'],
  Strength_Log: ['Log_ID', 'Date', 'Activity_ID', 'Exercise'],
  Config_Targets: ['Metric', 'Notes']
};

var DEFAULT_TARGETS = [
  ['Engine_Weekly', 2, 'Laufen & Radfahren (Garmin)'],
  ['Heavy_Weekly', 2, 'Langhantel-Training im Rack (Home Gym)'],
  ['Metcon_Weekly', 1, 'CrossFit WODs (1–2x pro Woche)']
];

var ENUMS = {
  Source: ['Garmin', 'Manual'],
  Bucket: ['Engine', 'Heavy', 'Metcon'],
  Type: ['Run', 'Bike', 'CrossFit', 'Rack_Strength', 'Other'],
  Muscle_Focus: ['Lower_Heavy', 'Upper_Push', 'Upper_Pull', 'Full_Body', 'Cardio_Z2', 'Cardio_High'],
  Exercise: ['Back Squat', 'Front Squat', 'Deadlift', 'Bench Press', 'Overhead Press', 'Barbell Row', 'Weighted Pull-Up'],
  Readiness_Status: ['Green', 'Yellow', 'Red']
};

var EXERCISE_FOCUS = {
  'Back Squat': 'Lower_Heavy',
  'Front Squat': 'Lower_Heavy',
  'Deadlift': 'Lower_Heavy',
  'Bench Press': 'Upper_Push',
  'Overhead Press': 'Upper_Push',
  'Barbell Row': 'Upper_Pull',
  'Weighted Pull-Up': 'Upper_Pull'
};

/** Mapping Wochenziel-Metrik -> Bucket. */
var TARGET_BUCKETS = { Engine_Weekly: 'Engine', Heavy_Weekly: 'Heavy', Metcon_Weekly: 'Metcon' };

/* ----------------------------------------------------------------------------
 *  HTTP Entry Points
 * ------------------------------------------------------------------------- */

/**
 * Zentraler Router. Erwartet text/plain Body: { pin, action, data }.
 * Antwort: { ok: true, action, data } oder { ok: false, error, code }.
 */
function doPost(e) {
  var action = '';
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw apiError_('Leerer Request-Body.', 400);
    }
    var request;
    try {
      request = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      throw apiError_('Request-Body ist kein gültiges JSON.', 400);
    }

    verifyPin_(request.pin);

    action = String(request.action || '').trim();
    var routes = getRoutes_();
    if (!routes.hasOwnProperty(action)) {
      throw apiError_('Unbekannte Action: "' + action + '". Erlaubt: ' + Object.keys(routes).join(', '), 400);
    }

    var result = routes[action](request.data || {}, request);
    return jsonResponse_({ ok: true, action: action, data: result, ts: new Date().toISOString() });
  } catch (err) {
    console.error('[doPost] action=' + action + ' – ' + (err && err.stack ? err.stack : err));
    return jsonResponse_({
      ok: false,
      action: action,
      error: (err && err.message) ? err.message : String(err),
      code: (err && err.code) ? err.code : 500
    });
  }
}

/** Einfacher Health-Check (keine Daten, keine PIN nötig). */
function doGet() {
  return jsonResponse_({ ok: true, service: 'Hybrid Athlete Hub API', ts: new Date().toISOString() });
}

/**
 * Routen-Tabelle. Als Funktion, damit Handler aus anderen .gs-Dateien
 * (z. B. syncGarminData, askGeminiCoach) erst zur Laufzeit aufgelöst werden.
 */
function getRoutes_() {
  return {
    initSheets: function () {
      return withLock_(function () { return setupDatabase(); });
    },
    getDashboard: handleGetDashboard_,
    logStrength: function (data) {
      return withLock_(function () { return handleLogStrength_(data); });
    },
    tagActivity: function (data) {
      return withLock_(function () { return handleTagActivity_(data); });
    },
    triggerGarminSync: function (data) {
      return withLock_(function () { return syncGarminData(data && data.days); });
    },
    askGemini: function (data, request) {
      var prompt = (data && data.prompt) || request.prompt || '';
      if (!String(prompt).trim()) throw apiError_('Kein Prompt übergeben.', 400);
      var contextData = buildCoachContext_(10);
      return { reply: askGeminiCoach(prompt, contextData) };
    }
  };
}

/* ----------------------------------------------------------------------------
 *  Datenbank-Setup (direkt im GAS-Editor ausführbar oder via Action initSheets)
 * ------------------------------------------------------------------------- */

/**
 * Legt die 4 Tabellenblätter inkl. Header, Formatierung, Validierungen und
 * Standardwerten an. Idempotent: bestehende Daten werden nie gelöscht.
 * @return {Object} Report pro Tabellenblatt.
 */
function setupDatabase() {
  var ss = getSpreadsheet_();
  var report = { sheets: [], targetsAdded: [] };

  Object.keys(SCHEMA).forEach(function (name) {
    var headers = SCHEMA[name];
    var sheet = ss.getSheetByName(name);
    var created = false;
    if (!sheet) {
      sheet = ss.insertSheet(name);
      created = true;
    }

    // Spaltenanzahl sicherstellen
    if (sheet.getMaxColumns() < headers.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    }

    // Header prüfen / schreiben
    var current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    var headerOk = headers.every(function (h, i) { return String(current[i]).trim() === h; });
    if (!headerOk) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }

    // Formatierung: Fettdruck, Farben, eingefrorene Zeile 1
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange
      .setFontWeight('bold')
      .setBackground('#0f172a')
      .setFontColor('#34d399')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);

    // Plain-Text-Spalten (Datum als YYYY-MM-DD-String, IDs ohne Zahlen-Konvertierung)
    var maxRows = Math.max(sheet.getMaxRows() - 1, 1);
    (TEXT_COLUMNS[name] || []).forEach(function (col) {
      var c = headers.indexOf(col) + 1;
      if (c > 0) sheet.getRange(2, c, maxRows, 1).setNumberFormat('@');
    });
    if (name === 'Strength_Log') {
      sheet.getRange(2, headers.indexOf('e1RM') + 1, maxRows, 1).setNumberFormat('0.0');
      sheet.getRange(2, headers.indexOf('Weight_kg') + 1, maxRows, 1).setNumberFormat('0.0#');
    }

    // Dropdown-Validierungen für Enum-Spalten
    headers.forEach(function (col, i) {
      var allowed = ENUMS[col];
      if (!allowed) return;
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(allowed, true)
        .setAllowInvalid(true)
        .build();
      sheet.getRange(2, i + 1, maxRows, 1).setDataValidation(rule);
    });

    headers.forEach(function (_, i) { sheet.autoResizeColumn(i + 1); });

    report.sheets.push({ name: name, created: created, headerRepaired: !headerOk && !created });
  });

  // Standardwerte in Config_Targets (nur fehlende Metriken ergänzen)
  var existing = readObjects_('Config_Targets').map(function (r) { return r.Metric; });
  var targetSheet = getSheet_('Config_Targets');
  DEFAULT_TARGETS.forEach(function (row) {
    if (existing.indexOf(row[0]) === -1) {
      targetSheet.appendRow(row);
      report.targetsAdded.push(row[0]);
    }
  });

  // Leeres Standard-Blatt ("Tabelle1"/"Sheet1") entfernen
  ss.getSheets().forEach(function (sh) {
    if (!SCHEMA[sh.getName()] && ss.getSheets().length > 1 && sh.getLastRow() === 0 && sh.getLastColumn() === 0) {
      ss.deleteSheet(sh);
    }
  });

  console.log('[setupDatabase] ' + JSON.stringify(report));
  return report;
}

/* ----------------------------------------------------------------------------
 *  Action Handler
 * ------------------------------------------------------------------------- */

/** getDashboard: 14 Tage Metrics, 30 Activities, 50 Strength-Einträge, Targets. */
function handleGetDashboard_(data) {
  var days = clampInt_(data && data.days, 1, 90, 14);
  var today = todayIso_();
  var cutoff = addDaysIso_(today, -(days - 1));

  var metrics = readObjects_('Daily_Metrics')
    .filter(function (r) { return r.Date && r.Date >= cutoff; })
    .sort(function (a, b) { return a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0; });

  var activities = sortByDateDesc_(readObjects_('Activities').filter(function (r) { return r.Activity_ID; }));
  var strengthAll = sortByDateDesc_(readObjects_('Strength_Log').filter(function (r) { return r.Log_ID; }));
  var targets = readObjects_('Config_Targets').filter(function (r) { return r.Metric; });

  return {
    today: today,
    dailyMetrics: metrics,
    activities: activities.slice(0, 30),
    strengthLog: strengthAll.slice(0, 50),
    configTargets: targets,
    personalBests: computePersonalBests_(strengthAll),
    summary: {
      readiness: computeTodayReadiness_(metrics, today),
      weeklyCompass: computeWeeklyCompass_(activities, targets, today),
      fatigue48h: computeFatigue48h_(activities, today)
    }
  };
}

/** logStrength: hängt einen Satz-Block an und verknüpft/erstellt die Rack_Strength-Aktivität des Tages. */
function handleLogStrength_(data) {
  var exercise = requireEnum_(data.exercise || data.Exercise, ENUMS.Exercise, 'exercise');
  var weight = toNumber_(data.weight !== undefined ? data.weight : data.Weight_kg);
  var reps = toNumber_(data.reps !== undefined ? data.reps : data.Reps);
  var sets = toNumber_(data.sets !== undefined ? data.sets : data.Sets);
  var rir = toNumber_(data.rir !== undefined ? data.rir : data.RIR);

  if (weight === null || weight < 0 || weight > 500) throw apiError_('Ungültiges Gewicht (0–500 kg).', 400);
  if (reps === null || reps < 1 || reps > 50) throw apiError_('Ungültige Wiederholungen (1–50).', 400);
  sets = (sets === null || sets < 1) ? 1 : Math.round(sets);
  if (rir !== null) rir = Math.max(0, Math.min(5, Math.round(rir)));

  var date = normalizeDateInput_(data.date) || todayIso_();
  var e1rm = calcE1RM(weight, reps);

  var bests = computePersonalBests_(readObjects_('Strength_Log'));
  var previousBest = bests[exercise] ? bests[exercise].e1RM : 0;

  var activityId = String(data.activityId || data.Activity_ID || '').trim();
  if (!activityId && data.createActivity !== false) {
    activityId = ensureRackActivity_(date, exercise, sets, reps, weight);
  }

  var entry = {
    Log_ID: Utilities.getUuid(),
    Date: date,
    Activity_ID: activityId,
    Exercise: exercise,
    Sets: sets,
    Reps: Math.round(reps),
    Weight_kg: weight,
    RIR: rir === null ? '' : rir,
    e1RM: e1rm
  };
  appendObject_('Strength_Log', entry);

  return {
    logId: entry.Log_ID,
    e1RM: e1rm,
    previousBest: previousBest,
    isPR: e1rm > previousBest,
    activityId: activityId,
    entry: entry
  };
}

/** tagActivity: aktualisiert Bucket, RPE, Muscle_Focus und Notes einer Aktivität. */
function handleTagActivity_(data) {
  var id = String(data.activityId || data.Activity_ID || '').trim();
  if (!id) throw apiError_('activityId fehlt.', 400);

  var patch = {};
  var bucket = data.bucket !== undefined ? data.bucket : data.Bucket;
  var rpe = data.rpe !== undefined ? data.rpe : data.RPE;
  var focus = data.muscleFocus !== undefined ? data.muscleFocus : data.Muscle_Focus;
  var notes = data.notes !== undefined ? data.notes : data.Notes;
  var type = data.type !== undefined ? data.type : data.Type;

  if (bucket !== undefined && bucket !== '') patch.Bucket = requireEnum_(bucket, ENUMS.Bucket, 'bucket');
  if (focus !== undefined && focus !== '') patch.Muscle_Focus = requireEnum_(focus, ENUMS.Muscle_Focus, 'muscleFocus');
  if (type !== undefined && type !== '') patch.Type = requireEnum_(type, ENUMS.Type, 'type');
  if (rpe !== undefined && rpe !== '') {
    var r = toNumber_(rpe);
    if (r === null || r < 1 || r > 10) throw apiError_('RPE muss zwischen 1 und 10 liegen.', 400);
    patch.RPE = Math.round(r);
  }
  if (notes !== undefined) patch.Notes = String(notes).slice(0, 500);

  if (!Object.keys(patch).length) throw apiError_('Keine Felder zum Aktualisieren übergeben.', 400);

  var updated = updateObjectByKey_('Activities', id, patch);
  if (!updated) throw apiError_('Activity_ID "' + id + '" nicht gefunden.', 404);
  return { activity: updated };
}

/**
 * Findet die Rack_Strength-Aktivität des Tages (bevorzugt Garmin-Import) oder legt
 * eine manuelle an. Ergänzt Muscle_Focus, Dauer-Schätzung und Notes.
 * @return {string} Activity_ID
 */
function ensureRackActivity_(date, exercise, sets, reps, weight) {
  var activities = readObjects_('Activities').filter(function (a) {
    return a.Date === date && a.Type === 'Rack_Strength';
  });
  activities.sort(function (a, b) { return (a.Source === 'Garmin' ? 0 : 1) - (b.Source === 'Garmin' ? 0 : 1); });

  var focus = EXERCISE_FOCUS[exercise] || 'Full_Body';
  var noteFragment = exercise + ' ' + sets + 'x' + Math.round(reps) + '@' + weight + 'kg';

  if (activities.length) {
    var act = activities[0];
    var patch = {
      Muscle_Focus: mergeFocus_(act.Muscle_Focus, focus),
      Notes: act.Notes ? (String(act.Notes) + ' | ' + noteFragment).slice(0, 500) : noteFragment
    };
    if (act.Source === 'Manual') patch.Duration_Min = (toNumber_(act.Duration_Min) || 0) + sets * 3;
    if (!act.Bucket) patch.Bucket = 'Heavy';
    updateObjectByKey_('Activities', act.Activity_ID, patch);
    return String(act.Activity_ID);
  }

  var id = 'RACK-' + date.replace(/-/g, '');
  appendObject_('Activities', {
    Activity_ID: id,
    Date: date,
    Source: 'Manual',
    Bucket: 'Heavy',
    Type: 'Rack_Strength',
    Duration_Min: sets * 3,
    Garmin_Load: '',
    Avg_HR: '',
    RPE: '',
    Muscle_Focus: focus,
    Notes: noteFragment
  });
  return id;
}

/** Lower_Heavy dominiert (wichtigster Interferenz-Faktor), sonst gemischt -> Full_Body. */
function mergeFocus_(existing, incoming) {
  if (!existing) return incoming;
  if (existing === incoming) return existing;
  if (existing === 'Lower_Heavy' || incoming === 'Lower_Heavy') return 'Lower_Heavy';
  return 'Full_Body';
}

/* ----------------------------------------------------------------------------
 *  Sheet-Helfer: Header-basiertes Mapping zu sauberen JSON-Objekten
 * ------------------------------------------------------------------------- */

function getSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = getProp_('SPREADSHEET_ID');
  if (!id) throw apiError_('Kein Spreadsheet gefunden. Script an ein Sheet binden oder SPREADSHEET_ID setzen.', 500);
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw apiError_('Tabellenblatt "' + name + '" fehlt. Bitte zuerst initSheets / setupDatabase() ausführen.', 500);
  return sheet;
}

/**
 * Liest ein Tabellenblatt als Array von Objekten { Header: Wert }.
 * Datumszellen werden zu YYYY-MM-DD normalisiert, leere Zeilen ignoriert.
 */
function readObjects_(name) {
  var sheet = getSheet_(name);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (v) { return v === '' || v === null; })) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      obj[headers[c]] = normalizeCell_(row[c], headers[c]);
    }
    out.push(obj);
  }
  return out;
}

function normalizeCell_(value, header) {
  if (value instanceof Date) {
    if (header === 'Date') return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return value.toISOString();
  }
  if (header === 'Date' && value !== '' && value !== null) return normalizeDateInput_(value) || String(value);
  return value;
}

function objectToRow_(name, obj) {
  return SCHEMA[name].map(function (h) {
    var v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
}

function appendObject_(name, obj) {
  var sheet = getSheet_(name);
  var row = objectToRow_(name, obj);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return obj;
}

/**
 * Aktualisiert einzelne Felder einer Zeile anhand des Primärschlüssels.
 * @return {Object|null} aktualisiertes Objekt oder null, wenn nicht gefunden.
 */
function updateObjectByKey_(name, key, patch) {
  var sheet = getSheet_(name);
  var headers = SCHEMA[name];
  var keyField = SHEET_KEYS[name];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var keyIdx = headers.indexOf(keyField);
  var target = normalizeKey_(key, keyField);

  for (var i = 0; i < values.length; i++) {
    if (normalizeKey_(values[i][keyIdx], keyField) !== target) continue;
    var row = values[i].map(function (v, c) { return normalizeCell_(v, headers[c]); });
    Object.keys(patch).forEach(function (field) {
      var c = headers.indexOf(field);
      if (c >= 0) row[c] = patch[field];
    });
    sheet.getRange(i + 2, 1, 1, headers.length).setValues([row]);
    var obj = {};
    headers.forEach(function (h, c) { obj[h] = row[c]; });
    return obj;
  }
  return null;
}

/**
 * Upsert anhand eines Schlüsselfeldes – verhindert Dubletten bei mehrfacher Ausführung.
 * - Bestehende Zeilen werden nur in geänderten Feldern überschrieben.
 * - Leere/undefined Werte überschreiben niemals vorhandene Daten.
 * - options.preserveIfSet: Felder, die nur befüllt werden, wenn sie im Sheet leer sind
 *   (z. B. manuell getaggte Bucket/RPE/Muscle_Focus/Notes).
 * @return {{inserted:number, updated:number, unchanged:number}}
 */
function upsertObjects_(name, objects, options) {
  options = options || {};
  var preserve = options.preserveIfSet || [];
  var sheet = getSheet_(name);
  var headers = SCHEMA[name];
  var keyField = SHEET_KEYS[name];
  var keyIdx = headers.indexOf(keyField);
  var lastRow = sheet.getLastRow();

  var values = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().map(function (row) {
        return row.map(function (v, c) { return normalizeCell_(v, headers[c]); });
      })
    : [];
  var originalLength = values.length;

  var index = {};
  values.forEach(function (row, i) {
    var k = normalizeKey_(row[keyIdx], keyField);
    if (k) index[k] = i;
  });

  var stats = { inserted: 0, updated: 0, unchanged: 0 };
  var dirtyRows = {};

  (objects || []).forEach(function (obj) {
    var k = normalizeKey_(obj[keyField], keyField);
    if (!k) return;

    if (index.hasOwnProperty(k)) {
      var i = index[k];
      var row = values[i];
      var changed = false;
      headers.forEach(function (h, c) {
        var nv = obj[h];
        if (nv === undefined || nv === null || nv === '') return;
        if (preserve.indexOf(h) >= 0 && row[c] !== '' && row[c] !== null) return;
        if (String(row[c]) !== String(nv)) {
          row[c] = nv;
          changed = true;
        }
      });
      if (i < originalLength) {
        if (changed) { dirtyRows[i] = true; stats.updated++; } else { stats.unchanged++; }
      }
    } else {
      values.push(objectToRow_(name, obj));
      index[k] = values.length - 1;
      stats.inserted++;
    }
  });

  Object.keys(dirtyRows).forEach(function (i) {
    var idx = Number(i);
    sheet.getRange(idx + 2, 1, 1, headers.length).setValues([values[idx]]);
  });

  var newRows = values.slice(originalLength);
  if (newRows.length) {
    sheet.getRange(lastRow + 1, 1, newRows.length, headers.length).setValues(newRows);
  }
  return stats;
}

function normalizeKey_(value, keyField) {
  if (value === undefined || value === null || value === '') return '';
  if (keyField === 'Date') return normalizeDateInput_(value) || String(value).trim();
  return String(value).trim();
}

function sortByDateDesc_(rows) {
  // reverse() zuerst, damit bei gleichem Datum die zuletzt angehängte Zeile vorne steht (stabile Sortierung)
  return rows.slice().reverse().sort(function (a, b) {
    return a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : 0;
  });
}

/* ----------------------------------------------------------------------------
 *  Gemeinsame Analyse-Logik (identisch zur Frontend-Logik in docs/app.js)
 * ------------------------------------------------------------------------- */

/** Epley e1RM, gerundet auf 1 Nachkommastelle. */
function calcE1RM(weight, reps) {
  return Math.round(Number(weight) * (1 + Number(reps) / 30) * 10) / 10;
}

/** Bestwerte je Übung: { 'Back Squat': { e1RM, date, weight, reps } } */
function computePersonalBests_(strengthRows) {
  var bests = {};
  (strengthRows || []).forEach(function (r) {
    var e = toNumber_(r.e1RM);
    if (e === null) e = calcE1RM(r.Weight_kg, r.Reps);
    if (!r.Exercise || !e) return;
    if (!bests[r.Exercise] || e > bests[r.Exercise].e1RM) {
      bests[r.Exercise] = { e1RM: e, date: r.Date, weight: toNumber_(r.Weight_kg), reps: toNumber_(r.Reps) };
    }
  });
  return bests;
}

/**
 * Readiness-Ampel aus Sleep_Score, HRV_Night vs HRV_7d_Avg und Resting_HR vs Baseline.
 * Jeder Faktor: 2 = gut, 1 = mittel, 0 = schlecht.
 * @return {string} 'Green' | 'Yellow' | 'Red' | '' (keine Daten)
 */
function computeReadiness(metric, rhrBaseline) {
  var scores = [];
  var sleep = toNumber_(metric.Sleep_Score);
  var hrv = toNumber_(metric.HRV_Night);
  var hrvAvg = toNumber_(metric.HRV_7d_Avg);
  var rhr = toNumber_(metric.Resting_HR);

  if (sleep !== null) scores.push(sleep >= 75 ? 2 : sleep >= 60 ? 1 : 0);
  if (hrv !== null && hrvAvg) {
    var ratio = hrv / hrvAvg;
    scores.push(ratio >= 0.97 ? 2 : ratio >= 0.88 ? 1 : 0);
  }
  if (rhr !== null && rhrBaseline) {
    var diff = rhr - rhrBaseline;
    scores.push(diff <= 2 ? 2 : diff <= 5 ? 1 : 0);
  }
  if (!scores.length) return '';

  var zeros = scores.filter(function (s) { return s === 0; }).length;
  var avg = scores.reduce(function (a, b) { return a + b; }, 0) / (2 * scores.length);
  if (zeros >= 2 || avg < 0.45) return 'Red';
  if (avg >= 0.75 && zeros === 0) return 'Green';
  return 'Yellow';
}

/** Readiness für heute (bzw. den letzten Tag mit Daten). */
function computeTodayReadiness_(metricsAsc, today) {
  if (!metricsAsc.length) return { status: '', date: null };
  var latest = metricsAsc[metricsAsc.length - 1];
  var prev = metricsAsc.slice(Math.max(0, metricsAsc.length - 8), metricsAsc.length - 1);
  var rhrVals = prev.map(function (m) { return toNumber_(m.Resting_HR); }).filter(function (v) { return v !== null; });
  var rhrBaseline = rhrVals.length ? rhrVals.reduce(function (a, b) { return a + b; }, 0) / rhrVals.length : null;
  var status = latest.Readiness_Status || computeReadiness(latest, rhrBaseline);
  return {
    status: status,
    date: latest.Date,
    isToday: latest.Date === today,
    sleepScore: toNumber_(latest.Sleep_Score),
    hrvNight: toNumber_(latest.HRV_Night),
    hrv7dAvg: toNumber_(latest.HRV_7d_Avg),
    restingHr: toNumber_(latest.Resting_HR),
    rhrBaseline: rhrBaseline === null ? null : Math.round(rhrBaseline * 10) / 10,
    bodyBatteryMax: toNumber_(latest.Body_Battery_Max)
  };
}

/** Wochen-Kompass (Mo–So): Sessions je Bucket vs. Config_Targets. */
function computeWeeklyCompass_(activities, targets, today) {
  var weekStart = weekStartIso_(today);
  var weekEnd = addDaysIso_(weekStart, 6);
  var counts = { Engine: 0, Heavy: 0, Metcon: 0 };
  (activities || []).forEach(function (a) {
    if (a.Date >= weekStart && a.Date <= weekEnd && counts.hasOwnProperty(a.Bucket)) counts[a.Bucket]++;
  });
  var targetMap = { Engine: 2, Heavy: 2, Metcon: 1 };
  (targets || []).forEach(function (t) {
    var bucket = TARGET_BUCKETS[t.Metric];
    var v = toNumber_(t.Target_Value);
    if (bucket && v !== null) targetMap[bucket] = v;
  });
  var buckets = {};
  Object.keys(counts).forEach(function (b) {
    buckets[b] = { done: counts[b], target: targetMap[b], deficit: Math.max(0, targetMap[b] - counts[b]) };
  });
  return { weekStart: weekStart, weekEnd: weekEnd, buckets: buckets };
}

/** Übertrag der Belastung eines Muscle_Focus auf die Ermüdungs-Regionen. */
var FATIGUE_SPILLOVER = {
  Lower_Heavy: { Lower_Heavy: 1, CNS: 0.5 },
  Upper_Push: { Upper_Push: 1, CNS: 0.3 },
  Upper_Pull: { Upper_Pull: 1, CNS: 0.3 },
  Full_Body: { CNS: 1, Lower_Heavy: 0.6, Upper_Push: 0.5, Upper_Pull: 0.5, Cardio: 0.4 },
  Cardio_Z2: { Cardio: 0.6, Lower_Heavy: 0.15 },
  Cardio_High: { Cardio: 1, Lower_Heavy: 0.5, CNS: 0.3 }
};
var FATIGUE_DECAY = [1, 0.75, 0.35];

/**
 * 48h Muskel- & CNS-Ermüdung. Regionen: Lower_Heavy, Upper_Push, Upper_Pull, CNS (Full_Body), Cardio.
 * Score ~0..1.5 → Level low / moderate / high. Inkl. Interferenz-Warnung für Heavy Squats.
 */
function computeFatigue48h_(activities, today) {
  var regions = { Lower_Heavy: 0, Upper_Push: 0, Upper_Pull: 0, CNS: 0, Cardio: 0 };
  var legSources = [];

  (activities || []).forEach(function (a) {
    var age = daysBetweenIso_(a.Date, today);
    if (age < 0 || age >= FATIGUE_DECAY.length) return;
    var focus = a.Muscle_Focus || defaultFocusFor_(a);
    var spill = FATIGUE_SPILLOVER[focus];
    if (!spill) return;
    var rpe = toNumber_(a.RPE) || defaultRpeFor_(a);
    var dur = toNumber_(a.Duration_Min);
    var durFactor = dur ? Math.max(0.5, Math.min(1.5, dur / 60)) : 1;
    var load = (rpe / 10) * durFactor * FATIGUE_DECAY[age];

    Object.keys(spill).forEach(function (region) { regions[region] += load * spill[region]; });
    if (a.Type === 'Run') regions.Lower_Heavy += load * 0.15;
    if (a.Bucket === 'Heavy') regions.CNS += load * 0.2;

    var legHeavy = (a.Bucket === 'Metcon' && (focus === 'Full_Body' || focus === 'Lower_Heavy')) ||
      focus === 'Cardio_High' || (a.Type === 'Run' && rpe >= 7) || focus === 'Lower_Heavy';
    if (legHeavy && age <= 1) legSources.push({ date: a.Date, type: a.Type, bucket: a.Bucket, focus: focus, rpe: rpe });
  });

  var out = {};
  Object.keys(regions).forEach(function (r) {
    var s = Math.round(regions[r] * 100) / 100;
    out[r] = { score: s, level: s >= 0.7 ? 'high' : s >= 0.35 ? 'moderate' : 'low' };
  });
  var warn = out.Lower_Heavy.score >= 0.6 || legSources.length > 0;
  return {
    regions: out,
    interferenceWarning: warn,
    legSources: legSources,
    message: warn ? 'Beinlastige Belastung < 48h – Heavy Squats/Deadlifts reduzieren oder auf Upper Body ausweichen.' : ''
  };
}

function defaultFocusFor_(a) {
  if (a.Type === 'CrossFit' || a.Bucket === 'Metcon') return 'Full_Body';
  if (a.Type === 'Rack_Strength' || a.Bucket === 'Heavy') return 'Lower_Heavy';
  if (a.Type === 'Run' || a.Type === 'Bike') return (toNumber_(a.Garmin_Load) || 0) >= 120 ? 'Cardio_High' : 'Cardio_Z2';
  return '';
}

function defaultRpeFor_(a) {
  if (a.Bucket === 'Metcon' || a.Bucket === 'Heavy' || a.Muscle_Focus === 'Cardio_High') return 8;
  return 6;
}

/** Kontext für den Gemini Coach: letzte N Tage + vorberechnete Kennzahlen. */
function buildCoachContext_(days) {
  var today = todayIso_();
  var cutoff = addDaysIso_(today, -(days - 1));
  var metrics = readObjects_('Daily_Metrics')
    .filter(function (r) { return r.Date && r.Date >= cutoff; })
    .sort(function (a, b) { return a.Date < b.Date ? -1 : 1; });
  var activitiesAll = sortByDateDesc_(readObjects_('Activities').filter(function (r) { return r.Activity_ID; }));
  var strengthAll = sortByDateDesc_(readObjects_('Strength_Log').filter(function (r) { return r.Log_ID; }));
  var targets = readObjects_('Config_Targets');

  // Letzte Session je Übung (für Progressive Overload, auch wenn älter als N Tage)
  var lastByExercise = {};
  strengthAll.forEach(function (s) {
    if (!lastByExercise[s.Exercise]) lastByExercise[s.Exercise] = s;
  });

  return {
    today: today,
    weekday: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEEE'),
    readinessToday: computeTodayReadiness_(metrics, today),
    weeklyCompass: computeWeeklyCompass_(activitiesAll, targets, today),
    fatigue48h: computeFatigue48h_(activitiesAll, today),
    personalBests: computePersonalBests_(strengthAll),
    lastSessionPerExercise: lastByExercise,
    dailyMetrics: metrics,
    activities: activitiesAll.filter(function (a) { return a.Date >= cutoff; }),
    strengthLog: strengthAll.filter(function (s) { return s.Date >= cutoff; })
  };
}

/* ----------------------------------------------------------------------------
 *  Utilities
 * ------------------------------------------------------------------------- */

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiError_(message, code) {
  var err = new Error(message);
  err.code = code || 500;
  return err;
}

function getProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function verifyPin_(pin) {
  var expected = getProp_('APP_PIN');
  if (!expected) throw apiError_('APP_PIN ist in den Script Properties nicht gesetzt.', 500);
  if (String(pin || '') !== String(expected)) throw apiError_('Ungültige PIN.', 401);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw apiError_('Server ausgelastet – bitte erneut versuchen.', 503);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function requireEnum_(value, allowed, field) {
  var v = String(value === undefined || value === null ? '' : value).trim();
  if (allowed.indexOf(v) === -1) throw apiError_('Ungültiger Wert für ' + field + ': "' + v + '". Erlaubt: ' + allowed.join(', '), 400);
  return v;
}

function toNumber_(v) {
  if (v === undefined || v === null || v === '') return null;
  var n = Number(String(v).replace(',', '.'));
  return isFinite(n) ? n : null;
}

function clampInt_(v, min, max, fallback) {
  var n = toNumber_(v);
  if (n === null) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function todayIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Akzeptiert Date, 'YYYY-MM-DD', ISO-Strings und Epoch-ms. */
function normalizeDateInput_(v) {
  if (v === undefined || v === null || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (typeof v === 'number') return Utilities.formatDate(new Date(v), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(s);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function isoToUtcDate_(iso) {
  var p = String(iso).split('-');
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}

function utcDateToIso_(d) {
  return d.toISOString().slice(0, 10);
}

function addDaysIso_(iso, n) {
  var d = isoToUtcDate_(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDateToIso_(d);
}

function daysBetweenIso_(fromIso, toIso) {
  if (!fromIso || !toIso) return -1;
  return Math.round((isoToUtcDate_(toIso) - isoToUtcDate_(fromIso)) / 86400000);
}

function weekStartIso_(iso) {
  var d = isoToUtcDate_(iso);
  var offset = (d.getUTCDay() + 6) % 7; // Montag = 0
  return addDaysIso_(iso, -offset);
}
