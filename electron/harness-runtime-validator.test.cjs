'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Exercise the validator's process and HTTP boundaries without starting an
// engine, contacting a network service, or touching any user profile.
function fixture(options = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'harness-runtime-validator.cjs'), 'utf8');
  const moduleObject = { exports: {} };
  const calls = { commands: [], managers: [], starts: [], fetches: [], removed: [], cancelledBodies: [], stops: 0, tempDirs: [] };
  const tempRoot = path.resolve(os.tmpdir());
  const scratch = path.join(tempRoot, 'deepseek-update-probe-fixture');
  const behavior = { ...options };
  const fakeFs = {
    async mkdtemp(prefix) { calls.tempDirs.push(prefix); return scratch; },
    async rm(target, config) { calls.removed.push({ target, config }); },
  };
  const manager = {
    async start(config) {
      calls.starts.push(config);
      if (behavior.start) return behavior.start(config);
      if (behavior.startError) throw new Error(behavior.startError);
      return { url: 'http://127.0.0.1:32456/?token=fixture-login' };
    },
    async stop() {
      calls.stops += 1;
      if (behavior.stop) return behavior.stop();
      if (behavior.stopError) throw new Error(behavior.stopError);
    },
  };
  const runProcess = async (executable, args, config) => {
    calls.commands.push({ executable, args, config });
    if (behavior.smoke) return behavior.smoke(executable, args, config);
    if (behavior.smokeError) throw new Error(behavior.smokeError);
  };
  function response(kind, overrides = {}) {
    const defaults = kind === 'token'
      ? { status: 303, location: '/', cookies: ['dsh-auth-fixture=fixture-session; HttpOnly; SameSite=Strict; Path=/'] }
      : kind === 'anonymous' ? { status: 401 } : { status: 200, contentType: 'text/html; charset=utf-8' };
    const value = { ...defaults, ...overrides };
    return {
      status: value.status,
      headers: {
        get: name => ({ location: value.location, 'content-type': value.contentType })[name.toLowerCase()] || null,
        getSetCookie: () => value.cookies || [],
      },
      body: { cancel: async () => { calls.cancelledBodies.push(kind); } },
    };
  }
  const fetch = async (url, config = {}) => {
    const parsed = new URL(url);
    const cookie = config.headers?.Cookie || config.headers?.cookie;
    const kind = parsed.searchParams.has('token') ? 'token' : cookie ? 'authenticated' : 'anonymous';
    calls.fetches.push({ url, config, kind });
    if (behavior.fetch) return behavior.fetch(url, config, kind);
    return response(kind, behavior[kind]);
  };
  const injectedRequire = name => name === 'node:fs/promises' ? fakeFs
    : name === './harness-manager.cjs' ? { createHarnessManager: config => { calls.managers.push(config); return manager; } }
      : name === './harness-updater.cjs' ? { runProcess } : require(name);
  new Function('require', 'module', 'fetch', source)(injectedRequire, moduleObject, fetch);
  const smokeScript = path.resolve('fixture-support/harness-runtime-check.cjs');
  const validate = moduleObject.exports.createHarnessRuntimeValidator({ smokeScript });
  const input = { runtimeRoot: path.resolve('fixture-candidate'), nodePath: path.resolve('fixture-bundle/node.exe'),
    expectedVersion: '0.1.6-alpha.2', signal: new AbortController().signal };
  return { validate, input, calls, behavior, response, scratch, smokeScript };
}

test('candidate validates native smoke plus token/cookie authentication in a disposable home', async () => {
  const f = fixture();
  await f.validate(f.input);
  assert.equal(f.calls.commands.length, 1);
  assert.equal(f.calls.commands[0].executable, f.input.nodePath);
  assert.deepEqual(f.calls.commands[0].args, [f.smokeScript, f.input.runtimeRoot, f.input.nodePath]);
  assert.equal(f.calls.commands[0].config.timeoutMs, 90_000);
  assert.equal(f.calls.commands[0].config.signal, f.input.signal);
  assert.equal(f.calls.commands[0].config.env.NODE_OPTIONS, undefined);
  assert.equal(f.calls.commands[0].config.env.NODE_PATH, undefined);
  assert.equal(f.calls.commands[0].config.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(f.calls.managers.length, 1);
  assert.deepEqual(f.calls.managers[0], { runtimeRoot: f.input.runtimeRoot, nodePath: f.input.nodePath,
    expectedVersion: f.input.expectedVersion, dataDir: path.join(f.scratch, 'profile') });
  assert.deepEqual(f.calls.starts, [{ workspace: f.scratch }]);
  assert.deepEqual(f.calls.fetches.map(call => call.kind).sort(), ['anonymous', 'authenticated', 'token']);
  for (const call of f.calls.fetches) {
    assert.equal(call.config.redirect, 'manual');
    assert.equal(new URL(call.url).origin, 'http://127.0.0.1:32456');
  }
  const authenticated = f.calls.fetches.find(call => call.kind === 'authenticated');
  assert.equal(authenticated.config.headers.Cookie, 'dsh-auth-fixture=fixture-session');
  assert.equal(new URL(authenticated.url).search, '');
  assert.deepEqual(f.calls.cancelledBodies.sort(), ['anonymous', 'authenticated', 'token']);
  assert.equal(f.calls.stops, 1);
  assert.deepEqual(f.calls.removed.map(call => call.target), [f.scratch]);
});

for (const [label, token] of [
  ['non-303 success', { status: 200 }],
  ['different redirect status', { status: 302 }],
  ['missing redirect', { location: null }],
  ['cross-origin redirect', { location: 'https://example.invalid/' }],
  ['non-root redirect', { location: '/other' }],
  ['token retained in redirect', { location: '/?token=fixture-login' }],
  ['missing auth cookie', { cookies: [] }],
  ['unrelated cookie', { cookies: ['other=value; Path=/'] }],
  ['empty auth cookie', { cookies: ['dsh-auth-fixture=; Path=/'] }],
]) {
  test(`rejects ${label} and stops the candidate before cleanup`, async () => {
    const f = fixture({ token });
    await assert.rejects(f.validate(f.input));
    assert.equal(f.calls.stops, 1);
    assert.equal(f.calls.fetches.some(call => call.kind === 'authenticated'), false);
    assert.deepEqual(f.calls.removed.map(call => call.target), [f.scratch]);
  });
}

test('rejects a page available without authentication', async () => {
  const f = fixture({ anonymous: { status: 200, contentType: 'text/html' } });
  await assert.rejects(f.validate(f.input));
  assert.equal(f.calls.stops, 1);
  assert.deepEqual(f.calls.removed.map(call => call.target), [f.scratch]);
});

for (const [label, authenticated] of [
  ['authenticated access denied', { status: 401 }],
  ['authenticated redirect', { status: 302 }],
  ['non-HTML page', { contentType: 'application/json' }],
]) {
  test(`rejects ${label}`, async () => {
    const f = fixture({ authenticated });
    await assert.rejects(f.validate(f.input));
    assert.equal(f.calls.stops, 1);
    assert.deepEqual(f.calls.removed.map(call => call.target), [f.scratch]);
  });
}

test('already-cancelled validation does not spawn or create a temporary profile', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.validate({ ...f.input, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.calls.commands.length, 0);
  assert.equal(f.calls.tempDirs.length, 0);
  assert.equal(f.calls.managers.length, 0);
});

test('cancellation reaches the native smoke and prevents candidate startup', async () => {
  const f = fixture();
  const controller = new AbortController();
  let began;
  const started = new Promise(resolve => { began = resolve; });
  f.behavior.smoke = (_exe, _args, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('fixture aborted'), { name: 'AbortError' })), { once: true });
    began();
  });
  const pending = f.validate({ ...f.input, signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started;
  controller.abort();
  await rejected;
  assert.equal(f.calls.managers.length, 0);
  assert.equal(f.calls.tempDirs.length, 0);
});

test('candidate startup failure still stops and cleans its private profile', async () => {
  const f = fixture({ startError: 'fixture startup failure' });
  await assert.rejects(f.validate(f.input), /fixture startup failure/);
  assert.equal(f.calls.stops, 1);
  assert.equal(f.calls.fetches.length, 0);
  assert.deepEqual(f.calls.removed.map(call => call.target), [f.scratch]);
});

test('abort during candidate startup stops it and cleans only after its promise settles', async () => {
  const f = fixture();
  const controller = new AbortController();
  let began;
  let rejectStart;
  const started = new Promise(resolve => { began = resolve; });
  f.behavior.start = () => new Promise((_resolve, reject) => { rejectStart = reject; began(); });
  f.behavior.stop = async () => rejectStart(Object.assign(new Error('fixture startup aborted'), { name: 'AbortError' }));
  const pending = f.validate({ ...f.input, signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started;
  assert.equal(f.calls.removed.length, 0);
  controller.abort();
  await rejected;
  assert.ok(f.calls.stops >= 1);
  assert.equal(f.calls.fetches.length, 0);
  assert.deepEqual(f.calls.removed.map(call => call.target), [f.scratch]);
});

test('abort during local HTTP authentication propagates to fetch and stops the candidate', async () => {
  const f = fixture();
  const controller = new AbortController();
  let began;
  const started = new Promise(resolve => { began = resolve; });
  f.behavior.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('fixture HTTP aborted'), { name: 'AbortError' })), { once: true });
    began();
  });
  const pending = f.validate({ ...f.input, signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started;
  controller.abort();
  await rejected;
  assert.ok(f.calls.stops >= 1);
  assert.deepEqual(f.calls.removed.map(call => call.target), [f.scratch]);
});

test('failed process stop marks uncertain termination and preserves scratch files', async () => {
  const f = fixture({ stopError: 'fixture stop could not be confirmed' });
  await assert.rejects(f.validate(f.input), error => error.processMayBeRunning === true);
  assert.equal(f.calls.stops, 1);
  assert.equal(f.calls.removed.length, 0);
});
