import { createRequire } from "node:module";
import type { McpExtensionState } from "../../extension/state.ts";
import type { ToolMetadata } from "../../contracts/core.ts";
import { isServerDisabled } from "../../contracts/core.ts";
import { findToolByName, formatSchema } from "../tool-metadata.ts";
import { renderTsShape } from "../ts-shape.ts";
import { paginate, rankSuggestions, rankToolMatches, resolveSearchKeywords } from "../search-ranking.ts";
import { isToolCallApprovalRequired } from "../tool-approval.ts";
import { isServerInActiveFailureBackoff } from "../../extension/failure-backoff.ts";
import { truncateAtWord } from "../../utils.ts";
import {
  ambiguousToolResult,
  disabledResult,
  getEnabledToolMatches,
  serverBackoffResult,
  type ProxyToolResult,
} from "./shared.ts";

const require = createRequire(import.meta.url);
const MAX_REGEX_SEARCH_QUERY_LENGTH = 256;
const INSTRUCTIONS_PREVIEW_LENGTH = 300;
const REGEX_SAFETY_CHECK_PARAMS = {
  attackTimeout: 50,
  incubationTimeout: 50,
  timeout: 250,
} as const;

export function executeDescribe(state: McpExtensionState, toolName: string): ProxyToolResult {
  const exactMatches = getEnabledToolMatches(state, toolName, true)
    .filter((match) => !isServerInActiveFailureBackoff(state, match.server));
  if (exactMatches.length > 1) return ambiguousToolResult("describe", toolName);
  if (exactMatches.length === 0 && getEnabledToolMatches(state, toolName, false).filter((match) => !isServerInActiveFailureBackoff(state, match.server)).length > 1) {
    return ambiguousToolResult("describe", toolName);
  }

  let serverName = exactMatches[0]?.server;
  let toolMeta = exactMatches[0]?.tool;
  let disabledMatch: string | undefined;
  let failedMatch: string | undefined;

  if (!toolMeta) {
    for (const [server, metadata] of state.toolMetadata.entries()) {
      const found = findToolByName(metadata, toolName);
      if (!found) continue;
      if (isServerDisabled(state.config.mcpServers[server])) {
        disabledMatch ??= server;
        continue;
      }
      if (isServerInActiveFailureBackoff(state, server)) {
        failedMatch ??= server;
        continue;
      }
      serverName = server;
      toolMeta = found;
      break;
    }
  }

  if (!serverName || !toolMeta) {
    if (disabledMatch) return disabledResult("describe", disabledMatch);
    if (failedMatch) return serverBackoffResult(state, "describe", failedMatch);
    const suggestions = rankSuggestions(state, toolName, 5);
    const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}` : "";
    return {
      content: [{ type: "text" as const, text: `Tool "${toolName}" not found. Use mcp({ search: "..." }) to search.${suggestionText}` }],
      details: { mode: "describe", error: "tool_not_found", requestedTool: toolName, suggestions },
    };
  }

  const approvalMarker = isToolCallApprovalRequired(state.config, serverName, toolMeta, state.toolMetadata)
    ? " (requires approval)"
    : "";
  let text = `${toolMeta.name}${approvalMarker}\n`;
  text += `Server: ${serverName}\n`;
  if (toolMeta.resourceUri) {
    text += `Type: Resource (reads from ${toolMeta.resourceUri})\n`;
  }
  text += `\n${toolMeta.description || "(no description)"}\n`;

  if (toolMeta.inputSchema && !toolMeta.resourceUri) {
    const shape = renderTsShape(toolMeta.inputSchema);
    text += shape === null ? `\nParameters:\n${formatSchema(toolMeta.inputSchema)}` : `\nShape:\n${shape}`;
  } else if (toolMeta.resourceUri) {
    text += `\nNo parameters required (resource tool).`;
  } else {
    text += `\nNo parameters defined.`;
  }

  return {
    content: [{ type: "text" as const, text: text.trim() }],
    details: { mode: "describe", tool: toolMeta, server: serverName },
  };
}

export function executeSearch(
  state: McpExtensionState,
  query: string,
  regex?: boolean,
  server?: string,
  includeSchemas?: boolean,
  limit = 12,
  offset = 0,
): ProxyToolResult {
  const showSchemas = includeSchemas !== false;
  if (server && isServerDisabled(state.config.mcpServers[server])) return disabledResult("search", server);
  if (server && isServerInActiveFailureBackoff(state, server)) return serverBackoffResult(state, "search", server);

  let matches: Array<{ server: string; tool: ToolMetadata; score: number }>;
  if (regex) {
    let pattern: RegExp;
    try {
      if (query.length > MAX_REGEX_SEARCH_QUERY_LENGTH) {
        return {
          content: [{ type: "text" as const, text: `Regex query is too long; maximum length is ${MAX_REGEX_SEARCH_QUERY_LENGTH} characters.` }],
          details: { mode: "search", error: "query_too_long", query, maxLength: MAX_REGEX_SEARCH_QUERY_LENGTH },
        };
      }
      pattern = new RegExp(query, "i");
      let safety;
      try {
        const { checkSync } = require("recheck") as typeof import("recheck");
        safety = checkSync(query, "i", REGEX_SAFETY_CHECK_PARAMS);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: "Regex query rejected because safety analysis failed." }],
          details: { mode: "search", error: "unsafe_pattern", query, reason },
        };
      }
      if (safety.status !== "safe") {
        return {
          content: [{ type: "text" as const, text: `Regex query rejected as unsafe (${safety.status}).` }],
          details: { mode: "search", error: "unsafe_pattern", query, safetyStatus: safety.status },
        };
      }
    } catch {
      return {
        content: [{ type: "text" as const, text: `Invalid regex: ${query}` }],
        details: { mode: "search", error: "invalid_pattern", query },
      };
    }

    matches = [];
    const globalPrefix = state.config.settings?.toolPrefix ?? "server";
    for (const [serverName, metadata] of state.toolMetadata.entries()) {
      const definition = state.config.mcpServers[serverName];
      if (isServerDisabled(definition)) continue;
      if (isServerInActiveFailureBackoff(state, serverName)) continue;
      if (server && serverName !== server) continue;
      for (const tool of metadata) {
        const matched = pattern.test(tool.name) || pattern.test(tool.description)
          || resolveSearchKeywords(definition, tool.originalName, serverName, globalPrefix).some(keyword => pattern.test(keyword));
        if (matched) matches.push({ server: serverName, tool, score: 0 });
      }
    }
  } else if (query.trim().length === 0) {
    if (!server) {
      return {
        content: [{ type: "text" as const, text: "Search query cannot be empty" }],
        details: { mode: "search", error: "empty_query" },
      };
    }
    matches = (state.toolMetadata.get(server) ?? [])
      .map(tool => ({ server, tool, score: 0 }))
      .sort((a, b) => a.tool.name.localeCompare(b.tool.name));
  } else {
    matches = rankToolMatches(state, query, server);
  }

  const page = paginate(matches, offset, limit);
  if (page.total === 0) {
    const connectingServers = server
      ? state.config.mcpServers[server] && state.manager.isConnecting(server) ? [server] : []
      : Object.keys(state.config.mcpServers)
        .filter(name => !isServerDisabled(state.config.mcpServers[name]) && state.manager.isConnecting(name))
        .sort((a, b) => a.localeCompare(b));
    const msg = server ? `No tools matching "${query}" in "${server}"` : `No tools matching "${query}"`;
    const connectingMessage = connectingServers.length === 1
      ? ` Server "${connectingServers[0]}" is still connecting; retry in a moment.`
      : connectingServers.length > 1
        ? ` Servers ${connectingServers.map(name => `"${name}"`).join(", ")} are still connecting; retry in a moment.`
        : "";
    return {
      content: [{ type: "text" as const, text: `${msg}${connectingMessage}` }],
      details: {
        mode: "search",
        matches: [],
        count: 0,
        hasMore: false,
        nextOffset: null,
        query,
        ...(connectingServers.length > 0 ? { connectingServers } : {}),
      },
    };
  }

  let text = `Found ${page.total} tool${page.total === 1 ? "" : "s"} matching "${query}":\n\n`;
  for (const match of page.items) {
    const approvalMarker = isToolCallApprovalRequired(state.config, match.server, match.tool, state.toolMetadata)
      ? " (requires approval)"
      : "";
    if (showSchemas) {
      text += `${match.tool.name}${approvalMarker}\n`;
      text += `  ${match.tool.description || "(no description)"}\n`;
      if (match.tool.inputSchema && !match.tool.resourceUri) {
        const shape = renderTsShape(match.tool.inputSchema);
        text += shape === null
          ? `\n  Parameters:\n${formatSchema(match.tool.inputSchema, "    ")}\n`
          : `\n  Shape:\n${shape.split("\n").map(line => `    ${line}`).join("\n")}\n`;
      } else if (match.tool.resourceUri) {
        text += "  No parameters (resource tool).\n";
      }
      text += "\n";
    } else {
      text += `- ${match.tool.name}${approvalMarker}`;
      if (match.tool.description) text += ` - ${truncateAtWord(match.tool.description, 50)}`;
      text += "\n";
    }
  }
  if (page.hasMore) text += `\n${page.items.length} of ${page.total} — offset: ${page.nextOffset} for more\n`;

  return {
    content: [{ type: "text" as const, text: text.trim() }],
    details: {
      mode: "search",
      matches: page.items.map(match => ({ server: match.server, tool: match.tool.name, score: match.score })),
      count: page.total,
      hasMore: page.hasMore,
      nextOffset: page.nextOffset,
      query,
    },
  };
}

export function executeList(state: McpExtensionState, server: string): ProxyToolResult {
  const definition = state.config.mcpServers[server];
  if (!definition) {
    return {
      content: [{ type: "text" as const, text: `Server "${server}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "list", server, tools: [], count: 0, error: "not_found" },
    };
  }
  if (isServerDisabled(definition)) return disabledResult("list", server);

  const metadata = state.toolMetadata.get(server);
  const toolNames = metadata?.map(m => m.name) ?? [];
  const connection = state.manager.getConnection(server);
  if (isServerInActiveFailureBackoff(state, server)) {
    return {
      ...serverBackoffResult(state, "list", server),
      details: { mode: "list", server, tools: [], count: 0, error: "server_backoff" },
    };
  }
  const instructions = state.serverInstructions.get(server);
  let instructionsText = "";
  if (instructions) {
    const preview = truncateAtWord(instructions, INSTRUCTIONS_PREVIEW_LENGTH);
    instructionsText = `\n\nServer instructions:\n${preview}`;
    if (preview !== instructions) {
      instructionsText += `\nUse mcp({ instructions: "${server}" }) for the full text.`;
    }
  }

  if (toolNames.length === 0) {
    if (connection?.status === "connected") {
      return {
        content: [{ type: "text" as const, text: `Server "${server}" has no tools.${instructionsText}` }],
        details: { mode: "list", server, tools: [], count: 0, hasInstructions: Boolean(instructions) },
      };
    }
    if (metadata !== undefined) {
      return {
        content: [{ type: "text" as const, text: `Server "${server}" has no cached tools (not connected).${instructionsText}` }],
        details: { mode: "list", server, tools: [], count: 0, cached: true, hasInstructions: Boolean(instructions) },
      };
    }
    return {
      content: [{ type: "text" as const, text: `Server "${server}" is configured but not connected. Use mcp({ connect: "${server}" }) or /mcp reconnect ${server} to retry.${instructionsText}` }],
      details: { mode: "list", server, tools: [], count: 0, error: "not_connected", hasInstructions: Boolean(instructions) },
    };
  }

  const cachedNote = connection?.status === "connected" ? "" : " (not connected, cached)";
  let text = `${server} (${toolNames.length} tools${cachedNote}):\n\n`;

  const descMap = new Map<string, string>();
  if (metadata) {
    for (const m of metadata) {
      descMap.set(m.name, m.description);
    }
  }

  for (const tool of toolNames) {
    const desc = descMap.get(tool) ?? "";
    const truncated = truncateAtWord(desc, 50);
    text += `- ${tool}`;
    if (truncated) text += ` - ${truncated}`;
    text += "\n";
  }

  text += instructionsText;

  return {
    content: [{ type: "text" as const, text: text.trim() }],
    details: { mode: "list", server, tools: toolNames, count: toolNames.length, hasInstructions: Boolean(instructions) },
  };
}

export function executeInstructions(state: McpExtensionState, server: string): ProxyToolResult {
  const definition = state.config.mcpServers[server];
  if (!definition) {
    return {
      content: [{ type: "text" as const, text: `Server "${server}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "instructions", server, error: "not_found" },
    };
  }
  if (isServerDisabled(definition)) return disabledResult("instructions", server);
  if (isServerInActiveFailureBackoff(state, server)) return serverBackoffResult(state, "instructions", server);

  const instructions = state.serverInstructions.get(server);
  if (instructions) {
    return {
      content: [{ type: "text" as const, text: `${server} instructions:\n\n${instructions}` }],
      details: { mode: "instructions", server, length: instructions.length },
    };
  }

  const connection = state.manager.getConnection(server);
  if (connection?.status === "connected") {
    return {
      content: [{ type: "text" as const, text: `Server "${server}" does not provide instructions.` }],
      details: { mode: "instructions", server, error: "no_instructions" },
    };
  }

  return {
    content: [{ type: "text" as const, text: `No instructions cached for "${server}". Use mcp({ connect: "${server}" }) to connect and refresh.` }],
    details: { mode: "instructions", server, error: "not_connected" },
  };
}
