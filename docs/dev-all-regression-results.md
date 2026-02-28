# dev:all 回归测试结果

## 本次修复验证结论

- 结论：PASS
- 覆盖范围：
  - dev:all 单实例锁：第二次启动退出码 110
  - dev:all 端口占用检测（strict）：端口占用退出码 110
  - dev:all 端口自动递增（increment）：可在端口被占用时选择新端口并正常继续
  - 后端单实例锁：启动阶段即可阻止多实例（ESerialBusy，退出码 110）

## 本地自动化结果（node:test）

执行命令：

```bash
pnpm test
```

摘要输出（节选）：

- tests: 28
- pass: 28
- fail: 0

与 dev:all 冲突直接相关的新测试用例：

- `dev:all exits 110 when lock exists and pid is alive`
- `dev:all exits 110 when backend port is in use (strict)`
- `dev:all picks new ports when mode is increment`
- `acquireInstanceLock is exclusive and releasable`

## 集成/并发启动建议（可落 CI）

当前仓库未引入 Docker/Compose 作为测试基础设施；如果需要复现“并发启动 10 次，仅 1 个实例存活”，建议使用以下思路落地：

- 使用脚本并发启动 10 次 `pnpm dev:all`（strict 模式）
- 断言：
  - 其中 1 个进程退出码为 0（或保持运行）
  - 其余进程退出码为 110
  - `GET http://127.0.0.1:<BACKEND_PORT>/health` 返回 200

如需产出 JUnit XML，可在后续 CI 方案中引入专用 reporter（或切换到带 JUnit 输出的测试执行器），以满足流水线归档需求。

