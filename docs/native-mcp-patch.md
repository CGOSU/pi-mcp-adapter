# 固定 Pi 基线的原生 MCP 补丁

本文是 Pi 原生 MCP adapter 补丁的复现和验证说明。仅覆盖下列两个固定源码 commit；版本号匹配但 commit 不同、stock Pi 或不完整补丁均不视为已验证宿主。Pi 原生 MCP 仍是唯一连接、认证和工具执行 owner；adapter 提供配置/provenance、keyring 接线和管理增强，不创建第二套 runtime，也没有 capability fallback。

## 固定交付

| Pi package | 固定源码 commit | 补丁 | Patch SHA-256 | 路径数 | Manifest | Manifest SHA-256 |
| --- | --- | --- | --- | ---: | --- | --- |
| `@earendil-works/pi-coding-agent` 1.2.0 | `06a466935536f8c9bcacb2d5efc0fc021be1bdff` | [`pi-1.2.0-native-mcp-management.patch`](../patches/pi-1.2.0-native-mcp-management.patch) | `d499d6fba6728dbaced2876149b362780ce4b8ef2129ec3283587a456c46c654` | 48 | [`pi-1.2.0-native-mcp-management.json`](../patches/pi-1.2.0-native-mcp-management.json) | `d7507252bc0c98df8f04d33fb0bf10092a128e19ec40e2b5d31dd8f552e664c6` |
| `@earendil-works/pi-coding-agent` 1.3.0 | `71023aec1546d6d677a65669c5665c0927ce0dd0` | [`pi-1.3.0-native-mcp-management.patch`](../patches/pi-1.3.0-native-mcp-management.patch) | `953d4911373cddaa133989515786e247369edb43aad438dfca5170d0a00d3d78` | 48 | [`pi-1.3.0-native-mcp-management.json`](../patches/pi-1.3.0-native-mcp-management.json) | `74299aad3344204e462b115cb9935259e25db5d814d24a80f5c33f3ae5603c9b` |

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

## 已执行验证与边界

- Pi 1.2.0：在独立固定 checkout `06a466935536f8c9bcacb2d5efc0fc021be1bdff` 上确认 apply 前干净，`git apply --check` 与 apply 成功，48 路径匹配 manifest。既有 patch SHA-256 `d499d6f...c46c654`、manifest SHA-256 `d7507252...e664c6` 未改变。本轮 `test:public-types`（typecheck、5 项 exports/package 检查、packed consumer）和真实 same-session runner 各通过。
- Pi 1.3.0：在新建 detached checkout `71023aec1546d6d677a65669c5665c0927ce0dd0` 上确认 apply 前干净，`git apply --check` 与 apply 成功，48 路径（22 修改、26 新增）匹配 manifest；`git diff --check` 通过。Patch SHA-256 为 `953d491...00d3d78`。四个原生定向测试文件共 53 项通过；`test:public-types` 中 typecheck、5 项 exports/package 检查、packed consumer 通过；真实 same-session runner 1 项通过。
- Adapter 版本化 runner 测试为 6 项通过。`npm pack --dry-run --ignore-scripts --json` 检查到 31 个发布文件，含 `dist`、README 所链接的协议文档及 Pi 1.2.0/1.3.0 patch/manifest，不含 `src/**`、`test/**` 或 source map；未发布 npm 包。
- 未运行完整 Pi `npm test`、`npm run build` 或 `npm run check`，未声称完整上游类型检查通过；未修改、提交或推送 Pi 上游，也未改动用户运行中的 Pi。
