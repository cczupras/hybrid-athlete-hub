const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('build metadata is available outside the Actions deployment workflow', () => {
  const build = JSON.parse(fs.readFileSync(path.join(root, 'docs/version.json'), 'utf8'));

  assert.ok(Number.isInteger(Number(build.version)) && Number(build.version) > 0);
  assert.ok(Number.isFinite(new Date(build.builtAt).getTime()));
  assert.match(fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8'), /version\.json/);
});

test('modals remain hidden without Tailwind and stale service-worker caches are invalidated', () => {
  const html = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(root, 'docs/sw.js'), 'utf8');

  assert.match(html, /#activityModal\.hidden,\s*#settingsModal\.hidden\s*\{\s*display:\s*none\s*!important;/);
  assert.match(serviceWorker, /const CACHE_NAME = 'hybrid-athlete-hub-v4';/);
});
