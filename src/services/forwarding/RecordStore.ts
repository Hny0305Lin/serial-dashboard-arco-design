import fs from 'fs/promises';
import path from 'path';
import { ForwardingRecord } from '../../types/forwarding';

function dayKey(ts: number): string {
  const d = new Date(ts);
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export class RecordStore {
  private dir: string;
  private maxMemory: number;
  private maxRecordBytes: number;
  private ring: ForwardingRecord[] = [];

  constructor(opts: { dir: string; maxMemoryRecords: number; maxRecordBytes: number }) {
    this.dir = opts.dir;
    this.maxMemory = Math.max(0, Math.min(opts.maxMemoryRecords || 2000, 20000));
    this.maxRecordBytes = Math.max(256, Math.min(opts.maxRecordBytes || 64 * 1024, 1024 * 1024));
  }

  public async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  public getRecent(limit: number): ForwardingRecord[] {
    const n = Math.max(0, Math.min(limit || 50, this.ring.length));
    return this.ring.slice(this.ring.length - n);
  }

  public async append(record: ForwardingRecord): Promise<void> {
    if (this.maxMemory > 0) {
      this.ring.push(record);
      if (this.ring.length > this.maxMemory) this.ring.splice(0, this.ring.length - this.maxMemory);
    }

    const line = JSON.stringify(record);
    if (Buffer.byteLength(line, 'utf8') > this.maxRecordBytes) return;
    await this.init();
    const file = path.join(this.dir, `records-${dayKey(record.ts)}.ndjson`);
    await fs.appendFile(file, line + '\n', 'utf8');
  }
}
