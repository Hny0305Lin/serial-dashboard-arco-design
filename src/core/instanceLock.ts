import fs from 'fs';
import path from 'path';

export function isPidAlive(pid: unknown): boolean {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function readLockFile(lockFilePath: string): unknown {
  try {
    const raw = fs.readFileSync(lockFilePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function acquireInstanceLock(lockFilePath: string): { release: () => void } {
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
  } catch (e: any) {
    if (e && e.code === 'EEXIST') {
      const data: any = readLockFile(lockFilePath);
      const lockedPid = data?.pid;
      if (isPidAlive(lockedPid)) {
        const err: any = new Error(`LOCKED_BY_PID:${lockedPid}`);
        err.code = 'ELOCKED';
        err.lockedPid = lockedPid;
        err.lockFilePath = lockFilePath;
        throw err;
      }
      try {
        fs.unlinkSync(lockFilePath);
      } catch {}
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
    } catch {}
  };

  process.once('exit', release);

  return { release };
}
