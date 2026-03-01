# dev:all 修复步骤文档

## 适用范围

- 适用于本仓库的本地开发启动：`pnpm dev:all`
- 目标：仅允许运行唯一实例；端口冲突可定位、可清理、可回归验证

## 日常启动方式

```bash
pnpm dev:all
```

默认端口：

- 前端 Astro dev：9010
- 后端 HTTP/WS：9011

## 监控与定位（Windows）

```powershell
# 进程定位（含命令行）
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'dev-all\.js|pnpm\s+dev(\s|$)|astro dev' } |
  Select-Object ProcessId,Name,CreationDate,CommandLine |
  Format-Table -Auto

# 端口定位（端口 -> PID）
netstat -ano | Select-String -Pattern ':9010\s',':9011\s' | ForEach-Object { $_.Line }
```

## 冲突清理（Windows）

如果 netstat 显示端口被占用，按 PID 清理：

```powershell
taskkill /F /T /PID <PID>
```

清理后再次确认端口释放：

```powershell
netstat -ano | Select-String -Pattern ':9010\s',':9011\s' | ForEach-Object { $_.Line }
```

## dev:all 行为变更点

- 单实例锁：默认使用系统临时目录下的锁文件，避免重复运行两个 dev:all
- 端口检测：
  - strict 模式（默认）：端口被占用即退出，退出码 110
  - increment 模式：自动递增选择可用端口（用于临时并发/多项目并行）
- Windows 下退出清理：对子进程采用 taskkill /T /F，避免残留监听

### 常用环境变量

| 变量 | 默认值 | 含义 |
|---|---:|---|
| `BACKEND_PORT` | 9011 | 后端监听端口（同时作为前端代理目标） |
| `WEB_PORT` | 9010 | 前端 dev server 端口 |
| `DEVALL_PORT_MODE` | `strict` | `strict` 或 `increment` |
| `DEVALL_LOCK_PATH` | (tmp) | dev:all 锁文件路径（用于调试/测试隔离） |
| `DATA_DIR` | `./data` | 后端运行时数据目录（同时落 server.lock.json） |

示例：启用自动递增端口

```bash
set DEVALL_PORT_MODE=increment
pnpm dev:all
```

示例：自定义端口

```bash
set BACKEND_PORT=9101
set WEB_PORT=9100
pnpm dev:all
```

## 回滚方案

- 回滚 dev:all 的防护：恢复 scripts/dev-all.js 到旧版本即可
- 回滚前端端口/代理动态化：恢复 web/astro.config.mjs 的固定端口与固定代理目标
- 回滚后端单实例锁：移除 src/index.ts 的 server.lock.json 相关逻辑与 src/core/instanceLock.ts
