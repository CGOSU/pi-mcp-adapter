# 暂停待办：Pi 原生 MCP 管理增强迁移

> 状态：**暂停，仅保存待办；本轮没有恢复开发。**
>
> 本文件是该迁移的唯一详细待办来源。换电脑继续前先核对下方的源码/补丁是否已安全转移；工作流记录不是源码备份。

## 已完成的前置成果（勿重做）

### `native-management-api`

在 Pi 1.2.0 源码中实现公开、有类型、可协商版本与能力的 MCP 管理接口：原生 MCP 扩展通过 `pi.events` 发布 session-scoped 管理 handle，并提供脱敏 server 快照、连接状态与目录 freshness 分离、可取消订阅、启停/重连、server/tool exposure、目录刷新、原生 OAuth 操作和结构化失败；禁用后保留最近成功目录并标为 cached。更新了 MCP/extension 文档及定向测试。

- 关键取舍：handle 留在原生扩展中复用唯一连接 owner 的 session/attempt 和管理动作；不暴露 client、不建立第二 runtime。目录 freshness 独立于 live connection，错误映射不泄露原始配置或传输信息。
- 历史定向验证（不是本轮执行）：在 Pi 上游 `packages/coding-agent` 运行 `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/mcp-management.test.ts test/mcp-extension.test.ts`，2 个文件通过，31 passed、1 skipped。
- 历史 `npm run check` 结果：失败（exit 1），原因是缺失且未跟踪的 `packages/ai/src/providers/data/amazon-bedrock.json` 引发 model-data 类型错误；不得描述为通过。
- 历史 `git diff --check`：通过。
- 最近已知保存位置：`D:/Code/Javascript/pi-upstream`，其中 Pi 源码改动尚未提交或推送。**本轮只核对了 adapter 仓库，没有重新核实该上游工作区当前状态。** 在另一台电脑上，不能仅凭工作流记录认为这些源文件已经同步；继续前必须核对原电脑工作区/备份，安全转移完整修改或从可验证补丁恢复，不能 reset、覆盖或重放未知副作用。

## 待完成任务（保持以下顺序）

### 1. `native-lifecycle-policy` — 原生生命周期及离线目录策略

- 先核对 adapter `src/contracts/core.ts`、`src/runtime/lifecycle.ts` 与相关测试，确认实际现有语义；若和预期冲突，先澄清，不猜测。
- 将 adapter 的 `lazy`、`eager`、`keep-alive`、空闲回收及带版本/有效性标记的离线目录 seed/cache 交由 Pi 原生 owner 执行。
- adapter 明确策略：`idleTimeout` 单位为分钟，默认 10；0 表示禁止回收。未配置新策略的原生 server 保持 Pi 原有默认。
- 回收后工具必须通过当前原生连接执行，不得保留指向已关闭 client 的执行器，也不得自动重放可能有副作用的调用。缓存不能冒充实时连接状态。
- 增补覆盖策略、并发初始化、空闲回收后重连、缓存有效性和 session 清理的针对性测试。
- 依赖：已完成且不重做的 `native-management-api`。

### 2. `adapter-native-entry` — 默认入口迁移

- 将 adapter 开发依赖和最低 peer/类型基线迁至 Pi 1.2.0；实现 native bridge/install 并迁移默认扩展入口。
- 经公开事件发现管理 handle，协商协议版本与必需能力。能力缺失时明确失败；不 fallback 到旧 runtime，不初始化旧 `server-manager`、OAuth owner 或 script worker。
- 保留原生 `/mcp`，增强管理入口使用 `/mcp-adapter`；不增加重复 MCP script 或代理执行 surface。
- 保持现有公共 exports、factory、register helper 签名及独立 config/metadata/OAuth 入口。权限、trust、配置字段或已发布契约无法安全映射时先澄清，不删功能规避错误。
- 依赖：`native-lifecycle-policy`。

### 3. `native-panel-catalog` — 面板、状态栏与目录

- 将现有管理面板、状态栏及动态目录改为订阅并调用 native bridge；保留搜索、展开、工具开关、保存、认证、重连等主要交互。
- 使用原生真实状态、`live`/`cached` 目录及 effective server/tool exposure 和持久化；不能从缓存或日志推断连接状态。
- 覆盖晚注册、工具新增/撤回、重连及异步更新期间未保存的用户选择，避免遗留过期工具或静默丢失选择。
- 需要拆分数据 provider 时仅做局部高内聚改动；完整读取实际触及的大文件并对当时版本做结构审阅。测试关注状态流转和数据一致性，不测试纯文案/样式。
- 依赖：`adapter-native-entry`。

### 4. `native-integration-regression` — 真实同会话集成回归

- 提供可显式指定 Pi 源码目录的定向 runner；把真实 patched Pi MCP extension 与 adapter enhancement 放进同一测试会话，使用本地/in-memory MCP fixture 和 faux provider。
- 覆盖状态订阅、server 注册/发现/执行、重连、禁用、撤回、exposure、idle/lazy 并发和 session 清理。
- 不得用全 mock bridge 冒充端到端结果；不能访问生产服务或使用真实凭据。缺源码或缺补丁时明确失败。
- 仅运行相关定向检查；如实记录失败/跳过与环境限制，不跑全量上游 `npm test` 或 build。
- 依赖：`native-panel-catalog`。

### 5. `patch-docs-delivery` — 补丁、文档和 adapter 提交

- 在 adapter 仓库交付版本化 Pi 源码补丁和基线/协议 manifest，完整包含所有必要修改和新增文件；基线为 `06a466935536f8c9bcacb2d5efc0fc021be1bdff`。
- 在独立干净基线上实际验证补丁可应用，不把带有本地修改的上游目录当成干净基线。
- 按项目实际脚本同步 public build/dist 和发布文件清单；文档准确说明 patched Pi 前置条件、`/mcp` 与 `/mcp-adapter` 分工、生命周期、缓存、认证和未迁移事项。
- 只为本任务文件创建中文 adapter commit；不提交 Pi 上游，不部署、不发布、不打 tag。保留 `.pi-graph/` 与其他协作者改动。
- 依赖：`native-integration-regression`。

### 交付后的 push

用户曾明确要求“本项目 commit push”。该授权仅针对 adapter 主仓库，不能扩大到 Pi 上游、发布或部署。待补丁交付和中文提交真实完成后，才核对 adapter 当前分支、已配置 upstream、提交归属及远端状态，再决定是否需要正常 push；已推送不重放，目标或结果不确定时停止，不强推、不猜测目标。**本轮未 push，也未创建提交。**

## 固定架构与安全约束

- 宿主最低 Pi 1.2.0，固定上游基线 `06a466935536f8c9bcacb2d5efc0fc021be1bdff`。stock 1.2.0 不包含本次新增的管理协议；必须协商版本和必需能力，缺失就明确失败，禁止旧 runtime fallback。
- Pi 原生 runtime 是 MCP 连接与执行的唯一 owner。只使用公开、有类型、版本化协议（经 `pi.events` 发现）；不建立第二客户端，不依赖生产私有模块或 `dist` import，只公开脱敏快照和管理操作。
- 保留原生 `/mcp`，adapter 增强命令为 `/mcp-adapter`；不注册重复 MCP script 或代理执行 surface。
- 保留权限、project trust、OAuth、错误及工具撤回语义；认证信息和凭据不可泄露。目录缓存与连接状态分开表示。
- 保留公共 exports、factory/register helper 与独立 config/metadata/OAuth 契约。遇到无法安全映射的业务契约或决策，先澄清。
- 上游依赖安装须用 `--ignore-scripts`。修改后按要求执行 `npm run check` 和指定 Vitest/faux-provider 定向测试；不跑全量上游 `npm test` 或 build。历史 check 失败须保持真实记录。
- 不修改全局 npm，不在 Pi 上游提交或推送，不自动部署、发布或打 tag。只在 adapter 中交付并验证补丁。

## 跨电脑恢复清单

1. 打开 adapter 仓库，先核对当前分支、`git status --short --branch`、目标文档及其他协作者改动；保留 `.pi-graph/`，不 reset 或覆盖。
2. 确认 `D:/Code/Javascript/pi-upstream` 是否仍可访问以及 Pi 源码修改是否完整、未被后续改动改变；若换电脑，核对原机器/安全备份。工作流记录不是补丁或源码文件的替代品。
3. 核实固定基线、当前 adapter 依赖/测试脚本，以及历史 native API 修改是否已被安全转移；不因未知结果重放已完成操作。
4. 按上面顺序逐项执行。遇到权限、trust、公共契约等关键冲突先澄清；完成前几项后再做同会话集成和干净基线补丁交付。
5. 所有验证只记录本次真实执行结果；Pi 上游仍不提交、不推送。adapter commit/push 范围按以上授权边界核实。

## 本次暂停保存记录

- 暂停状态来自工作流 `fea78299-72f3-4a48-bb4a-a5aacfff8dd9` 的最后一次已核实状态：等待重规划，1/6 完成，五项待办。此工作流记录没有被当作已接受的新计划或源码备份。
- 本轮实际只核对了 adapter 文档和工作区；未读取/修改上游代码，未运行测试/build，未提交、push 或触发外部操作。
- 本轮工作区初始检查显示当前分支 `main` 跟踪 `origin/main`，仅有未跟踪 `.pi-graph/`；该目录不属于本任务，不应提交。
- 本轮创建 `docs/todo.md` 后需以实际静态检查结果补充/更新本节；不要把历史验证写成本轮验证。

---

此 TODO 是后续恢复迁移的详细来源。若需增加新的重要设计决定或实际验证，分别更新项目指定文档，并在相关记录中链接本文件，避免复制同一事实。
