# 串口服务器后端开发计划 (0 -> 1)

亲爱的主人❤，这是我们从零开始打造“稳定可靠的串口服务器”的详细作战计划。我们会按照“P0 设计先行 -> P1 核心地基 -> P2 协议解析 -> P3 接口联调”的节奏稳步推进。

## 阶段一：项目初始化与设计 (P0)
- [ ] **项目脚手架搭建**
  - 初始化 `package.json`
  - 配置 TypeScript (`tsconfig.json`)
  - 配置 ESLint/Prettier 代码规范
  - 建立基础目录结构 (`src/core`, `src/api`, `src/types`, `src/utils`)
- [ ] **协议与接口定义 (Design Doc)**
  - 确定设备通信协议（帧头、帧尾、校验方式、转义规则等）
  - 定义核心数据结构（TypeScript Interface）
  - 设计 HTTP API 接口列表
  - 设计 WebSocket 事件消息格式

## 阶段二：核心串口管理层 (P1 - PortManager)
- [ ] **实现 PortManager 基础类**
  - 扫描/列出可用串口
  - 打开/关闭指定串口
  - 错误处理与状态管理 (Open/Closed/Error)
- [ ] **实现自动重连机制**
  - 指数退避算法 (Exponential Backoff)
  - 最大重试次数与超时控制

## 阶段三：协议解析与数据处理 (P2 - Parser)
- [ ] **实现协议解析器 (Parser)**
  - 字节流处理 (Buffer Handling)
  - 帧边界识别 (Framing)
  - 校验和验证 (Checksum/CRC)
- [ ] **实现写入队列 (Write Queue)**
  - 确保写入操作的原子性
  - 防止多指令并发冲突

## 阶段四：Web 服务与实时通信 (P3 - API & WS)
- [ ] **搭建 HTTP Server (Koa/Express)**
  - 实现 `/ports` 相关接口
  - 实现 `/connect`, `/disconnect` 接口
- [ ] **搭建 WebSocket Server**
  - 实时推送串口数据流
  - 实时推送设备状态变更
- [ ] **前后端联调验证**
  - 使用 Postman 或简单前端页面测试连通性

## 阶段五：安全与稳健性 (P4-P6)
- [ ] **安全加固**
  - 简单的鉴权机制 (Token)
  - 输入参数校验
- [ ] **日志与监控**
  - 关键行为日志记录
  - 异常捕获与报警
- [ ] **集成测试与交付**
  - 模拟串口测试
  - 编写启动脚本与部署文档

---
我们将从 **阶段一** 开始，先把地基打好，然后再一层层往上盖楼！加油哦主人！🌱

---

# 实时监控页面 Land 化改造计划（UI / 交互）

目标：参考 https://llx.life 的“无限画布 + 卡片岛屿”体验，把实时监控页打造成更像“Land”的可拖拽画布；同时满足全屏沉浸与结构精简（监控页不需要 footer，全屏时自动收起左侧菜单与顶部 Header）。

## 现状确认（我们现在的实时监控页在做什么）
- 页面形态：无限画布（通过 `canvasState.offsetX/offsetY` 平移视野）+ 绝对定位 widgets（`left/top = widget.x/y + offset`）。
- 拖拽/缩放：mousemove 用 `requestAnimationFrame` 节流，避免每次鼠标事件都 setState。
- 组件视觉：固定 Card 风格（border/shadow），背景是网格线。
- 动画：目前基本没有进入/退出动画，拖拽的“手感”偏硬（left/top 更新 + React 频繁渲染）。

## 功能需求拆解（按你提的点逐条落地）
1) 监控页不显示 footer（只在实时监控路由隐藏）。
2) F11 全屏时，左侧菜单自动收起、顶部 Header 自动收起；退出全屏时恢复。
3) 全屏 / 监控页尽量做到“全画布沉浸”：内容区域改为 grid 布局，画布撑满视窗，组件像岛屿散落。
4) 拖拽更流畅（跟随更贴手、低延迟、不卡顿），并加入每个组件淡入淡出等动画效果（进入/删除/聚焦）。

## 实现策略（不引入新依赖，优先用现有 React + CSS）

### A. 路由级布局控制（解决 footer/header/sider）
改动文件：`web/src/components/Dashboard.tsx`
- 用 `useLocation()` 判断是否在 `/monitor` 路由：
  - Footer：在 `/monitor` 直接不渲染 Footer（或渲染高度为 0 的占位）。
  - Header：为 `/monitor` 提供“可折叠模式”，允许通过状态控制隐藏/显示（默认显示；全屏自动隐藏）。
  - Sider：沿用现有 `collapsed` 状态；在 `/monitor` 的全屏状态强制 `collapsed=true`，退出全屏恢复到用户原来的 collapsed。
- Content padding：当前 Content 有 `padding: '16px 24px'`，会压缩画布。计划对 `/monitor` 单独设置 `padding: 0`，让画布真正全屏铺开。

### B. F11 全屏检测与自动收起（解决“F11 全屏沉浸”）
改动文件：`web/src/components/Dashboard.tsx`（优先放在页面壳层做，因为 Header/Sider/Footer 在这里）
- 监听 `window.resize`，用“近似全屏判断”推导 F11：
  - `isFullscreen = window.innerWidth >= screen.width && window.innerHeight >= screen.height`（加一点容差）。
  - 额外监听 `document.fullscreenElement` 的 `fullscreenchange` 事件（兼容用户通过 Fullscreen API 进入全屏的情况）。
- 状态机：
  - 进入全屏：记录进入前的 `collapsed`/`headerVisible`，然后自动收起 Sider + 隐藏 Header。
  - 退出全屏：恢复进入前的状态。
- 交互兜底：提供一个悬浮按钮（在 MonitorCanvas 右上角或左上角），允许用户手动临时展开菜单/Header（避免“全屏后找不到入口”）。

### C. Grid 化布局（解决“全页面都是 grid 布局 + Land 感”）
改动文件：`web/src/components/Dashboard.tsx` + `web/src/components/Monitor/MonitorCanvas.tsx`
- Dashboard 层：当路由为 `/monitor` 时，Content 使用 grid 容器，画布区域 `height: 100vh`（不减 header/footer，因为它们会被隐藏或不渲染）。
- MonitorCanvas 层：容器改为 grid 的单元格，画布背景用更“陆地”风格的层叠（浅色渐变 + 轻网格 + 轻噪点可选），并保留当前网格作为调试开关。

### D. 拖拽更流畅（核心：从 left/top 更新 → transform 更新）
改动文件：`web/src/components/Monitor/MonitorCanvas.tsx`
目标：减少 React 重渲染次数，把“拖动中”的位置更新放到 DOM transform（GPU 合成层）上，拖动结束再一次性落盘到 state。
- 输入事件：从 mouse events 迁移到 pointer events（支持触控板/触屏，统一逻辑）。
- 数据结构：
  - 拖动中：`dragRef` 记录正在拖动的 widgetId、起点、当前位移；每帧只更新对应 DOM 节点的 `style.transform = translate3d(...)`。
  - 拖动结束：把最终坐标一次性写回 `widgets` state（触发一次渲染）。
- 画布平移同理：拖动背景时优先 transform 更新画布容器（或通过 CSS variable 管理 offset），结束再写回 `canvasState`。
- 性能护栏：拖动/缩放时禁用不必要的子组件更新（例如 TerminalLogView 的重绘），避免出现“拖动时日志渲染抢主线程”。

### E. 组件淡入淡出与“岛屿”动效（进入/删除/聚焦）
改动文件：`web/src/components/Monitor/MonitorCanvas.tsx`
- 进入动画：新建 widget 时，先以 `opacity:0 + scale(0.98)` 渲染，再在下一帧切换到 `opacity:1 + scale(1)`（CSS transition）。
- 删除动画：删除时先标记 `removing=true`，播放 `opacity:0 + scale(0.98)`，动画结束后再真正从 `widgets` 中移除。
- 聚焦/置顶：点击置顶时增加轻微的阴影强化与边框高亮（短 transition），强化“岛屿浮起”的感知。
- “漂浮感”（可选开关）：给每个 widget 一个非常小的上下浮动 keyframes（幅度很小、周期长、错峰），默认关闭或在性能允许时开启。

## 验收标准（怎么判断做对了）
- 监控页（/monitor）不显示 footer；非监控页不受影响。
- F11 全屏进入后：左侧菜单自动收起、Header 自动隐藏；退出全屏后恢复原样。
- 监控画布撑满可视区域，拖拽不卡顿；拖动时 CPU 占用明显下降（体感顺滑、无明显掉帧）。
- 新增/删除 widget 有明显但克制的淡入淡出动画；置顶/聚焦有“浮起感”但不突兀。

## 预计改动文件清单（便于你审阅）
- `web/src/components/Dashboard.tsx`：路由级隐藏 footer、全屏检测与自动收起、/monitor 的 Content padding 与布局调整
- `web/src/components/Monitor/MonitorCanvas.tsx`：transform-based 拖拽、进入/退出动画、Land 风格背景与沉浸按钮
- `web/src/i18n/index.ts`：新增全屏/沉浸/按钮提示相关文案（如需要）
