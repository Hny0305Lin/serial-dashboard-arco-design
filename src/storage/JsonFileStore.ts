import fs from 'fs/promises';
import path from 'path';

export class JsonFileStore<T> {
  private filePath: string;
  private lastSerialized: string | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async read(defaultValue: T): Promise<T> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as T;
      return parsed ?? defaultValue;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return defaultValue;
      return defaultValue;
    }
  }

  public async write(value: T): Promise<void> {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized === this.lastSerialized) return;
    this.lastSerialized = serialized;

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.copyFile(this.filePath, `${this.filePath}.bak`);
    } catch (e: any) {
      if (e?.code !== 'ENOENT') {
        throw e;
      }
    }
    const tmpPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmpPath, serialized, 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }
}
