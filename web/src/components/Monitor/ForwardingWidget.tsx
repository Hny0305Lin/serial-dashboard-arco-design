import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconDragDotVertical, IconClose, IconSettings, IconSync, IconCheckCircle, IconExclamationCircle } from '@arco-design/web-react/icon';
import { Button, Space, Typography, Tooltip, Modal, Form, Input, Select, Switch, InputNumber, Tabs, Message, Tag, Card } from '@arco-design/web-react';
import type { MonitorWidget, CanvasState } from './types';
import { useSerialPortController } from '../../hooks/useSerialPortController';
import { getApiBaseUrl } from '../../utils/net';
import { useForwardingMetrics } from '../../hooks/useForwardingMetrics';

type ForwardingMetricsSnapshot = {
  ts: number;
  enabled: boolean;
  channels: Array<{
    channelId: string;
    enabled: boolean;
    queueLength: number;
    sent: number;
    failed: number;
    dropped: number;
    lastError?: string;
    lastSuccessAt?: number;
    lastLatencyMs?: number;
    avgLatencyMs?: number;
  }>;
};

type ForwardingConfigV1 = {
  version: 1;
  enabled: boolean;
  sources: Array<any>;
  channels: Array<any>;
  store?: any;
  alert?: any;
};

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
  }
  return { res, json, text };
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toRoman(n: number): string {
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
}

function nextRomanName(base: string, usedNames: Set<string>): string {
  const b = String(base || '').trim() || '新渠道';
  let n = 1;
  while (true) {
    const candidate = `${b}-${toRoman(n)}`;
    if (!usedNames.has(candidate)) return candidate;
    n += 1;
  }
}

function buildHttpError(res: Response, json: any, text: string | null, fallback: string) {
  let msg = String(json?.msg || '').trim();
  if (!msg && text) {
    const m = String(text).match(/Cannot\s+\w+\s+[^<\n]+/);
    msg = (m ? m[0] : String(text)).replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  if (!msg) msg = fallback;
  const statusText = String((res as any)?.statusText || '').trim();
  return `${res.status}${statusText ? ` ${statusText}` : ''} · ${msg}`;
}

export default function ForwardingWidget(props: {
  widget: MonitorWidget;
  canvasState: CanvasState;
  isDragging: boolean;
  draggedWidgetId: string | null;
  resizingWidgetId: string | null;
  appearing: boolean;
  removing: boolean;
  portList: string[];
  serial: ReturnType<typeof useSerialPortController>;
  onRefreshPorts?: () => void;
  normalizePath: (p?: string) => string;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onOpenConfig: (widget: MonitorWidget) => void;
  autoOpenSettings?: boolean;
  onAutoOpenSettingsConsumed?: () => void;
  onUpdate: (id: string, patch: Partial<MonitorWidget>) => void;
  onLockChange: (locked: boolean) => void;
  onRemove: (id: string) => void;
  onResizeMouseDown: (e: React.MouseEvent, id: string, width: number, height: number) => void;
}) {
  const {
    widget,
    isDragging,
    draggedWidgetId,
    resizingWidgetId,
    appearing,
    removing,
    portList,
    serial,
    onRefreshPorts,
    normalizePath,
    onMouseDown,
    onOpenConfig,
    autoOpenSettings,
    onAutoOpenSettingsConsumed,
    onLockChange,
    onRemove,
    onResizeMouseDown
  } = props;

  const metrics = useForwardingMetrics() as ForwardingMetricsSnapshot | null;
  const [config, setConfig] = useState<ForwardingConfigV1 | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [logs, setLogs] = useState<Array<{ ts: number; level: string; msg: string }>>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general');
  const [pendingScrollChannelId, setPendingScrollChannelId] = useState<string | null>(null);
  const scrollTryRef = useRef(0);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const dragScrollRef = useRef<{ active: boolean; startX: number; startScrollLeft: number; moved: boolean }>({ active: false, startX: 0, startScrollLeft: 0, moved: false });
  const [form] = Form.useForm();

  const globalEnabled = metrics?.enabled ?? config?.enabled ?? false;
  const metricsChannels = useMemo(() => metrics?.channels || [], [metrics]);
  const configChannels = useMemo(() => (Array.isArray((config as any)?.channels) ? (config as any).channels : []), [config]);
  const ownedChannelConfigs = useMemo(() => configChannels.filter((c: any) => String(c?.ownerWidgetId || '') === String(widget.id)), [configChannels, widget.id]);
  const panelEnabled = useMemo(() => globalEnabled && ownedChannelConfigs.some((c: any) => !!c?.enabled), [globalEnabled, ownedChannelConfigs]);
  const metricsById = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of metricsChannels) m.set(String(c.channelId), c);
    return m;
  }, [metricsChannels]);

  type ChannelHealth = 'pending' | 'bad' | 'recovering' | 'suspect' | 'ok';
  const channelHealthByIdRef = useRef<Map<string, ChannelHealth>>(new Map());
  const channelHealthById = useMemo(() => {
    const prev = channelHealthByIdRef.current;
    const map = new Map<string, ChannelHealth>();
    for (const cc of ownedChannelConfigs) {
      const id = String(cc?.id || '').trim();
      if (!id) continue;
      const m = metricsById.get(id) || null;
      const total = m ? ((m.sent || 0) + (m.failed || 0)) : 0;
      let health: ChannelHealth = 'pending';
      if (m && total > 0) {
        const successRate = (m.sent || 0) / Math.max(1, total);
        const wasOk = prev.get(id) === 'ok';
        if (successRate >= 0.8) health = 'ok';
        else if (successRate > 0.5) health = wasOk ? 'suspect' : 'recovering';
        else health = 'bad';
      }
      map.set(id, health);
    }
    return map;
  }, [metricsById, ownedChannelConfigs]);

  useEffect(() => {
    channelHealthByIdRef.current = channelHealthById;
  }, [channelHealthById]);

  const ensureChannelOnceRef = useRef(false);
  const otherChannelsRef = useRef<any[] | null>(null);

  const loadConfigRaw = async (): Promise<ForwardingConfigV1 | null> => {
    try {
      const { res, json, text } = await fetchJson(`${getApiBaseUrl()}/forwarding/config`);
      if (!res.ok || json?.code !== 0) throw new Error(buildHttpError(res, json, text, 'load failed'));
      return (json.data as any) || null;
    } catch (e) {
      return null;
    }
  };

  const reloadConfig = async (): Promise<ForwardingConfigV1 | null> => {
    setConfigLoading(true);
    try {
      const { res, json, text } = await fetchJson(`${getApiBaseUrl()}/forwarding/config`);
      if (!res.ok || json?.code !== 0) throw new Error(buildHttpError(res, json, text, 'load failed'));
      setConfig(json.data as any);
      return json.data as any;
    } catch (e: any) {
      Message.error(e?.message || '加载转发配置失败');
      return null;
    } finally {
      setConfigLoading(false);
    }
  };

  const reloadLogs = async () => {
    setLogsLoading(true);
    try {
      const { res, json, text } = await fetchJson(`${getApiBaseUrl()}/forwarding/logs?limit=200`);
      if (!res.ok || json?.code !== 0) throw new Error(buildHttpError(res, json, text, 'load failed'));
      setLogs(Array.isArray(json.data) ? json.data : []);
    } catch (e: any) {
      Message.error(e?.message || '加载转发日志失败');
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    reloadConfig();
    reloadLogs();
  }, []);

  useEffect(() => {
    if (ensureChannelOnceRef.current) return;
    if (!config) return;
    const existing = Array.isArray((config as any)?.channels) ? (config as any).channels : [];
    const owned = existing.filter((c: any) => String(c?.ownerWidgetId || '') === String(widget.id));
    if (owned.length > 0) {
      ensureChannelOnceRef.current = true;
      return;
    }

    ensureChannelOnceRef.current = true;
    const createViaConfig = async () => {
      const used = new Set(existing.map((c: any) => String(c?.id || '')).filter(Boolean));
      let id = '';
      do {
        id = makeId('ch');
      } while (used.has(id));
      const owned = existing.filter((c: any) => String(c?.ownerWidgetId || '') === String(widget.id));
      const usedNames = new Set<string>(
        owned
          .map((c: any) => String(c?.name || '').trim())
          .filter((s: string) => !!s)
      );
      const newChannel: any = {
        id,
        name: nextRomanName('新渠道', usedNames),
        enabled: false,
        ownerWidgetId: widget.id,
        type: 'http',
        payloadFormat: 'feishu',
        compression: 'none',
        encryption: 'none',
        flushIntervalMs: 1000,
        batchSize: 1,
        retryMaxAttempts: 10,
        retryBaseDelayMs: 1000,
        dedupWindowMs: 0,
        http: { url: '', method: 'POST', timeoutMs: 3000, headers: {} }
      };
      const nextCfg: any = { ...config, channels: [...existing, newChannel] };
      const { res, json, text } = await fetchJson(`${getApiBaseUrl()}/forwarding/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextCfg)
      });
      if (!res.ok || json?.code !== 0) throw new Error(buildHttpError(res, json, text, 'save failed'));
      setConfig(json.data as any);
    };
    fetchJson(`${getApiBaseUrl()}/forwarding/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerWidgetId: widget.id, name: '新渠道' })
    })
      .then(async ({ res, json, text }) => {
        if (res.status === 404) {
          await createViaConfig();
          return;
        }
        if (!res.ok || json?.code !== 0) throw new Error(buildHttpError(res, json, text, 'create failed'));
        setConfig(json.data?.config as any);
      })
      .catch((e: any) => {
        ensureChannelOnceRef.current = false;
        Message.error(e?.message || '自动创建转发渠道失败');
      });
  }, [config, widget.id, widget.title]);

  useEffect(() => {
    if (!settingsOpen) return;
    reloadConfig().catch(() => undefined);
  }, [settingsOpen]);

  useEffect(() => {
    onLockChange(!!settingsOpen);
    return () => onLockChange(false);
  }, [settingsOpen, onLockChange]);

  useEffect(() => {
    if (!settingsOpen) return;
    if (settingsTab !== 'channels') return;
    const id = String(pendingScrollChannelId || '').trim();
    if (!id) return;
    const tryScroll = () => {
      const el = document.getElementById(`fw-channel-${id}`);
      if (!el) {
        scrollTryRef.current += 1;
        if (scrollTryRef.current <= 6) setTimeout(tryScroll, 120);
        return;
      }
      scrollTryRef.current = 0;
      setPendingScrollChannelId(null);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    tryScroll();
  }, [settingsOpen, settingsTab, pendingScrollChannelId]);

  const autoOpenOnceRef = useRef(false);
  useEffect(() => {
    if (!autoOpenSettings) return;
    if (autoOpenOnceRef.current) return;
    autoOpenOnceRef.current = true;
    onAutoOpenSettingsConsumed?.();
    openSettings().catch(() => undefined);
  }, [autoOpenSettings, onAutoOpenSettingsConsumed]);

  const openSettings = async () => {
    setSettingsOpen(true);
    setSettingsTab('general');
    const next = await reloadConfig();
    if (next) {
      const allChannels = Array.isArray((next as any)?.channels) ? (next as any).channels : [];
      const owned = allChannels.filter((c: any) => String(c?.ownerWidgetId || '') === String(widget.id));
      const others = allChannels.filter((c: any) => String(c?.ownerWidgetId || '') !== String(widget.id));
      otherChannelsRef.current = others;
      form.setFieldsValue({ enabled: !!next.enabled, sources: next.sources || [], channels: owned });
    }
  };

  const openChannelSettings = async (channelId: string) => {
    setSettingsTab('channels');
    setPendingScrollChannelId(channelId);
    setSettingsOpen(true);
    const next = await reloadConfig();
    if (next) {
      const allChannels = Array.isArray((next as any)?.channels) ? (next as any).channels : [];
      const owned = allChannels.filter((c: any) => String(c?.ownerWidgetId || '') === String(widget.id));
      const others = allChannels.filter((c: any) => String(c?.ownerWidgetId || '') !== String(widget.id));
      otherChannelsRef.current = others;
      form.setFieldsValue({ enabled: !!next.enabled, sources: next.sources || [], channels: owned });
    }
  };

  const onStripPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select, .arco-btn')) return;
    e.preventDefault();
    e.stopPropagation();
    const el = stripRef.current;
    if (!el) return;
    dragScrollRef.current = { active: true, startX: e.clientX, startScrollLeft: el.scrollLeft, moved: false };
    try {
      (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    } catch (err) {
    }
  };

  const onStripPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = stripRef.current;
    if (!el) return;
    const s = dragScrollRef.current;
    if (!s.active) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - s.startX;
    if (Math.abs(dx) > 3) s.moved = true;
    el.scrollLeft = s.startScrollLeft - dx;
  };

  const onStripPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragScrollRef.current;
    if (!s.active) return;
    s.active = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const handleToggleEnabled = async () => {
    const nextPanelEnabled = !panelEnabled;
    try {
      const latest = await loadConfigRaw();
      const base = latest || config;
      if (!base) throw new Error('加载转发配置失败');
      const channels = Array.isArray((base as any)?.channels) ? (base as any).channels : [];
      const nextChannels = channels.map((c: any) => {
        if (String(c?.ownerWidgetId || '') !== String(widget.id)) return c;
        return { ...c, enabled: nextPanelEnabled };
      });
      const anyEnabled = nextChannels.some((c: any) => !!c?.enabled);
      const nextCfg: any = { ...(base as any), enabled: anyEnabled, channels: nextChannels };
      const { res, json, text } = await fetchJson(`${getApiBaseUrl()}/forwarding/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextCfg)
      });
      if (!res.ok || json?.code !== 0) throw new Error(buildHttpError(res, json, text, 'save failed'));
      setConfig(json.data as any);
      Message.success(nextPanelEnabled ? '已启用当前转发' : '已暂停当前转发');
    } catch (e: any) {
      Message.error(e?.message || '更新失败');
    }
  };

  const handleSaveConfig = async () => {
    try {
      const values = await form.validate();
      const latest = await loadConfigRaw();
      const base: any = latest || config || { version: 1, enabled: false, sources: [], channels: [] };
      const baseChannels = Array.isArray(base?.channels) ? base.channels : [];
      const others = baseChannels.filter((c: any) => String(c?.ownerWidgetId || '') !== String(widget.id));
      const ownedNext = Array.isArray(values.channels) ? values.channels.map((c: any) => ({ ...c, ownerWidgetId: widget.id })) : [];
      const next: any = {
        ...base,
        version: 1,
        enabled: !!values.enabled,
        sources: Array.isArray(values.sources) ? values.sources : [],
        channels: [...others, ...ownedNext]
      };
      if (baseChannels.length > 0 && next.channels.length === 0) {
        const ok = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: '确认清空所有渠道？',
            content: '这会删除全部转发渠道配置（包含 URL / headers 等）。如果你只是想暂停转发，请用启停按钮。',
            okButtonProps: { status: 'danger' },
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!ok) return;
      }
      const { res, json, text } = await fetchJson(`${getApiBaseUrl()}/forwarding/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next)
      });
      if (!res.ok || json?.code !== 0) throw new Error(buildHttpError(res, json, text, 'save failed'));
      setConfig(json.data as any);
      Message.success('配置已保存');
      setSettingsOpen(false);
      reloadLogs().catch(() => undefined);
      const openKeys = new Set<string>(serial.allPorts.filter(p => p && p.status === 'open').map(p => normalizePath(p.path)));
      const missing = (next.sources || [])
        .map((s: any) => String(s?.portPath || '').trim())
        .filter((p: string) => p.length > 0)
        .filter((p: string) => !openKeys.has(normalizePath(p)));
      if (missing.length > 0) {
        Message.warning(`数据源未连接：${Array.from(new Set(missing)).join(', ')}（请先在终端组件连接对应串口）`);
      }
    } catch (e: any) {
      if (e?.message) Message.error(e.message);
    }
  };

  const statusIcon = panelEnabled ? <IconCheckCircle style={{ color: '#00b42a' }} /> : <IconExclamationCircle style={{ color: '#86909c' }} />;
  const statusText = panelEnabled ? '运行中' : '已暂停';

  return (
    <div
      className="monitor-widget"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: widget.width,
        height: widget.height,
        zIndex: widget.zIndex,
        backgroundColor: '#fff',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        borderRadius: '4px',
        border: '1px solid #e5e6eb',
        display: 'flex',
        flexDirection: 'column',
        opacity: removing ? 0 : appearing ? 0 : 1,
        transform: `translate3d(${widget.x}px, ${widget.y}px, 0) scale(${(removing || appearing) ? 0.98 : 1})`,
        transition: (draggedWidgetId === widget.id || resizingWidgetId === widget.id || isDragging) ? 'none' : 'opacity 160ms ease, transform 160ms ease, box-shadow 0.2s',
      }}
      onMouseDown={(e) => onMouseDown(e, widget.id)}
    >
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #f0f0f0',
        background: '#fafafa',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'move',
        borderTopLeftRadius: '4px',
        borderTopRightRadius: '4px'
      }} data-monitor-drag-handle="true">
        <Space>
          <IconDragDotVertical style={{ color: '#86909c', cursor: 'move' }} />
          <span style={{ width: 12, display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
            {statusIcon}
          </span>
          <Tooltip content={widget.title}>
            <div
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'baseline', minWidth: 0, maxWidth: '100%' }}
              data-monitor-no-drag="true"
              onClick={(e) => {
                e.stopPropagation();
                onOpenConfig(widget);
              }}
            >
              <Typography.Text bold style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {widget.title}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                {statusText}
              </Typography.Text>
            </div>
          </Tooltip>
        </Space>
        <div data-monitor-no-drag="true">
          <Button.Group>
            <Tooltip content={panelEnabled ? '暂停当前转发' : '启用当前转发'}>
              <Button
                type={panelEnabled ? 'primary' : 'secondary'}
                status={panelEnabled ? 'success' : 'default'}
                size="mini"
                icon={<IconSync />}
                loading={configLoading}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleEnabled();
                }}
              />
            </Tooltip>
            <Button
              type="primary"
              size="mini"
              icon={<IconSettings />}
              onClick={(e) => {
                e.stopPropagation();
                openSettings();
              }}
            />
            <Button
              type="primary"
              size="mini"
              status="danger"
              icon={<IconClose />}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(widget.id);
              }}
            />
          </Button.Group>
        </div>
      </div>

      <div style={{ flex: 1, padding: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary">渠道概览</Typography.Text>
          <Space>
            <Button size="mini" onClick={(e) => { e.stopPropagation(); reloadLogs(); }} loading={logsLoading}>刷新日志</Button>
          </Space>
        </div>
        <div
          ref={stripRef}
          className="forwarding-channels-strip"
          onPointerDown={onStripPointerDown}
          onPointerMove={onStripPointerMove}
          onPointerUp={onStripPointerUp}
          onPointerCancel={onStripPointerUp}
          onPointerLeave={onStripPointerUp}
        >
          {ownedChannelConfigs.length === 0 ? (
            <Typography.Text type="secondary">暂无渠道</Typography.Text>
          ) : (
            ownedChannelConfigs.slice(0, 6).map((cc: any) => {
              const id = String(cc?.id || '').trim();
              const m = id ? metricsById.get(id) : null;
              const enabled = !!cc?.enabled;
              const health = (id ? channelHealthById.get(id) : null) || 'pending';
              return (
                <Card
                  key={id || cc?.name}
                  hoverable
                  className="forwarding-channel-card"
                  title={String(cc?.name || id || '未命名渠道')}
                  extra={(
                    <Button
                      size="mini"
                      type="text"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (id) openChannelSettings(id).catch(() => undefined);
                      }}
                    >
                      More
                    </Button>
                  )}
                  style={{ width: 260, borderRadius: 6, border: '1px solid #f0f0f0' }}
                  bodyStyle={{ padding: 10 } as any}
                >
                  <Space>
                    <Tag color={enabled ? 'green' : 'gray'}>{enabled ? '启用' : '停用'}</Tag>
                    <Tag
                      color={health === 'ok' ? 'green' : health === 'suspect' ? 'orange' : health === 'recovering' ? 'blue' : health === 'bad' ? 'red' : 'gray'}
                    >
                      {health === 'ok' ? 'OK' : health === 'suspect' ? '疑似问题' : health === 'recovering' ? '正在恢复' : health === 'bad' ? '异常' : '暂定'}
                    </Tag>
                  </Space>
                  <div style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Typography.Text type="secondary">队列 {m?.queueLength ?? 0}</Typography.Text>
                    <Typography.Text type="secondary">成功 {m?.sent ?? 0}</Typography.Text>
                    <Typography.Text type="secondary">失败 {m?.failed ?? 0}</Typography.Text>
                    {typeof m?.avgLatencyMs === 'number' && <Typography.Text type="secondary">延迟 {Math.round(m.avgLatencyMs)}ms</Typography.Text>}
                  </div>
                  {!!m?.lastError && (
                    <Tooltip content={m.lastError}>
                      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.lastError}
                      </Typography.Text>
                    </Tooltip>
                  )}
                </Card>
              );
            })
          )}
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Typography.Text type="secondary" style={{ marginBottom: 6 }}>转发日志（最近 200 条）</Typography.Text>
          <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: 10, borderRadius: 6, background: '#1e1e1e', color: '#d4d4d4', fontFamily: 'Consolas, Monaco, \"Courier New\", monospace', fontSize: 12 }}>
            {logs.length === 0 ? (
              <div style={{ opacity: 0.7 }}>暂无日志</div>
            ) : (
              logs.map((l, idx) => (
                <div key={`${l.ts}-${idx}`} style={{ display: 'flex', gap: 8, lineHeight: '18px', marginBottom: 4 }}>
                  <span style={{ opacity: 0.7 }}>{new Date(l.ts).toLocaleTimeString()}</span>
                  <span style={{ opacity: 0.8 }}>[{String(l.level).toUpperCase()}]</span>
                  <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{l.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 16,
          height: 16,
          cursor: 'nwse-resize',
          zIndex: 10
        }}
        onMouseDown={(e) => onResizeMouseDown(e, widget.id, widget.width, widget.height)}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#86909c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v6h-6" />
        </svg>
      </div>

      <Modal
        title={`转发渠道 ${widget.title} 配置`}
        visible={settingsOpen}
        okButtonProps={{ loading: configLoading }}
        onOk={handleSaveConfig}
        onCancel={() => setSettingsOpen(false)}
        style={{ width: 'min(860px, calc(100vw - 24px))' as any }}
        wrapClassName="forwarding-settings-modal"
        wrapStyle={{ overflow: 'hidden' } as any}
      >
        <div style={{ overflow: 'visible' }}>
          <Form form={form} layout="vertical">
            <Tabs activeTab={settingsTab} onChange={(k) => setSettingsTab(String(k))}>
              <Tabs.TabPane key="general" title="总开关">
                <Form.Item field="enabled" label="启用转发" triggerPropName="checked">
                  <Switch />
                </Form.Item>
                <Typography.Text type="secondary">建议在配置完成后再启用，避免空配置导致无意义的转发循环。</Typography.Text>
              </Tabs.TabPane>
              <Tabs.TabPane key="sources" title="数据源">
                <Typography.Text type="secondary">数据源不会主动打开串口：请先在「串口终端」组件连接对应端口，再启用转发。</Typography.Text>
                <Form.List field="sources">
                  {(fields, { add, remove, move }) => (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <Button
                        type="primary"
                        size="mini"
                        onClick={() => add({
                          enabled: true,
                          portPath: '',
                          framing: { mode: 'line', lineDelimiter: 'crlf', maxFrameBytes: 2048 },
                          parse: { mode: 'text-regex', regex: '(?<deviceId>[^,]+),(?<dataType>[^,]+),(?<payload>.*)', regexFlags: '' }
                        })}
                      >
                        新增数据源
                      </Button>
                      {fields.map((field, idx) => (
                        <div key={field.key} style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 12 }}>
                          <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text bold>源 #{idx + 1}</Typography.Text>
                            <Space>
                              <Button size="mini" onClick={() => move(idx, Math.max(0, idx - 1))} disabled={idx === 0}>上移</Button>
                              <Button size="mini" onClick={() => move(idx, idx + 1)} disabled={idx === fields.length - 1}>下移</Button>
                              <Button size="mini" status="danger" onClick={() => remove(idx)}>删除</Button>
                            </Space>
                          </Space>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                            <Form.Item field={`${field.field}.enabled`} label="启用" triggerPropName="checked">
                              <Switch />
                            </Form.Item>
                            <Form.Item field={`${field.field}.portPath`} label="串口端口" rules={[{ required: true, message: '请输入串口端口' }]}>
                              <Select
                                placeholder="选择串口（例如 COM3）"
                                showSearch
                                allowClear
                                onFocus={() => {
                                  serial.refreshPorts(true).catch(() => undefined);
                                  onRefreshPorts && onRefreshPorts();
                                }}
                              >
                                {portList.map(port => {
                                  const portKey = normalizePath(port);
                                  const status = serial.allPorts.find(p => normalizePath(p.path) === portKey)?.status;
                                  const label = status === 'open' ? `${port} (已连接)` : port;
                                  return (
                                    <Select.Option key={port} value={port}>
                                      {label}
                                    </Select.Option>
                                  );
                                })}
                              </Select>
                            </Form.Item>
                            <Form.Item field={`${field.field}.startOnText`} label="触发关键字（可选）" extra="检测到该字符串后才开始转发，例如 user.smsCallback">
                              <Input placeholder="例如 user.smsCallback" />
                            </Form.Item>
                            <Form.Item
                              field={`${field.field}.startMode`}
                              label="触发模式"
                              initialValue="after"
                              extra="仅转发触发行：只发送包含关键字的那一行；命中后开始：命中后所有后续行都转发"
                            >
                              <Select
                                options={[
                                  { label: '命中后开始', value: 'after' },
                                  { label: '仅转发触发行', value: 'only' }
                                ]}
                              />
                            </Form.Item>
                            <Form.Item
                              field={`${field.field}.includeStartLine`}
                              label="包含触发行"
                              triggerPropName="checked"
                              initialValue={true}
                              extra="关闭后：命中关键字的那一行不转发，从下一行开始"
                            >
                              <Switch />
                            </Form.Item>
                            <Form.Item field={`${field.field}.framing.mode`} label="分帧模式" rules={[{ required: true }]}>
                              <Select
                                options={[
                                  { label: 'stream', value: 'stream' },
                                  { label: 'line', value: 'line' },
                                  { label: 'fixed', value: 'fixed' },
                                  { label: 'aa55', value: 'aa55' }
                                ]}
                              />
                            </Form.Item>
                            <Form.Item field={`${field.field}.framing.maxFrameBytes`} label="单帧上限(Byte)">
                              <InputNumber min={64} max={1024 * 1024} />
                            </Form.Item>
                            <Form.Item field={`${field.field}.parse.mode`} label="解析模式" rules={[{ required: true }]}>
                              <Select
                                options={[
                                  { label: 'text-regex', value: 'text-regex' },
                                  { label: 'json', value: 'json' },
                                  { label: 'binary', value: 'binary' }
                                ]}
                              />
                            </Form.Item>
                            <Form.Item field={`${field.field}.parse.regex`} label="正则 (命名组 deviceId/dataType/payload)">
                              <Input placeholder="(?<deviceId>..)" />
                            </Form.Item>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Form.List>
              </Tabs.TabPane>
              <Tabs.TabPane key="channels" title="渠道">
                <Form.List field="channels">
                  {(fields, { add, remove, move }) => (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <Button
                        type="primary"
                        size="mini"
                        onClick={() => add({
                          id: makeId('ch'),
                          name: nextRomanName('新渠道', new Set((form.getFieldValue('channels') || []).map((c: any) => String(c?.name || '').trim()).filter(Boolean))),
                          enabled: false,
                          type: 'http',
                          http: { url: '', method: 'POST', timeoutMs: 5000, headers: {} },
                          payloadFormat: 'feishu',
                          compression: 'none',
                          encryption: 'none',
                          flushIntervalMs: 1000,
                          batchSize: 1,
                          retryMaxAttempts: 10,
                          retryBaseDelayMs: 1000,
                          dedupWindowMs: 0,
                          dedupMaxEntries: 10000
                        })}
                      >
                        新增渠道
                      </Button>
                      {fields.map((field, idx) => (
                        <div
                          key={field.key}
                          id={(() => {
                            const list = form.getFieldValue('channels') || [];
                            const c = list?.[Number(field.field)];
                            const id = String(c?.id || '').trim();
                            return id ? `fw-channel-${id}` : undefined;
                          })()}
                          style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 12 }}
                        >
                          <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text bold>渠道 #{idx + 1}</Typography.Text>
                            <Space>
                              <Button size="mini" onClick={() => move(idx, Math.max(0, idx - 1))} disabled={idx === 0}>上移</Button>
                              <Button size="mini" onClick={() => move(idx, idx + 1)} disabled={idx === fields.length - 1}>下移</Button>
                              <Button size="mini" status="danger" onClick={() => remove(idx)}>删除</Button>
                            </Space>
                          </Space>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                            <Form.Item field={`${field.field}.enabled`} label="启用" triggerPropName="checked">
                              <Switch />
                            </Form.Item>
                            <Form.Item field={`${field.field}.id`} label="渠道 ID" rules={[{ required: true, message: '渠道 ID 必填' }]}>
                              <Input />
                            </Form.Item>
                            <Form.Item field={`${field.field}.name`} label="渠道名称">
                              <Input />
                            </Form.Item>
                            <Form.Item field={`${field.field}.type`} label="类型" rules={[{ required: true }]}>
                              <Select options={[
                                { label: 'HTTP', value: 'http' },
                                { label: 'WebSocket', value: 'websocket' },
                                { label: 'TCP', value: 'tcp' },
                                { label: 'MQTT', value: 'mqtt' },
                              ]} />
                            </Form.Item>
                            <Form.Item field={`${field.field}.payloadFormat`} label="发送格式" rules={[{ required: true }]}>
                              <Select options={[
                                { label: 'JSON', value: 'json' },
                                { label: 'XML', value: 'xml' },
                                { label: 'Binary', value: 'binary' },
                                { label: 'Feishu Bot (text)', value: 'feishu' },
                              ]} />
                            </Form.Item>
                            <Form.Item field={`${field.field}.flushIntervalMs`} label="批量周期(ms)">
                              <InputNumber min={200} max={60000} />
                            </Form.Item>
                            <Form.Item field={`${field.field}.batchSize`} label="批量大小">
                              <InputNumber min={1} max={2000} />
                            </Form.Item>
                            <Form.Item field={`${field.field}.retryMaxAttempts`} label="重试次数">
                              <InputNumber min={0} max={100} />
                            </Form.Item>
                            <Form.Item field={`${field.field}.retryBaseDelayMs`} label="重试基准延迟(ms)">
                              <InputNumber min={200} max={60000} />
                            </Form.Item>
                            <Form.Item field={`${field.field}.compression`} label="压缩">
                              <Select options={[
                                { label: 'none', value: 'none' },
                                { label: 'gzip', value: 'gzip' }
                              ]} />
                            </Form.Item>
                            <Form.Item field={`${field.field}.encryption`} label="加密">
                              <Select options={[
                                { label: 'none', value: 'none' },
                                { label: 'aes-256-gcm', value: 'aes-256-gcm' }
                              ]} />
                            </Form.Item>
                            <Form.Item field={`${field.field}.encryptionKeyId`} label="Key ID (可选)">
                              <Input placeholder="例如 A" />
                            </Form.Item>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                            <Form.Item
                              field={`${field.field}.http.url`}
                              label="HTTP URL (type=http)"
                              rules={[
                                {
                                  validator: (value, callback) => {
                                    const list = form.getFieldValue('channels') || [];
                                    const c = list?.[Number(field.field)] || {};
                                    const type = String(c?.type || '').trim();
                                    const enabled = !!c?.enabled;
                                    const raw = String(value || '').trim();
                                    if (type !== 'http') return callback();
                                    if (enabled && !raw) return callback('HTTP URL 必填');
                                    if (!raw) return callback();
                                    let u: URL | null = null;
                                    try {
                                      u = new URL(raw);
                                    } catch (e) {
                                      return callback('URL 无效');
                                    }
                                    const payloadFormat = String(c?.payloadFormat || '').trim();
                                    const isFeishuHook = u.hostname === 'open.feishu.cn' && u.pathname.startsWith('/open-apis/bot/v2/hook/');
                                    if (isFeishuHook && payloadFormat !== 'feishu') {
                                      return callback('飞书机器人Webhook请把发送格式改为 Feishu Bot (text)');
                                    }
                                    return callback();
                                  }
                                }
                              ]}
                            >
                              <Input placeholder="http://..." />
                            </Form.Item>
                            <Form.Item field={`${field.field}.websocket.url`} label="WS URL (type=websocket)">
                              <Input placeholder="ws://..." />
                            </Form.Item>
                            <Form.Item field={`${field.field}.tcp.host`} label="TCP Host (type=tcp)">
                              <Input placeholder="127.0.0.1" />
                            </Form.Item>
                            <Form.Item field={`${field.field}.tcp.port`} label="TCP Port (type=tcp)">
                              <InputNumber min={1} max={65535} />
                            </Form.Item>
                            <Form.Item field={`${field.field}.mqtt.url`} label="MQTT URL (type=mqtt)">
                              <Input placeholder="mqtt://..." />
                            </Form.Item>
                            <Form.Item field={`${field.field}.mqtt.topic`} label="MQTT Topic (type=mqtt)">
                              <Input placeholder="topic/name" />
                            </Form.Item>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Form.List>
              </Tabs.TabPane>
            </Tabs>
          </Form>
        </div>
      </Modal>
    </div>
  );
}
