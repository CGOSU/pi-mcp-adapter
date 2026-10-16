# Pi 1.2.0 原生 MCP 迁移补丁

本文说明如何从固定 Pi 基线复现 adapter 所需的 native MCP 公共 API 与产物。补丁不替代 Pi 源码仓库，也不把 stock Pi 1.2.0 描述为已支持 adapter bridge。

## 固定输入

- Pi 源码基线：`06a466935536f8c9bcacb2d5efc0fc021be1bdff`。
- `@earendil-works/pi-coding-agent`：`1.2.0`，Node engine `>=22.19.0`。
- 完整源码补丁：[`patches/pi-1.2.0-native-mcp-management.patch`](../patches/pi-1.2.0-native-mcp-management.patch)。它以 binary/full-index Git diff 保存固定基线上的 48 个迁移文件，包含新增源码、测试和文档。
- 固定基线、patch SHA-256、协议能力、依赖边界和已验证命令的 machine-readable 清单：[`patches/pi-1.2.0-native-mcp-management.json`](../patches/pi-1.2.0-native-mcp-management.json)。
- 补丁不新增或移除 npm 包依赖，不改上游 package manifest/lockfile。Pi 原生 MCP runtime 仍是连接、OAuth 与执行的唯一 owner；adapter 要求完整版本化能力，不兼容的 stock/partial host 明确失败，不 fallback 到旧 runtime。

## 协议与能力

公共协议仍为 `pi.mcp-management` v1，通过 `pi.events` 发现。Patch 在已有 v1 API 上增加并实现 `server.set-direct-tools`；adapter 协商所需的全部能力是：

`server.snapshot`, `server.subscribe`, `server.enable`, `server.disable`, `server.reconnect`, `server.set-exposure`, `tool.set-exposure`, `server.set-direct-tools`, `execution.set-policy`, `catalog.refresh`, `catalog.resources`, `catalog.prompts`, `resource.read`, `resource.read-app`, `prompt.get`, `app.call-tool`, `oauth.sign-in`, `oauth.sign-out`。

`McpManagementHandle.setDirectTools(name, directTools)` 经 native owner 按 winning config provenance、可写来源与真实 project-trust 语义持久化；snapshot 仅在来源明确配置时公开服务器级 `directTools`。持久化成功后同步当前 session policy 和 snapshot；失败使用结构化结果。`setExecutionPolicy` 仍是 session-only，`setToolExposure` 仍写 `toolExposure`，二者都不冒充持久化 `directTools`。原生 `/mcp` 保留；adapter 增强 UI 使用 `/mcp-adapter`。

## 从干净基线应用

在单独的 Pi checkout 中执行；不要把已有脏开发工作区当作 apply 证明：

```sh
git checkout --detach 06a466935536f8c9bcacb2d5efc0fc021be1bdff
git status --short --branch
node -p "require('./packages/coding-agent/package.json').version"
git apply --check /path/to/pi-mcp-adapter/patches/pi-1.2.0-native-mcp-management.patch
git apply /path/to/pi-mcp-adapter/patches/pi-1.2.0-native-mcp-management.patch
npm ci --ignore-scripts --no-audit --no-fund
```

确认 apply 前工作树干净、版本为 `1.2.0`，且 `HEAD` 精确等于 manifest 中的 SHA。不要对 stock checkout 直接运行此补丁两次；如果 `git apply --check` 不通过，先核对基线和文件状态，不要强制或部分应用。

## 最小验证与公共产物

在已应用补丁的 Pi checkout 中运行原生 owner/API 及直接调用方定向测试：

```sh
cd packages/coding-agent
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run \
  test/mcp-management.test.ts \
  test/mcp-extension.test.ts \
  test/mcp-direct-tools-config.test.ts \
  test/mcp-owner-assembly.test.ts
```

在 adapter checkout 安装依赖并复现 adapter public build、发布边界和生成类型消费者：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run test:public-types -- --pi-source <patched-Pi-checkout>
```

该 runner 只为发出 Pi 1.2.0 workspace 包的实际 `dist` 声明/运行文件，逐一对所需 workspace package 执行 `tsc -p tsconfig.build.json --noCheck`；这不是 Pi 全量 typecheck 或 build 通过声明。它本地打包 patched `pi-coding-agent`，在隔离临时 adapter 副本中安装该包的类型链接，运行 adapter `typecheck`、`build:public`、public exports / package tests，并用实际 Pi public package tarball + adapter tarball 对根入口、独立 `config`/`metadata-cache`/`oauth` 子路径、factory/register helper、协议类型和 `setDirectTools` 做 TypeScript consumer 检查。所有阶段通过后，才把经过验证的 18 个生成文件同步到 adapter `dist/`；不会在 adapter 工作区安装或覆盖 Pi 包。

运行上一任务的真实同会话集成回归：

```sh
npm run test:patched-native-session -- --pi-source <patched-Pi-checkout>
```

该 runner 在同一 harness session 加载 patch 后的原生 MCP extension 和 adapter，使用本地 stdio fixture、faux provider、隔离临时配置及内存 OAuth store。固定 Pi 源码中缺少生成的 AI model-data 文件；runner 不生成或伪造该数据，而使用已安装的官方 `@earendil-works/pi-ai@1.2.0` 包（包含实际发布的 model data）作为普通 workspace 依赖。它只在 `packages/coding-agent/node_modules` 下创建一个临时的 Pi AI package link，并在 `finally` 清理；若同名 link 已存在则拒绝覆盖。测试不读取真实用户凭据或访问生产服务。

## 本轮真实验证结果与边界

本轮在独立 checkout 中确认基线 `06a466935536f8c9bcacb2d5efc0fc021be1bdff` / Pi `1.2.0`，apply 前工作树干净；`git apply --check` 与真实 `git apply` 均成功。补丁应用后的定向原生测试为 4 个文件、57 项通过。`test:patched-native-session` 在该干净 checkout 上 1 个集成测试通过。`test:public-types` 中 adapter `typecheck` 通过，public exports/package 检查为 5 项通过，实际 packed public-type consumer 编译通过，并将 18 个生成 `dist` 文件同步到当前 adapter 工作区。

未运行全量上游 `npm test`、`npm run build` 或 `npm run check`，未生成假 model data；不把上游 `--noCheck` 产物发射描述为完整上游类型验证。未在 Pi 上游提交、push、发布、部署或打 tag。Adapter Git commit/push 留给最终交付任务。
