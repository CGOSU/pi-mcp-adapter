# 设计决策

本文件记录已经确认且会影响后续实现的决定。临时想法和普通操作记录不写入此处。

## 记录格式

每项决策应包含日期、决定、原因和约束。如果后续改变决定，应注明被替代条目，而不是删除历史。

## 已确认决策

### 2026-10-17：Pi managed 更新后单独 reconciliate 已登记 MCP 补丁，绝不阻断核心更新

- 决定：仅在 Pi managed `releases-v1` launcher 的核心更新命令成功退出后运行本地 patch reconciler；只允许精确登记并核验 hash 的持久 artifact。未知版本、artifact 缺失/校验失败、安装/验证失败、锁冲突都只报告 adapter 暂不可用，不暂停、回滚或 pin Pi 核心更新，并保留 Pi updater 原始退出码。当前 managed registry 只启用固定 Pi 1.3.0 artifact。
- 原因：用户明确要求 `pi update --all` 的核心升级照常完成，而当前 Pi 自身 updater 没有本地 MCP patch hook；独立外层 launcher 可以在核心 updater 结束后进行补丁安装，不改写 Pi 核心代码或发布来源。
- 约束：不修改活动 release；使用独立 staging、offline/npm scripts disabled、API/bundle/CLI 验证后才原子切换 `current-version`；补丁 release 使用非 SemVer alias 以免被 Pi managed updater 的 SemVer release pruning 清除，保留原 stock release 和本地回滚路径。hook 仅识别确切 artifact 版本；不得远程下载未核验补丁、回退到第二套 MCP runtime 或影响非核心 update。实际安装与验证状态见 [`current-state.md`](current-state.md)，可复现流程见 [`native-mcp-patch.md`](native-mcp-patch.md)。

### 2026-10-17：通过 Pi 扩展事件总线把 adapter assembly 交给 bundled native owner

- 决定：adapter 安装 `McpOwnerAssembly` 时显式传入当前 `pi.events`；Pi 内置 MCP factory 在 session 开始时通过同一 event bus 请求、接收并释放该 assembly。Adapter management bridge 若初始 discovery 早于 owner available，会在 available 事件后重试，并以 session generation 和 pending-request identity 防止迟到结果覆盖当前状态。
- 原因：Jiti 加载的 adapter 与 Pi bundled CLI 中的内置 MCP owner 不保证使用同一 module instance；仅写入 public installer 所在模块的 module-local singleton，会导致 built-in owner 仍加载默认配置。fresh packed CLI 运行验证确认 event-bus handoff 后，native owner 能连接 adapter assembly 中的 local fixture。
- 约束：Pi 原生 MCP 仍为唯一连接、认证和执行 owner；事件 handoff 是内部 assembly seam，不扩展 `pi.mcp-management` v1 public capability，也不引入 fallback/client。必须在 peer omitted、无 ancestor Pi `node_modules` 的 fresh packed CLI 中验证，不能用源码/Vitest alias 代替。

### 2026-10-16：发布产物构建必须先成功后替换，失败不得破坏已提交 dist

- 决定：`npm run build:public` 在仓库内 `.tmp-public-build-*` 暂存目录完成 JS、声明与运行资源构建，全部成功后才原子替换 `dist/`；发布失败时还原旧目录，暂存目录始终清理。
- 原因：`dist/` 已纳入版本控制（见下条 2026-08-23 决定）。原先构建前直接 `rm -rf dist`，使任何构建失败都变成对已提交生成物的破坏，且失败原因（缺 patched Pi 类型）与后果（丢失 `dist`）无关。
- 约束：后续修改构建脚本时必须保留该原子性，不得在任何可能失败的步骤之前破坏现有 `dist/`；失败必须非零退出且保留原生成物，不得伪装成功，也不得手工伪造生成物代替真实构建。恢复与验证方式见 [`docs/pitfalls.md`](pitfalls.md)。

### 2026-10-16：默认扩展入口切换为 native-only，不保留旧 runtime fallback

- 决定：发布入口 `dist/index.js` 不再包含自包含的 adapter MCP 运行时；它经公开 `pi.mcp-management` v1 协议发现并协商 Pi 原生 MCP owner，作为 opt-in assembly + 面板接入，只注册 `/mcp-adapter` 一个命令，不注册自己的 tool。移除了 `mcp-script-worker.mjs` 与 `app-bridge.bundle.js` 运行资源及其构建检查。
- 原因：Pi 原生 runtime 是本迁移已确认的唯一连接、OAuth 与执行 owner；保留旧 proxy/script/UI runtime 会形成第二客户端，并使“stock host 缺能力就明确失败”的约定失效。
- 约束：stock 或缺少必需能力的 host 必须返回结构化失败（`missing-public-api`/`missing-capabilities`/`unsupported-version`）并且不连接任何 MCP server、不回退到旧 runtime；不因为入口切换而改变已发布公共 exports、factory/register helper 签名或五个子路径。旧 `src/**` 运行时模块仍保留在仓库并由各自测试覆盖，不因入口切换而删除。
- 边界：`scriptMode`、`disableProxyTool`、`autoAuth`、`trace`、`oauthDir` 及 server 级 `debug`/`trace` 不在 native owner 下激活，但保留在配置中且不静默丢弃；`oauthDir` 不激活是因为它可能触发明文凭据迁移。

### 2026-10-16：directTools 持久化、面板与 bridge 迁移按原计划完成

- 决定：迁移计划中第 7–11 项（`adapter-native-bridge-and-public-entry`、`native-direct-tools-persistence`、`native-panel-status-and-live-catalog`、`real-native-adapter-session-regression`、`versioned-patch-and-public-artifact-verification`）按原定目标与验收范围完成；旧被阻塞的 `native-panel-status-and-live-catalog` 任务不重试、不伪报完成，其澄清报告与副作用记录保留。
- 约束：面板保存工具选择只走 native `setDirectTools` 持久化路径（不侧面写配置）；`setExecutionPolicy` 保持 session-only，不冒充持久化。
- 交付：补齐的能力与可复现命令以 [`docs/native-mcp-protocol.md`](native-mcp-protocol.md)、[`docs/native-mcp-patch.md`](native-mcp-patch.md) 与 manifest 为唯一来源；旧 runtime 相关任务的完成声明、验证与副作用记录保留在 [`docs/session-log.md`](session-log.md)，不重写。commit `05c4a3f` 与 push 结果也已记录在那里。

### 2026-10-16：保留 directTools 选择语义并扩展原生管理 API 持久化

- 决定：保留已发布管理面板的 `directTools` 工具选择与保存语义；由 Pi 唯一原生 owner 通过版本化、可协商的公开管理能力，在真实 project-trust 门控下按既有配置 provenance 持久化 `directTools` 选择，成功后同步当前会话执行策略与订阅快照。已获用户确认（2026-10-16）。
- 原因：暂停的 `native-panel-status-and-live-catalog` 核实到原生 `setExecutionPolicy` 只更新当前 session、不持久化，而持久化的 `setToolExposure` 写入 `toolExposure`，且现有 effective exposure 中 `directTools` 选择优先于普通 `toolExposure`；两者不等价。直接改用 `toolExposure` 会让既有 direct 选择继续生效或改变已发布配置语义，属于无法等价映射的契约变化。
- 约束：不得以 `toolExposure`、session-only policy 或 adapter 自行写文件替代该持久化路径；不绕过 native owner 的 trust 检查、provenance 校验与安全写入；失败按结构化 Result 报告且不伪装成功；保留 `MCP_DIRECT_TOOLS` 的会话覆盖语义。新增能力按现有协议 v1 能力协商扩展，stock 或缺能力 host 继续显式失败、不 fallback。实施顺序见 [`todo.md`](todo.md)。

### 2026-10-16：以独立版本化补丁增加 Pi 1.3.0 固定基线支持

- 决定：保留已交付的 Pi 1.2.0 补丁与验证方案，另为 Pi 1.3.0 固定 commit `71023aec1546d6d677a65669c5665c0927ce0dd0` 交付独立 patch/manifest；本适配器对 Pi 的支持声明只覆盖已验证的两个固定 commit，不把 peer range `^1.2.0` 扩张解释为任意 Pi 1.2+ build 都兼容。
- 原因：Pi 1.3.0 满足现有 peer range，无需改变最低 peer 版本；独立版本化 patch 和 clean-checkout 验证可以扩展到新的固定基线，同时保持原 Pi 1.2.0 artifact 与安全/owner 语义不变。
- 约束：两份补丁不可互换；每份都须由各自固定干净基线验证 hash、路径和协议能力。stock/不完整 host 继续显式失败，不增加 legacy runtime/capability fallback。补丁 hash、manifest 和实际验证结果唯一维护于 [`docs/native-mcp-patch.md`](native-mcp-patch.md)。

### 2026-10-15：本次迁移暂不支持原生 2026-07-28 远程 MCP 协议

- 决定：用户确认本轮迁移暂不实现原生 MCP client 对 `2026-07-28` wire protocol 的支持。保留 adapter 已发布 `ServerEntry.protocolVersion` 配置字段与公共类型；显式 `2026-07-28` pin 以及当前无法等价实现的 modern `auto` 协商，必须在连接/执行前返回具体、可区分的结构化"不支持"结果。
- 原因：固定 Pi 1.2.0 的 `@earendil-works/pi-mcp` client 只实现 pre-2026 `initialize` 握手（`packages/mcp/src/protocol/types.ts`、`client.ts`）。把该值映射到 native 默认或 legacy 会静默改变所选 wire protocol，比明确报不支持风险更高；实现完整 2026 协商需要独立的架构与范围评估。
- 约束：不把 `2026-07-28` 加入 native 支持列表，不实现 2026 wire client，也不允许静默退回 legacy 或删除/改写用户配置；该限制不涉及请求方管理协议 v1；不以此为由放宽 trust、凭据或执行权限。未设置 `protocolVersion` 的 stock native server 行为不变。后续如需支持，作为独立架构任务评估。

### 2026-10-14：项目级 MCP 配置统一受 Pi project-trust 控制

- 决定：保留现有配置来源与 provenance，但共享 `.mcp.json`、项目 `.agents`/`.pi` 配置等所有项目级来源统一经过真实 Pi project-trust gate；未信任时只可脱敏展示来源与条目，不连接、不执行配置命令、不注册可执行缓存工具。这是相对旧 adapter 行为的有意收紧，已获用户确认。
- 原因：adapter 现有读取路径不传 Pi trust 决策，而原生 owner 只在 trusted 项目读取项目配置（差异见 [`native-mcp-evidence.md`](native-mcp-evidence.md) C1）；维持旧行为会让迁移后的执行路径绕过宿主信任。
- 约束：不得通过 extension registration、调用方自报 trusted、项目来源转写 global 或配置 override 绕过信任；不删除来源、不静默丢弃字段；字段级归属与实现见 [`todo.md`](todo.md) 的 `native-config-provenance-and-trust`；原生既有额外权限限制不变。

### 2026-10-14：保留 keyring 存储与既有 OAuth 登录连续性

- 决定：保留 adapter 的 OS keyring 存储和既有 OAuth 登录连续性，由原生 owner 消费一条安全适配路径；不自动把旧凭据复制到明文文件，也不输出 token。已获用户确认。
- 原因：原生 `McpOAuthCredentialStore` 默认写 agent-dir `mcp-auth.json` 明文文件 backend，与 adapter keyring 不是同一契约（差异见 [`native-mcp-evidence.md`](native-mcp-evidence.md) C2）；直接切换到原生默认会使既有登录失效或迫使凭据明文落盘。
- 约束：未参与迁移的 stock native server 保持原生默认存储；若无法安全复用 keyring，先报告具体冲突并澄清，不默认为已授权重新登录或明文迁移；不读取真实用户凭据做测试。实现见 [`todo.md`](todo.md) 的 `native-keyring-and-oauth-continuity`。

### 2026-10-14：在固定 Pi 1.2.0 基线上重建原生 MCP 管理协议

- 决定：历史 `native-management-api` 实现源码未出现在固定上游工作区；按用户明确授权，从 Pi 1.2.0 基线 `06a466935536f8c9bcacb2d5efc0fc021be1bdff` 重新实现。`docs/todo.md` 中此前记录的是历史完成声明与历史验证，不能当成本轮源代码、补丁或验证成果；本次重建协议以 [`native-mcp-protocol.md`](native-mcp-protocol.md) 为唯一细节来源。
- 原因：已核实的独立工作区是干净的精确上游基线，没有旧 native-management-api 改动；使用工作流历史文本重放会把未验证内容冒充源码。
- 约束：Pi 原生 MCP 扩展继续持有唯一连接、OAuth 与执行权；只经公开 `pi.events` 发现并协商版本/必需能力，导出 session-scoped、脱敏、不可变管理快照及 Result API。不得泄露 client、原始配置、凭据、URL/header/env、传输错误，不创建第二 runtime 或代理执行。保留 `/mcp`、project trust、权限 pipeline、OAuth 和工具撤回语义；禁用保留最近成功目录为 cached，但不可执行。shutdown 后旧 handle/异步结果必须失效，不重放可能有副作用的操作。遇到后续 adapter 已发布契约或权限/数据规则无法安全映射时先澄清。

### 2026-08-31：仅保留标准 MCP 配置来源

- 决定：删除宿主专属 MCP 配置探测、兼容导入、setup 采用流程和 CLI `init`；`imports` 与 `settings.hostConfigDiscovery` 遗留字段在配置边界被忽略。标准共享文件、Pi override、provenance、setup 写入和 token CLI 保留。
- 原因：宿主配置格式和路径不是稳定的 MCP 配置契约；保留探测或兼容入口会让启动、诊断和交互流程继续读取用户未明确选择的宿主文件。
- 约束：不得扫描 Cursor、Claude、Codex、OpenCode、Windsurf、VS Code 等宿主路径；共享来源的 `directTools` 写回仍必须落到 Pi-owned 文件；不引入迁移或兼容层。

### 2026-08-23：公共 npm 包采用五入口 ESM code splitting

- 决定：包根、`types`、`config`、`metadata-cache`、`oauth` 五个公共入口分别构建为 ESM，并在各自入口内部保留 native `dynamic import()` 与延迟 chunks；发布 `dist`、`dist/cli.js` 及 script worker、keyring helper、AppBridge 三项独立运行资源。
- 原因：将源码直接聚合成单 JS 会提升 MCP runtime、OAuth、命令和 UI 的启动导入成本，破坏已有 Lazy Load；分别构建入口又能避免某个公共 subpath 的共享依赖被提升到 Pi 扩展入口。
- 约束：依赖和 Pi host peer 保持 external；禁止 `inlineDynamicImports`；构建必须由 `npm run build:public` 可重复生成，`prepack` 可更新 npm 发布物但 production-only 安装不得编译；发布 tarball 不超过 60 个文件且不包含 `src/**`、`test/**` 或 source map。

### 2026-08-23：以动态模块边界降低 Pi 扩展启动成本

- 决定：把 metadata cache、Schema 和注册所需代码留在 `index.ts` 启动闭包；把 MCP runtime、连接、OAuth、命令、脚本、proxy/direct 执行和 UI runtime 改为缓存的原生 `dynamic import()`，由共享初始化 Promise 在首次需要时加载。
- 原因：Pi 的 `module import` 计时覆盖入口的 Jiti 转换和静态依赖闭包，而不是 MCP 连接初始化；缩小静态闭包可以降低冷启动导入成本。
- 约束：有效全 lazy 缓存不得后台导入完整 runtime；首次 MCP 使用承担延迟加载成本；eager、keep-alive、冷缓存、直接工具、重试、generation 和 runtime owner 生命周期继续沿用既有语义。

### 2026-08-23：使 Git 版 Pi 包在 production-only 安装下可用

- 决定：移除安装期 `prepare` 编译，改由 `prepack` 在 npm 打包前执行 `build:public`；将 `tsconfig.public.json` 生成的 `dist` 文件纳入仓库，并以 LF 保持生成结果稳定。
- 原因：Pi 更新 Git 扩展时执行 `npm install --omit=dev`，安装阶段没有 TypeScript、Node 类型和 Pi 开发类型包，原 `prepare` 必然失败；Git 扩展入口本身不需要安装期编译，而公共 Node exports 仍需要可用的预构建文件。
- 约束：不得把编译器或开发类型包移入运行时 dependencies；CI 必须检查 `dist` 无漂移，并覆盖 Windows production-only 安装和公共 exports 加载。

### 2026-08-23：以领域目录和兼容 facade 作为最终源码布局

- 决定：实现按职责固定在 `src/contracts`、`src/catalog`、`src/config`、`src/runtime`、`src/auth`、`src/tools`、`src/ui`、`src/commands` 和 `src/extension`；根目录只保留公共入口、CLI 和一行兼容 facade。测试按 `test/unit`、`test/integration`、`test/node` 与 `test/fixtures` 组织。
- 原因：让内部依赖指向精确领域路径，避免公共聚合入口扩大启动闭包，并让 npm 发布边界可以通过 `src`、公共 facade 和 tracked `dist` 明确验证。
- 约束：内部模块不得反向依赖公共 facade；新增模块不得通过 barrel export 回到启动入口；根兼容入口、公共 exports、Pi extension entry 和工具行为保持不变。

### 2026-08-23：性能验收记录同机分布而非绝对门禁

- 决定：启动性能只比较同一宿主、同一 benchmark 的 cold/warm 中位数，同时保留真实结果；不因单次宿主噪声引入绝对时间门禁或改变懒加载边界。
- 原因：Windows/Pi/Jiti 的文件系统缓存和进程启动成本会显著影响 fresh RPC 样本。最终 3-run cold module import 为 `387ms`、warm 为 `72ms`，静态启动导入图仍满足边界；catalog 与 10,000 工具搜索回归保持线性/低毫秒级表现。
- 约束：后续性能变化必须用 `npm run benchmark:startup` 和 `npm run benchmark:catalog` 的同机中位数复测，并明确记录未达历史参考值的结果，不得把延迟 runtime 成本描述为消失。

### 2026-08-23：以 HEAD A/B 结果判定领域迁移未造成启动回退

- 决定：不为未达到 `300ms` 的绝对冷启动目标引入额外懒加载或聚合优化；以同一 Windows/Pi 0.84.2 宿主、同一 3-run fresh RPC benchmark 与 `HEAD` 临时归档进行 A/B 判定。
- 原因：当前工作树 cold module import median `398ms`、warm `65ms`，HEAD 基线分别为 `398ms` 和 `60ms`；5-run 当前 cold `465ms` 且样本为 `401–691ms`，说明 fresh Jiti/进程启动噪声显著。当前结果未显示本轮领域迁移造成可归因回退。
- 约束：文档必须保留未达到历史 `365ms`/`300ms` 目标的真实结果；后续性能优化须先有同机 A/B 证据，不得为绝对门禁改变已确认的启动边界。

### 2026-09-01：使用标准 extensions 入口隐藏 dist 路径

- 决定：将 `package.json` 的 Pi 扩展入口改为 `extensions/index.js`，由该入口转发到已构建的 `dist/index.js`，并将 wrapper 纳入发布文件。
- 原因：Pi 对位于包根 `dist/` 下的 `index.js` 会在紧凑扩展标签中追加 `:dist`；`extensions/index.js` 是 Pi 约定的入口布局，可保留 `CGOSU/pi-mcp-adapter` 的显示名称。
- 约束：不改变 npm 公共 exports、CLI 入口或 `dist` 的构建与懒加载边界；wrapper 必须在 Git 安装和 npm tarball 中同时可用。

### 2026-10-22：Pi 1.4.0 沿用固定版本 native-only 契约，runner 必须使用宿主自身 pi-ai

- 决定：Pi 1.4.0 只追加一个固定目标（commit + patch SHA-256 + manifest），复用既有 schemaVersion 1 manifest 布局和 18 项 capabilities；不引入 1.4 专属机制、降级路径或第二套 runtime。验证脚本（`test:public-types`、`test:patched-native-session`）必须从所选 Pi checkout 解析宿主依赖，包括 `pi-ai`。
- 原因：1.4.0 候选补丁可直接应用到干净基线，无需专属源码改动；而 Pi 1.4.0 的 `utils/pi-user-agent` 依赖 `pi-ai` 1.4.0 的 `formatUserAgent`，其 agent loop 也要求宿主与 adapter 共享同一份 message 类型。用 adapter pin 的 1.2.0 填充宿主会同时破坏 public-types 与同会话回归。
- 约束：宿主 `pi-ai` 版本必须与其 `coding-agent` 依赖声明一致，否则 runner fail-closed；manifest 的 `handoff` 段只承载下游复用信息，不改变被 runner 断言的既有字段。managed installer 按 tarball 的 SHA-256 在 registry 中唯一定位记录，不再写死版本号。
