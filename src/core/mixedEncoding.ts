export type MixedSegmentKind = 'ascii' | 'utf8' | 'control' | 'invalid' | 'binary';

export interface MixedSegment {
  kind: MixedSegmentKind;
  start: number;
  end: number;
  bytes: Buffer;
  text?: string;
}

export interface MixedDecodeOptions {
  controlStrategy?: 'escape' | 'strip' | 'space';
  invalidByteStrategy?: 'escape' | 'replace' | 'hex' | 'latin1';
  binaryStrategy?: 'escape' | 'hex' | 'summary';
  binaryRunMinBytes?: number;
  binaryRunNonTextRatio?: number;
  maxOutputChars?: number;
  preserveNewlines?: boolean;
}

export interface MixedDecodeResult {
  text: string;
  searchText: string;
  segments: MixedSegment[];
  stats: {
    inputBytes: number;
    outputChars: number;
    utf8Bytes: number;
    asciiBytes: number;
    controlBytes: number;
    invalidBytes: number;
    binaryBytes: number;
    truncated: boolean;
  };
}

const DEFAULTS: Required<MixedDecodeOptions> = {
  controlStrategy: 'escape',
  invalidByteStrategy: 'escape',
  binaryStrategy: 'summary',
  binaryRunMinBytes: 8,
  binaryRunNonTextRatio: 0.7,
  maxOutputChars: 64_000,
  preserveNewlines: true
};

function isAsciiPrintable(b: number, preserveNewlines: boolean): boolean {
  if (b >= 0x20 && b <= 0x7e) return true;
  if (b === 0x09) return true;
  if (preserveNewlines && (b === 0x0a || b === 0x0d)) return true;
  return false;
}

function utf8SeqLen(lead: number): number {
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

function isCont(b: number): boolean {
  return b >= 0x80 && b <= 0xbf;
}

function isValidUtf8At(bytes: Buffer, i: number, len: number): boolean {
  const b0 = bytes[i];
  if (len === 2) {
    const b1 = bytes[i + 1];
    return isCont(b1);
  }
  if (len === 3) {
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    if (!isCont(b1) || !isCont(b2)) return false;
    if (b0 === 0xe0 && b1 < 0xa0) return false;
    if (b0 === 0xed && b1 >= 0xa0) return false;
    return true;
  }
  if (len === 4) {
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const b3 = bytes[i + 3];
    if (!isCont(b1) || !isCont(b2) || !isCont(b3)) return false;
    if (b0 === 0xf0 && b1 < 0x90) return false;
    if (b0 === 0xf4 && b1 >= 0x90) return false;
    return true;
  }
  return false;
}

function maybeMarkBinary(segs: MixedSegment[], opts: Required<MixedDecodeOptions>): MixedSegment[] {
  const out: MixedSegment[] = [];
  for (const s of segs) {
    if (s.kind !== 'control' && s.kind !== 'invalid') {
      out.push(s);
      continue;
    }
    const bytes = s.bytes;
    if (bytes.length < opts.binaryRunMinBytes) {
      out.push(s);
      continue;
    }
    let nonText = 0;
    let hasNul = false;
    for (const b of bytes) {
      if (b === 0x00) hasNul = true;
      if (b < 0x20 || b === 0x7f || b >= 0x80) nonText++;
    }
    const ratio = bytes.length ? nonText / bytes.length : 0;
    if (hasNul || ratio >= opts.binaryRunNonTextRatio) {
      out.push({ ...s, kind: 'binary' });
    } else {
      out.push(s);
    }
  }
  return out;
}

function hexByte(b: number): string {
  return b.toString(16).padStart(2, '0').toUpperCase();
}

function escapeControlByte(b: number): string {
  return `\\u00${hexByte(b)}`;
}

function renderBinary(bytes: Buffer, strategy: Required<MixedDecodeOptions>['binaryStrategy']): string {
  if (bytes.length === 0) return '';
  if (strategy === 'escape') {
    return Array.from(bytes, b => `\\x${hexByte(b)}`).join('');
  }
  if (strategy === 'hex') {
    return bytes.toString('hex').toUpperCase();
  }
  const head = bytes.subarray(0, Math.min(bytes.length, 24));
  const headHex = head.toString('hex').toUpperCase();
  return `<bin:${bytes.length}B:${headHex}${bytes.length > head.length ? '…' : ''}>`;
}

function renderInvalidByte(b: number, strategy: Required<MixedDecodeOptions>['invalidByteStrategy']): string {
  if (strategy === 'replace') return '�';
  if (strategy === 'hex') return `<${hexByte(b)}>`;
  if (strategy === 'latin1') return String.fromCharCode(b);
  return `\\x${hexByte(b)}`;
}

export function decodeMixedBytes(input: Buffer, options?: MixedDecodeOptions): MixedDecodeResult {
  const opts: Required<MixedDecodeOptions> = { ...DEFAULTS, ...(options || {}) };
  const segments: MixedSegment[] = [];
  let i = 0;
  let utf8Bytes = 0;
  let asciiBytes = 0;
  let controlBytes = 0;
  let invalidBytes = 0;
  let binaryBytes = 0;
  let truncated = false;

  while (i < input.length) {
    const b = input[i];
    if (b < 0x80) {
      if (isAsciiPrintable(b, opts.preserveNewlines)) {
        const start = i;
        i += 1;
        while (i < input.length && input[i] < 0x80 && isAsciiPrintable(input[i], opts.preserveNewlines)) i += 1;
        const bytes = input.subarray(start, i);
        segments.push({ kind: 'ascii', start, end: i, bytes, text: bytes.toString('latin1') });
        asciiBytes += bytes.length;
      } else {
        const start = i;
        i += 1;
        while (i < input.length && input[i] < 0x80 && !isAsciiPrintable(input[i], opts.preserveNewlines)) i += 1;
        const bytes = input.subarray(start, i);
        segments.push({ kind: 'control', start, end: i, bytes });
        controlBytes += bytes.length;
      }
      continue;
    }

    const len = utf8SeqLen(b);
    if (len && i + len <= input.length && isValidUtf8At(input, i, len)) {
      const start = i;
      i += len;
      while (i < input.length) {
        const nb = input[i];
        if (nb < 0x80) break;
        const nlen = utf8SeqLen(nb);
        if (!nlen || i + nlen > input.length || !isValidUtf8At(input, i, nlen)) break;
        i += nlen;
      }
      const bytes = input.subarray(start, i);
      segments.push({ kind: 'utf8', start, end: i, bytes, text: bytes.toString('utf8') });
      utf8Bytes += bytes.length;
      continue;
    }

    const start = i;
    i += 1;
    while (i < input.length) {
      const nb = input[i];
      if (nb < 0x80) break;
      const nlen = utf8SeqLen(nb);
      if (nlen && i + nlen <= input.length && isValidUtf8At(input, i, nlen)) break;
      i += 1;
    }
    const bytes = input.subarray(start, i);
    segments.push({ kind: 'invalid', start, end: i, bytes });
    invalidBytes += bytes.length;
  }

  const merged = maybeMarkBinary(segments, opts);
  for (const s of merged) {
    if (s.kind === 'binary') binaryBytes += s.bytes.length;
  }

  const outParts: string[] = [];
  const searchParts: string[] = [];
  let outChars = 0;
  const pushOut = (s: string, search: string) => {
    if (truncated) return;
    const nextLen = outChars + s.length;
    if (nextLen > opts.maxOutputChars) {
      const remain = Math.max(0, opts.maxOutputChars - outChars);
      if (remain > 0) outParts.push(s.slice(0, remain));
      outParts.push('…');
      truncated = true;
      outChars = opts.maxOutputChars + 1;
      return;
    }
    outParts.push(s);
    searchParts.push(search);
    outChars = nextLen;
  };

  for (const s of merged) {
    if (s.kind === 'ascii' || s.kind === 'utf8') {
      const t = s.text || '';
      pushOut(t, t);
      continue;
    }
    if (s.kind === 'control') {
      if (opts.controlStrategy === 'strip') {
        pushOut('', '');
      } else if (opts.controlStrategy === 'space') {
        pushOut(' ', ' ');
      } else {
        const rendered = Array.from(s.bytes, b => escapeControlByte(b)).join('');
        pushOut(rendered, '');
      }
      continue;
    }
    if (s.kind === 'invalid') {
      const rendered = Array.from(s.bytes, b => renderInvalidByte(b, opts.invalidByteStrategy)).join('');
      pushOut(rendered, '');
      continue;
    }
    if (s.kind === 'binary') {
      const rendered = renderBinary(s.bytes, opts.binaryStrategy);
      pushOut(rendered, '');
      continue;
    }
  }

  const text = outParts.join('');
  const searchText = searchParts.join('');
  return {
    text,
    searchText,
    segments: merged,
    stats: {
      inputBytes: input.length,
      outputChars: text.length,
      utf8Bytes,
      asciiBytes,
      controlBytes,
      invalidBytes,
      binaryBytes,
      truncated
    }
  };
}
