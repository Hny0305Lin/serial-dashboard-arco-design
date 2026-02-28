export type ForwardingPayloadFormat = 'json' | 'xml' | 'binary' | 'feishu';
export type ForwardingChannelType = 'http' | 'websocket' | 'tcp' | 'mqtt';

export type ForwardingFrameMode = 'stream' | 'line' | 'fixed' | 'aa55';
export type ForwardingParseMode = 'text-regex' | 'json' | 'binary';

export type ForwardingCompression = 'none' | 'gzip';
export type ForwardingEncryption = 'none' | 'aes-256-gcm';

export interface ForwardingFrameRule {
  mode: ForwardingFrameMode;
  lineDelimiter?: 'lf' | 'crlf' | 'custom';
  customDelimiterHex?: string;
  fixedLengthBytes?: number;
  maxFrameBytes?: number;
}

export interface ForwardingParseRule {
  mode: ForwardingParseMode;
  regex?: string;
  regexFlags?: string;
  jsonDeviceIdPath?: string;
  jsonTypePath?: string;
  jsonPayloadPath?: string;
}

export interface ForwardingSourceRule {
  enabled: boolean;
  ownerWidgetId?: string;
  portPath: string;
  framing: ForwardingFrameRule;
  parse: ForwardingParseRule;
  startOnText?: string;
  startMode?: 'after' | 'only';
  includeStartLine?: boolean;
}

export interface ForwardingChannelHttpConfig {
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ForwardingChannelWebSocketConfig {
  url: string;
  protocols?: string[];
  timeoutMs?: number;
}

export interface ForwardingChannelTcpConfig {
  host: string;
  port: number;
  timeoutMs?: number;
}

export interface ForwardingChannelMqttConfig {
  url: string;
  topic: string;
  qos?: 0 | 1 | 2;
  clientId?: string;
  username?: string;
  password?: string;
}

export type ForwardingChannelTargetConfig =
  | { type: 'http'; http: ForwardingChannelHttpConfig }
  | { type: 'websocket'; websocket: ForwardingChannelWebSocketConfig }
  | { type: 'tcp'; tcp: ForwardingChannelTcpConfig }
  | { type: 'mqtt'; mqtt: ForwardingChannelMqttConfig };

export type ForwardingChannelConfig = ForwardingChannelTargetConfig & {
  id: string;
  name: string;
  enabled: boolean;
  ownerWidgetId?: string;
  deliveryMode?: 'at-least-once' | 'at-most-once';
  dropStaleBatchesOnPortReopen?: boolean;
  payloadFormat: ForwardingPayloadFormat;
  xmlTemplate?: string;
  compression?: ForwardingCompression;
  encryption?: ForwardingEncryption;
  encryptionKeyId?: string;
  flushIntervalMs?: number;
  batchSize?: number;
  retryMaxAttempts?: number;
  retryBaseDelayMs?: number;
  dedupWindowMs?: number;
  dedupMaxEntries?: number;
  filter?: {
    portPaths?: string[];
    deviceIds?: string[];
    types?: string[];
  };
};

export interface ForwardingAlertConfig {
  enabled: boolean;
  queueLengthWarn?: number;
  failureRateWarn?: number;
  webhookUrl?: string;
}

export interface ForwardingConfigV1 {
  version: 1;
  enabled: boolean;
  sources: ForwardingSourceRule[];
  channels: ForwardingChannelConfig[];
  integrity?: {
    schemaVersion: 1;
    savedAt: number;
    hash: string;
  };
  store?: {
    maxMemoryRecords?: number;
    dataDir?: string;
    maxRecordBytes?: number;
  };
  alert?: ForwardingAlertConfig;
}

export interface ForwardingRecord {
  id: string;
  ts: number;
  portPath: string;
  portSessionId?: string;
  seq?: number;
  deviceId?: string;
  dataType?: string;
  payloadText?: string;
  payloadJson?: any;
  payloadBytesBase64?: string;
  rawBytesBase64?: string;
  hash: string;
}

export interface ForwardingOutboundBatch {
  id: string;
  channelId: string;
  createdAt: number;
  records: ForwardingRecord[];
  portEpochByPath?: Record<string, number>;
  portSessionIdByPath?: Record<string, string>;
  payloadFormat: ForwardingPayloadFormat;
  compression: ForwardingCompression;
  encryption: ForwardingEncryption;
  encryptionKeyId?: string;
}

export interface ForwardingChannelMetrics {
  channelId: string;
  enabled: boolean;
  queueLength: number;
  sent: number;
  failed: number;
  dropped: number;
  lastError?: string;
  lastSuccessAt?: number;
  lastLatencyMs?: number;
  avgLatencyMs?: number;
}

export interface ForwardingMetricsSnapshot {
  ts: number;
  enabled: boolean;
  channels: ForwardingChannelMetrics[];
}
