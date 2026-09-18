'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runProcess } = require('./harness-updater.cjs');
const { createHarnessManager } = require('./harness-manager.cjs');

function aborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error('更新已取消。'), { name: 'AbortError' });
}

async function runSmoke(nodePath, script, runtimeRoot, signal) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH)$/i.test(key)) delete env[key];
  }
  await runProcess(nodePath, [script, runtimeRoot, nodePath], {
    cwd: runtimeRoot, env, signal, timeoutMs: 90_000,
  });
}

function createHarnessRuntimeValidator({ smokeScript }) {
  return async ({ runtimeRoot, nodePath, expectedVersion, signal }) => {
    aborted(signal);
    await runSmoke(nodePath, smokeScript, runtimeRoot, signal);
    aborted(signal);
    const tempRoot = path.resolve(os.tmpdir());
    const scratch = await fs.mkdtemp(path.join(tempRoot, 'deepseek-update-probe-'));
    const manager = createHarnessManager({ runtimeRoot, nodePath, expectedVersion, dataDir: path.join(scratch, 'profile') });
    const stop = () => { manager.stop().catch(() => {}); };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      aborted(signal);
      const result = await manager.start({ workspace: scratch });
      aborted(signal);
      const origin = new URL(result.url).origin;
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
      const first = await fetch(result.url, { redirect: 'manual', signal: requestSignal });
      const location = first.headers.get('location');
      const cookiePairs = first.headers.getSetCookie().map(cookie => cookie.split(';', 1)[0]);
      await first.body?.cancel();
      const target = location ? new URL(location, origin) : null;
      if (first.status !== 303 || !target || target.href !== origin + '/'
        || !cookiePairs.some(cookie => /^dsh-auth-[^=;\s]+=[^;\s]+$/.test(cookie))) {
        throw new Error('新引擎的本地认证协议不兼容，已保留原引擎。');
      }
      const anonymous = await fetch(origin, { redirect: 'manual', signal: requestSignal });
      await anonymous.body?.cancel();
      if (anonymous.status !== 401) throw new Error('新引擎未拒绝未认证访问，已保留原引擎。');
      const page = await fetch(origin, { headers: { Cookie: cookiePairs.join('; ') }, redirect: 'manual', signal: requestSignal });
      const contentType = page.headers.get('content-type') || '';
      await page.body?.cancel();
      if (page.status !== 200 || !contentType.includes('text/html')) throw new Error('新引擎的页面加载检查失败，已保留原引擎。');
      aborted(signal);
    } finally {
      signal?.removeEventListener('abort', stop);
      try { await manager.stop(); } catch (error) { error.processMayBeRunning = true; throw error; }
      if (path.dirname(scratch) === tempRoot && path.basename(scratch).startsWith('deepseek-update-probe-')) {
        await fs.rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      }
    }
  };
}

module.exports = { createHarnessRuntimeValidator };
