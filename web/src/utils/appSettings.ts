export type DataEncoding = 'hex' | 'utf8';

export interface SerialFilterConfig {
  enabled: boolean;
  vendorId: string;
  productId: string;
  interfaceId: string;
}

export interface AutoSendConfig {
  enabled: boolean;
  content: string;
  encoding: DataEncoding;
}

export interface AppSettingsV1 {
  schemaVersion: 1;
  updatedAt: number;
  sendEncoding: DataEncoding;
  serialFilter: SerialFilterConfig;
  autoSend: AutoSendConfig;
}

export const APP_SETTINGS_SCHEMA_VERSION = 1 as const;

export function getDefaultAppSettings(): AppSettingsV1 {
  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    updatedAt: Date.now(),
    sendEncoding: 'hex',
    serialFilter: { enabled: false, vendorId: '19D1', productId: '0001', interfaceId: '02' },
    autoSend: { enabled: false, content: '00', encoding: 'hex' },
  };
}

function normalizeHexLike(v: unknown, fallback: string, maxLen: number): string {
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  const cleaned = s.replace(/^0x/i, '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen);
}

export function normalizeAppSettings(input: unknown): AppSettingsV1 {
  const d = getDefaultAppSettings();
  if (!input || typeof input !== 'object') return d;
  const o: any = input;

  const sendEncoding: DataEncoding = o.sendEncoding === 'utf8' ? 'utf8' : 'hex';
  const serialFilterIn = o.serialFilter && typeof o.serialFilter === 'object' ? o.serialFilter : {};
  const autoSendIn = o.autoSend && typeof o.autoSend === 'object' ? o.autoSend : {};

  const serialFilter: SerialFilterConfig = {
    enabled: !!(serialFilterIn as any).enabled,
    vendorId: normalizeHexLike((serialFilterIn as any).vendorId, d.serialFilter.vendorId, 4),
    productId: normalizeHexLike((serialFilterIn as any).productId, d.serialFilter.productId, 4),
    interfaceId: normalizeHexLike((serialFilterIn as any).interfaceId, d.serialFilter.interfaceId, 2),
  };

  const autoSend: AutoSendConfig = {
    enabled: !!(autoSendIn as any).enabled,
    content: String((autoSendIn as any).content ?? d.autoSend.content),
    encoding: (autoSendIn as any).encoding === 'utf8' ? 'utf8' : 'hex',
  };

  const updatedAt = Number.isFinite(Number(o.updatedAt)) ? Number(o.updatedAt) : d.updatedAt;

  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    updatedAt,
    sendEncoding,
    serialFilter,
    autoSend,
  };
}
