'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// Run against the copied runtime. This deliberately does not resolve modules
// from the development checkout, so omitted packaging dependencies fail builds.
module.exports = async function verifyPackage(context) {
  const runtimeRoot = path.join(context.appOutDir, 'resources', 'runtime');
  const nodePath = path.join(runtimeRoot, 'node.exe');
  for (const file of ['NODE-LICENSE.txt', 'node_modules/@deepseek-ai/dsh/lib/bin.js', 'npm/bin/npm-cli.js', 'npm/LICENSE', 'npm/node_modules/semver/package.json']) {
    if (!fs.existsSync(path.join(runtimeRoot, file))) throw new Error(`Packaged runtime is missing ${file}`);
  }
  const npmResult = spawnSync(nodePath, [path.join(runtimeRoot, 'npm/bin/npm-cli.js'), '--version'], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  if (npmResult.status !== 0) throw new Error('Packaged Harness updater tooling is incomplete');
  if (!fs.existsSync(path.join(context.appOutDir, 'resources/support/harness-runtime-check.cjs'))) throw new Error('Packaged Harness updater validator is missing');
  const result = spawnSync(nodePath, [path.join(__dirname, 'verify-runtime.cjs'), runtimeRoot], {
    windowsHide: true, encoding: 'utf8', timeout: 90000,
  });
  if (result.status !== 0) throw new Error(`Packaged runtime smoke failed: ${result.error?.message || result.stderr || result.stdout}`);
  process.stdout.write(result.stdout);
};
