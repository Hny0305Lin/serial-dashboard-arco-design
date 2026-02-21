# 串口服务器后端 - 协议与接口设计文档 (V1.0)

## 1. 概述
本文档定义了串口服务器后端与前端/客户端的通信协议，以及与下位机设备的通信规范。

## 2. 设备通信协议 (默认实现)
> 我们采用一种通用的二进制帧结构，但也支持通过配置切换为“行模式” (Line Delimiter)。

### 2.1 二进制帧结构 (Binary Frame)
适用于大多数工业控制场景。

| 字段 | 长度 (Byte) | 值/说明 |
| :--- | :--- | :--- |
| **Header** | 1 | `0xAA` (帧头) |
| **Length** | 1 | 后续数据载荷的长度 (N) |
| **Command** | 1 | 指令字 (如 `0x01` 读状态, `0x02` 写配置) |
| **Payload** | N | 数据内容 |
| **Checksum** | 1 | 校验和 (Header + Length + Cmd + Payload 的累加和低8位) |
| **Footer** | 1 | `0x55` (帧尾) |

- **转义规则**: 若 Payload 中出现 `0xAA` 或 `0x55`，需转义 (可选特性，V1暂不实现复杂转义，建议Payload尽量避开帧头尾或依靠Length判断)。
- **校验方式**: Checksum = `(Header + Length + Cmd + Payload) & 0xFF`。

### 2.2 文本行模式 (Line Mode)
适用于调试或简单 ASCII 协议设备。
- **分隔符**: `\r\n` (CRLF) 或 `\n` (LF)
- **数据**: ASCII 字符串

---

## 3. HTTP API 接口定义
RESTful 风格接口，用于管理串口连接与状态。
统一响应格式：
```json
{
  "code": 0, // 0: 成功, 非0: 错误码
  "msg": "success",
  "data": { ... }
}
```

### 3.1 串口管理
- **GET /api/ports**
  - 功能：列出系统所有可用串口
  - 响应：`{ ports: [{ path: "COM1", manufacturer: "..." }, ...] }`

- **POST /api/ports/open**
  - 功能：打开指定串口
  - Body：
    ```json
    {
      "path": "COM1",
      "baudRate": 9600,
      "dataBits": 8,
      "stopBits": 1,
      "parity": "none"
    }
    ```

- **POST /api/ports/close**
  - 功能：关闭指定串口
  - Body：`{ "path": "COM1" }`

- **POST /api/ports/write**
  - 功能：向串口写入数据
  - Body：
    ```json
    {
      "path": "COM1",
      "data": "AABBCC", // Hex string
      "encoding": "hex" // or "utf8"
    }
    ```

---

## 4. WebSocket 实时通信
用于实时推送串口收到的数据和状态变更。
- **Endpoint**: `/ws`

### 4.1 客户端 -> 服务端 (Client to Server)
- **订阅串口数据**:
  ```json
  { "type": "subscribe", "path": "COM1" }
  ```
- **取消订阅**:
  ```json
  { "type": "unsubscribe", "path": "COM1" }
  ```

### 4.2 服务端 -> 客户端 (Server to Client)
- **串口接收数据 (Data)**:
  ```json
  {
    "type": "serial:data",
    "path": "COM1",
    "data": "...", // Hex string or Text based on config
    "timestamp": 1678888888888
  }
  ```
- **串口状态变更 (Status)**:
  ```json
  {
    "type": "serial:status",
    "path": "COM1",
    "status": "open" // open, closed, error
  }
  ```
- **错误通知 (Error)**:
  ```json
  {
    "type": "error",
    "path": "COM1",
    "msg": "Device disconnected unexpectedly"
  }
  ```
