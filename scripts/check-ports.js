const { SerialPort } = require('serialport');

async function listPorts() {
  try {
    const ports = await SerialPort.list();
    console.log('--- 原始端口列表 ---');
    ports.forEach(port => {
      // 简单打印关键信息，方便对比
      console.log(`\n端口: ${port.path}`);
      console.log(`厂商: ${port.manufacturer}`);
      console.log(`PnpId: ${port.pnpId}`);

      // 尝试解析 PnpId 里的 MI 值
      if (port.pnpId && port.pnpId.includes('MI_')) {
        const match = port.pnpId.match(/MI_(\d+)/);
        if (match) {
          console.log(`👉 接口编号 (Interface): MI_${match[1]}`);
        }
      }
    });
  } catch (err) {
    console.error('Error listing ports:', err);
  }
}

listPorts();
