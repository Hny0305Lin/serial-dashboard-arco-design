import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { IconPlus, IconCode, IconDownload, IconMinus, IconSync, IconUnorderedList } from '@arco-design/web-react/icon';
import { Button, Space, Typography, Dropdown, Menu, Modal, Form, Tooltip, Grid, Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { MonitorWidget, CanvasState } from './types';
import TerminalWidget from './TerminalWidget';
import MonitorWidgetConfigModal from './MonitorWidgetConfigModal';
import { useSerialPortController } from '../../hooks/useSerialPortController';
import { inferSerialReason } from '../../utils/serialReason';

const { Row, Col } = Grid;

// 初始状态为空
const INITIAL_WIDGETS: MonitorWidget[] = [];
const MONITOR_LAYOUT_STORAGE_KEY = 'monitorCanvasLayoutV1';
const FLOATING_PORTAL_Z_INDEX = 150;

type StoredMonitorWidgetV1 = Omit<MonitorWidget, 'logs' | 'isConnected' | 'lastRxAt'>;
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
      .terminal-rx-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #00b42a;
        opacity: 0;
      }
      .terminal-rx-dot--pulse {
        opacity: 1;
        animation: terminal-rx-breathe 0.9s ease-in-out infinite;
      }
      @keyframes terminal-rx-breathe {
        0% { transform: scale(0.9); box-shadow: 0 0 0 0 rgba(0, 180, 42, 0.45); }
        50% { transform: scale(1.1); box-shadow: 0 0 0 6px rgba(0, 180, 42, 0); }
        100% { transform: scale(0.9); box-shadow: 0 0 0 0 rgba(0, 180, 42, 0); }
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
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

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
              return { ...w, logs: newLogs, lastRxAt: Date.now() };
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
  const floatingActionsRef = useRef<HTMLDivElement>(null);
  const floatingActionsRafRef = useRef<number | null>(null);
  const [floatingActionsPos, setFloatingActionsPos] = useState<{ top: number; right: number } | null>(null);
  const [floatingZoomPos, setFloatingZoomPos] = useState<{ bottom: number; right: number } | null>(null);
  const [floatingActivePos, setFloatingActivePos] = useState<{ bottom: number; left: number } | null>(null);
  const canUseDom = typeof window !== 'undefined' && typeof document !== 'undefined';

  const updateFloatingActionsPos = useCallback(() => {
    if (!canUseDom) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const top = Math.round(rect.top + 20);
    const right = Math.round(window.innerWidth - rect.right + 20);
    const bottom = Math.round(window.innerHeight - rect.bottom + 20);
    const left = Math.round(rect.left + 20);
    setFloatingActionsPos((prev) => {
      if (prev && Math.abs(prev.top - top) < 1 && Math.abs(prev.right - right) < 1) return prev;
      return { top, right };
    });
    setFloatingZoomPos((prev) => {
      if (prev && Math.abs(prev.bottom - bottom) < 1 && Math.abs(prev.right - right) < 1) return prev;
      return { bottom, right };
    });
    setFloatingActivePos((prev) => {
      if (prev && Math.abs(prev.bottom - bottom) < 1 && Math.abs(prev.left - left) < 1) return prev;
      return { bottom, left };
    });
  }, [canUseDom]);

  useEffect(() => {
    if (!canUseDom) return;
    updateFloatingActionsPos();
    const onUpdate = () => {
      if (floatingActionsRafRef.current) return;
      floatingActionsRafRef.current = window.requestAnimationFrame(() => {
        floatingActionsRafRef.current = null;
        updateFloatingActionsPos();
      });
    };
    window.addEventListener('resize', onUpdate);
    window.addEventListener('scroll', onUpdate, true);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(onUpdate);
      ro.observe(containerRef.current);
    }
    return () => {
      window.removeEventListener('resize', onUpdate);
      window.removeEventListener('scroll', onUpdate, true);
      if (floatingActionsRafRef.current) {
        window.cancelAnimationFrame(floatingActionsRafRef.current);
        floatingActionsRafRef.current = null;
      }
      if (ro) ro.disconnect();
    };
  }, [canUseDom, updateFloatingActionsPos]);

  useEffect(() => {
    if (!canUseDom) return;
    updateFloatingActionsPos();
    window.setTimeout(() => {
      updateFloatingActionsPos();
    }, 0);
  }, [canUseDom, widgets.length, updateFloatingActionsPos]);

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

  const canvasStateRef = useRef(canvasState);
  const panRafRef = useRef<number | null>(null);

  useEffect(() => {
    canvasStateRef.current = canvasState;
  }, [canvasState]);

  const stopPan = useCallback(() => {
    if (panRafRef.current) {
      window.cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isDragging || draggedWidgetId || resizingWidgetId) {
      stopPan();
    }
  }, [isDragging, draggedWidgetId, resizingWidgetId, stopPan]);

  const animatePanTo = useCallback((toOffsetX: number, toOffsetY: number) => {
    if (!canUseDom) return;
    stopPan();
    const from = canvasStateRef.current;
    const start = performance.now();
    const duration = 260;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const k = 1 - Math.pow(1 - t, 3);
      setCanvasState(prev => ({
        ...prev,
        offsetX: from.offsetX + (toOffsetX - from.offsetX) * k,
        offsetY: from.offsetY + (toOffsetY - from.offsetY) * k
      }));
      if (t < 1) {
        panRafRef.current = window.requestAnimationFrame(step);
      } else {
        panRafRef.current = null;
      }
    };
    panRafRef.current = window.requestAnimationFrame(step);
  }, [canUseDom, stopPan]);

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
      // 当前映射：screen = world * scale + offset
      // 对应世界坐标中心 Ccx = (Vcx - offsetX) / scale, Ccy = (Vcy - offsetY) / scale
      // 组件左上角坐标 = Ccx - W/2, Ccy - H/2
      const scale = canvasState.scale || 1;
      const centerX = ((viewportW / 2) - canvasState.offsetX) / scale - (W / 2);
      const centerY = ((viewportH / 2) - canvasState.offsetY) / scale - (H / 2);

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
    const name = (target?.title || '').trim() || getDefaultWidgetName(target?.type);
    Modal.confirm({
      title: `删除${name}组件`,
      content: t('monitor.deleteConfirm.content'),
      okButtonProps: { type: 'primary' },
      onOk: () => {
        const delay = new Promise<void>((resolve) => window.setTimeout(resolve, 800));
        const work = (async () => {
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
        })();
        return Promise.all([work, delay]).then(() => undefined).catch(async (e) => {
          await delay;
          throw e;
        });
      },
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
  const MIN_TERMINAL_WIDTH = 360;
  const MAX_TERMINAL_WIDTH: number | null = null;
  const ZOOM_STEPS = [0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  const MIN_CANVAS_SCALE = ZOOM_STEPS[0];
  const MAX_CANVAS_SCALE = ZOOM_STEPS[ZOOM_STEPS.length - 1];

  const clampScale = (s: number) => Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, s));

  const clampOffsets = useCallback((scale: number, offsetX: number, offsetY: number) => {
    const el = containerRef.current;
    if (!el) return { offsetX, offsetY };
    if (!widgets.length) return { offsetX, offsetY };
    const rect = el.getBoundingClientRect();
    const viewportW = el.clientWidth || rect.width;
    const viewportH = el.clientHeight || rect.height;
    const padding = 20;
    const minX = Math.min(...widgets.map(w => w.x));
    const minY = Math.min(...widgets.map(w => w.y));
    const maxX = Math.max(...widgets.map(w => w.x + w.width));
    const maxY = Math.max(...widgets.map(w => w.y + w.height));
    const contentW = (maxX - minX) * scale;
    const contentH = (maxY - minY) * scale;

    let nextX = offsetX;
    let nextY = offsetY;

    if (contentW <= viewportW - padding * 2) {
      nextX = (viewportW - contentW) / 2 - minX * scale;
    } else {
      const minOffsetX = viewportW - padding - maxX * scale;
      const maxOffsetX = padding - minX * scale;
      nextX = Math.min(maxOffsetX, Math.max(minOffsetX, nextX));
    }

    if (contentH <= viewportH - padding * 2) {
      nextY = (viewportH - contentH) / 2 - minY * scale;
    } else {
      const minOffsetY = viewportH - padding - maxY * scale;
      const maxOffsetY = padding - minY * scale;
      nextY = Math.min(maxOffsetY, Math.max(minOffsetY, nextY));
    }

    return { offsetX: nextX, offsetY: nextY };
  }, [widgets]);

  const zoomTo = useCallback((nextScale: number, anchorClientX: number, anchorClientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    setCanvasState((prev) => {
      const rect = el.getBoundingClientRect();
      const anchorX = anchorClientX - rect.left;
      const anchorY = anchorClientY - rect.top;
      const oldScale = prev.scale || 1;
      const scale = clampScale(nextScale);
      const worldX = (anchorX - prev.offsetX) / oldScale;
      const worldY = (anchorY - prev.offsetY) / oldScale;
      let offsetX = anchorX - worldX * scale;
      let offsetY = anchorY - worldY * scale;
      const clamped = clampOffsets(scale, offsetX, offsetY);
      offsetX = clamped.offsetX;
      offsetY = clamped.offsetY;

      return { ...prev, scale, offsetX, offsetY };
    });
  }, [clampOffsets]);

  const getNextZoomScale = (current: number, dir: 'in' | 'out') => {
    const s = clampScale(current || 1);
    const eps = 1e-6;
    if (dir === 'in') {
      for (let i = 0; i < ZOOM_STEPS.length; i++) {
        if (ZOOM_STEPS[i] > s + eps) return ZOOM_STEPS[i];
      }
      return null;
    }
    for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
      if (ZOOM_STEPS[i] < s - eps) return ZOOM_STEPS[i];
    }
    return null;
  };

  const focusWidget = useCallback((id: string) => {
    const el = containerRef.current;
    if (!el) return;
    const w = widgets.find(x => x.id === id);
    if (!w) return;
    const scale = clampScale(canvasStateRef.current.scale || 1);
    const viewportW = el.clientWidth || 0;
    const viewportH = el.clientHeight || 0;
    const cx = w.x + w.width / 2;
    const cy = w.y + w.height / 2;
    const rawOffsetX = viewportW / 2 - cx * scale;
    const rawOffsetY = viewportH / 2 - cy * scale;
    const clamped = clampOffsets(scale, rawOffsetX, rawOffsetY);
    animatePanTo(clamped.offsetX, clamped.offsetY);
  }, [animatePanTo, clampOffsets, widgets]);

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
          updateWidgetById(resizingWidgetId, (w) => {
            const minWidth = w.type === 'terminal' ? MIN_TERMINAL_WIDTH : 200;
            const maxWidth = w.type === 'terminal' ? (MAX_TERMINAL_WIDTH ?? Infinity) : Infinity;
            const nextWidth = Math.min(maxWidth, Math.max(minWidth, resizeStart.width + deltaX));
            const nextHeight = Math.max(150, resizeStart.height + deltaY);
            return { ...w, width: nextWidth, height: nextHeight };
          });
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
            const scale = canvasState.scale || 1;
            updateWidgetById(draggedWidgetId, (w) => ({ ...w, x: w.x + (deltaX / scale), y: w.y + (deltaY / scale) }));
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
    backgroundSize: `${20 * (canvasState.scale || 1)}px ${20 * (canvasState.scale || 1)}px`,
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
      <div style={gridStyle} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate3d(${canvasState.offsetX}px, ${canvasState.offsetY}px, 0) scale(${canvasState.scale || 1})`,
          transformOrigin: '0 0',
        }}
      >
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

      <MonitorWidgetConfigModal
        t={t}
        editingWidget={editingWidget}
        widgets={widgets}
        portList={portList}
        serial={serial}
        onRefreshPorts={onRefreshPorts}
        onOk={handleSaveWidget}
        onCancel={() => setEditingWidget(null)}
        onValuesChange={handleValuesChange}
        form={form}
        getDefaultWidgetName={getDefaultWidgetName}
        normalizeTitle={normalizeTitle}
        normalizePath={normalizePath}
      />

      {/* 悬浮添加按钮 */}
      {(() => {
        const activeWindowMs = 5000;
        const activeWidgets = widgets
          .filter(w => w.type === 'terminal' && !!w.lastRxAt && nowTs - (w.lastRxAt || 0) <= activeWindowMs)
          .sort((a, b) => (b.lastRxAt || 0) - (a.lastRxAt || 0));
        const activeDroplist = (
          <Menu>
            {activeWidgets.length === 0 ? (
              <Menu.Item key="none" disabled>
                暂无活跃组件
              </Menu.Item>
            ) : (
              activeWidgets.map(w => (
                <Menu.Item
                  key={w.id}
                  onClick={() => {
                    zoomTo(1, window.innerWidth / 2, window.innerHeight / 2);
                    window.setTimeout(() => {
                      focusWidget(w.id);
                    }, 260);
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>{(w.title || '').trim() || getDefaultWidgetName(w.type)}</span>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>
                      {(w.portPath || '').trim()} · {Math.max(0, Math.round((nowTs - (w.lastRxAt || 0)) / 1000))}s
                    </span>
                  </div>
                </Menu.Item>
              ))
            )}
          </Menu>
        );
        const node = (
          <>
            <div
              style={{
                position: 'fixed',
                bottom: floatingActivePos?.bottom ?? 20,
                left: floatingActivePos?.left ?? 20,
                zIndex: FLOATING_PORTAL_Z_INDEX,
                transition: 'bottom 180ms ease, left 180ms ease',
              }}
            >
              <Dropdown droplist={activeDroplist} position="top" trigger="hover">
                <Button shape='circle' size='large' icon={<IconUnorderedList />} style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.2)' }} />
              </Dropdown>
            </div>
            <div
              ref={floatingActionsRef}
              style={{
                position: 'fixed',
                top: floatingActionsPos?.top ?? 20,
                right: floatingActionsPos?.right ?? 20,
                zIndex: FLOATING_PORTAL_Z_INDEX,
                transition: 'top 180ms ease, right 180ms ease',
              }}
            >
              <Space>
                <Tooltip content={t('monitor.layout.export')}>
                  <Button shape='circle' size='large' icon={<IconDownload />} onClick={handleExportLayout} style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.2)' }} />
                </Tooltip>
                <Dropdown droplist={droplist} position='br'>
                  <Button type='primary' shape='circle' size='large' icon={<IconPlus />} style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.2)' }} />
                </Dropdown>
              </Space>
            </div>
          </>
        );
        return canUseDom ? createPortal(node, document.body) : node;
      })()}

      {(() => {
        const scale = clampScale(canvasState.scale || 1);
        const nextOut = getNextZoomScale(scale, 'out');
        const nextIn = getNextZoomScale(scale, 'in');
        const lockedStyle: React.CSSProperties = { opacity: 0.45 };
        const handleExceed = () => Message.warning('放大/缩小已超出限制。');
        const zoomText = `${Math.round(scale * 100)}%`;
        const node = (
          <div
            style={{
              position: 'fixed',
              bottom: floatingZoomPos?.bottom ?? 20,
              right: floatingZoomPos?.right ?? 20,
              zIndex: FLOATING_PORTAL_Z_INDEX,
              transition: 'bottom 180ms ease, right 180ms ease',
            }}
          >
            <div
              style={{
                marginBottom: 8,
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(0,0,0,0.55)',
                color: '#fff',
                fontSize: 12,
                lineHeight: '16px',
                textAlign: 'center',
                userSelect: 'none',
              }}
            >
              缩放：{zoomText}
            </div>
            <Button.Group>
              <Button
                type={nextOut ? 'primary' : 'secondary'}
                size="large"
                icon={<IconMinus />}
                style={nextOut ? undefined : lockedStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!nextOut) {
                    handleExceed();
                    return;
                  }
                  const el = containerRef.current;
                  if (!el) return;
                  const rect = el.getBoundingClientRect();
                  zoomTo(nextOut, rect.left + rect.width / 2, rect.top + rect.height / 2);
                }}
              />
              <Button
                type="primary"
                size="large"
                icon={<IconSync />}
                onClick={(e) => {
                  e.stopPropagation();
                  const el = containerRef.current;
                  if (!el) return;
                  const rect = el.getBoundingClientRect();
                  zoomTo(1, rect.left + rect.width / 2, rect.top + rect.height / 2);
                }}
              />
              <Button
                type={nextIn ? 'primary' : 'secondary'}
                size="large"
                icon={<IconPlus />}
                style={nextIn ? undefined : lockedStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!nextIn) {
                    handleExceed();
                    return;
                  }
                  const el = containerRef.current;
                  if (!el) return;
                  const rect = el.getBoundingClientRect();
                  zoomTo(nextIn, rect.left + rect.width / 2, rect.top + rect.height / 2);
                }}
              />
            </Button.Group>
          </div>
        );
        return canUseDom ? createPortal(node, document.body) : node;
      })()}
    </div>
  );
}
