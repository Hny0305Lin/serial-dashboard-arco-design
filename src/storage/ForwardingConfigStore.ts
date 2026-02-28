import fs from 'fs/promises';
import path from 'path';

export type ForwardingConfigStoreReadResult<T> = {
  value: T;
  source: 'main' | 'backup' | 'default';
  restored: boolean;
  reason?: string;
};

export type ForwardingConfigStoreWriteResult = {
  bytes: number;
  filePath: string;
};

type ValidateResult = { ok: true } | { ok: false; reason: string };

async function readText(filePath: string): Promise<{ ok: true; text: string } | { ok: false; code?: string; message: string }> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, code: String(e?.code || ''), message: String(e?.message || e) };
  }
}

async function fsyncFile(filePath: string): Promise<void> {
  const fh = await fs.open(filePath, 'r+');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

async function fsyncDir(dirPath: string): Promise<void> {
  try {
    const fh = await fs.open(dirPath, 'r');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
  }
}

export class ForwardingConfigStore<T> {
  private configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
  }

  public getFilePath(): string {
    return this.configPath;
  }

  public getBackupPath(): string {
    return `${this.configPath}.bak`;
  }

  private tryParse(text: string): { ok: true; value: any } | { ok: false; reason: string } {
    try {
      const parsed = JSON.parse(text);
      return { ok: true, value: parsed };
    } catch (e: any) {
      return { ok: false, reason: `JSON parse failed: ${String(e?.message || e)}` };
    }
  }

  private async archiveMainIfExists(): Promise<void> {
    const ts = Date.now();
    const target = `${this.configPath}.corrupt.${ts}`;
    try {
      await fs.rename(this.configPath, target);
    } catch {
    }
  }

  public async readWithRecovery(input: {
    defaultValue: T;
    validate?: (value: any) => ValidateResult;
    restoreOnDefault?: boolean;
  }): Promise<ForwardingConfigStoreReadResult<T>> {
    const validate = input.validate || (() => ({ ok: true } as const));
    const mainRead = await readText(this.configPath);
    if (mainRead.ok) {
      const parsed = this.tryParse(mainRead.text);
      if (parsed.ok) {
        const v = validate(parsed.value);
        if (v.ok) return { value: parsed.value as T, source: 'main', restored: false };
        const fromBackup = await this.tryReadBackup(input.defaultValue, validate, { archiveMain: true, reason: v.reason });
        if (fromBackup) return fromBackup;
        const out = { value: input.defaultValue, source: 'default' as const, restored: true, reason: v.reason };
        if (input.restoreOnDefault) await this.writeAtomic(out.value, { forceBackup: true }).catch(() => undefined);
        return out;
      }
      const fromBackup = await this.tryReadBackup(input.defaultValue, validate, { archiveMain: true, reason: parsed.reason });
      if (fromBackup) return fromBackup;
      const out = { value: input.defaultValue, source: 'default' as const, restored: true, reason: parsed.reason };
      if (input.restoreOnDefault) await this.writeAtomic(out.value, { forceBackup: true }).catch(() => undefined);
      return out;
    }

    if (String((mainRead as any)?.code || '') === 'ENOENT') {
      const fromBackup = await this.tryReadBackup(input.defaultValue, validate, { archiveMain: false, reason: 'config file missing' });
      if (fromBackup) return fromBackup;
      const out = { value: input.defaultValue, source: 'default' as const, restored: true, reason: 'config file missing' };
      if (input.restoreOnDefault) await this.writeAtomic(out.value, { forceBackup: false }).catch(() => undefined);
      return out;
    }

    const fromBackup = await this.tryReadBackup(input.defaultValue, validate, {
      archiveMain: true,
      reason: `read failed: ${(mainRead as any).message}`
    });
    if (fromBackup) return fromBackup;
    const out = { value: input.defaultValue, source: 'default' as const, restored: true, reason: `read failed: ${(mainRead as any).message}` };
    if (input.restoreOnDefault) await this.writeAtomic(out.value, { forceBackup: true }).catch(() => undefined);
    return out;
  }

  private async tryReadBackup(
    defaultValue: T,
    validate: (value: any) => ValidateResult,
    opts?: { archiveMain?: boolean; reason?: string }
  ): Promise<ForwardingConfigStoreReadResult<T> | null> {
    const bakPath = this.getBackupPath();
    const bakRead = await readText(bakPath);
    if (!bakRead.ok) return null;
    const parsed = this.tryParse(bakRead.text);
    if (!parsed.ok) return null;
    const v = validate(parsed.value);
    if (!v.ok) return null;
    if (opts?.archiveMain) await this.archiveMainIfExists();
    await this.writeAtomic(parsed.value as T, { forceBackup: false }).catch(() => undefined);
    return { value: parsed.value as T, source: 'backup', restored: true, reason: opts?.reason };
  }

  public async writeAtomic(value: T, opts?: { forceBackup?: boolean }): Promise<ForwardingConfigStoreWriteResult> {
    const serialized = JSON.stringify(value, null, 2);
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });

    const shouldBackup = opts?.forceBackup ?? true;
    if (shouldBackup) await fs.mkdir(path.dirname(this.getBackupPath()), { recursive: true });

    const tmpPath = `${this.configPath}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmpPath, serialized, 'utf8');
    await fsyncFile(tmpPath);
    await fs.rename(tmpPath, this.configPath);
    await fsyncDir(dir);

    if (shouldBackup) {
      try {
        await fs.copyFile(this.configPath, this.getBackupPath());
      } catch {
      }
    }
    return { bytes: Buffer.byteLength(serialized, 'utf8'), filePath: this.configPath };
  }
}
