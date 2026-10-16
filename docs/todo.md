# 待办：Pi 原生 MCP 管理增强迁移

> 状态：**迁移已完成交付，本文件保留完成记录、剩余边界和跨电脑恢复条件。** `native-management-api` 已从固定 Pi 1.2.0 基线重建，并经 docs-commit 结构化审计（见 [`docs/native-mcp-evidence.md`](native-mcp-evidence.md)），不重做。用户已确认 trust、keyring/OAuth、“暂不支持原生 2026-07-28 远程协议”与 directTools 持久化四项决策，见 [`docs/decisions.md`](decisions.md)。原“先补齐原生能力、再切换 adapter 入口”的十二项顺序（生命周期、配置/来源与 trust、keyring/OAuth 连续性、传输与请求契约、执行与交互策略、资源/提示词与 Apps 六项前置，随后 `directTools` 持久化、面板/状态栏、真实同会话回归、干净基线补丁交付、adapter Git 收尾）已全部完成；被替换的旧 `native-panel-status-and-live-catalog` 面板任务未重试，其澄清报告与副作用记录保留在 [`docs/session-log.md`](session-log.md)。
>
> 本文件是该迁移已确认计划与边界的唯一详细来源；剩余未做的能力、验证边界和恢复条件见下方“剩余边界”。工作流记录不是源码备份；每项状态以当前 adapter 文档和固定 Pi 上游工作区为准。

## 历史记录（不代表当前源码已恢复）

### `native-management-api`（历史实现未恢复；本轮按授权重建，已完成、不重做）

历史记录曾声明：在 Pi 1.2.0 源码中实现公开、有类型、可协商版本与能力的 MCP 管理接口，提供脱敏 server 快照、连接状态与目录 freshness 分离、订阅、管理动作、原生 OAuth 与结构化失败，并更新文档和定向测试。**本次核对的固定基线 `06a466935536f8c9bcacb2d5efc0fc021be1bdff` 是干净的 Pi 1.2.0 源码，未包含该实现；历史源码/补丁未恢复。本轮已按用户授权在该基线重新实现，协议细节见 [`docs/native-mcp-protocol.md`](native-mcp-protocol.md)，当前实现与 adapter 契约的审计见 [`docs/native-mcp-evidence.md`](native-mcp-evidence.md)。**

- 历史定向验证（不是本轮执行，也不证明当前基线有实现）：在 Pi 上游 `packages/coding-agent` 运行 `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/mcp-management.test.ts test/mcp-extension.test.ts`，2 个文件通过，31 passed、1 skipped。
- 历史 `npm run check` 结果：失败（exit 1），原因是缺失且未跟踪的 `packages/ai/src/providers/data/amazon-bedrock.json` 引发 model-data 类型错误；不得描述为通过。
- 历史 `git diff --check`：通过。
- 此前记录的 `D:/Code/Javascript/pi-upstream` 不是本次核实的工作区；不从该记录推断其当前状态。本次唯一上游工作区为 `/Users/cgosu/code/JavaScript/pi-upstream-native`，固定基线工作区初始干净。

#### 本轮重建与验证（2026-10-14）

- 在固定上游工作区以 `06a466935536f8c9bcacb2d5efc0fc021be1bdff` 为基线，重建 session-scoped 协议；主要实现位于 `packages/coding-agent/src/core/mcp-management.ts` 和 `src/extensions/mcp/{config,index,runtime}.ts`，从 `src/index.ts` 公开导出。保留原生 MCP owner、安全/执行 pipeline，并实现协商、发现、脱敏不可变快照、订阅、管理操作、catalog freshness、OAuth 转发和 session/attempt 失效保护。协议细节见 [`docs/native-mcp-protocol.md`](native-mcp-protocol.md)。
- 实际定向测试（在 `packages/coding-agent`）：`node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/mcp-management.test.ts test/mcp-extension.test.ts`；2 个文件通过，36 个测试通过。
- 实际执行 `npm run check`，失败于 `tsc --noEmit`。基线缺少 `packages/ai/src/providers/data/`（含 `amazon-bedrock.json`），导致 AI model catalog 类型被推成 `never` 并在 AI 与 coding-agent 测试中产生广泛错误；本次改动的 MCP 文件不在错误输出中。没有改动无关 AI 数据；`check:browser-smoke` 因前序阶段失败未执行。
- 本 API 的重建和验证不等同历史实现/历史源码恢复，也不等同 adapter 迁移完成。本轮工作区未提交、未推送；adapter 与上游两仓库的 `git diff --check` 均通过，新增未跟踪文件的 trailing-whitespace 检查也未发现问题。

## 已完成的任务与顺序（记录，不再执行）

以下顺序来自已确认的迁移计划，现全部完成；不再重复执行。**`native-lifecycle-and-offline-catalog` 至 `native-resources-prompts-and-apps` 曾是入口切换（`adapter-native-bridge-and-public-entry`）的前置条件**，已按该顺序交付，未提前切换、未用旧 runtime fallback 掩盖缺口。各项实现与验证的当前事实分别位于 adapter 源码、[`docs/native-mcp-protocol.md`](native-mcp-protocol.md)、[`docs/native-mcp-patch.md`](native-mcp-patch.md) 和 [`docs/session-log.md`](session-log.md)；本文件不复制这些细节。

### 1. `native-lifecycle-and-offline-catalog` — 原生生命周期及离线目录策略（developer-test）

- 在固定上游的原生 owner 内实现 adapter opt-in 生命周期与有效离线目录 seed/cache：lazy、eager、keep-alive、lazy-keep-alive、空闲回收、首用与冷缓存启动、并发初始化和回收后重连。复用现有管理 API，仅按需增加公开类型/能力，不改动未启用迁移策略的 stock 默认。
- 精确保留 `idleTimeout` 分钟单位、server override global、adapter 默认 10、0 禁止回收；保留无有效 cache 时既有 bootstrap 行为。持久 seed 使用版本、时间/有效期和配置有效性标记，外部缓存结构先 Result 校验，不持久化 client、执行闭包、凭据或原始敏感配置。
- 同 server 并发收敛为当前有效 attempt；活动请求不被错误回收；回收后的执行查找当前原生连接，不自动重放可能有副作用的调用。目录 `cached`/`live`/`missing` 与连接状态分离，禁用、配置替换、trust 不满足或 session 关闭使旧 attempt/计时器/订阅失效。
- Adapter 现有生命周期与缓存实现/测试只用于精确对照语义，不激活其旧运行时。
- 依赖：已完成且不重做的 `native-management-api`。

### 2. `native-config-provenance-and-trust` — 配置映射、来源与 trust（developer-test）

- 建立 adapter 配置到原生 owner 的规范化映射与来源/trust 通道，覆盖审计列举的全部 `ServerEntry`/`McpSettings` 字段的处理归属；不以静默 ignore、字段名相似或 TS 类型代替语义校验。
- 按 [`docs/decisions.md`](decisions.md)「项目级 MCP 配置统一受 Pi project-trust 控制」执行：所有项目级来源由 native owner 使用真实 Pi trust 决策门控；未信任时不启动进程、网络、headers command、OAuth 或可执行 cached tools；不得借 extension registration、自报 trusted、转写 global 或 override 绕过信任。
- 保留 global/project 来源优先级、`PI_MCP_CONFIG_MODE=exclusive`、provenance 写回目标和 URL override 清理继承凭据的语义。校验错误提供具体 Result code/message 并迁移内部直接调用方。
- 依赖：`native-lifecycle-and-offline-catalog`。

### 3. `native-keyring-and-oauth-continuity` — keyring 与 OAuth 登录连续性（developer-test）

- 为原生 OAuth owner 实现安全的 adapter keyring/既有登录适配路径，按 [`docs/decisions.md`](decisions.md)「保留 keyring 存储与既有 OAuth 登录连续性」执行：不自动写入 `mcp-auth.json`、不复制/输出旧 token、不启用旧 adapter OAuth 交互 owner；未参与迁移的 native 默认存储不被改变。
- OAuth 公共 get/inspect/update 等已发布契约继续有效并与原生 owner 使用同一安全存储语义；登录、刷新、退出和 server/session 替换遵守 session/attempt 失效保护，快照、事件、日志和错误不泄漏凭据。
- 安全复用确实不可实现时提交具体事实并澄清，不自行改成重新登录或明文存储；不读取或修改真实 OS keyring 项做测试。
- 依赖：`native-config-provenance-and-trust`。

### 4. `native-transport-auth-and-request-compatibility` — 传输、认证与请求契约（developer-test）

- 在唯一原生连接路径补齐 adapter 传输与请求契约：stdio/HTTP/socket、明确的 SSE/HTTP 选择、每请求 headers-command、bearer/env/store 来源、OAuth 参数、`literalEnv`/`pluginDataDir`、协议选择和请求 timeout。SSE/socket 不伪装成 streamable HTTP，动态签名 headers 不静态化，stock 未配置 server 的默认行为不变。
- timeout 在 adapter 毫秒与 native 单位间无静默截断、溢出或范围放宽；管理协议 v1 与远程 MCP 协议选择分开校验。
- 按 [`docs/decisions.md`](decisions.md)「本次迁移暂不支持原生 2026-07-28 远程 MCP 协议」执行：显式 `2026-07-28` pin 及当前无法等价实现的 modern `auto` 协商必须在连接/执行前返回具体、可区分的结构化不支持结果，不静默退回 legacy、不删除或改写配置。
- 发现协议库或安全契约确有冲突时记录证据并澄清，不静默删字段、降级传输或使用旧 adapter runtime。
- 依赖：`native-keyring-and-oauth-continuity`。

### 5. `native-execution-and-interaction-policies` — 执行与交互策略（developer-test）

- 将 adapter 选择、审批、结果安全及 sampling/elicitation 行为接入同一原生执行 pipeline：direct server/tool selectors、`MCP_DIRECT_TOOLS`、include/exclude、工具命名、搜索关键词、资源暴露、参数/结果策略、`approveTools`、`outputGuard`、sampling/auto-approve 和 elicitation；展示设置保留在 adapter 展示层。
- 保留 `approveTools` 的 once/session/deny/abstain 语义且与 Pi 权限/trust 同时生效；hidden exposure 不冒充目录过滤；sampling/elicitation 不默认允许、不静默关闭，也不启用旧 adapter connection owner。不新增重复脚本/代理执行 surface。
- 依赖：`native-transport-auth-and-request-compatibility`。

### 6. `native-resources-prompts-and-apps` — 资源、提示词与 MCP Apps（developer-test）

- 补齐迁移所需的原生 resources/prompts 目录元数据、动态失效和 MCP Apps UI 路径；通过公开、版本化能力由原生 owner 提供数据与操作，不假定 tool-only snapshot 或 stock Pi renderer 已有这些能力。
- 资源/提示词新增、撤回、重连及 server/session 关闭使旧数据和操作正确失效；`exposeResources` 与现有过滤规则一致；Apps bridge 不能绕过工具审批/trust。能力无法安全保留时提交具体澄清。
- 依赖：`native-execution-and-interaction-policies`。

### 7. `adapter-native-bridge-and-public-entry` — adapter bridge 与默认入口迁移（developer-test）

- 将 adapter 开发/peer 类型基线迁至 Pi 1.2.0，建立可复现的 patched 公共 API 类型消费路径，实现 native bridge 并切换默认扩展入口。仅在前序能力与契约具备后切换；保留 factory/register helper/dispose、五个公共子路径与加载边界。
- 经公开事件发现 handle，覆盖注册先后顺序，协商版本和全部必需能力；stock 1.2.0 或缺能力明确失败，不 fallback、不初始化旧连接/OAuth/script owner。生产代码不引用本机上游路径、私有模块或宿主 `dist` 内部文件。
- 保留原生 `/mcp`，注册 `/mcp-adapter`；不增加第二 MCP script/代理工具。
- 依赖：`native-resources-prompts-and-apps`（前六项能力为入口切换前置条件）。

### 8. `native-direct-tools-persistence` — 原生 directTools 持久化与面板快照字段（developer-test）

- 按 [`docs/decisions.md`](decisions.md)「保留 directTools 选择语义并扩展原生管理 API 持久化」执行：在固定 Pi 1.2.0 原生 owner 内为 `directTools` 增加可持久化配置字段与协商管理能力，由 native owner 在真实 project-trust 门控下按既有 provenance/override 语义写回配置；成功后同步当前会话 direct 选择与订阅快照。不得用 `toolExposure`、session-only policy 或 adapter 侧写文件代替该路径。
- 写回沿用现有 `McpServerConfigPatch`/`updateMcpServerConfig` 与 `saveConfig` 语义：保留默认值与 override 行为、原子写入和失败语义；`true`、工具名数组与“无 direct 工具”各自明确表达，不引入删除歧义，不改写无关字段。
- 管理操作用版本化能力协商与结构化 Result：server 不存在/被撤回、trust 不足、写回失败、会话或 attempt 失效返回可区分错误；不伪装成功、不自动重放可能有副作用的调用；stock 未使用该能力的默认行为与 `MCP_DIRECT_TOOLS` 会话覆盖语义不变。
- 以加法方式补齐面板所需快照字段且只含脱敏数据：服务器级已持久化的 direct 选择、工具级 effective exposure（含 session policy）与用于 token 估算的工具 schema 大小；不暴露 schema 内容、原始配置、传输错误或凭据。字段无法真实取得时明确不支持或澄清，不以默认值冒充。
- 依赖：`native-execution-and-interaction-policies`（session 执行策略已生效）。

### 9. `native-panel-status-and-live-catalog` — 面板、状态栏与动态目录迁移（developer-test）

- 将现有管理面板、状态栏、命令和动态目录改为 native bridge 的订阅与管理操作，保留搜索、展开、工具选择/保存、认证、重连、来源信息以及既有只读 status-event 消费者。对大文件只做必要的 provider/数据适配拆分，不整体重写 UI。
- 工具选择/保存改用上一步的原生 directTools 持久化能力与真实 provenance，不在 adapter 侧直接写配置；写回失败、trust 不足或 session 失效必须以失败结果呈现，不得显示为已保存。
- 面板/状态栏使用原生真实连接状态、catalog freshness 和 effective exposure；缓存、日志或旧 server-manager 状态不冒充 live。晚注册、动态更新、撤回和重连不遗留可执行旧条目；异步更新保留仍有效的未保存选择。
- `MCP_STATUS_EVENT` v1 保持既有字段与语义并保留只读消费者；计数只从 native 快照与 adapter 既有过滤器导出，无法精确取得时扩展协议或省略可选字段，不编造默认值。快照不含传输错误文本，面板保留可区分的失败状态展示但不展示或推测原始错误内容。
- 依赖：`native-direct-tools-persistence`。

### 10. `real-native-adapter-session-regression` — 真实同会话集成回归（developer-test）

- 提供可显式指定 Pi 源码目录的定向 runner，将真实 patched Pi native MCP extension 与 adapter enhancement 放进同一测试会话，使用本地/in-memory MCP fixture 和 faux provider，不用全 mock bridge 冒充同会话集成。
- 覆盖状态订阅、注册/发现/执行、重连、禁用/撤回、exposure、lazy/idle 并发、session 清理，以及 trust/审批和认证存储适配的关键边界；不访问生产服务或真实凭据。
- 运行上游相关 Vitest/faux-provider 定向集合和 adapter 相关类型检查；`npm run check` 的既有 model-data 阻塞不伪装成成功，不运行全量上游测试或 build。
- 依赖：`native-panel-status-and-live-catalog`。

### 11. `versioned-patch-and-public-artifact-verification` — 版本化补丁与产物验证（developer-test）

- 在 adapter 中交付版本化 Pi 源码补丁、基线/协议/能力 manifest 与最小复现说明；manifest 固定到 `06a466935536f8c9bcacb2d5efc0fc021be1bdff`，补丁包含全部修改和新增文件（含 git diff 默认不涵盖的未跟踪文件），不含凭据或机器私有数据；不复制整个 Pi 仓库。
- 在独立干净基线上实际验证 `apply --check`、真实 apply 和相关定向测试，不把当前脏上游工作区当成补丁可用的证明；按项目脚本同步 public build/dist 与发布清单并验证公开 import/类型消费者。
- 依赖：`real-native-adapter-session-regression`。

### 12. `migration-docs-and-adapter-git-delivery` — 文档与 adapter Git 交付（docs-commit）

- 核对最终 diff、真实验证和补丁可复现性，更新用户文档（patched Pi 前置条件、固定基线、补丁应用/类型产物路径、能力协商、`/mcp` 与 `/mcp-adapter` 分工、trust、keyring 连续性、生命周期和缓存语义）；`current-state`/`todo`/`session-log`/`decisions`/`pitfalls` 只保留各自唯一事实。
- 使用 adapter 仓库本地 Git 身份 `CGOSU`/`dev@cgosu.com`，只显式暂存能确认属于本次迁移的文件并创建中文 commit，保留 `.pi-graph/`、排除项及其他协作者改动；归属不明则暂停提交并说明。
- 依赖：`versioned-patch-and-public-artifact-verification`。

### 交付后的 push

用户曾明确要求“本项目 commit push”。该授权仅针对 adapter 主仓库，不能扩大到 Pi 上游、发布或部署。补丁交付和中文提交已真实完成，并在核对 adapter 当前分支、已配置 upstream、提交归属及远端状态后正常 push；未强推、未重放。**实际 commit 与 push 结果见 [`docs/session-log.md`](session-log.md)。**

## 固定架构与安全约束

- 宿主最低 Pi 1.2.0，固定上游基线 `06a466935536f8c9bcacb2d5efc0fc021be1bdff`，唯一上游工作区 `/Users/cgosu/code/JavaScript/pi-upstream-native`。stock 1.2.0 不包含本次新增的管理协议；必须协商版本和必需能力，缺失就明确失败，禁止旧 runtime fallback。
- Pi 原生 runtime 是 MCP 连接与执行的唯一 owner。只使用公开、有类型、版本化协议（经 `pi.events` 发现）；不建立第二客户端，不依赖生产私有模块或 `dist` import，只公开脱敏快照和管理操作。
- 保留原生 `/mcp`，adapter 增强命令为 `/mcp-adapter`；不注册重复 MCP script 或代理执行 surface。
- 保留权限、project trust、OAuth、错误及工具撤回语义；认证信息和凭据不可泄露。目录缓存与连接状态分开表示。项目级来源 trust 与 keyring 连续性按 [`docs/decisions.md`](decisions.md) 执行。
- 保留公共 exports、factory/register helper 与独立 config/metadata/OAuth 契约。遇到无法安全映射的业务契约或决策，先澄清。
- 上游依赖安装须用 `--ignore-scripts`；不跑全量上游 `npm test` 或 build。历史 check 失败须保持真实记录。
- 不修改全局 npm，不在 Pi 上游提交或推送，不自动部署、发布或打 tag。只在 adapter 中交付并验证补丁。

## 剩余边界（已交付但不生效或未做）

以下并非未完成的迁移任务，而是已确认的有意边界，运行时不会生效：

- `scriptMode`、`disableProxyTool`、`autoAuth`、`trace`、`oauthDir` 及 server 级 `debug`/`trace` 在 native owner 下不激活；它们保留在配置中且不静默丢弃（原因见 [`docs/decisions.md`](decisions.md)）。
- 原生 MCP client 仍只支持 Pi 1.2.0 既有的 `initialize` 时代 wire protocol；`2026-07-28` 与不可等价实现的 modern `auto` 返回结构化不支持（见 [`docs/decisions.md`](decisions.md)）。
- adapter 的旧自包含运行时模块仍在 `src/**` 并由各自测试覆盖，但不从发布入口可达；`mcp-script-worker.mjs` 与 `app-bridge.bundle.js` 已不随包发布。
- 固定 Pi 源码基线缺少 `packages/ai/src/providers/data/`，上游 `npm run check` 的 model-data 阻塞仍为真实历史限制；未生成或伪造该数据。

## 跨电脑恢复清单

1. 打开 adapter 仓库，先核对当前分支、`git status --short --branch`、目标文档及其他协作者改动；保留 `.pi-graph/`，不 reset 或覆盖。
2. 确认 `/Users/cgosu/code/JavaScript/pi-upstream-native` 仍位于固定基线且原生 MCP 改动完整、未被后续改动改变；若换电脑，核对原机器/安全备份。工作流记录不是补丁或源码文件的替代品。
3. 优先用 adapter 中已交付的补丁与 manifest 在独立干净 checkout 重建：核对 `HEAD` 为 `06a466935536f8c9bcacb2d5efc0fc021be1bdff`、工作树干净、patch SHA-256 与 manifest 一致，再 `git apply` 与 `npm ci --ignore-scripts`（详见 [`docs/native-mcp-patch.md`](native-mcp-patch.md)）。不要因未知结果重放已完成操作。
4. 如仍需重新生成发布产物，使用 `npm run test:public-types -- --pi-source <patched-Pi-checkout>`；`npm run build:public` 现已改为在 `.tmp-public-build-*` 暂存目录构建、全部成功后才原子替换 `dist/`，失败不会破坏现有生成物，但它仍需 patched Pi 类型才能成功（见 [`docs/pitfalls.md`](pitfalls.md)）。
5. 所有验证只记录本次真实执行结果；Pi 上游仍不提交、不推送。adapter commit/push 范围按授权边界核实。

## 最近一次记录

- 2026-10-16：十二项迁移任务全部完成，包括干净基线补丁/公共产物交付、文档与 adapter Git 收尾。在独立干净 checkout 上重复验证了 apply、4 文件/57 项 native 测试、public types/exports 与真实同会话回归；用户文档补齐 patched Pi 前置条件与保留/不激活边界。最终提交 `05c4a3f1023f2d0ce7458515d1782fc72370ed69` 已 push 到 `origin/main`（fast-forward，无强推）；详细命令、验证与 push 结果见 [`docs/session-log.md`](session-log.md)。
- 2026-10-15：用户确认“先不支持”原生 `2026-07-28` 远程 MCP 协议；该边界已写入 [`docs/decisions.md`](decisions.md)，并把 `native-transport-auth-and-request-compatibility` 的协议验收改为结构化不支持（不降级、不删配置），其余传输/认证/安全要求不变。本轮只更新文档，未运行代码测试或上游命令，未提交、未 push。
- 2026-10-14：用户确认 trust 与 OAuth 两项推荐方案；本轮将剩余迁移计划重排为“先补原生能力（生命周期→配置/trust→keyring→传输→执行策略→资源/Apps），再切 adapter 入口，随后面板/状态栏、同会话回归、补丁交付、Git 收尾”的 11 项任务，并把两项已确认决策写入 [`docs/decisions.md`](decisions.md)。已完成 `native-management-api` 不重做；本轮只更新文档，未运行代码测试或上游命令，未提交、未 push。

---

此 TODO 是后续恢复迁移的唯一详细来源。迁移已完成，新增实际验证或重要边界变更时更新对应唯一来源文档，并在相关记录中链接本文件，避免复制同一事实。
