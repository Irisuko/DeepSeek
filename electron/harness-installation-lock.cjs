'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const net = require('node:net');

/**
 * One process owns an installed Harness runtime for its entire lifetime.
 * Windows named pipes disappear when their process exits, including a crash,
 * so this lock has no stale PID files or unsafe stale-file deletion race.
 */
async function acquireInstallationLock(runtimeRoot) {
  if (process.platform !== 'win32') {
    throw new Error('此 Harness 安装目录锁仅支持 Windows。');
  }
  const canonicalRoot = fs.realpathSync.native(runtimeRoot).toLowerCase();
  const key = crypto.createHash('sha256').update(canonicalRoot).digest('hex');
  const address = `\\\\.\\pipe\\deepseek-harness-installation-${key}`;
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    const onError = error => {
      if (error.code === 'EADDRINUSE') {
        const occupied = new Error('此安装目录的 DeepSeek 已在另一个用户配置中运行，请先退出该应用后重试。');
        occupied.code = 'HARNESS_INSTALLATION_IN_USE';
        reject(occupied);
      } else reject(error);
    };
    server.once('error', onError);
    server.listen(address, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
  // App shutdown controls its lifetime; an otherwise finished process may exit.
  server.unref();
  let releasePromise;
  return {
    release() {
      releasePromise ||= new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      return releasePromise;
    },
  };
}

module.exports = { acquireInstallationLock };
