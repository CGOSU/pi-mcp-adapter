import {
  DIRECT_TOOLS_ADVISORY_THRESHOLD,
  buildProxyDescription,
  prepareDirectToolArguments,
  resolveDirectTools
} from "./chunk-I5MJPLKC.js";
import {
  ensureToolCallApproved,
  guardMcpOutput,
  guardedMcpDetails,
  maybeStartUiSession,
  resolveMcpOutputGuardOptions,
  summarizeUiSessionResult
} from "./chunk-RZDPR4KU.js";
import {
  SessionRecoveryAuthRequiredError,
  clearFailure,
  formatSchema,
  lazyConnect,
  withSessionRecovery
} from "./chunk-NBJ35UZ7.js";
import {
  getFailureAgeSeconds
} from "./chunk-3G7YTFA4.js";
import {
  abortable,
  authenticate,
  supportsOAuth,
  throwIfAborted
} from "./chunk-XNQOPVY5.js";
import {
  combineAbortSignals,
  isAbortError
} from "./chunk-CYSFURUK.js";
import {
  resolveMcpResultContent,
  transformMcpContent,
  transformMcpResourceContents
} from "./chunk-QEVIMIQ3.js";
import "./chunk-AZSKIV4J.js";
import "./chunk-PI2QHUXN.js";
import {
  getMissingConfiguredDirectToolServers
} from "./chunk-NBQZZ3IQ.js";
import {
  formatAuthRequiredMessage,
  isServerDisabled,
  normalizeToolArguments,
  resolveServerUrl
} from "./chunk-Z3P2QPCB.js";
import "./chunk-ELOBWFRH.js";

// src/tools/direct-tools.ts
import { UrlElicitationRequiredError } from "@modelcontextprotocol/client";
function getDirectAuthRequiredMessage(state, serverName, defaultMessage = `MCP server "${serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`) {
  return formatAuthRequiredMessage(state.config, serverName, defaultMessage);
}
function getDirectAuthFailedMessage(state, serverName, message) {
  const customGuidance = state.config.settings?.authRequiredMessage;
  if (customGuidance) {
    return `OAuth authentication failed for "${serverName}": ${message}. ${getDirectAuthRequiredMessage(state, serverName)}`;
  }
  return `OAuth authentication failed for "${serverName}": ${message}. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`;
}
async function attemptDirectAutoAuth(state, serverName, signal) {
  if (state.config.settings?.autoAuth !== true) {
    return { status: "skipped" };
  }
  const definition = state.config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition) || !supportsOAuth(definition)) {
    return { status: "skipped" };
  }
  let serverUrl;
  try {
    serverUrl = resolveServerUrl(definition);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", message: getDirectAuthFailedMessage(state, serverName, message) };
  }
  if (!serverUrl) {
    return { status: "skipped" };
  }
  const grantType = definition.oauth ? definition.oauth.grantType ?? "authorization_code" : "authorization_code";
  if (!state.ui && grantType !== "client_credentials") {
    return {
      status: "failed",
      message: getDirectAuthRequiredMessage(
        state,
        serverName,
        `MCP server "${serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`
      )
    };
  }
  try {
    if (state.authStorageOptions) {
      await authenticate(
        serverName,
        serverUrl,
        definition,
        signal ? { authStorageOptions: state.authStorageOptions, signal, runtime: state.oauthRuntime } : { authStorageOptions: state.authStorageOptions, runtime: state.oauthRuntime }
      );
    } else {
      await authenticate(serverName, serverUrl, definition, {
        ...signal ? { signal } : {},
        runtime: state.oauthRuntime
      });
    }
    return { status: "success" };
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: getDirectAuthFailedMessage(state, serverName, message)
    };
  }
}
function createDirectToolExecutor(getState, getInitPromise, spec, ensureState) {
  return async function execute(_toolCallId, params, signal) {
    throwIfAborted(signal);
    let state = getState();
    const initPromise = state ? null : ensureState ? ensureState(signal) : getInitPromise();
    if (!state && initPromise) {
      try {
        state = await initPromise;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `MCP initialization failed: ${message}` }],
          details: { error: "init_failed", message }
        };
      }
    }
    if (!state) {
      return {
        content: [{ type: "text", text: "MCP not initialized" }],
        details: { error: "not_initialized" }
      };
    }
    const definition = state.config.mcpServers[spec.serverName];
    if (isServerDisabled(definition)) {
      const message = `MCP server "${spec.serverName}" is disabled. Run /mcp enable ${spec.serverName} and /reload to enable it.`;
      return {
        content: [{ type: "text", text: message }],
        details: { error: "server_disabled", server: spec.serverName, message }
      };
    }
    const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
    throwIfAborted(ownedSignal);
    let connected = await lazyConnect(state, spec.serverName, ownedSignal);
    let autoAuthAttempted = false;
    if (!connected && state.manager.getConnection(spec.serverName)?.status === "needs-auth") {
      autoAuthAttempted = true;
      const autoAuth = await attemptDirectAutoAuth(state, spec.serverName, ownedSignal);
      if (autoAuth.status === "failed") {
        return {
          content: [{ type: "text", text: autoAuth.message }],
          details: { error: "auth_required", server: spec.serverName, message: autoAuth.message }
        };
      }
      if (autoAuth.status === "success") {
        await state.manager.close(spec.serverName);
        clearFailure(state, spec.serverName);
        connected = await lazyConnect(state, spec.serverName, ownedSignal);
      }
    }
    if (!connected) {
      const authConnection = state.manager.getConnection(spec.serverName);
      if (authConnection?.status === "needs-auth") {
        const message = getDirectAuthRequiredMessage(state, spec.serverName);
        return {
          content: [{ type: "text", text: message }],
          details: { error: "auth_required", server: spec.serverName, message, autoAuthAttempted }
        };
      }
      const failedAgo = getFailureAgeSeconds(state, spec.serverName);
      return {
        content: [{ type: "text", text: `MCP server "${spec.serverName}" not available${failedAgo !== null ? ` (failed ${failedAgo}s ago)` : ""}` }],
        details: { error: "server_unavailable", server: spec.serverName }
      };
    }
    const connection = state.manager.getConnection(spec.serverName);
    if (!connection || connection.status !== "connected") {
      return {
        content: [{ type: "text", text: `MCP server "${spec.serverName}" not connected` }],
        details: { error: "not_connected", server: spec.serverName }
      };
    }
    const normalizedParams = spec.resourceUri ? params : normalizeToolArguments(params);
    const approval = await ensureToolCallApproved(state, spec.serverName, {
      name: spec.prefixedName,
      originalName: spec.originalName,
      description: spec.description,
      ...spec.inputSchema !== void 0 ? { inputSchema: spec.inputSchema } : {},
      ...spec.resourceUri !== void 0 ? { resourceUri: spec.resourceUri } : {},
      ...spec.uiResourceUri !== void 0 ? { uiResourceUri: spec.uiResourceUri } : {},
      ...spec.uiStreamMode !== void 0 ? { uiStreamMode: spec.uiStreamMode } : {}
    }, normalizedParams, ownedSignal, spec.resourceUri ? "resource" : "direct");
    if (approval.ok === false) {
      const denied = approval.reason === "denied";
      const message = denied ? `The user declined approval to run MCP tool "${spec.originalName}" on server "${spec.serverName}".` : `MCP tool "${spec.originalName}" on server "${spec.serverName}" is approval-gated and requires an interactive session.`;
      return {
        content: [{ type: "text", text: message }],
        details: {
          error: denied ? "approval_denied" : "approval_required",
          server: spec.serverName,
          tool: spec.originalName
        }
      };
    }
    let uiSession = null;
    const requestOptions = state.manager.getRequestOptions?.(spec.serverName, ownedSignal) ?? (ownedSignal ? { signal: ownedSignal } : void 0);
    const outputGuardOptions = resolveMcpOutputGuardOptions(state.config.settings);
    const recoverAuthConnection = async () => {
      const current = state.manager.getConnection(spec.serverName);
      if (current?.status === "connected") return current;
      if (!autoAuthAttempted) {
        autoAuthAttempted = true;
        const autoAuth = await attemptDirectAutoAuth(state, spec.serverName, ownedSignal);
        if (autoAuth.status === "failed") {
          throw new SessionRecoveryAuthRequiredError(spec.serverName, autoAuth.message);
        }
        if (autoAuth.status === "success") {
          const afterAuth = state.manager.getConnection(spec.serverName);
          if (afterAuth?.status === "connected") return afterAuth;
          if (afterAuth?.status === "needs-auth") {
            await state.manager.close(spec.serverName);
          }
          clearFailure(state, spec.serverName);
          const reconnected = await lazyConnect(state, spec.serverName, ownedSignal);
          return reconnected ? state.manager.getConnection(spec.serverName) : void 0;
        }
      }
      return state.manager.getConnection(spec.serverName);
    };
    try {
      state.manager.touch(spec.serverName);
      state.manager.incrementInFlight(spec.serverName);
      if (spec.resourceUri) {
        const result2 = await withSessionRecovery(
          {
            manager: state.manager,
            config: state.config,
            ...ownedSignal ? { signal: ownedSignal } : {},
            onNeedsAuth: recoverAuthConnection
          },
          spec.serverName,
          (conn) => conn.client.readResource({ uri: spec.resourceUri }, requestOptions)
        );
        const content2 = transformMcpResourceContents(result2.contents ?? [], state.owner?.signal);
        const guarded2 = await guardMcpOutput(content2.length > 0 ? content2 : [{ type: "text", text: "(empty resource)" }], {
          ...outputGuardOptions,
          ...state.config.settings?.directToolResultDetails === "bounded" ? { rawMcpResult: result2 } : {}
        });
        return {
          content: guarded2.content,
          details: { server: spec.serverName, resourceUri: spec.resourceUri, ...guardedMcpDetails(guarded2) }
        };
      }
      const hasUi = !!spec.uiResourceUri;
      uiSession = hasUi ? await maybeStartUiSession(state, {
        serverName: spec.serverName,
        toolName: spec.originalName,
        toolArgs: normalizedParams,
        uiResourceUri: spec.uiResourceUri,
        ...spec.uiStreamMode !== void 0 ? { streamMode: spec.uiStreamMode } : {},
        ...signal ? { signal } : {},
        onNeedsAuth: recoverAuthConnection
      }) : null;
      const result = await withSessionRecovery(
        {
          manager: state.manager,
          config: state.config,
          ...ownedSignal ? { signal: ownedSignal } : {},
          onNeedsAuth: recoverAuthConnection
        },
        spec.serverName,
        (conn) => abortable(conn.client.callTool({
          name: spec.originalName,
          arguments: normalizedParams,
          _meta: uiSession?.requestMeta
        }, requestOptions), ownedSignal)
      );
      uiSession?.sendToolResult(result);
      if (result.isError) {
        const mcpContent = result.content ?? [];
        const content2 = transformMcpContent(mcpContent, state.owner?.signal);
        const outputContent2 = content2.length > 0 ? content2 : [{ type: "text", text: "(empty result)" }];
        const schemaText = spec.inputSchema ? `

Expected parameters:
${formatSchema(spec.inputSchema)}` : "";
        const guarded2 = await guardMcpOutput(outputContent2, {
          ...outputGuardOptions,
          prefix: "Error: ",
          suffix: schemaText,
          emptyTextFallback: "Tool execution failed",
          ...state.config.settings?.directToolResultDetails === "bounded" ? { rawMcpResult: result } : {}
        });
        return {
          content: guarded2.content,
          details: { error: "tool_error", server: spec.serverName, ...guardedMcpDetails(guarded2) }
        };
      }
      const content = resolveMcpResultContent(result, state.owner?.signal);
      const outputContent = content.length > 0 ? content : [{ type: "text", text: "(empty result)" }];
      if (hasUi) {
        const uiSummary = summarizeUiSessionResult(uiSession);
        const guarded2 = await guardMcpOutput(outputContent, {
          ...outputGuardOptions,
          suffix: `

${uiSummary.message}`,
          ...state.config.settings?.directToolResultDetails === "bounded" ? { rawMcpResult: result } : {}
        });
        return {
          content: guarded2.content,
          details: {
            server: spec.serverName,
            tool: spec.originalName,
            uiOpen: uiSummary.uiOpen,
            uiViewer: uiSummary.uiViewer,
            uiUrl: uiSummary.uiUrl,
            ...guardedMcpDetails(guarded2)
          }
        };
      }
      const guarded = await guardMcpOutput(outputContent, {
        ...outputGuardOptions,
        ...state.config.settings?.directToolResultDetails === "bounded" ? { rawMcpResult: result } : {}
      });
      return {
        content: guarded.content,
        details: { server: spec.serverName, tool: spec.originalName, ...guardedMcpDetails(guarded) }
      };
    } catch (error) {
      if (error instanceof SessionRecoveryAuthRequiredError) {
        const message2 = error.authMessage ?? getDirectAuthRequiredMessage(state, spec.serverName);
        uiSession?.sendToolCancelled(message2);
        return {
          content: [{ type: "text", text: message2 }],
          details: { error: "auth_required", server: spec.serverName, message: message2, autoAuthAttempted }
        };
      }
      if (error instanceof UrlElicitationRequiredError) {
        const action = await state.manager.handleUrlElicitationRequired(spec.serverName, error);
        const message2 = action === "accept" ? "The original MCP tool did not run. Complete the opened browser interaction, then retry the tool." : `The URL interaction was ${action === "decline" ? "declined" : "cancelled"}.`;
        uiSession?.sendToolCancelled(message2);
        return {
          content: [{ type: "text", text: message2 }],
          details: { error: "url_elicitation_required", server: spec.serverName, action }
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      const aborted = isAbortError(error, ownedSignal);
      if (!aborted) {
        await state.manager.close(spec.serverName).catch(() => {
        });
      }
      uiSession?.sendToolCancelled(message);
      const schemaText = spec.inputSchema ? `

Expected parameters:
${formatSchema(spec.inputSchema)}` : "";
      const guarded = await guardMcpOutput([{ type: "text", text: message }], { ...outputGuardOptions, prefix: "Failed to call tool: ", suffix: schemaText });
      return {
        content: guarded.content,
        details: { error: aborted ? "aborted" : "call_failed", server: spec.serverName, ...guardedMcpDetails(guarded) }
      };
    } finally {
      if (uiSession?.reused) {
        uiSession.close();
      }
      state.manager.decrementInFlight(spec.serverName);
      state.manager.touch(spec.serverName);
    }
  };
}
export {
  DIRECT_TOOLS_ADVISORY_THRESHOLD,
  buildProxyDescription,
  createDirectToolExecutor,
  getMissingConfiguredDirectToolServers,
  prepareDirectToolArguments,
  resolveDirectTools
};
