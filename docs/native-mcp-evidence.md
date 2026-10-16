# Native MCP 迁移审计证据

> 审计日期：2026-10-14。本文记录当前工作区源码证据，不复活历史实现、不替代后续测试，也不表示 adapter 迁移完成。所有路径均为仓库相对路径；内容 SHA-256 指该次审计读取的完整文件。

## 1. 工作区与验证边界

- Adapter：HEAD `98a3b7952210074ef3651af2058208e1bc00a691`；分支 `main` 跟踪 `origin/main`。当前有本任务对 `docs/current-state.md`、`docs/decisions.md`、`docs/session-log.md`、`docs/todo.md` 的改动和未跟踪 `docs/native-mcp-protocol.md`、`docs/native-mcp-evidence.md`；没有 adapter 运行时代码改动。
- Pi 上游：HEAD `06a466935536f8c9bcacb2d5efc0fc021be1bdff`，Pi `packages/coding-agent` 版本 `1.2.0`，detached HEAD。此干净固定基线上现有本轮未提交源码改动：MCP core 新文件、内置 MCP extension/config/runtime、coding-agent 公共导出、MCP 文档和两份定向测试。`packages/ai/src/providers/data/amazon-bedrock.json` 和相应 data 目录不存在；没有编辑模型数据、上游提交、推送或发布。
- 原生定向测试的实际记录：在 `packages/coding-agent` 执行 `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/mcp-management.test.ts test/mcp-extension.test.ts`，2 文件、36 测试通过。此命令在最终 MCP 源码编辑后运行；源码 SHA 见下表。
- 原生 `npm run check` 实际失败于 TypeScript 检查：固定基线缺少 `packages/ai/src/providers/data/amazon-bedrock.json`，AI model catalog 类型退化并导致 AI 及 coding-agent 测试中的大量类型错误；本轮 MCP 改动文件未出现在已观察的错误输出中。后续 `check:browser-smoke` 未执行。没有把此结果记录为通过，也没有重跑完整上游测试或构建。
- Adapter 测试只定位、未运行。上游和 adapter 的 `git diff --check` 实际均通过；未跟踪新增文件的 trailing-whitespace 检查无发现。

## 2. 可复核来源与指纹

| ID | 来源与定位 | 当前版本 / SHA-256 |
|---|---|---|
| N1 | Upstream `packages/coding-agent/src/core/mcp-management.ts`：协议类型、Result、快照、handle、discovery | HEAD `06a4669…` + `1ea1eccdec8d7ed5b334d49eb53535dd41c90f870f38d585cdf8495dac3454ad` |
| N2 | Upstream `packages/coding-agent/src/extensions/mcp/index.ts`：唯一 owner、工具注册、管理 backend、session/shutdown | HEAD `06a4669…` + `2f311baeca1f3ef305048845df8105c07a38860eab027b0b1c3dcacafb134c2d` |
| N3 | Upstream `packages/coding-agent/src/extensions/mcp/runtime.ts`：连接、catalog 状态和刷新 | HEAD `06a4669…` + `e2dec827384692f338df7cdb7c07b1133aaa0ff2248427aa2beb3a25df7b8db3` |
| N4 | Upstream `packages/coding-agent/src/extensions/mcp/config.ts`：原生配置、校验、来源、更新 | HEAD `06a4669…` + `87537507d0bce64ec707c0fe53438fe469aebe4af53a9f10b7317c38beba14d8` |
| N5 | Upstream `packages/coding-agent/src/core/mcp-servers.ts`：原生 server config、注册和校验 | HEAD `06a4669…` + `0aaad23b26f31f743bdd117754f4c871ea821279bf68f8ba5d71eccbb1602c6a` |
| N6 | Upstream `packages/coding-agent/src/extensions/mcp/oauth.ts`、`src/core/auth-storage.ts`：原生 OAuth store | HEAD `06a4669…`; SHA `7a92a0c405058929582fcd27d9e586f309281e3d4dc980a20caab5b288b050d9`, `163626f5abc34099a9afb2803d0cc49b9c66d0feacd605165e88063c328cef68` |
| N7 | Upstream `packages/coding-agent/src/index.ts`、`package.json`：公共源码导出和包入口 | HEAD `06a4669…`; `0f70e5c8da10e6b96e2ba4d725d4cc0872fecab29244307b670f9703948b0074`; package `d4231a02b6a2ccb357a8e9e420fab9c217490137ade958d4a45a12e169daad0c` |
| N8 | Upstream `test/mcp-management.test.ts`、`test/mcp-extension.test.ts` | HEAD `06a4669…`; `ff8293b312cb363e23957e75ca148dffd37b4d4a8b77ed64deb64b8ff88a7e77`; `c3a8194326656de276769bc5eefe8b03f4a1a0ae4747a6339f2ec9d96c8cc779` |
| N9 | Upstream `docs/mcp.md`、`docs/extensions.md` | HEAD `06a4669…`; `62ed6cbf5e94789549ee05a344042b35ece7a035cb86e430f2af4fdfe2502737`; `5b68cf1120619dcf76d82d3631be740fc7f7c3c16b45d88581f23fd192c442c1` |
| A1 | Adapter `src/contracts/core.ts`：`ServerEntry`、`McpSettings`、approval、catalog/panel contracts | HEAD `98a3b79…` + `c4d4a63e2a2d26c25846e733a4673056f1944b0c9192b5029873fe62628976e2` |
| A2 | Adapter `src/config/read.ts`, `merge.ts`, `load.ts`, `paths.ts`, `write.ts`：解析、来源、合并及写回 | HEAD `98a3b79…`; SHA 依序 `fcc26ff63eefd755bffac79bec12dd1e1cadd5a8c38537188c180a3231b6357b`, `349dc9139f1089ed9368857b1ae17ae49c846ba12f9f04a84dd4fa2a4fa37222`, `abfa0d13679d28bec678bd31246cd1a25ce34b6d6221327a25d9a61d6e391386`, `723bfcd5dded82407326cb97576ada4ebcd7cc89cfa5bfc7a5bdfda254fc3ddb`, `ee8eadd2446d5a17889c11636a33b652f755335cde5c4e537054003264f7369b` |
| A3 | Adapter `src/extension/initialization.ts`, `install.ts`, `src/runtime/lifecycle.ts` | HEAD `98a3b79…`; SHA `948268ddbae15ed3ea9db8c66b2bd7bbae3cbf0ea8f74dd191eb5460d1b19891`, `d7203bafaf2319a2d03f7184aa5634898124381027aa6e41252a1184c25ceea2`, `f4b37662e506c4b2b0428c9c5bc5b78fc44b73074eca6c1166b698a8132528d2` |
| A4 | Adapter `src/catalog/metadata-cache.ts`, `src/ui/mcp-panel.ts`, `src/auth/mcp-auth.ts`, `src/auth/mcp-auth-flow.ts` | HEAD `98a3b79…`; SHA `9a7e67ff585075e5d6e2fdacb62aa23c31331dedb17175cacc87c30709513090`, `2f72341b03fa7efbf57096a4c4dfeec689927c4f2939dab2c42fce227dc006d7`, `4b115e549e5d23ff7d1bd98df1a2c77cf975204c82c6cb6779c3e7208f48e9cc`, `6202a8807dd20e3bc86f9470224fde30e04f828d0100593f81f203b04fdbbb67` |
| A5 | Adapter root `index.ts`, `package.json` | HEAD `98a3b79…`; SHA `dcb635ac6163392aae66e636654a160b427f59ad0f5735b33689d5f5bbb74018`, `3487beb70c1743fc11601bb3e67790846d7971a9c39d76b466f2f2c0f36d7db6` |
| A6 | Adapter lifecycle/panel/config tests listed below | HEAD `98a3b79…`; lifecycle `a39142f522647f8389315f6a618f774a5f8aa61b259e42bd2da19c42aa65bc54`, init `af059685bde18bd337ec5d18be1924ccb95c02f3f782e48e101e82ed75ef03dd`, panel `128fad1b73417d6a773a4cd997303bd25e5b8298c1941abe0f0b7c463a372411`, config `ad239b5f8619e403fc19dd72ea2f235f178c49cb794e81c7f510fa5fafd0769f`, snapshot `46d1cfca0cdee1f6cb6fff6362ea7629d7048ccd580216fec9eba418acebf7fa` |
| A7 | Adapter `docs/native-mcp-protocol.md` | Adapter HEAD `98a3b79…` + `d48fa6da8a57b0726d7faf5135f3195554750da10c904273f0c0cc0552da0677` |
| A8 | Adapter `src/tools/tool-approval.ts`, `src/ui/session.ts`, `src/ui/app-bridge-helpers.ts` | Adapter HEAD `98a3b79…`; SHA `e67912b48781fdfe11d04a10a23d546515bb25f0b5c8ec212ebf256241ca6373`, `020bab94ebb33d3965edc9c62b4fa1e68abfe5b1da2b0fa0c582ba804af63cb4`, `c0f454e02e30a771e218f5ec41f77a5ef6a6492f2d79834842617d016048cdd5` |
| A9 | Upstream `packages/coding-agent/src/core/auth-storage.ts`, `core/extensions/types.ts` | HEAD `06a4669…`; SHA `163626f5abc34099a9afb2803d0cc49b9c66d0feacd605165e88063c328cef68`, `cb54c7a4fedb3473bb995694bbc1f2988c144fb0b802bfd1b656816bc25d0f25` |
| A10 | Adapter `src/extension/status.ts`, `src/contracts/status.ts`, `src/runtime/server-manager.ts`, `src/tools/direct-tool-catalog.ts` | Adapter HEAD `98a3b79…`; SHA `32d2713b07f8a3673a1aa70e5fc3f74bc9cb424945e1d1b1b92dc9d8c160603c`, `b01b4299653a7aebdaec54d41753dae655734d6081e7beb8933a916e8a539918`, `d40e2cadfe1425a8a5e5ce6a8287442290da8bddd86a24a7dcfc367f60b8413f`, `b5b8e1a36bc0c0afd00d62950d57ec9cb0f1414c3a951041e5874d823c695da9` |
| N10 | Upstream `packages/coding-agent/src/extensions/mcp/resources.ts`, `packages/mcp/src/protocol/types.ts` | HEAD `06a4669…`; SHA `0ac0b965b123d22ceeadd64b62b53d9cf81e072898d21ea81888e840b51e02b5`, `87de9c4635ac1915abc17c981768e9d2d87a2c95404f3910eb5692a7b9f50f77` |

## 3. 已重建 native API：当前事实

1. **协议/发现。** N1:4–8、115–152、411–495 定义 `pi.mcp-management` v1、availability/discovery/response 事件、required-capability 协商和结构化错误；事件注册在 Pi 共用 `pi.events`。能力缺失、错误版本/协议和不可用 session 均明确失败。测试 N8 `test/mcp-management.test.ts:125–160,285–331` 覆盖先后时序、版本/能力/格式错误。
2. **公开快照与句柄。** N1:24–113、171–357 只复制允许公开的字段并冻结 snapshot 树；字段是 server 名称、enabled/scope/exposure/连接状态及 `live|cached|missing` catalog 和工具名/描述/effective exposure，不包含原始配置、client、OAuth secrets 或 transport 错误。handle 通过 active predicate、close 和 unsubscribe 绑定 session；操作异常转为脱敏 Result。
3. **单一原生 owner/执行面。** N2:406–478 的注册工具闭包继续使用原生 `McpServerConnection`，检查当前 owner/连接与 enabled 状态；管理 backend 位于同一个 `createMcpExtension` 状态闭包 (N2:880–1130)。没有第二客户端或返回 runtime client 的公开 API。Pi 原生 `pi.registerMcpServer`/`getMcpServers` 与 `mcp_servers_change` 注册契约在 `packages/coding-agent/src/core/extensions/types.ts:738–748,1894–1900`，由内置 MCP 扩展在 N2:364–378,1540–1578 消费。
4. **目录 freshness/取消。** N2:118–131,586–642,880–914,1422–1452,1540–1595 保存 server-attempt 标识和数据-only catalog；disable、replace、session 关闭会撤回/隐藏旧工具并 abort 对应 attempt。N3:138–217,297–344,370–465 只有连接且最近列表成功时才报告 catalog live；开始重连/断开/关闭会清除 live 标记。失败 refresh 保留上一成功工具数组。N8 `mcp-management.test.ts:333–455,507–547`、`mcp-extension.test.ts:514–535` 覆盖这些状态。
5. **管理与 OAuth。** N2:918–1130 的 backend 将 enable/disable、reconnect、server/tool exposure、catalog refresh、OAuth sign-in/out 委派给原生 owner；extension server exposure/enable 为 session-only，配置 server 通过原生 `updateMcpServerConfig` 更新。OAuth 使用原生 `signInMcpServer`、`McpOAuthCredentialStore` 和 `connection.signOut`，sign-in 绑 session/attempt abort (N2:722–797,1034–1107)。N6 `oauth.ts:140–220` 显示原生默认 credential backend 是 agent-dir `mcp-auth.json`；Pi `FileAuthStorageBackend` 创建文件使用 mode `0600` (N6 对应 `src/core/auth-storage.ts:1–120`)。这不是 adapter OAuth keyring 存储的同一契约。
6. **发布状态。** N7 `packages/coding-agent/package.json:1–35` 版本为 `1.2.0`，根 runtime/types 入口指向 `dist/index.js`/`.d.ts`；固定源码基线没有本协议，本轮只在源码 `src/index.ts:233–245` 加导出，未运行 build、未更新/验证 dist、未发布，也未检查 npm registry 上的包体。因此源码改动本身尚不能证明消费者已经获得 API；adapter 必须要求 patched host，或在后续交付时明确一种可复现构建/分发途径。

## 4. Adapter 全部配置字段盘点与入口事实

`A1 src/contracts/core.ts:108–178` 的 `ServerEntry` 字段（全部列出）：

- 传输/认证：`command`, `args`, `socket`, `env`, `cwd`, `url`, `headers`, `requestHeadersCommand`, `auth`, `bearerToken`, `bearerTokenEnv`, `bearerTokenStore`, `oauth`, `httpTransport`, `literalEnv`, `pluginDataDir`。
- lifecycle/请求/执行暴露：`lifecycle`, `idleTimeout`, `requestTimeoutMs`, `exposeResources`, `directTools`, `toolPrefix`, `includeTools`, `excludeTools`, `searchKeywords`, `approveTools`。
- 状态/协议/控制：`debug`, `trace`, `protocolVersion`, `disabled`。

`A1 src/contracts/core.ts:228–299` 的 `McpSettings` 字段（全部列出）：
`toolPrefix`, `showStatusIcon`, `mcpFooterStatus`, `notifyOnStartupConnect`, `agentPluginPaths`, `idleTimeout`, `requestTimeoutMs`, `directTools`, `strictDirectToolArguments`, `directToolResultDetails`, `warnOnLargeDirectTools`, `scriptMode`, `toolResultRendering`, `collapsedResultLines`, `approveTools`, `disableProxyTool`, `freezeDirectTools`, `autoAuth`, `sampling`, `samplingAutoApprove`, `elicitation`, `outputGuard`, `trace`, `authRequiredMessage`, `oauthDir`。

- Adapter public compatibility entry 是 root `index.ts` re-export `src/extension/install.ts`；其中 `createMcpAdapter(options)`、`registerMcpServer({ pi, name, definition })` 和 dispose 类型位于 A3 `src/extension/install.ts:1081–1105`。`package.json` 发布 ESM/types 入口 `.`, `./types`, `./oauth`, `./config`, `./metadata-cache`；Pi 加载入口为 `./extensions/index.js`。这些 factory/helper 与 subpath 属于迁移不变量，不可因 bridge 改名而移除。
- A2 `src/config/paths.ts:32–109` 同时读取标准 global/project MCP 配置、`.agents` global sources、Pi global/project 配置；优先级由 A2 `src/config/load.ts:12–62` 顺序合并，`PI_MCP_CONFIG_MODE=exclusive` 只读 Pi global。provenance 保留 kind/path (A2 `config/write.ts` `getServerProvenance`)；配置 override 中 URL 改变会删除继承的 URL 绑定 credentials (A2 `config/merge.ts:12–74`)。
- Adapter `readValidatedConfig` 最终由 `validateConfig` 将 settings 作类型断言，并只要求每个 server entry 是 object (A2 `config/read.ts:12–45`)；这不是 `ServerEntry`/`McpSettings` 全字段运行时 schema。不要把 TS 接口当作不可信 JSON 已受完整校验。
- Trust 差异：adapter `initializeMcp` 以 `ctx.cwd` 调 `loadMcpConfig`，A3 `src/extension/initialization.ts:108–130` 未传 Pi project-trust 决策；A2 `getConfigSources` 会包含项目共享 `.mcp.json` 和 `.pi/mcp.json`。原生 N4 `loadMcpConfig({ agentDir,cwd,projectTrusted })` 仅在 `projectTrusted` 时读取 `.pi/mcp.json`，built-in caller N2:1678–1680 传 `ctx.isProjectTrusted()`。**Fact:** 两方输入来源和 trust gate 不等价。**Blocking product/security question:** adapter 项目/shared config 的现有调用者是否必须继续在 untrusted project 中可见/生效？不得直接绕开 native trust 或静默丢失这些来源。
- Adapter 另公开 `MCP_STATUS_EVENT` v1 read-only snapshot：`status`, tool/resource counts, disabled/failed time, aggregate counts (A10 `contracts/status.ts:1–31`, `extension/status.ts:12–95`)；`createMcpPanel` 使用 adapter config、cache、provenance 和 callbacks (A4 `ui/mcp-panel.ts:151–337,1015–1025`; `commands/handlers.ts:630–712`)。迁移面板时不能仅替换数据读取而丢掉既有 status-event 消费者。
- Adapter `registerMcpServer({pi,name,definition})` 建立 adapter 内 runtime registration，返回异步 `dispose()`，直接工具注册在初始 sync 后冻结，runtime entries 被设为 proxy-only (A3 `install.ts:210–222,1081–1105`)。Pi 的 `pi.registerMcpServer(name, config)` 是 extension registry、配合 `unregisterMcpServer`/`mcp_servers_change` 由内置 owner 消费 (N2, N5)。表面名字相似，不代表 registration 生命周期、类型和返回契约相同。

### 4.1 字段映射摘要（覆盖上列全部字段）

| Adapter fields | 原生近似能力及差距（当前事实） |
|---|---|
| `command`, `args`, `env`, `cwd` | native stdio server config 有同名项；值解析细节仍须逐项对照，不能仅凭名字认定完全兼容。 |
| `url`, `headers`, `oauth` | native streamable HTTP / headers / OAuth 有相邻能力；原生 OAuth schema 和 storage 与 adapter 不同，见 C2/C4。 |
| `socket`, `httpTransport`, `requestHeadersCommand` | native server config 未见等价 socket 或每请求 headers-command；legacy SSE 明确拒绝。 |
| `auth`, `bearerToken`, `bearerTokenEnv`, `bearerTokenStore` | native 有 provider-token auth、OAuth 和 header auth，但 token source / keyring / env-contract 不等价。 |
| `lifecycle`, `idleTimeout`, `requestTimeoutMs` | native 有 per-server request timeout (seconds)，没有当前 API lifecycle 策略；单位/范围与 adapter (milliseconds, global/per-server) 需要转换决策。 |
| `exposeResources`, `directTools`, `toolPrefix`, `includeTools`, `excludeTools`, `searchKeywords`, `approveTools` | native exposure 与 toolExposure 是部分可表达，不覆盖同一 direct selector、resource gating、目录筛选、ranking keywords、命名规则、自定义 per-tool approval 契约。 |
| `debug`, `trace`, `disabled` | native 有 server 状态/日志和 `enabled`；`disabled` 需要反向映射为 `enabled: false`，adapter debug/metadata trace 没有已确认等价。 |
| `pluginDataDir`, `literalEnv`, `protocolVersion` | 无已核实的原生等价公共字段。 |
| `McpSettings.toolPrefix`, `showStatusIcon`, `mcpFooterStatus`, `notifyOnStartupConnect` | adapter UI/命名/启动提示设置；原生 `/mcp` 和工具命名路径不同，无一一公共字段映射。 |
| `agentPluginPaths`, `scriptMode`, `disableProxyTool` | adapter plugin loader / script / proxy surface；原生 stock MCP extension 无同语义 adapter config。 |
| `idleTimeout`, `requestTimeoutMs`, `freezeDirectTools` | lifecycle/cache 与启动/请求策略；native API 尚未实现生命周期迁移。timeout 单位和粒度有差异。 |
| `directTools`, `strictDirectToolArguments`, `directToolResultDetails`, `warnOnLargeDirectTools` | native direct exposure 只部分近似；参数校验、结果细节和 large-tool advisory 没有已核实的一一映射。 |
| `toolResultRendering`, `collapsedResultLines`, `showStatusIcon`, `mcpFooterStatus` | adapter presentation settings；不能把它们视作 native server setting。 |
| `approveTools`, `autoAuth`, `sampling`, `samplingAutoApprove`, `elicitation` | approval/auth interaction 和 protocol handlers 的业务/安全行为；不可静默关闭或用 native general trust 冒充，见 C6/C7。 |
| `outputGuard`, `trace`, `authRequiredMessage`, `oauthDir`, `notifyOnStartupConnect`, `warnOnLargeDirectTools` | adapter output safety、metadata telemetry、认证指引、旧 credential import 与 UI 设置；本轮未发现同契约 native 管理字段。 |

## 5. 核心映射差距

| ID / 分类 | 证据及差异 | 后续决策/验证边界 |
|---|---|---|
| C1 conflict — project trust/config provenance | Adapter 多来源/provenance 与 native 仅 global + trusted `.pi/mcp.json` 不等价 (A2, N4)。 | 明确 untrusted project/shared config 的既有授权语义；然后决定受信导入、明确 opt-in 还是阻塞迁移。 |
| C2 conflict — OAuth credential continuity | Adapter `src/auth/mcp-auth.ts` 默认 OS keyring，`oauthDir`/`MCP_OAUTH_DIR` 仅影响 legacy import；native `McpOAuthCredentialStore` 默认 agent-dir `mcp-auth.json` 文件 backend。Adapter 另公开 token get/inspect/update subpath (A4、root `oauth.ts`)。 | 确认要否无中断保留现有登录，以及允许的安全迁移方式；禁止记录/复制 token。新 native sign-in/sign-out 本身已复用 Pi owner，不解决旧 credential store continuity。 |
| C3 conflict — transport/config subset | Adapter `ServerEntry` 支持 Unix socket、强制 SSE/HTTP transport、`requestHeadersCommand`；native `McpServerConfig` 只有 stdio 和 streamable HTTP；`validateMcpServerConfig` 明确拒绝 `type: "sse"`。native `headers` 可插值环境变量/命令表达式，但不等同每请求的可信签名命令。N5 `core/mcp-servers.ts:80–150,248–304`；A1。 | SSE、socket、动态签名 headers 的既有使用者/兼容程度尚未盘点。不得把它们静默转换成 streamable HTTP 或静态 headers；列为需要证据或产品决策的映射问题。 |
| C4 conflict — server auth/credentials | Adapter 提供 `auth: "bearer"|"oauth"|false`、token/env/keyring 和多种 OAuth 参数/导出；native HTTP config 为 `headers`、`oauth?: McpOAuthConfig` 或 `auth: { provider }`，并限制 project `auth.provider`。N5、N6、A1、A4。 | 公共字段与 credential 注入路径不等价；结合 C1/C2 核实是否允许 token re-auth、Pi provider token 绑定及项目 auth 规则。 |
| C5 fact — lifecycle/cache not migrated | Adapter `lifecycle`: 默认 `lazy`；`eager` 在启动连接；`keep-alive` 从启动即健康检查；`lazy-keep-alive` 首次连接后加入 keep-alive。`idleTimeout` 分钟，per-server override global；global default 10，0 禁止回收。`startupServers` 在没有 cache 文件时会 bootstrap all configured servers (A3 `initialization.ts:213–260,706–714`)；后续使用有效 metadata cache 才可跳过普通 lazy startup。A4 cache 为 version 1、最高 age 7 天并用 config hash 检查 (A4 `metadata-cache.ts:20–90`)。Pi 本轮新 API 的 catalog cache 是 session/server attempt 内 memory data，不是 adapter 持久 seed (N2/N3)。 | 下一阶段应单独迁移策略，默认未配置时保留 stock Pi；先验证真实 lazy/eager/keep-alive 首用/缓存效果及活动请求，不按模式名称猜测。不得把 memory cached 当 persistent seed，也不得将 cached status 报成 live。 |
| C6 conflict — tool selection/approval/execution | Adapter 的 `directTools` 支持 boolean、server/tool selectors 和 `MCP_DIRECT_TOOLS`；`includeTools`/`excludeTools` 真正过滤目录候选，`searchKeywords` 只改变 `mcp({ search })` 排序，`toolPrefix` 控制 adapter 工具名；`approveTools` 通过 `MCP_TOOL_APPROVAL_REQUEST_EVENT` 提供 once/session/deny/abstain gate。Native 对应能力是 exposure=`codemode|deferred|direct|hidden` 及精确/通配 `toolExposure`；不是同样的 include/exclude、命名或自定义审批契约 (A1、A4、A8、N5、N2)。**后续核实（2026-10-16）：原生 `setExecutionPolicy` 只更新当前 session（`McpManagementExecutionPolicy.directTools`），持久化的 `setToolExposure` 写入 `toolExposure`；`effectiveMcpToolExposure` 中 direct 选择优先，且 `McpServerConfigPatch`/`updateMcpServerConfig` 只写 `enabled`/`exposure`/`toolExposure`——两者与面板既有 `directTools` 保存语义都不等价。** | 不能把 hidden exposure 当工具过滤，也不能假定 Pi 的 general trust/permissions 等价于 adapter per-tool approvals。用户已确认（2026-10-16）：保留 `directTools` 选择语义，由 native owner 在真实 trust 与 provenance 门控下新增持久化能力；唯一决定见 [`decisions.md`](decisions.md)，实现见 [`todo.md`](todo.md) `native-direct-tools-persistence`。需保留的 selector、approval 和脚本/代理行为仍映射到同一 native execution pipeline。 |
| C7 conflict — sampling/elicitation | Adapter 有 `McpSettings.sampling`, `samplingAutoApprove`, `elicitation`；`initializeMcp` 注册 MCP sampling/elicitation handler。当前 coding-agent 原生 MCP extension 没有消费这些 adapter 设置/等价 server setting 的调用位置；Pi MCP package 暴露协议类型不证明内置 owner 行为等价 (A1、A3；`packages/mcp/src/protocol/types.ts`)。 | 是否必须迁移以及具体批准/交互策略未确认。按未支持能力处理；不得默认为安全允许或静默关闭。 |
| C8 mixed — resources/prompts/Apps/UI | Adapter cache/panel 管 tools、resources、prompts；`ServerEntry.exposeResources`，prompt commands、`@modelcontextprotocol/ext-apps`、MCP App `uiResourceUri`/iframe bridge 均存在 (A1、A4、A5、`src/ui/session.ts`)。Native MCP extension 支持 resource tools 和 prompt commands，但新 management snapshot/catalog 只列 tools (N2, `resources.ts`, `mcp.md`)；native docs 明确 `ui://`/`text/html;profile=mcp-app` resources 不 render (N9)。 | tools catalog 协议不覆盖 resources/prompts 的 adapter UI 状态。MCP Apps 的用户路径没有 stock Pi 等价实现，需单独决策并验证 patched host renderer，不可由 tool snapshot 推导。 |
| C9 conflict — transport protocol version | Adapter `protocolVersion` 可选 `legacy|auto|2026-07-28`；native config 类型未暴露 per-server 该 selector，native connection 使用自身 MCP client 协商 (A1、N3、N5)。 | 已由用户确认（2026-10-15）：本次迁移暂不支持原生 2026-07-28 远程协议，显式 pin 与不可等价实现的 modern `auto` 返回结构化不支持；唯一决定见 [`decisions.md`](decisions.md)。不要把请求方管理协议 v1 与远程 MCP server 协议版本混为一谈。 |
| C10 inference — public API distribution | Native 源码 `src/index.ts` 增加导出，但 `packages/coding-agent/package.json` 版本仍 1.2.0、发布根指向 dist；本轮未 build、未核查公共 npm 包或打包 patch。Adapter 现有开发/peer 类型基线仍以 0.84.1 family 为主 (A5)。 | 最终必须规定 adapter 对 patched Pi 1.2.0 的安装/分发路线，干净 baseline apply + public types/import 验证；不要仅靠源码目录 API 就声称已可发布。 |

## 6. 测试位置与运行状态

| 范围 | 定位与覆盖 | 本轮结果 |
|---|---|---|
| Native 管理协议 | N8 `packages/coding-agent/test/mcp-management.test.ts`：事件发现/协商、输入异常、冻结脱敏 snapshot、订阅、exposure、refresh/failure/cache、OAuth、session shutdown/过期 handle。 | 实际运行：2 个文件/36 项中的本文件通过。 |
| Native owner/runtime | N8 `packages/coding-agent/test/mcp-extension.test.ts:514–535`：成功/失败 catalog refresh 以及保留上次工具；同文件其余原生 MCP 回归。 | 同一实际定向命令中通过。 |
| Adapter lifecycle/catalog | `test/integration/runtime/lifecycle-lazy-keep-alive.test.ts:531–689` 和 `lifecycle-lazy-keep-alive-init.test.ts:140–486`：idle=0、plain lazy idle shutdown、keep-alive backoff/reconnect、首用、bootstrap、缓存与并发收敛。 | 本轮只定位，未运行。 |
| Adapter panel/config | `test/integration/ui/mcp-panel-exclude-tools.test.ts:10–168`、`test/integration/config/exclusive-config.test.ts:18+`、`test/unit/config/config-loading-snapshot.test.ts`。 | 本轮只定位，未运行。 |
| Adapter auth/approval/protocol behavior | `test/node/auth/oauth-public-api.test.ts`、`test/unit/auth/oauth-handler.test.ts`、`test/unit/tools/tool-approval.test.ts`、`test/integration/runtime/server-manager-http-auth.test.ts`、`server-manager-sampling.test.ts`、`test/integration/runtime/elicitation-sdk-integration.test.ts`、`test/integration/extension/init-elicitation.test.ts`。 | 本轮只定位，未运行。 |

## 7. 必须在后续实现前解决/核实的问题

1. **配置来源与 trust：** 已由用户确认（2026-10-14）：项目级来源统一经过真实 Pi project-trust，未信任只可脱敏展示、不连接/不执行；唯一决定见 [`docs/decisions.md`](decisions.md)，字段级实现见 [`docs/todo.md`](todo.md) `native-config-provenance-and-trust`。
2. **OAuth continuity：** 已由用户确认（2026-10-14）：保留 adapter keyring 存储与既有登录连续性，不自动复制旧凭据到明文文件；唯一决定见 [`docs/decisions.md`](decisions.md)，实现见 [`docs/todo.md`](todo.md) `native-keyring-and-oauth-continuity`。
3. **不支持的 transports/auth：** 实际用户是否依赖 socket、SSE、每请求 `requestHeadersCommand`、静态 bearer/keyring tokens 或旧 protocol pin？逐项盘点后明确实现策略，不能仅按字段名字 fallback。
4. **安全策略：** 是否必须保留 adapter `approveTools` 的 once/session/deny gates、sampling-auto-approve 和 elicitation UI 行为？必须决定 adapter 自定义审批如何与 Pi permissions/trust 同时生效，不得相互绕过。
5. **UI/catalog contract：** MCP Apps 是否属于迁移必须保留的用户路径？若属于，需另行扩展 patched host 的 UI resource renderer/bridge 与动态 resource/prompt metadata，不属于当前 tool-only snapshot 的隐含能力。
6. **selection/timeout semantics：** 明确 include/exclude 和 direct server/tool selectors 与 `toolExposure` 的 precedence、resource filtering，以及 requestTimeout 的单位转换；筛选必须不误暴露隐藏工具。
7. **配置校验：** adapter 当前 `validateConfig` 仅 shallow-check，未来协议/bridge 对外部输入需用结构化 Result 并迁移所有直接调用方；不能把 TS interface 直接作为 trust boundary。
8. **发放方式：** 明确 patched Pi 源码补丁应用者怎样构建 coding-agent 包/类型，并在干净固定基线实测 apply、public import 和 adapter peer/type；本轮没有执行上述交付检查。

## 8. 交接结论

- API 当前成果可作为后续桥接基础；本审计没有发现需要重做协议实现的理由，也没有授权改变未确认的业务或安全契约。
- 本报告的 C1–C10 与问题 1–8 已纳入当前迁移计划；其中问题 1（trust）、问题 2（OAuth）与 C6 的 `directTools` 持久化范围已由用户确认为固定约束，唯一决定见 [`docs/decisions.md`](decisions.md)。剩余实施顺序、依赖和入口切换前置条件以 [`docs/todo.md`](todo.md) 为唯一详细来源；未解决的问题保留为对应任务内的明确问题，而不是削减 scope。
- 最终整合边界：继续保留独立固定 Pi 工作区；在 adapter 仓库交付版本化源码补丁和 manifest，并在 clean pinned baseline 验证。不要把整个 Pi 源码复制进 adapter，也不要将本次工作描述为所有 TODO 已完成。