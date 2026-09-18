'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHarnessUpdater, selectLatestRelease, npmEnvironment } = require('./harness-updater.cjs');

const PACKAGE = '@deepseek-ai/dsh';
const SRI = 'sha512-' + Buffer.alloc(64, 9).toString('base64');

function installFixture(root, version, integrity = SRI) {
  const packageRoot = path.join(root, 'node_modules', '@deepseek-ai', 'dsh');
  fs.mkdirSync(path.join(packageRoot, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: PACKAGE, version }));
  fs.writeFileSync(path.join(packageRoot, 'lib', 'bin.js'), '// test fixture only');
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: {
    'node_modules/@deepseek-ai/dsh': { version, integrity },
  } }));
}

function release(version = '0.1.6-alpha.2', overrides = {}) {
  return { tag_name: `dsh-v${version}`, published_at: '2026-09-18T00:00:00Z', prerelease: true, ...overrides };
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-update-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundledRuntimeRoot = path.join(root, 'bundled');
  const dataDir = path.join(root, 'data');
  installFixture(bundledRuntimeRoot, options.bundledVersion || '0.1.5-rc.1');
  fs.writeFileSync(path.join(bundledRuntimeRoot, process.platform === 'win32' ? 'node.exe' : 'node'), 'fixture-node');
  fs.mkdirSync(path.join(bundledRuntimeRoot, 'npm', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(bundledRuntimeRoot, 'npm', 'bin', 'npm-cli.js'), 'fixture-npm');
  fs.cpSync(path.dirname(require.resolve('semver/package.json')), path.join(bundledRuntimeRoot, 'npm', 'node_modules', 'semver'), { recursive: true });
  const requests = [];
  const commands = [];
  const statuses = [];
  const validations = [];
  const behavior = { stopped: true, version: '0.1.6-alpha.2', ...options };
  const config = {
    bundledRuntimeRoot, dataDir,
    isHarnessStopped: () => behavior.stopped,
    onStatus: status => statuses.push(status),
    fetchImpl: async (url, init) => {
      requests.push(url);
      if (behavior.fetch) return behavior.fetch(url, init);
      if (url.includes('/releases?')) return { ok: true, text: async () => JSON.stringify([release(behavior.version)]) };
      if (url.includes('/git/ref/')) return { ok: true, text: async () => JSON.stringify({ object: { type: 'commit', sha: 'b'.repeat(40) } }) };
      return { ok: true, text: async () => JSON.stringify({
        name: PACKAGE, version: behavior.version,
        repository: { url: 'git+https://github.com/deepseek-ai/deepseek-harness.git' },
        dist: { integrity: SRI, tarball: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh.tgz' },
        ...behavior.metadata,
      }) };
    },
    runProcess: async (executable, args, init) => {
      commands.push({ executable, args, init });
      if (behavior.process) return behavior.process(executable, args, init);
      if (args[1] === 'install') installFixture(init.cwd, behavior.version, behavior.integrity || SRI);
      if (behavior.installError) throw new Error(behavior.installError);
    },
    validateCandidate: async candidate => {
      validations.push(candidate);
      if (behavior.validate) await behavior.validate(candidate);
    },
  };
  return { updater: createHarnessUpdater(config), config, behavior, root, bundledRuntimeRoot, dataDir,
    requests, commands, statuses, validations, stateFile: path.join(dataDir, 'harness-updates', 'active.json') };
}

test('latest official CLI release includes previews and ignores drafts and unrelated tags', () => {
  assert.equal(selectLatestRelease([
    release('0.1.6-alpha.1', { published_at: '2026-09-17T00:00:00Z' }),
    release('99.0.0', { draft: true }),
    release('0.1.6-alpha.2'),
    release('99.0.1', { tag_name: 'desktop-v99.0.1' }),
    release('99.0.2', { published_at: 'not-a-date' }),
  ]).version, '0.1.6-alpha.2');
});

test('verified staged install persists selection, leaves bundle intact, and supports rollback', async t => {
  const f = fixture(t);
  await f.updater.initialize();
  const bundled = f.updater.getRuntime();
  const status = await f.updater.update();
  assert.equal(status.state, 'ready');
  assert.equal(status.canRollback, true);
  assert.equal(status.prerelease, true);
  const updated = f.updater.getRuntime();
  assert.notEqual(updated.runtimeRoot, bundled.runtimeRoot);
  assert.equal(updated.nodePath, bundled.nodePath);
  assert.equal(updated.expectedVersion, '0.1.6-alpha.2');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.bundledRuntimeRoot, 'node_modules/@deepseek-ai/dsh/package.json'))).version, '0.1.5-rc.1');
  assert.equal(f.validations.length, 1);
  assert.equal(f.commands.length, 2);
  assert.ok(f.commands[0].args.includes('--ignore-scripts'));
  assert.equal(f.commands[1].args[1], 'rebuild');
  assert.equal(f.commands[1].args.includes('--dangerously-allow-all-scripts'), false);
  assert.equal(f.commands[1].args.includes('@google/genai'), false);
  assert.equal(f.commands[0].init.cwd, updated.runtimeRoot);
  const restarted = createHarnessUpdater(f.config);
  await restarted.initialize();
  assert.deepEqual(restarted.getRuntime(), updated);
  await restarted.rollback();
  assert.deepEqual(restarted.getRuntime(), bundled);
  const restartedAgain = createHarnessUpdater(f.config);
  await restartedAgain.initialize();
  assert.deepEqual(restartedAgain.getRuntime(), bundled);
  await restartedAgain.rollback();
  assert.deepEqual(restartedAgain.getRuntime(), updated);
});

test('running engine blocks update without any download or process side effect', async t => {
  const f = fixture(t, { stopped: false });
  await f.updater.initialize();
  await assert.rejects(f.updater.update(), /请先停止 Harness/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.commands.length, 0);
  assert.equal(fs.existsSync(f.stateFile), false);
});

test('install failure cleans only its candidate and keeps the previous selected runtime', async t => {
  const f = fixture(t);
  await f.updater.initialize();
  await f.updater.update();
  const selected = f.updater.getRuntime();
  const before = fs.readFileSync(f.stateFile, 'utf8');
  f.behavior.version = '0.1.6-alpha.3';
  f.behavior.installError = 'fixture install failure';
  await assert.rejects(f.updater.update(), /fixture install failure/);
  assert.deepEqual(f.updater.getRuntime(), selected);
  assert.equal(fs.readFileSync(f.stateFile, 'utf8'), before);
  assert.equal(fs.readdirSync(path.dirname(f.stateFile)).filter(name => name.startsWith('runtime-')).length, 1);
});

test('native or startup smoke failure never activates the candidate', async t => {
  const f = fixture(t, { validate: async () => { throw new Error('native smoke failed'); } });
  await f.updater.initialize();
  await assert.rejects(f.updater.update(), /native smoke failed/);
  assert.equal(f.updater.getRuntime().runtimeRoot, f.bundledRuntimeRoot);
  assert.equal(fs.existsSync(f.stateFile), false);
  assert.equal(f.updater.getStatus().canRollback, false);
});

test('SRI mismatch rejects before native lifecycle hooks and validation', async t => {
  const f = fixture(t, { integrity: 'sha512-invalid' });
  await f.updater.initialize();
  await assert.rejects(f.updater.update(), /完整性校验失败/);
  assert.equal(f.commands.length, 1);
  assert.equal(f.validations.length, 0);
  assert.equal(fs.existsSync(f.stateFile), false);
});

test('repository metadata and optional gitHead must match official release', async t => {
  const f = fixture(t, { metadata: { repository: { url: 'https://github.com/other/other.git' } } });
  await f.updater.initialize();
  await assert.rejects(f.updater.update(), /npm 包信息未通过校验/);
  f.behavior.metadata = { gitHead: 'a'.repeat(40) };
  await assert.rejects(f.updater.update(), /源码提交不一致/);
  assert.equal(f.commands.length, 0);
});

test('rechecks GitHub at update time instead of installing a stale checked release', async t => {
  const f = fixture(t);
  await f.updater.initialize();
  assert.equal((await f.updater.check()).state, 'available');
  f.behavior.version = '0.1.6-alpha.3';
  await f.updater.update();
  assert.equal(f.updater.getRuntime().expectedVersion, '0.1.6-alpha.3');
  assert.equal(f.requests.filter(url => url.includes('/releases?')).length, 2);
});

test('older official publication does not downgrade a newer installed version', async t => {
  const f = fixture(t, { bundledVersion: '0.1.7', version: '0.1.6-alpha.2' });
  await f.updater.initialize();
  assert.equal((await f.updater.check()).state, 'current');
  assert.equal((await f.updater.update()).state, 'current');
  assert.equal(f.commands.length, 0);
  assert.equal(f.updater.getRuntime().expectedVersion, '0.1.7');
});

test('a concurrent operation is rejected; cancellation aborts network and permits retry', async t => {
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  const f = fixture(t, { fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('cancelled fixture request')), { once: true });
    started();
  }) });
  await f.updater.initialize();
  const checking = f.updater.check();
  const rejected = assert.rejects(checking, /更新已取消/);
  await waiting;
  await assert.rejects(f.updater.update(), /已有 Harness 更新操作/);
  await f.updater.cancel();
  await rejected;
  assert.equal(f.updater.getStatus().state, 'cancelled');
  f.behavior.fetch = null;
  assert.equal((await f.updater.check()).state, 'available');
});

test('shutdown waits for installer cancellation and prevents future operations', async t => {
  let started;
  let stopped = false;
  const waiting = new Promise(resolve => { started = resolve; });
  const f = fixture(t, { process: (_executable, _args, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { stopped = true; const error = new Error('cancelled'); error.name = 'AbortError'; reject(error); }, { once: true });
    started();
  }) });
  await f.updater.initialize();
  const updating = f.updater.update();
  const rejection = assert.rejects(updating, /cancelled/);
  await waiting;
  await f.updater.shutdown();
  await rejection;
  assert.equal(stopped, true);
  assert.equal(fs.existsSync(f.stateFile), false);
  await assert.rejects(f.updater.check(), /应用正在退出/);
});

test('engine becoming active before commit leaves original runtime selected', async t => {
  const f = fixture(t);
  f.behavior.validate = async () => { f.behavior.stopped = false; };
  await f.updater.initialize();
  await assert.rejects(f.updater.update(), /请先停止 Harness/);
  assert.equal(fs.existsSync(f.stateFile), false);
});

test('malformed saved runtime path falls back to bundle without touching the target', async t => {
  const f = fixture(t);
  await f.updater.initialize();
  const outside = path.join(f.root, 'keep-me.txt');
  fs.writeFileSync(outside, 'unchanged');
  fs.writeFileSync(f.stateFile, JSON.stringify({ schema: 1, current: { directory: '../../', version: '0.1.6-alpha.2' } }));
  const restarted = createHarnessUpdater(f.config);
  await restarted.initialize();
  assert.equal(restarted.getRuntime().runtimeRoot, f.bundledRuntimeRoot);
  assert.equal(restarted.getStatus().state, 'error');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged');
});

test('npm receives isolated config and excludes inherited credentials and injected Node flags', () => {
  const previous = { ...process.env };
  try {
    process.env.NPM_CONFIG_REGISTRY = 'https://unrelated.invalid/';
    process.env.NPM_TOKEN = 'test-secret';
    process.env.NODE_AUTH_TOKEN = 'test-secret';
    process.env.NODE_OPTIONS = '--inspect';
    process.env.NODE_PATH = '/unrelated';
    process.env.ELECTRON_RUN_AS_NODE = '1';
    process.env.HTTPS_PROXY = 'http://127.0.0.1:1234';
    const env = npmEnvironment(path.resolve('node.exe'), path.resolve('candidate'), path.resolve('updates'));
    assert.equal(env.NPM_CONFIG_REGISTRY, undefined);
    assert.equal(env.NPM_TOKEN, undefined);
    assert.equal(env.NODE_AUTH_TOKEN, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.NODE_PATH, undefined);
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:1234');
    assert.equal(env.npm_config_registry, 'https://registry.npmjs.org/');
    assert.equal(env.npm_config_userconfig, path.resolve('candidate/.npmrc'));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
