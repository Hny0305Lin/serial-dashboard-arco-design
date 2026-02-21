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
