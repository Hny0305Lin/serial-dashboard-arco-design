# Forwarding API 文档

Base URL（后端默认）：`http://localhost:9011/api`

如果使用前端开发服务器（默认 `http://localhost:9010/`），可以直接请求：
- `http://localhost:9010/api`（由前端 dev server 反代到后端）

## 1) 获取转发配置
`GET /forwarding/config`

响应：
```json
{ "code": 0, "msg": "success", "data": { "version": 1, "enabled": true, "sources": [], "channels": [] } }
```

配置要点：
- `sources[].ownerWidgetId`（可选）：用于把数据源归属到某个监控组件（ForwardingWidget）。
- 当某个 `source` 带 `ownerWidgetId` 时，只会投递给同 `ownerWidgetId` 的 `channels`，并且当该 owner 没有任何启用的渠道时，该 source 不会消耗数据（避免“未启用也吃数据/串台”）。
- 当 `source` 未设置 `ownerWidgetId` 时，只会投递给未设置 `ownerWidgetId` 的渠道；有助于保证各转发组件之间完全隔离。
- 同一 `portPath` 同时只能有一个 `enabled=true` 的数据源；冲突会导致保存失败。
- `channels[].deliveryMode`（可选）：
  - `at-most-once`：遇到超时/断连等“可能已送达但未拿到响应”的错误时不重试，避免飞书等 webhook 场景出现重复消息（可能丢消息）。
  - `at-least-once`：失败会重试，尽量不丢消息，但在网络抖动/超时场景可能重复。
- `channels[].dedupWindowMs / dedupMaxEntries`：按 `record.hash` 做去重（窗口期内相同内容只转发一次），适合抑制串口重复上报或解析层重复帧。

## 2) 更新转发配置（全量）
`PUT /forwarding/config`

请求体：ForwardingConfigV1（建议全量提交）

响应：返回保存后的配置。

## 3) 启用/暂停转发
`POST /forwarding/enabled`

请求体：
```json
{ "enabled": true }
```

## 4) 获取转发指标
`GET /forwarding/metrics`

响应 data：
- `enabled`：总开关
- `channels[]`：每个渠道 `queueLength/sent/failed/dropped/avgLatencyMs/lastError`

## 5) 获取最近结构化记录
`GET /forwarding/records?limit=200`

`limit`：1~2000，默认 200

## 6) 获取最近转发日志
`GET /forwarding/logs?limit=200&ownerWidgetId=...&portPath=...&channelId=...`

`limit`：1~2000，默认 200
可选过滤参数（提供任意一个即启用过滤）：
- `ownerWidgetId`：只返回该监控组件拥有的渠道相关日志
- `portPath`：只返回该串口源相关日志（如 framing dropped）
- `channelId`：只返回该渠道相关日志

过滤规则：当提供多个过滤参数时，返回满足其中任意一个条件的日志（逻辑 OR）。

验收建议：
- 两个不同 `ownerWidgetId` 的转发组件分别打开“转发日志”，两边内容应不同（至少包含各自渠道的 send/enqueue 失败等日志）。
- 绑定不同 `portPath` 的转发组件触发 framing dropped 时，仅对应端口的组件能看到该条日志。

## WebSocket 推送
连接（后端默认）：`ws://localhost:9011/ws`

如果使用前端开发服务器（默认 `http://localhost:9010/`），可以连接：
- `ws://localhost:9010/ws`（由前端 dev server 反代到后端）

### 指标推送
消息：
```json
{ "type": "forwarding:metrics", "data": { "ts": 0, "enabled": true, "channels": [] } }
```

### 告警推送
消息：
```json
{ "type": "forwarding:alert", "data": { "type": "queue|failureRate", "channelId": "xxx", "ts": 0 } }
```
