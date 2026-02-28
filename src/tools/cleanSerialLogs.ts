import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { decodeMixedBytes } from '../core/mixedEncoding';

type NdjsonRecord = {
  ts?: number;
  portPath?: string;
  seq?: number;
  rawBytesBase64?: string;
  payloadText?: string;
};

type InputMode = 'ndjson' | 'text';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function stripEscapesAndBins(s: string): string {
  return s
    .replace(/<bin:[^>]*>/g, ' ')
    .replace(/\\u[0-9a-fA-F]{4}/g, ' ')
    .replace(/\\x[0-9a-fA-F]{2}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSpaces(s: string): string {
  return s.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractUsefulLines(rawText: string, opts: { includeCsq: boolean }): string[] {
  const t0 = normalizeSpaces(rawText);
  if (!t0) return [];

  const lines: string[] = [];

  const t1 = t0
    .replace(/^%\.?\*s\s*/g, '')
    .replace(/\s*~~\s*/g, ' ')
    .replace(/^\>\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const t2 = t1.replace(/^[A-Z](\/user\.)/g, '$1');

  const userIdx = t2.indexOf('/user.');
  const tUser = userIdx >= 0 ? t2.slice(userIdx) : '';
  const userMobile = tUser.match(/(\/user\.[^\s]+)\s+mobile\.status\s+\d+\s+(.+)$/);
  if (userMobile) {
    const rawMsg = String(userMobile[2] || '');
    let msg = rawMsg;
    const roam = rawMsg.includes('网络已注册,漫游');
    if (roam) msg = '网络已注册,漫游';
    else if (rawMsg.includes('网络已注册')) msg = '网络已注册';
    else if (rawMsg.includes('网络未注册')) msg = '网络未注册';
    else {
      msg = rawMsg
        .replace(/\s+Lj.*$/g, '')
        .replace(/\s+L[0-9A-Za-z]{0,6}s.*$/g, '')
        .replace(/\s+\+.*$/g, '')
        .trim();
    }
    lines.push(`${userMobile[1]} mobile.status ${msg}`.trim());
  }

  const socsq = t2.match(/\+SOCSQ:\s*%d,%d,%d/);
  if (socsq) lines.push('SOCSQ: %d,%d,%d');

  if (opts.includeCsq) {
    const csq = t2.match(/\+CSQ:\s*%d/);
    if (csq) lines.push('CSQ: %d');
  }

  const soccell = t2.match(/\+SOCCELL:\s*(.+)$/);
  if (soccell) lines.push(`SOCCELL: ${soccell[1]}`.trim());

  const out = Array.from(new Set(lines.map(normalizeSpaces))).filter(Boolean);
  return out;
}

async function readNdjsonFile(filePath: string): Promise<NdjsonRecord[]> {
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const records: NdjsonRecord[] = [];
  for await (const line of rl) {
    const s = String(line || '').trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s);
      records.push(obj);
    } catch {
    }
  }
  return records;
}

async function readTextLines(filePath: string): Promise<string[]> {
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const lines: string[] = [];
  for await (const line of rl) lines.push(String(line || ''));
  return lines;
}

function toCleanTextFromNdjson(rec: NdjsonRecord): string {
  if (rec.rawBytesBase64) {
    const buf = Buffer.from(rec.rawBytesBase64, 'base64');
    return decodeMixedBytes(buf).searchText;
  }
  if (typeof rec.payloadText === 'string') return stripEscapesAndBins(rec.payloadText);
  return '';
}

function toCleanTextFromRawLine(line: string): string {
  const s = stripEscapesAndBins(line);
  return s
    .replace(/^\[?\d{4}[-/]\d{2}[-/]\d{2}[^ \]]*\]?\s*/g, '')
    .replace(/\bCOM\d+\b\s*[:\-]\s*/g, '')
    .replace(/\b(COM\d+)\b/g, '$1')
    .trim();
}

function compareByTsSeq(a: { ts?: number; seq?: number }, b: { ts?: number; seq?: number }): number {
  const ta = typeof a.ts === 'number' ? a.ts : 0;
  const tb = typeof b.ts === 'number' ? b.ts : 0;
  if (ta !== tb) return ta - tb;
  const sa = typeof a.seq === 'number' ? a.seq : 0;
  const sb = typeof b.seq === 'number' ? b.seq : 0;
  return sa - sb;
}

function inferMode(args: Record<string, string | boolean>): InputMode {
  const m = String(args.mode || '').trim().toLowerCase();
  if (m === 'text') return 'text';
  return 'ndjson';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const mode = inferMode(args);
  const inPath = String(args.in || '').trim();
  if (!inPath) {
    process.stderr.write(
      [
        'Usage:',
        '  node dist/tools/cleanSerialLogs.js --mode ndjson --in data/records/records-YYYY-MM-DD.ndjson [--port COM18]',
        '  node dist/tools/cleanSerialLogs.js --mode text --in raw.log',
        ''
      ].join('\n')
    );
    process.exitCode = 2;
    return;
  }

  const abs = path.isAbsolute(inPath) ? inPath : path.join(process.cwd(), inPath);
  const port = typeof args.port === 'string' ? String(args.port).trim() : '';
  const includeCsq = args['include-csq'] === true || String(args['include-csq'] || '').trim() === '1';
  const extractOpts = { includeCsq };

  const outputs: { ts?: number; seq?: number; line: string }[] = [];

  if (mode === 'ndjson') {
    const records = await readNdjsonFile(abs);
    records.sort(compareByTsSeq);
    for (const rec of records) {
      if (port && String(rec.portPath || '').trim() !== port) continue;
      const cleaned = toCleanTextFromNdjson(rec);
      for (const line of extractUsefulLines(cleaned, extractOpts)) {
        outputs.push({ ts: rec.ts, seq: rec.seq, line });
      }
    }
  } else {
    const lines = await readTextLines(abs);
    for (const raw of lines) {
      const cleaned = toCleanTextFromRawLine(raw);
      for (const line of extractUsefulLines(cleaned, extractOpts)) outputs.push({ line });
    }
  }

  const deduped: string[] = [];
  for (const o of outputs) {
    const s = normalizeSpaces(o.line);
    if (!s) continue;
    if (deduped.length && deduped[deduped.length - 1] === s) continue;
    deduped.push(s);
  }

  for (const line of deduped) process.stdout.write(line + '\n');
}

main().catch(() => {
  process.exitCode = 1;
});
