# 当前状态

## 项目与迁移

- 项目：`pi-mcp-adapter`，版本 `2.27.1`；技术栈为 Node.js、TypeScript、Pi 扩展 API 和 Vitest。
- Pi 原生 MCP 迁移的十二项工作均已完成，包括原生管理能力、配置与信任边界、系统密钥环凭据衔接、`directTools` 持久化、面板迁移、同会话回归，以及固定版本补丁和发布产物交付。唯一详细实施顺序与恢复条件见 [`docs/todo.md`](todo.md)；适配器与 Pi 原生管理 API 的对应关系见 [`docs/native-mcp-evidence.md`](native-mcp-evidence.md) 和 [`docs/native-mcp-protocol.md`](native-mcp-protocol.md)。
- 早先因业务契约冲突而暂停的 `native-panel-status-and-live-catalog` 未重试，也未宣称完成；澄清和副作用记录保留在 [`docs/session-log.md`](session-log.md)。

## 运行与兼容边界

- Pi 原生 MCP 运行时是唯一的连接、OAuth 和工具执行方。发布入口 `dist/index.js` 只接入原生管理方，不再启动第二套适配器运行时，也不回退到旧运行时；Stock Pi 或缺少所需管理 API/能力的宿主会明确失败。
- 原生入口只注册 `/mcp-adapter`；Pi 自带的 `/mcp` 仍由 Pi 原生 MCP 扩展负责。
- 保留的旧适配器运行时源码仍位于 `src/**`，并由对应测试覆盖，但不会从 `dist/index.js` 加载，也不包含在发布包中。
- `scriptMode`、`disableProxyTool`、`autoAuth`、`trace`、`oauthDir` 和服务器级 `debug`/`trace` 在原生管理方下不生效；配置仍予保留，不会静默删除。完整用户可见边界见 [`README.md`](../README.md) 中的 “必需的 Pi 宿主版本”和“原生管理方下的行为变化” 两节。
- Pi 原生 MCP 补丁分别固定在 Pi 1.2.0 commit `06a466935536f8c9bcacb2d5efc0fc021be1bdff` 与 Pi 1.3.0 commit `71023aec1546d6d677a65669c5665c0927ce0dd0`；只有这两个补丁后的固定基线完成本仓库验证。两个 patch、manifest、hash 与复现范围以 [`docs/native-mcp-patch.md`](native-mcp-patch.md) 为准。Pi 上游未提交、未推送、未发布或打标签。
- 本机 managed Pi 已安装非阻断 post-update hook，并将已验证 Pi 1.3.0 patched release 作为当前 managed release；stock `1.3.0` release 和 launcher 原版备份均保留。hook 当前只登记 Pi 1.3.0 artifact；未知版本/补丁失败只警告，不影响核心更新退出状态。运行中的旧 Pi 进程仍须完全退出并重启才能加载新 release。

## 源码、启动与发布布局

- 根目录保留 `index.ts`、`config.ts`、`metadata-cache.ts`、`types.ts`、`oauth.ts` 和 `cli.js` 作为公共兼容入口；实现位于 `src/contracts`、`src/catalog`、`src/config`、`src/runtime`、`src/auth`、`src/tools`、`src/ui`、`src/commands` 和 `src/extension`。已删除 53 个未发布的根目录转发文件；内部模块直接依赖所属领域路径，不反向依赖公共聚合入口。
- `index.ts` 的静态依赖包括配置读取、元数据缓存、JSON Schema、工具表面、注册代码，以及原生管理方所需的同步密钥环和 bearer 令牌凭据适配层（`src/auth/mcp-auth.ts`、`src/auth/mcp-bearer-store.ts`）。OAuth 流程与提供方、命令、旧运行时工具、脚本执行和 UI 运行时仍通过缓存的 `import()` 延迟加载。
- 有效且完全采用延迟加载模式的元数据缓存可跳过 `session_start` 的完整运行时初始化；启动时连接、保持连接、冷缓存和 `MCP_DIRECT_TOOLS` 的既有语义保留。目录索引与 `MetadataCatalogSnapshot` 会在一次目录构建或同步中复用。
- 发布包包含五个 ESM（ECMAScript 模块）入口：包根、`types`、`config`、`metadata-cache` 和 `oauth`；Pi 扩展由 `extensions/index.js` 转发到 `dist/index.js`，命令行入口为 `dist/cli.js`。`package.json` 不发布 `src/**` 或测试目录。
- 最新 `npm pack --ignore-scripts --dry-run --json` 检查得到 35 个文件，包含构建后的 `dist`、扩展入口、README 所链接文档、固定 patch/manifest 与托管更新 hook 脚本；不包含 `src/**`、`test/**`、`node_modules/**` 或 source map。未发布 npm 包。

## 测试、发布与验证结果

- 测试按 `test/unit`、`test/integration`、`test/node` 和 `test/fixtures` 分区；仓库根目录不保留测试文件或 `__tests__` 目录。
- 本机 Node `v26.11.1`：构建 interactive-visualizer 示例后，`npm run test:vitest` 为 119 个测试文件、1,350 项全部通过；随后针对本轮修改的 5 个文件、34 项测试也全部通过。
- Pi 1.3.0 固定补丁为 49 个路径、SHA-256 `67df3bb7…54eaf33`；隔离 staging 中完整 `npm run build` 通过，输出 83 个 CLI bundle 文件。4 个 Pi owner/management 定向测试 71 项通过；adapter `test:public-types -- --pi-source <patched Pi>` 的 typecheck、5 个 public/export/package 检查和 packed consumer 通过，版本化 runner 6 项通过，adapter native bridge 定向测试 3 文件/9 项通过。fresh packed CLI + adapter 在 peer omitted、无 ancestor `node_modules` 的隔离目录中通过 RPC 冒烟：管理 API 与 18 项能力可见，built-in owner 连接 programmatic fixture 并得到 3 项 live tools，`/mcp-adapter` prompt 被处理，status/notify 可见，未产生模型推理事件，EOF 后 CLI 与 fixture 均正常退出。Pi 1.2.0 的既有 fixed patch/public consumer/same-session 验证保持不变；两版 patch/manifest hash 及可复现细节见 [`docs/native-mcp-patch.md`](native-mcp-patch.md)。
- `npm run test:oauth` 的 141 项测试曾全部通过；仅安装生产依赖后的临时安装、公共子路径导入和命令行冒烟检查也有通过记录。详细命令及当时的验证范围见 [`docs/session-log.md`](session-log.md)。
- Pi 1.3.0 隔离 staging 的 `npm run build` 已在模型数据 hydration 后通过；完整 Pi `npm run check` 与全量测试未在本轮最终状态运行，因此不宣称它们通过。此前 fixed baseline 在 hydration 前的 `check` 曾因缺失生成模型数据失败，见历史 session 记录。
- Managed 更新 hook 的 9 项 Node 测试通过；真实 Pi 1.3.0 tarball 在隔离模拟 managed install 中离线安装、API 校验与原子切换通过。本机 patched managed release 的 `--version`、18 项 management capability 检查及隔离配置下 packed CLI + adapter/local fixture RPC smoke 均通过；未运行真实 `pi update --all`。具体检查及限制见 [`docs/session-log.md`](session-log.md)。
- 最终 3 次启动基准中，源码与发布包的模块导入/主流程/总耗时中位数分别为 `437/475/1128ms` 和 `199/228/754ms`，未出现可重复的 15% 以上回退；静态启动依赖检查通过。目录基准 `npm run benchmark:catalog -- --runs 5` 中，5×100、20×100、50×100 项时，direct 与 live 共用索引的测量值分别为 `4.72/4.45ms`、`18.73/17.43ms`、`45.07/45.05ms`；旧的逐服务器索引 50×100 项对照为 `989.27ms`。一万工具搜索冷启动为 `50.28ms`，5 次热运行中位数为 `5.73ms`，结果正确。
- Windows 完整 Vitest 可能受全局配置污染、Linux 密钥环、`taskkill`、符号链接、Unix 套接字、文件权限和命令行 shebang 等平台差异影响；这些限制不代表源码布局回归，相关环境应使用针对性验证。
- `.github/workflows/ci.yml` 已改为检出固定 Pi 基线、应用仓库补丁，再运行原生管理方测试、适配器公共类型/产物检查和同会话回归。远端 GitHub Actions 尚未运行；本机通过不能代替远端持续集成结果。

## 尚待完成的交付

- 先前 Pi 1.3.0 fixed-patch 交付已按用户明确要求推送至 `origin/main`；本轮 CLI 验证、managed update hook 实现与文档已完成，按项目规则创建中文本地提交，未 push。用户授权的本机 managed install 已切换到独立 patched release，launcher 原版与 stock release 均保留；当前运行中的 Pi process 尚未重启。未执行真实 `pi update --all`、npm 发布、部署或打 tag。远端 CI 是否完成尚未核实；详细 Git 与 runtime 范围见 [`docs/session-log.md`](session-log.md)。
- 重新生成发布文件时，必须向 `npm run test:public-types -- --pi-source <已应用对应补丁的固定 Pi 源码目录>` 显式提供 Pi 1.2.0 或 1.3.0 checkout。Stock Pi 缺少原生管理 API 类型，不能用于 adapter 构建；构建脚本会保留旧 `dist/`，但不把缺 API 的失败伪装为成功。详见 [`docs/native-mcp-patch.md`](native-mcp-patch.md) 和 [`docs/pitfalls.md`](pitfalls.md)。
- `AGENTS.md` 和 `docs/clean-code.md` 未在本轮修改。
