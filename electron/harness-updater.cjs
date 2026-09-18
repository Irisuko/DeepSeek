'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { sanitizeOutput } = require('./harness-manager.cjs');

const REPOSITORY = 'deepseek-ai/deepseek-harness';
const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;
const REGISTRY = 'https://registry.npmjs.org/';
const PACKAGE = '@deepseek-ai/dsh';
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DIRECTORY = /^runtime-[a-f0-9-]{36}$/;
const ALLOWED_SCRIPTS = Object.freeze({
  '@deepseek-ai/dsh-subprocess-local': true,
  koffi: true,
  'node-pty': true,
  protobufjs: true,
  '@google/genai': false,
});

function aborted() { const error = new Error('Harness 更新已取消。'); error.name = 'AbortError'; return error; }
function throwIfAborted(signal) { if (signal?.aborted) throw aborted(); }
function safeVersion(value) { return typeof value === 'string' && value.length <= 80 && VERSION.test(value); }
function packageRoot(runtimeRoot) { return path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh'); }

function readRuntimeVersion(runtimeRoot, expectedVersion) {
  const root = packageRoot(runtimeRoot);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== PACKAGE || !safeVersion(manifest.version)
    || (expectedVersion && manifest.version !== expectedVersion)
    || !fs.statSync(path.join(root, 'lib', 'bin.js'), { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Harness 运行环境不完整或版本不匹配。');
  }
  return manifest.version;
}

function selectLatestRelease(releases) {
  if (!Array.isArray(releases)) throw new Error('GitHub 返回了无效的发布信息。');
  const candidates = releases.filter(release => {
    const version = typeof release?.tag_name === 'string' ? release.tag_name.replace(/^dsh-v/, '') : '';
    return !release?.draft && release?.tag_name === `dsh-v${version}` && safeVersion(version)
      && Number.isFinite(Date.parse(release.published_at || release.created_at));
  });
  candidates.sort((a, b) => Date.parse(b.published_at || b.created_at) - Date.parse(a.published_at || a.created_at));
  const release = candidates[0];
  if (!release) throw new Error('官方仓库中尚未找到可安装的 Harness 发布。');
  return {
    version: release.tag_name.slice(5), tag: release.tag_name, prerelease: Boolean(release.prerelease),
    publishedAt: release.published_at || release.created_at,
    releaseUrl: `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(release.tag_name)}`,
  };
}

function npmEnvironment(nodePath, runtimeRoot, updateRoot) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:npm_config_|npm_token$|node_auth_token$|npm_auth_token$)/i.test(key)
      || /^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete env[key];
  }
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = `${path.dirname(nodePath)}${path.delimiter}${env[pathKey] || ''}`;
  env.npm_config_userconfig = path.join(runtimeRoot, '.npmrc');
  env.npm_config_globalconfig = path.join(updateRoot, 'global.npmrc');
  env.npm_config_cache = path.join(updateRoot, 'npm-cache');
  env.npm_config_registry = REGISTRY;
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  return env;
}

async function terminateOwnedChild(child) {
  if (child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 6_000 }, () => resolve()));
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* The child may have just exited. */ }
  }
  if (child.exitCode === null && !child.signalCode) {
    try { child.kill('SIGKILL'); } catch { /* close/error determines completion. */ }
  }
}

/** Spawn only the bundled Node with fixed npm arguments; never execute a shell. */
function runProcess(executable, args, { cwd, env, signal, timeoutMs = 15 * 60_000 }) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { reject(error); return; }
    let log = '';
    let stopping = null;
    let finished = false;
    let terminationTimer;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(terminationTimer);
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve({ output: log });
    };
    const stop = (error) => {
      if (stopping || finished) return;
      stopping = error;
      void terminateOwnedChild(child).catch(() => {});
      terminationTimer = setTimeout(() => {
        const failure = new Error('无法确认更新进程已停止，请退出应用后重试。');
        failure.processMayBeRunning = true;
        finish(failure);
      }, 10_000);
    };
    const onAbort = () => stop(aborted());
    const timer = setTimeout(() => stop(new Error('Harness 依赖下载或安装超时，请检查网络后重试。')), timeoutMs);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = sanitizeOutput(log + chunk.toString()); });
    child.once('error', error => finish(stopping || new Error(`无法启动 Harness 更新进程：${sanitizeOutput(error.message)}`)));
    child.once('close', code => finish(stopping || (code === 0 ? null : new Error(`Harness 依赖安装失败。${log ? '\n' + log : ''}`))));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/**
 * Updates the official Harness engine only. Candidate installs are immutable,
 * and the bundled runtime remains the fallback. The caller supplies an isolated
 * smoke validator so no candidate process touches the user's Harness profile.
 */
function createHarnessUpdater({ bundledRuntimeRoot, dataDir, onStatus = () => {},
  isHarnessStopped = () => true, validateCandidate,
  fetchImpl = globalThis.fetch, runProcess: execute = runProcess }) {
  if (!path.isAbsolute(bundledRuntimeRoot) || !path.isAbsolute(dataDir)) throw new Error('Harness 更新目录必须是绝对路径。');
  if (typeof validateCandidate !== 'function') throw new Error('Harness 更新必须配置独立的运行环境验证。');
  const updateRoot = path.join(dataDir, 'harness-updates');
  const stateFile = path.join(updateRoot, 'active.json');
  const nodePath = path.join(bundledRuntimeRoot, process.platform === 'win32' ? 'node.exe' : 'node');
  const npmCli = path.join(bundledRuntimeRoot, 'npm', 'bin', 'npm-cli.js');
  let semver;
  function isNewer(version) {
    try { semver ||= require(path.join(bundledRuntimeRoot, 'npm', 'node_modules', 'semver')); }
    catch { throw new Error('此安装包缺少 Harness 更新工具，请安装新版 DeepSeek 后重试。'); }
    if (!semver.valid(version)) throw new Error('官方 Harness 发布标签不是有效的版本标识。');
    return semver.gt(version, active?.version || bundledVersion);
  }
  const bundledVersion = readRuntimeVersion(bundledRuntimeRoot);
  let active = null;
  let previous = null;
  let canRollback = false;
  let latest = null;
  let operation = null;
  let shuttingDown = false;
  let status = { state: 'idle', busy: false, message: '更新到官方最新发布（包含预发布）。' };

  function getStatus() {
    return { ...status, canRollback, currentVersion: active?.version || bundledVersion,
      latestVersion: latest?.version || null, releaseUrl: latest?.releaseUrl || active?.releaseUrl || null,
      prerelease: latest?.prerelease ?? active?.prerelease ?? false };
  }
  function publish(patch) {
    status = { ...status, ...patch };
    try { onStatus(getStatus()); } catch { /* Closing windows cannot break updates. */ }
  }
  function resolveDescriptor(descriptor) {
    if (!descriptor) return { runtimeRoot: bundledRuntimeRoot, nodePath, expectedVersion: bundledVersion };
    if (!DIRECTORY.test(descriptor.directory) || !safeVersion(descriptor.version)) throw new Error('Harness 更新记录无效。');
    const runtimeRoot = path.join(updateRoot, descriptor.directory);
    const actual = fs.realpathSync(runtimeRoot);
    const expectedParent = fs.realpathSync(updateRoot);
    if (fs.lstatSync(runtimeRoot).isSymbolicLink() || path.dirname(actual).toLowerCase() !== expectedParent.toLowerCase()) {
      throw new Error('Harness 更新目录无效。');
    }
    readRuntimeVersion(runtimeRoot, descriptor.version);
    return { runtimeRoot, nodePath, expectedVersion: descriptor.version };
  }
  function getRuntime() { return resolveDescriptor(active); }
  function assertStopped() {
    if (!isHarnessStopped()) throw new Error('请先停止 Harness 引擎，再更新或恢复；正在执行的任务不会被自动中断。');
  }
  async function initialize() {
    await fs.promises.mkdir(updateRoot, { recursive: true });
    if (!fs.existsSync(stateFile)) return getRuntime();
    try {
      const saved = JSON.parse(await fs.promises.readFile(stateFile, 'utf8'));
      if (saved.schema !== 1) throw new Error('Unknown update state');
      resolveDescriptor(saved.current);
      active = saved.current || null;
      try { resolveDescriptor(saved.previous); previous = saved.previous || null; canRollback = saved.canRollback === true; }
      catch { previous = null; canRollback = Boolean(active); }
      publish({ state: 'idle', message: active ? '正在使用已安装的 Harness 更新。' : '正在使用内置 Harness。' });
    } catch {
      active = null;
      previous = null;
      canRollback = false;
      publish({ state: 'error', message: '上次的 Harness 更新记录不完整，已使用内置引擎。可重新检查更新。' });
    }
    return getRuntime();
  }
  async function writeState(next, prior, rollbackAvailable) {
    const temporary = path.join(updateRoot, `active-${crypto.randomUUID()}.tmp`);
    try {
      await fs.promises.writeFile(temporary, JSON.stringify({ schema: 1, current: next, previous: prior, canRollback: rollbackAvailable }, null, 2), { encoding: 'utf8', flag: 'wx' });
      await fs.promises.rename(temporary, stateFile);
    } finally { await fs.promises.rm(temporary, { force: true }).catch(() => {}); }
  }
  async function getJson(url, signal) {
    throwIfAborted(signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, 30_000);
    signal.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'DeepSeek-Desktop-Harness-Updater' } });
      if (!response.ok) {
        if (response.status === 403 || response.status === 429) throw new Error('更新服务暂时限制了请求，请稍后再试。');
        if (response.status === 404 && url.startsWith(REGISTRY)) throw new Error('该 Harness 发布尚未同步到官方 npm 包，请稍后再试。');
        throw new Error(`无法读取官方更新信息（HTTP ${response.status}）。`);
      }
      const body = await response.text();
      if (body.length > 8 * 1024 * 1024) throw new Error('官方更新信息过大，已停止更新。');
      return JSON.parse(body);
    } catch (error) {
      if (signal.aborted) throw aborted();
      if (controller.signal.aborted) throw new Error('检查 Harness 更新超时，请检查网络后重试。');
      throw error;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  async function discover(signal) {
    latest = selectLatestRelease(await getJson(RELEASES_URL, signal));
    return latest;
  }
  async function validateRegistry(release, signal) {
    const metadata = await getJson(`${REGISTRY}@deepseek-ai%2Fdsh/${encodeURIComponent(release.version)}`, signal);
    const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url;
    const normalized = typeof repository === 'string' ? repository.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/$/, '') : '';
    if (metadata.name !== PACKAGE || metadata.version !== release.version
      || !['https://github.com/' + REPOSITORY, 'git://github.com/' + REPOSITORY].includes(normalized)
      || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.dist?.integrity || '')) {
      throw new Error('官方 npm 包信息未通过校验，当前 Harness 保持不变。');
    }
    const tarball = new URL(metadata.dist.tarball);
    if (tarball.protocol !== 'https:' || tarball.hostname !== 'registry.npmjs.org' || tarball.username || tarball.password) {
      throw new Error('Harness 下载来源无效，当前引擎保持不变。');
    }
    // Most current dsh releases omit gitHead. When present, compare it with the
    // official tag's commit instead of accepting a mismatched source claim.
    if (metadata.gitHead) {
      let reference = await getJson(`https://api.github.com/repos/${REPOSITORY}/git/ref/tags/${encodeURIComponent(release.tag)}`, signal);
      let object = reference.object;
      for (let depth = 0; object?.type === 'tag' && depth < 3; depth += 1) {
        if (!/^[a-f0-9]{40}$/i.test(object.sha)) throw new Error('官方发布标签无效。');
        reference = await getJson(`https://api.github.com/repos/${REPOSITORY}/git/tags/${object.sha}`, signal);
        object = reference.object;
      }
      if (object?.type !== 'commit' || !/^[a-f0-9]{40}$/i.test(metadata.gitHead) || object.sha !== metadata.gitHead) {
        throw new Error('Harness 发布标签与 npm 包的源码提交不一致，已停止更新。');
      }
    }
    return metadata;
  }
  function begin(work) {
    if (shuttingDown) return Promise.reject(new Error('应用正在退出，请下次启动后重试。'));
    if (operation) return Promise.reject(new Error('已有 Harness 更新操作正在进行，请稍候。'));
    const controller = new AbortController();
    const record = { controller, promise: null };
    operation = record;
    record.promise = Promise.resolve().then(() => work(controller.signal)).catch(error => {
      const cancelled = error.name === 'AbortError';
      publish({ state: cancelled ? 'cancelled' : 'error', busy: false,
        message: cancelled ? 'Harness 更新已取消，原引擎保持不变。' : sanitizeOutput(error.message).slice(-1_500) });
      throw error;
    }).finally(() => { if (operation === record) operation = null; });
    return record.promise;
  }
  function check() {
    return begin(async signal => {
      publish({ state: 'checking', busy: true, message: '正在检查官方 Harness 发布…' });
      const release = await discover(signal);
      throwIfAborted(signal);
      const available = isNewer(release.version);
      publish({ state: available ? 'available' : 'current', busy: false,
        message: available ? '发现官方 Harness 更新，可点击更新。' : release.version === (active?.version || bundledVersion)
          ? 'Harness 已与官方最新发布一致。' : '当前 Harness 已更新，无需安装较早的官方发布。' });
      return getStatus();
    });
  }
  function update() {
    return begin(async signal => {
      assertStopped();
      publish({ state: 'checking', busy: true, message: '正在检查官方 Harness 发布…' });
      const release = await discover(signal);
      if (!isNewer(release.version)) {
        publish({ state: 'current', busy: false, message: release.version === (active?.version || bundledVersion)
          ? 'Harness 已与官方最新发布一致。' : '当前 Harness 已更新，无需安装较早的官方发布。' });
        return getStatus();
      }
      const metadata = await validateRegistry(release, signal);
      throwIfAborted(signal);
      if (!fs.existsSync(npmCli) || !fs.existsSync(nodePath)) throw new Error('此安装包缺少 Harness 更新工具，请安装新版 DeepSeek 后重试。');
      assertStopped();
      const directory = `runtime-${crypto.randomUUID()}`;
      const runtimeRoot = path.join(updateRoot, directory);
      let committed = false;
      let created = false;
      try {
        await fs.promises.mkdir(runtimeRoot, { recursive: false });
        created = true;
        await fs.promises.writeFile(path.join(runtimeRoot, 'package.json'), JSON.stringify({
          name: 'deepseek-harness-runtime', version: '0.0.0', private: true,
          dependencies: { [PACKAGE]: release.version }, allowScripts: ALLOWED_SCRIPTS,
        }, null, 2));
        await fs.promises.writeFile(path.join(runtimeRoot, '.npmrc'), `registry=${REGISTRY}\n`);
        await fs.promises.writeFile(path.join(updateRoot, 'global.npmrc'), '');
        const options = { cwd: runtimeRoot, env: npmEnvironment(nodePath, runtimeRoot, updateRoot), signal };
        const shared = [`--registry=${REGISTRY}`, '--no-audit', '--no-fund', '--no-progress', '--engine-strict'];
        publish({ state: 'downloading', busy: true, message: '正在下载官方 Harness 与依赖，首次可能需要几分钟…' });
        await execute(nodePath, [npmCli, 'install', '--ignore-scripts', ...shared], options);
        throwIfAborted(signal);
        readRuntimeVersion(runtimeRoot, release.version);
        const lock = JSON.parse(await fs.promises.readFile(path.join(runtimeRoot, 'package-lock.json'), 'utf8'));
        const installed = lock.packages?.['node_modules/@deepseek-ai/dsh'];
        if (installed?.version !== release.version || installed?.integrity !== metadata.dist.integrity) {
          throw new Error('Harness 下载完整性校验失败，当前引擎保持不变。');
        }
        publish({ state: 'installing', busy: true, message: '正在准备 Harness 本地终端与运行组件…' });
        await execute(nodePath, [npmCli, 'rebuild', ...Object.keys(ALLOWED_SCRIPTS).filter(name => ALLOWED_SCRIPTS[name]),
          '--ignore-scripts=false', '--foreground-scripts', ...shared], options);
        throwIfAborted(signal);
        publish({ state: 'validating', busy: true, message: '正在验证 Harness 启动与本地运行组件…' });
        await validateCandidate({ runtimeRoot, nodePath, expectedVersion: release.version, signal });
        throwIfAborted(signal);
        assertStopped();
        const next = { directory, version: release.version, tag: release.tag, releaseUrl: release.releaseUrl,
          prerelease: release.prerelease, publishedAt: release.publishedAt, integrity: metadata.dist.integrity };
        await writeState(next, active, true);
        previous = active;
        active = next;
        canRollback = true;
        committed = true;
        publish({ state: 'ready', busy: false, message: 'Harness 更新完成，下次打开工作区即使用新引擎。' });
        return getStatus();
      } catch (error) {
        // Only this newly-created direct child belongs to the failed operation.
        // Do not remove it when an owned installer may still be writing to it.
        if (created && !committed && !error.processMayBeRunning && path.dirname(runtimeRoot) === updateRoot && DIRECTORY.test(directory)) {
          await fs.promises.rm(runtimeRoot, { recursive: true, force: true }).catch(() => {});
        }
        throw error;
      }
    });
  }
  function rollback() {
    return begin(async signal => {
      assertStopped();
      if (!canRollback) throw new Error('目前没有可恢复的 Harness 引擎。');
      throwIfAborted(signal);
      resolveDescriptor(previous);
      publish({ state: 'installing', busy: true, message: '正在恢复上次的 Harness 引擎…' });
      await writeState(previous, active, true);
      [active, previous] = [previous, active];
      publish({ state: 'ready', busy: false, message: '已恢复上次的 Harness 引擎，下次打开工作区时生效。' });
      return getStatus();
    });
  }
  async function cancel() {
    if (!operation) return getStatus();
    const pending = operation;
    pending.controller.abort();
    await pending.promise.catch(() => {});
    return getStatus();
  }
  async function shutdown() { shuttingDown = true; await cancel(); }
  return { initialize, getRuntime, getStatus, check, update, rollback, cancel, shutdown };
}

module.exports = { createHarnessUpdater, selectLatestRelease, npmEnvironment, runProcess };
