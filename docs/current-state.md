# 当前状态

## 进行中的 Pi 原生 MCP 迁移

迁移任务、顺序、依赖及恢复条件见唯一详细待办 [`docs/todo.md`](todo.md)；已交付能力的完整清单与用户前置条件见 [`README.md`](../README.md) 「Required Pi host」与「Behavior changes under the native owner」。历史 `native-management-api` 源码未恢复；本轮已从固定 Pi 1.2.0 基线重建 session-scoped 原生 API（已完成、不重做），定向测试通过，`npm run check` 受基线缺失模型数据影响而未通过；实现与 adapter 契约审计见 [`docs/native-mcp-evidence.md`](native-mcp-evidence.md)。用户已确认 trust、keyring/OAuth、“暂不支持原生 2026-07-28 远程协议”与 directTools 持久化四项决策，见 [`docs/decisions.md`](decisions.md)。迁移的十二项任务已全部完成：前六项原生能力、`directTools` 持久化与面板迁移、真实同会话回归、干净基线补丁/公共产物交付、文档与 Git 收尾。早期被阻塞的旧面板任务未重试、未伪报完成，其澄清与副作用记录保留在 [`docs/session-log.md`](session-log.md)。

交付边界：adapter 的 `dist/**` 由 `npm run build:public` 在 patched Pi 1.2.0 环境下可重复生成（当前 18 个文件），发布入口为 native-only；stock Pi 1.2.0 缺少管理 API 时 adapter 显式失败，不 fallback 到旧 runtime。旧自包含 adapter 运行时对应的 `src/**` 模块仍在仓库中并由各自测试覆盖，但已不从 `dist/index.js` 可达；`mcp-script-worker.mjs` 与 `app-bridge.bundle.js` 已不再随包发布。

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

- 本轮迁移的 adapter 改动已在工作区；提交与 push 结果见 [`docs/session-log.md`](session-log.md) 最新记录。tracked `dist` 由 `npm run build:public` 在 patched Pi 1.2.0 下同步；该脚本现先在 `.tmp-public-build-*` 暂存目录完成构建、全部成功后才原子替换 `dist/`，因此失败不会再损失现有生成物，但 stock Pi 1.2.0 缺少管理 API 时仍会以声明发射错误失败，重新生成发布产物请用 `npm run test:public-types -- --pi-source <patched checkout>`。
- 未激活的 adapter 设置（`scriptMode`、`disableProxyTool`、`autoAuth`、`trace`、`oauthDir` 及 server 级 `debug`/`trace`）仍保留在配置中但不由 native owner 生效，属于有意保留的边界；详见 README。
- `AGENTS.md` 与 `docs/clean-code.md` 已在 commit `4b7f17c` 纳入版本控制，本任务未修改它们（`git status` 无变化），也不属于本次迁移改动。

## 最近一次更新

- 2026-10-16：迁移已提交并 push 到 adapter 主仓库 `main`：commit `05c4a3f1023f2d0ce7458515d1782fc72370ed69`（`迁移 MCP 扩展到 Pi 1.2.0 原生管理协议`，104 个文件，仓库本地身份 CGOSU/dev@cgosu.com），远端 `origin/main` 已与本地一致（无强推、未重放）。Pi 上游未提交、未 push、未发布。真实命令与结果见 [`docs/session-log.md`](session-log.md)。
- 2026-10-16：完成最终文档与 adapter Git 交付准备。在独立干净 checkout（`git clone --no-hardlinks`，detached `06a466935536f8c9bcacb2d5efc0fc021be1bdff`，Pi `1.2.0`，apply 前 worktree clean）上重复验证：`git apply --check` 与真实 `git apply` 均成功且得到与 manifest 一致的 48 个路径，`npm ci --ignore-scripts` 装 299 个包，4 文件/57 项 native 测试通过，`test:public-types` 与 `test:patched-native-session` 均通过并同步 18 个 `dist` 文件；patch SHA-256 与 manifest 一致。用户文档新增 patched Pi 前置条件、`/mcp` 与 `/mcp-adapter` 分工、trust/keyring/生命周期/缓存与在 native owner 下保留/不激活的功能边界；详细命令、真实结果与限制见 [`docs/session-log.md`](session-log.md)。
- 2026-10-16：真实 patched Pi native MCP extension 与 adapter 在同一 harness session 的回归 runner 已通过；覆盖本地 fixture 的 live tool/resource/prompt catalog、执行及失败、管理刷新/读取、持久化与 session-only 策略、未信任项目拒绝、runtime registration、session reload 后旧 handle 失效，以及 adapter status v1/命令状态。runner 与实际命令、限制和详细结果见 [`docs/session-log.md`](session-log.md)。
- 2026-10-16：用户确认「保留 directTools 选择语义并扩展原生管理 API 持久化」（唯一决定见 [`docs/decisions.md`](decisions.md)）。该决定源自暂停的 `native-panel-status-and-live-catalog`：原生 `setExecutionPolicy` 不持久化、`setToolExposure` 写的是 `toolExposure` 且被 direct 选择覆盖，与面板既有保存语义不等价。[`docs/todo.md`](todo.md) 新增任务 `native-direct-tools-persistence`（第 8 项）作为面板迁移的直接前置，后续任务顺延为 12 项；[`docs/native-mcp-protocol.md`](native-mcp-protocol.md) 新增“待实现：directTools 持久化”目标契约段。本轮只更新文档，未改生产代码、未运行测试或上游命令，源码未提交、未 push。
- 2026-10-15：用户确认“先不支持”原生 `2026-07-28` 远程 MCP 协议；新增决定见 [`docs/decisions.md`](decisions.md)，[`docs/todo.md`](todo.md) 的传输任务协议验收改为结构化不支持（不降级、不删配置）。本轮只更新文档，未运行代码测试或上游命令，源码未提交、未 push。
- 2026-10-14：用户确认全部推荐方案（项目级配置统一经过 Pi project-trust，未信任可展示但不连接/执行；保留 keyring 存储与既有 OAuth 登录连续性，不自动明文迁移）。两项决策已固化到 [`docs/decisions.md`](decisions.md)，[`docs/todo.md`](todo.md) 已重排为 11 项剩余任务并明确入口切换前置条件；已完成 API 不重做。本轮只更新文档，未运行代码测试或上游命令，adapter/native 源码未提交、未 push。
- 2026-10-14：在独立固定基线 Pi 1.2.0 源码工作区重建 session-scoped 原生 MCP 管理协议；历史实现未恢复。定向测试通过，完整 check 被缺失的上游模型数据阻断。docs-commit 已完成契约审计。详见 [`docs/native-mcp-evidence.md`](native-mcp-evidence.md)、[`docs/todo.md`](todo.md) 和 [`docs/session-log.md`](session-log.md)。
- 2026-08-31：删除宿主专属 MCP 配置探测、兼容 imports、setup 采用流程和 CLI `init`；遗留字段被忽略，标准配置层与 token CLI 保留。已完成 typecheck、定向 UI/命令/CLI 测试和 CLI 删除命令验证；发布构建与 package/public export 验证见 [`docs/session-log.md`](session-log.md)。
