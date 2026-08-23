# 当前状态

## 项目

- 名称：`pi-mcp-adapter`
- 技术栈：Node.js、TypeScript、Pi 扩展 API、Vitest；Pi 扩展入口仍为根目录 `index.ts`。
- 版本：`2.27.0`；本轮重构未更新版本号。

## 最终源码与加载边界

- 根目录保留 `index.ts`、`config.ts`、`metadata-cache.ts`、`types.ts`、`oauth.ts` 和 `cli.js` 等公共兼容入口；这些 facade 不被内部领域模块反向依赖。
- 领域实现位于 `src/contracts`、`src/catalog`、`src/config`、`src/runtime`、`src/auth`、`src/tools`、`src/ui`、`src/commands` 和 `src/extension`。
- `index.ts` 的静态闭包只保留配置读取、metadata cache、Schema、工具表面和注册所需代码。连接、OAuth、命令处理、gateway/direct 执行、script worker、UI server/runtime 通过缓存的原生 `dynamic import()` 按需加载。
- 有效且全为 lazy 的 metadata cache 会跳过 `session_start` 的完整 runtime 初始化；eager、keep-alive、冷缓存和 `MCP_DIRECT_TOOLS` 语义保持。
- `src/catalog` 的 selector index 和 `MetadataCatalogSnapshot` 在一次 catalog/sync 中复用，避免跨服务器重复扫描和重复读取缓存。

## 测试与发布布局

- Vitest 测试按 `test/unit`、`test/integration` 分域；Node 原生测试和 package/export runner 位于 `test/node`；共享 server/worker fixture 位于 `test/fixtures`。根目录不再保留测试文件或 `__tests__` 目录。
- `package.json` 发布 `src`、公共 facade、`dist`、CLI、skills 和 UI bundle，不发布测试目录。`prepack` 执行 `build:public`；tracked `dist` 与公共源码同步。
- 公共 Node subpath `config`、`metadata-cache` 和 `types` 使用 `dist`；Pi 扩展入口和 SDK-facing TypeScript 入口继续由 Pi/TypeScript-capable loader 读取源码。

## 最终验证状态

- `npm run typecheck`、startup import graph、package manifest、public exports、OAuth Node tests、catalog benchmark、10,000 工具搜索、打包和 production-only 临时安装均已执行并通过，具体结果见 [`docs/session-log.md`](session-log.md)。
- 同一 Windows / Pi 0.84.2 宿主的当前工作树 fresh RPC 3-run A/B：当前 cold module import median `398ms`、warm Jiti cache `65ms`；从 `HEAD` 临时归档运行的基线分别为 `398ms` 和 `60ms`。5-run 当前复测为 cold `465ms`、warm `65ms`，包含 `401–691ms` 的冷样本离散值。历史 `365ms` 参考值对应的 15% 改善目标和 `300ms` 目标未达到，但同机 A/B 未显示本轮领域迁移造成可归因回退；静态启动闭包门禁通过。
- `npm run benchmark:catalog -- --runs 5`：5×100 direct/live shared 为 `4.72ms`/`4.45ms`，20×100 为 `18.73ms`/`17.43ms`，50×100 为 `45.07ms`/`45.05ms`；旧 per-server 50×100 对照为 `989.27ms`。
- 10,000 工具搜索压测 cold 为 `50.28ms`，5 次 warm median 为 `5.73ms`，结果正确。
- OAuth Node runner 为 141 个测试全部通过；本轮相关 catalog、package、startup、direct、namespace、proxy 行为集合为 10 个文件、111 个测试通过。
- tarball dry-run 为 180 个文件，required `src`/`dist` worker、keyring helper、UI asset 均存在且不含测试文件；production-only 临时安装成功，public subpath imports 与已安装 CLI smoke test 通过。
- 完整 Windows Vitest 仍可能受全局配置污染、Linux keyring、`taskkill`、symlink、Unix socket/file mode 和 CLI shebang 等宿主限制；相关限制不代表源码布局回归，已用针对性行为、Node、public export、静态边界和发布检查覆盖。

## 未完成与交付边界

- 未执行 `git commit` 或 `git push`；累计源码、测试、文档和 tracked `dist` 改动仍待维护者审阅和提交。
- `AGENTS.md` 与 `docs/clean-code.md` 是刻意保留的未跟踪排除项，不纳入本次交付。

## 最近一次更新

- 2026-08-23：完成领域源码/测试布局、公共发布同步、同机 A/B 性能、catalog/search 压力与 production-only 安装回归；保留 Windows benchmark 与测试限制的真实结果。
