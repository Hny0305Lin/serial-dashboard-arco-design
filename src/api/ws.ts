import { WebSocketServer, WebSocket } from 'ws';
import { PortManager } from '../core/PortManager';
import { Server } from 'http';
import { ForwardingService } from '../services/ForwardingService';

interface WsMessage {
  type: string;
  path?: string;
  [key: string]: any;
}

export function createWsServer(server: Server, portManager: PortManager, forwarding?: ForwardingService) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // 广播函数
  const broadcast = (data: any) => {
    const msg = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  };

  // 监听 PortManager 事件并广播
  console.log('[WS] Setting up PortManager listeners...');
  portManager.on('status', (event) => {
    console.log(`[WS] Status change event received: ${event.path} -> ${event.status}`);
    console.log(`[WS] Broadcasting status: ${event.path} -> ${event.status}`);
    broadcast({ type: 'serial:status', ...event });

    // 广播 serial:opened 消息，适配前端自动发送逻辑
    if (event.status === 'open') {
      console.log(`[WS] Broadcasting serial:opened for ${event.path}`);
      broadcast({ type: 'serial:opened', path: event.path });
    }
  });

  portManager.on('packet', (event) => {
    // 如果有 parser，会触发 packet 事件
    console.log(`[WS] Packet from ${event.path}`);
    broadcast({
      type: 'serial:data',
      path: event.path,
      data: event.packet
    });
  });

  // 监听原始数据
  // 注意：如果同时监听 packet 和 data，可能会发两次数据给前端
  // 但目前 PortManager 只有在 parser 存在时才 emit packet
  // 如果没有 parser，只会 emit data
  // 为了确保所有数据都能发出去，我们监听 data 事件
  // 前端收到数据后自行去重或展示
  portManager.on('data', (event) => {
    // console.log(`[WS] Raw data from ${event.path}: ${event.data.length} bytes`);

    // 为了适配前端现有的解析逻辑 (msg.data.raw.data)
    // 我们构造一个符合 buffer JSON 序列化的结构
    const bufferJson = event.data.toJSON(); // { type: 'Buffer', data: [...] }

    console.log(`[WS] Broadcasting serial:data for ${event.path} (${event.data.length} bytes)`);

    broadcast({
      type: 'serial:data',
      path: event.path,
      data: {
        raw: bufferJson
      }
    });
  });

  let forwardingUnsub: (() => void) | null = null;
  let forwardingAlertUnsub: (() => void) | null = null;
  let forwardingBroadcastTimer: NodeJS.Timeout | null = null;
  let pendingForwardingSnapshot: any | null = null;

  const scheduleForwardingBroadcast = () => {
    if (!pendingForwardingSnapshot) return;
    if (forwardingBroadcastTimer) return;
    forwardingBroadcastTimer = setTimeout(() => {
      forwardingBroadcastTimer = null;
      if (!pendingForwardingSnapshot) return;
      broadcast({ type: 'forwarding:metrics', data: pendingForwardingSnapshot });
      pendingForwardingSnapshot = null;
    }, 300);
  };

  if (forwarding) {
    forwardingUnsub = forwarding.onMetrics((snap) => {
      pendingForwardingSnapshot = snap;
      scheduleForwardingBroadcast();
    });
    forwardingAlertUnsub = forwarding.onAlert((alert) => {
      broadcast({ type: 'forwarding:alert', data: alert });
    });
  }

  wss.on('connection', (ws) => {
    console.log('Client connected');
    if (forwarding) {
      ws.send(JSON.stringify({ type: 'forwarding:metrics', data: forwarding.getMetricsSnapshot() }));
    }

    ws.on('message', (message) => {
      try {
        const parsed: WsMessage = JSON.parse(message.toString());
        // console.log('Received:', parsed);

        // 处理客户端指令
        if (parsed.type === 'subscribe') {
          // TODO: 实现按需订阅
        }

        // 处理发送数据指令
        if (parsed.type === 'serial:send' && parsed.path && parsed.data) {
          const { path, data, encoding = 'hex' } = parsed;
          let buffer: Buffer;
          try {
            if (encoding === 'hex') {
              // 移除空格并转为 buffer
              // 过滤掉所有非 hex 字符
              const hexString = data.replace(/[^0-9A-Fa-f]/g, '');
              if (hexString.length % 2 !== 0) {
                console.warn('[WS] Hex string length is odd, may cause issues');
              }
              buffer = Buffer.from(hexString, 'hex');
            } else {
              buffer = Buffer.from(data, 'utf8');
            }

            console.log(`[WS] Writing to ${path}:`, buffer);

            portManager.write(path, buffer).catch(err => {
              console.error(`[WS] Write error to ${path}:`, err);
            });
          } catch (err) {
            console.error('[WS] Buffer creation error:', err);
          }
        }
      } catch (e) {
        console.error('Invalid WS message:', e);
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected');
    });
  });

  wss.on('close', () => {
    if (forwardingUnsub) forwardingUnsub();
    if (forwardingAlertUnsub) forwardingAlertUnsub();
    if (forwardingBroadcastTimer) clearTimeout(forwardingBroadcastTimer);
  });

  return wss;
}
