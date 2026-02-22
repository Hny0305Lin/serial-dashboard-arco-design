import React, { useState, useRef, useEffect, useCallback } from 'react';
import { IconDragDotVertical, IconClose, IconExpand, IconPlus, IconCode, IconSettings, IconThunderbolt, IconLink, IconStop } from '@arco-design/web-react/icon';
import { Card, Button, Space, Typography, Empty, Dropdown, Menu, Modal, Form, Input, Select, Tooltip, Grid, Switch, Divider, Radio, Message, Badge } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { MonitorWidget, CanvasState } from './types';
import TerminalLogView from '../TerminalLogView';

const { Row, Col } = Grid;

// 初始状态为空
const INITIAL_WIDGETS: MonitorWidget[] = [];

export default function MonitorCanvas(props: { ws: WebSocket | null; wsConnected: boolean; portList?: string[]; onRefreshPorts?: () => void }) {
  const { t } = useTranslation();
  const { ws, wsConnected, portList = [], onRefreshPorts } = props;
  const [widgets, setWidgets] = useState<MonitorWidget[]>(INITIAL_WIDGETS);
  const normalizePath = (p?: string) => (p || '').toLowerCase().replace(/^\\\\.\\/, '');

  // 注入样式
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .no-scrollbar::-webkit-scrollbar {
        display: none;
      }
      .no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);
  const [canvasState, setCanvasState] = useState<CanvasState>({ offsetX: 0, offsetY: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
  const [resizingWidgetId, setResizingWidgetId] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const decoderRef = useRef<TextDecoder>(new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }));

  // WebSocket 数据处理
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        // console.log('[Monitor] WS Message:', msg); // 调试日志

        // 监听串口状态变更，同步更新 isConnected 状态
        if (msg.type === 'serial:status') {
          const { path, status } = msg;
          const msgPath = normalizePath(path);

          setWidgets(prev => prev.map(w => {
            const widgetPath = normalizePath(w.portPath);
            if (widgetPath === msgPath) {
              return { ...w, isConnected: status === 'open' };
            }
            return w;
          }));
        }

        // 监听串口打开成功消息，触发自动发送
        if (msg.type === 'serial:opened') {
          const { path } = msg;
          console.log('[Monitor] Serial Opened:', path); // 调试日志

          // 查找所有配置了自动发送且匹配该串口的组件
          setWidgets(prev => {
            // 使用函数式更新确保获取最新状态
            const nextWidgets = prev.map(w => {
              const widgetPath = normalizePath(w.portPath);
              const msgPath = normalizePath(path);

              if (w.type === 'terminal' && widgetPath === msgPath && w.autoSend?.enabled && w.autoSend.content) {
                console.log('[Monitor] Trigger AutoSend for widget:', w.id); // 调试日志

                // 发送数据
                const payload = {
                  type: 'serial:send',
                  path: path,
                  data: w.autoSend.content,
                  encoding: w.autoSend.encoding || 'hex'
                };
                ws.send(JSON.stringify(payload));

                // 记录发送日志
                const sentLog = `[${path}-Auto] ${w.autoSend.content}`;
                const newLogs = [...(w.logs || []), sentLog].slice(-500);
                return { ...w, logs: newLogs, isConnected: true }; // 顺便更新连接状态
              }
              // 如果只是匹配路径，也顺便更新连接状态
              if (widgetPath === msgPath) {
                return { ...w, isConnected: true };
              }
              return w;
            });
            return nextWidgets;
          });
        }

        if (msg.type === 'serial:data') {
          let bytes: Uint8Array | null = null;
          const rawData = msg.data?.raw?.data;
          if (Array.isArray(rawData)) {
            bytes = new Uint8Array(rawData as number[]);
          }

          const path = msg.path || 'Unknown';
          const hexContent = bytes ? Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') : '';
          const textContent = bytes ? decoderRef.current.decode(bytes).replace(/\u0000/g, '') : (typeof msg.data === 'object' ? JSON.stringify(msg.data) : String(msg.data));
          const printableRatio = bytes
            ? (Array.from(bytes).filter(b => b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)).length / Math.max(1, bytes.length))
            : 1;

          // 清理内容格式：移除 "COMx: " 前缀
          const cleanedText = textContent.startsWith(`${path}: `) ? textContent.substring(path.length + 2) : textContent;

          // 分发数据到对应的组件
          setWidgets(prev => prev.map(w => {
            // 路径匹配逻辑优化：不区分大小写，且兼容 "COM1" 和 "\\.\COM1" 格式
            const msgPath = normalizePath(path);
            const widgetPath = normalizePath(w.portPath);

            if (w.type === 'terminal' && widgetPath === msgPath) {
              const mode = w.displayMode || 'text';
              const payload =
                mode === 'hex' ? hexContent :
                  mode === 'auto' ? (printableRatio >= 0.7 ? cleanedText : hexContent) :
                    cleanedText;

              const newLogs = [...(w.logs || []), `[${path}-RX] ${payload}`].slice(-500);
              return { ...w, logs: newLogs };
            }
            return w;
          }));
        }
      } catch (e) {
        console.error('Monitor WS Parse Error', e);
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => {
      ws.removeEventListener('message', handleMessage);
    };
  }, [ws]); // 移除 widgets 依赖，避免频繁重绑监听器

  const containerRef = useRef<HTMLDivElement>(null);

  const [editingWidget, setEditingWidget] = useState<MonitorWidget | null>(null);
  const [form] = Form.useForm();

  // 层级管理：置顶逻辑
  const bringToFront = (id: string) => {
    setWidgets(prev => {
      const maxZ = Math.max(...prev.map(w => w.zIndex), 0);
      return prev.map(w =>
        w.id === id ? { ...w, zIndex: maxZ + 1 } : w
      );
    });
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // 只有点击左键且不是在组件上点击时才触发
    if (e.button !== 0) return;

    setIsDragging(true);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleWidgetMouseDown = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    bringToFront(id);
    setDraggedWidgetId(id);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleAddWidget = (type: MonitorWidget['type']) => {
    setWidgets(prev => {
      // 智能布局：寻找一个不重叠的位置
      // 算法：从当前视野中心开始，向外螺旋寻找空闲区域
      const W = 400;
      const H = 300;

      // 当前视野的中心点 (相对于画布原点)
      // 注意：offsetX 是画布相对于视口的偏移，所以视口坐标 = 组件坐标 + offsetX
      // 视口中心 (vx, vy) 对应的画布坐标 (cx, cy) = (vx - offsetX, vy - offsetY)
      const viewportW = containerRef.current?.clientWidth || 1000;
      const viewportH = containerRef.current?.clientHeight || 800;

      // 修正中心点计算：
      // 我们希望新组件出现在视口中心。
      // 视口中心点 Vcx = viewportW / 2, Vcy = viewportH / 2
      // 对应的画布坐标 Ccx = Vcx - offsetX, Ccy = Vcy - offsetY
      // 组件左上角坐标 = Ccx - W/2, Ccy - H/2
      const centerX = (viewportW / 2) - canvasState.offsetX - (W / 2);
      const centerY = (viewportH / 2) - canvasState.offsetY - (H / 2);

      let bestX = centerX;
      let bestY = centerY;
      let found = false;

      // 简单的螺旋搜索算法
      // 步长为 50px，搜索 20 圈
      for (let r = 0; r < 50; r++) {
        // 每一圈尝试 8 个方向
        const steps = Math.max(1, r * 8);
        for (let i = 0; i < steps; i++) {
          const angle = (i / steps) * 2 * Math.PI;
          const radius = r * 50;
          // 螺旋向外寻找
          const tryX = centerX + Math.cos(angle) * radius;
          const tryY = centerY + Math.sin(angle) * radius;

          // 检查碰撞
          // 简单的 AABB 碰撞检测
          const collision = prev.some(w => {
            // 检查新矩形 (tryX, tryY, W, H) 是否与现有矩形 w 重叠
            // 如果不重叠，则满足：
            // 新在旧左边 OR 新在旧右边 OR 新在旧上边 OR 新在旧下边
            // 反之则重叠
            const isSeparate = (tryX + W < w.x) || (tryX > w.x + w.width) || (tryY + H < w.y) || (tryY > w.y + w.height);
            return !isSeparate;
          });

          if (!collision) {
            bestX = tryX;
            bestY = tryY;
            found = true;
            break;
          }
        }
        if (found) break;
      }

      const newWidget: MonitorWidget = {
        id: Date.now().toString(),
        type,
        title: t('monitor.newTerminal'),
        x: bestX,
        y: bestY,
        width: W,
        height: H,
        zIndex: Math.max(...prev.map(w => w.zIndex), 0) + 1,
        // 默认显示副标题
        showSubtitle: true,
        // 初始自动发送配置
        autoSend: {
          enabled: false,
          content: '',
          encoding: 'hex'
        },
        displayMode: 'text',
        logs: [`[System] ${t('monitor.systemReady')}`, `[System] ${t('monitor.waitingData')}`]
      };

      // 创建后直接打开编辑弹窗
      setTimeout(() => {
        setEditingWidget(newWidget);
        form.setFieldsValue({
          ...newWidget,
          showSubtitle: true // 显式设置表单初始值
        });
      }, 100);

      return [...prev, newWidget];
    });
  };

  const handleSaveWidget = async () => {
    try {
      const values = await form.validate();
      if (editingWidget) {
        setWidgets(prev => prev.map(w =>
          w.id === editingWidget.id ? { ...w, ...values } : w
        ));
        setEditingWidget(null);
      }
    } catch (e) {
      // 校验失败
    }
  };

  const handleValuesChange = (changedValues: Partial<MonitorWidget>, allValues: Partial<MonitorWidget>) => {
    if (changedValues.showSubtitle !== undefined && changedValues.showSubtitle) {
      // 当开启副标题时，如果副标题为空，则自动生成
      const currentSubtitle = form.getFieldValue('subtitle');
      if (!currentSubtitle) {
        const port = form.getFieldValue('portPath');
        const baud = form.getFieldValue('baudRate');
        const data = form.getFieldValue('dataBits');
        const parity = form.getFieldValue('parity');
        const stop = form.getFieldValue('stopBits');

        if (port) {
          const parityShort = parity === 'none' ? 'N' : parity === 'even' ? 'E' : parity === 'odd' ? 'O' : parity?.charAt(0).toUpperCase();
          form.setFieldValue('subtitle', `${port} ${baud},${data}${parityShort}${stop}`);
        }
      }
    }

    // 当串口参数变更且开启了副标题显示时，实时更新副标题
    if (allValues.showSubtitle && (changedValues.portPath || changedValues.baudRate || changedValues.dataBits || changedValues.parity || changedValues.stopBits)) {
      const port = allValues.portPath || '';
      const baud = allValues.baudRate || 9600;
      const data = allValues.dataBits || 8;
      const parity = allValues.parity || 'none';
      const stop = allValues.stopBits || 1;
      const parityShort = parity === 'none' ? 'N' : parity === 'even' ? 'E' : parity === 'odd' ? 'O' : parity?.charAt(0).toUpperCase();

      form.setFieldValue('subtitle', `${port} ${baud},${data}${parityShort}${stop}`);
    }
  };

  const handleRemoveWidget = (id: string) => {
    Modal.confirm({
      title: t('monitor.deleteConfirm.title'),
      content: t('monitor.deleteConfirm.content'),
      onOk: () => {
        setWidgets(prev => prev.filter(w => w.id !== id));
        Message.success(t('monitor.deleteSuccess'));
      }
    });
  };

  const droplist = (
    <Menu>
      <Menu.Item key='terminal' onClick={() => handleAddWidget('terminal')}>
        <Space><IconCode /> {t('monitor.widget.terminal')}</Space>
      </Menu.Item>
    </Menu>
  );

  const handleToggleConnection = async (e: React.MouseEvent, widget: MonitorWidget) => {
    e.stopPropagation();
    if (!widget.portPath) {
      Message.warning(t('monitor.noPort'));
      return;
    }

    const isConnected = widget.isConnected;
    const url = isConnected ? 'http://localhost:3001/api/ports/close' : 'http://localhost:3001/api/ports/open';
    const payload = isConnected
      ? { path: widget.portPath }
      : {
        path: widget.portPath,
        baudRate: widget.baudRate || 9600,
        dataBits: widget.dataBits || 8,
        stopBits: widget.stopBits || 1,
        parity: widget.parity || 'none'
      };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.code === 0) {
        Message.success(isConnected ? t('msg.closeSuccess') : t('msg.openSuccess'));
        // 更新组件状态
        setWidgets(prev => prev.map(w =>
          w.id === widget.id ? { ...w, isConnected: !isConnected } : w
        ));
      } else {
        Message.error(json.msg);
      }
    } catch (e) {
      Message.error('Connection toggle failed');
    }
  };

  const handleManualSend = (e: React.MouseEvent, widget: MonitorWidget) => {
    e.stopPropagation();
    if (!widget.portPath) {
      Message.warning(t('monitor.noPort'));
      return;
    }
    if (!widget.autoSend?.content) {
      Message.warning(t('monitor.config.noContent'));
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      Message.error('WebSocket not connected');
      return;
    }

    const payload = {
      type: 'serial:send',
      path: widget.portPath,
      data: widget.autoSend.content,
      encoding: widget.autoSend.encoding || 'hex'
    };
    ws.send(JSON.stringify(payload));

    setWidgets(prev => prev.map(w => {
      if (w.id === widget.id) {
        const sentLog = `[${widget.portPath}-TX] ${widget.autoSend?.content}`;
        const newLogs = [...(w.logs || []), sentLog].slice(-500);
        return { ...w, logs: newLogs };
      }
      return w;
    }));
    Message.success('Sent!');
  };

  const handleResizeMouseDown = (e: React.MouseEvent, id: string, width: number, height: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // 不要调用 bringToFront(id)，否则会导致 React 重新排序 DOM，打断 Resize 过程
    // 可以在 Resize 结束后调用 bringToFront，或者仅在视觉上修改 z-index 而不改变数组顺序
    setResizingWidgetId(id);
    setResizeStart({ x: e.clientX, y: e.clientY, width, height });
    lastMousePos.current = { x: e.clientX, y: e.clientY }; // 记录初始位置，防止第一帧跳变
  };

  // 使用 requestAnimationFrame 优化缩放和拖拽
  const rafRef = useRef<number>();

  // 全局鼠标事件监听
  useEffect(() => {
    const onGlobalMove = (e: MouseEvent) => {
      // 使用 requestAnimationFrame 节流渲染
      if (rafRef.current) return;

      rafRef.current = requestAnimationFrame(() => {
        if (resizingWidgetId && resizeStart) {
          const deltaX = (e.clientX - resizeStart.x) / canvasState.scale;
          const deltaY = (e.clientY - resizeStart.y) / canvasState.scale;

          setWidgets(prev => prev.map(w =>
            w.id === resizingWidgetId ? {
              ...w,
              width: Math.max(200, resizeStart.width + deltaX),
              height: Math.max(150, resizeStart.height + deltaY)
            } : w
          ));
        } else {
          const deltaX = e.clientX - lastMousePos.current.x;
          const deltaY = e.clientY - lastMousePos.current.y;

          if (isDragging) {
            setCanvasState(prev => ({
              ...prev,
              offsetX: prev.offsetX + deltaX,
              offsetY: prev.offsetY + deltaY
            }));
          } else if (draggedWidgetId) {
            setWidgets(prev => prev.map(w =>
              w.id === draggedWidgetId ? { ...w, x: w.x + deltaX, y: w.y + deltaY } : w
            ));
          }
        }

        lastMousePos.current = { x: e.clientX, y: e.clientY };
        rafRef.current = undefined;
      });
    };

    const onGlobalUp = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = undefined;
      }
      setIsDragging(false);
      setDraggedWidgetId(null);
      setResizingWidgetId(null);
      setResizeStart(null);
    };

    if (isDragging || draggedWidgetId || resizingWidgetId) {
      window.addEventListener('mousemove', onGlobalMove);
      window.addEventListener('mouseup', onGlobalUp);
    }

    return () => {
      window.removeEventListener('mousemove', onGlobalMove);
      window.removeEventListener('mouseup', onGlobalUp);
    };
  }, [isDragging, draggedWidgetId, resizingWidgetId, resizeStart, canvasState.scale]);

  // 网格背景样式
  const gridStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundImage: `
      linear-gradient(#e5e6eb 1px, transparent 1px),
      linear-gradient(90deg, #e5e6eb 1px, transparent 1px)
    `,
    backgroundSize: '20px 20px',
    backgroundPosition: `${canvasState.offsetX}px ${canvasState.offsetY}px`,
    opacity: 0.5,
    pointerEvents: 'none', // 让网格不阻挡鼠标事件
    zIndex: 0
  };

  return (
    <div
      ref={containerRef}
      className="monitor-canvas-container"
      style={{
        width: '100%',
        height: 'calc(100vh - 64px)', // 减去头部高度
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: '#f4f5f7',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none'
      }}
      onMouseDown={handleCanvasMouseDown}
    >
      {/* 网格背景 */}
      <div style={gridStyle} />

      {/* 调试信息 (可选) */}
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 9999, background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '4px 8px', borderRadius: 4, fontSize: 12, pointerEvents: 'none' }}>
        Canvas: ({Math.round(canvasState.offsetX)}, {Math.round(canvasState.offsetY)})
      </div>

      {/* 编辑弹窗 */}
      <Modal
        title={t('monitor.config.title')}
        visible={!!editingWidget}
        onOk={handleSaveWidget}
        onCancel={() => setEditingWidget(null)}
        autoFocus={false}
        focusLock={true}
      >
        <Form form={form} layout="vertical" onValuesChange={handleValuesChange}>
          <Form.Item label={t('monitor.config.titleField')} required>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Form.Item field="title" rules={[{ required: true }]} noStyle>
                  <Input placeholder={t('monitor.config.titlePlaceholder')} />
                </Form.Item>
              </div>
              <div style={{ flex: 1 }}>
                <Form.Item field="subtitle" noStyle>
                  <Input placeholder={t('monitor.config.subtitlePlaceholder')} />
                </Form.Item>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <Space>
                <Space>
                  <Typography.Text>{t('monitor.config.showSubtitle')}</Typography.Text>
                  <Form.Item field="showSubtitle" triggerPropName="checked" noStyle initialValue={true}>
                    <Switch />
                  </Form.Item>
                </Space>
                <Divider type="vertical" />
                <Space>
                  <Typography.Text>{t('monitor.config.autoSend')}</Typography.Text>
                  <Form.Item field="autoSend.enabled" triggerPropName="checked" noStyle initialValue={false}>
                    <Switch />
                  </Form.Item>
                </Space>
              </Space>
            </div>
          </Form.Item>
          {editingWidget?.type === 'terminal' && (
            <>
              <Form.Item label={t('monitor.config.displayMode')} field="displayMode" initialValue="text">
                <Radio.Group type="button">
                  <Radio value="auto">{t('monitor.display.auto')}</Radio>
                  <Radio value="text">{t('text.text')}</Radio>
                  <Radio value="hex">{t('text.hex')}</Radio>
                </Radio.Group>
              </Form.Item>

              {/* 自动发送配置区域 (仅当启用时显示) */}
              <Form.Item noStyle shouldUpdate={(prev, current) => prev.autoSend?.enabled !== current.autoSend?.enabled}>
                {(values) => {
                  return values.autoSend?.enabled ? (
                    <div style={{ marginBottom: 24, padding: 12, background: '#f8f9fb', borderRadius: 4 }}>
                      <Form.Item label={t('input.encoding')} field="autoSend.encoding" initialValue="hex" style={{ marginBottom: 12 }}>
                        <Radio.Group type="button">
                          <Radio value="hex">Hex</Radio>
                          <Radio value="utf8">Text</Radio>
                        </Radio.Group>
                      </Form.Item>
                      <Form.Item label={t('monitor.config.sendContent')} field="autoSend.content" style={{ marginBottom: 0 }}>
                        <Input placeholder="00 or WakeUp" />
                      </Form.Item>
                    </div>
                  ) : null;
                }}
              </Form.Item>

              <Form.Item label={t('monitor.config.portField')} field="portPath" rules={[{ required: true }]}>
                <Select
                  placeholder={t('monitor.selectPort')}
                  onFocus={() => onRefreshPorts && onRefreshPorts()}
                >
                  {portList.map(port => (
                    <Select.Option key={port} value={port}>{port}</Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <Form.Item label={t('port.baudRate')} field="baudRate" initialValue={9600}>
                    <Select>
                      <Select.Option value={115200}>115200</Select.Option>
                      <Select.Option value={921600}>921600</Select.Option>
                      <Select.Option value={9600}>9600</Select.Option>
                      <Select.Option value={19200}>19200</Select.Option>
                      <Select.Option value={38400}>38400</Select.Option>
                      <Select.Option value={57600}>57600</Select.Option>
                    </Select>
                  </Form.Item>
                </div>
                <div style={{ flex: 1 }}>
                  <Form.Item label={t('port.dataBits')} field="dataBits" initialValue={8}>
                    <Select>
                      <Select.Option value={8}>8</Select.Option>
                      <Select.Option value={7}>7</Select.Option>
                    </Select>
                  </Form.Item>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <Form.Item label={t('port.stopBits')} field="stopBits" initialValue={1}>
                    <Select>
                      <Select.Option value={1}>1</Select.Option>
                      <Select.Option value={2}>2</Select.Option>
                    </Select>
                  </Form.Item>
                </div>
                <div style={{ flex: 1 }}>
                  <Form.Item label={t('port.parity')} field="parity" initialValue="none">
                    <Select>
                      <Select.Option value="none">None</Select.Option>
                      <Select.Option value="even">Even</Select.Option>
                      <Select.Option value="odd">Odd</Select.Option>
                    </Select>
                  </Form.Item>
                </div>
              </div>
            </>
          )}
        </Form>
      </Modal>

      {/* 悬浮添加按钮 */}
      <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 1000 }}>
        <Dropdown droplist={droplist} position='br'>
          <Button type='primary' shape='circle' size='large' icon={<IconPlus />} style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.2)' }} />
        </Dropdown>
      </div>

      {/* 渲染循环 */}
      {widgets.map(widget => (
        <div
          key={widget.id}
          className="monitor-widget"
          style={{
            position: 'absolute',
            // 核心位置计算：组件坐标 + 画布偏移
            left: widget.x + canvasState.offsetX,
            top: widget.y + canvasState.offsetY,
            width: widget.width,
            height: widget.height,
            zIndex: widget.zIndex,
            // 样式美化
            backgroundColor: '#fff',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            borderRadius: '4px',
            border: '1px solid #e5e6eb',
            display: 'flex',
            flexDirection: 'column',
            transition: 'box-shadow 0.2s, transform 0.1s',
          }}
          // 点击组件时置顶，并阻止事件冒泡（防止触发画布拖拽）
          onMouseDown={(e) => handleWidgetMouseDown(e, widget.id)}
        >
          {/* 组件标题栏 */}
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
                    setEditingWidget(widget);
                    form.setFieldsValue(widget);
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
              {/* 连接开关 */}
              <Tooltip content={widget.isConnected ? t('monitor.disconnect') : t('monitor.connect')}>
                <Button
                  type={widget.isConnected ? 'primary' : 'secondary'}
                  status={widget.isConnected ? 'success' : 'default'}
                  size="mini"
                  icon={widget.isConnected ? <IconLink /> : <IconStop />}
                  onClick={(e) => handleToggleConnection(e as any, widget)}
                />
              </Tooltip>

              {/* 手动唤醒按钮 */}
              {widget.autoSend?.enabled && (
                <Tooltip content={t('monitor.manualSend')}>
                  <Button
                    type="text"
                    size="mini"
                    icon={<IconThunderbolt />}
                    onClick={(e) => handleManualSend(e as any, widget)}
                  />
                </Tooltip>
              )}
              <Button
                type="text"
                size="mini"
                icon={<IconSettings />}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingWidget(widget);
                  form.setFieldsValue(widget);
                }}
              />
              <Button
                type="text"
                size="mini"
                status="danger"
                icon={<IconClose />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveWidget(widget.id);
                }}
              />
            </Space>
          </div>

          {/* 组件内容区 */}
          <div style={{ flex: 1, padding: 12, overflow: 'auto', position: 'relative' }}>
            {widget.type === 'terminal' && (
              <TerminalLogView logs={widget.logs || []} emptyText={t('panel.noLogs')} height="100%" />
            )}
          </div>

          {/* 调整大小手柄 */}
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
            onMouseDown={(e) => {
              handleResizeMouseDown(e, widget.id, widget.width, widget.height);
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#86909c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v6h-6" />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
}
