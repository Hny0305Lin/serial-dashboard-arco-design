import { Transform, TransformCallback } from 'stream';

/**
 * 二进制帧解析器
 * 协议格式:
 * Header (0xAA) | Length (1) | Command (1) | Payload (N) | Checksum (1) | Footer (0x55)
 * Checksum = (Header + Length + Command + Payload) & 0xFF
 */
export class PacketParser extends Transform {
  private buffer: Buffer;
  private readonly HEADER = 0xAA;
  private readonly FOOTER = 0x55;
  private readonly MIN_PACKET_SIZE = 5; // Header(1) + Len(1) + Cmd(1) + Checksum(1) + Footer(1) (Payload=0)

  constructor() {
    super({ objectMode: true });
    this.buffer = Buffer.alloc(0);
  }

  _transform(chunk: Buffer, encoding: string, callback: TransformCallback): void {
    // 将新数据拼接到缓冲区
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // 循环处理缓冲区中的数据
    while (this.buffer.length >= this.MIN_PACKET_SIZE) {
      // 1. 寻找 Header
      const headerIndex = this.buffer.indexOf(this.HEADER);
      
      if (headerIndex === -1) {
        // 没有找到 Header，丢弃所有数据
        this.buffer = Buffer.alloc(0);
        break;
      }

      // 如果 Header 不是在开头，丢弃 Header 之前的数据
      if (headerIndex > 0) {
        this.buffer = this.buffer.slice(headerIndex);
      }

      // 此时 buffer[0] 肯定是 HEADER
      // 2. 检查长度是否足够读取 Length 字段 (index 1)
      if (this.buffer.length < 2) {
        break; // 数据不够，等待下次
      }

      const payloadLength = this.buffer[1];
      const packetSize = 4 + payloadLength + 1; // Header(1) + Len(1) + Cmd(1) + Payload(N) + Checksum(1) + Footer(1) -> 这里的 Checksum 其实是在 Payload 后面，Footer 前面
      // 等等，根据文档: Header(1) + Length(1) + Command(1) + Payload(N) + Checksum(1) + Footer(1)
      // 总长度 = 1 + 1 + 1 + N + 1 + 1 = N + 5
      
      // 3. 检查缓冲区是否有完整的一包数据
      if (this.buffer.length < packetSize) {
        break; // 数据不够，等待下次
      }

      // 4. 提取完整包
      const packet = this.buffer.slice(0, packetSize);
      
      // 5. 验证 Footer
      if (packet[packetSize - 1] !== this.FOOTER) {
        // Footer 不对，说明不是有效包 (或者 Length 字段是错的导致找错位置)
        // 策略：丢弃当前的 Header，从下一个字节开始重新找
        // console.warn('Invalid Footer, skipping header');
        this.buffer = this.buffer.slice(1);
        continue;
      }

      // 6. 验证 Checksum
      // Checksum = (Header + Length + Cmd + Payload) & 0xFF
      // Checksum 在 packet[packetSize - 2]
      const receivedChecksum = packet[packetSize - 2];
      let calculatedChecksum = 0;
      // 计算范围：从 Header(0) 到 Payload 结束 (packetSize - 2 之前)
      for (let i = 0; i < packetSize - 2; i++) {
        calculatedChecksum += packet[i];
      }
      calculatedChecksum &= 0xFF;

      if (receivedChecksum !== calculatedChecksum) {
        // console.warn(`Checksum mismatch: expected ${calculatedChecksum}, got ${receivedChecksum}`);
        // 校验失败，丢弃 Header，重新找
        this.buffer = this.buffer.slice(1);
        continue;
      }

      // 7. 解析成功，提取数据
      const command = packet[2];
      const payload = packet.slice(3, 3 + payloadLength);

      this.push({
        command,
        payload,
        raw: packet
      });

      // 8. 从缓冲区移除已处理的数据
      this.buffer = this.buffer.slice(packetSize);
    }

    callback();
  }
}
