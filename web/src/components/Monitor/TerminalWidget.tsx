import React from 'react';
import { IconDragDotVertical, IconClose, IconSettings, IconThunderbolt, IconLink, IconStop } from '@arco-design/web-react/icon';
import { Button, Space, Typography, Tooltip } from '@arco-design/web-react';
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
        transform: `translate3d(${widget.x + canvasState.offsetX}px, ${widget.y + canvasState.offsetY}px, 0) scale(${(removing || appearing) ? 0.98 : 1})`,
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
          <Tooltip content={widget.portPath || t('monitor.noPort')}>
            <div
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'baseline' }}
              onClick={(e) => {
                e.stopPropagation();
                onOpenConfig(widget);
              }}
            >
              <Typography.Text bold>{widget.title}</Typography.Text>
              {widget.showSubtitle && widget.subtitle && (
                <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                  {widget.subtitle}
                </Typography.Text>
              )}
            </div>
          </Tooltip>
        </Space>
        <Space>
          <Tooltip content={widget.isConnected ? t('monitor.disconnect') : t('monitor.connect')}>
            <Button
              type={widget.isConnected ? 'primary' : 'secondary'}
              status={widget.isConnected ? 'success' : 'default'}
              size="mini"
              icon={widget.isConnected ? <IconLink /> : <IconStop />}
              onClick={(e) => onToggleConnection(e, widget)}
            />
          </Tooltip>
          {widget.autoSend?.enabled && (
            <Tooltip content={t('monitor.manualSend')}>
              <Button
                type="text"
                size="mini"
                icon={<IconThunderbolt />}
                onClick={(e) => onManualSend(e, widget)}
              />
            </Tooltip>
          )}
          <Button
            type="text"
            size="mini"
            icon={<IconSettings />}
            onClick={(e) => {
              e.stopPropagation();
              onOpenConfig(widget);
            }}
          />
          <Button
            type="text"
            size="mini"
            status="danger"
            icon={<IconClose />}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(widget.id);
            }}
          />
        </Space>
      </div>

      <div style={{ flex: 1, padding: 12, overflow: 'hidden', position: 'relative' }}>
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
