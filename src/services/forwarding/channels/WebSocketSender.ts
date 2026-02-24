import WebSocket from 'ws';
import { ChannelSender, ChannelSendResult } from './ChannelSender';
import { ForwardingChannelWebSocketConfig } from '../../../types/forwarding';

export class WebSocketSender implements ChannelSender {
  private cfg: ForwardingChannelWebSocketConfig;
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;

  constructor(cfg: ForwardingChannelWebSocketConfig) {
    this.cfg = cfg;
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;

    const timeoutMs = Math.max(100, this.cfg.timeoutMs || 5000);
    this.connecting = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.cfg.url, this.cfg.protocols || []);
      let done = false;

      const t = setTimeout(() => {
        if (done) return;
        done = true;
        try { ws.terminate(); } catch (e) { }
        reject(new Error('WS connect timeout'));
      }, timeoutMs);

      ws.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        this.ws = ws;
        resolve();
      });
      ws.on('error', (err) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        reject(err);
      });
      ws.on('close', () => {
        if (this.ws === ws) this.ws = null;
      });
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  public async send(payload: Buffer, headers: Record<string, string>): Promise<ChannelSendResult> {
    const start = Date.now();
    await this.ensureConnected();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('WS not connected');
    const envelope = {
      headers,
      bodyBase64: payload.toString('base64')
    };
    await new Promise<void>((resolve, reject) => {
      ws.send(JSON.stringify(envelope), (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    return { latencyMs: Date.now() - start };
  }

  public async close(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    await new Promise<void>((resolve) => {
      try {
        ws.close();
      } catch (e) {
        resolve();
        return;
      }
      ws.once('close', () => resolve());
      setTimeout(() => resolve(), 300);
    });
  }
}
