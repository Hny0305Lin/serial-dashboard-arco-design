import { useSyncExternalStore } from 'react';

type Listener = () => void;

type ChannelPart = {
  id: string;
  enabled: '0' | '1';
  queueLength: number;
  sent: number;
  failed: number;
  dropped: number;
  avgLatencyMs: number | '';
  lastError: string;
  lastSuccessAt: number;
};

let snapshot: unknown | null = null;
let lastDigest = '';
const listeners = new Set<Listener>();

function digest(x: unknown | null) {
  if (!x || typeof x !== 'object') return '';

  const obj = x as Record<string, unknown>;
  const enabled = obj.enabled ? '1' : '0';
  const channels = Array.isArray(obj.channels) ? obj.channels : [];

  const parts = channels
    .map<ChannelPart>((c) => {
      const cc = c && typeof c === 'object' ? (c as Record<string, unknown>) : {};
      return {
        id: String(cc.channelId ?? ''),
        enabled: cc.enabled ? '1' : '0',
        queueLength: Number(cc.queueLength ?? 0),
        sent: Number(cc.sent ?? 0),
        failed: Number(cc.failed ?? 0),
        dropped: Number(cc.dropped ?? 0),
        lastError: cc.lastError ? String(cc.lastError) : '',
        avgLatencyMs: typeof cc.avgLatencyMs === 'number' ? Math.round(cc.avgLatencyMs) : '',
        lastSuccessAt: typeof cc.lastSuccessAt === 'number' ? Math.floor(cc.lastSuccessAt) : 0,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => `${c.id}|${c.enabled}|${c.queueLength}|${c.sent}|${c.failed}|${c.dropped}|${c.avgLatencyMs}|${c.lastError}|${c.lastSuccessAt}`);
  return `${enabled}::${parts.join(';;')}`;
}

function emit() {
  listeners.forEach(l => l());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

export function pushForwardingMetrics(next: unknown | null) {
  const d = digest(next);
  if (d === lastDigest) return;
  lastDigest = d;
  snapshot = next;
  emit();
}

export function useForwardingMetrics() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
