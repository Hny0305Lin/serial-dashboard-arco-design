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

    // 如果已经存在且处于非关闭状态，直接返回或报错
    if (this.ports.has(path)) {
      const existing = this.ports.get(path);
      if (existing?.status === 'open' || existing?.status === 'opening') {
        throw new Error(`Port ${path} is already open or opening.`);
      }
      // 如果是 closed/error 状态，可以重新打开，先清理旧实例
      // 必须等待旧实例完全关闭，否则会导致事件重复监听
      await this.close(path);
    }

    this.createPortInstance(config);
  }

  /**
   * 关闭指定串口
   */
  public close(path: string): Promise<void> {
    const managed = this.ports.get(path);
    if (!managed) return Promise.resolve();

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
      if (managed.instance.isOpen) {
        managed.instance.close((err) => {
          if (err) {
            console.error(`Error closing port ${path}:`, err);
            // 即使底层报错，管理层也认为已关闭
            this.updateStatus(path, 'closed', err);
            reject(err);
          } else {
            // 手动关闭成功，手动触发状态更新
            console.log(`Port ${path} closed manually.`);
            this.updateStatus(path, 'closed');
            resolve();
          }
        });
      } else {
        this.updateStatus(path, 'closed');
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

  private createPortInstance(config: SerialConfig) {
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

    // 执行打开
    port.open((err) => {
      if (err) {
        console.error(`Failed to open port ${path}:`, err.message);
        // 如果打开失败，从 map 中移除，并抛出错误事件
        this.ports.delete(path);
        this.emit('status', { path, status: 'error', error: err.message });
      }
      // 成功打开的状态更新交由 'open' 事件监听器处理，避免重复触发
    });
  }

  private bindEvents(managed: ManagedPort) {
    const { instance, config } = managed;
    const path = config.path;

    // 监听 open 事件
    instance.on('open', () => {
      console.log(`Port ${path} opened successfully.`);
      managed.reconnectAttempts = 0;
      this.updateStatus(path, 'open');
    });

    // 监听 data 事件 - 关键！
    instance.on('data', (data: Buffer) => {
      console.log(`[PortManager] Received data from ${path}:`, data.toString('hex'));
      this.emit('data', { path, data });
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
      // 如果不是手动关闭（map 中还存在），尝试重连
      if (this.ports.has(path)) {
        this.handleUnexpectedClose(path);
      }
    });
  }

  private updateStatus(path: string, status: PortStatus, error?: Error) {
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
  }

  private handleError(path: string, error: Error) {
    this.updateStatus(path, 'error', error);
    this.handleUnexpectedClose(path);
  }

  private handleUnexpectedClose(path: string) {
    const managed = this.ports.get(path);
    if (!managed) return;

    // 只有在非 closed 且非 reconnecting 状态下才尝试重连
    // (如果用户手动 close，map 中已经删除了，不会走到这)

    if (managed.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(
        this.INITIAL_RECONNECT_DELAY * Math.pow(2, managed.reconnectAttempts),
        this.MAX_RECONNECT_DELAY
      );

      managed.reconnectAttempts++;
      this.updateStatus(path, 'reconnecting');
      console.log(`Attempting to reconnect ${path} in ${delay}ms (Attempt ${managed.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`);

      managed.reconnectTimer = setTimeout(() => {
        if (!this.ports.has(path)) return; // 期间可能被手动关闭了
        console.log(`Reconnecting ${path}...`);

        // 尝试重新打开
        // 注意：SerialPort 实例出错关闭后，通常需要重新 open() 即可，或者重新 new 一个
        // 稳妥起见，我们重新 open() 现有的
        managed.instance.open((err) => {
          if (err) {
            console.error(`Reconnect failed for ${path}:`, err.message);
            this.handleError(path, err); // 递归调用，触发下一次重连
          }
        });
      }, delay);

    } else {
      console.error(`Max reconnect attempts reached for ${path}. Giving up.`);
      this.updateStatus(path, 'error', new Error('Max reconnect attempts reached'));
      // 可以选择是否保留在 map 中，这里保留以便用户查询状态，但不再自动重试
    }
  }
}
