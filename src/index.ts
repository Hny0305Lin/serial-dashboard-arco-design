import express from 'express';
import http from 'http';
import { createApp } from './api/app';
import { createWsServer } from './api/ws';
import { PortManager } from './core/PortManager';
import cors from 'cors';

const PORT = 3001;

async function main() {
  const portManager = new PortManager();
  
  // 初始化 Express 应用
  const app = createApp(portManager);
  
  // 使用 /api 前缀挂载路由
  // createApp 返回的是 express() 实例，可以直接作为子应用挂载
  const mainApp = express();
  mainApp.use(cors()); // 确保主应用也开启 CORS
  mainApp.use('/api', app);

  // 创建 HTTP 服务器
  const server = http.createServer(mainApp);
  
  // 创建 WebSocket 服务器
  const wss = createWsServer(server, portManager);

  // 监听端口
  server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`WebSocket server is running on ws://localhost:${PORT}/ws`);
  });

  // 优雅退出
  process.on('SIGINT', async () => {
    console.log('Stopping server...');
    // 关闭所有串口
    const ports = await portManager.list();
    for (const port of ports) {
      await portManager.close(port.path);
    }
    server.close(() => {
      console.log('Server stopped');
      process.exit(0);
    });
  });
}

main().catch(console.error);
