'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureAppIdentity } = require('../app-identity.cjs');

function fixture(t, { name = 'DeepSeek', override, cli = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-identity-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = { appData: root, userData: override ? path.join(root, override) : path.join(root, name) };
  let appName = name;
  const app = {
    getName: () => appName,
    setName: (value) => { appName = value; },
    getPath: (key) => paths[key],
    setPath: (key, value) => { assert.ok(fs.statSync(value).isDirectory()); paths[key] = value; },
    commandLine: { getSwitchValue: () => cli === 'preferred' ? path.join(root, 'DeepSeek') : cli },
  };
  const directory = (name) => {
    const result = path.join(root, name);
    fs.mkdirSync(result, { recursive: true });
    return result;
  };
  return { root, paths, app, directory };
}

test('Renaming uses a legacy profile in place, preserving its exact contents', (t) => {
  const f = fixture(t);
  const legacy = f.directory('DeepSeek Studio');
  const settings = path.join(legacy, 'settings.json');
  const saved = '{"apiKeyEncrypted":"existing-ciphertext","theme":"dark"}';
  fs.writeFileSync(settings, saved);
  assert.equal(configureAppIdentity(f.app), legacy);
  assert.equal(f.app.getName(), 'DeepSeek');
  assert.equal(f.paths.userData, legacy);
  assert.equal(fs.readFileSync(settings, 'utf8'), saved);
  assert.deepEqual(fs.readdirSync(f.root), ['DeepSeek Studio']);
});

test('An existing DeepSeek profile takes precedence over the legacy profile', (t) => {
  const f = fixture(t);
  const preferred = f.directory('DeepSeek');
  f.directory('DeepSeek Studio');
  assert.equal(configureAppIdentity(f.app), preferred);
  assert.equal(f.paths.userData, preferred);
});

test('An external userData override is preserved even with legacy data present', (t) => {
  const f = fixture(t, { override: 'isolated-smoke-profile' });
  const override = f.directory('isolated-smoke-profile');
  f.directory('DeepSeek Studio');
  assert.equal(configureAppIdentity(f.app), override);
  assert.equal(f.paths.userData, override);
  assert.equal(f.app.getName(), 'DeepSeek');
});

test('An explicit default --user-data-dir suppresses legacy fallback', (t) => {
  const f = fixture(t, { cli: 'preferred' });
  f.directory('DeepSeek Studio');
  const preferred = path.join(f.root, 'DeepSeek');
  assert.equal(configureAppIdentity(f.app), preferred);
  assert.equal(f.paths.userData, preferred);
});

test('A --user-data-dir path is applied before selecting a legacy profile', (t) => {
  const f = fixture(t);
  f.directory('DeepSeek Studio');
  const explicit = path.join(f.root, 'cli-profile');
  f.app.commandLine.getSwitchValue = () => explicit;
  assert.equal(configureAppIdentity(f.app), explicit);
  assert.equal(f.paths.userData, explicit);
  assert.ok(fs.statSync(explicit).isDirectory());
});

test('A new development profile uses DeepSeek after the package name changes', (t) => {
  const f = fixture(t, { name: 'deepseek-desktop' });
  const preferred = path.join(f.root, 'DeepSeek');
  assert.equal(configureAppIdentity(f.app), preferred);
  assert.equal(f.paths.userData, preferred);
  assert.ok(fs.statSync(preferred).isDirectory());
});
