# test/

本目录作为测试入口索引，用于说明各类测试代码的实际位置与运行方式。

## 后端（Node.js + TypeScript）

- 单元/集成测试源码：`src/test/`
- 运行方式：先 `pnpm run build` 编译到 `dist/`，再由 `node --test dist/test/**/*.test.js` 执行

## 前端（Astro + React）

- 单元测试：`web/src/**/*.test.ts(x)`（Vitest）
- E2E 测试：`web/e2e/`（Playwright）

