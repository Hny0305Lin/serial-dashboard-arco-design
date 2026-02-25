import path from 'path';
import crypto from 'crypto';
import { URL } from 'url';
import { PortManager } from '../core/PortManager';
import { FileQueue, FileQueueItem } from '../storage/FileQueue';
import { JsonFileStore } from '../storage/JsonFileStore';
import {
  ForwardingAlertConfig,
  ForwardingChannelConfig,
  ForwardingChannelMetrics,
  ForwardingConfigV1,
  ForwardingMetricsSnapshot,
  ForwardingOutboundBatch,
  ForwardingRecord
} from '../types/forwarding';
import { extractFrames, parseFrameToRecord, sha256Hex } from './forwarding/frame';
import { buildOutboundPayload } from './forwarding/payload';
import { createChannelSender } from './forwarding/channels';
import { ChannelSender } from './forwarding/channels/ChannelSender';
import { RecordStore } from './forwarding/RecordStore';
import { HttpSender } from './forwarding/channels/HttpSender';

type LogLevel = 'info' | 'warn' | 'error';

export class ForwardingService {
  private portManager: PortManager;
  private store: JsonFileStore<ForwardingConfigV1>;
  private config: ForwardingConfigV1;
  private recordStore: RecordStore;
  private sourceBuffers: Map<string, Buffer> = new Map();
  private channelQueues: Map<string, FileQueue<ForwardingOutboundBatch>> = new Map();
  private channelSenders: Map<string, ChannelSender> = new Map();
  private channelSenderKeyById: Map<string, string> = new Map();
  private channelMetrics: Map<string, ForwardingChannelMetrics> = new Map();
  private channelBatchBuffers: Map<string, ForwardingRecord[]> = new Map();
  private channelFlushTimers: Map<string, NodeJS.Timeout> = new Map();
  private channelWorkTimers: Map<string, NodeJS.Timeout> = new Map();
  private channelWorking: Set<string> = new Set();
  private channelDedup: Map<string, Map<string, number>> = new Map();
  private sourceGateActiveByPath: Map<string, boolean> = new Map();
  private logs: { ts: number; level: LogLevel; msg: string }[] = [];
  private metricsListeners: Set<(m: ForwardingMetricsSnapshot) => void> = new Set();
  private alertListeners: Set<(a: any) => void> = new Set();
  private lastAlertAtByKey: Map<string, number> = new Map();

  constructor(opts: { portManager: PortManager; configPath: string; dataDir: string }) {
    this.portManager = opts.portManager;
    this.store = new JsonFileStore<ForwardingConfigV1>(opts.configPath);
    this.config = this.defaultConfig(opts.dataDir);
    this.recordStore = new RecordStore({
      dir: path.join(opts.dataDir, 'records'),
      maxMemoryRecords: 2000,
      maxRecordBytes: 64 * 1024
    });
  }

  private defaultConfig(dataDir: string): ForwardingConfigV1 {
    return {
      version: 1,
      enabled: false,
      sources: [],
      channels: [],
      store: { maxMemoryRecords: 2000, dataDir, maxRecordBytes: 64 * 1024 },
      alert: { enabled: true, queueLengthWarn: 2000, failureRateWarn: 0.2 }
    };
  }

  public async init(): Promise<void> {
    const loaded = await this.store.read(this.config);
    this.applyConfig(loaded);
    this.bindPortManager();
  }

  private senderKeyForChannel(ch: ForwardingChannelConfig): string {
    const type = String((ch as any)?.type || '').trim();
    if (type === 'http') {
      const url = String((ch as any)?.http?.url || '').trim();
      const method = String((ch as any)?.http?.method || 'POST').trim();
      const pf = String((ch as any)?.payloadFormat || '').trim();
      return `http|${pf}|${method}|${url}`;
    }
    if (type === 'websocket') {
      const url = String((ch as any)?.websocket?.url || '').trim();
      const pf = String((ch as any)?.payloadFormat || '').trim();
      const protos = Array.isArray((ch as any)?.websocket?.protocols) ? (ch as any).websocket.protocols.join(',') : '';
      return `websocket|${pf}|${url}|${protos}`;
    }
    if (type === 'tcp') {
      const host = String((ch as any)?.tcp?.host || '').trim();
      const port = Number((ch as any)?.tcp?.port || 0);
      const pf = String((ch as any)?.payloadFormat || '').trim();
      return `tcp|${pf}|${host}|${port}`;
    }
    if (type === 'mqtt') {
      const url = String((ch as any)?.mqtt?.url || '').trim();
      const topic = String((ch as any)?.mqtt?.topic || '').trim();
      const pf = String((ch as any)?.payloadFormat || '').trim();
      return `mqtt|${pf}|${url}|${topic}`;
    }
    return `unknown|${type}`;
  }

  private isFeishuHookUrl(raw?: string): boolean {
    const s = String(raw || '').trim();
    if (!s) return false;
    try {
      const u = new URL(s);
      return u.hostname === 'open.feishu.cn' && u.pathname.startsWith('/open-apis/bot/v2/hook/');
    } catch (e) {
      return false;
    }
  }

  private bindPortManager(): void {
    this.portManager.on('data', (event: any) => {
      const cfg = this.config;
      if (!cfg.enabled) return;
      const portPath = String(event.path || '');
      const data: Buffer = Buffer.isBuffer(event.data) ? event.data : Buffer.from(event.data);
      this.onRawData(portPath, data).catch(() => undefined);
    });
  }

  private log(level: LogLevel, msg: string): void {
    const entry = { ts: Date.now(), level, msg };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
  }

  public getRecentLogs(limit: number): { ts: number; level: LogLevel; msg: string }[] {
    const n = Math.max(0, Math.min(limit || 100, this.logs.length));
    return this.logs.slice(this.logs.length - n);
  }

  public getConfig(): ForwardingConfigV1 {
    return this.config;
  }

  public async setConfig(next: ForwardingConfigV1): Promise<void> {
    this.applyConfig(next);
    await this.store.write(this.config);
  }

  public async setEnabled(enabled: boolean): Promise<void> {
    const next = { ...this.config, enabled: !!enabled };
    await this.setConfig(next);
  }

  public async createChannel(input: { ownerWidgetId?: string; name?: string }): Promise<{ config: ForwardingConfigV1; channelId: string }> {
    const ownerWidgetId = String(input?.ownerWidgetId || '').trim() || undefined;
    const baseName = String(input?.name || '').trim() || '新渠道';

    const used = new Set(this.config.channels.map(c => String(c.id)).filter(Boolean));
    let channelId = '';
    while (true) {
      channelId = `ch-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      if (!used.has(channelId)) break;
    }

    const toRoman = (n: number): string => {
      const v = Math.max(1, Math.min(3999, Math.floor(n)));
      const map: Array<[number, string]> = [
        [1000, 'M'],
        [900, 'CM'],
        [500, 'D'],
        [400, 'CD'],
        [100, 'C'],
        [90, 'XC'],
        [50, 'L'],
        [40, 'XL'],
        [10, 'X'],
        [9, 'IX'],
        [5, 'V'],
        [4, 'IV'],
        [1, 'I']
      ];
      let x = v;
      let out = '';
      for (const [k, s] of map) {
        while (x >= k) {
          out += s;
          x -= k;
        }
      }
      return out;
    };
    const usedNames = new Set(
      this.config.channels
        .filter(c => String((c as any).ownerWidgetId || '') === String(ownerWidgetId || ''))
        .map(c => String(c.name || '').trim())
        .filter(Boolean)
    );
    let n = usedNames.size + 1;
    let name = `${baseName}-${toRoman(n)}`;
    while (usedNames.has(name)) {
      n += 1;
      name = `${baseName}-${toRoman(n)}`;
    }

    const next: ForwardingConfigV1 = {
      ...this.config,
      channels: [
        ...this.config.channels,
        {
          id: channelId,
          name,
          enabled: false,
          ownerWidgetId,
          type: 'http',
          http: { url: '', method: 'POST', timeoutMs: 3000, headers: {} },
          payloadFormat: 'feishu',
          compression: 'none',
          encryption: 'none',
          flushIntervalMs: 1000,
          batchSize: 1,
          retryMaxAttempts: 10,
          retryBaseDelayMs: 1000,
          dedupWindowMs: 0
        } as any
      ]
    };

    await this.setConfig(next);
    return { config: this.getConfig(), channelId };
  }

  public async removeChannelsByOwner(ownerWidgetId: string): Promise<{ config: ForwardingConfigV1; removed: number }> {
    const owner = String(ownerWidgetId || '').trim();
    if (!owner) return { config: this.getConfig(), removed: 0 };
    const before = Array.isArray(this.config.channels) ? this.config.channels : [];
    const nextChannels = before.filter(c => String((c as any)?.ownerWidgetId || '') !== owner);
    const removed = before.length - nextChannels.length;
    if (removed <= 0) return { config: this.getConfig(), removed: 0 };
    const next: ForwardingConfigV1 = { ...this.config, channels: nextChannels };
    await this.setConfig(next);
    return { config: this.getConfig(), removed };
  }

  private applyConfig(raw: ForwardingConfigV1): void {
    const dataDir = raw.store?.dataDir || this.config.store?.dataDir || path.join(process.cwd(), 'data');
    const normalizedChannels = (Array.isArray(raw.channels) ? raw.channels : [])
      .filter(c => c && typeof (c as any).id === 'string')
      .map((c: any) => {
        const next = { ...c };
        const t = String(next?.type || '').trim();
        if (t === 'http') {
          const http = next?.http && typeof next.http === 'object' ? { ...next.http } : {};
          if (typeof http.url === 'string') http.url = http.url.trim();
          if (this.isFeishuHookUrl(http.url)) next.payloadFormat = 'feishu';
          next.http = http;
        }
        return next;
      });
    const next: ForwardingConfigV1 = {
      version: 1,
      enabled: !!raw.enabled,
      sources: Array.isArray(raw.sources) ? raw.sources.filter(s => s && typeof s.portPath === 'string') : [],
      channels: normalizedChannels,
      store: {
        maxMemoryRecords: raw.store?.maxMemoryRecords || 2000,
        dataDir,
        maxRecordBytes: raw.store?.maxRecordBytes || 64 * 1024
      },
      alert: raw.alert ? { ...raw.alert } : { enabled: true, queueLengthWarn: 2000, failureRateWarn: 0.2 }
    };
    this.config = next;
    this.resetSourceGates();
    this.recordStore = new RecordStore({
      dir: path.join(dataDir, 'records'),
      maxMemoryRecords: next.store?.maxMemoryRecords || 2000,
      maxRecordBytes: next.store?.maxRecordBytes || 64 * 1024
    });
    this.reconcileChannels();
    this.emitMetrics();
  }

  private resetSourceGates(): void {
    this.sourceGateActiveByPath.clear();
    for (const s of this.config.sources) {
      const key = this.normalizePath(s.portPath);
      const gate = String((s as any).startOnText || '').trim();
      this.sourceGateActiveByPath.set(key, gate ? false : true);
    }
  }

  private reconcileChannels(): void {
    const dataDir = this.config.store?.dataDir || path.join(process.cwd(), 'data');
    const keep = new Set(this.config.channels.map(c => c.id));

    for (const [id, t] of this.channelFlushTimers.entries()) {
      if (!keep.has(id)) {
        clearInterval(t);
        this.channelFlushTimers.delete(id);
      }
    }
    for (const [id, t] of this.channelWorkTimers.entries()) {
      if (!keep.has(id)) {
        clearInterval(t);
        this.channelWorkTimers.delete(id);
      }
    }
    for (const [id, s] of this.channelSenders.entries()) {
      if (!keep.has(id)) {
        s.close().catch(() => undefined);
        this.channelSenders.delete(id);
        this.channelSenderKeyById.delete(id);
      }
    }
    for (const id of Array.from(this.channelQueues.keys())) {
      if (!keep.has(id)) this.channelQueues.delete(id);
    }
    for (const id of Array.from(this.channelBatchBuffers.keys())) {
      if (!keep.has(id)) this.channelBatchBuffers.delete(id);
    }
    for (const id of Array.from(this.channelDedup.keys())) {
      if (!keep.has(id)) this.channelDedup.delete(id);
    }
    for (const id of Array.from(this.channelMetrics.keys())) {
      if (!keep.has(id)) this.channelMetrics.delete(id);
    }

    for (const ch of this.config.channels) {
      const key = this.senderKeyForChannel(ch);
      const oldKey = this.channelSenderKeyById.get(ch.id);
      if (oldKey && oldKey !== key) {
        const existing = this.channelSenders.get(ch.id);
        if (existing) existing.close().catch(() => undefined);
        this.channelSenders.delete(ch.id);
        this.channelSenderKeyById.delete(ch.id);
      }
      if (!this.channelQueues.has(ch.id)) {
        const q = new FileQueue<ForwardingOutboundBatch>(path.join(dataDir, 'queues', ch.id));
        this.channelQueues.set(ch.id, q);
      }
      if (!this.channelBatchBuffers.has(ch.id)) this.channelBatchBuffers.set(ch.id, []);
      if (!this.channelDedup.has(ch.id)) this.channelDedup.set(ch.id, new Map());
      if (!this.channelMetrics.has(ch.id)) {
        this.channelMetrics.set(ch.id, {
          channelId: ch.id,
          enabled: !!ch.enabled,
          queueLength: 0,
          sent: 0,
          failed: 0,
          dropped: 0
        });
      }
      const flushInterval = Math.max(200, (ch.flushIntervalMs ?? 1000));
      if (!this.channelFlushTimers.has(ch.id)) {
        const t = setInterval(() => this.flushChannelBuffer(ch.id).catch(() => undefined), flushInterval);
        this.channelFlushTimers.set(ch.id, t);
      }
      if (!this.channelWorkTimers.has(ch.id)) {
        const t = setInterval(() => this.workChannelQueue(ch.id).catch(() => undefined), 50);
        this.channelWorkTimers.set(ch.id, t);
      }
    }
  }

  public getMetricsSnapshot(): ForwardingMetricsSnapshot {
    const channels: ForwardingChannelMetrics[] = this.config.channels.map(ch => {
      const m = this.channelMetrics.get(ch.id);
      return {
        channelId: ch.id,
        enabled: !!ch.enabled,
        queueLength: m?.queueLength || 0,
        sent: m?.sent || 0,
        failed: m?.failed || 0,
        dropped: m?.dropped || 0,
        lastError: m?.lastError,
        lastSuccessAt: m?.lastSuccessAt,
        lastLatencyMs: m?.lastLatencyMs,
        avgLatencyMs: m?.avgLatencyMs
      };
    });
    return { ts: Date.now(), enabled: this.config.enabled, channels };
  }

  public onMetrics(cb: (m: ForwardingMetricsSnapshot) => void): () => void {
    this.metricsListeners.add(cb);
    cb(this.getMetricsSnapshot());
    return () => this.metricsListeners.delete(cb);
  }

  public onAlert(cb: (a: any) => void): () => void {
    this.alertListeners.add(cb);
    return () => this.alertListeners.delete(cb);
  }

  private emitMetrics(): void {
    const snap = this.getMetricsSnapshot();
    for (const cb of this.metricsListeners) cb(snap);
    this.maybeAlert(snap).catch(() => undefined);
  }

  private async maybeAlert(snap: ForwardingMetricsSnapshot): Promise<void> {
    const alertCfg: ForwardingAlertConfig = this.config.alert || { enabled: false };
    if (!alertCfg.enabled) return;

    const now = Date.now();
    const queueWarn = Math.max(0, alertCfg.queueLengthWarn || 0);
    for (const ch of snap.channels) {
      if (queueWarn > 0 && ch.queueLength >= queueWarn) {
        const key = `queue:${ch.channelId}`;
        const last = this.lastAlertAtByKey.get(key) || 0;
        if (now - last < 60_000) continue;
        this.lastAlertAtByKey.set(key, now);
        const a = { type: 'queue', channelId: ch.channelId, queueLength: ch.queueLength, ts: now };
        for (const cb of this.alertListeners) cb(a);
        await this.tryAlertWebhook(a, alertCfg.webhookUrl);
      }
    }

    const rateWarn = alertCfg.failureRateWarn;
    if (typeof rateWarn === 'number' && rateWarn > 0) {
      for (const ch of snap.channels) {
        const total = ch.sent + ch.failed;
        if (total < 20) continue;
        const failureRate = ch.failed / Math.max(1, total);
        if (failureRate >= rateWarn) {
          const key = `failrate:${ch.channelId}`;
          const last = this.lastAlertAtByKey.get(key) || 0;
          if (now - last < 120_000) continue;
          this.lastAlertAtByKey.set(key, now);
          const a = { type: 'failureRate', channelId: ch.channelId, failureRate, ts: now };
          for (const cb of this.alertListeners) cb(a);
          await this.tryAlertWebhook(a, alertCfg.webhookUrl);
        }
      }
    }
  }

  private async tryAlertWebhook(payload: any, url?: string): Promise<void> {
    const u = (url || '').trim();
    if (!u) return;
    try {
      if (this.isFeishuHookUrl(u)) {
        const text = (() => {
          try {
            return JSON.stringify(payload);
          } catch (e) {
            return String(payload);
          }
        })();
        const body = Buffer.from(JSON.stringify({ msg_type: 'text', content: { text } }), 'utf8');
        const sender = new HttpSender({ url: u, method: 'POST', timeoutMs: 3000, headers: { 'content-type': 'application/json' } }, { validateJsonCode: true });
        await sender.send(body, { 'content-type': 'application/json; charset=utf-8' });
        return;
      }
      const sender = new HttpSender({ url: u, method: 'POST', timeoutMs: 3000, headers: { 'content-type': 'application/json' } });
      await sender.send(Buffer.from(JSON.stringify(payload), 'utf8'), { 'content-type': 'application/json; charset=utf-8' });
    } catch (e) {
    }
  }

  public getRecentRecords(limit: number): ForwardingRecord[] {
    return this.recordStore.getRecent(limit);
  }

  private normalizePath(p: string): string {
    return String(p || '').toLowerCase().replace(/^\\\\.\\/, '');
  }

  private async onRawData(portPath: string, chunk: Buffer): Promise<void> {
    const src = this.config.sources.find(s => s.enabled && this.normalizePath(s.portPath) === this.normalizePath(portPath));
    if (!src) return;
    const prev = this.sourceBuffers.get(src.portPath) || Buffer.alloc(0);
    const { frames, rest, droppedBytes } = extractFrames(prev, chunk, src.framing);
    this.sourceBuffers.set(src.portPath, rest);
    if (droppedBytes > 0) this.log('warn', `${src.portPath} framing dropped ${droppedBytes} bytes`);

    for (const frame of frames) {
      const gateText = String((src as any).startOnText || '').trim();
      const gateMode = String((src as any).startMode || '').trim() || 'after';
      const frameText = frame.toString('utf8');
      const gateHit = !!gateText && frameText.includes(gateText);
      if (gateText) {
        if (gateMode === 'only') {
          if (!gateHit) continue;
        } else {
          const key = this.normalizePath(src.portPath);
          const active = this.sourceGateActiveByPath.get(key) || false;
          if (!active) {
            if (gateHit) {
              this.sourceGateActiveByPath.set(key, true);
              const includeLine = (src as any).includeStartLine !== false;
              if (!includeLine) continue;
            } else {
              continue;
            }
          }
        }
      }
      let rec = parseFrameToRecord(frame, { portPath: src.portPath, parse: src.parse });
      if (!rec) {
        if (gateHit) {
          const ts = Date.now();
          rec = {
            id: `${ts}-${Math.random().toString(16).slice(2)}`,
            ts,
            portPath: src.portPath,
            payloadText: frameText,
            rawBytesBase64: frame.toString('base64'),
            hash: sha256Hex(frame)
          };
        } else {
          continue;
        }
      }
      if (gateHit) {
        rec = { ...rec, deviceId: undefined, dataType: undefined, payloadJson: undefined, payloadText: frameText };
      }
      try {
        await this.recordStore.append(rec);
      } catch (e) {
      }
      await this.dispatchRecord(rec);
    }
  }

  private matchChannelFilter(ch: ForwardingChannelConfig, rec: ForwardingRecord): boolean {
    const f = ch.filter;
    if (!f) return true;
    if (Array.isArray(f.portPaths) && f.portPaths.length) {
      const ok = f.portPaths.some(p => this.normalizePath(p) === this.normalizePath(rec.portPath));
      if (!ok) return false;
    }
    if (Array.isArray(f.deviceIds) && f.deviceIds.length) {
      if (!rec.deviceId) return false;
      if (!f.deviceIds.includes(rec.deviceId)) return false;
    }
    if (Array.isArray(f.types) && f.types.length) {
      if (!rec.dataType) return false;
      if (!f.types.includes(rec.dataType)) return false;
    }
    return true;
  }

  private dedupAccept(channelId: string, ch: ForwardingChannelConfig, rec: ForwardingRecord): boolean {
    const windowMs = Math.max(0, (ch.dedupWindowMs ?? 10_000));
    const maxEntries = Math.max(100, Math.min((ch.dedupMaxEntries ?? 10_000), 200_000));
    if (windowMs <= 0) return true;
    const map = this.channelDedup.get(channelId) || new Map<string, number>();
    this.channelDedup.set(channelId, map);
    const now = Date.now();
    const last = map.get(rec.hash);
    if (typeof last === 'number' && now - last <= windowMs) return false;
    map.set(rec.hash, now);
    if (map.size > maxEntries) {
      const entries = Array.from(map.entries()).sort((a, b) => a[1] - b[1]);
      const cut = Math.max(0, entries.length - maxEntries);
      for (let i = 0; i < cut; i++) map.delete(entries[i][0]);
    }
    const expireBefore = now - windowMs;
    for (const [k, ts] of map.entries()) {
      if (ts < expireBefore) map.delete(k);
    }
    return true;
  }

  private async dispatchRecord(rec: ForwardingRecord): Promise<void> {
    for (const ch of this.config.channels) {
      if (!ch.enabled) continue;
      if (!this.matchChannelFilter(ch, rec)) continue;
      if (!this.dedupAccept(ch.id, ch, rec)) {
        const m = this.channelMetrics.get(ch.id);
        if (m) m.dropped += 1;
        continue;
      }
      const buf = this.channelBatchBuffers.get(ch.id) || [];
      buf.push(rec);
      this.channelBatchBuffers.set(ch.id, buf);
      const batchSize = Math.max(1, (ch.batchSize ?? 20));
      if (buf.length >= batchSize) {
        await this.flushChannelBuffer(ch.id);
      }
    }
    this.emitMetrics();
  }

  private makeBatchId(channelId: string): string {
    const rnd = crypto.randomBytes(8).toString('hex');
    return `${Date.now()}-${channelId}-${rnd}`;
  }

  private async flushChannelBuffer(channelId: string): Promise<void> {
    const ch = this.config.channels.find(c => c.id === channelId);
    if (!ch || !ch.enabled) return;
    const buf = this.channelBatchBuffers.get(channelId);
    if (!buf || buf.length === 0) return;

    const batchSize = Math.max(1, (ch.batchSize ?? 20));
    const records = buf.splice(0, batchSize);
    this.channelBatchBuffers.set(channelId, buf);

    const q = this.channelQueues.get(channelId);
    if (!q) return;
    const batch: ForwardingOutboundBatch = {
      id: this.makeBatchId(channelId),
      channelId,
      createdAt: Date.now(),
      records,
      payloadFormat: ch.payloadFormat || 'json',
      compression: ch.compression || 'none',
      encryption: ch.encryption || 'none',
      encryptionKeyId: ch.encryptionKeyId
    };
    await q.enqueue(batch, { id: batch.id });
    const m = this.channelMetrics.get(channelId);
    if (m) m.queueLength = await q.size();
    this.emitMetrics();
  }

  private senderForChannel(ch: ForwardingChannelConfig): ChannelSender {
    const key = this.senderKeyForChannel(ch);
    const existing = this.channelSenders.get(ch.id);
    if (existing) {
      const oldKey = this.channelSenderKeyById.get(ch.id);
      if (!oldKey || oldKey === key) return existing;
      existing.close().catch(() => undefined);
      this.channelSenders.delete(ch.id);
      this.channelSenderKeyById.delete(ch.id);
    }
    const sender = createChannelSender(ch);
    this.channelSenders.set(ch.id, sender);
    this.channelSenderKeyById.set(ch.id, key);
    return sender;
  }

  private async workChannelQueue(channelId: string): Promise<void> {
    if (this.channelWorking.has(channelId)) return;
    this.channelWorking.add(channelId);
    try {
      const ch = this.config.channels.find(c => c.id === channelId);
      if (!ch || !ch.enabled || !this.config.enabled) return;
      const q = this.channelQueues.get(channelId);
      if (!q) return;
      const m = this.channelMetrics.get(channelId);
      if (m) m.queueLength = await q.size();
      const tickStart = Date.now();
      let processed = 0;
      while (processed < 20 && Date.now() - tickStart < 120) {
        const ready = await q.peekReady();
        if (m) m.queueLength = await q.size();
        if (!ready) break;

        const { filePath, item } = ready;
        const batch = (item as FileQueueItem<ForwardingOutboundBatch>).payload;
        if (!batch || batch.channelId !== channelId) {
          await q.ack(filePath);
          processed += 1;
          continue;
        }

        const maxAttempts = Math.max(0, (ch.retryMaxAttempts ?? 10));
        const baseDelay = Math.max(200, (ch.retryBaseDelayMs ?? 1000));
        const attempts = item.attempts || 0;
        if (maxAttempts > 0 && attempts >= maxAttempts) {
          await q.ack(filePath);
          if (m) {
            m.failed += 1;
            m.dropped += 1;
          }
          this.log('error', `channel ${channelId} drop batch ${batch.id} after ${attempts} attempts`);
          processed += 1;
          continue;
        }

        const built = buildOutboundPayload(batch, { xmlTemplate: ch.xmlTemplate });
        try {
          const sender = this.senderForChannel(ch);
          const res = await sender.send(built.body, built.headers, { idempotencyKey: batch.id });
          await q.ack(filePath);
          if (m) {
            m.sent += 1;
            m.lastSuccessAt = Date.now();
            m.lastLatencyMs = res.latencyMs;
            m.avgLatencyMs = typeof m.avgLatencyMs === 'number' ? (m.avgLatencyMs * 0.8 + res.latencyMs * 0.2) : res.latencyMs;
            m.lastError = undefined;
          }
        } catch (e: any) {
          const errMsg = e instanceof Error ? e.message : String(e);
          if (m) {
            m.failed += 1;
            m.lastError = errMsg;
          }
          const delay = Math.min(60_000, baseDelay * Math.pow(2, attempts));
          const nextAttemptAt = Date.now() + delay;
          await q.nack(filePath, item, nextAttemptAt);
          this.log('warn', `channel ${channelId} send failed: ${errMsg}`);
        }

        processed += 1;
        this.emitMetrics();
      }
      if (m) m.queueLength = await q.size();
    } finally {
      this.channelWorking.delete(channelId);
    }
  }

  public async shutdown(): Promise<void> {
    for (const t of this.channelFlushTimers.values()) clearInterval(t);
    for (const t of this.channelWorkTimers.values()) clearInterval(t);
    this.channelFlushTimers.clear();
    this.channelWorkTimers.clear();
    const closers = Array.from(this.channelSenders.values()).map(s => s.close().catch(() => undefined));
    this.channelSenders.clear();
    await Promise.all(closers);
  }
}
