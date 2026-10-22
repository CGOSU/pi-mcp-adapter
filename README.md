<p>
  <img src="banner.png" alt="pi-mcp-adapter" width="1100">
</p>

# Pi MCP 适配器

在 Pi 中使用 MCP 服务器，同时减少工具定义对上下文窗口的占用。

<https://github.com/user-attachments/assets/4b7c66ff-e27e-4639-b195-22c3db406a5a>

## 为什么需要它

Mario 曾写过一篇文章讨论[你是否真的需要 MCP](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)。问题在于：工具定义很冗长。一个 MCP 服务器就可能占用一万多个 token；无论是否使用这些工具，这部分成本都会一直存在。连接几个服务器后，对话甚至还没开始，上下文窗口就可能已经消耗了一半。

他的建议是完全跳过 MCP，改用简单的命令行工具。

但 MCP 生态中也有数据库、浏览器和 API 等实用工具。本适配器让 Pi 按需发现和调用这些工具，避免一开始就把所有定义塞进上下文。在旧版适配器运行时中，模型只需看到一个约 200 token 的代理工具，而不是数百个工具；服务器也只会在真正使用时启动。

## 安装

从 Git 仓库安装当前开发版本：

```bash
pi install git:github.com/CGOSU/pi-mcp-adapter.git
```

通过 Git 安装的 Pi 扩展不会在仅安装生产依赖时编译 TypeScript。公共 Node 辅助入口随仓库提交了构建产物，并会在 npm 打包前重新构建。

安装后重启 Pi。

### 必需的 Pi 宿主版本

此版本只对下列**固定源码基线且应用了对应补丁**的 Pi 版本完成验证：

- `@earendil-works/pi-coding-agent` `1.2.0`，源码 commit `06a466935536f8c9bcacb2d5efc0fc021be1bdff`；
- `@earendil-works/pi-coding-agent` `1.3.0`，源码 commit `71023aec1546d6d677a65669c5665c0927ce0dd0`；
- `@earendil-works/pi-coding-agent` `1.4.0`，源码 commit `4a080252f06caf63a525d7873c5d94d3c23887e0`。

未打补丁的 Pi、其他 commit 或不完整补丁均不在已验证范围内。Pi 原生管理 API 缺失或能力不完整时，`/mcp-adapter` 会明确失败，不连接 MCP 服务器，也不回退到第二套运行时。Adapter 的 peer range `^1.2.0` 只是包依赖范围，不代表该范围内任意 Pi build 都包含本适配器需要的补丁；例如本机当前运行的 stock Pi 1.4.0 仍缺少管理 API，不会因为 adapter 支持 1.4.0 而自动获得。

前置条件和可复现的补丁流程见：

- [`docs/native-mcp-patch.md`](docs/native-mcp-patch.md)：三个固定基线、独立补丁、apply 步骤、测试范围和公共产物验证；
- [`patches/pi-1.2.0-native-mcp-management.json`](patches/pi-1.2.0-native-mcp-management.json)、[`patches/pi-1.3.0-native-mcp-management.json`](patches/pi-1.3.0-native-mcp-management.json) 与 [`patches/pi-1.4.0-native-mcp-management.json`](patches/pi-1.4.0-native-mcp-management.json)：对应基线、补丁 SHA-256、能力和验证范围的机器可读清单；
- [`docs/native-mcp-protocol.md`](docs/native-mcp-protocol.md)：版本化的 `pi.mcp-management` v1 契约。

各版补丁都不改变 Pi npm 依赖。Pi 内置 MCP 管理方仍是唯一连接、OAuth 和工具执行运行时；本适配器只提供选择加入的组装接入和界面。

### 托管 Pi 更新后的非阻断补丁

托管安装可选择安装一个本地 post-update hook。它只接入通过 `~/.pi/agent/bin/pi` 启动的 managed Pi；在 Pi 自身更新成功后，按固定 package version 查找本机已登记且 SHA-256 匹配的 Pi artifact，在独立 staging 中离线安装、验证 MCP management API，再以独立 release 和 `current-version` 指针切换。安装时须提供事先验证过的 Pi tarball；artifact 不从临时目录或未登记远端下载。在 adapter 仓库或已安装 package 的根目录执行：

```sh
npm run install:managed-pi-update-hook -- --artifact /path/to/verified-pi-coding-agent.tgz
```

安装器会备份原始 launcher，当前登记的 artifact 覆盖 Pi 1.3.0 与 1.4.0。未来执行托管 `pi update --all` 时，官方 Pi 核心更新先照常完成；未知版本、artifact 缺失或校验/安装/验证失败只警告 adapter 可能不可用，不暂停、不回滚、不 pin 核心版本，且保留 Pi 原更新退出状态。Pi 核心仍是唯一 MCP owner；stock 或不完整版本上的 adapter 继续明确失败，不启用第二套 runtime。`pi update --models` 与 `pi update --extensions` 不应用核心补丁。

删除 hook 会恢复原始 launcher；若当前指针仍指向 hook 激活的版本，也恢复先前 release。独立补丁 release 与本地 artifact 缓存保留以便审计/回滚：

```sh
npm run install:managed-pi-update-hook -- --remove
```

安装或移除后需完全退出并重新启动 Pi，当前运行进程不会因 `current-version` 指针切换而换载已加载的宿主代码。完整安装、故障语义与当前登记范围见 [`docs/native-mcp-patch.md`](docs/native-mcp-patch.md)。

### 打过补丁的宿主上的入口

| 界面             | 负责方     | 用途                                                                                |
| -------------- | ------- | --------------------------------------------------------------------------------- |
| `/mcp`         | Pi 内置扩展 | 原生 MCP 管理：`login <server>`、`logout <server>`、`reconnect <server>`，以及交互式启用、禁用和曝光管理 |
| `/mcp-adapter` | 本适配器    | 增强面板：搜索工具和资源、查看来源与信任状态、选择并保存直接工具、重连和登录                                            |

适配器入口只注册一个命令 `/mcp-adapter`，不注册自己的工具。MCP 工具、资源和提示由 Pi 原生管理方的执行链路提供。

适配器管理的 MCP 工具继续使用适配器的命名与曝光语义：`settings.toolPrefix` / `toolPrefix`（默认 `server`，命名形式为 `<server>_<tool>`），以及原生 `exposure`（默认 `codemode`，也支持 `deferred`、`direct`、`hidden`），单工具覆盖项为 `toolExposure`。适配器不会重复注册 MCP 代理工具或脚本工具。`/mcp-adapter` 在 TUI 会话中显示面板；非 TUI 会话会输出相同状态文本，并在项目 MCP 来源被信任机制屏蔽时给出提示。

### 原生管理方下的行为变化

打过补丁的 Pi 是唯一 MCP 运行时。以下旧适配器功能不会在第二个客户端中重新实现：

- **保留：** 配置发现、优先级和来源追踪；直接工具选择与持久化；包含/排除过滤；`toolPrefix`；搜索关键词；生命周期和 `idleTimeout`；逐请求 `requestHeadersCommand`；stdio/HTTP/socket 传输；Bearer token、`literalEnv` 和 `pluginDataDir`；`approveTools`；`outputGuard`；sampling、自动批准和 elicitation；资源与 prompt；通过适配器系统密钥环进行 OAuth；只读的 `MCP_STATUS_EVENT` v1 快照；`createMcpAdapter`、`registerMcpServer` 和五个公共子路径。
- **不由原生管理方启用：** `settings.scriptMode`、`disableProxyTool`、`autoAuth`、`trace`、`oauthDir`，以及服务器级 `debug`/`trace`。这些配置保持原样，并明确作为“保留但不生效”处理，不会静默丢弃。`scriptMode` 和 `disableProxyTool` 保持关闭，避免原生管理方再增加 MCP 脚本或代理执行面；`oauthDir` 不启用，避免触发明文凭据迁移。旧脚本与 MCP UI 路径使用的 `mcp-script-worker.mjs` 和 `app-bridge.bundle.js` 不再随包发布。
- **信任：** 项目级来源（共享 `.mcp.json`、项目 `.agents`/`.pi`）受 Pi 的真实项目可信度检查控制。项目不受信任时，服务器不会进入活动快照、不会连接，`setDirectTools` 也会拒绝写入。不能用调用方自行声明的 trusted 标记或把来源改写成全局配置来绕过此检查。
- **凭据：** 适配器服务器的凭据继续保存在操作系统密钥环中，并通过原生 OAuth 管理方使用；此路径不会写入原生默认的 `mcp-auth.json`，也不会把已存令牌迁移到明文文件。
- **协议范围：** 已验证的 Pi 1.2.0/1.3.0/1.4.0 固定基线仍使用原生 MCP `initialize` 时代线协议。若配置 `protocolVersion: "2026-07-28"` 或 `"auto"`，连接前会返回结构化的不支持结果，且不改写配置。

### 发布包布局

源码仓库将模块化实现保留在 `src/**`；npm 包发布可复现的 `dist/` 构建产物，而非源码目录。构建产物提供五个兼容的 ESM 公共入口：

- `pi-mcp-adapter`：Pi 扩展和 SDK API（`createMcpAdapter`、`registerMcpServer`、`MCP_STATUS_EVENT`，以及 reference/protocol helpers）；
- `pi-mcp-adapter/types`；
- `pi-mcp-adapter/config`；
- `pi-mcp-adapter/metadata-cache`；
- `pi-mcp-adapter/oauth`。

各入口保留原生 `dynamic import()` 边界，并拆分为代码块，因此扩展启动时不会急切加载 MCP 连接运行时、OAuth、命令、脚本执行或 UI 运行时。包会把独立加载的 `mcp-keyring-helper.cjs` 放在相关代码块旁。`npm run build:public` 可重新生成 `dist/`；npm 打包前的 `prepack` 会执行该构建。已发布的命令行入口为 `dist/cli.js`。

> **注意：** 当前已发布扩展入口只接入原生 MCP 管理方（见[必需的 Pi 宿主版本](#必需的-pi-宿主版本)和[原生管理方下的行为变化](#原生管理方下的行为变化)）。仓库仍保留旧的自包含适配器运行时源码并由其专属测试覆盖，但它已无法从 `dist/index.js` 到达；`mcp-script-worker.mjs` 和 `app-bridge.bundle.js` 也不再发布。下文若提到 `mcp` 代理工具、`mcpScript`、`/mcp setup`、其他旧 `/mcp` 子命令或 MCP UI bridge，描述的是仓库中保留的旧实现，不代表当前 Pi 扩展入口提供这些功能。

## 首次运行时会发生什么

适配器会自动读取标准 MCP 配置文件。如果你已经有这些文件，无需额外设置。

| 现有配置                                   | 处理方式                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `.mcp.json` 或 `~/.config/mcp/mcp.json` | Pi 会立即读取。首次打开 `/mcp` 时会简要说明检测到的文件，以及 Pi 只会把适配器专用覆盖项写入 Pi 自己的配置文件。                    |
| 尚未配置                                   | 旧版 `/mcp setup` 可创建最简 `.mcp.json`、添加精选服务器或快速添加 RepoPrompt；当前原生入口以 Pi 自带 `/mcp` 管理为准。 |

## 快速开始

推荐的项目配置文件：`.mcp.json`

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@1.6.0"]
    }
  }
}
```

推荐的用户全局共享配置：`~/.config/mcp/mcp.json`。Pi 也会读取工具无关的全局路径 `~/.agents/mcp.json` 和 `~/.agents/mcp/mcp.json`。

Pi 还会读取 Pi 自己的覆盖文件：

- `<Pi agent dir>/mcp.json`：Pi 全局覆盖项（默认是 `~/.pi/agent/mcp.json`）；
- `.pi/mcp.json`：Pi 项目覆盖项。

适配器只读取上述标准 MCP 来源和 Pi 自己的覆盖文件。`imports`、`settings.hostConfigDiscovery` 等未知旧字段会被忽略。

优先级从低到高为：

1. `~/.config/mcp/mcp.json`
2. `~/.agents/mcp.json`
3. `~/.agents/mcp/mcp.json`
4. `<Pi agent dir>/mcp.json`
5. `.mcp.json`
6. `.pi/mcp.json`

旧版 `/mcp disable <server>` 和 `/mcp enable <server>` 只会把 `disabled` 字段写入项目级 `.pi/mcp.json`，它是优先级最高的 Pi 配置层。若较低层已启用，启用操作会移除项目覆盖；若较低层禁用了服务器，则必要时写入 `false` 进行覆盖。操作不会改写共享配置文件，也不会复制凭据。修改后运行 `/reload`，刷新已注册的工具界面。手动操作时，可在任意标准 MCP 配置的服务器条目中设置 `{ "disabled": true }`。通过 `createMcpAdapter({ config })` 提供的内存配置彼此隔离，不会读取或写入此项目覆盖；这种模式下也没有这些命令。

服务器默认采用 lazy（按需连接）模式：只有实际调用工具时才连接。适配器会缓存工具元数据，因此即使没有实时连接，也可以搜索和描述工具。

当有效元数据缓存只覆盖 lazy 服务器时，扩展也会在 `session_start` 阶段延迟导入完整 MCP 运行时；第一次 MCP 操作才承担一次性的运行时加载和连接成本。eager、keep-alive、空缓存或无效缓存，以及显式直接工具启动仍保留原有初始化行为。这只是把启动工作推迟，并不会消除连接成本。

以下示例描述旧运行时中的 `mcp` 代理工具；当前原生入口不注册该工具：

```js
mcp({ search: "screenshot" })
```

旧代理工具可能返回如下工具说明：

```text
chrome_devtools_take_screenshot
  对页面或元素截图。

  参数：
    format (enum: "png", "jpeg", "webp") [默认: "png"]
    fullPage (boolean) - 截取整页，而非当前视口
```

旧运行时的调用形式：

```js
mcp({ tool: "chrome_devtools_take_screenshot", args: { format: "png" } })
```

`args` 可以是 JSON 对象或 JSON 字符串。若模型能稳定处理，优先使用对象；对需要更简单 schema 的提供方，仍支持字符串形式。

这样可用两次代理调用代替把 26 个工具定义都放入上下文。

## 配置

### 配置文件布局

希望多种宿主共享设置时使用共享 MCP 文件；需要 Pi 专属覆盖项时使用 Pi 自己的配置文件。

| 文件                        | 用途                                  |
| ------------------------- | ----------------------------------- |
| `~/.config/mcp/mcp.json`  | 用户全局共享 MCP 配置                       |
| `~/.agents/mcp.json`      | 用户全局、与工具无关的 MCP 配置                  |
| `~/.agents/mcp/mcp.json`  | 用户全局、与工具无关的 MCP 配置                  |
| `.mcp.json`               | 项目本地共享 MCP 配置                       |
| `<Pi agent dir>/mcp.json` | Pi 全局覆盖项（默认 `~/.pi/agent/mcp.json`） |
| `.pi/mcp.json`            | Pi 项目覆盖项                            |

当 Pi 需要保存 `directTools` 等适配器专用设置时，共享全局服务器的 Pi 专属写入目标是 Pi 自己的配置文件。

### Agent Plugins

可在 `settings.agentPluginPaths` 中列出 Agent Plugins 包目录，让适配器从这些包加载 MCP 服务器：

```json
{
  "settings": {
    "agentPluginPaths": ["./plugins/acme-tools"]
  },
  "mcpServers": {}
}
```

每个目录必须包含有效的 Agent Plugins 1.0 `plugin.json`。若目录根部还有 `mcp.json`，适配器会读取其中的 `mcpServers` 并将服务器名改为 `<plugin>__<server>`。加载器按服务器的 `type` 使用 Agent Plugins 声明的传输类型；无效条目会被跳过，不影响其他服务器。对于 stdio 插件服务器，只会在 `args`、`env` 和 `cwd` 中展开 `${PLUGIN_ROOT}` 与 `${PLUGIN_DATA}`；适配器会为子进程设置这两个变量，并将插件数据保存在 Pi agent 目录下。

Agent Plugins 是可移植的包格式。Pi 原生 MCP 配置仍使用 `.mcp.json`、`~/.config/mcp/mcp.json` 和 Pi 自己的覆盖文件。

### Pi 包清单

Pi 包可以为已安装的适配器提供 MCP 服务器，无需另建 MCP 配置文件。可在包的 `package.json` 中声明相对路径：

```json
{
  "pi": {
    "mcp": "./mcp.json"
  }
}
```

`pi.mcp` 也可以是包内相对路径数组。文件采用标准 `mcpServers` 对象格式，但包清单只加载服务器条目，忽略包内 `settings`。服务器名会加上经过净化的包名作为前缀，例如 `acme_tools__docs`；用户、全局和项目 MCP 配置优先级更高。适配器只加载 Pi 设置中列出的 Pi 包，不扫描 `node_modules`。

### 由其他扩展动态注册

扩展可以在运行时向已安装的适配器注册 MCP 服务器，例如在加载后才发现插件的插件宿主：

```ts
import { registerMcpServer } from "pi-mcp-adapter";

export default function pluginHost(pi) {
  const registration = registerMcpServer({
    pi,
    name: "acme__docs",
    definition: {
      url: "https://mcp.example.com/mcp",
    },
  });
  // 稍后在卸载插件时：
  await registration.dispose();
}
```

动态注册只对当前会话有效，不会写入配置文件。若服务器名与配置项或其他注册重复，会安全失败。注册服务器沿用普通的按需连接、OAuth、审批和关闭行为；其工具会在下一次工具同步时出现。若要更改定义，先 dispose 再重新注册。当前 Pi 实例没有安装适配器时，注册会抛出错误。

### SDK 配置

若 SDK 或服务器集成已经负责提供 MCP 配置，可使用 `createMcpAdapter`：

```ts
import { createMcpAdapter } from "pi-mcp-adapter";

const extension = createMcpAdapter({
  config: {
    mcpServers: {
      docs: {
        url: "https://mcp.example.com/mcp",
        lifecycle: "eager",
      },
    },
  },
});

// 将 `extension` 注册到宿主 SDK。
```

已发布的包提供构建好的 ESM 入口，因此独立 Node.js 消费者无需 TypeScript 加载器即可导入公共辅助函数。仓库根目录的 `.ts` 文件仍作为本地开发时的源码兼容入口；Pi 扩展和 npm exports 均解析到 `dist/`。

传入的 `config` 是完整且隔离的配置快照，不会与文件、imports、全局配置、项目配置或 `--mcp-config` 合并，也不会被修改。每个适配器工厂和会话都会获得自己的副本，因此不同集成可以安全使用不同的服务器与设置。在该模式下，服务器状态、重连、明确指定服务器的 `/mcp-auth <server>`、代理调用和直接工具仍可使用；设置向导以及无参数认证/状态面板会明确报告配置隔离限制，不会擅自发现或写入环境配置。

只传 `configPath` 而不传 `config` 时，适配器仍按普通文件规则合并配置，且该路径优先于 argv 和 `--mcp-config`。默认导出仍采用普通文件配置。OAuth 凭据保存在操作系统凭据存储中，并按服务器名索引；URL 绑定可防止凭据被用于不同的服务器地址。`settings.oauthDir` 和 `MCP_OAUTH_DIR` 仅用作旧版 `tokens.json` 明文文件的导入位置，不是凭据命名空间。CSRF 状态和 PKCE verifier 属于单独的认证流程，并发流程不会共享临时秘密。

协作扩展可以导入 `pi-mcp-adapter/oauth`，按 URL 复用 OAuth token，而不必深层导入私有文件：

```ts
import { getMcpOAuthTokensForUrl, updateMcpOAuthTokensForUrl } from "pi-mcp-adapter/oauth";

const tokens = await getMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp");
updateMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp", { accessToken: "..." });
```

该公共子路径只暴露 token 读取/更新和状态查询辅助函数。异步读取会先运行适配器的刷新逻辑。辅助函数负责安全存储、URL 绑定、刷新持久化、分块处理、旧格式导入，以及在凭据存储不可用时安全失败；不会暴露客户端注册秘密、PKCE verifier 或 OAuth state。

### 运行时状态快照

扩展可以订阅版本化共享事件通道，而不必解析 `/mcp` 或 `mcp({})` 的文本输出：

```ts
import { MCP_STATUS_EVENT, type McpStatusSnapshot } from "pi-mcp-adapter";

pi.events.on(MCP_STATUS_EVENT, (snapshot) => {
  const status = snapshot as McpStatusSnapshot;
  // status.servers 包含 connected、cached、failed、needs-auth、
  // not-connected 或 disabled 状态的条目。
});
```

快照是只读、机器可读的数据，每台服务器的条目均为副本。快照包含 `totalTools`、`totalResources`、`connectedCount` 和 `disabledCount`；每台服务器包含 `name`、`status`、`toolCount` 和 `disabled`，已知时还包含 `resourceCount`，仅在失败仍有效时包含 `failedAgoSeconds`。读取状态不会连接按需启动的服务器、开始认证，也不会暴露 SDK client、transport、凭据或服务器定义。初始化后会发布首个快照；状态或元数据变化时会发布更新；会话关闭时会发布空快照。初始化会等权威元数据同步到 Pi 当前直接工具注册表后，才发布首个快照。因此 `connected` 状态表示面向模型的工具界面已经同步，包括权威目录为空时撤下过期缓存工具。

下方配置示例中的 `30000` 仅为说明用途。省略 `requestTimeoutMs` 或将其设为 `<= 0` 时，使用 MCP SDK 默认超时。

### 服务器选项

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "lifecycle": "lazy",
      "idleTimeout": 10,
      "requestTimeoutMs": 30000
    }
  }
}
```


| 字段 | 说明 |
| --- | --- |
| `command` | stdio 传输使用的可执行程序；不能与 `url` 或 `socket` 同时设置。 |
| `args` | 命令行参数。 |
| `socket` | 显式指定的 `rmcp-mux` Unix domain socket 路径；支持 `${VAR}`、`$env:VAR` 和 `~` 展开，且不能与 `command` 或 `url` 同时设置。 |
| `env` | 环境变量；支持 `${VAR}` 和 `$env:VAR` 插值。值以 `!` 开头时，会在 stdio 服务器连接时执行命令；用 `!!` 表示字面量开头的 `!`。 |
| `cwd` | 工作目录；支持 `${VAR}`、`$env:VAR` 和 `~` 展开。 |
| `url` | HTTP 端点（Streamable HTTP，必要时回退 SSE）；支持原样 `${VAR}` 和 `$env:VAR` 插值。URL 变量缺失时会在发送请求前失败。 |
| `headers` | HTTP 请求头；支持 `${VAR}` 和 `$env:VAR` 插值。值以 `!` 开头时，会在 HTTP 服务器连接或 OAuth 认证时执行命令；用 `!!` 表示字面量 `!`。 |
| `requestHeadersCommand` | 每次 HTTP 请求都会执行的可信命令。stdin 接收包含 `method`、`url` 和精确 `bodyBase64` 的版本化 JSON envelope；stdout 必须返回 JSON 请求头对象。`command`、`args` 和 `env` 支持环境变量插值。可用于绑定调用内容的请求签名；命令失败会中止请求。 |
| `auth` | `"bearer"` 或 `"oauth"`。 |
| `oauth.grantType` | `"authorization_code"`（默认）或用于非交互机器认证的 `"client_credentials"`。 |
| `oauth.clientId` | 预注册 OAuth 客户端 ID。MCP 2026 优先使用预注册客户端或 Client ID Metadata Document；若未提供 ID 且服务器支持，旧运行时会回退到动态客户端注册。 |
| `oauth.clientSecret` | 保密客户端的 OAuth client secret。值以 `!` 开头时，会在 OAuth 认证时执行命令；用 `!!` 表示字面量 `!`。 |
| `oauth.scope` | 请求的 OAuth scope。 |
| `oauth.redirectUri` | 浏览器 OAuth 使用的精确 localhost 回调地址，包括端口和路径；用于提供方要求预注册回调的场景。 |
| `oauth.clientName` | 动态客户端注册回退时向服务器公布的客户端显示名称。 |
| `oauth.clientUri` | 动态客户端注册回退时公布的客户端主页。若宿主清单配置了 `piConfig.clientUri`，默认使用该值；若宿主已重新命名而未提供该字段，则省略，不猜测。 |
| `oauth.logoUri` | 动态客户端注册回退时公布的客户端 logo URL（RFC 7591 `logo_uri`）。必须是绝对 `http(s)` URL；同意页由服务端抓取，提供本地路径不会显示图片。未设置时不发送该字段。 |
| `oauth.skipIssuerMetadataValidation` | 设为 `true` 可跳过该服务器的 OAuth authorization-server metadata issuer 校验。这会削弱 OAuth mix-up 防护，只应临时用于已知配置错误且正在修复的内部服务器。 |
| `bearerToken` / `bearerTokenEnv` | token 或环境变量名；`bearerToken` 支持 `${VAR}` 和 `$env:VAR` 插值。值以 `!` 开头时，会在 HTTP 服务器连接时执行命令；用 `!!` 表示字面量 `!`。 |
| `bearerTokenStore` | 设为 `true` 时，若 `auth` 为 `"bearer"` 且未配置 `bearerToken` 或 `bearerTokenEnv`，从适配器自己的操作系统凭据存储读取静态 Bearer token。记录只按服务器名索引、绑定解析后的服务器 URL，绝不以配置内容命名。使用 `pi-mcp-adapter token set <server>` 保存；可从遮蔽输入提示或 stdin 管道读取 token，绝不从命令参数读取。Pi 内可用 `/mcp token status <server>` 和 `/mcp token remove <server>` 管理非秘密状态；Pi 提供遮蔽秘密输入前，`/mcp token set` 保持禁用。 |
| `lifecycle` | `"lazy"`（默认）、`"eager"`、`"keep-alive"` 或 `"lazy-keep-alive"`。 |
| `idleTimeout` | 空闲断开前等待的分钟数（覆盖全局值）。 |
| `requestTimeoutMs` | 实时 MCP 调用的超时毫秒数（覆盖全局值；省略或 `<= 0` 时使用 MCP SDK 默认值）。 |
| `protocolVersion` | 旧适配器运行时曾支持 `"legacy"`（默认）、`"auto"` 或 `"2026-07-28"`。当前 Pi 原生管理方不支持后两者，见下方“当前协议支持范围”。 |
| `exposeResources` | 是否将 MCP 资源作为工具暴露（默认 `true`）。 |
| `directTools` | `true`、`string[]` 或 `false`：逐个注册工具，而不是仅通过代理访问。 |
| `toolPrefix` | 覆盖该服务器的全局 `settings.toolPrefix`（`"server"`、`"short"`、`"none"` 或 `"mcp"`）。 |
| `includeTools` | 要暴露的工具名或 glob 模式数组；匹配原始名（如 `get_screenshot`）、生成的资源工具名（如 `read_figjam`）和带前缀名称（如 `figma_get_screenshot`）。 |
| `excludeTools` | 要隐藏的工具名或 glob 模式数组；在 `includeTools` 之后应用。 |
| `searchKeywords` | `{ "tool-or-glob": ["keyword", ...] }`：为匹配工具增加搜索关键词，以提高 `mcp({ search })` 排名；不会显示给模型。 |
| `debug` | 是否显示服务器 stderr（默认 `false`）。 |
| `trace` | 是否为该服务器启用仅记录元数据的 JSONL 协议追踪；不保存 payload、prompt、工具参数/结果、认证信息或 URL。 |
| `disabled` | 服务器仍显示在配置和状态中，但禁止连接、认证、工具和资源调用；仅字面量 `true` 会禁用服务器。 |

#### 当前协议支持范围

当前发布入口使用已验证固定版本的 Pi 原生 MCP client（Pi 1.2.0/1.3.0/1.4.0），只支持 `initialize` 时代线协议。未设置 `protocolVersion` 时按 Pi 原生默认行为处理。若明确设置 `"2026-07-28"`，或设置 `"auto"` 而需要协商现代协议，适配器会在连接或执行前返回结构化“不支持”结果；不会静默回退到旧协议，也不会改写配置。

以下内容仅描述仓库保留的旧适配器运行时，不适用于当前 Pi 原生扩展入口：旧版本可选择 `"auto"` 探测 MCP 2026-07-28，再根据服务器证据回退到经典握手；也可显式固定为 `"2026-07-28"`，此时不回退到 legacy 或 SSE。

在旧运行时中，SDK 负责不同时代的请求封套、结果解码、list-changed 订阅、取消、多轮 sampling/elicitation。适配器仍严格校验 OAuth issuer。适配器级 roots、标准 MCP logging 展示，以及协议缓存提示的配置/UI 尚未实现。

预注册的浏览器 OAuth 客户端应将 `oauth.redirectUri` 设置为提供方登记的精确回调地址，例如 `"http://localhost:3118/callback"`。动态客户端通常省略该字段，并使用操作系统分配的 localhost 端口。

若内部 authorization server 发布了不匹配的 OAuth metadata 且暂时无法修复，可只对该服务器设置 `oauth.skipIssuerMetadataValidation: true`。这会削弱安全性：它会关闭 RFC 8414 issuer 回显检查，不应对公共或不受信任服务器启用。

`headers`、`bearerToken`、`oauth.clientSecret` 和 stdio `env` 中的秘密值可用前缀 `!command` 在连接或认证时读取。命令执行时会隐藏 stdin 和 stderr，stdout 上限为 1 MiB 并会去除首尾空白，必须在 10 秒内完成且输出非空；失败会终止连接或认证。读取、合并、预览、计算哈希或渲染配置时不会执行命令。用 `!!` 表示字面量 `!`；普通值和转义值仍支持环境变量插值。

本地桌面环境可设置 `bearerTokenStore: true`，选择适配器自己的凭据存储空间。凭据存储不可用、记录格式错误或保存的 URL 与当前有效 URL 不同时，不会回退到明文。字面量 token、命令生成的 token 和环境变量 token 优先级更高，现有配置行为不变。使用 `pi-mcp-adapter token set <server>` 创建或轮换 token（终端中使用遮蔽提示；也可使用 `security find-generic-password -s my-token -w | pi-mcp-adapter token set <server>` 通过 stdin 传入）。记录会绑定写入时的有效服务器 URL。token 命令要求 Node.js 22.18 或更新版本。

### 使用 rmcp-mux 共享 MCP 进程

若希望多个 Pi 会话共享同一个 stdio MCP 服务器，可通过 [`rmcp-mux`](https://github.com/VetCoders/rmcp-mux) 运行服务器，再把每个会话指向服务 socket：

```json
{
  "mcpServers": {
    "memory": {
      "socket": "~/.rmcp-servers/rmcp-mux/sockets/memory.sock"
    }
  }
}
```

适配器只拥有自己的客户端 socket，并在 Pi 运行时停止时关闭该连接。上游进程、请求路由、初始化缓存、重启策略、客户端限制和 socket 权限由 `rmcp-mux` 管理。需单独启动和配置 mux；适配器不会发现、启动、接管或停止其守护进程。socket 是明确指定的本地可信端点；除非你确实希望共享工具、状态、凭据和文件访问权限，否则不要让无关项目或用户连接同一 mux 服务。

### 远程/无头环境中的 OAuth（旧运行时）

以下流程描述旧适配器运行时；当前入口的原生 OAuth 交互由 Pi 自带的 `/mcp` 管理。

Pi 在远程服务器运行时，`/mcp-auth <server>` 会先显示可点击的授权 URL。在本地浏览器打开并授权后，回到 Pi 选择 **Yes** 打开回调输入框。浏览器可能无法加载 localhost 回调页，因为其中的 localhost 指向你的工作站；此时复制地址栏中的完整 URL 并粘贴回 Pi。如果浏览器可以直接访问 Pi 的回调，授权页会自动关闭。

无头客户端也可通过代理工具完成相同流程。持久化 OAuth 仍要求操作系统凭据存储可用；无头 Linux 通常需要已解锁的 Secret Service/libsecret 密钥环。安全存储不可用时，适配器会安全失败，不会退回明文凭据。

在 Linux 上，如果 Pi 继承了已撤销的会话密钥环而导致凭据访问失败，适配器会尝试通过 `keyctl session - node <packaged helper>` 恢复会话，使显式重新认证可以写入新凭据，而无需终止长期运行的 tmux 服务。此路径要求 `keyctl` 和 `node` 位于 `PATH`；凭据存储缺失、锁定或不可用时仍会安全失败。

旧运行时可通过以下方式启动授权：

```js
mcp({ action: "auth-start", server: "linear-server" })
```

在本地浏览器打开返回的授权 URL。授权后浏览器会跳转到 localhost 地址。远程服务器上该页面可能无法加载；仍应复制浏览器地址栏中的完整 URL，并在同一个 Pi 会话中完成流程：

```js
mcp({
  action: "auth-complete",
  server: "linear-server",
  args: { redirectUrl: "http://localhost:19876/callback?code=...&state=..." }
})
```

也可以只传 `code` 查询参数：`args: { code: "..." }`。授权 URL 和 code 都是敏感信息；在流程过期或完成前，它们可能授予 MCP 服务器访问权限。

### 生命周期模式

以下是旧适配器运行时的完整生命周期说明；当前入口中的连接生命周期由 Pi 原生管理方控制。

- **`lazy`（按需）**：启动时不连接；首次调用工具时连接；空闲超时后断开。缓存元数据可在无连接时支持搜索和列表。
- **`eager`（启动时连接）**：启动时连接，但断开后不自动重连。默认不启用空闲超时；可显式设置 `idleTimeout`。
- **`keep-alive`（保持连接）**：启动时连接。远程 HTTP 服务器会在健康检查、用户输入前和适配器触发的回合前刷新工具目录；若服务器报告会话过期，则会重连。没有空闲超时。适用于始终需要在线的服务器。
- **`lazy-keep-alive`（按需后保持）**：启动时不连接；首次调用工具时连接。启动后不因空闲而关闭，并采用与 `keep-alive` 相同的目录刷新和重连检查。适用于启动成本较高、但首次使用后应保持运行的服务器。

对远程 HTTP keep-alive 服务器，如果没有 `list_changed` 通知或通知流丢失，权威的 `tools/list` 刷新也会作为后备。每个 `tools/list` 或 `ping` 请求最多等待 5 秒，同时检查的服务器最多 10 个；临时失败采用有上限的退避策略。成功刷新只更新元数据，不重连；只有确认 HTTP 会话已过期时才完整重连并重新安装通知处理器。除非启用了 `freezeDirectTools`，动态直接工具注册会跟随刷新后的元数据。

只要有启用的服务器使用 `eager` 或 `keep-alive`，扩展加载时也会开始初始化。这支持以编程方式嵌入 Pi、且从不发出 `session_start` 的宿主；若之后启动了会话，则会话所有的运行时会取代加载时运行时。

### 全局设置

```json
{
  "settings": {
    "toolPrefix": "server",
    "idleTimeout": 10,
    "requestTimeoutMs": 30000,
    "showStatusIcon": true,
    "mcpFooterStatus": "full",
    "toolResultRendering": "compact",
    "collapsedResultLines": 1,
    "notifyOnStartupConnect": true,
    "warnOnLargeDirectTools": true,
    "approveTools": ["github_delete_*", "notion_update_*"],
    "oauthDir": ".pi/mcp-oauth",
    "trace": {
      "enabled": true,
      "file": ".pi/mcp-traces/mcp.jsonl",
      "maxBytes": 262144,
      "maxEvents": 10000
    }
  },
  "mcpServers": {}
}
```

| 设置项 | 说明 |
| --- | --- |
| `toolPrefix` | `"server"`（默认）、`"short"`（去掉 `-mcp` 后缀）、`"none"` 或 `"mcp"`（使用服务器模式规范化，并加上 `mcp__` 前缀）。服务器级 `toolPrefix` 可覆盖全局设置。 |
| `idleTimeout` | 全局空闲超时分钟数（默认 10；设为 0 可禁用）。 |
| `requestTimeoutMs` | 实时 MCP 调用的全局超时毫秒数（省略或 `<= 0` 时使用 MCP SDK 默认值）。 |
| `showStatusIcon` | 是否在 MCP 状态和连接文本中显示插头图标（默认 `true`）；设为 `false` 后显示纯文本 `MCP: ...`。 |
| `mcpFooterStatus` | 页脚状态详细程度：`"full"`（默认）、`"compact"`（仅显示 `MCP connected/enabled`）或 `"off"`（清除常驻页脚状态）。`/mcp status` 仍可使用。 |
| `toolResultRendering` | MCP 工具结果行样式：`"compact"`（默认）使用自绘行；`"boxed"` 恢复 Pi 旧版带框工具行。 |
| `collapsedResultLines` | 折叠时显示的结果文本行数：`1`、`2` 或 `3`。compact 模式默认 1 行，boxed 模式默认 3 行。 |
| `notifyOnStartupConnect` | 是否通知启动时成功的连接（默认 `true`）。设为 `false` 可隐藏常规的 `MCP: N servers connected (M tools)` 通知；连接错误和认证警告仍会显示。 |
| `agentPluginPaths` | 要加载 MCP 服务器的 Agent Plugins 包目录；相对路径以当前项目工作目录为基准。 |
| `approveTools` | 设为 `true` 可要求每次 MCP 工具调用都经批准；也可用 glob 数组，例如 `["github_delete_*", "notion_update_*"]`。服务器级 `approveTools` 会覆盖全局值。 |
| `oauthDir` | 旧 OAuth `tokens.json` 的导入目录；相对路径以当前项目工作目录为基准。设置 `MCP_OAUTH_DIR` 时以环境变量为准。当前原生管理方不启用此目录，避免凭据明文迁移。 |
| `mcpServers.<name>.directTools` | 全局直接工具默认值（默认 `false`）；服务器级设置会覆盖。 |
| `strictDirectToolArguments` | 校验直接工具输入，并对 schema 声明为对象/数组的属性恢复一层 JSON 字符串（默认 `false`）。 |
| `directToolResultDetails` | 直接工具结果详情：`"lean"`（默认）或 `"bounded"`（保留经过限制的原始 MCP 结果）。 |
| `warnOnLargeDirectTools` | 当解析出的直接工具达到 75 个或更多时显示提醒（默认 `true`）；设为 `false` 仅隐藏此提醒。 |
| `freezeDirectTools` | 初次同步后保持直接工具注册稳定，避免自动重连和列表变更通知重建系统提示。使用 `mcp({ connect: "server" })` 或 `/mcp reconnect <server>` 可主动刷新。默认 `false`。 |
| `scriptMode` | 旧运行时是否注册仅供 MCP 使用的 `mcpScript` JavaScript 工具（默认 `true`）；设为 `false` 可隐藏。当前原生入口不注册该工具。 |
| `disableProxyTool` | 当缓存中已完整提供配置的直接工具时，旧运行时是否隐藏 `mcp` 代理工具。 |
| `autoAuth` | 旧运行时在 `connect`/工具调用需要认证时是否自动执行 OAuth 并重试一次（默认 `false`）。当前原生管理方不启用。 |
| `sampling` | 是否允许 MCP 服务器通过 Pi 模型执行 sampling；会优先考虑 `modelPreferences.hints`，再使用当前/默认模型（默认：存在 UI 批准能力时开启）。 |
| `samplingAutoApprove` | 是否跳过 sampling 确认提示。无 UI 会话要启用 sampling 必须设置此项（默认 `false`）。 |
| `elicitation` | 是否允许 MCP 服务器通过 Pi 对话框请求用户输入（默认：Pi UI 可用时开启）。 |
| `outputGuard` | 是否限制过大的 MCP 输出：`true`（默认）、`false` 或 `{ maxBytes, maxLines, detailsMaxBytes }`。见[输出保护](#输出保护)。 |
| `trace` | 是否启用仅记录元数据的协议追踪。全局可设 `{ enabled: true }`，也可在服务器上设 `trace: true`。每会话 JSONL 文件默认写入 `.pi/mcp-traces/`；可设置 `file`、`maxBytes`（默认 262144）和 `maxEvents`（默认 10000）。不会保存原始 MCP payload、prompt、工具参数/结果、认证信息或 URL。 |

服务器级 `idleTimeout`、`requestTimeoutMs` 和 `approveTools` 会覆盖全局设置。`debug` 只控制 stderr 显示，与协议追踪无关。

### 工具调用审批

可使用 `approveTools` 让工具继续显示，但在执行前要求确认。适用于破坏性或成本较高的操作：隐藏工具会妨碍计划，而静默执行又风险太高。

```json
{
  "settings": {
    "approveTools": ["github_delete_*", "notion_update_*"]
  },
  "mcpServers": {
    "github": { "approveTools": ["delete_*", "merge_pull_request"] },
    "docs": { "approveTools": false }
  }
}
```

当匹配的工具通过代理工具、直接 MCP 工具、资源调用或 MCP UI iframe 调用时，Pi 会询问：**仅允许一次**、**本会话允许**或**拒绝**。会话审批只保存在内存中。无 UI 会话中匹配的调用会以 `approval_required` 结果安全失败，而不是执行。`excludeTools` 会完全移除工具；`approveTools` 只在调用时限制仍可见的工具。


权限扩展可监听 `pi-mcp-adapter:tool-approval-request` 并同步认领审批请求：

```ts
import {
  MCP_TOOL_APPROVAL_REQUEST_EVENT,
  type McpToolApprovalRequest,
} from "pi-mcp-adapter";

pi.events.on(MCP_TOOL_APPROVAL_REQUEST_EVENT, (request: McpToolApprovalRequest) => {
  request.claim(async () => {
    return "allow_once"; // "allow_for_session" | "deny" | "abstain"
  });
});
```

请求包含 `serverName`、`originalToolName`、`prefixedToolName`、`args`、`origin` 和可选的 `signal`。最先同步认领的处理器生效。`allow_for_session` 会更新与内置对话框相同的内存审批缓存；`deny` 会阻止调用；`abstain` 或无人认领则沿用默认行为。无论 `approveTools` 如何配置，未缓存的 MCP 调用都会经过代理、直接工具、`mcpScript`、资源和 iframe 审批来源的 broker。

### 输出保护

MCP 工具或资源返回过大时，默认启用输出保护，避免单次响应耗尽模型上下文或会话文件：

- 内联文本最多 **50 KiB / 2,000 行**（与 Pi 内置 `bash` 限制一致）。超出部分会被截断为首部预览，完整文本保存到临时文件，并在结果中给出路径，供 agent 使用 `read`/`grep`；
- **图片内容块原样传递**，只限制文本输出；图片仍以原生图片内容交给 provider；
- 最多 **10 MiB** 的二进制资源会解码到私有临时文件并替换为文件引用。每个会话最多 **100 MiB**、**10,000 个文件**；会话结束时删除这些文件；
- 代理模式下，JSON 不超过 **16 KiB** 的 `details.mcpResult` 保留原始值；更大的结果会变成紧凑摘要（块数量、大小、键预览），原始 JSON 保存到临时文件。直接工具默认仅保留精简详情；设置 `settings.directToolResultDetails: "bounded"` 后，`mcpResult` 也采用相同保护。

可通过对象形式调整文本和详情限制：

```json
{
  "settings": {
    "outputGuard": { "maxBytes": 51200, "maxLines": 2000, "detailsMaxBytes": 16384 }
  }
}
```

设置 `"outputGuard": false` 或环境变量 `MCP_OUTPUT_GUARD=0` 可关闭文本和详情保护。二进制资源物化及其安全限制仍然启用。输出保护生成的溢出文件位于系统临时目录，权限为 `0600`，不会自动清理；其中可能包含敏感 MCP 输出。

### MCP 脚本工具（旧运行时）

旧版多次 MCP 调用可使用普通 JavaScript：发现、检查、调用、循环、过滤、串联或并发处理，最后返回一个结果。默认开启的旧版 `mcpScript` 工具会执行这些代码。单次 MCP 调用、搜索、描述、状态检查或认证操作应使用 `mcp`。设置 `settings.scriptMode` 为 `false` 可隐藏脚本工具。当前 Pi 原生入口不注册 `mcpScript`。

随包提供的 `mcp-scripting` skill 是独立 Pi 包资源。若要保留扩展但隐藏该 skill，可在 Pi 设置中用对象形式替换包条目并禁用包内 skills：

```json
{
  "packages": [
    { "source": "npm:pi-mcp-adapter", "skills": [] }
  ]
}
```

如果现有包条目的 `source` 带有版本固定值，请保留它。也可通过 `pi config` 禁用包资源。

以下是传给 `mcpScript` 的 `code` 参数示例：

```js
const { items } = await tools.search({ query: "search issues", server: "github" });
const candidate = items[0];
if (!candidate) return { error: "No matching tool" };

const details = await tools.describe({ path: candidate.path });
if (details.error) return details;

const result = await tools.call(details.path, { query: "is:open label:bug" });
if (!result.ok) return result;
emit({ tool: details.path, completed: true });
return result.data;
```

完整工作流见随包提供的 `mcp-scripting` skill。API 为 `await tools.search({ query, server?, limit?, offset? })`、`await tools.describe({ path })`、`tools.call(path, args)`、直接平铺调用、`emit(value)` 和捕获的 `console`。组合逻辑使用普通 JavaScript 循环和 Promise 工具；不提供 `tools.find(...).one()`、`tools.parallel(...)` 或 `tools.retry(...)` 这类链式 helper。MCP 调用返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`；一次失败不会终止脚本其他部分。结果详情包含简短的 `calls` 追踪，记录每次操作的路径或查询、结果和耗时。emit 值和 console 输出会排在最终返回值之前，组合结果仍受普通 MCP 输出保护限制。默认超时 30 秒；每个脚本运行在 worker thread 中，超时（包括死循环）时会终止 worker。

若子 agent 只能使用指定工具，可将子 Pi 的工具白名单设为 `["mcpScript"]`。父 agent 先用 `mcp({ search: "..." })` 发现名称，并在任务中提供相关带前缀名称；随后子 agent 可在没有文件系统、shell 或编辑工具的情况下循环、过滤和串联 MCP 调用。适配器的按需连接、认证、输出保护、中止处理和审批门仍会应用于每次调用。

`mcpScript` 是由 agent 编写并受信任的 MCP 脚本层，不是隔离边界。如需隔离，请在隔离环境中运行 Pi。它与 Pi 的 code-mode skill 不同：Pi skill 可批处理通用 Pi 工具；`mcpScript` 只暴露 MCP 调用，也可以作为子 agent 唯一的工具。

### MCP Prompts

MCP 服务器可在工具和资源之外公布 prompt 模板。旧适配器运行时会将缓存的 prompt 定义注册为 Pi slash command：`/mcp__<server>__<prompt>`；服务器连接后会刷新其元数据。参数支持位置形式和 `key=value` 形式，可加引号；调用 `prompts/get` 前会校验必填参数。

```text
/mcp__agent_board__create_plan "harden retry policy"
/mcp__agent_board__review_pipeline status=paused
/mcp prompts
```

Prompt 结果会合并成一条 user message；多消息结果会保留 `[user]` 和 `[assistant]` 角色标记。不具备 `prompts` capability 的服务器不会被探测。

### MCP Elicitation

Pi 提供可显示对话框的 UI 时，适配器会公布表单 elicitation 支持。表单使用 Pi 自带的 `select()` 和 `input()` 对话框，校验响应，并在提交前提供复核/编辑步骤。空表单使用确认对话框。显式拒绝会映射为 MCP `decline`；关闭对话框会映射为 `cancel`。

URL 模式只在 TUI 中公布。适配器会显示请求服务器、目标主机和完整 URL，并始终在打开浏览器前征得同意。它也会处理 URL-required 工具错误（`-32042`）及完成通知；浏览器交互完成后，应重新调用原工具。

### 直接工具

默认情况下，所有 MCP 工具都通过单一的 `mcp` 代理工具访问。这样能保持上下文精简，但模型需要先通过代理搜索发现工具。若希望指定工具直接出现在 agent 工具列表中（与 `read`、`bash`、`edit` 等并列），可在配置中添加 `directTools`。

按服务器设置：

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@1.6.0"],
      "directTools": true
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "directTools": ["search_repositories", "get_file_contents"]
    },
    "huge-server": {
      "command": "npx",
      "args": ["-y", "mega-mcp@latest"]
    }
  }
}
```

| 值 | 行为 |
| --- | --- |
| `true` | 将该服务器的所有工具分别注册为 Pi 工具。 |
| `["tool_a", "tool_b"]` | 只注册这些工具（使用原始 MCP 工具名）。 |
| 省略或 `false` | 仅通过代理访问（默认）。 |

要为所有服务器设置全局默认值：

```json
{
  "settings": {
    "directTools": true
  },
  "mcpServers": {
    "huge-server": {
      "directTools": false
    }
  }
}
```

服务器级 `directTools` 会覆盖全局设置。上例会为除 `huge-server` 外的所有服务器注册直接工具。

若只想暴露某个繁杂服务器的一部分工具，可设置服务器级 `includeTools`。值可以是原始名称、`read_<resource>` 这类生成资源名、带前缀名称或简单 glob 模式：

```json
{
  "mcpServers": {
    "dokploy": {
      "url": "http://localhost:3845/mcp",
      "directTools": true,
      "includeTools": ["get_*", "dokploy_list_apps"]
    }
  }
}
```

若保持 `directTools: true` 但隐藏特定工具，可设置 `excludeTools`。它会在 `includeTools` 之后应用：

```json
{
  "mcpServers": {
    "figma": {
      "url": "http://localhost:3845/mcp",
      "directTools": true,
      "excludeTools": ["read_figjam", "figma_get_code_connect_map"]
    }
  }
}
```

`includeTools` 和 `excludeTools` 会同时过滤直接工具、代理搜索/列表/描述结果和旧版 `/mcp` 面板视图。

每个直接工具会在系统提示中占用约 150–300 个 token（名称、描述和 schema）。适合有针对性地选择 5–20 个工具。服务器提供 75 个或更多工具时，建议继续使用代理，或通过 `string[]` 挑选少数工具。若解析出 75 个或更多直接工具，适配器会给出提醒，但仍会注册已配置的工具。将 `settings.warnOnLargeDirectTools` 设为 `false` 可只隐藏该提醒。

直接工具会从 Pi agent 目录中的元数据缓存注册（默认 `~/.pi/agent/mcp-cache.json`，也可通过 `$PI_CODING_AGENT_DIR/mcp-cache.json` 指定），启动时不需要连接服务器。新服务器首次添加 `directTools` 后尚无缓存，因此会暂时只通过代理提供工具；缓存建立后，扩展会把直接工具热加载到当前会话。支持 MCP list-change 通知的服务器，在工具或资源列表变化时会刷新当前会话。在提供 `pi.unregisterTool()` 的 Pi 版本中，刷新会从注册表移除旧直接工具；较旧 Pi 版本至少会将其从活动工具集停用。可运行 `/mcp reconnect <server>` 强制刷新。

模型有时会把对象或数组参数编码为 JSON 字符串。将 `settings.strictDirectToolArguments` 设为 `true` 后，适配器会对 schema 声明为对象/数组的属性恢复一层，再依据公布的 schema 校验完整输入。

若扩展需要 Pi 直接工具结果详情中的结构化 MCP 字段，可将 `settings.directToolResultDetails` 设为 `"bounded"`。它仍受相同输出保护限制；较小的前置结构字段会保留，较大字段会被限制为摘要，完整的受保护结果遵循输出保护的溢出文件规则。默认 `"lean"` 只保留服务器和工具元数据。

若提示缓存稳定性比自动热加载更重要，可将 `settings.freezeDirectTools` 设为 `true`。初次同步仍会运行；之后自动重连、按需连接和列表变化通知不会改变已注册工具界面。通过 `mcp({ connect: "server" })` 或 `/mcp reconnect <server>` 主动刷新仍会更新直接工具。

旧 `/mcp` 面板改变直接工具开关时，扩展会更新当前会话中的直接工具注册。通过 `/mcp setup` 写入更广泛的设置仍使用 Pi 的正常 reload 流程，因为它可能新增或重组 MCP 配置文件。

### 交互式配置和旧版命令

**交互式配置：** 旧版 `/mcp` 会打开交互面板，展示服务器、连接状态、工具和直接/代理切换。可在同一界面重连服务器或切换工具。OAuth 操作可在服务器上按 Enter，或对任意 OAuth 服务器按 `ctrl+a`。保存操作默认使用 `ctrl+s`，可通过 `mcp.panel.save` keybinding 重映射。

**首次运行设置向导：** 旧版 `/mcp setup` 可检查标准 MCP 配置路径、预览写入前后的文件差异、创建最简项目 `.mcp.json`、添加精选服务器（DeepWiki、Context7、Notion、GitHub、Chrome DevTools），或快速将 RepoPrompt 加入标准/共享 MCP 文件。

**子代理集成：** 使用 subagent 扩展时，agent 可在 frontmatter 中用 `mcp:server-name` 语法请求直接 MCP 工具。详情见 subagent README。

### MCP UI 集成（旧运行时）

MCP 服务器可通过 [MCP UI](https://github.com/MCP-UI-Org/mcp-ui) 标准提供交互界面。旧适配器运行时在工具具有 UI resource 时，会优先通过 [Glimpse](https://github.com/hazat/glimpse) 在原生 macOS 窗口打开；不可用时回退到浏览器。当前已发布的 native-only 入口不提供这条 UI bridge。

**工作流程：**

1. Agent 调用 `launch_dashboard` 之类的工具；
2. 工具元数据中的 `_meta.ui.resourceUri` 指向 UI resource；
3. pi-mcp-adapter 获取 UI HTML 并在 iframe 中打开；
4. UI 可调用 MCP 工具并向 agent 发送消息。

**原生窗口：** macOS 上若已安装 [Glimpse](https://github.com/hazat/glimpse)（`pi install npm:glimpseui`），界面会在原生 WKWebView 窗口打开，而不是浏览器标签页。设置 `MCP_UI_VIEWER=browser` 强制使用浏览器，`MCP_UI_VIEWER=glimpse` 要求原生渲染，`MCP_UI_VIEWER=none`（也接受 `off` / `disabled`）则完全不打开窗口。工具仍会运行，内联结果仍会返回 agent，只是不打开浏览器或原生窗口。适用于无头环境、CI 或只希望以内联文本接收结果的场景。屏蔽窗口时会显示一行 URL 通知，仍可手动打开。

**双向通信：** UI 发出 prompt 或 intent 后，消息会被保存并调用 `triggerTurn()` 唤醒 agent。Agent 可通过 `mcp({ action: "ui-messages" })` 读取消息，从而支持应用和 agent 实时协作。

**会话复用：** Agent 再次调用同一工具且 UI 已打开时，适配器会把新结果推送到现有窗口，而不是替换窗口，以便实时更新图表或响应用户输入。不同工具仍会替换会话。

**UI 消息类型：**

| 类型 | 用途 |
| --- | --- |
| `prompt` | 触发 agent 响应的用户消息。 |
| `intent` | 带名称和参数的结构化动作。 |
| `notify` | 发出即忘的通知。 |
| `message` | 通用消息负载。 |
| 自定义类型 | 作为 intent 转发的其他类型。 |

**读取 UI 消息：**

```js
mcp({ action: "ui-messages" })
```

返回 UI 会话中累积的消息。每条消息包含 `type`、`sessionId`、`serverName`、`toolName` 和 `timestamp`。`prompt` 类型包含 `prompt`；`intent` 类型包含 `intent` 和 `params`。

**浏览器控制：**

- **Cmd/Ctrl+Enter**：完成并关闭；
- **Escape**：取消并关闭；
- **Done/Cancel 按钮**：与键盘快捷键效果相同。

**技术说明：**

- 工具 consent gate 控制 UI 是否可调用 MCP 工具（never/once-per-server/always）；
- `_meta.ui.visibility` 控制受众：标记为 app-only 的工具不会进入模型工具列表；标记为 model-only 的工具不能由 UI iframe 调用；
- 支持 stdio 和 HTTP MCP 服务器；
- 使用本地 408KB AppBridge bundle（MCP SDK + Zod）进行浏览器与服务器通信；
- 从响应头中的标准 `_meta.ui.csp` 和兼容 OpenAI 的 `_meta["openai/widgetCSP"]` 元数据读取 CSP，同时保留 provider HTML。

### 本地示例：交互式可视化器

`examples/interactive-visualizer` 中有一个最简 MCP UI 示例，演示图表、双向消息和流式更新。在该目录中运行：

```bash
npm install
npm run build
npm run install-local
```

重启 Pi 后，让 agent 展示图表；它会调用 `show_chart`，并在 macOS 的 Glimpse 或浏览器中打开界面。运行 `npm run uninstall-local` 可移除 MCP 条目。

### 项目配置

项目共享配置优先使用 `.mcp.json`。只有需要 Pi 专属项目覆盖时才使用 `.pi/mcp.json`。项目文件的优先级高于用户全局共享配置和 Pi 全局覆盖。

## 使用方式

下表中的 `mcp` 代理调用属于旧运行时示例；当前 Pi 原生入口不注册该代理工具。

| 模式 | 示例 |
| --- | --- |
| 状态 | `mcp({ })` |
| 列出服务器 | `mcp({ server: "name" })` |
| 搜索 | `mcp({ search: "screenshot navigate", limit: 12, offset: 0 })` |
| 描述工具 | `mcp({ describe: "tool_name" })` |
| 获取说明 | `mcp({ instructions: "name" })` |
| 调用工具 | `mcp({ tool: "...", args: { key: "value" } })` |
| 连接 | `mcp({ connect: "server-name" })` |
| UI 消息 | `mcp({ action: "ui-messages" })` |
| 开始认证 | `mcp({ action: "auth-start", server: "name" })` |
| 完成认证 | `mcp({ action: "auth-complete", server: "name", args: { redirectUrl: "..." } })` |

在旧运行时中，`mcp({ connect: "server-name" })` 也会刷新已连接服务器，以便无需重启 Pi 就能加载新工具、资源、prompt 和 instructions。

MCP 代理和直接工具结果默认采用紧凑自绘行。折叠的成功结果会显示调用标题、有参数时显示受限的一行输入预览，并显示首行结果；若还有隐藏文本，会提示 `Ctrl+O to expand`。展开后可查看完整结果，返回模型的内容不变。将 `settings.toolResultRendering` 设为 `"boxed"` 可恢复 Pi 旧版带框行；设置 `settings.collapsedResultLines` 为 `2` 或 `3` 可显示更多折叠文本。

旧代理搜索同时包含 MCP 工具和 Pi 工具（来自扩展）。Pi 工具会带 `[pi tool]` 前缀并排在前面。以空格分隔的查询词会按名称、服务器、描述和配置的 `searchKeywords` 加权排序，再按页返回（`limit` 默认 12）。下一页使用 `details.nextOffset`。仍支持 `regex: true`，但正则结果不排序，只分页。


工具名会对连字符和下划线进行模糊匹配：`context7_resolve_library_id` 可以匹配 `context7_resolve-library-id`。若 `describe` 或 `tool` 无法解析名称，结果会带上最接近的候选项，方便 agent 在同一轮修正拼写或前缀。

### 搜索关键词

搜索采用字面匹配，因此查询词若与工具名称和描述使用不同词汇，可能找不到该工具。服务器级 `searchKeywords` 可为匹配工具增加词汇：

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "searchKeywords": {
        "search_code": ["grep"],
        "*": ["gh"]
      }
    }
  }
}
```

使用此配置时，`mcp({ search: "grep" })` 即使在 `github_search_code` 的名称和描述中都没有该词，也能找到工具。同理，`mcp({ search: "gh" })` 会找到 github 服务器的所有工具。

键可匹配工具原始名、带前缀名称或 glob（`*` 匹配该服务器的所有工具）；匹配到的条目会合并。关键词的权重与描述文本相同，查询与配置短语完全一致时会额外加权。关键词只影响排序搜索和正则搜索（包括 `mcpScript` 内的 `tools.search`）；不会进入工具 schema、`describe` 输出、直接工具注册或元数据缓存。基于关键词的搜索可离线使用缓存元数据。

启用 `includeSchemas` 后，搜索和描述会把常见 JSON Schema 参数渲染成紧凑 TypeScript 形状，例如 `{ query: string; limit?: number; }`；不支持的 schema 会回退到旧格式器。

对于 HTTP 服务器，Pi 会将 HTTP 503 视为暂时不可用，不会立即增加另一层重试循环。keep-alive 服务器会保留缓存元数据，并在 30 秒后重试，最长退避至 5 分钟。其他连接失败会执行一次请求形状探测，将不明确的传输错误转换为诸如 `endpoint returned HTML (200) — this URL does not appear to speak MCP` 的设置提示。健康连接不会探测。

若服务器通过 MCP `instructions` 字段提供使用指南，旧发现路径会展示摘要：`mcp({ server: "name" })` 返回预览，`mcp({ instructions: "name" })` 返回全文。说明在连接时捕获，并与工具元数据一起缓存，因此无需保持实时连接也可读取。

## 命令

下表中的 `/mcp` 旧版子命令属于原适配器运行时。当前 `/mcp` 由 Pi 内置 MCP 扩展管理；`/mcp-adapter` 用于适配器增强面板。

| 命令 | 用途 |
| --- | --- |
| `/mcp` | 交互式面板和首次设置入口。 |
| `/pi-mcp` | 当宿主占用 `/mcp` 时作为别名。 |
| `/mcp setup` | 引导创建最简 `.mcp.json`、添加精选服务器、快速添加 RepoPrompt 和检查配置路径。 |
| `/mcp tools` | 列出所有工具。 |
| `/mcp prompts` | 列出注册为 slash command 的 MCP prompts。 |
| `/mcp reconnect` | 重连所有服务器。 |
| `/mcp reconnect <server>` | 连接或重连指定服务器。 |
| `/mcp disable <server>` | 在项目 `.pi/mcp.json` 中禁用服务器（需 `/reload` 生效）。 |
| `/mcp enable <server>` | 通过项目覆盖层启用服务器（需 `/reload` 生效）。 |
| `/mcp logout <server>` | 清除服务器的 OAuth 凭据并断开连接。 |
| `/mcp-auth` | 在交互式 UI 会话中打开 OAuth 服务器选择器。 |
| `/mcp-auth <server>` | 为指定服务器设置 OAuth。 |

若旧运行时的 `settings.autoAuth` 为 `true`，`mcp({ connect: ... })`、`mcp({ tool: ... })` 和直接工具调用会在需要时自动执行 OAuth 并重试一次。

交互会话还可在 `/mcp` 中对需要认证的服务器按 `ctrl+a` 或 Enter。远程/无头会话使用代理工具的 `auth-start` 和 `auth-complete` action：先复制授权 URL 到本地浏览器，再将回调 URL 粘贴回 Pi。无服务器参数的 `/mcp-auth` 只会在交互式 UI 中打开选择器。

### MCP 输出 schema

服务器公布的工具 `outputSchema` 支持 JSON Schema draft-07 和 2020-12。未标注版本的 schema 使用 SDK 的 2020-12 默认值。代理和直接工具调用都会依据已公布 schema 校验返回的 `structuredContent`。

## 启动基准

在 `PATH` 中可以找到 Pi 的源码检出目录下运行跨平台启动对比：

```bash
npm run benchmark:startup -- --runs 3
```

该命令会启动配置目录彼此隔离的全新 Pi RPC 进程，并报告基准、冷启动（`JITI_FS_CACHE=0`）和缓存命中的扩展中位数，包括模块导入、Pi 的 `main TOTAL` 和总耗时。结果受宿主与缓存状态影响；延迟加载只是把运行时成本转移到第一次 MCP 操作，不会消除成本。

## 源码布局与启动边界

Pi 扩展公共入口仍是根目录的 `index.ts`。根目录的 `config.ts`、`metadata-cache.ts`、`types.ts` 和 `oauth.ts` 是公共消费者的兼容入口；内部模块直接导入所属领域路径，不依赖聚合入口。

实现按职责分布在：

- `src/contracts`：轻量公共/运行时契约和状态/UI schema；
- `src/catalog`：元数据缓存、目录快照、工具名和选择器索引；
- `src/config`：配置路径、读取、合并、发现、写入及包/插件加载器；
- `src/runtime`：MCP 连接、生命周期、恢复、探测、传输和处理器；
- `src/auth`：OAuth、Bearer 凭据、回调处理和密钥环辅助程序；
- `src/tools`：直接、命名空间、代理、脚本、prompt、资源、审批和渲染工具；
- `src/ui` 与 `src/commands`：UI 服务/面板与命令处理器；
- `src/extension`：安装、会话状态、所有权、初始化和工具界面协调。

启动时静态加载配置读取、缓存元数据、轻量 schema、注册辅助函数和工具表面，以及原生管理方同步读取既有系统密钥环/Bearer 令牌存储所需的凭据适配层。MCP 连接运行时、OAuth 登录流程与提供方、命令处理器、gateway/direct 执行、脚本 worker 和 UI 运行时均在缓存的原生 `dynamic import()` 边界之后。有效的全 lazy 元数据缓存可在 `session_start` 跳过完整运行时初始化；eager、keep-alive、冷缓存和显式直接工具行为保持原有语义。

测试按对应领域放在 `test/unit` 和 `test/integration`；Node 原生测试/公共包检查放在 `test/node`；可复用的进程夹具放在 `test/fixtures`。仓库保留根目录源码兼容入口；npm 包发布生成的 `dist`、CLI 文件、skills 和 UI 资源，不包含 `src/**` 和测试。

## 工作原理

- 上下文中只需一个约 200 token 的 `mcp` 工具，而不是数百个工具定义；
- 服务器默认按需启动：首次调用工具时才连接；
- 工具元数据会缓存到磁盘，因此无实时连接时也可搜索、列出和描述工具；
- 空闲服务器在 10 分钟后断开（可配置），下次使用时自动重连；
- 基于 npx 的服务器会解析为可执行文件直接路径，跳过约 143 MB 的 npm 父进程；
- MCP 服务器负责校验参数，适配器不重复校验；
- 远程 keep-alive 服务器会在健康检查、用户输入前和适配器触发的回合前刷新目录，并采用有上限的重连退避；
- 可通过 `directTools` 将指定工具从代理提升为 Pi 一等工具，使 LLM 直接看到它们，而不必先搜索。

## 限制

- 暂不支持跨会话共享服务器进程；每个 Pi 会话都会运行自己的服务器进程。
- 紧凑 MCP 结果渲染会摘要显示文本，但内联图片仍由 Pi 的图片显示设置控制，可能显示在紧凑文本摘要下方。
- Pi 在自绘工具输出前仍会保留一个分隔行，因此紧凑模式可以减少适配器渲染高度，但不能保证完全没有间隔。
- MCP sampling 仅支持文本；context inclusion、tools、stop sequences、audio 和 image content 会返回明确错误。
