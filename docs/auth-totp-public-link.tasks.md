# 登录与访问控制（TOTP + 公共访问链接）任务分解（tasks.md）

本文把 [auth-totp-public-link.md](auth-totp-public-link.md) 的方案拆成“可执行的原子任务 + 验收点”，方便后续 AI 或人类逐步落地。默认优先级：稳定性 > 可恢复 > 可定位 > 体验。

---

## 0. 术语与现状基线

### 0.1 术语

- `admin`：TOTP 登录的管理员会话
- `viewer`：公共访问链接兑换得到的只读会话
- `sid`：短会话 cookie（admin）
- `td`：认可设备 cookie（admin）
- `vid`：viewer 会话 cookie

### 0.2 当前关键入口（As-Is）

- 后端入口：`src/index.ts`
  - `mainApp.use('/api', app)` 挂载 API
  - WebSocket 监听 `/ws`
- API 路由：`src/api/app.ts`（串口与 forwarding 接口均无鉴权）
- WS：`src/api/ws.ts`（任何连接可发 `serial:send` 写串口）

### 0.3 目标基线（To-Be）

- HTTP 与 WS 均要求鉴权（拒绝匿名）
- 写入类动作必须 `admin`
- viewer 可只读访问（HTTP + 订阅 WS）
- 认可设备与公共链接可吊销
- 不引入 busy-loop，不引入无限增长缓存/队列

---

## 1. Phase 0：安全网与回滚（必须先做）

### T0.1 建立回滚开关（Feature Flag）

目标：

- 允许在任何时候临时禁用鉴权（仅用于开发/紧急回退），避免改造阻塞主线开发

建议实现：

- 环境变量 `AUTH_MODE=off|on`（默认 `off`，准备上线时切 `on`）
- 或更细：`AUTH_MODE=dev|prod`，dev 允许本机绕过，prod 强制开启

验收：

- 开关切换后，HTTP/WS 行为符合预期，且不会出现“部分接口被锁死、部分未锁”的不一致

### T0.2 记录现状行为（Baseline）

步骤：

- 打开页面，执行一次：列出端口、打开/关闭、HTTP 写入、WS `serial:send`、打开 forwarding 页并读写配置（若启用）
- 记录：WS 连接数量、写入成功/失败表现、错误提示方式

验收：

- 形成一份本地记录（截图/文字均可），用于对比改造后行为一致性

---

## 2. Phase 1：后端 Auth 存储与工具层

### T1.1 新增 auth 落盘文件读写（原子写入）

目标：

- 在 `{DATA_DIR}/auth.json` 持久化 auth 状态与吊销列表

建议实现：

- `loadAuthState()`：不存在则返回默认结构（`initialized:false`）
- `saveAuthState(next)`：写临时文件后 rename（避免文件损坏）

验收：

- kill 进程/异常中断不会产生半截 JSON
- 不存在文件时系统可启动并工作在 `uninitialized`

### T1.2 生成/校验 token 的工具函数

目标：

- `td` 与 public link token 仅存 hash，并可稳定校验

建议实现：

- `issueToken()`：生成随机 token（足够长）
- `hashToken(token)`：使用 server secret 做 HMAC，再存储 hash
- `verifyToken(token, tokenHash)`：常量时间比较（避免 timing side-channel）

验收：

- auth.json 中不出现明文 token
- 任意 token 被吊销后无法再换取会话

### T1.3 引入 TOTP 库并封装校验

目标：

- 不手写 TOTP；封装为 `verifyTotp(code, secret)` 并支持合理时间窗

验收：

- 手机 App（Google Authenticator/1Password 等）生成的 6 位码可通过校验
- 允许一个很小的时间窗容错，但不会无限容错

---

## 3. Phase 2：HTTP(`/api`) 鉴权与端点

### T2.1 新增 `/api/auth/status`

目标：

- 前端可判断 `admin/viewer/none`
- 支持 “td 有效则续发 sid” 的无感保活

验收：

- `sid` 过期但 `td` 有效时，status 调用后可恢复为 admin
- viewer 场景返回 role=viewer

### T2.2 新增 `/api/auth/setup`（仅首次）

目标：

- 在未初始化时生成 TOTP secret，并返回 `otpauth://...`
- 防止被远程抢先初始化

验收：

- 初始化后再次调用会失败（明确错误码/信息）
- 不满足安全条件时 setup 被拒绝

### T2.3 新增 `/api/auth/login` 与 `/api/auth/logout`

目标：

- 登录用 TOTP code 验证，通过后签发 `sid`
- 选择“认可设备”则额外签发 `td`
- logout 清理 cookie

验收：

- 不认可设备：`sid` 过期后必须重新输入 TOTP
- 认可设备：`sid` 过期后可自动续期
- logout 后 HTTP 与 WS 都被拒绝

### T2.4 新增认可设备管理端点（admin）

端点：

- `GET /api/auth/devices`
- `DELETE /api/auth/devices/:id`

验收：

- 吊销后该设备无法再自动续期（td 失效）

### T2.5 新增公共访问链接端点（admin + viewer）

端点：

- `POST /api/auth/public-links`（admin）
- `GET /api/auth/public-links`（admin）
- `DELETE /api/auth/public-links/:id`（admin）
- `POST /api/auth/public-links/redeem`（匿名携带 token，成功后获得 viewer 会话）

验收：

- redeem 成功后获得 `vid`，可访问只读 API
- 吊销后 redeem 失败，已兑换的 viewer 会话也应失效（建议按 tokenHash 关联实现）

### T2.6 引入统一中间件 `requireRole`

目标：

- 在路由层按“读/写”分级，不在每个 handler 内散落鉴权逻辑

验收：

- 写入类接口被 admin 锁住
- viewer 访问写接口返回明确错误（401/403）

---

## 4. Phase 3：WebSocket(`/ws`) 鉴权

### T3.1 upgrade 握手阶段校验 cookie

目标：

- 拒绝匿名 WS 连接

建议实现：

- 从 `server.on('upgrade')` 接管握手
- 解析 cookie：`sid/vid`
- 校验通过才 `handleUpgrade`

验收：

- DevTools 只能看到“已鉴权连接”，匿名连接直接 401 或断开

### T3.2 消息级权限（serial:send 必须 admin）

目标：

- viewer 即使建立连接，也只能订阅/接收，不能写串口

验收：

- viewer 发送 `serial:send` 被拒绝且不会触发串口写入

---

## 5. Phase 4：前端接入（最小 UI）

### T4.1 最小登录/状态 UI

目标：

- 能完成 setup → 扫码 → 输入 TOTP → 登录
- viewer 打开公共链接后能进入只读模式

建议实现：

- 页面启动先调用 `GET /api/auth/status`
- `role=none` 显示登录页（输入 code + 认可设备勾选）
- `role=viewer` 显示只读提示并禁用写入按钮

验收：

- admin 与 viewer 入口都可用
- 刷新页面不丢会话（在有效期内）

### T4.2 公共链接管理 UI（admin）

目标：

- 创建/复制/撤销链接

验收：

- 链接可复制到新浏览器打开并进入 viewer
- 撤销后该链接无法再使用

---

## 6. Phase 5：安全与稳定性收尾

### T5.1 CORS 收敛与 cookie 策略

目标：

- 生产部署时只允许可信 origin
- cookie 带上正确属性

验收：

- 不在白名单的 origin 无法发起写入类请求
- https 下 cookie 使用 Secure

### T5.2 登录限流与失败计数

目标：

- 降低 6 位码被爆破风险

验收：

- 短时间多次失败后触发临时封禁
- 日志不包含明文 token/code

### T5.3 回归测试清单

必测：

- admin：setup/login/logout、认可设备续期、吊销设备
- viewer：redeem、只读访问、WS 订阅、禁止写入
- WS：断线重连行为稳定，不 busy-loop
- 异常：auth.json 缺失/损坏时的恢复策略（至少可给出明确错误并阻止进入写入态）

