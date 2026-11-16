const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function backend(rows) {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'gas-backend/Code.gs'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'gas-backend/GarminSync.gs'), 'utf8'), context);
  const headers = context.SCHEMA.Activities;
  const values = [Array.from(headers), ...rows.map((row) => Array.from(headers, (h) => row[h] ?? ''))];
  const sheet = {
    getLastRow: () => values.length,
    getLastColumn: () => headers.length,
    getRange(row, col, height = 1, width = 1) {
      return {
        getValues: () => values.slice(row - 1, row - 1 + height).map((r) => r.slice(col - 1, col - 1 + width)),
        setValues: (data) => data.forEach((r, i) => {
          values[row - 1 + i] ||= [];
          r.forEach((value, j) => { values[row - 1 + i][col - 1 + j] = value; });
        }),
        setNumberFormat: () => {}
      };
    }
  };
  context.ensureSchemaHeaders_ = () => {};
  context.getSheet_ = () => sheet;
  const readObjects = context.readObjects_;
  context.readObjects_ = (name) => name === 'Activities' ? readObjects(name) : [];
  context.todayIso_ = () => '2026-11-16';
  return context;
}

function frontend() {
  const context = vm.createContext({
    document: { addEventListener() {} },
    localStorage: { getItem: () => null }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'docs/app.js'), 'utf8'), context);
  return context;
}

test('dashboard combines Garmin refreshes and first-row tags before analytics', () => {
  const base = {
    Activity_ID: 'G-1', Date: '2026-11-16', Source: 'Garmin', Bucket: 'Engine',
    Type: 'Run', Duration_Min: 30, Garmin_Load: 80, Avg_HR: 130,
    Muscle_Focus: 'Cardio_Z2', Notes: 'old', Comment: 'old'
  };
  const ctx = backend([base, { ...base }, { ...base, Activity_ID: 'G-2', Duration_Min: 60 }]);
  ctx.handleTagActivity_({ activityId: 'G-1', bucket: 'Heavy', rpe: 8, muscleFocus: 'Lower_Heavy', notes: '', comment: '' });
  ctx.upsertObjects_('Activities', [{ ...base, Duration_Min: 45, Garmin_Load: 120, Avg_HR: 145 }],
    { preserveIfSet: ctx.GARMIN_PRESERVE_FIELDS });

  const dashboard = ctx.handleGetDashboard_({});
  const activity = dashboard.activities.find((a) => a.Activity_ID === 'G-1');
  assert.equal(dashboard.activities.length, 2);
  assert.equal(activity.Duration_Min, 45);
  assert.equal(activity.Garmin_Load, 120);
  assert.equal(activity.Avg_HR, 145);
  assert.equal(activity.Bucket, 'Heavy');
  assert.equal(activity.RPE, 8);
  assert.equal(activity.Muscle_Focus, 'Lower_Heavy');
  assert.equal(activity.Notes, '');
  assert.equal(activity.Comment, '');
  assert.equal(dashboard.summary.weeklyCompass.buckets.Heavy.done, 1);
  assert.equal(dashboard.summary.weeklyCompass.buckets.Engine.done, 1);
  assert.equal(dashboard.summary.fatigue48h.regions.CNS.score, 0.42);

  const app = frontend();
  const derived = app.buildDerived(dashboard);
  assert.equal(derived.activities.find((a) => a.Activity_ID === 'G-1').Duration_Min, 45);
  assert.equal(derived.activities.find((a) => a.Activity_ID === 'G-1').Bucket, 'Heavy');
  app.activities = derived.activities;
  assert.equal(vm.runInContext("Analytics.fatigue48h(activities, '2026-11-16').regions.CNS.score", app), 0.42);
});

test('deduplicates before the dashboard limit and preserves manual duration', () => {
  const manual = {
    Activity_ID: 'RACK-1', Date: '2026-11-16', Source: 'Manual', Bucket: 'Heavy',
    Type: 'Rack_Strength', Duration_Min: 42, Notes: 'updated'
  };
  const rows = [manual, ...Array.from({ length: 35 }, () => ({ ...manual, Duration_Min: 3, Notes: 'old' })),
    { ...manual, Activity_ID: 'RACK-2', Duration_Min: 15 }];
  const dashboard = backend(rows).handleGetDashboard_({});
  assert.equal(dashboard.activities.length, 2);
  assert.equal(dashboard.activities.find((a) => a.Activity_ID === 'RACK-1').Duration_Min, 42);
  assert.equal(dashboard.activities.find((a) => a.Activity_ID === 'RACK-1').Notes, 'updated');
  assert.equal(dashboard.summary.weeklyCompass.buckets.Heavy.done, 2);
});

test('uses sheet order even when duplicate dates differ and retains nonempty sync fields', () => {
  const first = { Activity_ID: 123, Date: '2026-11-16', Source: 'Garmin', Bucket: '', Notes: '' };
  const last = { Activity_ID: '123', Date: '2026-11-15', Source: 'Garmin', Bucket: 'Engine', Notes: 'old', Duration_Min: 45 };
  const dashboard = backend([first, last, { Date: '2026-11-16' }]).handleGetDashboard_({});
  assert.equal(dashboard.activities.length, 1);
  assert.equal(dashboard.activities[0].Date, '2026-11-15');
  assert.equal(dashboard.activities[0].Bucket, 'Engine');
  assert.equal(dashboard.activities[0].Notes, '');
  assert.equal(dashboard.activities[0].Duration_Min, 45);
});
