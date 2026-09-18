'use strict';

// Prepare the pinned npm CLI used by in-app Harness updates. Its licenses and
// dependencies stay together in runtime/npm and are included by the packager.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const tar = require('tar');
const version = '12.0.2';
const root = path.resolve(__dirname, '..', 'runtime');

async function main() {
  await fs.mkdir(root, { recursive: true });
  const destination = path.join(root, 'npm');
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(destination, 'package.json'), 'utf8'));
    await fs.access(path.join(destination, 'bin/npm-cli.js'));
    await fs.access(path.join(destination, 'node_modules/semver/package.json'));
    if (manifest.name === 'npm' && manifest.version === version) { console.log('Harness updater tooling is ready.'); return; }
  } catch { /* Prepare a fresh verified copy below. */ }
  const response = await fetch(`https://registry.npmjs.org/npm/${version}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Unable to read official npm metadata.');
  const metadata = await response.json();
  const url = new URL(metadata.dist?.tarball);
  if (metadata.name !== 'npm' || metadata.version !== version || url.origin !== 'https://registry.npmjs.org' || !/^sha512-[A-Za-z0-9+/=]+$/.test(metadata.dist?.integrity || '')) throw new Error('Invalid updater tooling metadata.');
  const archiveResponse = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!archiveResponse.ok) throw new Error('Unable to download official npm tooling.');
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  if (archive.length > 20 * 1024 * 1024) throw new Error('Unexpected updater tooling archive size.');
  const integrity = 'sha512-' + crypto.createHash('sha512').update(archive).digest('base64');
  if (integrity !== metadata.dist.integrity) throw new Error('Updater tooling checksum verification failed.');
  const stage = await fs.mkdtemp(path.join(root, '.npm-setup-'));
  try {
    const archivePath = path.join(stage, 'npm.tgz');
    const unpacked = path.join(stage, 'package');
    await fs.mkdir(unpacked);
    await fs.writeFile(archivePath, archive);
    await tar.x({ file: archivePath, cwd: unpacked, strip: 1, strict: true, preservePaths: false, filter: (name, entry) => {
      if (!name.startsWith('package/') || name.split('/').includes('..') || name.includes('\\') || name.includes(':') || !['File', 'Directory'].includes(entry.type)) throw new Error('Unsafe updater tooling archive entry.');
      return true;
    } });
    const manifest = JSON.parse(await fs.readFile(path.join(unpacked, 'package.json'), 'utf8'));
    if (manifest.name !== 'npm' || manifest.version !== version) throw new Error('Unexpected updater tooling package.');
    // Only replace this explicitly named generated directory under runtime.
    if (path.dirname(destination) !== root || path.basename(destination) !== 'npm') throw new Error('Invalid tooling destination.');
    await fs.rm(destination, { recursive: true, force: true });
    await fs.rename(unpacked, destination);
    console.log('Verified Harness updater tooling installed.');
  } finally {
    if (path.dirname(stage) === root && path.basename(stage).startsWith('.npm-setup-')) await fs.rm(stage, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
