# 登录与访问控制（TOTP + 公共访问链接）说明

本文面向“后续由 AI 或人类执行落地”的场景，给出一个适配本项目的、最小改动且可恢复/可定位的鉴权方案：

- 管理员通过 TOTP（动态口令）完成登录（不做账号密码体系）
- 支持多浏览器/多设备的“认可设备（Trusted Device）”免重复输入
- 支持“公共访问链接（Public Access Link）”用于分享只读访问（监控/查看日志/指标）
- 同时覆盖 HTTP(`/api`) 与 WebSocket(`/ws`)

配套任务分解（用于交给后续 AI 按步骤执行）见：

- [auth-totp-public-link.tasks.md](auth-totp-public-link.tasks.md)

---

## 1. 目标

- 锁死写入面：任何能“写串口/改配置”的入口必须授权（含 WS `serial:send`）
- 只读可分享：提供可控的 viewer 访问方式（公共链接），便于远程排障/展示
- 多设备友好：管理员在常用设备上“认可一次，长期免输”
- 可吊销：认可设备与公共链接都能在服务端吊销、可查看最近使用时间
- 稳定优先：不引入后台 busy-loop，不引入无限增长缓存/队列

非目标：

- 不做多用户/权限组/组织体系
- 不做复杂 OAuth / SSO
- 不承诺“无后端存储”或“完全无状态”（本方案需要落盘保存 secret 与吊销列表）

---

## 2. 现状（As-Is）

后端目前无任何鉴权/会话：

- 后端入口：`src/index.ts`（`mainApp.use('/api', app)`，WS 监听 `/ws`）
- API 路由：`src/api/app.ts`（串口 + forwarding 全部无鉴权）
- WS 服务端：`src/api/ws.ts`（任何人连接后可收广播，且可发 `serial:send` 写串口）

因此：一旦后端暴露到局域网/公网，风险点主要在“写入串口”与“修改转发配置”。

---

## 3. 核心设计（To-Be）

### 3.1 角色与权限

- `admin`
  - 获得方式：TOTP 登录（可选择认可设备）
  - 允许：串口 open/close/write、WS serial:send、修改 forwarding 配置、管理设备/链接
- `viewer`
  - 获得方式：公共访问链接兑换（redeem）
  - 允许：查看 ports、查看 metrics/logs/records、订阅 WS 推送
  - 禁止：任何写入类动作（HTTP/WS）

### 3.2 会话与令牌（建议 Cookie 承载）

为保证 HTTP 与 WebSocket 统一校验且不要求前端自定义 header，建议统一走 cookie：

- `sid`：短会话（admin）
  - 时长建议：15 分钟（可配置）
  - 用途：访问写入类 API/WS
- `td`：认可设备令牌（admin）
  - 时长建议：30 天（可配置）
  - 用途：当 `sid` 过期时自动续发 `sid`（免输 TOTP）
- `vid`：viewer 会话
  - 时长建议：7 天（可配置）
  - 用途：访问只读 API/WS

cookie 建议属性：

- `HttpOnly`
- `SameSite=Lax`
- 生产环境 https：加 `Secure`

服务端存储约束：

- `td` 与公共链接 token 仅保存 hash（可吊销、可审计），不落盘明文 token

### 3.3 保活与续期

推荐“短会话 + 长期认可”模型：

- 前端启动调用 `GET /api/auth/status`
  - `sid` 有效：直接进入 admin
  - `sid` 无效但 `td` 有效：自动续发 `sid`（无感保活）
  - `vid` 有效：进入 viewer（只读模式）
  - 都无效：显示 TOTP 登录页
- 前端定时（3–5 分钟）调用一次 `GET /api/auth/status`，保持会话滑动续期
- WS 重连前也先调用一次 status，避免“WS 反复失败重连”的不确定性

### 3.4 初始化（Setup）流程

必须解决“谁来设置第一份 TOTP secret”的问题，推荐策略：

- 初次启动处于 `uninitialized`
- 提供 `POST /api/auth/setup` 生成 TOTP secret 与 `otpauth://...`
- 仅允许在以下条件之一满足时 setup：
  - 条件 A：仅允许本机访问（`req.ip` 为 loopback 或 `X-Forwarded-For` 可信场景）
  - 条件 B：要求提供一次性 setup key（环境变量 `AUTH_SETUP_KEY`）

### 3.5 公共访问链接（Public Access Link）

公共访问链接目标是“只读分享”，建议为“短 token + 可吊销 + 有效期”：

- 管理员创建链接：`POST /api/auth/public-links`
  - 服务端生成随机 token（仅返回一次给创建者）
  - 落盘只存 `tokenHash` + `expiresAt`
- 访问者打开链接后进行兑换：`POST /api/auth/public-links/redeem`（携带 token）
  - 成功后写入 `vid` cookie
  - 链接 token 本身可设计为一次性或多次兑换（推荐多次兑换但可随时吊销）

UI 建议：

- 在监控页/首页显示一个“只读分享链接”入口（管理员可复制、可撤销）
- viewer 模式显著标记“只读”，并禁用所有写入按钮

---

## 4. API 约定（/api/auth/*）

### 4.1 状态与初始化

- `GET /api/auth/status`
  - 返回：`{ role: 'none'|'viewer'|'admin', initialized: boolean, deviceTrusted: boolean }`
  - 允许在此接口内：当 `td` 有效但 `sid` 过期时自动续发 `sid`
- `POST /api/auth/setup`
  - 仅允许 `uninitialized`
  - 返回：`{ otpauthUrl, issuer, accountName }`（可选：`recoveryCodes`）

### 4.2 登录登出（admin）

- `POST /api/auth/login`
  - 入参：`{ code: string, trustDevice?: boolean }`
  - 成功：写 `sid`；若 `trustDevice` 写 `td`
- `POST /api/auth/logout`
  - 清除 `sid/td/vid`

### 4.3 认可设备（admin）

- `GET /api/auth/devices`
- `DELETE /api/auth/devices/:id`

### 4.4 公共链接（admin）

- `POST /api/auth/public-links`
  - 入参：`{ expiresInDays?: number, note?: string }`
  - 返回：`{ id, url, expiresAt }`
- `GET /api/auth/public-links`
- `DELETE /api/auth/public-links/:id`

### 4.5 兑换（viewer）

- `POST /api/auth/public-links/redeem`
  - 入参：`{ token: string }`
  - 成功：写 `vid`

---

## 5. 保护策略（HTTP 与 WS）

### 5.1 HTTP(`/api`) 分级

建议在路由层统一引入 `requireRole(role)` 中间件，按读写分级：

- 必须 `admin`：
  - `POST /ports/open`
  - `POST /ports/close`
  - `POST /ports/write`
  - `PUT /forwarding/config`
  - `POST /forwarding/channels`
  - `DELETE /forwarding/channels`
  - `POST /forwarding/enabled`
- 允许 `viewer`（或按需也要求 admin）：
  - `GET /ports`
  - `GET /forwarding/metrics`
  - `GET /forwarding/records`
  - `GET /forwarding/logs`

### 5.2 WebSocket(`/ws`) 鉴权

关键点：

- WS 握手阶段必须校验 cookie（拒绝匿名连接）
- 建议通过 `server.on('upgrade')` 做握手拦截再 `handleUpgrade`
- 消息级权限再做一次断言：
  - `serial:send` 必须 admin
  - viewer 只允许订阅/接收

---

## 6. 服务端存储（DATA_DIR）

建议新增：

- `{DATA_DIR}/auth.json`

示例结构（示意）：

- `initialized: boolean`
- `totpSecretBase32: string`
- `trustedDevices: [{ id, tokenHash, createdAt, lastSeenAt, uaHint }]`
- `publicLinks: [{ id, tokenHash, scope: 'viewer', createdAt, expiresAt, lastUsedAt, note }]`

注意：

- tokenHash 建议用 `sha256`（或更强 hash）对 token + serverSecret 做 HMAC，避免纯 hash 被撞库
- 文件写入应采用“写临时文件后 rename”的方式，避免异常中断导致 auth.json 损坏

---

## 7. 配置项（建议环境变量）

- `AUTH_COOKIE_SECRET`：cookie 签名/加密密钥（必须设置）
- `AUTH_TOTP_ISSUER`：TOTP issuer（默认项目名）
- `AUTH_TRUST_DAYS`：认可设备有效期（默认 30）
- `AUTH_PUBLIC_LINK_DAYS`：viewer 有效期（默认 7）
- `AUTH_SETUP_KEY`：可选，一次性初始化口令（推荐生产启用）

---

## 8. 安全与稳定性注意事项

### 8.1 CORS 收敛

当前服务端存在全开 CORS 的用法，上线/局域网部署时应收敛 origin 白名单，避免“别的网站也能跨域打你写接口”。

### 8.2 限流与失败计数

对 `POST /api/auth/login` 建议：

- 按 IP + 指纹（粗粒度）做失败计数
- 短时间多次失败后临时封禁一小段时间
- 所有鉴权失败日志要克制，不打印 token 与敏感 payload

### 8.3 统一超时与可观测

- status/redeem/login 都应有明确超时与错误码
- 推荐提供一个最小 `GET /api/auth/health` 或把 auth 指标融入现有 metrics（可选）

