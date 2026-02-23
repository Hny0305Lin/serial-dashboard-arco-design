import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PortInfo } from '../types';
import { inferSerialReason } from '../utils/serialReason';

type SerialOpenConfig = {
  path: string;
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: string;
};

const normalizePath = (p?: string) => (p || '').toLowerCase().replace(/^\\\\.\\/, '');

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  let json: any = null;
  try {
    json = await res.json();
  } catch (e) {
  }
  return { res, json };
}

export function useSerialPortController(opts: { ws: WebSocket | null }) {
  const { ws } = opts;
  const [allPorts, setAllPorts] = useState<PortInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const lastStatusByPathRef = useRef<Record<string, { status: string; error?: string; ts: number }>>({});

  const portsByPath = useMemo(() => {
    const map: Record<string, PortInfo> = {};
    allPorts.forEach(p => {
      map[normalizePath(p.path)] = p;
    });
    return map;
  }, [allPorts]);

  const refreshPorts = useCallback(async (silent = true) => {
    if (!silent) setLoading(true);
    try {
      const { json } = await fetchJson('http://localhost:3001/api/ports');
      if (json?.code === 0 && Array.isArray(json?.data)) {
        setAllPorts(json.data as PortInfo[]);
        return json.data as PortInfo[];
      }
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ws) return;
    const handler = (event: MessageEvent) => {
      let msg: any = null;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (msg?.type !== 'serial:status' || !msg?.path) return;
      const key = normalizePath(msg.path);
      const ts = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
      lastStatusByPathRef.current[key] = { status: String(msg.status || ''), error: msg.error ? String(msg.error) : undefined, ts };
    };
    ws.addEventListener('message', handler as any);
    return () => {
      ws.removeEventListener('message', handler as any);
    };
  }, [ws]);

  const clearLocalStatus = useCallback((path: string) => {
    const key = normalizePath(path);
    delete lastStatusByPathRef.current[key];
  }, []);

  const waitForPortState = useCallback(async (path: string, desired: 'open' | 'closed', minTs: number) => {
    const key = normalizePath(path);
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline) {
      const statusEvent = lastStatusByPathRef.current[key];
      if (statusEvent && statusEvent.ts >= minTs) {
        if (statusEvent.status === desired) return;
        if (statusEvent.status === 'error') {
        const reason = inferSerialReason(statusEvent.error);
        throw new Error(reason || statusEvent.error || 'open failed');
        }
      }
      const list = await refreshPorts(true);
      if (list) {
        const p = list.find(x => normalizePath(x.path) === key);
        if (p?.status === desired) return;
        if (p?.status === 'error' || p?.lastError) {
          const reason = inferSerialReason(p.lastError);
          throw new Error(reason || p.lastError || 'open failed');
        }
      }
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error('timeout');
  }, [refreshPorts]);

  const openPort = useCallback(async (config: SerialOpenConfig) => {
    const startedAt = Date.now();
    clearLocalStatus(config.path);
    const { res, json } = await fetchJson('http://localhost:3001/api/ports/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok || json?.code !== 0) {
      const msg = String(json?.msg || 'open failed');
      const reason = inferSerialReason(msg);
      throw new Error(reason || msg);
    }
    await waitForPortState(config.path, 'open', startedAt);
  }, [waitForPortState, clearLocalStatus]);

  const closePort = useCallback(async (path: string) => {
    const startedAt = Date.now();
    clearLocalStatus(path);
    const { res, json } = await fetchJson('http://localhost:3001/api/ports/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok || json?.code !== 0) {
      const msg = String(json?.msg || 'close failed');
      throw new Error(msg);
    }
    await waitForPortState(path, 'closed', startedAt);
  }, [waitForPortState, clearLocalStatus]);

  return {
    allPorts,
    portsByPath,
    loading,
    refreshPorts,
    openPort,
    closePort,
  };
}
