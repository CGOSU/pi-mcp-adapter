import type { AgentToolResult, ToolInfo } from "@earendil-works/pi-coding-agent";
import { UrlElicitationRequiredError, type Client } from "@modelcontextprotocol/client";
import type { McpExtensionState } from "../../extension/state.ts";
import type { ToolMetadata, McpContent } from "../../contracts/core.ts";
import { getServerPrefix } from "../../catalog/tool-names.ts";
import { isServerDisabled } from "../../contracts/core.ts";
import {
  clearFailure,
  getFailureAgeSeconds,
  lazyConnect,
  markKeepAliveAfterConnect,
  notifyToolMetadataUpdated,
  recordFailure,
  updateMetadataCache,
  updateServerMetadata,
  updateStatusBar,
} from "../../extension/initialization.ts";
import { abortable, throwIfAborted } from "../../runtime/abort.ts";
import { combineAbortSignals, isAbortError } from "../../extension/owner.ts";
import { buildToolMetadata, findToolByName, formatSchema, getToolNames } from "../tool-metadata.ts";
import { renderTsShape } from "../ts-shape.ts";
import { reconstructPromptMetadata } from "../../catalog/metadata-cache.ts";
import { resolveMcpResultContent, transformMcpContent, transformMcpResourceContents } from "../tool-registrar.ts";
import { guardMcpOutput, guardedMcpDetails, resolveMcpOutputGuardOptions } from "../mcp-output-guard.ts";
import { maybeStartUiSession, summarizeUiSessionResult, type UiSessionRuntime } from "../../ui/session.ts";
import { formatMcpStatus, normalizeToolArguments } from "../../utils.ts";
import { SessionRecoveryAuthRequiredError, withSessionRecovery } from "../../runtime/session-recovery.ts";
import { rankSuggestions } from "../search-ranking.ts";
import { ensureToolCallApproved } from "../tool-approval.ts";
import { executeList } from "./catalog.ts";
import {
  ambiguousToolResult,
  attemptAutoAuth,
  disabledResult,
  getAuthRequiredMessage,
  getEnabledToolMatches,
  getSingleToolMatch,
  getToolMatches,
  type ProxyToolResult,
} from "./shared.ts";

type ClientCallToolResult = Awaited<ReturnType<Client["callTool"]>>;
type ClientReadResourceResult = Awaited<ReturnType<Client["readResource"]>>;

export async function executeConnect(state: McpExtensionState, serverName: string, signal?: AbortSignal): Promise<ProxyToolResult> {
  const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
  throwIfAborted(ownedSignal);
  const definition = state.config.mcpServers[serverName];
  if (!definition) {
    return {
      content: [{ type: "text" as const, text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "connect", error: "not_found", server: serverName },
    };
  }
  if (isServerDisabled(definition)) return disabledResult("connect", serverName);

  try {
    if (state.ui) {
      state.ui.setStatus("mcp", formatMcpStatus(state.config, `connecting to ${serverName}...`));
    }
    const currentConnection = state.manager.getConnection(serverName);
    let connection = currentConnection?.status === "connected"
      ? await state.manager.reconnect(serverName, definition, currentConnection, ownedSignal)
      : await state.manager.connect(serverName, definition, ownedSignal);
    if (connection.status === "needs-auth") {
      const autoAuth = await attemptAutoAuth(state, serverName, ownedSignal);
      if (autoAuth.status === "failed") {
        return {
          content: [{ type: "text" as const, text: autoAuth.message }],
          details: { mode: "connect", error: "auth_required", server: serverName, message: autoAuth.message },
        };
      }
      if (autoAuth.status === "success") {
        await state.manager.close(serverName);
        throwIfAborted(ownedSignal);
        connection = ownedSignal
          ? await state.manager.connect(serverName, definition, ownedSignal)
          : await state.manager.connect(serverName, definition);
      }
      if (connection.status === "needs-auth") {
        const message = getAuthRequiredMessage(state, serverName);
        return {
          content: [{ type: "text" as const, text: message }],
          details: { mode: "connect", error: "auth_required", server: serverName, message },
        };
      }
    }
    const prefix = state.config.settings?.toolPrefix ?? "server";
    const { metadata } = buildToolMetadata(connection.tools, connection.resources, definition, serverName, prefix, state.config.mcpServers, state.toolMetadata);
    state.toolMetadata.set(serverName, metadata);
    if (!connection.promptDiscoveryFailed) {
      state.promptMetadata?.set(serverName, reconstructPromptMetadata(serverName, connection.prompts ?? [], prefix, definition));
      state.promptMetadataLive?.add(serverName);
    }
    if (connection.instructions) {
      state.serverInstructions.set(serverName, connection.instructions);
    } else {
      state.serverInstructions.delete(serverName);
    }
    updateMetadataCache(state, serverName);
    const restored = clearFailure(state, serverName, "proxy-connect");
    if (!restored) notifyToolMetadataUpdated(state, serverName, "proxy-connect");
    markKeepAliveAfterConnect(state, serverName);
    updateStatusBar(state);
    return executeList(state, serverName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isAbortError(error, ownedSignal)) recordFailure(state, serverName, message);
    updateStatusBar(state);
    return {
      content: [{ type: "text" as const, text: `Failed to connect to "${serverName}": ${message}` }],
      details: { mode: "connect", error: isAbortError(error, ownedSignal) ? "aborted" : "connect_failed", server: serverName, message },
    };
  }
}

export async function executeCall(
  state: McpExtensionState,
  toolName: string,
  args?: Record<string, unknown>,
  serverOverride?: string,
  getPiTools?: () => ToolInfo[],
  signal?: AbortSignal,
  origin?: "proxy" | "script",
): Promise<ProxyToolResult> {
  const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
  throwIfAborted(ownedSignal);
  let serverName: string | undefined = serverOverride;
  let toolMeta: ToolMetadata | undefined;
  let autoAuthAttempted = false;
  const prefixMode = state.config.settings?.toolPrefix ?? "server";
  const disabledCallResult = (disabledServer: string, metadata?: ToolMetadata): ProxyToolResult => {
    if (!metadata) {
      const message = `Server "${disabledServer}" is disabled. Run /mcp enable ${disabledServer} and /reload to enable it.`;
      return {
        content: [{ type: "text" as const, text: message }],
        details: { mode: "call", error: "server_disabled", server: disabledServer, requestedTool: toolName, message },
      };
    }
    const message = `Server "${disabledServer}" is disabled. Run /mcp enable ${disabledServer} and /reload to enable it.`;
    const identity = metadata.resourceUri
      ? { server: disabledServer, resourceUri: metadata.resourceUri }
      : { server: disabledServer, tool: metadata.originalName };
    return {
      content: [{ type: "text" as const, text: message }],
      details: { mode: "call", error: "server_disabled", ...identity, message },
    };
  };

  if (serverName && !state.config.mcpServers[serverName]) {
    return {
      content: [{ type: "text" as const, text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "call", error: "server_not_found", server: serverName, requestedTool: toolName },
    };
  }
  if (serverName) {
    const match = getSingleToolMatch(state.toolMetadata.get(serverName), toolName);
    if (match === "ambiguous") return ambiguousToolResult("call", toolName);
    toolMeta = match;
    if (isServerDisabled(state.config.mcpServers[serverName])) {
      return disabledCallResult(serverName, toolMeta);
    }
  } else {
    const exactMatches = getEnabledToolMatches(state, toolName, true);
    if (exactMatches.length > 1) return ambiguousToolResult("call", toolName);
    if (exactMatches.length === 0 && getEnabledToolMatches(state, toolName, false).length > 1) {
      return ambiguousToolResult("call", toolName);
    }

    let disabledMatch: { serverName: string; toolMeta: ToolMetadata } | undefined;
    for (const [server, metadata] of state.toolMetadata.entries()) {
      const found = metadata.find(tool => tool.name === toolName);
      if (!found) continue;
      if (isServerDisabled(state.config.mcpServers[server])) {
        disabledMatch ??= { serverName: server, toolMeta: found };
        continue;
      }
      serverName = server;
      toolMeta = found;
      break;
    }
    if (!toolMeta && !disabledMatch) {
      for (const [server, metadata] of state.toolMetadata.entries()) {
        const found = findToolByName(metadata, toolName);
        if (!found) continue;
        if (isServerDisabled(state.config.mcpServers[server])) {
          disabledMatch ??= { serverName: server, toolMeta: found };
          continue;
        }
        serverName = server;
        toolMeta = found;
        break;
      }
    }
    if (!toolMeta && disabledMatch) return disabledCallResult(disabledMatch.serverName, disabledMatch.toolMeta);
  }

  if (serverName && !toolMeta) {
    const connected = await lazyConnect(state, serverName, ownedSignal);
    if (connected) {
      const match = getSingleToolMatch(state.toolMetadata.get(serverName), toolName);
      if (match === "ambiguous") return ambiguousToolResult("call", toolName);
      toolMeta = match;
    } else {
      const needsAuthConnection = state.manager.getConnection(serverName);
      if (needsAuthConnection?.status === "needs-auth") {
        if (!autoAuthAttempted) {
          autoAuthAttempted = true;
          const autoAuth = await attemptAutoAuth(state, serverName, ownedSignal);
          if (autoAuth.status === "failed") {
            return {
              content: [{ type: "text" as const, text: autoAuth.message }],
              details: { mode: "call", error: "auth_required", server: serverName, requestedTool: toolName, message: autoAuth.message },
            };
          }
          if (autoAuth.status === "success") {
            await state.manager.close(serverName);
            clearFailure(state, serverName);
            const connectedAfterAuth = await lazyConnect(state, serverName, ownedSignal);
            if (connectedAfterAuth) {
              const match = getSingleToolMatch(state.toolMetadata.get(serverName), toolName);
              if (match === "ambiguous") return ambiguousToolResult("call", toolName);
              toolMeta = match;
              if (!toolMeta) {
                const suggestions = rankSuggestions(state, toolName, 5);
                const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}` : "";
                return {
                  content: [{ type: "text" as const, text: `Tool "${toolName}" not found on "${serverName}" after reconnect.${suggestionText}` }],
                  details: { mode: "call", error: "tool_not_found_after_reconnect", server: serverName, requestedTool: toolName, suggestions },
                };
              }
            }
          }
        }

        if (!toolMeta && state.manager.getConnection(serverName)?.status === "needs-auth") {
          const message = getAuthRequiredMessage(state, serverName);
          return {
            content: [{ type: "text" as const, text: message }],
            details: { mode: "call", error: "auth_required", server: serverName, requestedTool: toolName, message },
          };
        }
      }

      if (!toolMeta) {
        const failedAgo = getFailureAgeSeconds(state, serverName);
        if (failedAgo !== null) {
          return {
            content: [{ type: "text" as const, text: `Server "${serverName}" not available (last failed ${failedAgo}s ago)` }],
            details: { mode: "call", error: "server_backoff", server: serverName, requestedTool: toolName },
          };
        }
      }
    }
  }

  let prefixMatchedServer: string | undefined;

  if (!serverName && !toolMeta && prefixMode !== "none") {
    const lazyExactMatches: { serverName: string; toolMeta: ToolMetadata }[] = [];
    const lazyFallbackMatches: { serverName: string; toolMeta: ToolMetadata }[] = [];
    const candidates = Object.keys(state.config.mcpServers)
      .filter(name => !isServerDisabled(state.config.mcpServers[name]))
      .map(name => ({ name, prefix: getServerPrefix(name, prefixMode) }))
      .filter(c => c.prefix && toolName.startsWith(c.prefix + "_"))
      .sort((a, b) => b.prefix.length - a.prefix.length);

    for (const { name: configuredServer } of candidates) {
      const existingConnection = state.manager.getConnection(configuredServer);
      const failedAgo = getFailureAgeSeconds(state, configuredServer);
      if (failedAgo !== null && existingConnection?.status !== "needs-auth") continue;

      let connected = await lazyConnect(state, configuredServer, ownedSignal);
      if (!connected && state.manager.getConnection(configuredServer)?.status === "needs-auth" && !autoAuthAttempted) {
        autoAuthAttempted = true;
        const autoAuth = await attemptAutoAuth(state, configuredServer, ownedSignal);
        if (autoAuth.status === "failed") {
          return {
            content: [{ type: "text" as const, text: autoAuth.message }],
            details: { mode: "call", error: "auth_required", server: configuredServer, requestedTool: toolName, message: autoAuth.message },
          };
        }
        if (autoAuth.status === "success") {
          await state.manager.close(configuredServer);
          clearFailure(state, configuredServer);
          connected = await lazyConnect(state, configuredServer, ownedSignal);
        }
      }

      if (!connected) continue;
      if (!prefixMatchedServer) prefixMatchedServer = configuredServer;
      const metadata = state.toolMetadata.get(configuredServer);
      const exactMatches = getToolMatches(metadata, toolName, true);
      if (exactMatches.length > 1) return ambiguousToolResult("call", toolName);
      if (exactMatches.length === 1) {
        lazyExactMatches.push({ serverName: configuredServer, toolMeta: exactMatches[0]! });
        continue;
      }
      const fallbackMatches = getToolMatches(metadata, toolName, false);
      if (fallbackMatches.length > 1) return ambiguousToolResult("call", toolName);
      if (fallbackMatches.length === 1) lazyFallbackMatches.push({ serverName: configuredServer, toolMeta: fallbackMatches[0]! });
    }
    const lazyMatches = lazyExactMatches.length > 0 ? lazyExactMatches : lazyFallbackMatches;
    if (lazyMatches.length > 1) return ambiguousToolResult("call", toolName);
    if (lazyMatches.length === 1) {
      serverName = lazyMatches[0]!.serverName;
      toolMeta = lazyMatches[0]!.toolMeta;
    }
  }

  if (!serverName || !toolMeta) {
    const nativeTool = !serverOverride
      ? getPiTools?.().find((tool) => tool.name === toolName && tool.name !== "mcp")
      : undefined;
    if (nativeTool) {
      return {
        content: [{ type: "text" as const, text: `"${toolName}" is a native Pi tool. Call ${toolName} directly instead of using mcp({ tool: "${toolName}" }).` }],
        details: { mode: "call", error: "native_tool", requestedTool: toolName },
      };
    }

    const hintServer = serverName ?? prefixMatchedServer;
    const available = hintServer ? getToolNames(state, hintServer) : [];
    let msg = `Tool "${toolName}" not found.`;
    if (available.length > 0) {
      msg += ` Server "${hintServer}" has: ${available.join(", ")}`;
    } else {
      msg += ` Use mcp({ search: "..." }) to search.`;
    }
    const suggestions = rankSuggestions(state, toolName, 5);
    if (suggestions.length > 0) msg += ` Did you mean: ${suggestions.join(", ")}`;
    return {
      content: [{ type: "text" as const, text: msg }],
      details: { mode: "call", error: "tool_not_found", requestedTool: toolName, hintServer, suggestions },
    };
  }

  const callIdentity = toolMeta.resourceUri
    ? { server: serverName, resourceUri: toolMeta.resourceUri }
    : { server: serverName, tool: toolMeta.originalName };

  let connection = state.manager.getConnection(serverName);
  if (connection?.status === "needs-auth") {
    if (!autoAuthAttempted) {
      autoAuthAttempted = true;
      const autoAuth = await attemptAutoAuth(state, serverName, ownedSignal);
      if (autoAuth.status === "failed") {
        return {
          content: [{ type: "text" as const, text: autoAuth.message }],
          details: { mode: "call", error: "auth_required", ...callIdentity, message: autoAuth.message },
        };
      }
      if (autoAuth.status === "success") {
        await state.manager.close(serverName);
        clearFailure(state, serverName);
        connection = state.manager.getConnection(serverName);
      }
    }

    if (connection?.status === "needs-auth") {
      const message = getAuthRequiredMessage(state, serverName);
      return {
        content: [{ type: "text" as const, text: message }],
        details: { mode: "call", error: "auth_required", ...callIdentity, message },
      };
    }
  }
  if (!connection || connection.status !== "connected") {
    const failedAgo = getFailureAgeSeconds(state, serverName);
    if (failedAgo !== null) {
      return {
        content: [{ type: "text" as const, text: `Server "${serverName}" not available (last failed ${failedAgo}s ago)` }],
        details: { mode: "call", error: "server_backoff", ...callIdentity },
      };
    }

    const definition = state.config.mcpServers[serverName];
    if (!definition) {
      return {
        content: [{ type: "text" as const, text: `Server "${serverName}" not connected` }],
        details: { mode: "call", error: "server_not_connected", ...callIdentity },
      };
    }

    try {
      if (state.ui) {
        state.ui.setStatus("mcp", formatMcpStatus(state.config, `connecting to ${serverName}...`));
      }
      connection = await state.manager.connect(serverName, definition, ownedSignal);
      if (connection.status === "needs-auth") {
        if (!autoAuthAttempted) {
          autoAuthAttempted = true;
          const autoAuth = await attemptAutoAuth(state, serverName, ownedSignal);
          if (autoAuth.status === "failed") {
            return {
              content: [{ type: "text" as const, text: autoAuth.message }],
              details: { mode: "call", error: "auth_required", ...callIdentity, message: autoAuth.message },
            };
          }
          if (autoAuth.status === "success") {
            await state.manager.close(serverName);
            connection = await state.manager.connect(serverName, definition, ownedSignal);
          }
        }

        if (connection.status === "needs-auth") {
          const message = getAuthRequiredMessage(state, serverName);
          return {
            content: [{ type: "text" as const, text: message }],
            details: { mode: "call", error: "auth_required", ...callIdentity, message },
          };
        }
      }
      updateServerMetadata(state, serverName);
      updateMetadataCache(state, serverName);
      const restored = clearFailure(state, serverName, "proxy-call-reconnect");
      if (!restored) notifyToolMetadataUpdated(state, serverName, "proxy-call-reconnect");
      markKeepAliveAfterConnect(state, serverName);
      updateStatusBar(state);
      const match = getSingleToolMatch(state.toolMetadata.get(serverName), toolName);
      if (match === "ambiguous") return ambiguousToolResult("call", toolName);
      toolMeta = match;
      if (!toolMeta) {
        const available = getToolNames(state, serverName);
        const hint = available.length > 0
          ? `Available tools on "${serverName}": ${available.join(", ")}`
          : `Server "${serverName}" has no tools.`;
        const suggestions = rankSuggestions(state, toolName, 5);
        const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}` : "";
        return {
          content: [{ type: "text" as const, text: `Tool "${toolName}" not found on "${serverName}" after reconnect. ${hint}${suggestionText}` }],
          details: { mode: "call", error: "tool_not_found_after_reconnect", server: serverName, requestedTool: toolName, suggestions },
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isAbortError(error, ownedSignal)) recordFailure(state, serverName, message);
      updateStatusBar(state);
      return {
        content: [{ type: "text" as const, text: `Failed to connect to "${serverName}": ${message}` }],
        details: { mode: "call", error: isAbortError(error, ownedSignal) ? "aborted" : "connect_failed", ...callIdentity, message },
      };
    }
  }

  if (isServerDisabled(state.config.mcpServers[serverName])) {
    return disabledCallResult(serverName, toolMeta);
  }

  const normalizedArgs = toolMeta.resourceUri ? args ?? {} : normalizeToolArguments(args);
  const approval = await ensureToolCallApproved(
    state,
    serverName,
    toolMeta,
    normalizedArgs,
    ownedSignal,
    origin ?? (toolMeta.resourceUri ? "resource" : "proxy"),
  );
  if (approval.ok === false) {
    const denied = approval.reason === "denied";
    const message = denied
      ? `The user declined approval to run MCP tool "${toolMeta.originalName}" on server "${serverName}".`
      : `MCP tool "${toolMeta.originalName}" on server "${serverName}" is approval-gated and requires an interactive session.`;
    return {
      content: [{ type: "text" as const, text: message }],
      details: {
        mode: "call",
        error: denied ? "approval_denied" : "approval_required",
        server: serverName,
        tool: toolMeta.originalName,
      },
    };
  }

  let uiSession: UiSessionRuntime | null = null;
  const requestOptions = state.manager.getRequestOptions?.(serverName, ownedSignal) ?? (ownedSignal ? { signal: ownedSignal } : undefined);

  const outputGuardOptions = resolveMcpOutputGuardOptions(state.config.settings);
  const recoverAuthConnection = async () => {
    const current = state.manager.getConnection(serverName);
    if (current?.status === "connected") return current;

    if (!autoAuthAttempted) {
      autoAuthAttempted = true;
      const autoAuth = await attemptAutoAuth(state, serverName, ownedSignal);
      if (autoAuth.status === "failed") {
        throw new SessionRecoveryAuthRequiredError(serverName, autoAuth.message);
      }
      if (autoAuth.status === "success") {
        const definition = state.config.mcpServers[serverName];
        if (!definition) return undefined;
        const afterAuth = state.manager.getConnection(serverName);
        if (afterAuth?.status === "connected") return afterAuth;
        if (afterAuth?.status === "needs-auth") {
          await state.manager.close(serverName);
        }
        clearFailure(state, serverName);
        connection = await state.manager.connect(serverName, definition, ownedSignal);
        return connection;
      }
    }
    return state.manager.getConnection(serverName);
  };

  try {
    state.manager.touch(serverName);
    state.manager.incrementInFlight(serverName);

    if (toolMeta.resourceUri) {
      const result = await withSessionRecovery<ClientReadResourceResult>(
        {
          manager: state.manager,
          config: state.config,
          ...(ownedSignal ? { signal: ownedSignal } : {}),
          onNeedsAuth: recoverAuthConnection,
        },
        serverName,
        (conn) => conn.client.readResource({ uri: toolMeta.resourceUri! }, requestOptions),
      );
      const content = transformMcpResourceContents(result.contents ?? [], state.owner?.signal);
      const guarded = await guardMcpOutput(content.length > 0 ? content : [{ type: "text" as const, text: "(empty resource)" }], outputGuardOptions);
      return {
        content: guarded.content,
        details: { mode: "call", ...callIdentity, ...guardedMcpDetails(guarded) },
      };
    }

    uiSession = toolMeta.uiResourceUri
      ? await maybeStartUiSession(state, {
          serverName,
          toolName: toolMeta.originalName,
          toolArgs: normalizedArgs,
          uiResourceUri: toolMeta.uiResourceUri,
          ...(toolMeta.uiStreamMode !== undefined ? { streamMode: toolMeta.uiStreamMode } : {}),
          ...(signal ? { signal } : {}),
          onNeedsAuth: recoverAuthConnection,
        })
      : null;

    const result = await withSessionRecovery<ClientCallToolResult>(
      {
        manager: state.manager,
        config: state.config,
        ...(ownedSignal ? { signal: ownedSignal } : {}),
        onNeedsAuth: recoverAuthConnection,
      },
      serverName,
      (conn) => abortable(conn.client.callTool({
        name: toolMeta.originalName,
        arguments: normalizedArgs,
        _meta: uiSession?.requestMeta,
      }, requestOptions), ownedSignal),
    );

    if (toolMeta.uiResourceUri) {
      uiSession?.sendToolResult(result as unknown as import("@modelcontextprotocol/client").CallToolResult);

      if (result.isError) {
        const mcpContent = (result.content ?? []) as McpContent[];
        const content = transformMcpContent(mcpContent, state.owner?.signal);
        const outputContent = content.length > 0 ? content : [{ type: "text" as const, text: "(empty result)" }];
        const schemaText = toolMeta.inputSchema ? `\n\nExpected parameters:\n${formatSchema(toolMeta.inputSchema)}` : "";
        const guarded = await guardMcpOutput(outputContent, { ...outputGuardOptions, prefix: "Error: ", suffix: schemaText, emptyTextFallback: "Tool execution failed", rawMcpResult: result });
        return {
          content: guarded.content,
          details: { mode: "call", error: "tool_error", ...callIdentity, ...guardedMcpDetails(guarded) },
        };
      }

      const content = resolveMcpResultContent(result as Record<string, unknown>, state.owner?.signal);
      const outputContent = content.length > 0 ? content : [{ type: "text" as const, text: "(empty result)" }];
      const uiSummary = summarizeUiSessionResult(uiSession);
      const guarded = await guardMcpOutput(outputContent, { ...outputGuardOptions, suffix: `\n\n${uiSummary.message}`, rawMcpResult: result });
      return {
        content: guarded.content,
        details: {
          mode: "call",
          ...guardedMcpDetails(guarded),
          ...callIdentity,
          uiOpen: uiSummary.uiOpen,
          uiViewer: uiSummary.uiViewer,
          uiUrl: uiSummary.uiUrl,
        },
      };
    }

    if (result.isError) {
      const mcpContent = (result.content ?? []) as McpContent[];
      const content = transformMcpContent(mcpContent, state.owner?.signal);
      const outputContent = content.length > 0 ? content : [{ type: "text" as const, text: "(empty result)" }];
      const schemaText = toolMeta.inputSchema ? `\n\nExpected parameters:\n${formatSchema(toolMeta.inputSchema)}` : "";
      const guarded = await guardMcpOutput(outputContent, { ...outputGuardOptions, prefix: "Error: ", suffix: schemaText, emptyTextFallback: "Tool execution failed", rawMcpResult: result });
      return {
        content: guarded.content,
        details: { mode: "call", error: "tool_error", ...callIdentity, ...guardedMcpDetails(guarded) },
      };
    }

    const content = resolveMcpResultContent(result as Record<string, unknown>, state.owner?.signal);
    const outputContent = content.length > 0 ? content : [{ type: "text" as const, text: "(empty result)" }];
    const guarded = await guardMcpOutput(outputContent, { ...outputGuardOptions, rawMcpResult: result });
    return {
      content: guarded.content,
      details: { mode: "call", ...guardedMcpDetails(guarded), ...callIdentity },
    };
  } catch (error) {
    if (error instanceof SessionRecoveryAuthRequiredError) {
      const message = error.authMessage ?? getAuthRequiredMessage(state, serverName);
      uiSession?.sendToolCancelled(message);
      return {
        content: [{ type: "text" as const, text: message }],
        details: { mode: "call", error: "auth_required", ...callIdentity, message, autoAuthAttempted },
      };
    }
    if (error instanceof UrlElicitationRequiredError) {
      const action = await state.manager.handleUrlElicitationRequired(serverName, error);
      const message = action === "accept"
        ? "The original MCP tool did not run. Complete the opened browser interaction, then retry the tool."
        : `The URL interaction was ${action === "decline" ? "declined" : "cancelled"}.`;
      uiSession?.sendToolCancelled(message);
      return {
        content: [{ type: "text" as const, text: message }],
        details: { mode: "call", error: "url_elicitation_required", ...callIdentity, action },
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    uiSession?.sendToolCancelled(message);

    const schemaText = toolMeta.inputSchema ? `\n\nExpected parameters:\n${formatSchema(toolMeta.inputSchema)}` : "";
    const guarded = await guardMcpOutput([{ type: "text" as const, text: message }], { ...outputGuardOptions, prefix: "Failed to call tool: ", suffix: schemaText });

    return {
      content: guarded.content,
      details: { mode: "call", error: isAbortError(error, ownedSignal) ? "aborted" : "call_failed", ...callIdentity, message: guarded.outputGuard ? "output truncated; see outputGuard.fullOutputPath" : message, ...guardedMcpDetails(guarded) },
    };
  } finally {
    if (uiSession?.reused) {
      uiSession.close();
    }
    state.manager.decrementInFlight(serverName);
    state.manager.touch(serverName);
  }
}
