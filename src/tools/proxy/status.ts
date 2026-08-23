import type { McpExtensionState } from "../../extension/state.ts";
import { getFailureAgeSeconds } from "../../extension/initialization.ts";
import { isServerDisabled } from "../../contracts/core.ts";
import type { ProxyToolResult } from "./shared.ts";

export function executeStatus(state: McpExtensionState): ProxyToolResult {
  const servers: Array<{ name: string; status: string; toolCount: number; failedAgo: number | null; disabled?: boolean }> = [];

  for (const name of Object.keys(state.config.mcpServers)) {
    const definition = state.config.mcpServers[name];
    const disabled = isServerDisabled(definition);
    const connection = disabled ? undefined : state.manager.getConnection(name);
    const metadata = disabled ? undefined : state.toolMetadata.get(name);
    const failedAgo = disabled ? null : getFailureAgeSeconds(state, name);
    let status = disabled ? "disabled" : "not connected";
    if (!disabled && connection?.status === "connected") {
      status = "connected";
    } else if (!disabled && connection?.status === "needs-auth") {
      status = "needs-auth";
    } else if (!disabled && failedAgo !== null) {
      status = "failed";
    } else if (!disabled && metadata !== undefined) {
      status = "cached";
    }

    const toolCount = status === "failed" ? 0 : metadata?.length ?? 0;

    servers.push({ name, status, toolCount, failedAgo, ...(disabled ? { disabled: true } : {}) });
  }

  const disabledCount = servers.filter(s => s.disabled).length;
  const enabledServers = servers.filter(s => !s.disabled);
  const totalTools = enabledServers.reduce((sum, s) => sum + s.toolCount, 0);
  const connectedCount = enabledServers.filter(s => s.status === "connected").length;

  let text = `MCP: ${connectedCount}/${enabledServers.length} servers, ${totalTools} tools`;
  if (disabledCount > 0) text += ` (${disabledCount} disabled)`;
  text += "\n\n";
  for (const server of servers) {
    if (server.disabled) {
      text += `⊘ ${server.name} (disabled)\n`;
      continue;
    }
    if (server.status === "connected") {
      text += `✓ ${server.name} (${server.toolCount} tools)\n`;
      continue;
    }
    if (server.status === "needs-auth") {
      text += `⚠ ${server.name} (needs auth)\n`;
      continue;
    }
    if (server.status === "cached") {
      text += `○ ${server.name} (${server.toolCount} tools, cached)\n`;
      continue;
    }
    if (server.status === "failed") {
      text += `✗ ${server.name} (failed ${server.failedAgo ?? 0}s ago)\n`;
      continue;
    }
    text += `○ ${server.name} (not connected)\n`;
  }

  if (servers.length > 0) {
    text += `\nmcp({ server: "name" }) to list tools, mcp({ search: "..." }) to search`;
  }

  return {
    content: [{ type: "text" as const, text: text.trim() }],
    details: { mode: "status", servers, totalTools, connectedCount, disabledCount },
  };
}
