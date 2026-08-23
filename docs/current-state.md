# 当前状态

## 项目

- 名称：`pi-mcp-adapter`
- 技术栈：Node.js、TypeScript、Pi 扩展 API、Vitest；入口仍为 `index.ts`。
- 版本：`2.27.0`，本次启动优化未更新版本号。

## 当前目标

- 降低 Pi 冷启动的扩展模块导入成本，同时保持 MCP 工具表面和生命周期行为不变。

## 已知状态

- 启动路径保留缓存目录、Schema 和注册逻辑；连接、命令、OAuth、脚本、proxy/direct 执行和 UI runtime 通过共享懒加载按需导入。
- 有效且全为 lazy 的 metadata cache 会跳过 `session_start` 的完整 runtime 初始化；首次 MCP 使用承担一次延迟加载。eager、keep-alive、冷缓存和 `MCP_DIRECT_TOOLS` 语义保持。
- `npm run benchmark:startup -- --runs 3` 已在 Windows / Pi 0.84.2 验证：冷 module import 中位数 363ms，缓存命中中位数 58ms；详细实测和验证记录见 [`docs/session-log.md`](session-log.md)。

## 待处理

- 完成文档后的选择性 Git 提交，并按授权流程推送到目标仓库；不得纳入无关的 `AGENTS.md` 或其他用户改动。
- 当前 Windows 环境仍有既有完整测试基础设施限制，见 [`docs/pitfalls.md`](pitfalls.md)。

## 最近一次更新

- 2026-08-23：完成启动边界、懒加载、启动回归和文档收尾记录。
