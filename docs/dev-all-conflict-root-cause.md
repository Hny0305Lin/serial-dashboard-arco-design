# dev:all 冲突根因报告

## 结论摘要

- dev:all 旧实现没有“单实例锁”，允许重复启动；一旦并发启动或残留进程存在，固定端口（前端 9000、后端 9001）会出现 EADDRINUSE。
- dev:all 旧实现的 shutdown 只对 pnpm 进程执行 kill，无法保证把其子进程树（nodemon/ts-node/astro dev）一并清理，容易留下“孤儿监听进程”，导致后续 dev:all 必然冲突。
- 当前仓库未发现 docker-compose、PM2 ecosystem、CI 工作流会隐式启动 dev:all；冲突主要来自本地重复启动与残留进程。

## 现状快照（本机检查口径）

Windows 上建议用以下命令确认是否存在残留实例与端口占用：

```powershell
# 列出包含 dev:all / dev-all.js 的进程（含命令行）
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'dev-all\.js|dev:all|pnpm\s+dev:all' } |
  Select-Object ProcessId,Name,CreationDate,CommandLine |
  Format-List

# 查看 9000/9001 监听情况（端口 -> PID）
netstat -ano | Select-String -Pattern ':9000\s',':9001\s' | ForEach-Object { $_.Line }
```

如果看到 LISTENING 的 PID，再用以下命令定位占用者：

```powershell
$pid = 12345
Get-CimInstance Win32_Process -Filter "ProcessId=$pid" |
  Select-Object ProcessId,Name,CreationDate,CommandLine |
  Format-List
```

## 启动矩阵（启动命令与端口/环境变量）

| 场景 | 命令 | 工作目录 | 监听端口 | 关键环境变量 |
|---|---|---|---|---|
| 后端 dev | `pnpm dev` | repo root | `PORT`（默认 9001） | `PORT`、`DATA_DIR` |
| 前端 dev | `pnpm -C web dev` | `web/` | 9000（现已支持 `WEB_PORT`） | `WEB_PORT`、`BACKEND_PORT`、`PUBLIC_BACKEND_PORT` |
| 聚合 dev:all | `pnpm dev:all` | repo root | 前端 9000 + 后端 9001 | `DEVALL_LOCK_PATH`、`DEVALL_PORT_MODE`、`BACKEND_PORT`、`WEB_PORT` |

## 根因链路拆解

### 1) 重复启动链

- 同一台机器上手动/脚本并发执行两次 `pnpm dev:all`
- 两个 dev:all 实例各自启动一套 `pnpm dev`（后端）与 `pnpm -C web dev`（前端）
- 因前后端端口固定，先启动的一套占用 9000/9001，后启动的一套在绑定端口时触发冲突

### 2) 残留监听链（更隐蔽、更常见）

- 用户关闭终端窗口、或某个子进程异常退出
- dev:all 旧 shutdown 仅 `backend.kill()` / `web.kill()`，杀的是 pnpm 进程，不一定能杀到 pnpm 的子进程树
- 结果是 nodemon / node / astro dev 仍在后台监听端口
- 下次运行 dev:all 看到端口已被占用，表现为“刚启动就冲突”

## 修复点对照

- dev:all 增加单实例锁：重复启动时直接退出并返回 110
- dev:all 增加端口探测：端口被占用时直接退出并返回 110（可打印占用 PID）
- dev:all shutdown 改为杀进程树（Windows 使用 taskkill /T /F）
- 后端增加 server.lock.json 单实例锁：避免绕过 dev:all 直接启动多个后端实例
- 后端对 EADDRINUSE 做显式处理并返回 110，同时提供 `/health` 探针便于自动化验证

