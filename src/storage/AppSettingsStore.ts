import { JsonFileStore } from './JsonFileStore';
import type { AppSettingsV1 } from '../types/appSettings';

function normalizeHexLike(v: unknown, fallback: string, maxLen: number): string {
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  const cleaned = s.replace(/^0x/i, '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen);
}

function getDefaultSettings(): AppSettingsV1 {
  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    sendEncoding: 'hex',
    serialFilter: { enabled: false, vendorId: '19D1', productId: '0001', interfaceId: '02' },
    autoSend: { enabled: false, content: '00', encoding: 'hex' },
  };
}

function normalizeSettings(input: any): AppSettingsV1 {
  const d = getDefaultSettings();
  if (!input || typeof input !== 'object') return d;
  const sendEncoding = input.sendEncoding === 'utf8' ? 'utf8' : 'hex';
  const serialFilterIn = input.serialFilter && typeof input.serialFilter === 'object' ? input.serialFilter : {};
  const autoSendIn = input.autoSend && typeof input.autoSend === 'object' ? input.autoSend : {};
  const updatedAt = Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : d.updatedAt;
  return {
    schemaVersion: 1,
    updatedAt,
    sendEncoding,
    serialFilter: {
      enabled: !!serialFilterIn.enabled,
      vendorId: normalizeHexLike(serialFilterIn.vendorId, d.serialFilter.vendorId, 4),
      productId: normalizeHexLike(serialFilterIn.productId, d.serialFilter.productId, 4),
      interfaceId: normalizeHexLike(serialFilterIn.interfaceId, d.serialFilter.interfaceId, 2),
    },
    autoSend: {
      enabled: !!autoSendIn.enabled,
      content: String(autoSendIn.content ?? d.autoSend.content),
      encoding: autoSendIn.encoding === 'utf8' ? 'utf8' : 'hex',
    },
  };
}

export class AppSettingsStore {
  private store: JsonFileStore<AppSettingsV1>;

  constructor(filePath: string) {
    this.store = new JsonFileStore<AppSettingsV1>(filePath);
  }

  async read(): Promise<AppSettingsV1> {
    const d = getDefaultSettings();
    const raw = await this.store.read(d);
    return normalizeSettings(raw);
  }

  async write(next: unknown): Promise<AppSettingsV1> {
    const normalized = normalizeSettings(next);
    await this.store.write(normalized);
    return normalized;
  }
}
