import React, { useEffect, useRef, useState } from 'react';
import { IconDragDotVertical, IconClose, IconSettings, IconThunderbolt, IconLink, IconStop } from '@arco-design/web-react/icon';
import { Button, Space, Typography, Tooltip, Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { MonitorWidget, CanvasState } from './types';
import TerminalLogView from '../TerminalLogView';

export default function TerminalWidget(props: {
  widget: MonitorWidget;
  canvasState: CanvasState;
  isDragging: boolean;
  draggedWidgetId: string | null;
  resizingWidgetId: string | null;
  appearing: boolean;
  removing: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onToggleConnection: (e: any, widget: MonitorWidget) => void;
  onManualSend: (e: any, widget: MonitorWidget) => void;
  onOpenConfig: (widget: MonitorWidget) => void;
  onRemove: (id: string) => void;
  onResizeMouseDown: (e: React.MouseEvent, id: string, width: number, height: number) => void;
}) {
  const { t } = useTranslation();
  const {
    widget,
    canvasState,
    isDragging,
    draggedWidgetId,
    resizingWidgetId,
    appearing,
    removing,
    onMouseDown,
    onToggleConnection,
    onManualSend,
    onOpenConfig,
    onRemove,
    onResizeMouseDown
  } = props;
  const [pulsing, setPulsing] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const pulseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!widget.lastRxAt) return;
    setPulseKey(widget.lastRxAt);
    setPulsing(true);
    if (pulseTimerRef.current) {
      window.clearTimeout(pulseTimerRef.current);
    }
    pulseTimerRef.current = window.setTimeout(() => {
      setPulsing(false);
    }, 1200);
    return () => {
      if (pulseTimerRef.current) {
        window.clearTimeout(pulseTimerRef.current);
        pulseTimerRef.current = null;
      }
    };
  }, [widget.lastRxAt]);

  const canToggleConnection = !!String(widget.portPath || '').trim();

  return (
    <div
      className="monitor-widget"
      data-monitor-widget-id={widget.id}
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
            <span key={pulseKey} className={pulsing ? 'terminal-rx-dot terminal-rx-dot--pulse' : 'terminal-rx-dot'} />
          </span>
          <Tooltip content={widget.portPath || t('monitor.noPort')}>
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
              {widget.showSubtitle && widget.subtitle && (
                <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {widget.subtitle}
                </Typography.Text>
              )}
            </div>
          </Tooltip>
        </Space>
        <div data-monitor-no-drag="true">
          <Button.Group>
            <Tooltip content={widget.isConnected ? t('monitor.disconnect') : (canToggleConnection ? t('monitor.connect') : t('monitor.noPort'))}>
              <Button
                type={widget.isConnected ? 'primary' : (canToggleConnection ? 'primary' : 'secondary')}
                status={widget.isConnected ? 'success' : 'default'}
                size="mini"
                icon={widget.isConnected ? <IconLink /> : <IconStop />}
                style={widget.isConnected ? undefined : (canToggleConnection ? undefined : { opacity: 0.45 })}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!widget.isConnected && !canToggleConnection) {
                    Message.warning(`${t('monitor.noPort')}，请先完成组件配置。`);
                    return;
                  }
                  onToggleConnection(e, widget);
                }}
              />
            </Tooltip>
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
      </div>

      <div style={{ flex: 1, padding: 0, overflow: 'hidden', position: 'relative' }}>
        <TerminalLogView logs={widget.logs || []} emptyText={t('panel.noLogs')} height="100%" />
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
