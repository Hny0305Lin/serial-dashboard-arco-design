# 目录结构与存放规范

本项目按“后端（Node.js + TypeScript）/ 前端（Astro + React）”双应用组织，仓库根目录只放跨应用共享的文档、脚本与工程配置。

## 顶层目录

```text
.
├─ config/                  配置与模板（不迁移工具默认发现的配置文件）
├─ src/                     后端 TypeScript 源码（编译输出到 dist/）
├─ test/                    测试入口索引（实际测试代码见各应用目录）
├─ assets/                  跨应用共享资源（当前主要在 web/public/）
├─ lib/                     vendor 第三方代码（默认不建议引入）
├─ web/                     前端 Astro + React 应用（独立 package.json）
├─ docs/                    文档入口（设计/排障/使用说明）
│  ├─ tasks/                文档对应的任务分解（*.tasks.md）
│  └─ reports/              产物/报告（如 Lighthouse）
├─ scripts/                 仓库级脚本（联调编排、互斥锁、诊断/小工具）
│  └─ scratch/              一次性验证/实验脚本（可删，勿被依赖）
├─ dist/                    后端构建产物（tsc 输出，勿手改）
└─ data/                    运行时数据目录（默认，建议加入 .gitignore）
```

## 分类规则（按用途）

- 后端源码：只放在 `src/`，按职责拆分为 `api/`、`core/`、`services/`、`storage/`、`types/`、`tools/`、`perf/`
- 前端源码：只放在 `web/src/`，静态资源放在 `web/public/`，E2E 测试放在 `web/e2e/`
- 文档：只放在 `docs/`
  - 任务分解：统一放到 `docs/tasks/`
  - 报告/产物：统一放到 `docs/reports/`（按工具再分子目录）
- 仓库脚本：只放在 `scripts/`
  - 可复用脚本：`scripts/` 根下
  - 一次性验证/实验：`scripts/scratch/`（禁止被构建/测试链路依赖）

## 分类规则（按扩展名）

- `.ts/.tsx`：应用源码与测试代码（后端在 `src/`，前端在 `web/src/`）
- `.md`：文档（`docs/`、根 `README.md/PROJECT.md`）
- `.mjs/.cjs/.js`：仓库脚本（`scripts/`）；临时验证脚本放 `scripts/scratch/`
- `.json/.jsonc/.mjs` 等工程配置：优先保留在仓库根或对应应用根（工具默认发现路径），避免“为归类而迁移”导致工具失效

## 命名规范

- 目录名：小写 + kebab-case（如 `reports/lighthouse`、`scratch`）
- 脚本名（`scripts/`）：kebab-case（如 `check-ports.js`、`dev-all.js`）
- 前端 React 组件：PascalCase（如 `Dashboard.tsx`、`MonitorCanvas.tsx`）
- 后端核心类模块：PascalCase（如 `PortManager.ts`、`PacketParser.ts`）
- 工具/函数模块：camelCase 或语义化组合（如 `mixedEncoding.ts`、`cleanSerialLogs.ts`）

## 放置约束（避免“看起来整齐但用起来坏掉”）

- 不迁移会被工具自动发现的配置文件（例如 lint/config、tsconfig、Astro/Vite 配置），除非同时完成工具配置更新并验证
- 不把运行时产物与敏感数据纳入仓库（`data/` 应保持忽略与可清理）
- 任何跨目录移动都必须同步更新引用路径，并以 `pnpm run build`、`pnpm run test`、`pnpm -C web test` 验证通过
