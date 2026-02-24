import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PortManager } from '../core/PortManager';
import { ForwardingService } from '../services/ForwardingService';

async function main() {
  const received: { ts: number }[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/ingest') {
      req.on('data', () => undefined);
      req.on('end', () => {
        received.push({ ts: Date.now() });
        res.statusCode = 204;
        res.end();
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as any;
  const port = addr.port as number;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-perf-'));
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
        retryMaxAttempts: 5,
        retryBaseDelayMs: 200,
        dedupWindowMs: 0
      }
    ],
    store: { dataDir: tmp, maxMemoryRecords: 2000, maxRecordBytes: 64 * 1024 }
  } as any);

  const hz = 10;
  const durationMs = 20_000;
  const periodMs = Math.floor(1000 / hz);
  const startWall = Date.now();
  const startCpu = process.cpuUsage();

  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    const temp = (20 + (tick % 10) * 0.1).toFixed(1);
    pm.emit('data', { path: 'COM3', data: Buffer.from(`DEV001,TEMP,${temp}\n`, 'utf8') });
  }, periodMs);

  await new Promise(r => setTimeout(r, durationMs));
  clearInterval(timer);
  for (let i = 0; i < 80; i++) {
    const m = svc.getMetricsSnapshot().channels.find(x => x.channelId === 'http1');
    if ((m?.queueLength || 0) === 0) break;
    await new Promise(r => setTimeout(r, 100));
  }

  const endWall = Date.now();
  const cpu = process.cpuUsage(startCpu);
  const cpuUs = cpu.user + cpu.system;
  const elapsedMs = endWall - startWall;
  const cpuPercentOneCore = (cpuUs / 1000) / Math.max(1, elapsedMs) * 100;
  const rssMb = process.memoryUsage().rss / (1024 * 1024);
  const m = svc.getMetricsSnapshot().channels.find(x => x.channelId === 'http1');
  const avgLatencyMs = m?.avgLatencyMs ?? null;

  const summary = {
    hz,
    durationMs,
    framesSent: tick,
    batchesReceived: received.length,
    cpuPercentOneCore: Number(cpuPercentOneCore.toFixed(2)),
    rssMb: Number(rssMb.toFixed(2)),
    avgLatencyMs: avgLatencyMs != null ? Number(avgLatencyMs.toFixed(2)) : null
  };

  console.log(JSON.stringify(summary, null, 2));

  await svc.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });

  const okCpu = cpuPercentOneCore < 20;
  const okMem = rssMb < 100;
  const okLatency = typeof avgLatencyMs === 'number' ? avgLatencyMs < 200 : true;
  if (!okCpu || !okMem || !okLatency) {
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
