import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "../../extension/state.ts";
import type { ToolMetadata } from "../../contracts/core.ts";
import { isServerDisabled } from "../../contracts/core.ts";
import { getFailureAgeSeconds } from "../../extension/initialization.ts";
import { isAbortError } from "../../extension/owner.ts";
import { formatAuthRequiredMessage, resolveServerUrl } from "../../utils.ts";
import { authenticate, supportsOAuth } from "../../auth/mcp-auth-flow.ts";

export type ProxyToolResult = AgentToolResult<Record<string, unknown>>;

export type AutoAuthResult =
  | { status: "skipped" }
  | { status: "success" }
  | { status: "failed"; message: string };

export function getToolMatches(metadata: ToolMetadata[] | undefined, toolName: string, exact: boolean): ToolMetadata[] {
  if (!metadata) return [];
  if (exact) return metadata.filter(tool => tool.name === toolName);
  const normalizedName = toolName.replace(/-/g, "_");
  return metadata.filter(tool => tool.name.replace(/-/g, "_") === normalizedName);
}

export function getEnabledToolMatches(state: McpExtensionState, toolName: string, exact: boolean): { server: string; tool: ToolMetadata }[] {
  const matches: { server: string; tool: ToolMetadata }[] = [];
  for (const [server, metadata] of state.toolMetadata) {
    if (isServerDisabled(state.config.mcpServers[server])) continue;
    for (const tool of getToolMatches(metadata, toolName, exact)) matches.push({ server, tool });
  }
  return matches;
}

export function serverBackoffResult(state: McpExtensionState, mode: string, serverName: string): ProxyToolResult {
  const failedAgo = getFailureAgeSeconds(state, serverName) ?? 0;
  const message = `Server "${serverName}" not available (last failed ${failedAgo}s ago)`;
  return {
    content: [{ type: "text" as const, text: message }],
    details: { mode, error: "server_backoff", server: serverName },
  };
}

export function getSingleToolMatch(metadata: ToolMetadata[] | undefined, toolName: string): ToolMetadata | "ambiguous" | undefined {
  const exactMatches = getToolMatches(metadata, toolName, true);
  const matches = exactMatches.length > 0 ? exactMatches : getToolMatches(metadata, toolName, false);
  return matches.length > 1 ? "ambiguous" : matches[0];
}

export function ambiguousToolResult(mode: "call" | "describe", toolName: string): ProxyToolResult {
  const message = `Tool "${toolName}" matches multiple servers. Specify a server.`;
  return {
    content: [{ type: "text" as const, text: message }],
    details: { mode, error: "ambiguous_tool", requestedTool: toolName, message },
  };
}

export function disabledResult(mode: string, serverName: string, tool?: ToolMetadata): ProxyToolResult {
  const message = `Server "${serverName}" is disabled. Run /mcp enable ${serverName} and /reload to enable it.`;
  const identity = tool?.resourceUri
    ? { resourceUri: tool.resourceUri }
    : tool
      ? { tool: tool.originalName }
      : {};
  return {
    content: [{ type: "text" as const, text: message }],
    details: { mode, error: "server_disabled", server: serverName, ...identity, message },
  };
}

export function getAuthRequiredMessage(
  state: McpExtensionState,
  serverName: string,
  defaultMessage = `Server "${serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`,
): string {
  return formatAuthRequiredMessage(state.config, serverName, defaultMessage);
}

export function getAuthFailedMessage(state: McpExtensionState, serverName: string, message: string): string {
  const customGuidance = state.config.settings?.authRequiredMessage;
  if (customGuidance) {
    return `OAuth authentication failed for "${serverName}": ${message}. ${getAuthRequiredMessage(state, serverName)}`;
  }
  return `OAuth authentication failed for "${serverName}": ${message}. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`;
}

function getRedirectPort(authorizationUrl: string): number | undefined {
  try {
    const redirectUri = new URL(authorizationUrl).searchParams.get("redirect_uri");
    if (!redirectUri) return undefined;
    const port = Number.parseInt(new URL(redirectUri).port, 10);
    return Number.isInteger(port) ? port : undefined;
  } catch {
    return undefined;
  }
}

export function formatManualAuthInstructions(serverName: string, authorizationUrl: string): string {
  const port = getRedirectPort(authorizationUrl);
  const portNote = port
    ? `\nThe redirect URL will use local port ${port}. On a remote server it is expected for that localhost page to fail locally; copy the address bar URL anyway.`
    : "";

  return [
    `MCP OAuth required for "${serverName}".`,
    "",
    "Open this URL in your local browser:",
    "",
    authorizationUrl,
    "",
    "After approving, copy the full redirected localhost URL from your browser address bar and send it back with:",
    `mcp({ action: "auth-complete", server: "${serverName}", args: { redirectUrl: "PASTE_REDIRECT_URL_HERE" } })`,
    "",
    'You can also pass just the `code` query parameter as `args: { code: "PASTE_CODE_HERE" }`. JSON-string args remain supported.',
    portNote.trimEnd(),
  ].filter(Boolean).join("\n");
}

export async function attemptAutoAuth(
  state: McpExtensionState,
  serverName: string,
  signal?: AbortSignal,
): Promise<AutoAuthResult> {
  if (state.config.settings?.autoAuth !== true) {
    return { status: "skipped" };
  }

  const definition = state.config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition) || !supportsOAuth(definition)) {
    return { status: "skipped" };
  }

  let serverUrl: string | undefined;
  try {
    serverUrl = resolveServerUrl(definition);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", message: getAuthFailedMessage(state, serverName, message) };
  }
  if (!serverUrl) {
    return { status: "skipped" };
  }

  const grantType = definition.oauth ? definition.oauth.grantType ?? "authorization_code" : "authorization_code";
  if (!state.ui && grantType !== "client_credentials") {
    return {
      status: "failed",
      message: getAuthRequiredMessage(
        state,
        serverName,
        `Server "${serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`,
      ),
    };
  }

  try {
    if (state.authStorageOptions) {
      await authenticate(
        serverName,
        serverUrl,
        definition,
        signal
          ? { authStorageOptions: state.authStorageOptions, signal, runtime: state.oauthRuntime }
          : { authStorageOptions: state.authStorageOptions, runtime: state.oauthRuntime },
      );
    } else {
      if (signal) {
        await authenticate(serverName, serverUrl, definition, { signal, runtime: state.oauthRuntime });
      } else {
        await authenticate(serverName, serverUrl, definition, { runtime: state.oauthRuntime });
      }
    }
    return { status: "success" };
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: getAuthFailedMessage(state, serverName, message),
    };
  }
}
