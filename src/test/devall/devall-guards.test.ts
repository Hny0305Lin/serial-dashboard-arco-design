import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

function repoRootFromTestDir() {
  return path.resolve(__dirname, '..', '..', '..');
}

function tmpFilePath(prefix: string) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(os.tmpdir(), `${prefix}-${id}.json`);
}

async function listenOnRandomPort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object' && typeof addr.port === 'number');
  return { server, port: addr.port };
}

test('dev:all exits 110 when lock exists and pid is alive', () => {
  const repoRoot = repoRootFromTestDir();
  const devAllPath = path.join(repoRoot, 'scripts', 'dev-all.js');
  const lockPath = tmpFilePath('devall-lock');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), 'utf8');

  const res = spawnSync(process.execPath, [devAllPath], {
    env: {
      ...process.env,
      DEVALL_LOCK_PATH: lockPath,
      DEVALL_DRY_RUN: '1',
    },
    encoding: 'utf8',
  });

  assert.equal(res.status, 110);
  assert.match(`${res.stderr}${res.stdout}`, /Another dev:all instance is running/i);
});

test('dev:all exits 110 when backend port is in use (strict)', async () => {
  const repoRoot = repoRootFromTestDir();
  const devAllPath = path.join(repoRoot, 'scripts', 'dev-all.js');
  const lockPath = tmpFilePath('devall-lock');

  const { server, port: backendPort } = await listenOnRandomPort();
  const { server: webProbe, port: webPort } = await listenOnRandomPort();
  await new Promise<void>((resolve) => webProbe.close(() => resolve()));

  const res = spawnSync(process.execPath, [devAllPath], {
    env: {
      ...process.env,
      DEVALL_LOCK_PATH: lockPath,
      DEVALL_DRY_RUN: '1',
      BACKEND_PORT: String(backendPort),
      WEB_PORT: String(webPort),
      DEVALL_PORT_MODE: 'strict',
    },
    encoding: 'utf8',
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));

  assert.equal(res.status, 110);
  assert.match(`${res.stderr}${res.stdout}`, /Backend port in use/i);
});

test('dev:all picks new ports when mode is increment', async () => {
  const repoRoot = repoRootFromTestDir();
  const devAllPath = path.join(repoRoot, 'scripts', 'dev-all.js');
  const lockPath = tmpFilePath('devall-lock');

  const { server, port: backendPort } = await listenOnRandomPort();
  const { server: webProbe, port: webPort } = await listenOnRandomPort();
  await new Promise<void>((resolve) => webProbe.close(() => resolve()));

  const res = spawnSync(process.execPath, [devAllPath], {
    env: {
      ...process.env,
      DEVALL_LOCK_PATH: lockPath,
      DEVALL_DRY_RUN: '1',
      BACKEND_PORT: String(backendPort),
      WEB_PORT: String(webPort),
      DEVALL_PORT_MODE: 'increment',
    },
    encoding: 'utf8',
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));

  assert.equal(res.status, 0);
  assert.match(`${res.stderr}${res.stdout}`, /DRY_RUN ok/i);
});
