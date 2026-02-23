import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconDragDotVertical, IconClose, IconSettings } from '@arco-design/web-react/icon';
import { Button, Select, Space, Tooltip, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { CanvasState, MonitorWidget } from './types';

type TimeSource = 'local' | 'beijing';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function formatParts(ts: number, timeZone?: string) {
  const d = new Date(ts);
  if (!timeZone) {
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}:${ss}` };
  }

  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(d);
  const byType: Record<string, string> = {};
  parts.forEach(p => {
    if (p.type !== 'literal') byType[p.type] = p.value;
  });
  const yyyy = byType.year || '0000';
  const mm = byType.month || '00';
  const dd = byType.day || '00';
  const hh = byType.hour || '00';
  const mi = byType.minute || '00';
  const ss = byType.second || '00';
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}:${ss}` };
}

export default function ClockWidget(props: {
  widget: MonitorWidget;
  canvasState: CanvasState;
  nowTs: number;
  isDragging: boolean;
  draggedWidgetId: string | null;
  resizingWidgetId: string | null;
  appearing: boolean;
  removing: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onOpenConfig: (widget: MonitorWidget) => void;
  onRemove: (id: string) => void;
  onResizeMouseDown: (e: React.MouseEvent, id: string, width: number, height: number) => void;
  onUpdate: (id: string, patch: Partial<MonitorWidget>) => void;
}) {
  const { t } = useTranslation();
  const {
    widget,
    isDragging,
    draggedWidgetId,
    resizingWidgetId,
    nowTs,
    appearing,
    removing,
    onMouseDown,
    onOpenConfig,
    onRemove,
    onResizeMouseDown,
    onUpdate
  } = props;

  const source: TimeSource = (widget.clockSource === 'beijing' ? 'beijing' : 'local');
  const [beijingSync, setBeijingSync] = useState<{ serverAtFetchMs: number; clientAtFetchMs: number } | null>(null);
  const fetchingRef = useRef(false);

  useEffect(() => {
    if (source !== 'beijing') return;
    if (fetchingRef.current) return;
    const freshEnough = beijingSync && (nowTs - beijingSync.clientAtFetchMs) < 10 * 60 * 1000;
    if (freshEnough) return;

    fetchingRef.current = true;
    const ac = new AbortController();
    const timeout = window.setTimeout(() => ac.abort(), 3500);

    fetch('https://worldtimeapi.org/api/timezone/Asia/Shanghai', { signal: ac.signal })
      .then(r => r.json())
      .then((data) => {
        const unixtime = Number(data?.unixtime);
        if (!Number.isFinite(unixtime) || unixtime <= 0) return;
        setBeijingSync({ serverAtFetchMs: unixtime * 1000, clientAtFetchMs: Date.now() });
      })
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(timeout);
        fetchingRef.current = false;
      });

    return () => {
      window.clearTimeout(timeout);
      ac.abort();
      fetchingRef.current = false;
    };
  }, [beijingSync, nowTs, source]);

  const effectiveNow = useMemo(() => {
    if (source !== 'beijing') return { ts: nowTs, timeZone: undefined as string | undefined };
    if (beijingSync) {
      const ts = beijingSync.serverAtFetchMs + (nowTs - beijingSync.clientAtFetchMs);
      return { ts, timeZone: 'Asia/Shanghai' as const };
    }
    return { ts: nowTs, timeZone: 'Asia/Shanghai' as const };
  }, [beijingSync, nowTs, source]);

  const formatted = useMemo(() => formatParts(effectiveNow.ts, effectiveNow.timeZone), [effectiveNow.ts, effectiveNow.timeZone]);

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
        cursor: 'default',
        borderTopLeftRadius: '4px',
        borderTopRightRadius: '4px'
      }}>
        <Space>
          <IconDragDotVertical style={{ color: '#86909c', cursor: 'move' }} />
          <Tooltip content={t('monitor.widget.clock')}>
            <div
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'baseline', minWidth: 0, maxWidth: '100%' }}
              onClick={(e) => {
                e.stopPropagation();
                onOpenConfig(widget);
              }}
            >
              <Typography.Text bold style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {widget.title}
              </Typography.Text>
            </div>
          </Tooltip>
        </Space>
        <Button.Group>
          <Button
            type="primary"
            size="mini"
            icon={<IconSettings />}
            onClick={(e) => {
              e.stopPropagation();
              onOpenConfig(widget);
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

      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ fontSize: Math.max(32, Math.min(64, Math.floor(widget.height / 3))), fontWeight: 600, letterSpacing: 1, fontVariantNumeric: 'tabular-nums', lineHeight: 1, transform: 'translateY(-0.10em)' }}>
          {formatted.time}
        </div>
        <div style={{ position: 'absolute', left: 12, bottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {formatted.date}
          </Typography.Text>
          <Select
            className="monitor-clock-select"
            size="mini"
            value={source}
            onChange={(v) => onUpdate(widget.id, { clockSource: (v === 'beijing' ? 'beijing' : 'local') })}
            style={{ width: 104 }}
          >
            <Select.Option value="local">{t('monitor.clock.local')}</Select.Option>
            <Select.Option value="beijing">{t('monitor.clock.beijing')}</Select.Option>
          </Select>
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
    </div>
  );
}
