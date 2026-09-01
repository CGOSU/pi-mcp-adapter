# 当前状态

## 项目

- 名称：`pi-mcp-adapter`
- 技术栈：Node.js、TypeScript、Pi 扩展 API、Vitest；Pi 扩展入口仍为根目录 `index.ts`。
- 版本：`2.27.1`；本轮发布修复版本已更新。

## 最终源码与加载边界

- 根目录源码保留 `index.ts`、`config.ts`、`metadata-cache.ts`、`types.ts`、`oauth.ts` 和 `cli.js` 公共兼容入口；已删除 53 个未发布转发 facade，剩余入口不被内部领域模块反向依赖。
- 领域实现位于 `src/contracts`、`src/catalog`、`src/config`、`src/runtime`、`src/auth`、`src/tools`、`src/ui`、`src/commands` 和 `src/extension`。
- `index.ts` 的静态闭包只保留配置读取、metadata cache、Schema、工具表面和注册所需代码。连接、OAuth、命令处理、gateway/direct 执行、script worker、UI server/runtime 通过缓存的原生 `dynamic import()` 按需加载。
- 有效且全为 lazy 的 metadata cache 会跳过 `session_start` 的完整 runtime 初始化；eager、keep-alive、冷缓存和 `MCP_DIRECT_TOOLS` 语义保持。
- `src/catalog` 的 selector index 和 `MetadataCatalogSnapshot` 在一次 catalog/sync 中复用，避免跨服务器重复扫描和重复读取缓存。

## 测试与发布布局

- Vitest 测试按 `test/unit`、`test/integration` 分域；Node 原生测试和 package/export runner 位于 `test/node`；共享 server/worker fixture 位于 `test/fixtures`。根目录不再保留测试文件或 `__tests__` 目录。
- `package.json` 只发布 Pi extension wrapper、构建后的 `dist`、CLI、skills 和 UI 资源，不发布 `src/**` 或测试目录。`prepack` 执行 `build:public`；tracked `dist` 可由同一脚本复现。
- 包根及 `types`、`config`、`metadata-cache`、`oauth` 五个公共入口均解析到 ESM `dist` 文件；入口内部保留 native `dynamic import()` code-splitting。Pi 扩展默认加载 `extensions/index.js` 转发到 `dist/index.js`；CLI 仍为 `dist/cli.js`。该目录布局让 Pi 的紧凑扩展标签显示为包源名称，不再追加 `:dist`。

## 最终验证状态

- `npm run typecheck`、package manifest、public exports、OAuth Node tests、打包、production-only 临时安装和静态启动导入图均已执行并通过，具体结果见 [`docs/session-log.md`](session-log.md)。
- 最终 source-vs-bundle 3-run fresh RPC benchmark：source 的 module/main/wall 中位数为 `437ms`/`475ms`/`1128ms`，bundle 为 `199ms`/`228ms`/`754ms`；bundle 未出现超过 15% 的可重复回退，且静态启动闭包门禁通过。
- `npm run benchmark:catalog -- --runs 5`：5×100 direct/live shared 为 `4.72ms`/`4.45ms`，20×100 为 `18.73ms`/`17.43ms`，50×100 为 `45.07ms`/`45.05ms`；旧 per-server 50×100 对照为 `989.27ms`。
- 10,000 工具搜索压测 cold 为 `50.28ms`，5 次 warm median 为 `5.73ms`，结果正确。
- OAuth Node runner 为 141 个测试全部通过；本轮相关 catalog、package、startup、direct、namespace、proxy 行为集合为 10 个文件、111 个测试通过。
- `npm pack --dry-run --json` 与 tarball 回归均确认发布包为 51 个文件（不超过 60），不含 `src/**`、`test/**`、source map 或已删除 facade；worker、keyring helper、AppBridge 资源均存在。production-only 临时安装成功，四个独立 Node subpath 入口及已安装 CLI smoke test 通过；包根入口在带 Pi `typebox` peer 的公共 exports 测试中通过。
- 完整 Windows Vitest 仍可能受全局配置污染、Linux keyring、`taskkill`、symlink、Unix socket/file mode 和 CLI shebang 等宿主限制；相关限制不代表源码布局回归，已用针对性行为、Node、public export、静态边界和发布检查覆盖。

## 未完成与交付边界

- 本次源码、测试和文档改动仍在工作区，未执行 git commit 或 push；tracked `dist` 由 `npm run build:public` 同步。
- `AGENTS.md` 与 `docs/clean-code.md` 是刻意保留的未跟踪排除项，不纳入本次交付。

## 最近一次更新

- 2026-08-31：删除宿主专属 MCP 配置探测、兼容 imports、setup 采用流程和 CLI `init`；遗留字段被忽略，标准配置层与 token CLI 保留。已完成 typecheck、定向 UI/命令/CLI 测试和 CLI 删除命令验证；发布构建与 package/public export 验证见 [`docs/session-log.md`](session-log.md)。
