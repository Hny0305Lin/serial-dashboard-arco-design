export interface ChannelSendResult {
  latencyMs: number;
}

export interface ChannelSender {
  send(payload: Buffer, headers: Record<string, string>, opts?: { idempotencyKey?: string }): Promise<ChannelSendResult>;
  close(): Promise<void>;
}
