import crypto from 'crypto';
import { ForwardingFrameRule, ForwardingParseRule, ForwardingRecord } from '../../types/forwarding';

export function sha256Hex(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function getDelimiter(rule: ForwardingFrameRule): Buffer | null {
  if (rule.mode !== 'line') return null;
  const d = rule.lineDelimiter || 'lf';
  if (d === 'lf') return Buffer.from([0x0a]);
  if (d === 'crlf') return Buffer.from([0x0d, 0x0a]);
  const hex = (rule.customDelimiterHex || '').replace(/[^0-9a-fA-F]/g, '');
  if (!hex) return null;
  try {
    return Buffer.from(hex, 'hex');
  } catch (e) {
    return null;
  }
}

export function extractFrames(prev: Buffer, incoming: Buffer, rule: ForwardingFrameRule): { frames: Buffer[]; rest: Buffer; droppedBytes: number } {
  const maxFrame = Math.max(1, Math.min(rule.maxFrameBytes || 2048, 1024 * 1024));
  const next = prev.length ? Buffer.concat([prev, incoming]) : incoming;
  const frames: Buffer[] = [];
  let droppedBytes = 0;

  if (rule.mode === 'stream') {
    if (incoming.length > maxFrame) {
      frames.push(incoming.slice(0, maxFrame));
      droppedBytes += incoming.length - maxFrame;
    } else {
      frames.push(incoming);
    }
    return { frames, rest: Buffer.alloc(0), droppedBytes };
  }

  if (rule.mode === 'fixed') {
    const n = Math.max(1, rule.fixedLengthBytes || 1);
    let offset = 0;
    while (offset + n <= next.length) {
      frames.push(next.slice(offset, offset + n));
      offset += n;
    }
    return { frames, rest: next.slice(offset), droppedBytes };
  }

  if (rule.mode === 'line') {
    const delim = getDelimiter(rule);
    if (!delim || delim.length === 0) {
      const sliced = next.length > maxFrame ? next.slice(0, maxFrame) : next;
      frames.push(sliced);
      droppedBytes += Math.max(0, next.length - sliced.length);
      return { frames, rest: Buffer.alloc(0), droppedBytes };
    }

    let start = 0;
    let idx = next.indexOf(delim, start);
    while (idx !== -1) {
      const end = idx + delim.length;
      const frame = next.slice(start, idx);
      if (frame.length) {
        if (frame.length > maxFrame) {
          frames.push(frame.slice(0, maxFrame));
          droppedBytes += frame.length - maxFrame;
        } else {
          frames.push(frame);
        }
      }
      start = end;
      idx = next.indexOf(delim, start);
    }

    const rest = next.slice(start);
    if (rest.length > maxFrame) {
      droppedBytes += rest.length - maxFrame;
      return { frames, rest: rest.slice(rest.length - maxFrame), droppedBytes };
    }
    return { frames, rest, droppedBytes };
  }

  if (rule.mode === 'aa55') {
    const HEADER = 0xaa;
    const FOOTER = 0x55;
    const MIN = 5;
    let buf = next;

    while (buf.length >= MIN) {
      const headerIndex = buf.indexOf(HEADER);
      if (headerIndex === -1) {
        droppedBytes += buf.length;
        buf = Buffer.alloc(0);
        break;
      }
      if (headerIndex > 0) {
        droppedBytes += headerIndex;
        buf = buf.slice(headerIndex);
      }
      if (buf.length < 2) break;
      const payloadLength = buf[1];
      const packetSize = payloadLength + 5;
      if (packetSize > maxFrame) {
        droppedBytes += 1;
        buf = buf.slice(1);
        continue;
      }
      if (buf.length < packetSize) break;
      const packet = buf.slice(0, packetSize);
      if (packet[packetSize - 1] !== FOOTER) {
        droppedBytes += 1;
        buf = buf.slice(1);
        continue;
      }
      const receivedChecksum = packet[packetSize - 2];
      let calculatedChecksum = 0;
      for (let i = 0; i < packetSize - 2; i++) calculatedChecksum += packet[i];
      calculatedChecksum &= 0xff;
      if (receivedChecksum !== calculatedChecksum) {
        droppedBytes += 1;
        buf = buf.slice(1);
        continue;
      }
      frames.push(packet);
      buf = buf.slice(packetSize);
    }

    return { frames, rest: buf, droppedBytes };
  }

  const sliced = next.length > maxFrame ? next.slice(0, maxFrame) : next;
  frames.push(sliced);
  droppedBytes += Math.max(0, next.length - sliced.length);
  return { frames, rest: Buffer.alloc(0), droppedBytes };
}

function getByPath(obj: any, pathStr?: string): any {
  if (!pathStr) return undefined;
  const p = pathStr.trim();
  if (!p) return undefined;
  const parts = p.split('.').map(s => s.trim()).filter(Boolean);
  let cur: any = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    const m = part.match(/^(.+?)\[(\d+)\]$/);
    if (m) {
      cur = cur[m[1]];
      const idx = Number(m[2]);
      cur = Array.isArray(cur) ? cur[idx] : undefined;
      continue;
    }
    cur = cur[part];
  }
  return cur;
}

export function parseFrameToRecord(frame: Buffer, opts: { portPath: string; ts?: number; parse: ForwardingParseRule }): ForwardingRecord | null {
  const ts = typeof opts.ts === 'number' ? opts.ts : Date.now();
  const id = `${ts}-${Math.random().toString(16).slice(2)}`;
  const hash = sha256Hex(frame);
  const rawBytesBase64 = frame.toString('base64');
  const mode = opts.parse.mode;

  if (mode === 'binary') {
    return { id, ts, portPath: opts.portPath, payloadBytesBase64: rawBytesBase64, rawBytesBase64, hash };
  }

  const text = frame.toString('utf8');
  if (mode === 'json') {
    try {
      const obj = JSON.parse(text);
      const deviceId = getByPath(obj, opts.parse.jsonDeviceIdPath);
      const dataType = getByPath(obj, opts.parse.jsonTypePath);
      const payload = getByPath(obj, opts.parse.jsonPayloadPath) ?? obj;
      return {
        id,
        ts,
        portPath: opts.portPath,
        deviceId: deviceId != null ? String(deviceId) : undefined,
        dataType: dataType != null ? String(dataType) : undefined,
        payloadJson: payload,
        rawBytesBase64,
        hash
      };
    } catch (e) {
      return null;
    }
  }

  const pattern = opts.parse.regex;
  if (!pattern) {
    return { id, ts, portPath: opts.portPath, payloadText: text, rawBytesBase64, hash };
  }
  try {
    const re = new RegExp(pattern, opts.parse.regexFlags || '');
    const m = re.exec(text);
    if (!m) return null;
    const groups = (m as any).groups || {};
    const deviceId = groups.deviceId ?? groups.device ?? groups.id;
    const dataType = groups.type ?? groups.dataType;
    const payloadText = groups.payload ?? groups.value ?? text;
    return {
      id,
      ts,
      portPath: opts.portPath,
      deviceId: deviceId != null ? String(deviceId) : undefined,
      dataType: dataType != null ? String(dataType) : undefined,
      payloadText: String(payloadText),
      rawBytesBase64,
      hash
    };
  } catch (e) {
    return null;
  }
}
