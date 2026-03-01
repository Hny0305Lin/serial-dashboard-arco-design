import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { SerialPort } from 'serialport';
import WebSocket from 'ws';
import { decodeMixedBytes } from '../core/mixedEncoding';

type ApiPortsResponse = {
  data?: Array<{
    path?: string;
    manufacturer?: string;
    serialNumber?: string;
    pnpId?: string;
    locationId?: string;
    productId?: string;
    vendorId?: string;
    status?: string;
    lastError?: string;
  }>;
};

type NdjsonRecord = {
  ts?: number;
  portPath?: string;
  portSessionId?: string;
  seq?: number;
  rawBytesBase64?: string;
  payloadText?: string;
};

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function normalizePath(p: string): string {
  return String(p || '').toLowerCase().replace(/^\\\\.\\/, '');
}

function httpGetJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
  });
}

function safeNum(n: any): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmt(n: number | null): string {
  if (n == null) return '-';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

async function listPortsOs(targetPath: string): Promise<void> {
  const ports = await SerialPort.list();
  const normTarget = normalizePath(targetPath);
  const hit = ports.find(p => normalizePath(p.path || '') === normTarget);
  console.log('=== OS 端口识别 ===');
  if (!hit) {
    console.log(`未在 SerialPort.list() 中找到 ${targetPath}`);
    console.log(`当前可见端口数量: ${ports.length}`);
    return;
  }
  console.log(`端口: ${hit.path}`);
  console.log(`manufacturer: ${hit.manufacturer || ''}`);
  console.log(`serialNumber: ${hit.serialNumber || ''}`);
  console.log(`pnpId: ${hit.pnpId || ''}`);
  console.log(`vendorId: ${hit.vendorId || ''}`);
  console.log(`productId: ${hit.productId || ''}`);
  console.log(`locationId: ${hit.locationId || ''}`);
}

async function fetchServerPorts(serverBase: string, targetPath: string): Promise<{ status: string; lastError?: string } | null> {
  const url = `${serverBase.replace(/\/$/, '')}/api/ports`;
  const data = (await httpGetJson(url)) as ApiPortsResponse;
  const normTarget = normalizePath(targetPath);
  const hit = (data.data || []).find(p => normalizePath(p.path || '') === normTarget);
  console.log('=== 后端识别/占用（/api/ports） ===');
  if (!hit) {
    console.log(`后端 /api/ports 未返回 ${targetPath}（可能被过滤/未识别/服务未连接设备）`);
    return null;
  }
  console.log(`path: ${hit.path}`);
  console.log(`status: ${hit.status || ''}`);
  if (hit.lastError) console.log(`lastError: ${hit.lastError}`);
  return { status: String(hit.status || ''), lastError: hit.lastError };
}

async function probeExclusiveOpen(targetPath: string, baudRate: number): Promise<void> {
  console.log('=== 独占占用探测（直接 open/close） ===');
  const port = new SerialPort({ path: targetPath, baudRate, autoOpen: false });
  const openResult = await new Promise<{ ok: boolean; err?: any }>((resolve) => {
    port.open((err) => resolve({ ok: !err, err }));
  });
  if (!openResult.ok) {
    console.log(`open 失败: ${String(openResult.err?.message || openResult.err || 'unknown')}`);
    try { (port as any).destroy?.(); } catch { }
    return;
  }
  console.log('open 成功：说明当前没有其他进程独占该 COM 口（或驱动允许共享）。');
  await new Promise<void>((resolve) => {
    port.close(() => resolve());
  });
  try { (port as any).destroy?.(); } catch { }
  console.log('close 完成。');
}

function findLatestRecordsFile(dataDir: string): string | null {
  try {
    const recDir = path.join(dataDir, 'records');
    const files = fs.readdirSync(recDir).filter(f => f.endsWith('.ndjson'));
    const full = files.map(f => path.join(recDir, f));
    full.sort((a, b) => {
      const sa = fs.statSync(a).mtimeMs;
      const sb = fs.statSync(b).mtimeMs;
      return sb - sa;
    });
    return full[0] || null;
  } catch {
    return null;
  }
}

function analyzeNdjsonStability(filePath: string, targetPath: string): void {
  console.log('=== 历史记录稳定性（forwarding records） ===');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  const normTarget = normalizePath(targetPath);
  const recs: NdjsonRecord[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (normalizePath(obj.portPath || '') !== normTarget) continue;
      recs.push(obj);
    } catch {
    }
  }
  if (recs.length === 0) {
    console.log(`在 ${path.basename(filePath)} 中未找到 ${targetPath} 的记录。`);
    console.log('提示：records 只记录 forwarding 规则命中的帧，不代表全量串口数据。');
    return;
  }
  recs.sort((a, b) => (safeNum(a.ts) || 0) - (safeNum(b.ts) || 0));

  const gaps: number[] = [];
  let prevTs: number | null = null;
  const sessionChanges: number[] = [];
  let prevSess: string | null = null;
  let seqGaps = 0;
  let prevSeq: number | null = null;
  for (const r of recs) {
    const ts = safeNum(r.ts);
    if (ts != null && prevTs != null) gaps.push(ts - prevTs);
    if (ts != null) prevTs = ts;
    const sess = typeof r.portSessionId === 'string' ? r.portSessionId : null;
    if (prevSess != null && sess != null && sess !== prevSess) sessionChanges.push(ts || 0);
    if (sess != null) prevSess = sess;
    const seq = safeNum(r.seq);
    if (seq != null) {
      if (prevSeq != null && seq > prevSeq + 1) seqGaps += (seq - prevSeq - 1);
      prevSeq = seq;
    }
  }
  gaps.sort((a, b) => a - b);
  console.log(`records 文件: ${path.basename(filePath)}`);
  console.log(`记录条数: ${recs.length}`);
  console.log(`seq 缺口估计: ${seqGaps} (仅对同 session 且记录到的帧有效)`);
  console.log(`相邻记录间隔: p50=${fmtMs(percentile(gaps, 0.5))} p90=${fmtMs(percentile(gaps, 0.9))} p99=${fmtMs(percentile(gaps, 0.99))} max=${fmtMs(gaps.length ? gaps[gaps.length - 1] : null)}`);
}

async function monitorWs(serverWsUrl: string, targetPath: string, durationMs: number): Promise<void> {
  console.log('=== 实时监控（WS serial:data/serial:status） ===');
  const normTarget = normalizePath(targetPath);

  const stats = {
    dataMsgs: 0,
    bytes: 0,
    invalidBytes: 0,
    controlBytes: 0,
    binaryBytes: 0,
    statusChanges: 0,
    lastTs: 0,
    maxGapMs: 0,
    errors: new Set<string>()
  };

  await new Promise<void>((resolve) => {
    const ws = new WebSocket(serverWsUrl);
    const deadline = Date.now() + Math.max(1000, durationMs);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { }
    }, Math.max(1000, durationMs));

    ws.on('message', (data) => {
      let msg: any = null;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'serial:status' && normalizePath(msg.path || '') === normTarget) {
        stats.statusChanges += 1;
        if (msg.error) stats.errors.add(String(msg.error));
        return;
      }
      if (msg.type !== 'serial:data') return;
      if (normalizePath(msg.path || '') !== normTarget) return;
      const arr = msg?.data?.raw?.data;
      if (!Array.isArray(arr)) return;
      const buf = Buffer.from(arr);
      const now = Date.now();
      if (stats.lastTs) stats.maxGapMs = Math.max(stats.maxGapMs, now - stats.lastTs);
      stats.lastTs = now;
      stats.dataMsgs += 1;
      stats.bytes += buf.length;
      const dec = decodeMixedBytes(buf);
      stats.invalidBytes += dec.stats.invalidBytes;
      stats.controlBytes += dec.stats.controlBytes;
      stats.binaryBytes += dec.stats.binaryBytes;
    });

    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.on('close', done);
    ws.on('error', done);

    const tick = () => {
      if (Date.now() >= deadline) {
        try { ws.close(); } catch { }
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });

  const seconds = Math.max(0.001, durationMs / 1000);
  console.log(`监控时长: ${fmt(seconds)}s`);
  console.log(`data 消息数: ${stats.dataMsgs}`);
  console.log(`总字节数: ${stats.bytes} (${fmt(stats.bytes / seconds)} B/s)`);
  console.log(`最大消息间隔: ${fmtMs(stats.maxGapMs)}`);
  console.log(`解码异常(估计): invalidBytes=${stats.invalidBytes} controlBytes=${stats.controlBytes} binaryBytes=${stats.binaryBytes}`);
  if (stats.errors.size) console.log(`status errors: ${Array.from(stats.errors).slice(0, 10).join(' | ')}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const target = String(args.port || 'COM6');
  const serverBase = String(args.server || 'http://127.0.0.1:9011');
  const wsUrl = String(args.ws || 'ws://127.0.0.1:9011/ws');
  const durationMs = Number(args.durationMs || 10_000);
  const baudRate = Number(args.baudRate || 115200);
  const probeExclusive = args['probe-exclusive'] === true || String(args['probe-exclusive'] || '').trim() === '1';

  console.log(`目标端口: ${target}`);
  console.log(`server: ${serverBase}`);

  await listPortsOs(target);

  let serverStatus: { status: string; lastError?: string } | null = null;
  try {
    serverStatus = await fetchServerPorts(serverBase, target);
  } catch (e: any) {
    console.log('=== 后端识别/占用（/api/ports） ===');
    console.log(`请求失败: ${String(e?.message || e)}`);
  }

  if (probeExclusive) {
    const canProbe = !serverStatus || (serverStatus.status !== 'open' && serverStatus.status !== 'opening');
    if (!canProbe) {
      console.log('=== 独占占用探测 ===');
      console.log('跳过：后端当前已打开该端口，直接探测会干扰当前会话。');
    } else {
      await probeExclusiveOpen(target, baudRate);
    }
  }

  const latest = findLatestRecordsFile(path.join(process.cwd(), 'data'));
  if (latest) analyzeNdjsonStability(latest, target);
  else console.log('=== 历史记录稳定性 ===\n未找到 data/records/*.ndjson');

  await monitorWs(wsUrl, target, durationMs);

  console.log('=== 参数核对提示 ===');
  console.log('本项目打开串口默认: dataBits=8, stopBits=1, parity=none（除非前端显式选择）。');
  console.log('如出现大量乱码/控制字节/不可解释高位字节，优先核对: 波特率、校验位、流控、USB转串口驱动。');
  console.log('建议：先用 115200 8N1（Air780E 常见默认），再按设备手册调整。');
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  process.exitCode = 1;
});
