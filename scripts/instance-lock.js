const fs = require('node:fs');
const path = require('node:path');

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function readLockFile(lockFilePath) {
  try {
    const raw = fs.readFileSync(lockFilePath, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    return null;
  }
}

function acquireInstanceLock(lockFilePath) {
  fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
  try {
    const fd = fs.openSync(lockFilePath, 'wx');
    try {
      fs.writeFileSync(
        fd,
        JSON.stringify(
          {
            pid: process.pid,
            createdAt: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf8'
      );
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      const data = readLockFile(lockFilePath);
      const lockedPid = data?.pid;
      if (isPidAlive(lockedPid)) {
        const err = new Error(`LOCKED_BY_PID:${lockedPid}`);
        err.code = 'ELOCKED';
        err.lockedPid = lockedPid;
        err.lockFilePath = lockFilePath;
        throw err;
      }
      try {
        fs.unlinkSync(lockFilePath);
      } catch (e2) {}
      return acquireInstanceLock(lockFilePath);
    }
    throw e;
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      fs.unlinkSync(lockFilePath);
    } catch (e) {}
  };

  const cleanup = () => release();
  process.once('exit', cleanup);
  process.once('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  return { release };
}

module.exports = {
  acquireInstanceLock,
  isPidAlive,
};
