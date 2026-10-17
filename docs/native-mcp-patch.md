# 固定 Pi 基线的原生 MCP 补丁

本文是 Pi 原生 MCP adapter 补丁的复现和验证说明。仅覆盖下列两个固定源码 commit；版本号匹配但 commit 不同、stock Pi 或不完整补丁均不视为已验证宿主。Pi 原生 MCP 仍是唯一连接、认证和工具执行 owner；adapter 提供配置/provenance、keyring 接线和管理增强，不创建第二套 runtime，也没有 capability fallback。

## 固定交付

| Pi package | 固定源码 commit | 补丁 | Patch SHA-256 | 路径数 | Manifest | Manifest SHA-256 |
| --- | --- | --- | --- | ---: | --- | --- |
| `@earendil-works/pi-coding-agent` 1.2.0 | `06a466935536f8c9bcacb2d5efc0fc021be1bdff` | [`pi-1.2.0-native-mcp-management.patch`](../patches/pi-1.2.0-native-mcp-management.patch) | `d499d6fba6728dbaced2876149b362780ce4b8ef2129ec3283587a456c46c654` | 48 | [`pi-1.2.0-native-mcp-management.json`](../patches/pi-1.2.0-native-mcp-management.json) | `d7507252bc0c98df8f04d33fb0bf10092a128e19ec40e2b5d31dd8f552e664c6` |
| `@earendil-works/pi-coding-agent` 1.3.0 | `71023aec1546d6d677a65669c5665c0927ce0dd0` | [`pi-1.3.0-native-mcp-management.patch`](../patches/pi-1.3.0-native-mcp-management.patch) | `67df3bb7e8d51dd9f15e66253869d20e5c4c0957f7a331f1a4ba82e2b54eaf33` | 49 | [`pi-1.3.0-native-mcp-management.json`](../patches/pi-1.3.0-native-mcp-management.json) | `5768a010e8473a0d6d9dde557e733f5a513e42933bf15b8c61a3a4dd8339bd7e` |

两份补丁分别基于各自干净固定 commit 生成，不可互换或重复应用。1.2.0 的既有补丁和 manifest 保持不变。两个 manifest 分别记录 package version、基线、hash、路径、协议能力和验证范围；adapter package 的 peer range `^1.2.0` 不是对该区间所有 Pi build 的兼容承诺。

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

它检查固定版本选择、Pi 1.2.0 既有 hash 保持、参数边界，以及 Pi 1.3.0 manifest/hash/path/protocol/capability 校验。

## 托管 Pi 的非阻断更新 hook

`npm run install:managed-pi-update-hook -- --artifact <verified-pi.tgz>` 为 Pi 的 `releases-v1` managed install 安装本地 launcher wrapper。只有从 `~/.pi/agent/bin/pi`（或等效 managed agent 路径）启动的 Pi 命令会经过该 wrapper；非 managed 安装不受影响。安装器先校验仓库中的 patch SHA-256、artifact registry 和传入 tarball SHA-256，随后把 artifact 持久化到 managed install 的 `native-mcp-update/artifacts/`，备份原 launcher，并安装 post-update hook。当前 registry 只登记 Pi 1.3.0；其 patched Pi tarball SHA-256 为 `b929058ead39f7766452aa32457f0b369b31da630165cab585614f7164c32e26`。Artifact tarball 不随 adapter package 发布，且安装器不从远端下载或依赖 `/tmp`。

成功的 `pi update --all` 完成后，wrapper 才运行 reconciliation。它只选择 package version 与 registry 精确相等的 artifact；安装使用独立 staging、npm offline/cache、禁用 lifecycle scripts，之后核验包版本、public MCP management protocol/capabilities、bundled owner events 和 `pi --version`，最后将新 release 移入 managed `releases/` 并原子切换 `current-version`。补丁 release 使用稳定的非 SemVer alias，使 Pi 自身的旧 release pruning 不会把它当作可清理的版本目录；原 stock release 保留以便回滚。

Hook failure、未知版本、缺少/哈希错误 artifact、离线依赖不足、并发更新锁冲突或 bundle/API 验证失败只输出 warning；wrapper 保留 Pi 核心更新原始退出状态，既不暂停、回滚也不 pin 核心版本。`--models` 和 `--extensions` 更新不应用核心补丁。对于未登记版本，adapter 仍按 fail-closed 契约报告宿主缺少受支持的 MCP API，不会回退到第二套 runtime。

恢复命令为 `npm run install:managed-pi-update-hook -- --remove`。只有当前指针仍是 hook 激活的 release 且 prior release 存在时，remove 才将指针恢复至 prior release；随后恢复原 launcher。补丁 release 和 artifact 缓存保留，不会删除文件。安装/恢复后需完全重启 Pi，现有进程不会替换已加载的宿主模块。

实际验证包括：9 项 managed hook/launcher Node tests，涵盖 Pi updater 锁冲突与安装 staging 期间核心 release 指针并发变化；真实 1.3.0 tarball 在隔离模拟 managed root 中的离线 install/reconcile/API smoke；本机 managed Pi 新 release 的 `--version` 与 public API 检查；使用已安装 managed release 的 bundled CLI、packed adapter、隔离配置和 local stdio fixture 执行 RPC smoke。没有运行真实 `pi update --all`，因此 updater 网络/发布链路不在本轮实测范围；wrapper 的成功/失败退出状态由 fake child 测试覆盖。

## 已执行验证与边界

- Pi 1.2.0：在独立固定 checkout `06a466935536f8c9bcacb2d5efc0fc021be1bdff` 上确认 apply 前干净，`git apply --check` 与 apply 成功，48 路径匹配 manifest。既有 patch SHA-256 `d499d6f...c46c654`、manifest SHA-256 `d7507252...e664c6` 未改变。本轮 `test:public-types`（typecheck、5 项 exports/package 检查、packed consumer）和真实 same-session runner 各通过。
- Pi 1.3.0：在新建 detached checkout `71023aec1546d6d677a65669c5665c0927ce0dd0` 上确认 apply 前干净，`git apply --check` 与 apply 成功，49 路径（23 修改、26 新增）匹配 manifest；`git diff --check` 通过。Patch SHA-256 为 `67df3bb7...54eaf33`，manifest SHA-256 为 `5768a010...39bd7e`。固定补丁对应的完整 `npm run build` 通过，生成 83 个 bundled CLI 文件（8.9 MiB）；四个 owner/management 定向测试文件 71 项通过。Adapter `test:public-types` 中 typecheck、5 项 exports/package 检查及 packed consumer 通过，版本化 runner 6 项通过；adapter 原生 bridge 定向测试 3 文件/9 项通过。
- Adapter 版本化 runner 测试为 6 项通过。`npm pack --dry-run --ignore-scripts --json` 检查到 31 个发布文件，含 `dist`、README 所链接的协议文档及 Pi 1.2.0/1.3.0 patch/manifest，不含 `src/**`、`test/**` 或 source map；未发布 npm 包。
- Pi 1.3.0 fresh packed CLI runtime smoke：Pi tarball SHA-256 `b929058ead39f7766452aa32457f0b369b31da630165cab585614f7164c32e26`，adapter tarball SHA-256 `d4b6ee49f8f5d21b527779321b15e25aeeec22943a2327a9643198ef52f06428`。二者安装在相互隔离的临时目录；adapter 的 Pi peer 被省略，且没有 ancestor `node_modules`。用实际 `dist/bundle/cli.js`、packed adapter 和本地 stdio fixture 执行 RPC：观测到完整 public management API/18 项 capabilities、owner assembly 中 `assembly_fixture` 连接成功并取得 3 项 live tools、`/mcp-adapter` prompt 被处理、`notify`/`setStatus` 发出；无模型推理事件，EOF 后 CLI 退出码 0，fixture 子进程退出。fixture 只记录 `initialize` 与 `tools/list`，未调用 tool，也未访问真实 MCP、LLM、用户配置或凭据。完整 transcript、probe 和 fixture 日志保存在隔离目录 `/tmp/pi-mcp-evidence-1.3.nbLEJX/runtime/packed-final/`。
- Adapter tarball 通过 `npm run test:public-types -- --pi-source <fixed patched checkout>` 产生并验证的 `dist`，随后以 `npm pack --ignore-scripts` 打包；裸 `npm pack` 会重新执行 `prepack` 并使用 adapter 本地 stock Pi 1.2.0 开发类型，导致缺少 patched management exports 的声明构建失败。`npm run check` 和 Pi 全量测试未运行；不得将定向测试/构建扩展解释为全量 check 通过。未修改、提交或推送 Pi 上游。managed launcher hook 的本机安装、release pointer 切换与验证见上一节；没有运行真实 `pi update --all`。
