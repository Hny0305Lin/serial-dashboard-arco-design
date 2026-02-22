// 监控组件的基础定义
export interface MonitorWidget {
  id: string;
  type: 'terminal' | 'chart' | 'status'; // 组件类型，未来可扩展
  title: string;

  // 空间属性 (绝对定位)
  x: number;      // 距离画布原点的 X 坐标
  y: number;      // 距离画布原点的 Y 坐标
  width: number;  // 组件宽度
  height: number; // 组件高度
  zIndex: number; // 层级 (越大越靠上)

  // 数据绑定
  portPath?: string; // 绑定的串口路径 (如 COM3)

  // 串口配置参数 (可选，如果未配置则使用默认值)
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'mark' | 'odd' | 'space';

  // 副标题配置
  subtitle?: string;
  showSubtitle?: boolean;

  // 自动发送配置
  autoSend?: {
    enabled: boolean;
    content: string;
    encoding: 'hex' | 'utf8';
  };

  displayMode?: 'auto' | 'text' | 'hex';

  logs?: string[];   // 终端日志缓存 (新增)
  isConnected?: boolean; // 串口连接状态
}

// 画布的视图状态
export interface CanvasState {
  offsetX: number; // 画布视口相对于原点的 X 偏移
  offsetY: number; // 画布视口相对于原点的 Y 偏移
  scale: number;   // 缩放比例 (预留功能，默认为 1)
}
