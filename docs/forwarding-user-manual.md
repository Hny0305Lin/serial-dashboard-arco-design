# 串口信息转发渠道（Forwarding）用户手册

## 1. 组件概览
实时监控页的「转发渠道」组件用于把指定串口的数据帧解析成结构化记录，并按配置批量转发到 HTTP / WebSocket / TCP / MQTT 等目标。

## 2. 快速开始
1. 打开「实时监控」页，点击右上角「+」→「转发渠道」。
2. 点击组件右上角「设置」进入配置：
   - 在「数据源」新增一个源：填 `portPath`（如 COM3）、选择分帧 `line`，解析模式 `text-regex`。
   - 在「渠道」新增一个渠道：选择类型（HTTP/WS/TCP/MQTT），填目标地址，选择发送格式（JSON/XML/Binary）。
3. 返回组件，点击「同步」按钮启用/暂停转发。

## 3. 数据源（Source）
数据源负责“从某个串口端口捕获并分帧”，并根据解析规则生成结构化字段：
- `ts`：时间戳（毫秒）
- `deviceId`：设备 ID（可选）
- `dataType`：数据类型（可选）
- `payload`：有效负载（文本/JSON/二进制）

推荐的 `text-regex` 默认正则：
`(?<deviceId>[^,]+),(?<dataType>[^,]+),(?<payload>.*)`

## 4. 渠道（Channel）
每个渠道有独立的：
- 批量周期 `flushIntervalMs` 与批量大小 `batchSize`
- 去重窗口 `dedupWindowMs`
- 重试参数 `retryMaxAttempts` / `retryBaseDelayMs`
- 压缩 `compression=gzip`（可选）
- 加密 `encryption=aes-256-gcm`（可选）

### 4.1 加密 Key 配置
AES-256-GCM 需要 32 字节密钥：
- `FORWARDING_KEY`：默认密钥
- `FORWARDING_KEY_<KeyId>`：按 `encryptionKeyId` 选择密钥

密钥支持两种格式：
- 64 位 hex（32 bytes）
- base64（解码后 32 bytes）

## 5. 离线缓存与断点续传
转发采用磁盘队列持久化：发送失败的批次会留在队列中并按退避重试；服务重启后会继续发送未完成批次。

## 6. 监控与排障
组件面板展示：
- 每个渠道的队列长度、成功/失败计数、平均延迟、最近错误
- 最近 200 条转发日志（用于追溯与定位）

常见问题：
- 队列持续上涨：下游不可用/延迟高，先暂停渠道或降低频率，检查网络与目标服务
- 失败率告警：检查目标鉴权/地址/协议，或开启压缩降低带宽

