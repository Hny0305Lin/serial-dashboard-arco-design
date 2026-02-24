# 工业现场部署指南（7×24 稳定运行）

## 1. 运行前提
- Windows/Linux 均可，Node.js 建议 18+（支持 `node --test`、稳定的 Buffer/crypto/zlib）
- 串口独占：同一端口同一时刻只能被本服务打开
- 确保目标转发网络可达（HTTP/WS/TCP/MQTT）

## 2. 数据目录与配置文件
默认数据目录：`<project>/data`
- `data/forwarding.config.json`：转发配置（自动生成/更新）
- `data/queues/<channelId>/`：每个渠道的持久化队列
- `data/records/`：结构化记录（ndjson，按天分文件）

可通过环境变量指定数据目录：
- `DATA_DIR=...`

## 3. 安全建议
- 使用 AES-256-GCM 时配置密钥：
  - `FORWARDING_KEY` 或 `FORWARDING_KEY_<KeyId>`
- 密钥不要写入前端配置文件与日志
- HTTP 下游建议启用鉴权（Token/签名）与幂等（使用 `x-idempotency-key`）

## 4. 性能建议
- 禁用高频原始日志：默认已关闭 RAW DATA 输出；如需调试才设置 `SERIAL_RAW_LOG=1`
- 批量转发建议 `flushIntervalMs=200~1000`、`batchSize=10~50` 以减轻下游压力
- 队列上限与告警阈值根据现场网络质量调参

## 5. 健康检查与压测
- 单元/集成测试：`pnpm test`
- 性能压测：`pnpm run perf:forwarding`
  - 输出 CPU 单核占用、RSS、平均延迟统计，异常会以非 0 退出码结束

## 6. 运行与自恢复策略
- 生产运行：`pnpm run build && pnpm start`
- 建议使用进程守护（Windows 服务 / systemd / pm2）
- 网络异常时会进入“离线缓存 + 退避重试”，恢复网络后自动续传队列
