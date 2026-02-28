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
