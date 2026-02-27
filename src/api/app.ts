import express from 'express';
import cors from 'cors';
import { PortManager } from '../core/PortManager';
import { ForwardingService } from '../services/ForwardingService';

export function createApp(portManager: PortManager, forwarding?: ForwardingService) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // 1. 获取所有串口列表
  app.get('/ports', async (req, res) => {
    try {
      const ports = await portManager.list();
      const byPath = new Map<string, any>();
      for (const p of ports) byPath.set(p.path, p);
      for (const path of portManager.listKnownPaths()) {
        if (!byPath.has(path)) byPath.set(path, { path });
      }

      const result = Array.from(byPath.values()).map(p => ({
        ...p,
        status: portManager.getStatus(p.path),
        lastError: portManager.getLastError(p.path)
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
      const msg = error?.message ? String(error.message) : String(error);
      res.status(500).json({ code: 500, msg: msg || 'open failed' });
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

  app.get('/forwarding/config', async (req, res) => {
    if (!forwarding) return res.status(404).json({ code: 404, msg: 'Forwarding service not enabled' });
    res.json({ code: 0, msg: 'success', data: forwarding.getConfig() });
  });

  app.put('/forwarding/config', async (req, res) => {
    if (!forwarding) return res.status(404).json({ code: 404, msg: 'Forwarding service not enabled' });
    const next = req.body;
    if (!next || typeof next !== 'object') return res.status(400).json({ code: 400, msg: 'Invalid config' });
    try {
      await forwarding.setConfig(next);
      res.json({ code: 0, msg: 'success', data: forwarding.getConfig() });
    } catch (error: any) {
      res.status(500).json({ code: 500, msg: error.message });
    }
  });

  app.post('/forwarding/channels', async (req, res) => {
    if (!forwarding) return res.status(404).json({ code: 404, msg: 'Forwarding service not enabled' });
    try {
      const { ownerWidgetId, name } = req.body || {};
      const created = await forwarding.createChannel({ ownerWidgetId, name });
      res.json({ code: 0, msg: 'success', data: created });
    } catch (error: any) {
      res.status(500).json({ code: 500, msg: error.message });
    }
  });

  app.delete('/forwarding/channels', async (req, res) => {
    if (!forwarding) return res.status(404).json({ code: 404, msg: 'Forwarding service not enabled' });
    try {
      const ownerWidgetId = String(req.query.ownerWidgetId || '').trim();
      const out = await forwarding.removeChannelsByOwner(ownerWidgetId);
      res.json({ code: 0, msg: 'success', data: out });
    } catch (error: any) {
      res.status(500).json({ code: 500, msg: error.message });
    }
  });

  app.post('/forwarding/enabled', async (req, res) => {
    if (!forwarding) return res.status(404).json({ code: 404, msg: 'Forwarding service not enabled' });
    const enabled = !!req.body?.enabled;
    try {
      await forwarding.setEnabled(enabled);
      res.json({ code: 0, msg: 'success', data: { enabled: forwarding.getConfig().enabled } });
    } catch (error: any) {
      res.status(500).json({ code: 500, msg: error.message });
    }
  });

  app.get('/forwarding/metrics', async (req, res) => {
    if (!forwarding) return res.status(404).json({ code: 404, msg: 'Forwarding service not enabled' });
    res.json({ code: 0, msg: 'success', data: forwarding.getMetricsSnapshot() });
  });

  app.get('/forwarding/records', async (req, res) => {
    if (!forwarding) return res.status(404).json({ code: 404, msg: 'Forwarding service not enabled' });
    const limit = Math.max(1, Math.min(Number(req.query.limit || 200), 2000));
    res.json({ code: 0, msg: 'success', data: forwarding.getRecentRecords(limit) });
  });

  app.get('/forwarding/logs', async (req, res) => {
    if (!forwarding) return res.status(404).json({ code: 404, msg: 'Forwarding service not enabled' });
    const limit = Math.max(1, Math.min(Number(req.query.limit || 200), 2000));
    const ownerWidgetId = String(req.query.ownerWidgetId || '').trim();
    const portPath = String(req.query.portPath || '').trim();
    const channelId = String(req.query.channelId || '').trim();
    res.json({
      code: 0,
      msg: 'success',
      data: forwarding.getRecentLogs({
        limit,
        ownerWidgetId: ownerWidgetId || undefined,
        portPath: portPath || undefined,
        channelId: channelId || undefined
      })
    });
  });

  app.get('/forwarding/queues', async (req, res) => {
    if (!forwarding) return res.status(404).json({ code: 404, msg: 'Forwarding service not enabled' });
    const channelId = String(req.query.channelId || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 10), 50));
    try {
      const data = await forwarding.getQueueSnapshot({ channelId: channelId || undefined, limit });
      res.json({ code: 0, msg: 'success', data });
    } catch (error: any) {
      res.status(500).json({ code: 500, msg: error.message });
    }
  });

  return app;
}
