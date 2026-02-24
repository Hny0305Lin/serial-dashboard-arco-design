import { ChannelSender, ChannelSendResult } from './ChannelSender';
import { ForwardingChannelMqttConfig } from '../../../types/forwarding';

type MqttModule = typeof import('mqtt');

export class MqttSender implements ChannelSender {
  private cfg: ForwardingChannelMqttConfig;
  private client: any | null = null;
  private connecting: Promise<void> | null = null;
  private mqtt: MqttModule;

  constructor(cfg: ForwardingChannelMqttConfig) {
    this.cfg = cfg;
    this.mqtt = require('mqtt') as MqttModule;
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<void>((resolve, reject) => {
      const client = this.mqtt.connect(this.cfg.url, {
        clientId: this.cfg.clientId,
        username: this.cfg.username,
        password: this.cfg.password,
        reconnectPeriod: 1000,
        connectTimeout: 5000
      });
      let done = false;
      const onError = (err: any) => {
        if (done) return;
        done = true;
        try { client.end(true); } catch (e) { }
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      client.once('connect', () => {
        if (done) return;
        done = true;
        this.client = client;
        client.on('close', () => {
          if (this.client === client) this.client = null;
        });
        resolve();
      });
      client.once('error', onError);
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  public async send(payload: Buffer, headers: Record<string, string>): Promise<ChannelSendResult> {
    const start = Date.now();
    await this.ensureConnected();
    const client = this.client;
    if (!client) throw new Error('MQTT not connected');
    const envelope = JSON.stringify({ headers, bodyBase64: payload.toString('base64') });
    const qos = (typeof this.cfg.qos === 'number' ? this.cfg.qos : 0) as 0 | 1 | 2;
    await new Promise<void>((resolve, reject) => {
      client.publish(this.cfg.topic, envelope, { qos }, (err: any) => {
        if (err) return reject(err instanceof Error ? err : new Error(String(err)));
        resolve();
      });
    });
    return { latencyMs: Date.now() - start };
  }

  public async close(): Promise<void> {
    const c = this.client;
    this.client = null;
    if (!c) return;
    await new Promise<void>((resolve) => {
      try {
        c.end(false, {}, () => resolve());
      } catch (e) {
        resolve();
      }
      setTimeout(() => resolve(), 500);
    });
  }
}
