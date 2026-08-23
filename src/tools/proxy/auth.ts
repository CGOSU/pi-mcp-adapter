import type { McpExtensionState } from "../../extension/state.ts";
import { clearFailure, updateStatusBar } from "../../extension/initialization.ts";
import { isServerDisabled } from "../../contracts/core.ts";
import { combineAbortSignals } from "../../extension/owner.ts";
import { throwIfAborted } from "../../runtime/abort.ts";
import { completeAuthFromInput, startAuth, supportsOAuth } from "../../auth/mcp-auth-flow.ts";
import { resolveServerUrl } from "../../utils.ts";
import {
  disabledResult,
  formatManualAuthInstructions,
  type ProxyToolResult,
} from "./shared.ts";

export async function executeAuthStart(state: McpExtensionState, serverName: string, signal?: AbortSignal): Promise<ProxyToolResult> {
  const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
  throwIfAborted(ownedSignal);
  const definition = state.config.mcpServers[serverName];
  if (!definition) {
    return {
      content: [{ type: "text" as const, text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "auth-start", error: "not_found", server: serverName },
    };
  }
  if (isServerDisabled(definition)) return disabledResult("auth-start", serverName);

  try {
    const serverUrl = resolveServerUrl(definition);
    if (!serverUrl || !supportsOAuth(definition)) {
      return {
        content: [{ type: "text" as const, text: `Server "${serverName}" is not configured for OAuth over HTTP.` }],
        details: { mode: "auth-start", error: "oauth_not_supported", server: serverName },
      };
    }

    const { authorizationUrl } = state.authStorageOptions
      ? ownedSignal
        ? await startAuth(serverName, serverUrl, definition, { authStorageOptions: state.authStorageOptions, signal: ownedSignal, runtime: state.oauthRuntime })
        : await startAuth(serverName, serverUrl, definition, { authStorageOptions: state.authStorageOptions, runtime: state.oauthRuntime })
      : ownedSignal
        ? await startAuth(serverName, serverUrl, definition, { signal: ownedSignal, runtime: state.oauthRuntime })
        : await startAuth(serverName, serverUrl, definition, { runtime: state.oauthRuntime });
    if (!authorizationUrl) {
      return {
        content: [{ type: "text" as const, text: `OAuth authentication successful for "${serverName}".` }],
        details: { mode: "auth-start", server: serverName, authenticated: true },
      };
    }

    return {
      content: [{ type: "text" as const, text: formatManualAuthInstructions(serverName, authorizationUrl) }],
      details: { mode: "auth-start", server: serverName, authorizationUrl },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `Failed to start OAuth for "${serverName}": ${message}` }],
      details: { mode: "auth-start", error: "auth_start_failed", server: serverName, message },
    };
  }
}

export async function executeAuthComplete(state: McpExtensionState, serverName: string, input: string, signal?: AbortSignal): Promise<ProxyToolResult> {
  const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
  throwIfAborted(ownedSignal);
  const definition = state.config.mcpServers[serverName];
  if (!definition) {
    return {
      content: [{ type: "text" as const, text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "auth-complete", error: "not_found", server: serverName },
    };
  }
  if (isServerDisabled(definition)) return disabledResult("auth-complete", serverName);

  try {
    const status = state.authStorageOptions
      ? ownedSignal
        ? await completeAuthFromInput(serverName, input, { authStorageOptions: state.authStorageOptions, signal: ownedSignal, runtime: state.oauthRuntime })
        : await completeAuthFromInput(serverName, input, { authStorageOptions: state.authStorageOptions, runtime: state.oauthRuntime })
      : ownedSignal
        ? await completeAuthFromInput(serverName, input, { signal: ownedSignal, runtime: state.oauthRuntime })
        : await completeAuthFromInput(serverName, input, { runtime: state.oauthRuntime });
    if (status !== "authenticated") {
      return {
        content: [{ type: "text" as const, text: `OAuth authentication did not complete for "${serverName}".` }],
        details: { mode: "auth-complete", error: "not_authenticated", server: serverName, status },
      };
    }

    await state.manager.close(serverName);
    clearFailure(state, serverName, "auth-complete");
    updateStatusBar(state);
    return {
      content: [{ type: "text" as const, text: `OAuth authentication successful for "${serverName}". Run mcp({ connect: "${serverName}" }) to connect with the new token.` }],
      details: { mode: "auth-complete", server: serverName, authenticated: true },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `Failed to complete OAuth for "${serverName}": ${message}` }],
      details: { mode: "auth-complete", error: "auth_complete_failed", server: serverName, message },
    };
  }
}
