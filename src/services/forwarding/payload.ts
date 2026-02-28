import crypto from 'crypto';
import zlib from 'zlib';
import { ForwardingCompression, ForwardingEncryption, ForwardingOutboundBatch, ForwardingPayloadFormat } from '../../types/forwarding';
import { decodeMixedBytes } from '../../core/mixedEncoding';

export interface BuiltPayload {
  format: ForwardingPayloadFormat;
  body: Buffer;
  headers: Record<string, string>;
  plaintextSha256: string;
}

function gzip(data: Buffer): Buffer {
  return zlib.gzipSync(data, { level: 6 });
}

function getEncryptionKey(keyId?: string): Buffer | null {
  const base = process.env.FORWARDING_KEY || '';
  const byId = keyId ? (process.env[`FORWARDING_KEY_${keyId}`] || '') : '';
  const raw = byId || base;
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const hex = cleaned.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length === 64) return Buffer.from(hex, 'hex');

  try {
    const b = Buffer.from(cleaned, 'base64');
    if (b.length === 32) return b;
  } catch (e) {
  }

  return null;
}

function aes256gcmEncrypt(plaintext: Buffer, key: Buffer): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: enc, iv, tag };
}

function buildXmlFromTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => (vars[k] ?? ''));
}

function buildBinary(batch: ForwardingOutboundBatch): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(0x46574231, 0);
  header.writeUInt32BE(batch.records.length >>> 0, 4);
  const parts: Buffer[] = [header];
  for (const r of batch.records) {
    const raw = r.rawBytesBase64 ? Buffer.from(r.rawBytesBase64, 'base64') : (r.payloadBytesBase64 ? Buffer.from(r.payloadBytesBase64, 'base64') : Buffer.alloc(0));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(raw.length >>> 0, 0);
    parts.push(len, raw);
  }
  return Buffer.concat(parts);
}

function stripControlChars(s: string): string {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function stripEscapeArtifacts(s: string): string {
  return s
    .replace(/<bin:[^>]*>/g, ' ')
    .replace(/\\u[0-9a-fA-F]{4}/g, ' ')
    .replace(/\\x[0-9a-fA-F]{2}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTextLine(s: string): string {
  return s.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractSmsCallbackMessage(s: string): string {
  const k = 'user.smsCallback';
  const idx1 = s.indexOf(`I/${k}`);
  const idx2 = s.indexOf(k);
  const idx = idx1 >= 0 ? idx1 + 2 : idx2;
  if (idx < 0) return '';
  let out = s.slice(idx);
  const marker = out.indexOf('~~');
  if (marker >= 0) out = out.slice(0, marker);
  return normalizeTextLine(out);
}

function extractNotifyPollMessage(s: string): string {
  const idx = s.indexOf('/user.util_notify.poll');
  if (idx < 0) return '';
  const t = normalizeTextLine(s.slice(idx));
  const m = t.match(/(\/user\.util_notify\.poll)\s+mobile\.status\s+\d+\s+(.+)$/);
  if (!m) return '';
  const rawMsg = String(m[2] || '');
  let msg = rawMsg;
  if (rawMsg.includes('网络已注册,漫游')) msg = '网络已注册,漫游';
  else if (rawMsg.includes('网络已注册')) msg = '网络已注册';
  else if (rawMsg.includes('网络未注册')) msg = '网络未注册';
  else {
    msg = rawMsg.replace(/\s+Lj.*$/g, '').replace(/\s+L[0-9A-Za-z]{0,6}s.*$/g, '').replace(/\s+\+.*$/g, '').trim();
  }
  return normalizeTextLine(`${m[1]} mobile.status ${msg}`);
}

function decodeRecordTextForFeishu(r: any): string {
  const rawB64 = typeof r?.rawBytesBase64 === 'string' ? r.rawBytesBase64 : '';
  if (rawB64) {
    const buf = Buffer.from(rawB64, 'base64');
    const decoded = decodeMixedBytes(buf, { controlStrategy: 'strip', invalidByteStrategy: 'replace', binaryStrategy: 'summary' });
    return stripEscapeArtifacts(decoded.text).replace(/\u0000/g, '');
  }
  const payload =
    typeof r?.payloadText === 'string' ? r.payloadText :
      r?.payloadJson != null ? JSON.stringify(r.payloadJson) :
        typeof r?.payloadBytesBase64 === 'string' ? r.payloadBytesBase64 :
          '';
  return stripEscapeArtifacts(stripControlChars(String(payload))).replace(/\u0000/g, '');
}

function formatRecordLine(r: any): string {
  const ts = r?.ts ? new Date(r.ts).toLocaleString() : '';
  const port = String(r?.portPath || '').trim();
  const dev = String(r?.deviceId || '').trim();
  const type = String(r?.dataType || '').trim();
  const prefixParts = [ts, port, dev, type].filter(Boolean);
  const prefix = prefixParts.length > 0 ? `[${prefixParts.join(' ')}] ` : '';
  const text = decodeRecordTextForFeishu(r);

  const sms = extractSmsCallbackMessage(text);
  if (sms) return `${prefix}${sms}`.trim();

  const notify = extractNotifyPollMessage(text);
  const socsq = text.includes('+SOCSQ: %d,%d,%d') ? 'SOCSQ: %d,%d,%d' : '';
  const csq = text.includes('+CSQ: %d') ? 'CSQ: %d' : '';

  const parts = [notify, socsq, csq].filter(Boolean);
  if (parts.length > 0) return `${prefix}${parts.join(' ')}`.trim();

  return `${prefix}${normalizeTextLine(text)}`.trim();
}

function hexHead(buf: Buffer, maxBytes: number): string {
  const b = buf.subarray(0, Math.min(maxBytes, buf.length));
  const hex = b.toString('hex').toUpperCase();
  return buf.length > b.length ? `${hex}…(${buf.length}B)` : `${hex}(${buf.length}B)`;
}

function traceEnabled(): boolean {
  return String(process.env.FORWARDING_TRACE || '').trim() === '1';
}

export function buildOutboundPayload(batch: ForwardingOutboundBatch, opts: { xmlTemplate?: string }): BuiltPayload {
  const payloadObj = {
    batchId: batch.id,
    createdAt: batch.createdAt,
    channelId: batch.channelId,
    count: batch.records.length,
    records: batch.records.map(r => ({
      id: r.id,
      ts: r.ts,
      portPath: r.portPath,
      deviceId: r.deviceId,
      dataType: r.dataType,
      payloadText: r.payloadText,
      payloadJson: r.payloadJson,
      payloadBytesBase64: r.payloadBytesBase64,
      hash: r.hash
    }))
  };

  let format: ForwardingPayloadFormat = batch.payloadFormat;
  let body: Buffer;
  let headers: Record<string, string> = {
    'x-forwarding-batch-id': batch.id,
    'x-forwarding-channel-id': batch.channelId
  };

  if (format === 'binary') {
    body = buildBinary(batch);
    headers['content-type'] = 'application/octet-stream';
  } else if (format === 'feishu') {
    if (traceEnabled()) {
      const sample = batch.records.slice(0, 2);
      for (const r of sample) {
        const b64 = typeof (r as any)?.rawBytesBase64 === 'string' ? (r as any).rawBytesBase64 : '';
        if (b64) {
          const buf = Buffer.from(b64, 'base64');
          const decoded = decodeMixedBytes(buf, { controlStrategy: 'space', invalidByteStrategy: 'replace', binaryStrategy: 'summary' });
          const cleaned = stripEscapeArtifacts(decoded.text);
          console.log(`[Forwarding] feishu trace raw=${hexHead(buf, 64)}`);
          console.log(`[Forwarding] feishu trace decoded=${cleaned.slice(0, 160)}`);
        } else {
          const cleaned = stripEscapeArtifacts(String((r as any)?.payloadText || ''));
          console.log(`[Forwarding] feishu trace decoded=${cleaned.slice(0, 160)}`);
        }
      }
    }
    const lines = batch.records.map(r => formatRecordLine(r)).filter(Boolean);
    let text = lines.join('\n');
    if (!text) text = `(empty batch) id=${batch.id}`;
    if (text.length > 3500) text = `${text.slice(0, 3500)}…(truncated)`;
    const maxBytes = 19_000;
    while (true) {
      const feishuBody = {
        msg_type: 'text',
        content: { text }
      };
      const json = JSON.stringify(feishuBody);
      if (Buffer.byteLength(json, 'utf8') <= maxBytes) {
        body = Buffer.from(json, 'utf8');
        break;
      }
      if (text.length <= 200) {
        body = Buffer.from(JSON.stringify({ msg_type: 'text', content: { text: '(message too large)' } }), 'utf8');
        break;
      }
      text = `${text.slice(0, Math.floor(text.length * 0.85))}…(truncated)`;
    }
    headers['content-type'] = 'application/json; charset=utf-8';
    if (traceEnabled()) {
      console.log(`[Forwarding] feishu trace body=${hexHead(body, 64)}`);
    }
  } else if (format === 'xml') {
    const template = opts.xmlTemplate || '<batch id="{{batchId}}" createdAt="{{createdAt}}" channelId="{{channelId}}" count="{{count}}">{{recordsJson}}</batch>';
    const xml = buildXmlFromTemplate(template, {
      batchId: String(payloadObj.batchId),
      createdAt: String(payloadObj.createdAt),
      channelId: String(payloadObj.channelId),
      count: String(payloadObj.count),
      recordsJson: JSON.stringify(payloadObj.records)
    });
    body = Buffer.from(xml, 'utf8');
    headers['content-type'] = 'application/xml; charset=utf-8';
  } else {
    format = 'json';
    body = Buffer.from(JSON.stringify(payloadObj), 'utf8');
    headers['content-type'] = 'application/json; charset=utf-8';
  }

  const plaintextSha256 = crypto.createHash('sha256').update(body).digest('hex');
  headers['x-forwarding-sha256'] = plaintextSha256;

  const enableEnvelope = format !== 'feishu';
  if (enableEnvelope) {
    const compression: ForwardingCompression = batch.compression || 'none';
    if (compression === 'gzip') {
      body = gzip(body);
      headers['content-encoding'] = 'gzip';
    }

    const encryption: ForwardingEncryption = batch.encryption || 'none';
    if (encryption === 'aes-256-gcm') {
      const key = getEncryptionKey(batch.encryptionKeyId);
      if (key) {
        const { ciphertext, iv, tag } = aes256gcmEncrypt(body, key);
        body = Buffer.concat([iv, tag, ciphertext]);
        headers['content-type'] = 'application/octet-stream';
        headers['x-forwarding-encrypted'] = 'aes-256-gcm';
        headers['x-forwarding-iv'] = iv.toString('base64');
        headers['x-forwarding-tag'] = tag.toString('base64');
      }
    }
  }

  return { format, body, headers, plaintextSha256 };
}
