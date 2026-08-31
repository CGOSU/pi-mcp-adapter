import {
  disabledResult,
  executeCall,
  executeConnect,
  executeDescribe,
  executeInstructions,
  executeList,
  executeSearch,
  formatManualAuthInstructions
} from "./chunk-YX6YYFGP.js";
import {
  parseUiPromptHandoff
} from "./chunk-RZDPR4KU.js";
import {
  clearFailure,
  updateStatusBar
} from "./chunk-NBJ35UZ7.js";
import {
  getFailureAgeSeconds
} from "./chunk-3G7YTFA4.js";
import {
  completeAuthFromInput,
  startAuth,
  supportsOAuth,
  throwIfAborted
} from "./chunk-XNQOPVY5.js";
import {
  combineAbortSignals
} from "./chunk-CYSFURUK.js";
import "./chunk-QEVIMIQ3.js";
import "./chunk-AZSKIV4J.js";
import "./chunk-PI2QHUXN.js";
import "./chunk-NBQZZ3IQ.js";
import {
  isServerDisabled,
  resolveServerUrl
} from "./chunk-Z3P2QPCB.js";
import "./chunk-ELOBWFRH.js";

// src/tools/proxy/ui-messages.ts
function executeUiMessages(state) {
  const sessions = state.completedUiSessions;
  if (sessions.length === 0) {
    return {
      content: [{ type: "text", text: "No UI session messages available." }],
      details: { sessions: 0 }
    };
  }
  const output = [];
  output.push(`UI Session Messages (${sessions.length} session${sessions.length > 1 ? "s" : ""}):
`);
  const allPrompts = [];
  const allIntents = sessions.flatMap((session) => session.messages.intents);
  const allContexts = sessions.flatMap((session) => session.messages.contexts);
  const parsedHandoffs = [];
  for (const session of sessions) {
    const timestamp = session.completedAt.toLocaleTimeString();
    output.push(`
## ${session.serverName} / ${session.toolName} (${timestamp}, ${session.reason})`);
    const plainPrompts = [];
    for (const prompt of session.messages.prompts) {
      allPrompts.push(prompt);
      const handoff = parseUiPromptHandoff(prompt);
      if (handoff) {
        parsedHandoffs.push(handoff);
      } else {
        plainPrompts.push(prompt);
      }
    }
    if (plainPrompts.length > 0) {
      output.push("\n### Prompts:");
      for (const prompt of plainPrompts) {
        output.push(`- ${prompt}`);
      }
    }
    const intentsForSession = [
      ...session.messages.intents,
      ...session.messages.prompts.map((prompt) => parseUiPromptHandoff(prompt)).filter((handoff) => !!handoff).map((handoff) => ({ intent: handoff.intent, params: handoff.params }))
    ];
    if (intentsForSession.length > 0) {
      output.push("\n### Intents:");
      for (const intent of intentsForSession) {
        const params = intent.params ? ` (${JSON.stringify(intent.params)})` : "";
        output.push(`- ${intent.intent}${params}`);
      }
    }
    const contexts = session.messages.contexts;
    if (contexts.length > 0) {
      output.push("\n### Context updates:");
      for (const context of contexts) {
        output.push(`- ${context.summary}${context.truncated ? " (truncated)" : ""}`);
      }
    }
    if (session.messages.notifications.length > 0) {
      output.push("\n### Notifications:");
      for (const notification of session.messages.notifications) {
        output.push(`- ${notification}`);
      }
    }
  }
  const count = sessions.length;
  state.completedUiSessions = [];
  return {
    content: [{ type: "text", text: output.join("\n") }],
    details: {
      sessions: count,
      prompts: allPrompts,
      intents: [...allIntents, ...parsedHandoffs.map(({ intent, params }) => ({ intent, params }))],
      contexts: allContexts,
      handoffs: parsedHandoffs,
      cleared: true
    }
  };
}

// src/tools/proxy/status.ts
function executeStatus(state) {
  const servers = [];
  for (const name of Object.keys(state.config.mcpServers)) {
    const definition = state.config.mcpServers[name];
    const disabled = isServerDisabled(definition);
    const connection = disabled ? void 0 : state.manager.getConnection(name);
    const metadata = disabled ? void 0 : state.toolMetadata.get(name);
    const failedAgo = disabled ? null : getFailureAgeSeconds(state, name);
    let status = disabled ? "disabled" : "not connected";
    if (!disabled && connection?.status === "connected") {
      status = "connected";
    } else if (!disabled && connection?.status === "needs-auth") {
      status = "needs-auth";
    } else if (!disabled && failedAgo !== null) {
      status = "failed";
    } else if (!disabled && metadata !== void 0) {
      status = "cached";
    }
    const toolCount = status === "failed" ? 0 : metadata?.length ?? 0;
    servers.push({ name, status, toolCount, failedAgo, ...disabled ? { disabled: true } : {} });
  }
  const disabledCount = servers.filter((s) => s.disabled).length;
  const enabledServers = servers.filter((s) => !s.disabled);
  const totalTools = enabledServers.reduce((sum, s) => sum + s.toolCount, 0);
  const connectedCount = enabledServers.filter((s) => s.status === "connected").length;
  let text = `MCP: ${connectedCount}/${enabledServers.length} servers, ${totalTools} tools`;
  if (disabledCount > 0) text += ` (${disabledCount} disabled)`;
  text += "\n\n";
  for (const server of servers) {
    if (server.disabled) {
      text += `\u2298 ${server.name} (disabled)
`;
      continue;
    }
    if (server.status === "connected") {
      text += `\u2713 ${server.name} (${server.toolCount} tools)
`;
      continue;
    }
    if (server.status === "needs-auth") {
      text += `\u26A0 ${server.name} (needs auth)
`;
      continue;
    }
    if (server.status === "cached") {
      text += `\u25CB ${server.name} (${server.toolCount} tools, cached)
`;
      continue;
    }
    if (server.status === "failed") {
      text += `\u2717 ${server.name} (failed ${server.failedAgo ?? 0}s ago)
`;
      continue;
    }
    text += `\u25CB ${server.name} (not connected)
`;
  }
  if (servers.length > 0) {
    text += `
mcp({ server: "name" }) to list tools, mcp({ search: "..." }) to search`;
  }
  return {
    content: [{ type: "text", text: text.trim() }],
    details: { mode: "status", servers, totalTools, connectedCount, disabledCount }
  };
}

// src/tools/proxy/auth.ts
async function executeAuthStart(state, serverName, signal) {
  const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
  throwIfAborted(ownedSignal);
  const definition = state.config.mcpServers[serverName];
  if (!definition) {
    return {
      content: [{ type: "text", text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "auth-start", error: "not_found", server: serverName }
    };
  }
  if (isServerDisabled(definition)) return disabledResult("auth-start", serverName);
  try {
    const serverUrl = resolveServerUrl(definition);
    if (!serverUrl || !supportsOAuth(definition)) {
      return {
        content: [{ type: "text", text: `Server "${serverName}" is not configured for OAuth over HTTP.` }],
        details: { mode: "auth-start", error: "oauth_not_supported", server: serverName }
      };
    }
    const { authorizationUrl } = state.authStorageOptions ? ownedSignal ? await startAuth(serverName, serverUrl, definition, { authStorageOptions: state.authStorageOptions, signal: ownedSignal, runtime: state.oauthRuntime }) : await startAuth(serverName, serverUrl, definition, { authStorageOptions: state.authStorageOptions, runtime: state.oauthRuntime }) : ownedSignal ? await startAuth(serverName, serverUrl, definition, { signal: ownedSignal, runtime: state.oauthRuntime }) : await startAuth(serverName, serverUrl, definition, { runtime: state.oauthRuntime });
    if (!authorizationUrl) {
      return {
        content: [{ type: "text", text: `OAuth authentication successful for "${serverName}".` }],
        details: { mode: "auth-start", server: serverName, authenticated: true }
      };
    }
    return {
      content: [{ type: "text", text: formatManualAuthInstructions(serverName, authorizationUrl) }],
      details: { mode: "auth-start", server: serverName, authorizationUrl }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Failed to start OAuth for "${serverName}": ${message}` }],
      details: { mode: "auth-start", error: "auth_start_failed", server: serverName, message }
    };
  }
}
async function executeAuthComplete(state, serverName, input, signal) {
  const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
  throwIfAborted(ownedSignal);
  const definition = state.config.mcpServers[serverName];
  if (!definition) {
    return {
      content: [{ type: "text", text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "auth-complete", error: "not_found", server: serverName }
    };
  }
  if (isServerDisabled(definition)) return disabledResult("auth-complete", serverName);
  try {
    const status = state.authStorageOptions ? ownedSignal ? await completeAuthFromInput(serverName, input, { authStorageOptions: state.authStorageOptions, signal: ownedSignal, runtime: state.oauthRuntime }) : await completeAuthFromInput(serverName, input, { authStorageOptions: state.authStorageOptions, runtime: state.oauthRuntime }) : ownedSignal ? await completeAuthFromInput(serverName, input, { signal: ownedSignal, runtime: state.oauthRuntime }) : await completeAuthFromInput(serverName, input, { runtime: state.oauthRuntime });
    if (status !== "authenticated") {
      return {
        content: [{ type: "text", text: `OAuth authentication did not complete for "${serverName}".` }],
        details: { mode: "auth-complete", error: "not_authenticated", server: serverName, status }
      };
    }
    await state.manager.close(serverName);
    clearFailure(state, serverName, "auth-complete");
    updateStatusBar(state);
    return {
      content: [{ type: "text", text: `OAuth authentication successful for "${serverName}". Run mcp({ connect: "${serverName}" }) to connect with the new token.` }],
      details: { mode: "auth-complete", server: serverName, authenticated: true }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Failed to complete OAuth for "${serverName}": ${message}` }],
      details: { mode: "auth-complete", error: "auth_complete_failed", server: serverName, message }
    };
  }
}
export {
  executeAuthComplete,
  executeAuthStart,
  executeCall,
  executeConnect,
  executeDescribe,
  executeInstructions,
  executeList,
  executeSearch,
  executeStatus,
  executeUiMessages
};
