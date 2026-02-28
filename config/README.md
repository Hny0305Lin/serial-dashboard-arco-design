# config/

本目录用于存放“需要被版本控制”的配置与配置模板（例如：示例 `.env`、默认配置模板、共享规则配置等）。

当前仓库的一些工程配置仍保留在根目录或对应应用目录（工具默认发现路径），例如：

- 根目录：`tsconfig.json`、`.markdownlint-cli2.jsonc`
- 前端：`web/astro.config.mjs`、`web/tsconfig.json`、`web/vitest.config.ts`、`web/playwright.config.ts`

约束：

- 不为“看起来更整齐”而迁移这些文件，除非同步更新工具配置并完成构建/测试验证

