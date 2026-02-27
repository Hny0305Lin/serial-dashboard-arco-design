# 实时监控页（/monitor）Astro Islands 改造说明

本说明面向“后续由 AI 执行改造”的场景：目标是让实时监控页的组件体系更偏 Astro（页面与组件组织），同时保留 React + Arco Design 的生态优势，并把“核心大地图/画布能力”作为一个稳定的 React Island 保持不动或最小改动。

---

## 1. 目标

把当前 `#/monitor` 的“单棵 React 大组件树（MonitorCanvas + Widgets）”改造为：

- 监控页成为一个真正的 Astro 页面路由（推荐 `http://localhost:9000/monitor`）
- 页面由 Astro 负责布局与组件组织（.astro 文件数量显著增加）
- “核心大地图/画布（平移/缩放/网格/背景等）”保留为 React Island
- 小组件（Terminal/Clock/Forwarding 等）改造成 Astro 组件外壳 + 独立 islands（React 或 vanilla），并通过共享桥接层协同

非目标：

- 不强行去掉 Arco（`@arco-design/web-react`）或 React
- 不要求一次性全量迁移（允许先做路由与架构骨架，再逐个 widget 迁移）

配套的任务分解（用于交给后续 AI 按步骤执行）见：

- [monitor-astro-islands.tasks.md](monitor-astro-islands.tasks.md)

---

## 2. 现状（As-Is）

### 2.1 路由与挂载

当前前端只有一个 Astro 页面入口：

- `web/src/pages/index.astro`：用 `client:only="react"` 挂载整个 React App
- `web/src/layouts/Layout.astro`：提供 HTML 壳

监控页路由是 React HashRouter 内部的 `#/monitor`：

- `web/src/components/Dashboard.tsx`：HashRouter + Route(`/monitor`) 渲染 `MonitorCanvas`

### 2.2 监控页核心组件

- `web/src/components/Monitor/MonitorCanvas.tsx`
  - 管理 widgets 列表、拖拽/缩放/置顶、布局持久化（localStorage: `monitorCanvasLayoutV1`）
  - 依赖 Dashboard 传入的 `ws/wsConnected/portList/onRefreshPorts`
- `web/src/components/Monitor/*Widget.tsx`
  - TerminalWidget / ClockWidget / ForwardingWidget 等
- `web/src/components/Monitor/MonitorWidgetConfigModal.tsx`
- `web/src/components/Monitor/types.ts`

### 2.3 关键点

- Arco 的全局 CSS 目前在 React App 里引入：
  - `web/src/components/Dashboard.tsx`：`import '@arco-design/web-react/dist/css/arco.css'`
- 监控页“全屏布局”是通过 React 在 `/monitor` 分支下调整 `Content` 样式完成的（非 Astro 页面级控制）。

---

## 3. 必读约束（避免 AI 走弯路）

### 3.1 Astro 组件不能“塞进 React 组件树”

Astro `.astro` 组件是编译期产物，运行时不会像 React 组件那样被 `import` 后直接渲染到已有 React Tree 里。

因此：

- 如果保留 `#/monitor` 仍由 React Router 管理，并在 React 内部渲染 widget，那么“widget 升级为 Astro 组件”几乎无法成立。
- 要让监控页“组件体系偏 Astro”，推荐把监控页做成 Astro 页面路由（例如 `/monitor`），从页面层面开始岛屿化。

### 3.2 Islands 默认彼此隔离，需要明确的共享层

把一个大页面拆成多个 islands 后：

- islands 之间不会天然共享 React Context
- 需要一个稳定的跨 island 通信与状态共享层（下文称为 `MonitorBridge`）
- 需要确保 WebSocket 连接只有一个 owner，避免重复连接/重复订阅/刷屏

### 3.3 兼容性与稳定性优先

- 布局持久化 key 建议保留：`monitorCanvasLayoutV1`
- 保留原后端 API/WS 协议与路径（`/api`、`/ws`）不变
- 禁止 busy-loop 重连、禁止无限增长队列/日志

---

## 4. 推荐 To-Be 架构（Astro 组织 + React Islands 运行）

### 4.1 新路由形态

新增一个 Astro 页面作为监控页入口：

- `web/src/pages/monitor.astro`（或 `web/src/pages/monitor/index.astro`）

目标 URL：

- 新：`http://localhost:9000/monitor`
- 旧：`http://localhost:9000/#/monitor` 需要重定向到 `/monitor`（见迁移步骤）

### 4.2 页面结构（建议）

`monitor.astro` 产出一个“舞台容器”，并在内部挂载多个 islands：

- **MonitorStage（Astro）**：负责整体布局、容器结构、全屏背景、顶栏/工具区的静态排版
- **MonitorMapIsland（React）**：负责“核心大地图/画布能力”（平移/缩放/网格/背景/坐标系）
- **WidgetShell（Astro）**：每个小组件都有一个 `.astro` 外壳（负责 HTML 结构与样式组织）
  - 外壳内部嵌入一个小型 island（React 或 vanilla）实现交互（Arco 的表单/弹窗等）

这样做到：

- `.astro` 文件数量增加：页面 + 多个 WidgetShell/布局组件
- React 仍然用于交互复杂处（尤其是 Arco 组件），但被拆分成“多个 islands”

### 4.3 MonitorBridge（跨 islands 共享层）

新增一个不依赖 React 的共享层模块（必须是 singleton）：

- `web/src/monitor/MonitorBridge.ts`（建议位置，可调整）

职责：

- 管理全局 WebSocket（连接/重连/订阅/广播）
- 持有最小必要的共享状态：`canvasState`、`ports`、`widgets`（或仅 widgets 元信息）、`wsConnected`、`metrics`
- 提供事件总线：让 islands 发布动作、订阅状态变更

建议的 API 形态（示意）：

- `getSnapshot(): MonitorSnapshot`
- `subscribe(listener): () => void`
- `dispatch(action: MonitorAction): void`

为保证跨 entry 的单例，建议用：

- `globalThis.__monitorBridge` 挂载（避免多 entry 打包导致重复实例）

### 4.4 Widget 与画布的协作模式（两种选择）

#### 选择 A（推荐，风险较低）：把“布局/拖拽/缩放”移动到共享层 + DOM

思路：

- MonitorMapIsland 负责更新舞台容器的 transform（平移/缩放）
- 每个 WidgetIsland 负责自身的拖拽/缩放（只影响自己绝对定位）
- 位置/尺寸持久化由 `MonitorBridge` 统一保存到 localStorage

优点：每个 widget 独立，符合 islands 思路；Astro 组件负责组织与外壳；改造路径清晰。  
代价：需要把当前 `MonitorCanvas` 中的拖拽/缩放/持久化逻辑拆分出来。

#### 选择 B（不推荐）：保留现有 MonitorCanvas 作为单体管理器

思路：

- MonitorCanvas 继续渲染每个 widget 的实际内容

问题：

- widget 仍是 React 组件，难以“升级为 Astro 组件”
- Astro 在监控页的存在感仍然很弱

---

## 5. 迁移步骤（AI 执行清单）

### Step 1：新增 `/monitor` Astro 页面（骨架先落地）

1) 新增 `web/src/pages/monitor.astro`  
2) 页面内先挂一个最小的 `MonitorMapIsland`（可以是新的 `MonitorMapIsland.tsx`，先渲染占位背景也行）  
3) 确保 Arco 样式在 `/monitor` 页面生效：
   - 方案 1：在 `MonitorMapIsland.tsx` 里 `import '@arco-design/web-react/dist/css/arco.css'`
   - 方案 2：单独抽一个 `web/src/styles/arco.ts`（仅导入 css），在各 islands 入口统一 import

验收：

- `http://localhost:9000/monitor` 可打开，样式正常

### Step 2：旧 `#/monitor` 重定向到新 `/monitor`

至少满足两条之一：

- 在 `Dashboard.tsx` 启动时检测到 `location.pathname === '/monitor'`（hash router 下）则 `window.location.replace('/monitor')`
- 或在 `index.astro`/入口处检测 `window.location.hash` 命中 `#/monitor` 时跳转 `/monitor`

验收：

- 访问 `/#/monitor` 自动跳到 `/monitor`，且不会来回跳转

### Step 3：引入 MonitorBridge（先只做 WS 与 ports）

1) 新建 `MonitorBridge`：管理 WebSocket 连接（复用现有 Dashboard 里的 WS 协议与消息类型）  
2) 暴露 `wsConnected`、`ports`、`forwardingMetrics` 的订阅  
3) 先让 `/monitor` 页面只读这些状态做展示（哪怕只是一个状态条）

验收：

- 只有一个 WS 连接（浏览器 Network/WS 面板可验证）
- 断线可恢复，且不会刷屏

### Step 4：把 MonitorCanvas 的职责拆分（为 islands 做准备）

把 `MonitorCanvas` 拆成三层（推荐）：

- **Canvas/Map 层（React Island，保留核心）**
  - 只负责：舞台 transform（offset/scale）、背景/网格/交互手势（拖动/缩放）
  - 不直接渲染具体 widget 业务内容
- **Widget Layout 层（Bridge/Store）**
  - 负责：widgets 列表（id/type/title/rect/zIndex/...）、持久化、导入导出
- **Widget 内容层（每个 widget 独立 island）**
  - 负责：Terminal/Clock/Forwarding 的 UI 与交互

验收：

- 布局仍能保存/恢复（沿用 `monitorCanvasLayoutV1`）

### Step 5：逐个 widget 迁移为 Astro 外壳 + Island

对每个 widget 新建一个 `.astro` 外壳，例如：

- `web/src/components/Monitor/widgets/TerminalWidgetShell.astro`
- `web/src/components/Monitor/widgets/ClockWidgetShell.astro`
- `web/src/components/Monitor/widgets/ForwardingWidgetShell.astro`

外壳负责：

- 统一的 card 外观（标题栏/拖拽手柄区/右上角按钮区）
- 容器尺寸/圆角/阴影等（尽量走 Arco token 风格）
- 内部挂载一个 island 处理交互

交互 island 可以先继续用 React（低风险），例如：

- `TerminalWidgetIsland.tsx`：复用现有 `TerminalWidget` 的大部分逻辑

最后再视情况把某些非常轻的 widget 改成 vanilla（例如 Clock）。

验收：

- 同类型 widget 多实例正常工作
- 端口连接/断开/发送/配置弹窗可用

---

## 6. 数据契约（建议统一）

### 6.1 Widget 基础结构（建议保留现有字段）

沿用 `web/src/components/Monitor/types.ts` 的核心概念：

- `id`：唯一
- `type`：`terminal | clock | forwarding | ...`
- `title`
- `x/y/width/height/zIndex`
- `portPath` 与串口参数（terminal/forwarding 需要）

### 6.2 Bridge 的 Action（示例）

建议把所有跨岛动作收敛成 `dispatch(action)`：

- `CANVAS/SET_STATE`：设置 offset/scale
- `WIDGET/ADD`、`WIDGET/REMOVE`、`WIDGET/UPDATE_RECT`、`WIDGET/SET_ZINDEX`
- `SERIAL/OPEN`、`SERIAL/CLOSE`、`SERIAL/SEND`
- `FORWARDING/LOAD_CONFIG`、`FORWARDING/SAVE_CONFIG`、`FORWARDING/TOGGLE_ENABLED`

### 6.3 持久化策略

- 继续使用 localStorage：`monitorCanvasLayoutV1`
- 保存内容建议不含 logs（logs 为运行态，避免无限膨胀）
- 存储版本字段保留：`version: 1`，后续升级走 `version: 2`

---

## 7. 性能与稳定性验收清单

- 监控页全程只有一个 WS 连接
- 频繁拖拽/缩放不导致全页面重渲染抖动（避免“顶层 setInterval tick 导致全量刷新”）
- logs/metrics 有限长（避免内存膨胀）
- 断线重连有退避与上限（禁止 busy-loop）
- 页面卸载后释放监听与定时器

---

## 8. 建议的落盘路径（示例）

仅供 AI 参考（可调整，但建议保持职责边界清晰）：

- `web/src/pages/monitor.astro`
- `web/src/monitor/MonitorBridge.ts`
- `web/src/monitor/types.ts`（Bridge 层 types）
- `web/src/components/Monitor/map/MonitorMapIsland.tsx`
- `web/src/components/Monitor/widgets/*WidgetShell.astro`
- `web/src/components/Monitor/widgets/*WidgetIsland.tsx`
