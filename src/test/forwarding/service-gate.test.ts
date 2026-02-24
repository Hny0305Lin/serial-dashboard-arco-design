import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PortManager } from '../../core/PortManager';
import { ForwardingService } from '../../services/ForwardingService';

test('ForwardingService starts forwarding only after gate text appears', async () => {
  const received: any[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/ingest') {
      const chunks: Buffer[] = [];
      req.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
      req.on('end', () => {
        received.push(Buffer.concat(chunks).toString('utf8'));
        res.statusCode = 204;
        res.end();
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const port = (addr as any).port as number;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-gate-'));
  const pm = new PortManager();
  const svc = new ForwardingService({
    portManager: pm,
    configPath: path.join(tmp, 'forwarding.config.json'),
    dataDir: tmp
  });
  await svc.init();
  await svc.setConfig({
    version: 1,
    enabled: true,
    sources: [
      {
        enabled: true,
        portPath: 'COM3',
        startOnText: 'user.smsCallback',
        includeStartLine: false,
        framing: { mode: 'line', lineDelimiter: 'lf', maxFrameBytes: 2048 },
        parse: { mode: 'text-regex', regex: '(?<deviceId>[^,]+),(?<dataType>[^,]+),(?<payload>.*)' }
      } as any
    ],
    channels: [
      {
        id: 'http1',
        name: 'http1',
        enabled: true,
        type: 'http',
        http: { url: `http://127.0.0.1:${port}/ingest`, method: 'POST', timeoutMs: 2000, headers: {} },
        payloadFormat: 'json',
        compression: 'none',
        encryption: 'none',
        flushIntervalMs: 100,
        batchSize: 1,
        retryMaxAttempts: 3,
        retryBaseDelayMs: 50,
        dedupWindowMs: 0
      } as any
    ],
    store: { dataDir: tmp, maxMemoryRecords: 1000, maxRecordBytes: 64 * 1024 }
  } as any);

  pm.emit('data', { path: 'COM3', data: Buffer.from('DEV000,TEMP,10\n', 'utf8') });
  await new Promise(r => setTimeout(r, 250));
  assert.equal(received.length, 0);

  pm.emit('data', { path: 'COM3', data: Buffer.from('user.smsCallback\n', 'utf8') });
  await new Promise(r => setTimeout(r, 250));
  assert.equal(received.length, 0);

  pm.emit('data', { path: 'COM3', data: Buffer.from('DEV001,TEMP,23.5\n', 'utf8') });
  await new Promise(r => setTimeout(r, 400));
  assert.ok(received.length >= 1);
  assert.ok(received[0].includes('DEV001'));

  await svc.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
});

test('ForwardingService forwards only the gate line when startMode=only', async () => {
  const received: any[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/ingest') {
      const chunks: Buffer[] = [];
      req.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
      req.on('end', () => {
        received.push(Buffer.concat(chunks).toString('utf8'));
        res.statusCode = 204;
        res.end();
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const port = (addr as any).port as number;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-gate-only-'));
  const pm = new PortManager();
  const svc = new ForwardingService({
    portManager: pm,
    configPath: path.join(tmp, 'forwarding.config.json'),
    dataDir: tmp
  });
  await svc.init();
  await svc.setConfig({
    version: 1,
    enabled: true,
    sources: [
      {
        enabled: true,
        portPath: 'COM3',
        startOnText: 'user.smsCallback',
        startMode: 'only',
        framing: { mode: 'line', lineDelimiter: 'lf', maxFrameBytes: 2048 },
        parse: { mode: 'text-regex', regex: '(?<deviceId>[^,]+),(?<dataType>[^,]+),(?<payload>.*)' }
      } as any
    ],
    channels: [
      {
        id: 'http1',
        name: 'http1',
        enabled: true,
        type: 'http',
        http: { url: `http://127.0.0.1:${port}/ingest`, method: 'POST', timeoutMs: 2000, headers: {} },
        payloadFormat: 'json',
        compression: 'none',
        encryption: 'none',
        flushIntervalMs: 100,
        batchSize: 1,
        retryMaxAttempts: 3,
        retryBaseDelayMs: 50,
        dedupWindowMs: 0
      } as any
    ],
    store: { dataDir: tmp, maxMemoryRecords: 1000, maxRecordBytes: 64 * 1024 }
  } as any);

  pm.emit('data', { path: 'COM3', data: Buffer.from('DEV000,TEMP,10\n', 'utf8') });
  pm.emit('data', { path: 'COM3', data: Buffer.from('user.util_forward\n', 'utf8') });
  pm.emit('data', { path: 'COM3', data: Buffer.from('user.smsCallback\n', 'utf8') });
  pm.emit('data', { path: 'COM3', data: Buffer.from('DEV001,TEMP,23.5\n', 'utf8') });

  await new Promise(r => setTimeout(r, 600));
  assert.equal(received.length, 1);
  assert.ok(received[0].includes('user.smsCallback'));
  assert.ok(!received[0].includes('user.util_forward'));
  assert.ok(!received[0].includes('DEV001'));

  await svc.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
});
