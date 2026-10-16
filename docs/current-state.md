# 当前状态

## 项目与迁移

- 项目：`pi-mcp-adapter`，版本 `2.27.1`；技术栈为 Node.js、TypeScript、Pi 扩展 API 和 Vitest。
- Pi 原生 MCP 迁移的十二项工作均已完成，包括原生管理能力、配置与信任边界、系统密钥环凭据衔接、`directTools` 持久化、面板迁移、同会话回归，以及固定版本补丁和发布产物交付。唯一详细实施顺序与恢复条件见 [`docs/todo.md`](todo.md)；适配器与 Pi 原生管理 API 的对应关系见 [`docs/native-mcp-evidence.md`](native-mcp-evidence.md) 和 [`docs/native-mcp-protocol.md`](native-mcp-protocol.md)。
- 早先因业务契约冲突而暂停的 `native-panel-status-and-live-catalog` 未重试，也未宣称完成；澄清和副作用记录保留在 [`docs/session-log.md`](session-log.md)。

## 运行与兼容边界

- Pi 原生 MCP 运行时是唯一的连接、OAuth 和工具执行方。发布入口 `dist/index.js` 只接入原生管理方，不再启动第二套适配器运行时，也不回退到旧运行时；未打补丁的 Pi 1.2.0 缺少所需管理 API 时会明确失败。
- 原生入口只注册 `/mcp-adapter`；Pi 自带的 `/mcp` 仍由 Pi 原生 MCP 扩展负责。
- 保留的旧适配器运行时源码仍位于 `src/**`，并由对应测试覆盖，但不会从 `dist/index.js` 加载，也不包含在发布包中。
- `scriptMode`、`disableProxyTool`、`autoAuth`、`trace`、`oauthDir` 和服务器级 `debug`/`trace` 在原生管理方下不生效；配置仍予保留，不会静默删除。完整用户可见边界见 [`README.md`](../README.md) 中的 “必需的 Pi 宿主版本”和“原生管理方下的行为变化” 两节。
- Pi 上游补丁以固定基线 `06a466935536f8c9bcacb2d5efc0fc021be1bdff` 和 Pi 1.2.0 为准；补丁、清单与复现方法见 [`docs/native-mcp-patch.md`](native-mcp-patch.md)。Pi 上游工作区未提交、未推送、未发布或打标签。

## 源码、启动与发布布局

- 根目录保留 `index.ts`、`config.ts`、`metadata-cache.ts`、`types.ts`、`oauth.ts` 和 `cli.js` 作为公共兼容入口；实现位于 `src/contracts`、`src/catalog`、`src/config`、`src/runtime`、`src/auth`、`src/tools`、`src/ui`、`src/commands` 和 `src/extension`。已删除 53 个未发布的根目录转发文件；内部模块直接依赖所属领域路径，不反向依赖公共聚合入口。
- `index.ts` 的静态依赖包括配置读取、元数据缓存、JSON Schema、工具表面、注册代码，以及原生管理方所需的同步密钥环和 bearer 令牌凭据适配层（`src/auth/mcp-auth.ts`、`src/auth/mcp-bearer-store.ts`）。OAuth 流程与提供方、命令、旧运行时工具、脚本执行和 UI 运行时仍通过缓存的 `import()` 延迟加载。
- 有效且完全采用延迟加载模式的元数据缓存可跳过 `session_start` 的完整运行时初始化；启动时连接、保持连接、冷缓存和 `MCP_DIRECT_TOOLS` 的既有语义保留。目录索引与 `MetadataCatalogSnapshot` 会在一次目录构建或同步中复用。
- 发布包包含五个 ESM（ECMAScript 模块）入口：包根、`types`、`config`、`metadata-cache` 和 `oauth`；Pi 扩展由 `extensions/index.js` 转发到 `dist/index.js`，命令行入口为 `dist/cli.js`。`package.json` 不发布 `src/**` 或测试目录。
- 最新 `npm pack --ignore-scripts --dry-run --json` 检查得到 25 个文件，包含构建后的 `dist`、`mcp-keyring-helper.cjs` 和扩展入口；不包含 `src/**`、`test/**`、源代码映射文件、`mcp-script-worker.mjs` 或 `app-bridge.bundle.js`。

## 测试、发布与验证结果

- 测试按 `test/unit`、`test/integration`、`test/node` 和 `test/fixtures` 分区；仓库根目录不保留测试文件或 `__tests__` 目录。
- 本机 Node `v26.11.1`：构建 interactive-visualizer 示例后，`npm run test:vitest` 为 119 个测试文件、1,350 项全部通过；随后针对本轮修改的 5 个文件、34 项测试也全部通过。
- 固定 Pi 补丁上的原生管理方定向测试为 4 个文件、57 项通过；`npm run test:public-types -- --pi-source <已打补丁的 Pi 源码目录>` 的适配器类型检查、公共产物与导出检查、声明消费者编译均通过，并同步了 18 个 `dist` 文件；`npm run test:patched-native-session -- --pi-source <已打补丁的 Pi 源码目录>` 的真实同会话测试 1 项通过。
- `npm run test:oauth` 的 141 项测试曾全部通过；仅安装生产依赖后的临时安装、公共子路径导入和命令行冒烟检查也有通过记录。详细命令及当时的验证范围见 [`docs/session-log.md`](session-log.md)。
- Pi 上游完整 `npm run check` 尚未通过：固定基线缺少生成的模型数据，另有与本次 MCP 改动无关的类型错误；不得把定向测试或 `--noCheck` 产物构建描述成完整上游检查通过。
- 最终 3 次启动基准中，源码与发布包的模块导入/主流程/总耗时中位数分别为 `437/475/1128ms` 和 `199/228/754ms`，未出现可重复的 15% 以上回退；静态启动依赖检查通过。目录基准 `npm run benchmark:catalog -- --runs 5` 中，5×100、20×100、50×100 项时，direct 与 live 共用索引的测量值分别为 `4.72/4.45ms`、`18.73/17.43ms`、`45.07/45.05ms`；旧的逐服务器索引 50×100 项对照为 `989.27ms`。一万工具搜索冷启动为 `50.28ms`，5 次热运行中位数为 `5.73ms`，结果正确。
- Windows 完整 Vitest 可能受全局配置污染、Linux 密钥环、`taskkill`、符号链接、Unix 套接字、文件权限和命令行 shebang 等平台差异影响；这些限制不代表源码布局回归，相关环境应使用针对性验证。
- `.github/workflows/ci.yml` 已改为检出固定 Pi 基线、应用仓库补丁，再运行原生管理方测试、适配器公共类型/产物检查和同会话回归。远端 GitHub Actions 尚未运行；本机通过不能代替远端持续集成结果。

## 尚待完成的交付

- 本地 `main` 有两个尚未推送的提交，较 `origin/main` 超前 2 个：`6dcb08316ee3428eecfec956ad914826acf08219`（持续集成验证调整）及其后的文档状态记录。迁移和构建安全修复的既有提交已推送。这两个新提交尚未推送，远端持续集成仍待触发。
- 在已打补丁的 Pi 1.2.0 环境重新生成发布文件时，使用 `npm run test:public-types -- --pi-source <已打补丁的 Pi 源码目录>`。不要在未打补丁的 Pi 1.2.0 下直接执行 `npm run build:public`；它会因缺少原生管理 API 类型而失败。构建脚本现会保留旧 `dist/`，但不会把该失败伪装为成功。详见 [`docs/pitfalls.md`](pitfalls.md)。
- `AGENTS.md` 和 `docs/clean-code.md` 未在本轮修改。
