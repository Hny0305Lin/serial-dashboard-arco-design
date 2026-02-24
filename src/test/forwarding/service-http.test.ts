import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PortManager } from '../../core/PortManager';
import { ForwardingService } from '../../services/ForwardingService';

test('ForwardingService forwards frames to HTTP', async () => {
  const received: any[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/ingest') {
      const chunks: Buffer[] = [];
      req.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
      req.on('end', () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
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

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-'));
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
        framing: { mode: 'line', lineDelimiter: 'lf', maxFrameBytes: 2048 },
        parse: { mode: 'text-regex', regex: '(?<deviceId>[^,]+),(?<dataType>[^,]+),(?<payload>.*)' }
      }
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
        flushIntervalMs: 200,
        batchSize: 1,
        retryMaxAttempts: 3,
        retryBaseDelayMs: 200,
        dedupWindowMs: 0
      } as any
    ],
    store: { dataDir: tmp, maxMemoryRecords: 1000, maxRecordBytes: 64 * 1024 }
  } as any);

  pm.emit('data', { path: 'COM3', data: Buffer.from('DEV001,TEMP,23.5\n', 'utf8') });

  await new Promise(r => setTimeout(r, 800));
  assert.ok(received.length >= 1);
  const body = received[0].body;
  assert.ok(body.includes('"deviceId":"DEV001"'));

  await svc.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
});
