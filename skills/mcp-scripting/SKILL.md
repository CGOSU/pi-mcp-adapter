---
name: mcp-scripting
description: Discover and call MCP tools through the available Pi 1.5+ tools and native codemode; diagnose configuration, connection, and tool visibility separately.
---

# MCP tools in Pi 1.5+

Use the tools actually available in the current session. Pi owns MCP connections, authentication, tool names, and execution. This adapter imports additional configuration sources and provides `/mcp-adapter`; it does not provide an `mcp` proxy tool or an `mcpScript` tool. The skill name is retained for existing references.

## Discover before calling

1. Check the session's declared tools. If a suitable tool is already declared, call it by its exact name and schema.
2. When `codemode` is available, use its discovery globals below. Send raw JavaScript source to `codemode`, not a JSON `code` wrapper.
3. Inspect the returned tool's declaration before constructing arguments. Call only an identifier that discovery or the current tool list actually provided.
4. A tool missing from a namespace search may be outside that namespace. Search across available tools before concluding that it is unavailable.

Discover relevant tools inside `codemode`:

```js
text(await searchTools("search documentation", { limit: 6 }));
```

List MCP tool names without assuming a server is called `mcp`:

```js
text(ALL_TOOLS.filter(({ name }) => name.startsWith("mcp__")));
```

`ALL_TOOLS` contains callable tools as `{ name, description }`. `searchTools(query, { limit?, namespace? })` ranks them; `describeTool(name)` returns a description and TypeScript declaration, or `undefined`. `describeNamespace(name)` provides a known namespace's description, instructions, and tools. Await the discovery functions.

MCP namespaces identify individual servers, such as `mcp__docs`; `namespace: "mcp"` is not a universal MCP filter. Use an exact namespace returned by the host or omit the namespace filter. Ordinary Pi extensions can provide tools such as `graph_locate` and `graph_inspect` without any MCP server. Do not infer a missing MCP connection from the absence of those tools in an MCP namespace.

## Inspect and call the exact tool

For example, **only if discovery returned `mcp__docs__search`**, inspect it:

```js
text(await describeTool("mcp__docs__search"));
```

If its declaration accepts `{ query: string }`, a subsequent script can call it:

```js
const result = await tools.mcp__docs__search({ query: "installation" });
if (result.isError) {
  text({ isError: true, content: result.content });
} else {
  text(result.structuredContent ?? result.content);
}
```

Use the actual returned identifier and argument schema, not the example's server, tool, or parameters. Pi normalizes tool identifiers for `tools.<name>` calls; do not recreate names from a server label. MCP calls return their `CallToolResult`, which can contain `content`, `structuredContent`, and `isError`. Other Pi tools may return a different shape; do not assume every call returns `{ ok, data }`.

For a declared ordinary extension tool such as `graph_locate`, use its own identity and schema. If discovery confirms that it accepts `query`, this is a Pi extension call, not an MCP connection attempt:

```js
const result = await tools.graph_locate({ query: "取消生成后按钮一直转圈" });
text(result);
```

The host `codemode` provides `text`, `image`, `return`, and normal JavaScript composition. Await all tool calls and use `Promise.allSettled` when independent calls should report failures separately. A rejected call may follow earlier calls with real effects; do not retry writes automatically. To show an MCP image block, pass that block to `image()` instead of printing its base64 data.

If `codemode` is not available, use suitable declared tools or the available `tool_search` tool according to its current schema. Do not invent `mcpScript`, `tools.search`, `tools.describe`, `tools.call`, or `emit` as native codemode APIs.

## Diagnose the right layer

- `/mcp` is Pi's session management command: live connection state, errors, authentication, reconnection, and tool exposure. It is not an agent tool named `mcp`.
- `/mcp-adapter` reports the adapter mode and names of imported registrations. Import warnings and rejection reasons appear in startup or `/reload` notifications, or in the console when no UI is present. The command does not retain or replay diagnostics. Registered does not mean connected.
- `pi mcp list` runs from a shell and does not load extensions. It checks Pi's native configuration, not servers imported only by this adapter from shared configuration or another extension.
- After changing configuration outside the session, use `/reload` to reload it. A configured command must exist in Pi's environment; `spawn … ENOENT` identifies a missing executable or path problem.
- Missing configuration, a rejected source, an untrusted project, a connection failure, hidden exposure, and an available tool that was never called are different states. Report the evidence for the actual state.
- No tool-call history alone does not prove failed loading. Check the available tool list and live server status; some ordinary extensions create their caches only on first use.

For MCP servers, Pi's default `codemode` exposure keeps individual tools out of direct declarations while making them discoverable through codemode. `direct`, `deferred`, and `hidden` have different visibility rules. Follow current host status and tool discovery instead of relying on old adapter metadata caches or historical tool names.
