import net from 'net';
import { ChannelSender, ChannelSendResult } from './ChannelSender';
import { ForwardingChannelTcpConfig } from '../../../types/forwarding';

export class TcpSender implements ChannelSender {
  private cfg: ForwardingChannelTcpConfig;
  private socket: net.Socket | null = null;
  private connecting: Promise<void> | null = null;

  constructor(cfg: ForwardingChannelTcpConfig) {
    this.cfg = cfg;
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    const timeoutMs = Math.max(100, this.cfg.timeoutMs || 5000);

    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      let done = false;

      const t = setTimeout(() => {
        if (done) return;
        done = true;
        try { socket.destroy(new Error('TCP connect timeout')); } catch (e) { }
        reject(new Error('TCP connect timeout'));
      }, timeoutMs);

      socket.once('error', (err) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        reject(err);
      });
      socket.connect(this.cfg.port, this.cfg.host, () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        this.socket = socket;
        socket.on('close', () => {
          if (this.socket === socket) this.socket = null;
        });
        resolve();
      });
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  public async send(payload: Buffer, headers: Record<string, string>): Promise<ChannelSendResult> {
    const start = Date.now();
    await this.ensureConnected();
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error('TCP not connected');
    const envelope = Buffer.from(JSON.stringify({ headers, bodyBase64: payload.toString('base64') }) + '\n', 'utf8');
    await new Promise<void>((resolve, reject) => {
      socket.write(envelope, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    return { latencyMs: Date.now() - start };
  }

  public async close(): Promise<void> {
    const s = this.socket;
    this.socket = null;
    if (!s) return;
    await new Promise<void>((resolve) => {
      try {
        s.end(() => resolve());
      } catch (e) {
        resolve();
      }
      setTimeout(() => resolve(), 300);
    });
  }
}
