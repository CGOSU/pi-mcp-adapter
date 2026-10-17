# Pi 原生 MCP 管理协议

> 状态：`pi.mcp-management` v1 及 `directTools` 持久化能力已分别移植到固定 Pi 1.2.0 和 1.3.0 源码基线，并在独立 checkout 完成 apply 与对应定向验证。协议契约相同，版本化补丁、精确支持范围及验证边界见 [`docs/native-mcp-patch.md`](native-mcp-patch.md) 和其中分别链接的两个 manifest。历史实现未恢复。本协议不重做；迁移记录见 [`docs/todo.md`](todo.md)，trust、keyring/OAuth 与 directTools 持久化决定见 [`docs/decisions.md`](decisions.md)。

## 重建依据与边界

2026-10-14，用户授权：若历史 `native-management-api` 源码无法在固定上游工作区中找到，则从 Pi 1.2.0 固定基线重新实现。检查结果：独立工作区 `/Users/cgosu/code/JavaScript/pi-upstream-native` 位于 `06a466935536f8c9bcacb2d5efc0fc021be1bdff`，`packages/coding-agent` 为 `1.2.0`，工作区干净；该基线没有历史 native-management-api 改动。因此以下是**新重建契约**，不是对历史代码或历史验证结果的恢复。

Pi 内置 MCP 扩展是连接、认证和工具执行的唯一 owner。协议只经公开 `pi.events` 发现并调用，不创建第二个 MCP client/runtime，不代理工具执行，不暴露 client、原始配置、server URL、headers、env、token、传输错误或本地配置路径。原生 `/mcp`、project trust、权限与工具 pipeline、OAuth 和工具撤回语义保持不变。管理 handle 仅属于创建它的 session；shutdown 后的旧 handle 必须返回结构化 `session-ended`，不得操作后续 session，也不得自动重放操作。

## 发现与协商

协议标识为 `pi.mcp-management`，当前版本为整数 `1`。实现导出以下常量：

- `MCP_MANAGEMENT_PROTOCOL_ID = "pi.mcp-management"`
- `MCP_MANAGEMENT_PROTOCOL_VERSION = 1`
- `MCP_MANAGEMENT_DISCOVERY_EVENT = "pi:mcp-management:discover"`
- `MCP_MANAGEMENT_AVAILABLE_EVENT = "pi:mcp-management:available"`
- `MCP_MANAGEMENT_RESPONSE_EVENT_PREFIX = "pi:mcp-management:response:"`

MCP owner 在 session 启动时通过 `pi:mcp-management:available` 发布 `{ protocol, version, available: true, capabilities }`，关闭时发布 `available: false`。消费者也可在错过通知后直接发送发现请求；发现事件由当前 session 的 MCP owner 响应。请求形状为：

```ts
{
  protocol: "pi.mcp-management";
  version: number;
  requestId: string;
  requiredCapabilities: string[];
}
```

成功或失败响应发至 `pi:mcp-management:response:<requestId>`，响应包含 `{ protocol, version, requestId, capabilities, result }`。请求 ID 必须是 1–128 个 ASCII 字母、数字、点、下划线、冒号或连字符。`requiredCapabilities` 最多 64 项，每项为 1–128 个 ASCII 字母、数字、点、下划线、冒号或连字符，首字符必须为字母或数字。有效请求 ID 下的错误协议标识返回 `unsupported-protocol`，其他请求结构错误返回 `invalid-request`；不支持的版本返回 `unsupported-version`；必需能力不全返回 `missing-capabilities` 并列出缺失能力。未知能力按不支持处理，不得静默忽略。格式无效的请求 ID 无法安全构造相关响应频道，因此忽略该请求。响应不兼容时不提供 handle。

版本 1 的能力清单为：

- `server.snapshot`
- `server.subscribe`
- `server.enable`
- `server.disable`
- `server.reconnect`
- `server.set-exposure`
- `tool.set-exposure`
- `server.set-direct-tools`
- `execution.set-policy`
- `catalog.refresh`
- `catalog.resources`
- `catalog.prompts`
- `resource.read`
- `resource.read-app`
- `prompt.get`
- `app.call-tool`
- `oauth.sign-in`
- `oauth.sign-out`

消费者可以先订阅可用性通知再发现，也可以错过通知后直接发现。拿到 handle 后，先订阅或先读取快照都不能造成状态丢失：订阅立即同步收到一份当前快照，此后收到变化；取消订阅必须幂等。session 关闭会停止通知并使 handle 失效。

## 公共结果与操作

所有协议操作返回结构化结果，不用 `null`、布尔值或异常把不同失败原因折叠：

```ts
type McpManagementResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: McpManagementErrorCode; message: string; details?: Readonly<Record<string, string | number | readonly string[]>> } };
```

版本 1 handle 提供：

```ts
interface McpManagementHandle {
  readonly protocolVersion: 1;
  readonly capabilities: readonly McpManagementCapability[];
  snapshot(): McpManagementResult<McpManagementSnapshot>;
  subscribe(listener: (snapshot: McpManagementSnapshot) => void): McpManagementResult<() => void>;
  setServerEnabled(name: string, enabled: boolean): Promise<McpManagementResult<void>>;
  reconnectServer(name: string): Promise<McpManagementResult<void>>;
  setServerExposure(name: string, exposure: McpExposure): McpManagementResult<void>;
  setToolExposure(name: string, toolName: string, exposure: McpExposure): McpManagementResult<void>;
  refreshCatalog(name: string): Promise<McpManagementResult<void>>;
  signIn(name: string, prompt: McpManagementSignInPrompt, signal?: AbortSignal): Promise<McpManagementResult<void>>;
  signOut(name: string): Promise<McpManagementResult<{ removed: boolean }>>;
}
```

`McpExposure` 复用 Pi 原生 `codemode`、`deferred`、`direct`、`hidden` 语义。配置文件 server 的 enable/disable 与 exposure 更新只写入当前 entry 的既有配置源或已存在的 project override，不自动新建 override，也不绕过 Pi 对项目配置的信任判断；extension 注册 server 的更改只作用于当前 session。无法写入配置时返回安全、可区分的结构化错误，不返回底层文件异常文本。原生配置将 `*` 解释为 toolExposure 模式，因此带 `*` 的工具名不能通过精确 `setToolExposure` 写入，返回 `unsupported-tool-name`。

OAuth sign-in 的 prompt 仅通过回调临时交互：展示 authorization URL、请求用户粘贴 redirect URL；该 URL 不进入快照或错误，不保存到 adapter 状态。取消、无 OAuth、认证失败及 session 过期分别返回可判定的错误码。sign-out 只调用原生凭据 store 与 connection 生命周期。

原生 `McpOAuthCredentialStore` 默认仍使用 agent-dir `mcp-auth.json`；stock native server 不受 adapter 影响。版本化 owner assembly 可为 opt-in adapter server 注入 per-server credential backend，由原生 store 保留 refresh lock、OAuth 交互、连接和 sign-out owner。Adapter backend 直接映射既有 `src/auth/mcp-auth.ts` keyring entry：旧 adapter URL-bound token/client registration 可供 native owner 使用，native sign-in/refresh/logout 也会更新同一记录，公开 OAuth token API 仍读写同一 keyring 记录。该适配不创建明文副本、不自动写 `mcp-auth.json`、不访问用户真实 keyring 做测试；URL 不匹配时 fail-closed，存储不可用不能伪装成未登录。Adapter 旧 OAuth flow 不会因提供存储适配而重新启用。管理 sign-in 将 store 操作绑定当前 session/server attempt，失效后拒绝迟到的写入；凭据和 OAuth state 不进入快照、事件或脱敏错误。

错误码包括 `invalid-request`、`invalid-input`、`unsupported-protocol`、`unsupported-version`、`missing-capabilities`、`session-unavailable`、`session-ended`、`server-not-found`、`server-disabled`、`server-not-connected`、`unsupported-tool-name`、`config-update-failed`、`catalog-refresh-failed`、`oauth-unavailable`、`sign-in-cancelled`、`authentication-failed`、`sign-out-failed` 和 `operation-failed`。消息必须明确但脱敏；不得包含原始传输、OAuth、配置解析、文件内容或凭据错误。

### directTools 持久化

协议 v1 通过可协商能力 `server.set-direct-tools` 暴露 native-owned 的 direct 选择持久化。`McpManagementDirectTools` 为 `boolean | readonly string[]`；`McpManagementServerSnapshot.directTools` 只在 winning native config source 明确配置该值时提供。管理 handle 的 `setDirectTools(name, directTools)` 经原生配置更新与安全写入路径，沿用来源 provenance、现有 override 和 trust 规则；成功后更新当前 session policy 与快照。server 不存在/撤回、trust 不足、配置来源不可写、输入非法、写入失败及 session/attempt 失效均以结构化 Result 表达，失败不伪装成功、不自动重放。

`setExecutionPolicy` 仍然只改变当前 session 的有效策略，不写配置；`setToolExposure` 仍写入 `toolExposure`，不会代替 `directTools` 的持久化选择。两者的既有语义不变。持久化能力分别位于 Pi 1.2.0/1.3.0 固定基线补丁中；准确 patch、manifest 与可复现 apply/consumer 验证见 [`docs/native-mcp-patch.md`](native-mcp-patch.md)。

## Built-in owner assembly 与 bundled module 边界

Adapter 的 public extension package 可能由 Jiti 加载，而 Pi 内置 MCP owner 位于 bundled CLI 的 ESM graph；两者不保证共享同一个 module instance。因此，不能依赖 `installMcpOwnerAssembly()` 内的 module-local singleton 自动被 built-in owner 读取，也不能因此创建第二套 MCP runtime。

Adapter 将 `pi.events` 传给公开 assembly installer。若提供 event bus，installer 在该 bus 上注册 assembly-request listener 并发布当前 assembly；内置 MCP factory 在每个 session start 监听 install/release 事件，并先发 request，使 adapter 在 owner 监听前或监听后安装都能收敛到同一 owner。内部 handoff 事件为 `pi:mcp-management:owner-assembly:request`、`pi:mcp-management:owner-assembly:install` 和 `pi:mcp-management:owner-assembly:release`。内置 owner 在自己的 module instance 中校验并安装收到的 assembly；释放只作用于同一 source object。冲突 assembly 仍 fail-closed，手动创建的 `createMcpExtension()` instance 不使用该内置 owner seam。

这三个 handoff 事件是 Pi 扩展内部 assembly seam，不属于公开 `pi.mcp-management` v1 discovery/capability 契约，不暴露 client 或执行入口。Adapter management bridge 若启动发现早于 owner 可用，会在 `available: true` 后重试，并以 session generation 与 pending-request identity 丢弃旧结果；公开能力清单和无 fallback 边界不变。

## 快照与 freshness

快照只含管理 UI 所需的规范化数据，且每次返回新的递归不可变副本。server 至少提供：`name`、`enabled`、`scope`、有效 server exposure、`connectionStatus`、`catalog.freshness` 和 `catalog.tools`；tool 项只含原生工具名、可选说明与 effective exposure，不包含输入 schema 或执行器。`scope` 只允许 `global`、`project`、`extension`、`unknown`，不包含路径；已有 project override 的 entry 报告有效作用域 `project`。

连接状态与目录 freshness 是独立维度：

- `connectionStatus` 为 `disabled`、`starting`、`connecting`、`connected`、`disconnected`、`needs-auth` 或 `failed`。
- `catalog.freshness` 为 `live`、`cached` 或 `missing`。
- `live` 仅表示当前连接成功且目录来自当前 live connection；断开、认证失败、连接中或禁用时，若有最后一次成功目录则为 `cached`；从未成功取得目录则为 `missing`。
- 禁用保留最近一次成功的目录作为 `cached`，但必须撤回其工具并关闭对应 connection；缓存不能用于执行，也不能伪装为 `connected`。
- server 注销/移除后从当前快照删除；不会跨 session 持久化目录。

## 原生生命周期与离线目录 seed

固定上游 MCP owner 为 adapter 的生命周期策略提供 opt-in 配置，未设置 `lifecycle` 的 stock server 继续使用原生既有启动行为。策略为 `lazy`、`eager`、`keep-alive` 和 `lazy-keep-alive`；顶层 `idleTimeout` 与 server override 均以分钟计，默认 10，server 值优先，`0` 禁止闲置回收。`eager` 在 session 启动连接并按 idle timeout 回收，`keep-alive` 启动连接并恢复断线且不做闲置回收，`lazy` 在有效目录 seed 存在时延迟连接并按 idle timeout 回收，`lazy-keep-alive` 在有效 seed 存在时延迟连接、首用后保活。间接暴露的 lazy server 在 codemode/tool_search 首次触及时连接；direct tools 必须在启动时取得 live input schema。没有有效 seed 时保留冷启动 bootstrap 行为。

持久化目录位于 agent data 的 `mcp-catalog-cache.json`，包含版本、`cachedAt`、最长 7 天的 `expiresAt`、配置 hash，以及管理快照所需的 tool name/description；配置 hash 排除 lifecycle、idle timeout、请求 timeout 和 exposure 等纯运行/展示策略，配置身份变化会使 seed 失效。外部 JSON 在导入前以结构化 Result 验证；缓存不包含 client、input schema、执行闭包、凭据或原始配置。seed 只用于 management snapshot 展示，从不注册或执行缓存工具。

活动 MCP 请求期间不会回收连接。空闲回收会使当前 attempt 及计时器失效并关闭原生连接；后续工具闭包和管理重连解析当前 server connection，冷启动、并发首用/重连共用当前 attempt。side-effectful tool call 在 session 过期后返回错误而不自动重放。disable、server 替换和 session shutdown 会取消旧 timer/attempt，迟到的异步回调不能恢复旧目录。

## 固定安全与兼容约束

- 不改变原生 `/mcp`、project trust、server 注册优先级、OAuth、权限 pipeline、工具 exposure 和撤回行为。
- native owner 仍是所有工具执行的唯一入口；快照/目录仅供管理展示，执行始终解析当前有效 connection。
- 外部请求与操作输入必须验证，失败使用有 code/message 的结构化 Result。
- 异步结果必须绑定当前 session 与 server attempt；shutdown、disable、replace 后的过期结果不得更新新状态或重新连接新 session。
- 与历史实现不兼容时，以本次已记录的版本 1 契约和用户固定约束为准；不可安全映射的 adapter 公共契约或权限/数据规则由后续任务澄清，不通过 fallback 或静默删功能处理。
- 远程 MCP wire protocol 支持边界见 [`decisions.md`](decisions.md)「本次迁移暂不支持原生 2026-07-28 远程 MCP 协议」：native owner 只实现 Pi 1.2.0 既有 `initialize` 时代协议；显式 `2026-07-28` pin 与当前无法等价实现的 modern `auto` 协商必须返回结构化不支持错误，不降级为 legacy、不改写配置。该限制不影响本管理协议 v1。

## Adapter 配置来源、字段归属与 trust

- Adapter `src/config/validation.ts` 对外部 MCP JSON 逐字段校验 `ServerEntry` 与 `McpSettings`，失败使用带 `code`、`path`、`message` 的结构化问题；错误信息不包含字段值。单个无效 server entry 会被排除并保留结构化诊断，整个文件仍可供既有配置读取兼容入口显示其他有效条目；写回和 native mapping 遇到此类诊断时拒绝继续。已发布 `config` 子路径函数签名不改。
- `src/native/config-mapping.ts` 使用编译期穷尽的字段归属表，区分 native config/lifecycle、凭据适配、执行策略、adapter presentation/observability 与后续依赖。映射保留现有来源顺序、`PI_MCP_CONFIG_MODE=exclusive` 的 sources 结果、最终覆盖 entry 的 `scope`、原始 source path 和既有 `writePath`；项目 `.agents/mcp.json` 与 `.agents/mcp/mcp.json` 按 shared-project 之后、`.pi/mcp.json` 之前合并，均保留 project scope/source/write provenance；`mergeConfigs` 在 URL 变化时仍清除继承的 URL 绑定认证。字段标记为 deferred 时只列出字段名、将该 server 标为不可连接且不输出部分 native config，并保留原字段在 adapter 源配置中，不降级为相似 native 字段。
- provenance 不含 `trusted`/`projectTrusted` 输入。`scope: "project"` 仅是来源身份，native owner 独立调用当前 `ExtensionContext.isProjectTrusted()` 门控连接、执行和配置写回；同时把位于当前 project cwd 内的配置来源路径视为 project，不能以传入 `scope: "global"` 降级。项目目录内 extension registration 也由 owner 按 extension path 归为 project；管理 API 的 exposure 写操作要求真实 trust。项目配置导入必须走带来源 provenance 的 native owner assembly/bridge，不得通过 `pi.registerMcpServer()` 把文件配置伪装成 `extension` scope。现有 `registerMcpServer` 只保留其已发布 helper 契约，不作为配置导入通道。
- 历史审计状态（2026-10-14）：当时尚未切换 adapter 入口；映射结果携带 `nativeEntrySwitchAllowed: false`、未完成任务 ID，以及 `pi-package-mcp-configs`/`agent-plugin-mcp-configs` 两类尚无来源级映射的派生配置源；`agentPluginPaths`、传输/凭据、执行策略、资源与展示等表中的 deferred 项被视为入口迁移阻塞依赖。映射计划不是 runtime，不允许部分字段映射结果触发 native server。该状态后来已由当前迁移完成；现行宿主边界见 [`README.md`](../README.md) 与 [`current-state.md`](current-state.md)。

## 本轮重建与验证（2026-10-14）

- 实现位于固定上游工作区 `/Users/cgosu/code/JavaScript/pi-upstream-native`，基线仍为 `06a466935536f8c9bcacb2d5efc0fc021be1bdff`。公共类型、发现、协商、快照与 handle 生命周期在 `packages/coding-agent/src/core/mcp-management.ts`；唯一 owner 适配在 `src/extensions/mcp/`；公共导出在 `src/index.ts`。没有修改已安装 Pi、AI provider 数据、其他项目或运行中的全局状态；上游未提交、未推送。
- 定向命令（在 `packages/coding-agent`）：`node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/mcp-management.test.ts test/mcp-extension.test.ts`；结果：2 个文件通过，36 个测试通过。
- `npm run check` 未通过：在 `tsc --noEmit` 阶段出现 AI model-data 导致的广泛 `never` 类型错误。上游基线缺少 `packages/ai/src/providers/data/`（包括 `amazon-bedrock.json`）；生成的模型类型因此失去数据，错误出现在 AI 测试及依赖它们的 coding-agent 测试。本轮没有修改或生成无关 AI provider 数据；`check:browser-smoke` 因前序 TypeScript 失败未执行。改动的 MCP 文件没有出现在本次 TypeScript 错误输出中。
- 上游和 adapter 两个工作区的 `git diff --check` 均通过；对新增未跟踪文件另检查了 trailing whitespace，未发现。此记录只证明本轮重建与上述验证，不代表 historical native-management-api 源码、历史验证或 adapter 迁移已完成；最新实现与 adapter 契约的审计结果见 [`docs/native-mcp-evidence.md`](native-mcp-evidence.md)，后续迁移顺序与入口切换前置条件见 [`docs/todo.md`](todo.md)。
