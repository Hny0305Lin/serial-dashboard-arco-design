import express from 'express';
import http from 'http';
import { createApp } from './api/app';
import { createWsServer } from './api/ws';
import { PortManager } from './core/PortManager';
import cors from 'cors';
import path from 'path';
import { ForwardingService } from './services/ForwardingService';
import { acquireInstanceLock } from './core/instanceLock';
import { ESerialBusy } from './core/errors';

const PORT = (() => {
  const n = Number(String(process.env.PORT || '').trim());
  if (Number.isFinite(n) && n > 0) return n;
  return 9001;
})();

async function main() {
  const defaultDataDir = path.resolve(__dirname, '..', 'data');
  const dataDir = (process.env.DATA_DIR && String(process.env.DATA_DIR).trim()) || defaultDataDir;
  const lockFilePath = path.join(dataDir, 'server.lock.json');
  let lock: { release: () => void } | null = null;
  try {
    lock = acquireInstanceLock(lockFilePath);
  } catch (e: any) {
    if (e && e.code === 'ELOCKED') {
      throw new ESerialBusy('Another server instance is already running', {
        lockedPid: Number(e.lockedPid),
        lockFilePath: String(e.lockFilePath || lockFilePath),
      });
    }
    throw e;
  }

  const portManager = new PortManager();
  const forwarding = new ForwardingService({
    portManager,
    configPath: path.join(dataDir, 'forwarding.config.json'),
    dataDir
  });
  await forwarding.init();

  // 初始化 Express 应用
  const app = createApp(portManager, forwarding);

  // 使用 /api 前缀挂载路由
  // createApp 返回的是 express() 实例，可以直接作为子应用挂载
  const mainApp = express();
  mainApp.use(cors()); // 确保主应用也开启 CORS
  mainApp.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, pid: process.pid, port: PORT });
  });
  mainApp.use('/api', app);

  // 创建 HTTP 服务器
  const server = http.createServer(mainApp);

  // 创建 WebSocket 服务器
  const wss = createWsServer(server, portManager, forwarding);

  // 监听端口
  server.on('error', async (err: any) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`PORT_IN_USE:${PORT}`);
      try {
        await forwarding.shutdown();
      } catch { }
      try {
        lock?.release();
      } catch { }
      process.exit(110);
    }
    console.error(err);
    try {
      await forwarding.shutdown();
    } catch { }
    try {
      lock?.release();
    } catch { }
    process.exit(1);
  });

  server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`WebSocket server is running on ws://localhost:${PORT}/ws`);
  });

  // 优雅退出
  async function gracefulExit(code: number) {
    console.log('Stopping server...');
    // 关闭所有串口
    const ports = await portManager.list();
    for (const port of ports) {
      await portManager.close(port.path);
    }
    await forwarding.shutdown();
    try {
      lock?.release();
    } catch { }
    server.close(() => {
      console.log('Server stopped');
      process.exit(code);
    });
  }

  process.on('SIGINT', async () => {
    await gracefulExit(0);
  });
  process.on('SIGTERM', async () => {
    await gracefulExit(0);
  });
}

main().catch((e) => {
  if (e instanceof ESerialBusy) {
    const pidPart = Number.isFinite(Number(e.lockedPid)) ? ` pid=${e.lockedPid}` : '';
    console.error(`ESerialBusy:${pidPart} ${e.message}`);
    process.exit(110);
  }
  console.error(e);
  process.exit(1);
});
