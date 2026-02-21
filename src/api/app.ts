import express from 'express';
import cors from 'cors';
import { PortManager } from '../core/PortManager';

export function createApp(portManager: PortManager) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // 1. 获取所有串口列表
  app.get('/ports', async (req, res) => {
    try {
      const ports = await portManager.list();
      // 补充当前状态信息
      const result = ports.map(p => ({
        ...p,
        status: portManager.getStatus(p.path)
      }));
      res.json({ code: 0, msg: 'success', data: result });
    } catch (error: any) {
      res.status(500).json({ code: 500, msg: error.message });
    }
  });

  // 2. 打开串口
  app.post('/ports/open', async (req, res) => {
    const { path, baudRate, dataBits, stopBits, parity } = req.body;

    if (!path || !baudRate) {
      return res.status(400).json({ code: 400, msg: 'Missing path or baudRate' });
    }

    try {
      await portManager.open({
        path,
        baudRate,
        dataBits,
        stopBits,
        parity
      });
      res.json({ code: 0, msg: 'success' });
    } catch (error: any) {
      res.status(500).json({ code: 500, msg: error.message });
    }
  });

  // 3. 关闭串口
  app.post('/ports/close', async (req, res) => {
    const { path } = req.body;

    if (!path) {
      return res.status(400).json({ code: 400, msg: 'Missing path' });
    }

    try {
      await portManager.close(path);
      res.json({ code: 0, msg: 'success' });
    } catch (error: any) {
      res.status(500).json({ code: 500, msg: error.message });
    }
  });

  // 4. 写入数据
  app.post('/ports/write', async (req, res) => {
    const { path, data, encoding = 'hex' } = req.body;

    if (!path || !data) {
      return res.status(400).json({ code: 400, msg: 'Missing path or data' });
    }

    try {
      let buffer: Buffer;
      if (encoding === 'hex') {
        buffer = Buffer.from(data, 'hex');
      } else {
        buffer = Buffer.from(data, 'utf8'); // default utf8
      }

      await portManager.write(path, buffer);
      res.json({ code: 0, msg: 'success' });
    } catch (error: any) {
      res.status(500).json({ code: 500, msg: error.message });
    }
  });

  return app;
}
