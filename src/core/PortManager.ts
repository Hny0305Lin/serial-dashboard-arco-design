import { SerialPort } from 'serialport';
import { EventEmitter } from 'events';
import { PortInfo, SerialConfig, PortStatus } from '../types/serial';
import { PacketParser } from './PacketParser';

interface ManagedPort {
  instance: SerialPort;
  parser?: PacketParser;
  config: SerialConfig;
  status: PortStatus;
  reconnectAttempts: number;
  reconnectTimer?: NodeJS.Timeout;
}

export class PortManager extends EventEmitter {
  private ports: Map<string, ManagedPort> = new Map();
  private lastErrorByPath: Map<string, string> = new Map();

  // 重连策略配置
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly INITIAL_RECONNECT_DELAY = 1000; // 1秒
  private readonly MAX_RECONNECT_DELAY = 30000;    // 30秒

  constructor() {
    super();
  }

  /**
   * 扫描并列出所有可用串口
   */
  public async list(): Promise<PortInfo[]> {
    try {
      const ports = await SerialPort.list();

      // 过滤掉 Windows 标准端口 (COM1) 和无效端口
      const validPorts = ports.filter(p => {
        // 1. 精准过滤：基于 PnpId 过滤 ACPI\PNP0501 (标准 COM 口)
        if (p.pnpId && (p.pnpId.includes('ACPI') && p.pnpId.includes('PNP0501'))) {
          return false;
        }

        // 2. 备选过滤：如果厂商名称非常明确是“标准端口类型”
        if (p.manufacturer && (p.manufacturer.includes('标准端口类型') || p.manufacturer.includes('Standard port types'))) {
          return false;
        }

        // 3. 过滤掉没有 pnpId 的端口 (通常是原生串口)
        if (!p.pnpId) {
          return false;
        }

        return true;
      });

      return validPorts.map(p => ({
        path: p.path,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
        pnpId: p.pnpId,
        locationId: p.locationId,
        productId: p.productId,
        vendorId: p.vendorId
      }));
    } catch (error) {
      console.error('Failed to list ports:', error);
      throw error;
    }
  }

  /**
   * 打开指定串口
   */
  public async open(config: SerialConfig): Promise<void> {
    const { path } = config;
    this.lastErrorByPath.delete(path);

    // 如果已经存在且处于非关闭状态，直接返回或报错
    if (this.ports.has(path)) {
      const existing = this.ports.get(path);
      // 如果状态是 open 或 opening，才报错
      if (existing?.status === 'open' || existing?.status === 'opening') {
        // 幂等性优化：如果已经打开，视为成功
        console.log(`Port ${path} is already open, skipping...`);
        return;
      }

      // 如果状态是 closed/error/reconnecting，但 map 中仍有记录
      // 我们需要先彻底清理旧实例，再创建新实例
      // 这里的 close 调用会清理 map 和 timer
      console.log(`Port ${path} exists but status is ${existing?.status}, cleaning up before reopen...`);
      await this.close(path);
    }

    await this.createPortInstance(config);
  }

  /**
   * 关闭指定串口
   */
  public close(path: string): Promise<void> {
    this.lastErrorByPath.delete(path);
    const managed = this.ports.get(path);
    if (!managed) {
      this.updateStatus(path, 'closed');
      return Promise.resolve();
    }

    // 1. 立即从管理列表中移除，防止触发自动重连逻辑
    this.ports.delete(path);

    // 2. 清理重连定时器
    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = undefined;
    }

    // 3. 移除所有监听器，防止在关闭过程中触发不必要的事件（如 close/error）
    // 既然是手动关闭，我们不需要再接收它的任何反馈
    managed.instance.removeAllListeners();

    // 4. 关闭实例
    return new Promise((resolve, reject) => {
      // 移除所有监听器，避免关闭过程中的 error 事件导致 promise reject
      // 我们希望 close 操作是尽最大努力成功的
      managed.instance.removeAllListeners();

      // 无论如何，我们都认为这个端口在逻辑上已经关闭了
      // 即使底层 close 报错，也不影响我们清理 map
      this.updateStatus(path, 'closed');

      // 强制清理引用，防止内存泄漏或状态残留
      // 如果 SerialPort 实例有 destroy 方法，也应该调用（虽然 v10+ 主要靠 close）
      if ((managed.instance as any).destroy) {
        try { (managed.instance as any).destroy(); } catch (e) { }
      }

      if (managed.instance.isOpen) {
        managed.instance.close((err) => {
          if (err) {
            console.error(`Error closing port ${path}:`, err);
            // 这里我们记录错误，但依然 resolve，因为逻辑上的关闭已经完成了
            // reject(err); 
            resolve();
          } else {
            console.log(`Port ${path} closed manually.`);
            resolve();
          }
        });
      } else {
        // 如果实例虽然 isOpen 为 false，但可能底层资源未释放
        // 尝试销毁（如果 SerialPort 提供了 destroy 方法，但在 v10+ 中通常 close 就够了）
        resolve();
      }
    });
  }

  /**
   * 获取指定串口状态
   */
  public getStatus(path: string): PortStatus {
    return this.ports.get(path)?.status || 'closed';
  }

  public getLastError(path: string): string | undefined {
    return this.lastErrorByPath.get(path);
  }

  /**
   * 向指定串口写入数据
   */
  public write(path: string, data: Buffer | string): Promise<void> {
    const managed = this.ports.get(path);
    if (!managed || managed.status !== 'open') {
      return Promise.reject(new Error(`Port ${path} is not open`));
    }

    return new Promise((resolve, reject) => {
      // 这里的 drain 可能会阻塞，后续需配合队列使用
      managed.instance.write(data, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  // --- 内部私有方法 ---

  private createPortInstance(config: SerialConfig): Promise<void> {
    const { path, baudRate, dataBits = 8, stopBits = 1, parity = 'none' } = config;

    // 创建 SerialPort 实例
    const port = new SerialPort({
      path,
      baudRate,
      dataBits,
      stopBits,
      parity,
      autoOpen: false // 手动控制打开
    });

    // 存储管理对象
    const managed: ManagedPort = {
      instance: port,
      config,
      status: 'opening',
      reconnectAttempts: 0
    };

    this.ports.set(path, managed);

    // 绑定事件（包括 data 事件）
    this.bindEvents(managed);

    // 默认启用 raw data 模式
    // 执行打开
    return new Promise((resolve, reject) => {
      port.open((err) => {
        if (err) {
          console.error(`Failed to open port ${path}:`, err.message);
          this.lastErrorByPath.set(path, err.message);
          this.ports.delete(path);
          this.updateStatus(path, 'error', err);
          try { port.removeAllListeners(); } catch (e) { }
          if ((port as any).destroy) {
            try { (port as any).destroy(); } catch (e) { }
          }
          reject(err);
          return;
        }

        this.lastErrorByPath.delete(path);
        port.set({ dtr: true, rts: true }, (err) => {
          if (err) console.warn(`[PortManager] Failed to set DTR/RTS for ${path}:`, err.message);
          else console.log(`[PortManager] DTR/RTS set for ${path}`);
        });
        resolve();
      });
    });
  }

  private bindEvents(managed: ManagedPort) {
    const { instance, config } = managed;
    const path = config.path;

    // 监听 open 事件
    instance.on('open', () => {
      console.log(`Port ${path} opened successfully.`);
      console.log(`[PortManager] Config: BaudRate=${config.baudRate}, Data=${config.dataBits}, Stop=${config.stopBits}, Parity=${config.parity}`);

      managed.reconnectAttempts = 0;
      this.updateStatus(path, 'open');

      if (process.env.SERIAL_PIPELINE_PROBE === '1') {
        setTimeout(() => {
          const testMsg = Buffer.from(`[System] Port ${path} opened. Pipeline check OK.`);
          this.emit('data', { path, data: testMsg });
        }, 500);
      }
    });

    instance.on('readable', () => {
      let chunk: Buffer | null;
      while ((chunk = instance.read()) !== null) {
        if (process.env.SERIAL_RAW_LOG === '1') {
          console.log(`[PortManager] RAW DATA from ${path} (Length: ${chunk.length}):`, chunk.toString('hex').toUpperCase());
        }
        this.emit('data', { path, data: chunk });
      }
    });

    // 监听 error 事件
    instance.on('error', (err) => {
      console.error(`Port ${path} error:`, err.message);
      this.updateStatus(path, 'error', err);
    });

    // 监听 close 事件
    instance.on('close', () => {
      console.log(`Port ${path} closed.`);
      this.updateStatus(path, 'closed');

      // 意外关闭处理策略：
      // 如果是非手动关闭（map 中还存在），说明是意外断开（如拔线）
      // 原策略：自动重连（可能导致日志刷屏和资源占用）
      // 新策略：直接清理资源，标记为关闭，等待用户手动重连
      if (this.ports.has(path)) {
        console.log(`Port ${path} disconnected unexpectedly. Cleaning up...`);
        // 调用 close 方法彻底清理资源（移除监听器、删除 map 记录等）
        // 注意：这里不需要 await，因为我们已经在 close 回调里了
        this.close(path).catch(err => {
          console.error(`Error cleaning up after unexpected close for ${path}:`, err);
        });
      }
    });
  }

  private updateStatus(path: string, status: PortStatus, error?: Error) {
    console.log(`[PortManager] updateStatus called: ${path} -> ${status}`);
    const managed = this.ports.get(path);
    if (managed) {
      managed.status = status;
    }
    this.emit('status', {
      path,
      status,
      error: error?.message,
      timestamp: Date.now()
    });
    console.log(`[PortManager] Emitted status event: ${path} -> ${status}`);
  }

  private handleError(path: string, error: Error) {
    this.updateStatus(path, 'error', error);
    // 出错后也不再自动重连，而是直接清理
    if (this.ports.has(path)) {
      console.log(`Port ${path} encountered error. Cleaning up...`);
      this.close(path).catch(err => {
        console.error(`Error cleaning up after error for ${path}:`, err);
      });
    }
  }
}
