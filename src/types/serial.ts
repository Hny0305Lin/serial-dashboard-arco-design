// 定义串口相关的类型和接口

export type PortStatus = 'closed' | 'opening' | 'open' | 'error' | 'reconnecting';

// 串口配置参数
export interface SerialConfig {
  path: string;
  baudRate: number;
  dataBits?: 8 | 7 | 6 | 5;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'mark' | 'odd' | 'space';
  autoOpen?: boolean; // 默认为 false，由 Manager 显式控制
  lock?: boolean;     // 是否启用 Windows 独占锁 (serialport 默认开启)
}

// 串口信息 (用于列表展示)
export interface PortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  locationId?: string;
  productId?: string;
  vendorId?: string;
}

// 串口状态事件 Payload
export interface PortStatusEvent {
  path: string;
  status: PortStatus;
  error?: string; // 如果是 error 状态，附带错误信息
  timestamp: number;
}
