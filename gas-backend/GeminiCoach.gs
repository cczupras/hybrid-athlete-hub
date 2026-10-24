// Gemini Coach Integration
/**
 * ============================================================================
 *  Hybrid Athlete Hub – GeminiCoach.gs
 *  Schickt die letzten 10 Tage (Daily_Metrics, Activities, Strength_Log) plus
 *  vorberechnete Kennzahlen an gemini-2.5-flash und liefert Markdown zurück.
 *
 *  Script Property: GEMINI_API_KEY (Google AI Studio)
 * ============================================================================
 */

var GEMINI_MODEL = 'gemini-2.5-flash';
var GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';

/** Preset-Prompts (Schlüssel aus dem Frontend oder deutscher Titel). */
var COACH_PRESETS = {
  today: {
    title: 'Tagesempfehlung',
    prompt: 'Was steht heute an? Gib mir eine konkrete Tagesempfehlung: Welcher Bucket (Engine, Heavy, Metcon oder Ruhetag) ' +
      'passt heute am besten zu meiner Readiness, der 48h-Ermüdung und den offenen Wochenzielen? ' +
      'Nenne Dauer, Intensität (Zone/RPE) und eine kurze Begründung.'
  },
  rack: {
    title: 'Rack-Gewichte für heute',
    prompt: 'Plane meine heutige Rack-Session im Home Gym. Wähle 2–3 Langhantel-Übungen passend zur 48h-Ermüdung ' +
      '(keine schweren Squats/Deadlifts bei beinlastiger Vorbelastung). Gib für jede Übung Aufwärmsätze, ' +
      'Arbeitssätze als Tabelle (Sätze x Wdh @ kg, Ziel-RIR) auf Basis meiner e1RM-Bestwerte und letzten Sessions an. ' +
      'Gewichte auf 2,5 kg runden. Passe die Intensität an die Readiness an.'
  },
  week: {
    title: 'Wochen-Review',
    prompt: 'Erstelle ein Wochen-Review: Bucket-Bilanz vs. Ziele, Trend von HRV/Schlaf/Ruhepuls, Kraftentwicklung (e1RM) ' +
      'und Interferenz-Probleme. Schließe mit einem konkreten Plan für die restlichen Tage dieser Woche bzw. die nächste Woche.'
  }
};

/**
 * Fragt den Gemini Coach.
 * @param {string} prompt Freitext oder Preset-Schlüssel ('today' | 'rack' | 'week' bzw. deutscher Titel)
 * @param {Object} contextData Ergebnis von buildCoachContext_()
 * @return {string} Markdown-Antwort
 */
function askGeminiCoach(prompt, contextData) {
  var apiKey = getProp_('GEMINI_API_KEY');
  if (!apiKey) throw apiError_('GEMINI_API_KEY ist in den Script Properties nicht gesetzt.', 500);

  var task = resolveCoachPrompt_(prompt);
  var userText =
    '## Aufgabe\n' + task + '\n\n' +
    '## Trainingsdaten (JSON, letzte 10 Tage + Kennzahlen)\n' +
    '```json\n' + JSON.stringify(contextData) + '\n```';

  var payload = {
    systemInstruction: { parts: [{ text: coachSystemInstruction_() }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 1024 }
    }
  };

  var res, code, body;
  for (var attempt = 0; attempt < 3; attempt++) {
    res = UrlFetchApp.fetch(GEMINI_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    code = res.getResponseCode();
    body = res.getContentText();
    if (code === 429 || code === 503) {
      Utilities.sleep(1500 * (attempt + 1));
      continue;
    }
    break;
  }

  var json = safeJson_(body) || {};
  if (code < 200 || code >= 300) {
    var msg = (json.error && json.error.message) ? json.error.message : body.slice(0, 300);
    console.error('[Gemini] HTTP ' + code + ': ' + msg);
    throw apiError_('Gemini API Fehler (HTTP ' + code + '): ' + msg, 502);
  }

  var candidate = (json.candidates || [])[0];
  var text = candidate && candidate.content && candidate.content.parts
    ? candidate.content.parts.filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('')
    : '';

  if (!text) {
    var reason = (json.promptFeedback && json.promptFeedback.blockReason) || (candidate && candidate.finishReason) || 'unbekannt';
    throw apiError_('Gemini lieferte keine Antwort (Grund: ' + reason + ').', 502);
  }
  return text.trim();
}

function resolveCoachPrompt_(prompt) {
  var p = String(prompt || '').trim();
  if (COACH_PRESETS[p]) return COACH_PRESETS[p].prompt;
  var keys = Object.keys(COACH_PRESETS);
  for (var i = 0; i < keys.length; i++) {
    if (COACH_PRESETS[keys[i]].title.toLowerCase() === p.toLowerCase()) return COACH_PRESETS[keys[i]].prompt;
  }
  return p.slice(0, 2000);
}

function coachSystemInstruction_() {
  return [
    'Du bist ein pragmatischer Hybrid Strength & Conditioning Coach und antwortest immer auf Deutsch (Du-Form).',
    'Dein Athlet trainiert in drei Buckets, die um Regeneration konkurrieren:',
    '- Engine: Laufen & Radfahren (Garmin-Daten).',
    '- Heavy: Langhantel im Home-Gym-Rack (Back/Front Squat, Deadlift, Bench, OHP, Row, Weighted Pull-Up). Niedriger Puls, hohe ZNS-/Strukturbelastung.',
    '- Metcon: CrossFit-WODs. Hohe metabolische und muskuläre Ermüdung.',
    '',
    'Prüfe bei jeder Empfehlung systematisch:',
    '1. Readiness: Sleep_Score, HRV_Night vs. HRV_7d_Avg und Resting_HR vs. Baseline (Green/Yellow/Red). Bei Red: Intensität deutlich senken oder Ruhetag/Z2.',
    '2. 48h-Interferenz: Keine schweren Squats/Deadlifts innerhalb von 48h nach beinlastigem WOD oder hartem Lauf (fatigue48h.legSources). Weiche auf Upper Body oder Technik aus.',
    '3. Wochen-Buckets: Defizite vs. Ziele (weeklyCompass) – priorisiere fehlende Buckets, ohne die Regeneration zu gefährden.',
    '4. Progressive Overload: Nutze personalBests und lastSessionPerExercise. e1RM = Gewicht × (1 + Wdh/30). Steigere in 2,5-kg-Schritten, steuere über RIR.',
    '',
    'Stil: knapp, konkret, umsetzbar. Nutze Markdown mit Überschriften (###), Aufzählungen und – für Satz-/Gewichtsangaben – Tabellen.',
    'Starte mit einer einzeiligen Kernaussage in Fett. Erfinde keine Daten; wenn Werte fehlen, sag das kurz und triff eine konservative Annahme.',
    'Kein Disclaimer, keine Floskeln. Maximal ca. 300 Wörter, außer beim Wochen-Review.'
  ].join('\n');
}
