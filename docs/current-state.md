# 当前状态

## 项目与迁移

- 项目：`pi-mcp-adapter`，版本 `2.27.1`；技术栈为 Node.js、TypeScript、Pi 扩展 API 和 Vitest。用户明确的当前支持目标是标准 Pi 1.5.0 及以上版本；旧补丁资料只用于历史维护。
- Pi 原生 MCP 迁移的十二项工作均已完成，包括原生管理能力、配置与信任边界、系统密钥环凭据衔接、`directTools` 持久化、面板迁移、同会话回归，以及固定版本补丁和发布产物交付。唯一详细实施顺序与恢复条件见 [`docs/todo.md`](todo.md)；适配器与 Pi 原生管理 API 的对应关系见 [`docs/native-mcp-evidence.md`](native-mcp-evidence.md) 和 [`docs/native-mcp-protocol.md`](native-mcp-protocol.md)。
- 早先因业务契约冲突而暂停的 `native-panel-status-and-live-catalog` 未重试，也未宣称完成；澄清和副作用记录保留在 [`docs/session-log.md`](session-log.md)。

## 运行与兼容边界

- Pi 原生 MCP 运行时始终是唯一连接 owner。发布入口按能力选择：完整 patched management API 提供增强管理模式；无该 API 但公开 `registerMcpServer`/`unregisterMcpServer`/`getMcpServers` 时使用有限标准兼容模式。后者无增强面板、适配器 keyring/OAuth、执行策略和状态快照；不支持字段 fail-closed。两条路径都不启动 adapter 自建连接 runtime。契约与边界见 [`README.md`](../README.md#pi-宿主兼容模式)。
- 原生入口只注册 `/mcp-adapter`；Pi 自带的 `/mcp` 仍由 Pi 原生 MCP 扩展负责。
- 保留的旧适配器运行时源码仍位于 `src/**`，并由对应测试覆盖，但不会从 `dist/index.js` 加载，也不包含在发布包中。
- 标准模式支持 `type: stdio/http/streamable-http`、`description` 和秒制 `timeout` 输入；矛盾传输及冲突超时拒绝。七个纯展示设置集中警告后忽略，执行策略／凭据限制仍不静默丢弃。当前契约见 [`README.md`](../README.md)，增强模式历史参考见 [`legacy-runtime.md`](legacy-runtime.md)。
- Pi 原生 MCP 补丁分别固定在 Pi 1.2.0 commit `06a466935536f8c9bcacb2d5efc0fc021be1bdff`、Pi 1.3.0 commit `71023aec1546d6d677a65669c5665c0927ce0dd0` 与 Pi 1.4.0 commit `4a080252f06caf63a525d7873c5d94d3c23887e0`；这些是历史增强模式固定基线，不能代替标准 Pi 1.5+ 的验证。三个 patch、manifest、hash 与复现范围以 [`docs/native-mcp-patch.md`](native-mcp-patch.md) 为准。Pi 上游未提交、未推送、未发布或打标签。
- 职责拆分专用 Pi 源码工作区 `/Users/cgosu/code/JavaScript/pi-session-refactor` 位于分支 `refactor/session-responsibilities`。23条历史 `recommend-split` 中，Pi 19项已完成、`AgentSession` 1项部分完成、Windows `windows.rs` 1项按用户决定延期；adapter 2项已完成。AgentSession仍由主类持有运行状态、队列、事件及生命周期，剩余扩展绑定因耦合保留；Windows源码未改，且本机没有Windows target验证环境。拆分模块、逐项验证、预算校准与未处理项见 [`docs/session-log.md`](session-log.md)；Rustup查询引发的固定1.96.0 toolchain部分下载及未处理状态见 [`docs/pitfalls.md`](pitfalls.md)。本批Pi代码最终 `npm run check` 通过；本批改动均未提交或推送。Pi 1.2.0固定补丁 artifact 构建/发布链路仍未在该分支验证；支持版本和artifact范围以 [`docs/native-mcp-patch.md`](native-mcp-patch.md) 为准。
- 本机使用 stock Pi 1.5.0；旧 managed MCP 更新 hook 已按用户要求移除，恢复原始 Pi 启动器。旧补丁 release、artifact 缓存和启动器备份保留，未重启用户会话。卸载与验证见 [`session-log.md`](session-log.md)。源码仓库和 `~/.pi/agent/git/github.com/CGOSU/pi-mcp-adapter` 安装副本独立；2026-11-06 提交本次记录前核对两者 HEAD 均为 `910aeb5f0dee2f391b02faebad7643590d6ea24b`，`dist/index.js` 字节一致。

## 源码、启动与发布布局

- 根目录保留 `index.ts`、`config.ts`、`metadata-cache.ts`、`types.ts`、`oauth.ts` 和 `cli.js` 作为公共兼容入口；实现位于 `src/contracts`、`src/catalog`、`src/config`、`src/runtime`、`src/auth`、`src/tools`、`src/ui`、`src/commands` 和 `src/extension`。已删除 53 个未发布的根目录转发文件；内部模块直接依赖所属领域路径，不反向依赖公共聚合入口。
- 公共入口保持原生 owner 装配与按能力选择标准／增强模式；不会回退到适配器自建连接。旧代理、脚本工具和 UI runtime 不从发布入口启动，历史教程已移入 [`legacy-runtime.md`](legacy-runtime.md)。
- 旧 runtime 的 lazy 缓存优化仅适用于保留的历史源码；当前标准 Pi 在会话启动时后台连接服务器，连接状态以原生 `/mcp` 为准。`/mcp-adapter` 只列模式与注册名称，导入诊断来自启动／reload 通知。
- 发布包包含五个 ESM（ECMAScript 模块）入口：包根、`types`、`config`、`metadata-cache` 和 `oauth`；Pi 扩展由 `extensions/index.js` 转发到 `dist/index.js`，命令行入口为 `dist/cli.js`。`package.json` 不发布 `src/**` 或测试目录。
- 最新 `npm pack --ignore-scripts --dry-run --json` 检查得到38个文件，包含18个构建产物、扩展入口、README 所链接文档（含历史文档）、固定 patch/manifest 与托管更新 hook 脚本；不包含 `src/**`、`test/**`、`node_modules/**` 或 source map。未发布 npm 包。

## 测试、发布与验证结果

- 测试按 `test/unit`、`test/integration`、`test/node` 和 `test/fixtures` 分区；仓库根目录不保留测试文件或 `__tests__` 目录。
- 本机 Node `v26.11.1`：本轮配置／原生接入／配置集成／启动依赖的16个测试文件143项通过；`npm run typecheck`、`npm run build:public` 和4项 public build/export 测试通过。此前119文件1,350项全仓测试通过属于历史版本，本轮未运行全仓测试。
- 本轮 stock Pi 1.5.0 bundled CLI 在隔离配置中加载本次 dist，原生及共享来源三个本地 stdio fixture 全部完成握手与 tools/list，`/mcp` 返回 connected；展示设置一次 warning，正常关闭且无模型调用。源码目录旧 patched Pi peer 会令该探针走增强模式而失败，标准验证必须使用实际 stock peer。详细过程和边界见 [`session-log.md`](session-log.md)。
- Pi 1.3.0 固定补丁为 49 个路径、SHA-256 `67df3bb7…54eaf33`；隔离 staging 中完整 `npm run build` 通过，输出 83 个 CLI bundle 文件。4 个 Pi owner/management 定向测试 71 项通过；adapter `test:public-types -- --pi-source <patched Pi>` 的 typecheck、5 个 public/export/package 检查和 packed consumer 通过，版本化 runner 6 项通过，adapter native bridge 定向测试 3 文件/9 项通过。fresh packed CLI + adapter 在 peer omitted、无 ancestor `node_modules` 的隔离目录中通过 RPC 冒烟：管理 API 与 18 项能力可见，built-in owner 连接 programmatic fixture 并得到 3 项 live tools，`/mcp-adapter` prompt 被处理，status/notify 可见，未产生模型推理事件，EOF 后 CLI 与 fixture 均正常退出。Pi 1.2.0 的既有 fixed patch/public consumer/same-session 验证保持不变；两版 patch/manifest hash 及可复现细节见 [`docs/native-mcp-patch.md`](native-mcp-patch.md)。
- `npm run test:oauth` 的 141 项测试曾全部通过；仅安装生产依赖后的临时安装、公共子路径导入和命令行冒烟检查也有通过记录。详细命令及当时的验证范围见 [`docs/session-log.md`](session-log.md)。
- Pi 1.3.0 隔离 staging 的 `npm run build` 已在模型数据 hydration 后通过；完整 Pi `npm run check` 与全量测试未在本轮最终状态运行，因此不宣称它们通过。此前 fixed baseline 在 hydration 前的 `check` 曾因缺失生成模型数据失败，见历史 session 记录。
- 历史 Managed 更新 hook 的 17 项 Node 测试通过；真实 Pi 1.3.0 与 1.4.0 tarball 均在隔离模拟 managed install 中完成离线安装、API/version 校验与原子切换。当时本机 patched managed release 的 `--version`、18 项 management capability 检查及隔离配置下 packed CLI + adapter/local fixture RPC smoke 均通过；该轮未运行真实 `pi update --all`。具体检查及限制见 [`docs/session-log.md`](session-log.md)。
- Pi 1.4.0 固定补丁为 49 个路径、patch SHA-256 `e832267a…5817698`、manifest SHA-256 `b9559fb7…08c13f3e`；干净 checkout 上的 apply、`git diff --check`、反向 apply 与 4 文件 59 项 owner/management 测试通过，完整 `npm run build` 产出 84 个 bundle 文件与 tarball SHA-256 `9a3f27b8…de50531ed`。adapter 的 `test:public-types`、`test:patched-native-session`（同一 patched checkout）、版本化 runner 7 项、managed hook 12 项、`test/unit/native` 30 项与 `typecheck` 均通过；隔离 managed root 中真实 tarball 完成离线安装并切换到 `native-mcp-1.4.0-9a3f27b857`（stock `1.4.0` release 保留）。fresh packed CLI RPC smoke 中 owner 连接 fixture 并取得 3 项 live tools，`/mcp-adapter` 被处理，未产生模型推理事件。
- 最终 3 次启动基准中，源码与发布包的模块导入/主流程/总耗时中位数分别为 `437/475/1128ms` 和 `199/228/754ms`，未出现可重复的 15% 以上回退；静态启动依赖检查通过。目录基准 `npm run benchmark:catalog -- --runs 5` 中，5×100、20×100、50×100 项时，direct 与 live 共用索引的测量值分别为 `4.72/4.45ms`、`18.73/17.43ms`、`45.07/45.05ms`；旧的逐服务器索引 50×100 项对照为 `989.27ms`。一万工具搜索冷启动为 `50.28ms`，5 次热运行中位数为 `5.73ms`，结果正确。
- Windows 完整 Vitest 可能受全局配置污染、Linux 密钥环、`taskkill`、符号链接、Unix 套接字、文件权限和命令行 shebang 等平台差异影响；这些限制不代表源码布局回归，相关环境应使用针对性验证。
- `.github/workflows/ci.yml` 与开发依赖仍围绕旧固定补丁基线；统一迁移到用户指定的标准 Pi 1.5+ 是后续工作。本轮未修改依赖／CI，也未运行远端 GitHub Actions。

## 尚待完成的交付

- 第一批配置兼容、展示设置和 README／Skill 修正已提交，安装副本核对结果见上方运行状态；不再列为待同步。未发布 npm 包；保留用户既有 `AGENTS.md` 修改。Git 收尾授权见 [`session-log.md`](session-log.md)。
- 开发／peer 依赖和 CI 的标准 Pi 1.5+ 基线迁移、导入诊断的来源与字段定位、旧实现清理均未纳入本批。标准 Pi 无须安装旧补丁；历史增强模式的补丁 runner 继续按 [`native-mcp-patch.md`](native-mcp-patch.md) 指定固定源码验证。
- 历史 Pi 源码职责拆分和 Windows 延期项目沿用既有边界，见 [`session-log.md`](session-log.md) 与 [`pitfalls.md`](pitfalls.md)。上游 checkout 和工具链遗留不因本次 hook 移除而视为已处理。
