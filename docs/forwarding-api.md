# Forwarding API 文档

Base URL（后端默认）：`http://localhost:9001/api`

如果使用前端开发服务器（默认 `http://localhost:9000/`），可以直接请求：
- `http://localhost:9000/api`（由前端 dev server 反代到后端）

## 1) 获取转发配置
`GET /forwarding/config`

响应：
```json
{ "code": 0, "msg": "success", "data": { "version": 1, "enabled": true, "sources": [], "channels": [] } }
```

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
`GET /forwarding/logs?limit=200`

`limit`：1~2000，默认 200

## WebSocket 推送
连接（后端默认）：`ws://localhost:9001/ws`

如果使用前端开发服务器（默认 `http://localhost:9000/`），可以连接：
- `ws://localhost:9000/ws`（由前端 dev server 反代到后端）

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
