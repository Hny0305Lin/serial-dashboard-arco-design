
import { PortManager } from '../core/PortManager';

const manager = new PortManager();

// 监听状态变化
manager.on('status', (event) => {
  console.log(`[Status Event] ${event.path}: ${event.status} (Error: ${event.error || 'None'})`);
});

// 监听数据
manager.on('data', (event) => {
  console.log(`[Data Event] ${event.path}:`, event.data);
});

async function main() {
  console.log('--- Serial Port Manager Test ---');
  
  try {
    console.log('Scanning ports...');
    const ports = await manager.list();
    console.log('Available ports:', ports);

    if (ports.length === 0) {
      console.log('No ports found. Please plug in a device to test connection.');
      return;
    }

    const targetPort = ports[0].path;
    console.log(`Attempting to open first port: ${targetPort}`);

    manager.open({
      path: targetPort,
      baudRate: 9600
    });

    // 保持运行一段时间，观察事件
    setTimeout(async () => {
      console.log(`Closing port ${targetPort}...`);
      await manager.close(targetPort);
      console.log('Test finished.');
      process.exit(0);
    }, 5000);

  } catch (error) {
    console.error('Test failed:', error);
  }
}

main();
