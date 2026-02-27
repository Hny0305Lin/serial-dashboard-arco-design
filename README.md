<p align="center">
  <a href="https://github.com/arco-design" target="_blank" rel="noopener noreferrer">
    <img alt="Arco Design" width="220" src="web/public/brand/arco-design.png" />
  </a>
</p>

# serial-dashboard-arco-design

一个 Web 串口控制台管理系统 + 实时监控面板（前端 Astro + React + Arco，后端 Node.js + Express + WebSocket + serialport）。

---

本项目基于 [字节跳动Arco设计库](https://github.com/arco-design/arco-design) 实现前端。

本项目基于 [Node.js](https://nodejs.org/en) 实现后端。

本项目使用Trae IDE进行开发，使用GPT-5.2 和 Gemini-3-Pro-Preview大模型，推荐使用大模型辅助，减少手动编写代码的工作量和开发时间。

## 目录

- [功能概览](#功能概览)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [开发命令](#开发命令)
- [配置](#配置)
- [HTTP API](#http-api)
- [WebSocket](#websocket)
- [数据目录与隐私](#数据目录与隐私)
- [监控页 Astro Islands 改造](#监控页-astro-islands-改造)
- [排障](#排障)
- [Roadmap](#roadmap)
- [FAQ](#faq)
- [变更记录](#变更记录)
- [贡献](#贡献)
- [License](#license)

## 功能概览

- 设备列表：枚举串口、打开/关闭、状态展示（List/Grid 视图）
- 终端日志：TX/RX/System 等分色、标签对齐、长标签抗挤压
- WebSocket 实时推送：前端实时接收端口状态/数据与服务端指标
- Forwarding 转发（可选）：把串口数据落盘并按配置转发到外部渠道

## 技术栈

- Backend：Node.js + TypeScript + Express + ws + serialport
- Frontend：Astro + React 18 + Arco Design
- Package Manager：pnpm（本项目默认不使用 npm）

## 快速开始

### 依赖

- Node.js（建议使用当前 LTS）
- pnpm

### 安装

```bash
pnpm i
pnpm -C web i
```

### 一键联调启动（推荐）

```bash
pnpm run dev:all
```

- 前端：<http://localhost:9000>
- 后端：<http://localhost:9001>
- WebSocket：`ws://localhost:9001/ws`

说明：前端开发态已把 `/api` 与 `/ws` 代理到后端 `9001`，所以前端页面里直接请求 `/api/*` 与 `/ws` 即可。

## 开发命令

| 命令 | 用途 | 说明 |
| --- | --- | --- |
| `pnpm run dev` | 后端开发（热重载） | `nodemon` 监听变更，`ts-node` 直接跑 `src/index.ts` |
| `pnpm run dev:web` | 前端开发 | 在 `web/` 启动 `astro dev` |
| `pnpm run dev:all` | 前后端一起启动 | 编排启动后端 + 前端；任一退出则整体退出 |
| `pnpm run build` | 编译后端 | `tsc` 输出到 `dist/` |
| `pnpm run start` | 运行后端产物 | `node dist/index.js`（更接近生产） |
| `pnpm run test` | 跑测试 | 先 build，再用 `node --test` 跑 `dist/test` |
| `pnpm run perf:forwarding` | 转发链路压测 | 先 build，再跑 `dist/perf/forwarding-perf.js` |

## 配置

后端入口会读取以下环境变量：

- `PORT`：HTTP 端口（默认 `9001`）
- `DATA_DIR`：数据目录（默认 `{projectRoot}/data`）

Forwarding 配置文件：

- `{DATA_DIR}/forwarding.config.json`

## HTTP API

Base URL（开发默认）：`http://localhost:9001/api`

### 通用响应格式

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | number | `0` 表示成功；非 0 表示失败 |
| `msg` | string | 简短信息 |
| `data` | any | 成功时返回的数据（有些接口没有 `data`） |

### 串口（Ports）

#### 获取串口列表

- Method: `GET`
- Path: `/ports`

响应 `data`：数组，每一项包含 `PortInfo` 与运行状态字段。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `path` | string | 串口路径（Windows 常见 `COMx`） |
| `manufacturer` | string? | 厂商（可选） |
| `serialNumber` | string? | 序列号（可选） |
| `pnpId` | string? | PnP ID（可选） |
| `locationId` | string? | 位置 ID（可选） |
| `productId` | string? | 产品 ID（可选） |
| `vendorId` | string? | 厂商 ID（可选） |
| `status` | `'closed' \| 'opening' \| 'open' \| 'error' \| 'reconnecting'` | 当前状态 |
| `lastError` | string? | 最近一次错误（可选） |

示例：

```json
{
  "code": 0,
  "msg": "success",
  "data": [
    {
      "path": "COM5",
      "manufacturer": "Silicon Labs",
      "pnpId": "USB\\VID_10C4&PID_EA60\\0001",
      "status": "open"
    }
  ]
}
```

#### 打开串口

- Method: `POST`
- Path: `/ports/open`

请求体：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | 串口路径 |
| `baudRate` | number | 是 | 波特率 |
| `dataBits` | 5\|6\|7\|8 | 否 | 默认由底层库处理 |
| `stopBits` | 1\|2 | 否 | 默认由底层库处理 |
| `parity` | `'none'\|'even'\|'mark'\|'odd'\|'space'` | 否 | 默认 `'none'` |

示例：

```json
{ "path": "COM5", "baudRate": 115200, "dataBits": 8, "stopBits": 1, "parity": "none" }
```

成功响应：

```json
{ "code": 0, "msg": "success" }
```

#### 关闭串口

- Method: `POST`
- Path: `/ports/close`

请求体：

```json
{ "path": "COM5" }
```

成功响应：

```json
{ "code": 0, "msg": "success" }
```

#### 写串口数据（HTTP）

- Method: `POST`
- Path: `/ports/write`

请求体：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | 串口路径 |
| `data` | string | 是 | 发送内容；当 `encoding='hex'` 时为 hex 字符串 |
| `encoding` | `'hex' \| 'utf8'` | 否 | 默认 `'hex'` |

示例（hex）：

```json
{ "path": "COM5", "data": "AA55FF01", "encoding": "hex" }
```

成功响应：

```json
{ "code": 0, "msg": "success" }
```

### Forwarding（转发）

说明：当服务端未启用转发服务时，这组接口会返回 404：`{ code:404, msg:'Forwarding service not enabled' }`。

#### 获取转发配置

- Method: `GET`
- Path: `/forwarding/config`

示例：

```json
{
  "code": 0,
  "msg": "success",
  "data": { "version": 1, "enabled": false, "sources": [], "channels": [], "store": {}, "alert": {} }
}
```

#### 更新转发配置（全量写入）

- Method: `PUT`
- Path: `/forwarding/config`

请求体：一个对象（服务端目前只做“必须是 object”的校验，未做更细字段校验）。

示例：

```json
{ "version": 1, "enabled": true, "sources": [], "channels": [] }
```

#### 创建一个渠道（按 ownerWidgetId）

- Method: `POST`
- Path: `/forwarding/channels`

请求体：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ownerWidgetId` | string | 否 | 归属 UI 组件 ID |
| `name` | string | 否 | 名称前缀；最终会生成唯一名称 |

响应 `data`：`{ config, channelId }`

#### 按 ownerWidgetId 删除渠道

- Method: `DELETE`
- Path: `/forwarding/channels?ownerWidgetId=...`

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ownerWidgetId` | string | 是 | 归属 UI 组件 ID |

响应 `data`：`{ config, removed }`

#### 启用/暂停转发总开关

- Method: `POST`
- Path: `/forwarding/enabled`

请求体：

```json
{ "enabled": true }
```

响应 `data`：`{ enabled }`

#### 获取转发指标快照

- Method: `GET`
- Path: `/forwarding/metrics`

响应 `data`：`ForwardingMetricsSnapshot`

#### 获取最近转发记录

- Method: `GET`
- Path: `/forwarding/records?limit=200`

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `limit` | number | 否 | 返回条数，范围 `[1, 2000]`，默认 `200` |

#### 获取最近转发日志（结构化）

- Method: `GET`
- Path: `/forwarding/logs?limit=200`

查询参数同上。

## WebSocket

Endpoint（开发默认）：`ws://localhost:9001/ws`

### 消息格式

所有消息均为 JSON 对象，包含 `type` 字段用来区分消息类型。

### 服务端 -> 客户端

#### `serial:status`

串口状态变更推送。

```json
{ "type": "serial:status", "path": "COM5", "status": "open", "timestamp": 1730000000000 }
```

#### `serial:opened`

当状态变为 `open` 时额外推送（用于兼容前端逻辑）。

```json
{ "type": "serial:opened", "path": "COM5" }
```

#### `serial:data`

串口数据推送，存在两种形态：

1) 如果端口数据经过 packet 解析，`data` 直接为 packet

```json
{ "type": "serial:data", "path": "COM5", "data": { "any": "packet" } }
```

2) 原始 buffer 形态会被包裹在 `data.raw` 中（Buffer JSON 结构）

```json
{
  "type": "serial:data",
  "path": "COM5",
  "data": { "raw": { "type": "Buffer", "data": [170, 85, 1, 2] } }
}
```

#### `forwarding:metrics`

转发指标快照推送。连接建立时会先推送一次全量快照，后续变更会节流合并广播。

```json
{ "type": "forwarding:metrics", "data": { "ts": 1730000000000, "enabled": true, "channels": [] } }
```

#### `forwarding:alert`

转发告警推送（例如队列长度异常、失败率异常）。

```json
{ "type": "forwarding:alert", "data": { "type": "queue", "channelId": "ch1", "queueLength": 1200, "ts": 1730000000000 } }
```

### 客户端 -> 服务端

#### `serial:send`

通过 WS 发送串口数据。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `'serial:send'` | 是 | 固定值 |
| `path` | string | 是 | 串口路径 |
| `data` | string | 是 | 发送内容 |
| `encoding` | `'hex' \| 'utf8'` | 否 | 默认 `'hex'`；`hex` 会先过滤非 hex 字符 |

示例：

```json
{ "type": "serial:send", "path": "COM5", "data": "AA 55 01 02", "encoding": "hex" }
```

#### `subscribe`

目前为占位消息类型（收到后不会执行任何动作）。

## 数据目录与隐私

运行时会在 `data/` 下落盘记录与配置（例如 `records/*.ndjson`、`forwarding.config.json`），可能包含敏感内容（手机号、短信、Webhook 等）。

- 建议：把 `data/` 加入 `.gitignore`，避免提交到仓库
- 建议：对外分享数据前先脱敏

## 监控页 Astro Islands 改造

如果你希望把实时监控页从“单体 React 组件树”升级为“Astro 页面组织 + React Islands 运行”的架构（保留核心大地图/画布为 React Island，小组件迁移为 Astro 外壳 + 独立 islands），请参考：

- [docs/monitor-astro-islands.md](docs/monitor-astro-islands.md)
- [docs/monitor-astro-islands.tasks.md](docs/monitor-astro-islands.tasks.md)

## 排障

### 端口打不开 / 被占用

- 确认同一时刻只有一个进程在使用同一个串口（serialport 是独占的）
- Windows 下如果 `Ctrl+C` 停止后仍占用端口，检查任务管理器是否残留 `node.exe` / `pnpm.exe`

### 前端请求 `/api` 404

- 确认你是通过 `pnpm -C web dev` / `pnpm dev:all` 启动的前端开发服务器
- 开发代理已配置为把 `/api` 与 `/ws` 指向后端 `9001`

### Linux/macOS 下无权限访问串口

- Linux 常见需要把用户加入 `dialout` 组，或临时使用更高权限运行
- macOS 需要确认串口设备路径与权限（如 `/dev/tty.*`、`/dev/cu.*`）

## Roadmap

- 安全：对写入接口（HTTP/WS）增加鉴权、权限边界与限流策略
- 协议：统一帧边界/校验/解码策略，支持可插拔 parser，并提供样例协议模板
- 转发：补齐渠道能力矩阵与投递保障（重试策略可视化、告警配置面板、脱敏与采样）
- 可观测：完善 health/metrics 端点与前端监控页的性能优化
- 工程化：补 `.env.example`、CI（lint/test/build）、发布与版本策略

## FAQ

### 为什么同一个串口不能被多个进程同时打开？

串口一般是独占资源，底层驱动会对同一设备做互斥；因此请确保同时只启动一个后端服务实例，并避免其它串口工具占用同一 `COMx`。

### 前端要怎么连后端？

开发态建议使用 `pnpm run dev:all`。前端开发服务器会把 `/api` 与 `/ws` 代理到后端 `9001`，页面里直接请求 `/api/*` 即可。

### 数据目录里的文件安全吗？可以提交到仓库吗？

不建议提交。运行时落盘的 `records/*.ndjson` 与 `forwarding.config.json` 可能包含手机号、短信、Webhook 等敏感内容，分享或提交前应先脱敏。

## 变更记录

### 功能优化与 UI 重构（摘录）

#### 设备列表（Port List）

- 视图切换：支持 List / Grid 两种视图，网格模式下支持状态颜色指示
- 布局锁定：列表容器高度锁定为 `468px` 并去除多余滚动条，减少切换抖动
- 操作优化：卡片与列表均集成“打开/关闭”快捷按钮

#### 终端日志（Terminal/Logs）

- 视觉升级：重构日志行布局，实现标签区与内容区严格垂直对齐
- 标签规范化：统一标签格式为 `[COMx-Type]`（如 `[COM6-RX]`, `[COM6-TX]`, `[COM6-Auto]`），并按类型分配专属颜色
- 图标微调：TX/RX 使用箭头 `➜`，System/Auto 使用 `#`
- 抗挤压设计：修复长标签导致布局错位的问题，强制标签区不换行、不压缩
- 极简操作：清空日志按钮简化为单一图标

### 核心逻辑修复（摘录）

- WebSocket 稳定性：增加防重连机制，修复严格模式下的重复连接与刷屏
- 去重逻辑：前端对 Status 日志做去重，避免后台重复上报刷屏
- 静默刷新：`fetchPorts` 支持 `silent`，自动刷新不弹“刷新成功”
- 设置防抖：修复自动发送配置页的无限保存循环，仅在真正变更时触发保存
- 状态同步：修复端口关闭后状态未及时同步，增加后端监听器强制清理

## 贡献

欢迎 PR / Issue：

- Bug 复现步骤尽量包含：系统版本、Node 版本、串口设备型号、日志片段（注意脱敏）
- 新增依赖前请先说明收益、替代方案与风险

## License

[Haohanyh Computer Software Products Open Source LICENSE](https://github.com/Hny0305Lin/LICENSE/blob/main/LICENSE)

本仓库同时提供 [LICENSE](LICENSE) 文件作为完整许可文本。
