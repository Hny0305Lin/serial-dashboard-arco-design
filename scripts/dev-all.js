const { spawn, execSync } = require('child_process');
const path = require('node:path');
const os = require('node:os');
const { acquireInstanceLock } = require('./instance-lock');
const { normalizePort, isPortFree, findFreePort } = require('./port-guard');

const EXIT_PORT_IN_USE = 110;

function getDefaultLockPath() {
  return path.join(os.tmpdir(), 'serialport-devall.lock');
}

function findListenerPids(port) {
  if (process.platform === 'win32') {
    try {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const lines = out.split(/\r?\n/);
      const pids = new Set();
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        if (!s.includes(`:${port}`)) continue;
        if (!s.toUpperCase().includes('LISTENING')) continue;
        const parts = s.split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid) pids.add(pid);
      }
      return [...pids];
    } catch (e) {
      return [];
    }
  }
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: 'utf8' });
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function killProcessTree(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${n} /T /F`, { stdio: 'ignore' });
    } catch (e) { }
    return;
  }
  try {
    process.kill(n, 'SIGTERM');
  } catch (e) { }
  try {
    execSync(`pkill -TERM -P ${n}`, { stdio: 'ignore' });
  } catch (e) { }
}

function run(name, command, args, extraEnv) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(extraEnv || {}) },
  });
  child.on('exit', (code, signal) => {
    if (signal) console.log(`[dev:all] ${name} exited with signal ${signal}`);
    else console.log(`[dev:all] ${name} exited with code ${code}`);
  });
  return child;
}

async function main() {
  const lockFilePath = String(process.env.DEVALL_LOCK_PATH || '').trim() || getDefaultLockPath();
  let lock;
  try {
    lock = acquireInstanceLock(lockFilePath);
  } catch (e) {
    if (e && e.code === 'ELOCKED') {
      console.error(`[dev:all] Another dev:all instance is running (pid=${e.lockedPid}).`);
      process.exit(EXIT_PORT_IN_USE);
    }
    throw e;
  }

  const portMode = String(process.env.DEVALL_PORT_MODE || 'strict').trim();
  const requestedBackendPort = normalizePort(process.env.BACKEND_PORT || process.env.PORT, 9011);
  const requestedWebPort = normalizePort(process.env.WEB_PORT, 9010);

  let backendPort = requestedBackendPort;
  let webPort = requestedWebPort;

  if (portMode === 'increment') {
    backendPort = await findFreePort(requestedBackendPort, { maxTries: 50 });
    webPort = await findFreePort(requestedWebPort, { maxTries: 50 });
  } else {
    const backendOk = await isPortFree(backendPort);
    const webOk = await isPortFree(webPort);
    if (!backendOk || !webOk) {
      if (!backendOk) {
        const pids = findListenerPids(backendPort);
        console.error(`[dev:all] Backend port in use: ${backendPort}${pids.length ? ` (pid=${pids.join(',')})` : ''}`);
      }
      if (!webOk) {
        const pids = findListenerPids(webPort);
        console.error(`[dev:all] Web port in use: ${webPort}${pids.length ? ` (pid=${pids.join(',')})` : ''}`);
      }
      lock.release();
      process.exit(EXIT_PORT_IN_USE);
    }
  }

  if (String(process.env.DEVALL_DRY_RUN || '').trim() === '1') {
    console.log(`[dev:all] DRY_RUN ok. BACKEND_PORT=${backendPort} WEB_PORT=${webPort}`);
    lock.release();
    process.exit(0);
  }

  let shuttingDown = false;
  let backend;
  let web;

  function shutdown(exitCode) {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      if (backend?.pid) killProcessTree(backend.pid);
    } catch (e) { }
    try {
      if (web?.pid) killProcessTree(web.pid);
    } catch (e) { }
    try {
      lock.release();
    } catch (e) { }
    if (typeof exitCode === 'number') process.exit(exitCode);
  }

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  backend = run('backend', 'pnpm', ['dev'], {
    PORT: String(backendPort),
    BACKEND_PORT: String(backendPort),
  });

  web = run('web', 'pnpm', ['-C', 'web', 'dev', '--', '--port', String(webPort)], {
    WEB_PORT: String(webPort),
    BACKEND_PORT: String(backendPort),
    PUBLIC_BACKEND_PORT: String(backendPort),
  });

  backend.on('exit', () => shutdown(0));
  web.on('exit', () => shutdown(0));
}

main().catch((e) => {
  console.error('[dev:all] fatal:', e);
  process.exit(1);
});
