import http from 'http';
import https from 'https';
import { URL } from 'url';
import { ChannelSender, ChannelSendResult } from './ChannelSender';
import { ForwardingChannelHttpConfig } from '../../../types/forwarding';

export class HttpSender implements ChannelSender {
  private cfg: ForwardingChannelHttpConfig;
  private validateJsonCode: boolean;

  constructor(cfg: ForwardingChannelHttpConfig, opts?: { validateJsonCode?: boolean }) {
    this.cfg = cfg;
    this.validateJsonCode = !!opts?.validateJsonCode;
  }

  public async send(payload: Buffer, headers: Record<string, string>, opts?: { idempotencyKey?: string }): Promise<ChannelSendResult> {
    const start = Date.now();
    const url = new URL(this.cfg.url);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const timeoutMs = Math.max(100, this.cfg.timeoutMs || 5000);
    const method = this.cfg.method || 'POST';

    const mergedHeaders: Record<string, string> = {
      ...this.cfg.headers,
      ...headers,
      'content-length': String(payload.length)
    };
    if (opts?.idempotencyKey) mergedHeaders['x-idempotency-key'] = opts.idempotencyKey;

    await new Promise<void>((resolve, reject) => {
      const req = lib.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port ? Number(url.port) : (isHttps ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method,
          headers: mergedHeaders,
          timeout: timeoutMs
        },
        (res) => {
          const code = res.statusCode || 0;
          const chunks: Buffer[] = [];
          res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (code < 200 || code >= 300) {
              reject(new Error(`HTTP ${code} ${body}`.trim()));
              return;
            }
            if (this.validateJsonCode) {
              try {
                const json = body ? JSON.parse(body) : null;
                const c = typeof json?.code === 'number' ? json.code : (typeof json?.StatusCode === 'number' ? json.StatusCode : null);
                const m = String(json?.msg || json?.StatusMessage || '').trim();
                if (typeof c === 'number' && c !== 0) {
                  reject(new Error(`HTTP ${code} feishu code=${c}${m ? ` msg=${m}` : ''}`.trim()));
                  return;
                }
              } catch (e) {
              }
            }
            resolve();
          });
        }
      );
      req.on('timeout', () => {
        req.destroy(new Error('HTTP timeout'));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    return { latencyMs: Date.now() - start };
  }

  public async close(): Promise<void> {
  }
}
