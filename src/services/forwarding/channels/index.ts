import { ForwardingChannelConfig } from '../../../types/forwarding';
import { ChannelSender } from './ChannelSender';
import { HttpSender } from './HttpSender';
import { WebSocketSender } from './WebSocketSender';
import { TcpSender } from './TcpSender';
import { MqttSender } from './MqttSender';

export function createChannelSender(channel: ForwardingChannelConfig): ChannelSender {
  if (channel.type === 'http') return new HttpSender(channel.http, { validateJsonCode: channel.payloadFormat === 'feishu' });
  if (channel.type === 'websocket') return new WebSocketSender(channel.websocket);
  if (channel.type === 'tcp') return new TcpSender(channel.tcp);
  if (channel.type === 'mqtt') return new MqttSender(channel.mqtt);
  throw new Error(`Unknown channel type: ${(channel as any).type}`);
}
