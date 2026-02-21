import { WebSocketServer, WebSocket } from 'ws';
import { PortManager } from '../core/PortManager';
import { Server } from 'http';

interface WsMessage {
  type: string;
  path?: string;
  [key: string]: any;
}

export function createWsServer(server: Server, portManager: PortManager) {
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
  portManager.on('status', (event) => {
    console.log(`[WS] Status change: ${event.path} -> ${event.status}`);
    broadcast({ type: 'serial:status', ...event });
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
    console.log(`[WS] Raw data from ${event.path}: ${event.data.length} bytes`);

    // 为了适配前端现有的解析逻辑 (msg.data.raw.data)
    // 我们构造一个符合 buffer JSON 序列化的结构
    const bufferJson = event.data.toJSON(); // { type: 'Buffer', data: [...] }

    broadcast({
      type: 'serial:data',
      path: event.path,
      data: {
        raw: bufferJson
      }
    });
  });

  wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
      try {
        const parsed: WsMessage = JSON.parse(message.toString());
        console.log('Received:', parsed);

        // 处理客户端指令
        if (parsed.type === 'subscribe') {
          // TODO: 实现按需订阅
        }
      } catch (e) {
        console.error('Invalid WS message:', e);
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected');
    });
  });

  return wss;
}
