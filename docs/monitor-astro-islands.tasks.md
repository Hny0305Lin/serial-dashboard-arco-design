# 实时监控页（/monitor）Astro Islands 改造任务分解（tasks.md）

本文把 [monitor-astro-islands.md](monitor-astro-islands.md) 的方案拆成“可执行的原子任务 + 验收点”，方便后续 AI 或人类逐步落地。默认优先级：稳定性 > 可恢复 > 可定位 > 体验。

---

## 0. 术语与现状基线

### 0.1 当前关键入口（As-Is）

- 前端入口：`web/src/pages/index.astro`（`client:only="react"` 挂载 React App）
- React 路由：`web/src/components/Dashboard.tsx`（HashRouter）
- 监控页核心：`web/src/components/Monitor/MonitorCanvas.tsx`（画布 + widgets + 持久化）
- Widget：`web/src/components/Monitor/*Widget.tsx`
- Widget 配置：`web/src/components/Monitor/MonitorWidgetConfigModal.tsx`
- Widget 类型：`web/src/components/Monitor/types.ts`
- Arco 全局样式：当前由 `Dashboard.tsx` 引入 `@arco-design/web-react/dist/css/arco.css`
- 后端接口：`/api/*`；WS：`/ws`（开发态通过 Astro 代理）

### 0.2 改造目标（To-Be）

- 新增 Astro 页面路由：`/monitor`（推荐 `http://localhost:9000/monitor`）
- 保留“核心大地图/画布”为 React Island（可继续使用 Arco）
- 小组件迁移为：Astro 外壳（Shell）+ 独立 islands（React 或 vanilla）
- 引入跨 islands 的共享层：`MonitorBridge`（单 WS owner + 状态总线）
- 旧 `/#/monitor` 自动跳转到新 `/monitor`

---

## 1. Phase 0：准备与安全网（必须先做）

### T0.1 记录现状行为（Baseline）

**步骤**
- 打开 `/#/monitor`，执行一次：添加终端组件、绑定端口、打开/关闭、发送、导出/导入布局、刷新端口列表、打开转发组件并拉取 metrics。
- 浏览器 DevTools：记录 Network/WS 连接数量、Console 是否有重复连接/刷屏。
- 记录 localStorage 中 `monitorCanvasLayoutV1` 的示例内容（注意不要把敏感串口 payload 发布到公共仓库）。

**验收**
- 形成一份本地记录（截图/文字均可），用于对比改造后行为一致性。

### T0.2 建立“回滚开关”（Feature Flag）

**目标**
- 任何时候可以把 `/monitor` 回滚到旧的 `/#/monitor` 或禁用新页面，避免改造中断开发。

**建议实现**
- 方式 A：新增环境变量 `PUBLIC_MONITOR_PAGE=astro|legacy`（默认 legacy），在入口处决定跳转/渲染。
- 方式 B：仅在 `/monitor` 页面内提供“返回旧版监控页”按钮（用于紧急回退）。

**验收**
- 可以通过简单配置在新旧两种监控页间切换，且不会导致循环跳转。

---

## 2. Phase 1：新增 Astro 页面 `/monitor`（骨架落地）

### T1.1 新增 `web/src/pages/monitor.astro`

**目标**
- `/monitor` 可访问，页面结构由 Astro 输出。

**步骤**
- 新建 `web/src/pages/monitor.astro`（或 `web/src/pages/monitor/index.astro`）。
- 使用现有 `web/src/layouts/Layout.astro` 作为布局壳。
- 页面内先放一个最小容器（例如 `div#monitor-root`）与标题/占位提示。

**验收**
- `http://localhost:9000/monitor` 能打开，HTTP 200，且有基本内容。

### T1.2 确保 Arco 样式在 `/monitor` 生效

**目标**
- `/monitor` 页面使用 Arco 组件时样式完整，不依赖 Dashboard 入口。

**步骤（推荐其一）**
- 方案 A：在每个 React Island 入口 `import '@arco-design/web-react/dist/css/arco.css'`。
- 方案 B：抽一个 `web/src/styles/arco.ts`（仅 import css），所有 islands 入口统一 import。
- 方案 C：在 Astro 页面层引入构建后的全局 CSS（如果项目已有全局样式管线）。

**验收**
- 在 `/monitor` 放一个 Arco Button/Modal 测试（可临时），样式正确。

### T1.3 旧路由 `/#/monitor` → `/monitor` 跳转

**目标**
- 用户从旧书签进入也能到新页面。

**步骤（推荐）**
- 在 `Dashboard.tsx` 或 React App 初始化处检测：若 hash 路由命中 `/monitor`，则 `window.location.replace('/monitor')`。
- 注意：避免在新页面 `/monitor` 再把用户跳回 `/#/monitor`，防止循环。

**验收**
- 访问 `http://localhost:9000/#/monitor` 会稳定跳转到 `http://localhost:9000/monitor`。
- 访问 `http://localhost:9000/#/` 等其它路由不受影响。

---

## 3. Phase 2：引入 MonitorBridge（单 WS owner + 共享状态）

### T2.1 新建 Bridge 目录与类型

**目标**
- Bridge 不依赖 React Context，跨 islands 可共享，且全局唯一。

**文件建议**
- `web/src/monitor/MonitorBridge.ts`
- `web/src/monitor/types.ts`

**设计约束**
- 单例：推荐挂到 `globalThis.__monitorBridge`，避免多 entry 打包导致重复实例。
- API：`getSnapshot()` + `subscribe(listener)` + `dispatch(action)`。
- 状态最小化：只存必要信息；日志/大数组必须限长。

**验收**
- 多个 island 同时 import Bridge，只产生一个实例（可用 `console.count` 临时验证，最终移除）。

### T2.2 Bridge 管理 WebSocket（只连一次）

**目标**
- `/monitor` 页面里，无论多少 islands，都只维护一个 WS 连接。

**步骤**
- Bridge 内实现 `connect()`：连接 `getWsUrl()`（或沿用现有 `utils/net.ts`）。
- 处理消息：至少支持 `serial:status`、`serial:opened`、`serial:data`、`forwarding:metrics`、`forwarding:alert`（按现有协议）。
- 处理断线：退避重连 + 上限；禁止 tight loop。

**验收**
- DevTools → Network → WS：只有一个连接。
- 串口状态变更能被 Bridge 捕获并广播到订阅者。

### T2.3 Bridge 提供 ports/metrics 的 HTTP 拉取能力

**目标**
- 在 `/monitor` 不依赖 Dashboard 组件也能刷新端口、拉取 forwarding metrics/config。

**步骤**
- 复用 `/api/ports`、`/api/forwarding/*` 现有接口。
- 在 Bridge 中实现 `refreshPorts(silent?: boolean)`、`fetchForwardingMetrics()` 等动作。

**验收**
- `/monitor` 页面可以显示端口列表（最简 UI 即可），并能手动刷新。

### T2.4 React 侧订阅方式统一

**目标**
- islands 内订阅 Bridge 状态不引发全量重渲染。

**步骤**
- 用 `useSyncExternalStore`（或等价方案）实现 `useMonitorSnapshot(selector)`。
- 避免顶层每秒 tick 导致整个页面重绘；秒级刷新下沉到需要的 widget。

**验收**
- 频繁 WS 消息不会导致整个页面卡顿；只有相关组件更新。

---

## 4. Phase 3：把 MonitorCanvas 拆成“地图岛 + 布局/持久化 + 组件岛”

这一步是改造成 Astro Islands 的核心。建议先“复制-迁移”，最后再删除旧实现，避免一边拆一边坏。

### T3.1 抽离布局存储（保留 `monitorCanvasLayoutV1`）

**目标**
- 将 localStorage 持久化从 UI 组件中抽离，迁移后仍兼容老布局。

**步骤**
- 新建 `web/src/monitor/layoutStore.ts`（名称可调）
- 实现：
  - `loadLayout(): { canvasState, widgets } | null`
  - `saveLayout(next, { debounceMs })`
  - 版本字段保留 `version: 1`
  - 不保存 logs（运行态，必须限长）

**验收**
- 新旧页面都能读到同一份布局数据（至少做到导入后渲染一致）。

### T3.2 新建 MonitorMapIsland（React）

**目标**
- “核心大地图/画布能力”独立成一个 React Island：负责 offset/scale、背景、交互手势，不负责渲染 widget 业务内容。

**步骤**
- 新建 `web/src/components/Monitor/map/MonitorMapIsland.tsx`：
  - 读取 Bridge 的 `canvasState`，更新 transform
  - 提供手势交互：拖动平移、滚轮缩放
  - 把变化 `dispatch(CANVAS/SET_STATE)`

**验收**
- 在 `/monitor` 拖动/缩放可用，且不会触发 widgets 业务重渲染。

### T3.3 Widget 的“定位/拖拽/缩放”策略确定

**目标**
- islands 下 widget 位置变化要可控、可持久化、互不打架。

**推荐策略**
- Widget 的外壳（Astro）渲染绝对定位容器；
- WidgetIsland 负责自身拖拽/缩放（只改自己的 rect）；
- rect 更新通过 Bridge dispatch，落盘由 layoutStore debounce 保存。

**验收**
- 任何 widget 位置变化都能持久化，刷新页面布局不丢。

---

## 5. Phase 4：迁移 Widgets 为 Astro Shell + Island

建议按风险从低到高迁移：Clock → Terminal → Forwarding。

### T4.1 新建 WidgetShell（Astro）

**目标**
- 统一外观与布局组织由 Astro 负责，提升 Astro “含量”。

**文件建议**
- `web/src/components/Monitor/widgets/WidgetFrame.astro`（通用壳：标题栏、按钮槽、内容槽）
- `web/src/components/Monitor/widgets/ClockWidgetShell.astro`
- `web/src/components/Monitor/widgets/TerminalWidgetShell.astro`
- `web/src/components/Monitor/widgets/ForwardingWidgetShell.astro`

**验收**
- `/monitor` 页面里至少能渲染一个壳（无需交互），外观与旧版接近或更一致。

### T4.2 Clock：优先做成最轻岛

**目标**
- Clock widget 先迁移成功，跑通“Shell + Island + Bridge”链路。

**步骤**
- `ClockWidgetShell.astro` 渲染框架与占位
- `ClockWidgetIsland.tsx`（或 vanilla）：
  - 时间更新（本地/北京时间）
  - 如需外部 API：加超时、加缓存窗口、失败降级到本地时间

**验收**
- 多实例时钟不互相影响；切换时区选项正常；不会每秒导致全页面 re-render。

### T4.3 Terminal：迁移串口交互与日志（限长）

**目标**
- Terminal 迁移后仍支持：绑定端口、打开/关闭、发送、显示 TX/RX/System 日志。

**步骤**
- `TerminalWidgetShell.astro`：壳 + 挂载 island
- `TerminalWidgetIsland.tsx`：
  - 使用 Bridge `dispatch(SERIAL/OPEN|CLOSE|SEND)`
  - 订阅 `serial:status` 与 `serial:data`，只更新本 widget 的状态
  - logs 必须限长（例如最多 N 行，或按字节预算截断）
  - 若复用 `TerminalLogView.tsx`，确保其不依赖 Dashboard 其它上下文

**验收**
- 开关端口逻辑与旧版一致；日志不丢关键符号（如 ➜、#、ℹ）；长时间运行内存不持续上涨。

### T4.4 Forwarding：迁移配置/指标/告警（最重）

**目标**
- 转发组件迁移后仍支持：读取/写入 config、启停 enabled、查看 metrics、查看 logs（结构化）。

**步骤**
- `ForwardingWidgetShell.astro`：壳 + 挂载 island
- `ForwardingWidgetIsland.tsx`：
  - HTTP：`/api/forwarding/config|enabled|metrics|logs|records`
  - WS：订阅 `forwarding:metrics`、`forwarding:alert`（如果已用）
  - UI：继续用 Arco Tabs/Form/Modal（不建议在这一步改为 vanilla）
  - 输入校验：字段长度限制、避免巨大 payload 导致卡顿

**验收**
- 与旧版功能等价；错误提示明确；不会刷屏；网络失败可恢复。

---

## 6. Phase 5：收尾与清理

### T5.1 删除或降级旧 `MonitorCanvas` 路由

**目标**
- 避免两套监控页长期并存带来的维护成本与重复 WS 连接风险。

**策略**
- 默认路由只保留 `/monitor`
- `/#/monitor` 仅做跳转或展示“已迁移”提示

**验收**
- 旧入口不再渲染完整监控系统；只起到兼容跳转作用。

### T5.2 统一样式注入策略（移除运行时 `style` 注入）

**目标**
- 当前 `MonitorCanvas.tsx` 里有大量 `document.createElement('style')` 注入。Islands 化后建议迁移到更可控的样式组织（Astro/全局 CSS/模块化）。

**步骤**
- 把关键样式迁移到：
  - `WidgetFrame.astro` 的 scoped style 或
  - `web/src/styles/monitor.css` 并在 `monitor.astro` 引入

**验收**
- 视觉一致；切换页面不会遗留样式；不会因为卸载时机导致闪烁。

### T5.3 性能回归与稳定性回归

**必测清单**
- 单 WS 连接
- 30 分钟运行不明显变慢、不持续吃内存
- 高频数据输入时（serial:data 很密）UI 仍可操作
- 导入/导出布局可用且兼容老数据
- 断线重连可恢复（退避 + 上限）

---

## 7. 交付物清单（最终应看到什么）

- 新页面：`web/src/pages/monitor.astro`
- 新共享层：`web/src/monitor/MonitorBridge.ts`（及相关 types/store）
- 新组件组织：`web/src/components/Monitor/widgets/*.astro`（Shell 明显增多）
- React islands：`MonitorMapIsland` + 各 WidgetIsland（数量增加但体积可控）
- README/文档：迁移说明 + tasks.md + 验收清单完整

