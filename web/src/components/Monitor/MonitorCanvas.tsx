import React, { useState, useRef, useEffect, useCallback } from 'react';
import { IconPlus, IconCode, IconDownload } from '@arco-design/web-react/icon';
import { Button, Space, Typography, Dropdown, Menu, Modal, Form, Input, Select, Tooltip, Grid, Switch, Divider, Radio, Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { MonitorWidget, CanvasState } from './types';
import TerminalWidget from './TerminalWidget';
import { useSerialPortController } from '../../hooks/useSerialPortController';
import { inferSerialReason } from '../../utils/serialReason';

const { Row, Col } = Grid;

// 初始状态为空
const INITIAL_WIDGETS: MonitorWidget[] = [];
const MONITOR_LAYOUT_STORAGE_KEY = 'monitorCanvasLayoutV1';

type StoredMonitorWidgetV1 = Omit<MonitorWidget, 'logs' | 'isConnected'>;
type StoredMonitorLayoutV1 = {
  version: 1;
  canvasState: CanvasState;
  widgets: StoredMonitorWidgetV1[];
};

export default function MonitorCanvas(props: { ws: WebSocket | null; wsConnected: boolean; portList?: string[]; onRefreshPorts?: () => void }) {
  const { t } = useTranslation();
  const { ws, wsConnected, portList = [], onRefreshPorts } = props;
  const serial = useSerialPortController({ ws });
  const [widgets, setWidgets] = useState<MonitorWidget[]>(INITIAL_WIDGETS);
  const normalizePath = (p?: string) => (p || '').toLowerCase().replace(/^\\\\.\\/, '');
  const normalizeTitle = (s?: string) => (s || '').trim().toLowerCase();
  const getDefaultWidgetName = (type?: MonitorWidget['type']) => {
    if (type === 'chart') return t('monitor.newChart');
    if (type === 'status') return t('monitor.statusPanel');
    return t('monitor.newTerminal');
  };
  const makeUniqueTitle = (base: string, used: Set<string>) => {
    const rawBase = (base || '').trim();
    const realBase = rawBase || t('monitor.newTerminal');
    const baseKey = normalizeTitle(realBase);
    if (!used.has(baseKey)) {
      used.add(baseKey);
      return realBase;
    }
    let n = 2;
    while (true) {
      const candidate = `${realBase} (${n})`;
      const key = normalizeTitle(candidate);
      if (!used.has(key)) {
        used.add(key);
        return candidate;
      }
      n += 1;
    }
  };
  const ensureUniqueTerminalTitles = (list: MonitorWidget[]) => {
    const used = new Set<string>();
    return list.map(w => {
      if (w.type !== 'terminal') return w;
      const base = (w.title || '').trim() || t('monitor.newTerminal');
      const title = makeUniqueTitle(base, used);
      if (title === w.title) return w;
      return { ...w, title };
    });
  };

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
      .monitor-canvas-container {
        background: radial-gradient(1200px 800px at 20% 0%, rgba(51, 112, 255, 0.06) 0%, rgba(244, 245, 247, 0.9) 55%, rgba(244, 245, 247, 1) 100%);
      }
      .monitor-widget {
        will-change: transform, opacity;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);
  const defaultCanvasState: CanvasState = { offsetX: 0, offsetY: 0, scale: 1 };
  const [canvasState, setCanvasState] = useState<CanvasState>(defaultCanvasState);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
  const [resizingWidgetId, setResizingWidgetId] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const decoderRef = useRef<TextDecoder>(new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }));
  const [restoreChecked, setRestoreChecked] = useState(false);
  const lastPersistRef = useRef<string>('');
  const saveTimerRef = useRef<number | null>(null);
  const restorePromptShownRef = useRef(false);
  const lastStatusErrorByPathRef = useRef<Record<string, string>>({});

  const syncConnectionsFromServer = async (seed?: MonitorWidget[]) => {
    const list = await serial.refreshPorts(true);
    const portsList = list || serial.allPorts;
    const statusMap: Record<string, { status: string; lastError?: string }> = {};
    portsList.forEach(p => {
      statusMap[normalizePath(p.path)] = { status: p.status, lastError: p.lastError };
    });
    setWidgets(prev => {
      const base = seed || prev;
      const next = base.map(w => {
        if (!w.portPath) return w;
        const status = statusMap[normalizePath(w.portPath)]?.status || 'closed';
        if (status === 'open') return { ...w, isConnected: true };
        return { ...w, isConnected: false };
      });
      return seed ? next : next;
    });
  };

  const sanitizeWidgetForStorage = (w: MonitorWidget): StoredMonitorWidgetV1 => ({
    id: w.id,
    type: w.type,
    title: w.title,
    x: w.x,
    y: w.y,
    width: w.width,
    height: w.height,
    zIndex: w.zIndex,
    portPath: w.portPath,
    baudRate: w.baudRate,
    dataBits: w.dataBits,
    stopBits: w.stopBits,
    parity: w.parity,
    subtitle: w.subtitle,
    showSubtitle: w.showSubtitle,
    autoSend: w.autoSend,
    displayMode: w.displayMode
  });

  const hydrateWidgetFromStorage = (w: Partial<StoredMonitorWidgetV1>): MonitorWidget => {
    const id = w.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const type = (w.type as MonitorWidget['type']) || 'terminal';
    const autoSend = w.autoSend
      ? {
        enabled: !!w.autoSend.enabled,
        content: w.autoSend.content || '',
        encoding: w.autoSend.encoding === 'utf8' ? 'utf8' : 'hex'
      }
      : { enabled: false, content: '', encoding: 'hex' as const };
    const displayMode = w.displayMode || 'text';

    return {
      id,
      type,
      title: w.title || t('monitor.newTerminal'),
      x: typeof w.x === 'number' ? w.x : 0,
      y: typeof w.y === 'number' ? w.y : 0,
      width: typeof w.width === 'number' ? w.width : 640,
      height: typeof w.height === 'number' ? w.height : 480,
      zIndex: typeof w.zIndex === 'number' ? w.zIndex : 1,
      portPath: w.portPath,
      baudRate: w.baudRate || 9600,
      dataBits: w.dataBits || 8,
      stopBits: w.stopBits || 1,
      parity: w.parity || 'none',
      subtitle: w.subtitle,
      showSubtitle: w.showSubtitle ?? true,
      autoSend: autoSend as { enabled: boolean; content: string; encoding: 'hex' | 'utf8' },
      displayMode,
      logs: [`[System] ${t('monitor.systemReady')}`, `[System] ${t('monitor.waitingData')}`],
      isConnected: false
    };
  };

  useEffect(() => {
    if (restorePromptShownRef.current) return;
    restorePromptShownRef.current = true;

    const raw = localStorage.getItem(MONITOR_LAYOUT_STORAGE_KEY);
    if (!raw) {
      setRestoreChecked(true);
      return;
    }

    let parsed: StoredMonitorLayoutV1 | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      localStorage.removeItem(MONITOR_LAYOUT_STORAGE_KEY);
      setRestoreChecked(true);
      return;
    }

    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.widgets)) {
      localStorage.removeItem(MONITOR_LAYOUT_STORAGE_KEY);
      setRestoreChecked(true);
      return;
    }

    Modal.confirm({
      title: t('monitor.layout.restoreTitle'),
      content: t('monitor.layout.restoreContent'),
      okText: t('monitor.layout.restoreOk'),
      cancelText: t('monitor.layout.restoreCancel'),
      onOk: () => {
        const nextCanvas = parsed?.canvasState && typeof parsed.canvasState === 'object' ? parsed.canvasState : defaultCanvasState;
        const nextWidgets = parsed?.widgets ? parsed.widgets.map(hydrateWidgetFromStorage) : [];
        setCanvasState(nextCanvas);
        const fixedWidgets = ensureUniqueTerminalTitles(nextWidgets);
        setWidgets(fixedWidgets);
        setRestoreChecked(true);
        setTimeout(() => {
          syncConnectionsFromServer(fixedWidgets);
        }, 0);
      },
      onCancel: () => {
        localStorage.removeItem(MONITOR_LAYOUT_STORAGE_KEY);
        setCanvasState(defaultCanvasState);
        setWidgets([]);
        setRestoreChecked(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!restoreChecked) return;

    if (widgets.length === 0) {
      localStorage.removeItem(MONITOR_LAYOUT_STORAGE_KEY);
      lastPersistRef.current = '';
      return;
    }

    const payload: StoredMonitorLayoutV1 = {
      version: 1,
      canvasState,
      widgets: widgets.map(sanitizeWidgetForStorage)
    };

    const persistString = JSON.stringify(payload);
    if (persistString === lastPersistRef.current) return;

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    saveTimerRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(MONITOR_LAYOUT_STORAGE_KEY, persistString);
        lastPersistRef.current = persistString;
      } catch (e) {
      }
    }, 300);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [restoreChecked, widgets, canvasState]);

  // WebSocket 数据处理
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        // console.log('[Monitor] WS Message:', msg); // 调试日志

        // 监听串口状态变更，同步更新 isConnected 状态
        if (msg.type === 'serial:status') {
          const { path, status, error } = msg;
          const msgPath = normalizePath(path);

          setWidgets(prev => prev.map(w => {
            const widgetPath = normalizePath(w.portPath);
            if (widgetPath === msgPath) {
              const connected = status === 'open';
              let next = w;
              if (w.isConnected !== connected) {
                next = { ...next, isConnected: connected };
              }
              if (status === 'error' && error) {
                const reason = inferSerialReason(String(error));
                const prevErr = lastStatusErrorByPathRef.current[msgPath];
                if (prevErr !== String(error)) {
                  lastStatusErrorByPathRef.current[msgPath] = String(error);
                  Message.error(`${path} 无法连接：${reason}`);
                }
                const newLogs = [...(next.logs || []), `[System] ${path} 无法连接：${reason}`].slice(-500);
                next = { ...next, logs: newLogs };
              }
              return next;
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
              if (!w.isConnected) return w;
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
  const [appearingIds, setAppearingIds] = useState<Record<string, true>>({});
  const [removingIds, setRemovingIds] = useState<Record<string, true>>({});
  const [form] = Form.useForm();

  useEffect(() => {
    if (!editingWidget) return;
    setIsDragging(false);
    setDraggedWidgetId(null);
    setResizingWidgetId(null);
    setResizeStart(null);
  }, [editingWidget]);

  const openWidgetConfig = useCallback((widget: MonitorWidget) => {
    setEditingWidget(widget);
    form.resetFields();
    form.setFieldsValue(widget);
  }, [form]);

  const updateWidgetById = useCallback((id: string, updater: (w: MonitorWidget) => MonitorWidget) => {
    setWidgets(prev => {
      const idx = prev.findIndex(w => w.id === id);
      if (idx < 0) return prev;
      const nextW = updater(prev[idx]);
      if (nextW === prev[idx]) return prev;
      const next = prev.slice();
      next[idx] = nextW;
      return next;
    });
  }, []);

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
    if (editingWidget) return;
    if (e.button !== 0) return;

    setIsDragging(true);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleWidgetMouseDown = (e: React.MouseEvent, id: string) => {
    if (editingWidget) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    bringToFront(id);
    setDraggedWidgetId(id);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleAddWidget = (type: MonitorWidget['type']) => {
    let createdId: string | null = null;
    setWidgets(prev => {
      // 智能布局：寻找一个不重叠的位置
      // 算法：从当前视野中心开始，向外螺旋寻找空闲区域
      const W = 640;
      const H = 480;

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

      const usedTitles = new Set<string>();
      prev.forEach(w => {
        if (w.type === 'terminal') usedTitles.add(normalizeTitle(w.title));
      });
      const baseTitle = getDefaultWidgetName(type);
      const newTitle = type === 'terminal' ? makeUniqueTitle(baseTitle, usedTitles) : baseTitle;
      const newWidget: MonitorWidget = {
        id: Date.now().toString(),
        type,
        title: newTitle,
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
      createdId = newWidget.id;

      // 创建后直接打开编辑弹窗
      setTimeout(() => {
        openWidgetConfig(newWidget);
      }, 100);

      return [...prev, newWidget];
    });
    if (createdId) {
      setAppearingIds(prev => ({ ...prev, [createdId as string]: true }));
      window.setTimeout(() => {
        setAppearingIds(prev => {
          const next = { ...prev };
          delete next[createdId as string];
          return next;
        });
      }, 30);
    }
  };

  const handleSaveWidget = async () => {
    try {
      const values = await form.validate();
      if (editingWidget) {
        const nextValues: any = { ...values };
        if (typeof nextValues.title === 'string') {
          nextValues.title = nextValues.title.trim();
        }
        setWidgets(prev => prev.map(w =>
          w.id === editingWidget.id ? { ...w, ...nextValues } : w
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
    const target = widgets.find(w => w.id === id) || null;
    Modal.confirm({
      title: t('monitor.deleteConfirm.title'),
      content: t('monitor.deleteConfirm.content'),
      onOk: async () => {
        if (target?.type === 'terminal' && target.portPath) {
          const key = normalizePath(target.portPath);
          const isOpenOnServer = serial.allPorts.some(p => normalizePath(p.path) === key && p.status === 'open');
          const shouldClose = !!target.isConnected || isOpenOnServer;
          if (shouldClose) {
            try {
              Message.info('正在断开...');
              await serial.closePort(target.portPath);
              await syncConnectionsFromServer();
              Message.success(`${target.portPath} 已断开`);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              Message.error(msg || '断开失败');
              throw e;
            }
          }
        }
        setRemovingIds(prev => ({ ...prev, [id]: true }));
        window.setTimeout(() => {
          setWidgets(prev => prev.filter(w => w.id !== id));
          if (editingWidget?.id === id) {
            setEditingWidget(null);
          }
          setRemovingIds(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          Message.success(t('monitor.deleteSuccess'));
        }, 180);
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
      if (isConnected) {
        Message.info('正在断开...');
        await serial.closePort(widget.portPath);
        Message.success(`${widget.portPath} 已断开`);
      } else {
        Message.info('正在连接...');
        await serial.openPort(payload as any);
        Message.success(`${widget.portPath} 已连接`);
      }
      await syncConnectionsFromServer();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isConnected) {
        const reason = inferSerialReason(msg);
        Message.error(`${widget.portPath} 无法连接：${reason || msg || '连接失败'}`);
      } else {
        Message.error(msg || '断开失败');
      }
      await syncConnectionsFromServer();
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
    if (editingWidget) return;
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
      if (editingWidget) return;
      // 使用 requestAnimationFrame 节流渲染
      if (rafRef.current) return;

      rafRef.current = requestAnimationFrame(() => {
        if (resizingWidgetId && resizeStart) {
          const deltaX = (e.clientX - resizeStart.x) / canvasState.scale;
          const deltaY = (e.clientY - resizeStart.y) / canvasState.scale;
          updateWidgetById(resizingWidgetId, (w) => ({
            ...w,
            width: Math.max(200, resizeStart.width + deltaX),
            height: Math.max(150, resizeStart.height + deltaY)
          }));
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
            updateWidgetById(draggedWidgetId, (w) => ({ ...w, x: w.x + deltaX, y: w.y + deltaY }));
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
  }, [isDragging, draggedWidgetId, resizingWidgetId, resizeStart, canvasState.scale, editingWidget, updateWidgetById]);

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

  const handleExportLayout = () => {
    try {
      const payload: StoredMonitorLayoutV1 & { exportedAt: string } = {
        version: 1,
        exportedAt: new Date().toISOString(),
        canvasState,
        widgets: widgets.map(sanitizeWidgetForStorage)
      };

      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const filename = `monitor-layout-${new Date().toISOString().slice(0, 10)}.json`;
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);
      Message.success(t('monitor.layout.exportSuccess'));
    } catch (e) {
      Message.error(t('monitor.layout.exportFailed'));
    }
  };

  return (
    <div
      ref={containerRef}
      className="monitor-canvas-container"
      style={{
        width: '100%',
        height: '100%',
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

      {/* 编辑弹窗 */}
      <Modal
        title={t('monitor.config.modalTitle', { name: (editingWidget?.title || '').trim() || getDefaultWidgetName(editingWidget?.type) })}
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
                <Form.Item
                  field="title"
                  rules={[
                    {
                      validator: (value, callback) => {
                        const title = String(value ?? '').trim();
                        if (!title) {
                          callback(t('monitor.validation.titleRequired'));
                          return;
                        }
                        if (!/[\p{L}\p{N}]/u.test(title)) {
                          callback(t('monitor.validation.titleInvalid'));
                          return;
                        }
                        const key = normalizeTitle(title);
                        const dup = widgets.some(w => w.type === 'terminal' && normalizeTitle(w.title) === key && w.id !== editingWidget?.id);
                        if (dup) {
                          callback(t('monitor.validation.titleDuplicate'));
                          return;
                        }
                        callback();
                      }
                    }
                  ]}
                  noStyle
                >
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

              <Form.Item
                label={t('monitor.config.portField')}
                field="portPath"
                rules={[
                  { required: true },
                  {
                    validator: (value, callback) => {
                      const cur = String(value ?? '').trim();
                      if (!cur) {
                        callback();
                        return;
                      }
                      const key = normalizePath(cur);
                      const allowKey = normalizePath(editingWidget?.portPath);
                      const isOpenOnServer = serial.allPorts.some(p => normalizePath(p.path) === key && p.status === 'open');
                      if (isOpenOnServer && key !== allowKey) {
                        callback(t('monitor.validation.portInUse'));
                        return;
                      }
                      callback();
                    }
                  }
                ]}
              >
                <Select
                  placeholder={t('monitor.selectPort')}
                  onFocus={() => {
                    serial.refreshPorts(true).then((list) => {
                      const cur = form.getFieldValue('portPath');
                      if (!cur) return;
                      const key = normalizePath(cur);
                      const allowKey = normalizePath(editingWidget?.portPath);
                      const portsList = list || serial.allPorts;
                      const isOpenOnServer = portsList.some(p => normalizePath(p.path) === key && p.status === 'open');
                      if (isOpenOnServer && key !== allowKey) {
                        form.setFieldValue('portPath', undefined);
                      }
                    });
                    onRefreshPorts && onRefreshPorts();
                  }}
                >
                  {portList.map(port => {
                    const currentSelectedKey = normalizePath(editingWidget?.portPath);
                    const portKey = normalizePath(port);
                    const isOpenOnServer = serial.allPorts.some(p => normalizePath(p.path) === portKey && p.status === 'open');
                    const disabled = isOpenOnServer && portKey !== currentSelectedKey;
                    const label = disabled ? `${port} (${t('monitor.portInUse')})` : port;
                    return (
                      <Select.Option key={port} value={port} disabled={disabled}>
                        {label}
                      </Select.Option>
                    );
                  })}
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
        <Space>
          <Tooltip content={t('monitor.layout.export')}>
            <Button shape='circle' size='large' icon={<IconDownload />} onClick={handleExportLayout} style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.2)' }} />
          </Tooltip>
          <Dropdown droplist={droplist} position='br'>
            <Button type='primary' shape='circle' size='large' icon={<IconPlus />} style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.2)' }} />
          </Dropdown>
        </Space>
      </div>

      {/* 渲染循环 */}
      {widgets.map(widget => (
        widget.type === 'terminal' ? (
          <TerminalWidget
            key={widget.id}
            widget={widget}
            canvasState={canvasState}
            isDragging={isDragging}
            draggedWidgetId={draggedWidgetId}
            resizingWidgetId={resizingWidgetId}
            appearing={!!appearingIds[widget.id]}
            removing={!!removingIds[widget.id]}
            onMouseDown={handleWidgetMouseDown}
            onToggleConnection={(e, w) => handleToggleConnection(e as any, w)}
            onManualSend={(e, w) => handleManualSend(e as any, w)}
            onOpenConfig={openWidgetConfig}
            onRemove={handleRemoveWidget}
            onResizeMouseDown={handleResizeMouseDown}
          />
        ) : null
      ))}
    </div>
  );
}
