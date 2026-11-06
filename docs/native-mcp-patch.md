# 固定 Pi 基线的原生 MCP 补丁

本文是 Pi 增强管理模式的补丁复现和验证说明。仅覆盖下列三个固定源码 commit；版本号匹配但 commit 不同或不完整补丁均不视为已验证增强宿主。adapter 也支持标准兼容模式：没有 patched management API 时，使用 Pi 公开 MCP 注册 API（若可用），不创建第二套 runtime；完整支持范围及差异见 [README](../README.md#pi-宿主兼容模式)。stock host 无需匹配下列固定 commit 才能使用标准模式。

**选择规则：**完整、协议兼容的 patched management API → 增强管理模式；所有 patched management 导出均缺失且标准 `registerMcpServer`、`unregisterMcpServer`、`getMcpServers` 存在 → 标准兼容模式；API 部分存在或协议/能力不兼容 → 明确失败，不降级。只有两种 API 都不可用时，才报告需更换 Pi 宿主。标准模式下 adapter-specific 认证、keyring 和执行策略不被转换或忽略；不支持的配置 fail-closed。

## 固定交付

| Pi package | 固定源码 commit | 补丁 | Patch SHA-256 | 路径数 | Manifest | Manifest SHA-256 |
| --- | --- | --- | --- | ---: | --- | --- |
| `@earendil-works/pi-coding-agent` 1.2.0 | `06a466935536f8c9bcacb2d5efc0fc021be1bdff` | [`pi-1.2.0-native-mcp-management.patch`](../patches/pi-1.2.0-native-mcp-management.patch) | `d499d6fba6728dbaced2876149b362780ce4b8ef2129ec3283587a456c46c654` | 48 | [`pi-1.2.0-native-mcp-management.json`](../patches/pi-1.2.0-native-mcp-management.json) | `d7507252bc0c98df8f04d33fb0bf10092a128e19ec40e2b5d31dd8f552e664c6` |
| `@earendil-works/pi-coding-agent` 1.3.0 | `71023aec1546d6d677a65669c5665c0927ce0dd0` | [`pi-1.3.0-native-mcp-management.patch`](../patches/pi-1.3.0-native-mcp-management.patch) | `67df3bb7e8d51dd9f15e66253869d20e5c4c0957f7a331f1a4ba82e2b54eaf33` | 49 | [`pi-1.3.0-native-mcp-management.json`](../patches/pi-1.3.0-native-mcp-management.json) | `5768a010e8473a0d6d9dde557e733f5a513e42933bf15b8c61a3a4dd8339bd7e` |
| `@earendil-works/pi-coding-agent` 1.4.0 | `4a080252f06caf63a525d7873c5d94d3c23887e0` | [`pi-1.4.0-native-mcp-management.patch`](../patches/pi-1.4.0-native-mcp-management.patch) | `e832267afd3c1a92f0971158524e6d70dfd80f622811f8e274dc0652a5817698` | 49 | [`pi-1.4.0-native-mcp-management.json`](../patches/pi-1.4.0-native-mcp-management.json) | `b9559fb79f1f2da74c6ea27e53db495e51a9904c12d204732b3e5f7308c13f3e` |

三份补丁分别基于各自干净固定 commit 生成，不可互换或重复应用。1.2.0 的既有补丁和 manifest 保持不变。每个 manifest 分别记录 package version、基线、hash、路径、协议能力和验证范围；adapter package 的 peer range `^1.2.0` 不是对该区间所有 Pi build 的兼容承诺。

## 在独立干净 checkout 中应用

为目标版本新建独立 Pi clone/worktree，不要在含有其他未提交工作的 Pi 开发目录切换、清理或应用补丁。以下以 1.3.0 为例；应用 1.2.0 时将 commit、版本与文件名替换为上表对应值：

```sh
git checkout --detach 71023aec1546d6d677a65669c5665c0927ce0dd0
git status --short --branch
node -p "require('./packages/coding-agent/package.json').version"
git apply --check /path/to/pi-mcp-adapter/patches/pi-1.3.0-native-mcp-management.patch
git apply /path/to/pi-mcp-adapter/patches/pi-1.3.0-native-mcp-management.patch
npm ci --ignore-scripts --no-audit --no-fund
```

Apply 前确认工作树干净、`HEAD` 和 package version 与所选 manifest 一致。Apply 后可用 `git diff --name-only` 核对路径集合，并用 `shasum -a 256` 核对补丁 hash。若 `git apply --check` 失败，先核对基线和文件状态；不要强制或部分应用。补丁不修改 Pi workspace manifests/lockfile，也不新增依赖。

## 原生 owner 定向验证

在已打补丁 Pi checkout 的 `packages/coding-agent` 目录运行固定 native 管理方测试：

```sh
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run \
  test/mcp-management.test.ts \
  test/mcp-extension.test.ts \
  test/mcp-direct-tools-config.test.ts \
  test/mcp-owner-assembly.test.ts
```

运行时加载原生 MCP adapter 的传输、请求头和 OAuth 相关直接调用方测试，可按目标风险再选 manifest 中的测试文件。上述命令不是 Pi 全量 test/build/typecheck；`--noCheck` 产物发射也不构成完整上游类型验证。

## Adapter 公共产物和真实同会话回归

在 adapter checkout 安装依赖后，对两个固定 patched Pi checkout 分别执行：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run test:public-types -- --pi-source <patched-Pi-checkout>
npm run test:patched-native-session -- --pi-source <patched-Pi-checkout>
```

Public-types runner 核验固定 Pi source、构建所需 Pi workspace `dist`，实际打包 patched `pi-coding-agent`，在隔离 adapter 副本中运行 adapter typecheck、public build/export/package 检查，并用实际 Pi 和 adapter tarball 编译 packed consumer。所有阶段通过后才同步 18 个 `dist` 文件。Consumer 检查覆盖五个已发布入口及 native management types；该检查不等价于 Pi 全量构建。

Same-session runner 在单个 Pi harness session 加载 patched native MCP extension 与 adapter，使用本地 stdio fixture、loopback OAuth fixture、faux provider、隔离配置目录和内存 OAuth store。它覆盖真实 native owner 与 adapter 的管理/调用协作、trust/provenance、directTools 持久化与 session-only policy 区分、错误/撤回行为及过期 OAuth 写入拒绝；不访问真实 MCP/LLM 服务、真实用户 keyring 或用户配置。

版本化 runner 自身的边界测试为：

```sh
npm run test:patched-pi-runners
```

It checks fixed version selection, the existing Pi 1.2.0 hash, argument boundaries, and the Pi 1.3.0 and 1.4.0 manifest/hash/path/protocol/capability checks, including bidirectional cross-version baseline rejection.

Both runners resolve host dependencies from the selected Pi checkout, so the packed host uses its own `pi-ai` and workspace packages instead of the adapter's pinned dev versions. Linking the adapter's `node_modules` into the packed host breaks Pi 1.4.0, whose `pi-user-agent` module imports `formatUserAgent` from `pi-ai` 1.4.0.

## 已退役的托管 Pi 更新 hook

标准 Pi 1.5+ 不依赖增强补丁，独立 managed 更新 hook 已于 2026-11-06 退役。仓库已删除 hook、安装器、launcher 模板、artifact 登记表及专属测试；npm 命令、CI 和发布包也不再包含它们。本文上方的固定源码补丁、manifest 和验证 runner 继续保留，供历史增强模式维护使用。

旧 hook 曾在核心更新成功后，按 Pi package version 选择精确登记、SHA-256 匹配的本地 tarball，经过独立 staging 离线安装及 API 验证后切换 managed release。缺少补丁或验证失败只警告，并保留核心更新结果。这些是历史行为，不是当前标准模式的前置条件；旧提示中“可能缺少管理 API”也不能作为标准 MCP 不可用的证据。

仍安装旧 wrapper 的机器应先验证原启动器备份，并从 Git 历史选择与已安装 wrapper 完整匹配的配套卸载器。当前仓库不再提供卸载命令；不要直接执行历史命令引用的已删除路径。恢复过程还需核对当前 release 与旧 hook state，避免把已升级的标准 Pi 回退。具体匹配规则见[踩坑记录](https://github.com/CGOSU/pi-mcp-adapter/blob/9d2cf049ff406d2d4e4d959db52ace8d444c6c8a/docs/pitfalls.md#2026-11-06新版-hook-卸载器无法匹配早期已安装-wrapper)，本机卸载过程见[会话记录](https://github.com/CGOSU/pi-mcp-adapter/blob/9d2cf049ff406d2d4e4d959db52ace8d444c6c8a/docs/session-log.md#2026-11-06移除本机旧-mcp-更新-hook)。

历史验证曾包括 17 项 managed hook/launcher Node tests，以及 Pi 1.3.0／1.4.0 tarball 在隔离 managed root 中的离线安装和 API smoke、本机版本检查及隔离配置下的 RPC smoke。当时没有运行真实 `pi update --all`，因此不包含 updater 网络和发布链路验证；完整记录见[会话记录](https://github.com/CGOSU/pi-mcp-adapter/blob/9d2cf049ff406d2d4e4d959db52ace8d444c6c8a/docs/session-log.md)。这些结果不表示已删除的 hook 仍受当前 CI 验证。

## 历史验证与边界

- Pi 1.2.0：在独立固定 checkout `06a466935536f8c9bcacb2d5efc0fc021be1bdff` 上确认 apply 前干净，`git apply --check` 与 apply 成功，48 路径匹配 manifest。既有 patch SHA-256 `d499d6f...c46c654`、manifest SHA-256 `d7507252...e664c6` 未改变。本轮 `test:public-types`（typecheck、5 项 exports/package 检查、packed consumer）和真实 same-session runner 各通过。
- Pi 1.3.0：在新建 detached checkout `71023aec1546d6d677a65669c5665c0927ce0dd0` 上确认 apply 前干净，`git apply --check` 与 apply 成功，49 路径（23 修改、26 新增）匹配 manifest；`git diff --check` 通过。Patch SHA-256 为 `67df3bb7...54eaf33`，manifest SHA-256 为 `5768a010...39bd7e`。固定补丁对应的完整 `npm run build` 通过，生成 83 个 bundled CLI 文件（8.9 MiB）；四个 owner/management 定向测试文件 71 项通过。Adapter `test:public-types` 中 typecheck、5 项 exports/package 检查及 packed consumer 通过，版本化 runner 6 项通过；adapter 原生 bridge 定向测试 3 文件/9 项通过。
- Adapter 版本化 runner 测试为 6 项通过。`npm pack --dry-run --ignore-scripts --json` 检查到 31 个发布文件，含 `dist`、README 所链接的协议文档及 Pi 1.2.0/1.3.0 patch/manifest，不含 `src/**`、`test/**` 或 source map；未发布 npm 包。
- Pi 1.3.0 fresh packed CLI runtime smoke：Pi tarball SHA-256 `b929058ead39f7766452aa32457f0b369b31da630165cab585614f7164c32e26`，adapter tarball SHA-256 `d4b6ee49f8f5d21b527779321b15e25aeeec22943a2327a9643198ef52f06428`。二者安装在相互隔离的临时目录；adapter 的 Pi peer 被省略，且没有 ancestor `node_modules`。用实际 `dist/bundle/cli.js`、packed adapter 和本地 stdio fixture 执行 RPC：观测到完整 public management API/18 项 capabilities、owner assembly 中 `assembly_fixture` 连接成功并取得 3 项 live tools、`/mcp-adapter` prompt 被处理、`notify`/`setStatus` 发出；无模型推理事件，EOF 后 CLI 退出码 0，fixture 子进程退出。fixture 只记录 `initialize` 与 `tools/list`，未调用 tool，也未访问真实 MCP、LLM、用户配置或凭据。完整 transcript、probe 和 fixture 日志保存在隔离目录 `/tmp/pi-mcp-evidence-1.3.nbLEJX/runtime/packed-final/`。
- Adapter tarball 通过 `npm run test:public-types -- --pi-source <fixed patched checkout>` 产生并验证的 `dist`，随后以 `npm pack --ignore-scripts` 打包；裸 `npm pack` 会重新执行 `prepack` 并使用 adapter 本地 stock Pi 1.2.0 开发类型，导致缺少 patched management exports 的声明构建失败。`npm run check` 和 Pi 全量测试未运行；不得将定向测试/构建扩展解释为全量 check 通过。未修改、提交或推送 Pi 上游。managed launcher hook 的本机安装、release pointer 切换与验证见上一节；没有运行真实 `pi update --all`。
- Pi 1.4.0：在干净 detached checkout `4a080252f06caf63a525d7873c5d94d3c23887e0` 上 `git apply --check`、apply、`git diff --check` 均通过，49 路径（23 修改、26 新增）与 manifest 一致，反向 apply 校验确认补丁完整应用；`npm ci` 安装 332 个包；四个 owner/management 定向测试文件 59 项通过。完整 `npm run build` 通过（84 个 bundle 文件，9.0 MiB）并产出 tarball SHA-256 `9a3f27b857e29c6197de266fc1282176a6ec139ec71e5f4ffac78f6de50531ed`（7 778 845 bytes，1322 个文件）；解包后实测 `dist/index.js` 导出 management protocol/18 项 capabilities/`installMcpOwnerAssembly`，bundle 含三条 owner events，`pi --version` 为 `1.4.0`。
- Pi 1.4.0 上的 adapter 验证：`test:public-types` 与 `test:patched-native-session` 均实际通过（同一 checkout）；`test:patched-pi-runners` 7 项、当时的 managed hook 测试 12 项、`test/unit/native` 8 文件 30 项、`typecheck` 均通过。隔离 managed root 中用真实 1.4.0 tarball 完成离线 install → API/version 核验 → 原子切换到 `native-mcp-1.4.0-9a3f27b857`，stock `1.4.0` release 与真实 `current-version` 未被改动。Fresh packed CLI runtime smoke（真实 tarball + packed adapter + 隔离配置 + local stdio fixture）：owner assembly 连接成功并取得 3 项 live tools，`/mcp-adapter` prompt 被处理，`notify`/`setStatus` 发出，无模型推理事件，EOF 后退出码 0；未连接真实 MCP/LLM/keyring，未运行真实 `pi update --all`。
- 一处构建环境注记：在 macOS 上必须从 canonical `/private/tmp/...` 路径构建 Pi 1.4.0；经 `/tmp/...` 符号路径构建会因 tsconfig 路径身份不一致产生 `pi-ai` type 冲突。这是构建环境问题，不反映补丁或产物缺陷。
