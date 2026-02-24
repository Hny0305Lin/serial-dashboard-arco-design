import fs from 'fs/promises';
import path from 'path';

export interface FileQueueItem<T> {
  id: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  payload: T;
}

export class FileQueue<T> {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  public async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private itemPath(item: FileQueueItem<T>): string {
    const safeId = item.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.dir, `${item.createdAt}-${safeId}.json`);
  }

  public async enqueue(payload: T, opts?: { id?: string; nextAttemptAt?: number }): Promise<FileQueueItem<T>> {
    await this.init();
    const createdAt = Date.now();
    const id = opts?.id || `${createdAt}-${Math.random().toString(16).slice(2)}`;
    const item: FileQueueItem<T> = {
      id,
      createdAt,
      attempts: 0,
      nextAttemptAt: typeof opts?.nextAttemptAt === 'number' ? opts!.nextAttemptAt : createdAt,
      payload
    };
    const filePath = this.itemPath(item);
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify(item), 'utf8');
    await fs.rename(tmpPath, filePath);
    return item;
  }

  public async size(): Promise<number> {
    try {
      const entries = await fs.readdir(this.dir);
      return entries.filter(e => e.endsWith('.json')).length;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return 0;
      return 0;
    }
  }

  private async listItemFiles(): Promise<string[]> {
    await this.init();
    const entries = await fs.readdir(this.dir);
    return entries.filter(e => e.endsWith('.json')).sort();
  }

  public async peekReady(nowTs?: number): Promise<{ filePath: string; item: FileQueueItem<T> } | null> {
    const now = typeof nowTs === 'number' ? nowTs : Date.now();
    const files = await this.listItemFiles();
    for (const file of files) {
      const filePath = path.join(this.dir, file);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const item = JSON.parse(raw) as FileQueueItem<T>;
        if (!item || !item.id) continue;
        if ((item.nextAttemptAt || 0) > now) continue;
        return { filePath, item };
      } catch (e) {
      }
    }
    return null;
  }

  public async ack(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (e) {
    }
  }

  public async nack(filePath: string, item: FileQueueItem<T>, nextAttemptAt: number): Promise<void> {
    const updated: FileQueueItem<T> = {
      ...item,
      attempts: (item.attempts || 0) + 1,
      nextAttemptAt
    };
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    try {
      await fs.writeFile(tmpPath, JSON.stringify(updated), 'utf8');
      await fs.rename(tmpPath, filePath);
    } catch (e) {
      try {
        await fs.unlink(tmpPath);
      } catch (e2) {
      }
    }
  }

  public async clear(): Promise<void> {
    try {
      const files = await this.listItemFiles();
      await Promise.all(files.map(f => fs.unlink(path.join(this.dir, f)).catch(() => undefined)));
    } catch (e) {
    }
  }
}
