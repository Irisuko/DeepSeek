'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { acquireInstallationLock } = require('./harness-installation-lock.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-installation-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('same installation rejects another owner and can be reopened after release', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture(t);
  const first = await acquireInstallationLock(root);
  t.after(() => first.release());
  await assert.rejects(acquireInstallationLock(root), { code: 'HARNESS_INSTALLATION_IN_USE' });
  await first.release();
  await first.release();
  const second = await acquireInstallationLock(root);
  await second.release();
});

test('case changes and dot segments share the installation lock', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture(t);
  const first = await acquireInstallationLock(root);
  t.after(() => first.release());
  await assert.rejects(acquireInstallationLock(root.toUpperCase()), { code: 'HARNESS_INSTALLATION_IN_USE' });
  await assert.rejects(acquireInstallationLock(root + path.sep + '.'), { code: 'HARNESS_INSTALLATION_IN_USE' });
});

test('different installations can run independently', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture(t);
  const other = path.join(root, 'other');
  fs.mkdirSync(other);
  const first = await acquireInstallationLock(root);
  t.after(() => first.release());
  const second = await acquireInstallationLock(other);
  await second.release();
});

test('another process cannot acquire the lock and process death releases it', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const root = fixture(t);
  const helper = require.resolve('./harness-installation-lock.cjs');
  const child = spawn(process.execPath, ['-e', `
    require(process.argv[1]).acquireInstallationLock(process.argv[2]).then(() => {
      process.stdout.write('ready\\n');
      setInterval(() => {}, 1000);
    }).catch(error => { process.stderr.write(String(error)); process.exit(1); });
  `, helper, root], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL'); });
  await Promise.race([
    once(child.stdout, 'data').then(([data]) => assert.match(String(data), /ready/)),
    once(child, 'exit').then(([code]) => { throw new Error(`Lock owner exited before readiness (${code}).`); }),
  ]);
  await assert.rejects(acquireInstallationLock(root), { code: 'HARNESS_INSTALLATION_IN_USE' });
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  const recovered = await acquireInstallationLock(root);
  await recovered.release();
});

test('a missing installation is never silently locked', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture(t);
  await assert.rejects(acquireInstallationLock(path.join(root, 'missing')), { code: 'ENOENT' });
});
