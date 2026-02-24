import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PortManager } from '../../core/PortManager';
import { ForwardingService } from '../../services/ForwardingService';

test('ForwardingService forwards frames to Feishu webhook format over HTTP', async () => {
  const received: any[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/hook') {
      const chunks: Buffer[] = [];
      req.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
      req.on('end', () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        res.statusCode = 200;
        res.end(JSON.stringify({ code: 0, msg: 'ok' }));
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

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-feishu-'));
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
        id: 'feishu1',
        name: 'feishu1',
        enabled: true,
        type: 'http',
        http: { url: `http://127.0.0.1:${port}/hook`, method: 'POST', timeoutMs: 2000, headers: {} },
        payloadFormat: 'feishu',
        compression: 'gzip',
        encryption: 'aes-256-gcm',
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

  const headers = received[0].headers || {};
  assert.ok(String(headers['content-type'] || '').includes('application/json'));
  const body = JSON.parse(received[0].body);
  assert.equal(body.msg_type, 'text');
  assert.ok(String(body?.content?.text || '').includes('DEV001'));
  assert.ok(String(body?.content?.text || '').includes('23.5'));

  await svc.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
});

