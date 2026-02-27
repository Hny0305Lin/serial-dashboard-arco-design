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
type ForwardingLogEntry = {
  ts: number;
  level: LogLevel;
  msg: string;
  portPath?: string;
  channelId?: string;
  ownerWidgetId?: string;
};

export class ForwardingService {
  private portManager: PortManager;
  private store: JsonFileStore<ForwardingConfigV1>;
  private config: ForwardingConfigV1;
  private recordStore: RecordStore;
  private baseDataDir: string;
  private traceEnabled: boolean = String(process.env.FORWARDING_TRACE || '').trim() === '1';
  private sourceBuffers: Map<string, Buffer> = new Map();
  private channelQueues: Map<string, FileQueue<ForwardingOutboundBatch>> = new Map();
  private channelSenders: Map<string, ChannelSender> = new Map();
  private channelSenderKeyById: Map<string, string> = new Map();
  private channelMetrics: Map<string, ForwardingChannelMetrics> = new Map();
  private channelBatchBuffers: Map<string, ForwardingRecord[]> = new Map();
  private channelFlushTimers: Map<string, NodeJS.Timeout> = new Map();
  private channelFlushSoonTimers: Map<string, NodeJS.Timeout> = new Map();
  private channelWorkTimers: Map<string, NodeJS.Timeout> = new Map();
  private channelWorking: Set<string> = new Set();
  private channelDedup: Map<string, Map<string, number>> = new Map();
  private sourceGateActiveByPath: Map<string, boolean> = new Map();
  private logs: ForwardingLogEntry[] = [];
  private metricsListeners: Set<(m: ForwardingMetricsSnapshot) => void> = new Set();
  private alertListeners: Set<(a: any) => void> = new Set();
  private lastAlertAtByKey: Map<string, number> = new Map();

  constructor(opts: { portManager: PortManager; configPath: string; dataDir: string }) {
    this.portManager = opts.portManager;
    this.store = new JsonFileStore<ForwardingConfigV1>(opts.configPath);
    this.baseDataDir = String(opts.dataDir || '').trim();
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
    const entry: ForwardingLogEntry = { ts: Date.now(), level, msg };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
  }

  private logWithMeta(
    level: LogLevel,
    msg: string,
    meta?: { portPath?: string; channelId?: string; ownerWidgetId?: string }
  ): void {
    const entry: ForwardingLogEntry = {
      ts: Date.now(),
      level,
      msg,
      portPath: meta?.portPath ? String(meta.portPath) : undefined,
      channelId: meta?.channelId ? String(meta.channelId) : undefined,
      ownerWidgetId: meta?.ownerWidgetId ? String(meta.ownerWidgetId) : undefined
    };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
  }

  private guessChannelPortPath(ch?: ForwardingChannelConfig): string | undefined {
    const list = Array.isArray((ch as any)?.filter?.portPaths) ? (ch as any).filter.portPaths : [];
    if (list.length !== 1) return undefined;
    const p = String(list[0] || '').trim();
    return p || undefined;
  }

  public getRecentLogs(input: number | { limit: number; ownerWidgetId?: string; portPath?: string; channelId?: string }): ForwardingLogEntry[] {
    const limit = typeof input === 'number' ? input : input?.limit;
    const ownerWidgetId = typeof input === 'number' ? '' : String(input?.ownerWidgetId || '').trim();
    const portPath = typeof input === 'number' ? '' : String(input?.portPath || '').trim();
    const channelId = typeof input === 'number' ? '' : String(input?.channelId || '').trim();

    const n = Math.max(0, Math.min(limit || 100, this.logs.length));
    if (n <= 0) return [];

    const hasFilters = !!ownerWidgetId || !!portPath || !!channelId;
    if (!hasFilters) return this.logs.slice(this.logs.length - n);

    const outRev: ForwardingLogEntry[] = [];
    for (let i = this.logs.length - 1; i >= 0 && outRev.length < n; i--) {
      const e = this.logs[i];
      let ok = false;
      if (ownerWidgetId && String(e.ownerWidgetId || '') === ownerWidgetId) ok = true;
      if (!ok && channelId && String(e.channelId || '') === channelId) ok = true;
      if (!ok && portPath) {
        const ep = String(e.portPath || '').trim();
        if (ep && this.normalizePath(ep) === this.normalizePath(portPath)) ok = true;
      }
      if (ok) outRev.push(e);
    }
    return outRev.reverse();
  }

  public getConfig(): ForwardingConfigV1 {
    return this.config;
  }

  private validateConfig(raw: ForwardingConfigV1): void {
    const sources = Array.isArray((raw as any)?.sources) ? (raw as any).sources : [];
    const enabledByPort = new Map<string, Array<{ portPath: string; ownerWidgetId?: string }>>();
    for (const s of sources) {
      if (!s || typeof s !== 'object') continue;
      const enabled = !!(s as any).enabled;
      const portPath = String((s as any).portPath || '').trim();
      if (!enabled || !portPath) continue;
      const key = this.normalizePath(portPath);
      const ownerWidgetId = String((s as any).ownerWidgetId || '').trim() || undefined;
      const arr = enabledByPort.get(key) || [];
      arr.push({ portPath, ownerWidgetId });
      enabledByPort.set(key, arr);
    }
    const conflicts: Array<{ portPath: string; owners: string[] }> = [];
    for (const arr of enabledByPort.values()) {
      if (arr.length <= 1) continue;
      const portPath = arr[0].portPath;
      const owners = Array.from(new Set(arr.map(x => String(x.ownerWidgetId || '(none)'))));
      conflicts.push({ portPath, owners });
    }
    if (conflicts.length > 0) {
      const msg = conflicts
        .map(c => `${c.portPath} 被多个数据源同时启用（ownerWidgetId: ${c.owners.join(', ')}）`)
        .join('；');
      throw new Error(`数据源端口冲突：${msg}`);
    }
  }

  private ownerHasEnabledChannels(ownerWidgetId?: string): boolean {
    const owner = String(ownerWidgetId || '').trim();
    if (!owner) return this.config.channels.some(c => !!c.enabled && !String((c as any)?.ownerWidgetId || '').trim());
    return this.config.channels.some(c => !!c.enabled && String((c as any)?.ownerWidgetId || '').trim() === owner);
  }

  public async setConfig(next: ForwardingConfigV1): Promise<void> {
    this.validateConfig(next);
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
    const dataDir = this.baseDataDir || this.config.store?.dataDir || path.join(process.cwd(), 'data');
    const normalizedChannels = (Array.isArray(raw.channels) ? raw.channels : [])
      .filter(c => c && typeof (c as any).id === 'string')
      .map((c: any) => {
        const next = { ...c };
        const ownerWidgetId = String((next as any)?.ownerWidgetId || '').trim() || undefined;
        const t = String(next?.type || '').trim();
        if (t === 'http') {
          const http = next?.http && typeof next.http === 'object' ? { ...next.http } : {};
          if (typeof http.url === 'string') http.url = http.url.trim();
          if (this.isFeishuHookUrl(http.url)) next.payloadFormat = 'feishu';
          next.http = http;
          if (next.enabled && !String(http.url || '').trim()) {
            next.enabled = false;
            this.logWithMeta('warn', `channel ${String(next.id)} disabled due to empty http.url`, {
              channelId: String(next.id),
              ownerWidgetId
            });
          }
        } else if (t === 'websocket') {
          const ws = next?.websocket && typeof next.websocket === 'object' ? { ...next.websocket } : {};
          if (typeof ws.url === 'string') ws.url = ws.url.trim();
          next.websocket = ws;
          if (next.enabled && !String(ws.url || '').trim()) {
            next.enabled = false;
            this.logWithMeta('warn', `channel ${String(next.id)} disabled due to empty websocket.url`, {
              channelId: String(next.id),
              ownerWidgetId
            });
          }
        } else if (t === 'tcp') {
          const tcp = next?.tcp && typeof next.tcp === 'object' ? { ...next.tcp } : {};
          if (typeof tcp.host === 'string') tcp.host = tcp.host.trim();
          const port = Number((tcp as any).port || 0);
          (tcp as any).port = Number.isFinite(port) ? port : 0;
          next.tcp = tcp;
          if (next.enabled && (!String(tcp.host || '').trim() || !(tcp as any).port)) {
            next.enabled = false;
            this.logWithMeta('warn', `channel ${String(next.id)} disabled due to invalid tcp.host/port`, {
              channelId: String(next.id),
              ownerWidgetId
            });
          }
        } else if (t === 'mqtt') {
          const mqtt = next?.mqtt && typeof next.mqtt === 'object' ? { ...next.mqtt } : {};
          if (typeof mqtt.url === 'string') mqtt.url = mqtt.url.trim();
          if (typeof mqtt.topic === 'string') mqtt.topic = mqtt.topic.trim();
          next.mqtt = mqtt;
          if (next.enabled && (!String(mqtt.url || '').trim() || !String(mqtt.topic || '').trim())) {
            next.enabled = false;
            this.logWithMeta('warn', `channel ${String(next.id)} disabled due to invalid mqtt.url/topic`, {
              channelId: String(next.id),
              ownerWidgetId
            });
          }
        }
        const pf = String(next?.payloadFormat || '').trim();
        const dm = String((next as any)?.deliveryMode || '').trim();
        if (dm !== 'at-least-once' && dm !== 'at-most-once') {
          (next as any).deliveryMode = pf === 'feishu' ? 'at-most-once' : 'at-least-once';
        }
        return next;
      });
    const rawSources = Array.isArray((raw as any).sources) ? (raw as any).sources : [];
    const enabledPortKeys = new Set<string>();
    const sources = rawSources
      .filter((s: any) => s && typeof s.portPath === 'string')
      .map((s: any) => {
        const portPath = String(s.portPath || '').trim();
        const key = this.normalizePath(portPath);
        const ownerWidgetId = String(s.ownerWidgetId || '').trim() || undefined;
        const enabled = !!s.enabled;
        if (enabled && enabledPortKeys.has(key)) {
          this.logWithMeta('error', `${portPath} 数据源端口冲突：同一端口只能启用一个数据源，已自动禁用重复项`, {
            portPath,
            ownerWidgetId
          });
          return { ...s, portPath, ownerWidgetId, enabled: false };
        }
        if (enabled) enabledPortKeys.add(key);
        return { ...s, portPath, ownerWidgetId, enabled };
      });

    const next: ForwardingConfigV1 = {
      version: 1,
      enabled: !!raw.enabled,
      sources,
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

    for (const [id, t] of this.channelFlushSoonTimers.entries()) {
      if (!keep.has(id)) {
        clearTimeout(t);
        this.channelFlushSoonTimers.delete(id);
      }
    }
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

  private shouldDropRetryOnSendError(ch: ForwardingChannelConfig, errMsg: string): boolean {
    const mode = String((ch as any)?.deliveryMode || '').trim() || 'at-least-once';
    if (mode !== 'at-most-once') return false;
    const s = String(errMsg || '').toLowerCase();
    if (!s) return false;
    if (s.includes('timeout')) return true;
    if (s.includes('socket hang up')) return true;
    if (s.includes('econnreset')) return true;
    if (s.includes('etimedout')) return true;
    if (s.includes('ehostunreach')) return true;
    if (s.includes('enetunreach')) return true;
    return false;
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
    const matches = this.config.sources.filter(s => s.enabled && this.normalizePath(s.portPath) === this.normalizePath(portPath));
    if (matches.length === 0) return;
    let src: any = null;
    let srcOwnerWidgetId: string | undefined;
    for (const s of matches) {
      const owner = String((s as any).ownerWidgetId || '').trim() || undefined;
      if (this.ownerHasEnabledChannels(owner)) {
        src = s;
        srcOwnerWidgetId = owner;
        break;
      }
    }
    if (!src) return;
    const prev = this.sourceBuffers.get(src.portPath) || Buffer.alloc(0);
    const { frames, rest, droppedBytes } = extractFrames(prev, chunk, src.framing);
    this.sourceBuffers.set(src.portPath, rest);
    if (droppedBytes > 0) this.logWithMeta('warn', `${src.portPath} framing dropped ${droppedBytes} bytes`, { portPath: src.portPath });

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
      await this.dispatchRecord(rec, srcOwnerWidgetId);
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

  private async dispatchRecord(rec: ForwardingRecord, ownerWidgetId?: string): Promise<void> {
    const owner = String(ownerWidgetId || '').trim() || undefined;
    for (const ch of this.config.channels) {
      if (!ch.enabled) continue;
      const chOwner = String((ch as any)?.ownerWidgetId || '').trim() || undefined;
      if (owner) {
        if (chOwner !== owner) continue;
      } else {
        if (chOwner) continue;
      }
      if (!this.matchChannelFilter(ch, rec)) continue;
      if (!this.dedupAccept(ch.id, ch, rec)) {
        const m = this.channelMetrics.get(ch.id);
        if (m) m.dropped += 1;
        continue;
      }
      const buf = this.channelBatchBuffers.get(ch.id) || [];
      const wasEmpty = buf.length === 0;
      buf.push(rec);
      this.channelBatchBuffers.set(ch.id, buf);
      const batchSize = Math.max(1, (ch.batchSize ?? 20));
      if (buf.length >= batchSize) {
        const t = this.channelFlushSoonTimers.get(ch.id);
        if (t) {
          clearTimeout(t);
          this.channelFlushSoonTimers.delete(ch.id);
        }
        await this.flushChannelBuffer(ch.id);
      } else if (wasEmpty) {
        if (!this.channelFlushSoonTimers.has(ch.id)) {
          const delay = Math.max(0, Math.min(50, Number(ch.flushIntervalMs ?? 1000)));
          const timer = setTimeout(() => {
            this.channelFlushSoonTimers.delete(ch.id);
            this.flushChannelBuffer(ch.id).catch(() => undefined);
          }, delay);
          this.channelFlushSoonTimers.set(ch.id, timer);
          if (this.traceEnabled) {
            this.logWithMeta('info', `channel ${ch.id} scheduled flush in ${delay}ms`, {
              channelId: ch.id,
              ownerWidgetId: chOwner,
              portPath: rec.portPath
            });
          }
        }
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
    const t = this.channelFlushSoonTimers.get(channelId);
    if (t) {
      clearTimeout(t);
      this.channelFlushSoonTimers.delete(channelId);
    }
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
    try {
      await q.enqueue(batch, { id: batch.id });
      const m = this.channelMetrics.get(channelId);
      if (m) m.queueLength = await q.size();
      this.workChannelQueue(channelId).catch(() => undefined);
      if (this.traceEnabled) {
        const ownerWidgetId = String((ch as any).ownerWidgetId || '').trim() || undefined;
        this.logWithMeta('info', `channel ${channelId} enqueued batch ${batch.id} records=${records.length}`, {
          channelId,
          ownerWidgetId,
          portPath: records[0]?.portPath
        });
      }
    } catch (e: any) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const m = this.channelMetrics.get(channelId);
      if (m) {
        m.failed += 1;
        m.lastError = errMsg;
      }
      const ch = this.config.channels.find(c => c.id === channelId);
      const ownerWidgetId = ch ? String((ch as any).ownerWidgetId || '').trim() : '';
      this.logWithMeta('error', `channel ${channelId} enqueue failed: ${errMsg}`, {
        channelId,
        ownerWidgetId: ownerWidgetId || undefined,
        portPath: this.guessChannelPortPath(ch)
      });
      return;
    }
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
          const ownerWidgetId = ch ? String((ch as any).ownerWidgetId || '').trim() : '';
          this.logWithMeta('error', `channel ${channelId} drop batch ${batch.id} after ${attempts} attempts`, {
            channelId,
            ownerWidgetId: ownerWidgetId || undefined,
            portPath: this.guessChannelPortPath(ch)
          });
          processed += 1;
          continue;
        }

        const built = buildOutboundPayload(batch, { xmlTemplate: ch.xmlTemplate });
        try {
          const sender = this.senderForChannel(ch);
          if (this.traceEnabled) {
            const ownerWidgetId = String((ch as any).ownerWidgetId || '').trim() || undefined;
            this.logWithMeta('info', `channel ${channelId} sending batch ${batch.id} records=${(batch as any)?.records?.length || 0}`, {
              channelId,
              ownerWidgetId,
              portPath: (batch as any)?.records?.[0]?.portPath
            });
          }
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
          if (this.shouldDropRetryOnSendError(ch, errMsg)) {
            await q.ack(filePath);
            if (m) m.dropped += 1;
            const ownerWidgetId = ch ? String((ch as any).ownerWidgetId || '').trim() : '';
            this.logWithMeta('warn', `channel ${channelId} drop batch ${batch.id} after send error: ${errMsg}`, {
              channelId,
              ownerWidgetId: ownerWidgetId || undefined,
              portPath: this.guessChannelPortPath(ch)
            });
          } else {
            const delay = Math.min(60_000, baseDelay * Math.pow(2, attempts));
            const nextAttemptAt = Date.now() + delay;
            await q.nack(filePath, item, nextAttemptAt);
            const ownerWidgetId = ch ? String((ch as any).ownerWidgetId || '').trim() : '';
            this.logWithMeta('warn', `channel ${channelId} send failed: ${errMsg}`, {
              channelId,
              ownerWidgetId: ownerWidgetId || undefined,
              portPath: this.guessChannelPortPath(ch)
            });
          }
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
    for (const t of this.channelFlushSoonTimers.values()) clearTimeout(t);
    this.channelFlushTimers.clear();
    this.channelWorkTimers.clear();
    this.channelFlushSoonTimers.clear();
    const closers = Array.from(this.channelSenders.values()).map(s => s.close().catch(() => undefined));
    this.channelSenders.clear();
    await Promise.all(closers);
  }
}
