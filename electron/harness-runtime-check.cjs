'use strict';
// Keyless packaging smoke. Runs only fixed local test programs in a scratch
// directory; it does not start an agent or send a model request.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const runtimeRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../runtime');
const requireRuntime = createRequire(path.join(runtimeRoot, 'package.json'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-runtime-smoke-'));

async function deadline(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded 20 seconds`)), 20_000);
    })]);
  } finally { clearTimeout(timer); }
}

async function main() {
  assert(process.argv[3] && path.isAbsolute(process.argv[3]), 'Pass the trusted runtime Node path');
  assert.equal(fs.realpathSync(process.execPath).toLowerCase(), fs.realpathSync(process.argv[3]).toLowerCase(), 'Use the trusted bundled Node executable');
  const koffi = requireRuntime('koffi');
  const library = koffi.load(process.platform === 'win32' ? 'kernel32.dll' : null);
  try {
    const getPid = library.func(process.platform === 'win32' ? 'uint32_t __stdcall GetCurrentProcessId(void)' : 'int getpid(void)');
    assert.equal(getPid(), process.pid);
  } finally { library.unload(); }
  console.log('PASS: Koffi native FFI');

  const sharp = requireRuntime('sharp');
  const pixel = Buffer.from([17, 103, 231]);
  const png = await sharp(pixel, { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
  const decoded = await sharp(png).raw().toBuffer();
  assert.deepEqual(decoded, pixel);
  console.log('PASS: Sharp native image codec');

  const { Context } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/cordis')).href);
  const { LocalSubprocessRuntime } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-subprocess-local')).href);
  const ctx = new Context();
  const fiber = await ctx.plugin(LocalSubprocessRuntime);
  try {
    const child = ctx.subprocess.spawn({
      argv: [process.execPath, '-e', 'process.stdout.write("harness-subprocess-ok")'],
      cwd: scratch, stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } }, graceMs: 200,
    });
    try {
      const outcome = await deadline(child.done, 'Harness subprocess');
      assert.equal(outcome.exitCode, 0);
      assert.equal(child.collected.stdout.readFrom(0).text, 'harness-subprocess-ok');
      await deadline(child.waitForExit(), 'Harness subprocess cleanup');
    } finally { child.terminate(); }
  } finally { await fiber.dispose(); }
  console.log('PASS: Harness local subprocess execution and cleanup');

  const pty = requireRuntime('node-pty');
  const terminal = pty.spawn(process.execPath, ['-e', 'process.stdout.write("harness-pty-ok\\r\\n")'], {
    cwd: scratch, env: { ...process.env }, cols: 80, rows: 24,
  });
  let output = '';
  const subscription = terminal.onData(chunk => { output += chunk; });
  try {
    const outcome = await deadline(new Promise(resolve => terminal.onExit(resolve)), 'ConPTY');
    assert.equal(outcome.exitCode, 0);
    assert.match(output, /harness-pty-ok/);
  } finally {
    subscription.dispose();
    terminal.kill();
  }
  console.log('PASS: node-pty / ConPTY execution and cleanup');
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  // This exact mkdtemp child is owned by this smoke; never resolve user paths.
  if (path.dirname(scratch) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('deepseek-runtime-smoke-')) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
