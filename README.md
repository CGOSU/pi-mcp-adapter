<p>
  <img src="banner.png" alt="pi-mcp-adapter" width="1100">
</p>

# Pi MCP 适配器

面向 **Pi 1.5.0 及以上版本**，把共享 MCP 配置和 Pi 包提供的服务器导入 Pi 原生 MCP。Pi 负责连接、认证、工具发现与调用；适配器负责额外配置来源、兼容字段转换和导入诊断。

如果所有服务器都已写在 `~/.pi/agent/mcp.json` 或 `.pi/mcp.json`，Pi 本身就能读取。需要复用 `.mcp.json`、`.agents` 等共享来源时，再由本适配器导入。

## 安装与宿主要求

```sh
pi install git:github.com/CGOSU/pi-mcp-adapter.git
```

安装后重启 Pi，或在已有会话执行 `/reload`。Git 包包含已构建的 `dist/`，安装时不要求编译 TypeScript。

### Pi 宿主兼容模式

当前主线使用标准 Pi 1.5+ 的公开 `registerMcpServer`、`unregisterMcpServer`、`getMcpServers` API，不需要旧版固定补丁。未来 Pi 版本仍须提供这些 API 及兼容配置契约；版本号本身不保证任意未来版本都兼容。使用所安装 Pi 版本要求的 Node.js，适配器自身要求 Node.js ≥ 22.19.0。

仓库仍保留旧补丁增强模式及旧运行时源码。历史补丁安装、旧工具和迁移细节见[历史参考](docs/legacy-runtime.md)，不作为 Pi 1.5+ 的常规安装步骤。

## 快速开始

在需要共享配置的项目根目录创建 `.mcp.json`：

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "description": "Read and manage files in the current project",
      "timeout": 30
    }
  }
}
```

项目级来源只有在 Pi 信任该项目后才会导入。进入项目启动 Pi；已有会话修改配置后执行 `/reload`，再查看：

```text
/mcp-adapter
/mcp
```

`/mcp-adapter` 显示当前模式与适配器注册的服务器名称；`/mcp` 查看真实连接状态、工具数量和连接错误。导入警告和拒绝原因在启动或 `/reload` 时通过通知输出，无界面时写入控制台；`/mcp-adapter` 不保存或重放这些诊断。导入成功不代表连接成功。

Pi 会在会话启动时于后台连接已启用服务器。默认 `exposure: "codemode"` 的工具不会全部直接声明给模型，模型通过工具发现后调用。标准 Pi 1.5+ 不使用旧适配器的 lazy 生命周期或 `mcp-cache.json` 作为实时连接证据。

## 管理入口

| 入口 | 负责方 | 用途 |
| --- | --- | --- |
| `/mcp` | Pi 内置扩展 | 会话内查看连接、错误、工具曝光，登录、退出登录、重连、启用或禁用服务器 |
| `/mcp-adapter` | 本适配器 | 查看标准模式与适配器注册的服务器名称；不显示历史导入诊断或连接状态 |
| `pi mcp list` | Pi CLI | 在 shell 中检查 Pi 原生配置的连接和工具；不加载扩展 |

Pi 会话还支持 `/mcp login <server>`、`/mcp logout <server>`、`/mcp reconnect <server>`。标准模式的 `/mcp-adapter` 不提供旧补丁版增强管理面板。

**`pi mcp list` 不加载本适配器。** 它不会列出只由适配器从共享文件、Pi 包或其他扩展导入的服务器。检查这些服务器要在加载了适配器的会话中使用 `/mcp`。

本适配器不注册名为 `mcp` 的代理工具，也不注册 `mcpScript`。`/mcp` 是会话命令，不能当作模型工具 `mcp({...})` 调用。

## 配置来源与优先级

Pi 直接管理以下原生文件：

| 文件 | 作用 |
| --- | --- |
| `<Pi agent dir>/mcp.json` | 用户级 Pi 原生配置，默认 `~/.pi/agent/mcp.json` |
| `.pi/mcp.json` | 已信任项目的 Pi 原生配置及原生覆盖项 |

适配器额外读取以下共享文件，按表中顺序合并，后面的同名定义优先：

| 顺序 | 文件 | 范围 |
| --- | --- | --- |
| 1 | `~/.config/mcp/mcp.json` | 用户全局 |
| 2 | `~/.agents/mcp.json` | 用户全局 |
| 3 | `~/.agents/mcp/mcp.json` | 用户全局 |
| 4 | `.mcp.json` | 项目 |
| 5 | `.agents/mcp.json` | 项目 |
| 6 | `.agents/mcp/mcp.json` | 项目 |

标准模式中，**Pi 原生文件拥有的服务器名称保留给 Pi**，不会被适配器的共享来源同名注册覆盖。Pi 自己的项目／全局合并规则由宿主处理。不要把共享文件与 Pi 原生文件简单视为同一组无条件覆盖层。

未信任的项目来源不会注册。配置来源无效时，适配器会拒绝本轮额外配置导入，避免在高优先级配置损坏时意外恢复低优先级服务器；修正诊断指出的来源后执行 `/reload`。诊断只显示必要的来源、字段和原因，不打印凭据值。

### 支持的服务器字段

| 字段 | 标准 Pi 1.5+ 导入行为 |
| --- | --- |
| `command`、`args`、`env`、`cwd` | stdio 启动配置；`command` 是一个可执行程序，不是整段 shell 命令 |
| `url`、`headers` | streamable HTTP 配置 |
| `type` | 可省略；接受 `stdio`、`http`、`streamable-http`，并验证与 `command`／`url` 一致；`sse` 或矛盾的传输配置会拒绝 |
| `description` | 保留服务器摘要，交给 Pi 用于工具发现与命名空间描述 |
| `timeout` | 正数，单位为秒；归一化为适配器的毫秒字段后交给 Pi |
| `requestTimeoutMs` | 兼容旧配置的毫秒字段；省略或设为 `0` 时使用宿主默认超时，负数拒绝 |
| `enabled`、`disabled` | 控制启用；`disabled: true` 映射为关闭 |
| `exposure`、`toolExposure` | 保留 Pi 的服务器级和逐工具曝光设置 |
| `directTools` | `true` 将默认曝光设为 `direct`；工具名数组只将选中工具映射为 `direct`；显式曝光设置仍优先 |

同一条目同时使用 `timeout` 和 `requestTimeoutMs` 时，两者必须表示相同时间，例如 `timeout: 30` 与 `requestTimeoutMs: 30000`；不同值会报错，避免无意更改超时。

只选择 stdio 或 HTTP 中的一种传输。服务器名称使用字母、数字、`_` 或 `-`；最终名称与冲突校验由 Pi 处理。环境变量展开、命令路径解析及 OAuth 连接行为也由 Pi 原生 MCP 执行。

### 旧设置的处理

`settings.directTools` 可以作为共享服务器的默认直接工具设置。以下旧展示选项在标准模式中不生效，适配器会明确警告后忽略，保留配置文件原文：

```text
showStatusIcon
mcpFooterStatus
notifyOnStartupConnect
warnOnLargeDirectTools
toolResultRendering
collapsedResultLines
authRequiredMessage
```

这项处理只适用于展示选项。不支持的认证、审批、过滤、输出保护或生命周期设置仍会拒绝，不能通过忽略它们来改变原本要求的执行策略。例如 `approveTools`、`includeTools`、`outputGuard`、`bearerTokenStore`、适配器专用 `oauth` 配置不会静默丢弃。

标准模式不会读取适配器 keyring 作为 Pi 的凭据后端，也不会迁移已有凭据。需要 Pi 原生支持的 `oauth` 或 `auth` 配置时，使用 Pi 原生 `mcp.json` 格式和管理命令；适配器不重新解释这些原生服务器条目。Pi 默认 OAuth 凭据位置为 `<Pi agent dir>/mcp-auth.json`，不能将旧适配器的 keyring 说明用于推断此模式。

### Pi 包提供的配置

已安装并列入 Pi 设置的包可在 `package.json` 中声明：

```json
{
  "pi": {
    "mcp": "./mcp.json"
  }
}
```

`pi.mcp` 也可为相对路径数组。适配器只读取包内部的配置文件，为服务器名增加包名前缀，例如 `acme_tools__docs`；用户和项目配置可按同名条目覆盖包来源。包配置只提供服务器条目，不提供全局 `settings`。项目级包仍受项目信任约束，且服务器字段需要满足上述标准模式映射规则。

## 模型如何发现与调用工具

使用宿主当前实际提供的工具及参数。MCP 工具通常命名为 `mcp__<server>__<tool>`；普通 Pi 扩展也能提供工具，例如 `graph_locate` 和 `graph_inspect`，它们不需要 MCP 连接。

如果 `codemode` 可用，将原始 JavaScript 作为工具输入：

```js
text(await searchTools("search documentation", { limit: 6 }));
```

也可以检查所有可调用 MCP 工具：

```js
text(ALL_TOOLS.filter(({ name }) => name.startsWith("mcp__")));
```

调用前对返回的实际名称使用 `await describeTool(name)` 查看参数声明。`describeNamespace(name)` 可查看已知服务器命名空间的说明和工具；`namespace: "mcp"` 不是所有 MCP 工具的通用筛选条件。查找普通扩展工具时，先不限定命名空间，避免把未命中误认为未加载。

只有当发现结果确实包含 `mcp__docs__search`，且其声明接受 `query` 参数时，才可使用如下调用：

```js
const result = await tools.mcp__docs__search({ query: "installation" });
text(result.isError
  ? { isError: true, content: result.content }
  : result.structuredContent ?? result.content);
```

MCP 工具返回 `CallToolResult`，包含 `content`、可选 `structuredContent` 和 `isError`。普通 Pi 工具可能返回其他结构；不要套用旧适配器的 `{ ok, data }` 协议。可用普通循环及 Promise 组合调用，但须等待调用结束，并按工具真实结果处理失败。

未启用 `codemode` 时，可使用当前声明的直接工具，或按宿主可用 `tool_search` 的实际参数发现工具。随包提供的 [`mcp-scripting` 技能](skills/mcp-scripting/SKILL.md) 保留原名称，内容已面向当前 Pi 接口，不要求旧脚本工具。

### 工具曝光

| `exposure` | 行为 |
| --- | --- |
| `codemode`（默认） | 不直接声明全部工具，通过 codemode 发现和调用 |
| `deferred` | 用 `tool_search` 发现后加入模型直接调用列表 |
| `direct` | 直接声明给模型，也可在 codemode 中调用 |
| `hidden` | 不可调用；可通过 `toolExposure` 为特定工具设置其他曝光 |

`toolExposure` 的键使用服务器提供的原始工具名。Pi 管理最终工具标识、曝光和结果处理。没有调用历史只说明尚未调用，不能据此判断服务器断线或扩展没有加载。

## 扩展与 SDK 集成

Pi 1.5+ 扩展可直接使用宿主 `pi.registerMcpServer(name, config)`。需要适配器的配置转换和释放句柄时，可在该 Pi 实例已安装适配器的前提下使用公共辅助 API：

```ts
import { registerMcpServer } from "pi-mcp-adapter";

const registration = registerMcpServer({
  pi,
  name: "acme__docs",
  definition: { url: "https://example.com/mcp", description: "Product documentation" },
});

// 在集成方不再需要服务器时释放：
await registration.dispose();
```

注册只对当前实例有效，不写配置文件。重复名称或不支持的策略会失败；不要保留旧会话的 `pi` 引用跨会话注册。

SDK 可使用 `createMcpAdapter({ config: { mcpServers: { … } } })` 提供隔离配置。传入 `config` 时不合并共享文件；原生 Pi 已有配置的名称仍保留给原生 owner。使用 `configPath` 则走文件来源合并规则。配置映射限制与普通导入相同。

## 排查顺序

| 现象 | 检查与处理 |
| --- | --- |
| `/mcp-adapter` 显示没有注册 | 检查来源是否为空、项目是否受信任，并查看启动或 `/reload` 时的导入诊断；同名原生配置应在 `/mcp` 中查看 |
| 有字段或来源错误 | 按来源和字段修正配置，注意 `type`、超时单位及不支持的执行策略，再 `/reload` |
| 已注册但连接失败 | 在 `/mcp` 查看原生错误；`spawn … ENOENT` 通常是可执行程序或启动路径不存在 |
| 需要认证 | 使用 `/mcp login <server>`，按宿主提示完成；不要把认证错误当作未加载 |
| 已连接但模型未直接看到工具 | 检查 `exposure`，并在可用的 codemode 中用 `searchTools`／`ALL_TOOLS` 发现 |
| `pi-graph` 等扩展没有记录 | 检查普通工具列表与实际调用；它们不属于 MCP 服务器，部分扩展首次调用才创建缓存 |
| 外部修改配置后仍无变化 | 在对应会话执行 `/reload`；更换 Pi 安装版本后完全退出并重启 |

`/mcp` 提供实时连接状态；适配器的来源诊断和旧元数据缓存不能替代实时状态。排查时不要打印 `env`、请求头或凭据值。

## 开发与历史维护

公共入口包括包根、`types`、`config`、`metadata-cache` 和 `oauth`，均从 `dist/` 导出；Pi 扩展入口为 `extensions/index.js`。源码修改后须验证并重新构建发布产物，不能把源码变化当作已安装实例自动更新。

使用现有脚本按改动范围验证，例如 `npm run typecheck`、定向 Vitest 测试，以及 `node scripts/test-standard-host.mjs <Pi-package-root>`。后者验证真实标准宿主的扩展加载、注册和释放，**不会启动服务器**，不能单独证明 MCP 握手或认证成功。端到端连接验证应使用隔离配置和本地测试服务器。

开发依赖和 CI 仍保留旧补丁基线，尚未统一迁移到 Pi 1.5+。从源码目录直接加载时，本地旧 patched Pi peer 可能让适配器进入增强模式；验证标准模式须确保测试包实际解析到标准 Pi 1.5+，不能只核对启动命令的版本。

以下资料只用于历史实现或固定补丁的维护，不扩大当前标准模式的能力承诺：

- [旧运行时与固定补丁历史参考](docs/legacy-runtime.md)：旧 `mcp`／`mcpScript`、lazy 生命周期、UI bridge、增强面板及原 README 教程。
- [固定补丁构建与验证](docs/native-mcp-patch.md)：已有 Pi 1.2.0／1.3.0／1.4.0 固定资产与复现步骤。
- [增强管理协议](docs/native-mcp-protocol.md)：旧补丁版管理 API。

旧 runtime、patch、manifest 和其测试仍保留。对旧固定补丁的验证不等于标准 Pi 1.5+ 回归，标准加载器 smoke 也不替代完整连接和会话生命周期测试。
