import {
  buildToolMetadata,
  clearFailure,
  inspectBearerTokenForUrl,
  markKeepAliveAfterConnect,
  notifyToolMetadataUpdated,
  recordFailure,
  removeBearerToken,
  updateMetadataCache,
  updateStatusBar
} from "./chunk-NBJ35UZ7.js";
import {
  getFailureAgeSeconds,
  getFailureMessage,
  isServerInActiveFailureBackoff
} from "./chunk-3G7YTFA4.js";
import {
  authenticate,
  getAuthStorageOptions,
  inspectAuthForUrl,
  removeAuth,
  supportsOAuth
} from "./chunk-XNQOPVY5.js";
import {
  isAbortError
} from "./chunk-CYSFURUK.js";
import {
  ensureCompatibilityImports,
  getServerProvenance,
  previewCompatibilityImports,
  previewSharedServerEntry,
  previewStarterProjectConfig,
  writeDirectToolsConfig,
  writeSharedServerEntry,
  writeStarterProjectConfig
} from "./chunk-EGE437IA.js";
import {
  extractServers,
  getAgentPluginSummaries,
  getConfiguredHostConfigDiscoveryFromSources,
  getMergedSettingsFromSources,
  loadConfigSources,
  loadImportedConfig
} from "./chunk-AZSKIV4J.js";
import {
  GENERIC_GLOBAL_CONFIG_PATH,
  IMPORT_PATHS,
  PROJECT_CONFIG_NAME,
  REPOPROMPT_BINARY_CANDIDATES,
  getProjectConfigPath,
  isExclusiveConfigMode
} from "./chunk-PI2QHUXN.js";
import {
  loadMetadataCache,
  reconstructPromptMetadata
} from "./chunk-NBQZZ3IQ.js";
import {
  isServerDisabled,
  openPath,
  resolveServerUrl,
  sanitizeTerminalText
} from "./chunk-Z3P2QPCB.js";
import {
  getAgentPath
} from "./chunk-ELOBWFRH.js";

// src/config/discovery.ts
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
function getConfigSourceSummaries(loadedSources) {
  return loadedSources.map(({ source, config }) => ({
    id: source.id,
    label: source.label,
    path: source.readPath,
    exists: existsSync(source.readPath),
    scope: source.scope,
    kind: source.shared ? "shared" : "pi",
    serverCount: config ? Object.keys(config.mcpServers).length : 0
  }));
}
function getMcpStandardConfigSummary(overridePath, cwd = process.cwd()) {
  const sources = getConfigSourceSummaries(loadConfigSources(overridePath, cwd));
  return {
    sources,
    hasSharedServers: sources.some((source) => source.kind === "shared" && source.serverCount > 0),
    fingerprint: JSON.stringify({ sources: sources.map((source) => [source.id, source.exists, source.serverCount]) })
  };
}
function getMcpDiscoverySummary(overridePath, cwd = process.cwd(), options = {}) {
  const loadedSources = loadConfigSources(overridePath, cwd);
  const sources = getConfigSourceSummaries(loadedSources);
  const includeHostConfigs = options.includeHostConfigs !== false;
  const importedConfigs = /* @__PURE__ */ new Map();
  const getImportedConfig = (kind, warningPrefix) => {
    if (!importedConfigs.has(kind)) importedConfigs.set(kind, loadImportedConfig(kind, cwd, warningPrefix));
    return importedConfigs.get(kind) ?? null;
  };
  const importKinds = isExclusiveConfigMode() ? loadedSources[0]?.config?.imports ?? [] : Object.keys(IMPORT_PATHS);
  const imports = includeHostConfigs ? importKinds.map((kind) => {
    const imported = getImportedConfig(kind, `Failed to inspect imported MCP config from ${kind}:`);
    if (!imported) return null;
    return {
      kind,
      path: imported.path,
      serverCount: Object.keys(extractServers(imported.value, kind)).length
    };
  }).filter((value) => value !== null) : [];
  const hostConfigDiscovery = isExclusiveConfigMode() ? "off" : getConfiguredHostConfigDiscoveryFromSources(loadedSources);
  const hostConfigs = imports.map((entry) => ({ ...entry, active: hostConfigDiscovery === "on" }));
  const settings = getMergedSettingsFromSources(loadedSources);
  const agentPlugins = isExclusiveConfigMode() ? [] : getAgentPluginSummaries(settings?.agentPluginPaths, cwd);
  const totalServerCount = sources.reduce((sum, source) => sum + source.serverCount, 0) + agentPlugins.reduce((sum, plugin) => sum + plugin.serverCount, 0);
  const hasSharedServers = sources.some((source) => source.kind === "shared" && source.serverCount > 0) || agentPlugins.some((plugin) => plugin.serverCount > 0);
  const hasPiOwnedServers = sources.some((source) => source.kind === "pi" && source.serverCount > 0);
  const hasAnyDetectedPaths = sources.some((source) => source.exists) || imports.length > 0 || agentPlugins.length > 0;
  const hasAnyConfig = totalServerCount > 0 || imports.some((entry) => entry.serverCount > 0) || hasAnyDetectedPaths;
  const summaryWithoutRepoPrompt = {
    sources,
    imports,
    hostConfigs,
    hostConfigDiscovery,
    agentPlugins,
    conflicts: getConfigConflicts(loadedSources, imports, cwd, getImportedConfig),
    hasAnyConfig,
    hasAnyDetectedPaths,
    hasSharedServers,
    hasPiOwnedServers,
    totalServerCount
  };
  const fingerprint = JSON.stringify({
    sources: sources.map((source) => [source.id, source.exists, source.serverCount]),
    imports: imports.map((entry) => [entry.kind, entry.path, entry.serverCount]),
    agentPlugins: agentPlugins.map((entry) => [entry.path, entry.name, entry.serverCount]),
    hostConfigDiscovery,
    conflicts: summaryWithoutRepoPrompt.conflicts
  });
  return {
    ...summaryWithoutRepoPrompt,
    fingerprint,
    repoPrompt: detectRepoPrompt(summaryWithoutRepoPrompt, cwd, loadedSources)
  };
}
function getConfigConflicts(loadedSources, imports, cwd, getImportedConfig) {
  const seen = /* @__PURE__ */ new Map();
  const record = (name, source) => {
    const entries = seen.get(name) ?? [];
    if (!entries.some((entry) => entry.kind === source.kind && entry.path === source.path)) entries.push(source);
    seen.set(name, entries);
  };
  for (const entry of imports) {
    const imported = getImportedConfig(entry.kind, `Failed to inspect imported MCP config from ${entry.kind}:`);
    if (!imported) continue;
    for (const name of Object.keys(extractServers(imported.value, entry.kind))) {
      record(name, { kind: "host", path: imported.path });
    }
  }
  for (const { source, config: loaded } of loadedSources) {
    if (!loaded) continue;
    if (loaded.imports?.length) {
      for (const importKind of loaded.imports) {
        const imported = getImportedConfig(importKind, `Failed to inspect imported MCP config from ${importKind}:`);
        if (!imported) continue;
        for (const name of Object.keys(extractServers(imported.value, importKind))) {
          record(name, { kind: "host", path: imported.path });
        }
      }
    }
    for (const name of Object.keys(loaded.mcpServers)) {
      record(name, {
        kind: source.shared ? "shared" : "pi",
        path: source.readPath
      });
    }
  }
  return [...seen.entries()].filter(([, sources]) => sources.length > 1).map(([serverName, sources]) => ({ serverName, sources, winner: sources[sources.length - 1] })).sort((left, right) => left.serverName.localeCompare(right.serverName));
}
function isRepoPromptServer(name, entry) {
  const normalizedName = name.toLowerCase();
  if (normalizedName.includes("repoprompt") || normalizedName === "rp") {
    return true;
  }
  const command = entry.command?.toLowerCase() ?? "";
  if (command.includes("repoprompt") || command.includes("rp-mcp") || command.endsWith("repoprompt_cli")) {
    return true;
  }
  return (entry.args ?? []).some((arg) => typeof arg === "string" && arg.toLowerCase().includes("repoprompt"));
}
function findProjectRoot(cwd = process.cwd()) {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, ".git")) || existsSync(join(current, "package.json")) || existsSync(join(current, PROJECT_CONFIG_NAME)) || existsSync(join(current, ".pi"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
function buildRepoPromptEntry(executablePath) {
  return {
    command: executablePath,
    args: [],
    lifecycle: "lazy"
  };
}
function detectRepoPrompt(summary, cwd = process.cwd(), loadedSources = []) {
  for (const source of summary.sources) {
    if (source.kind !== "shared" || source.serverCount === 0) continue;
    const config = loadedSources.find(({ source: loadedSource }) => loadedSource.readPath === source.path)?.config;
    if (!config) continue;
    for (const [name, entry] of Object.entries(config.mcpServers)) {
      if (isRepoPromptServer(name, entry)) {
        return { configured: true, configuredPath: source.path };
      }
    }
  }
  const executablePath = REPOPROMPT_BINARY_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    return { configured: false };
  }
  const projectRoot = findProjectRoot(cwd);
  const targetPath = projectRoot ? join(projectRoot, PROJECT_CONFIG_NAME) : GENERIC_GLOBAL_CONFIG_PATH;
  return {
    configured: false,
    executablePath,
    targetPath,
    serverName: "repoprompt",
    entry: buildRepoPromptEntry(executablePath)
  };
}

// src/commands/onboarding-state.ts
import { existsSync as existsSync2, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname as dirname2 } from "node:path";
var DEFAULT_STATE = {
  version: 1,
  sharedConfigHintShown: false,
  setupCompleted: false
};
function getOnboardingStatePath() {
  return getAgentPath("mcp-onboarding.json");
}
function loadOnboardingState() {
  const path = getOnboardingStatePath();
  if (!existsSync2(path)) return { ...DEFAULT_STATE };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE };
    return {
      version: 1,
      sharedConfigHintShown: raw.sharedConfigHintShown === true,
      setupCompleted: raw.setupCompleted === true,
      ...typeof raw.lastDiscoveryFingerprint === "string" ? { lastDiscoveryFingerprint: raw.lastDiscoveryFingerprint } : {}
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}
function saveOnboardingState(state) {
  const path = getOnboardingStatePath();
  mkdirSync(dirname2(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}
`, "utf-8");
  renameSync(tmpPath, path);
}
function updateOnboardingState(updater) {
  const next = updater(loadOnboardingState());
  saveOnboardingState(next);
  return next;
}
function markSharedConfigHintShown(fingerprint) {
  return updateOnboardingState((state) => {
    const lastDiscoveryFingerprint = fingerprint ?? state.lastDiscoveryFingerprint;
    return {
      ...state,
      sharedConfigHintShown: true,
      ...lastDiscoveryFingerprint !== void 0 ? { lastDiscoveryFingerprint } : {}
    };
  });
}
function markSetupCompleted(fingerprint) {
  return updateOnboardingState((state) => {
    const lastDiscoveryFingerprint = fingerprint ?? state.lastDiscoveryFingerprint;
    return {
      ...state,
      setupCompleted: true,
      ...lastDiscoveryFingerprint !== void 0 ? { lastDiscoveryFingerprint } : {}
    };
  });
}

// src/commands/handlers.ts
function terminalHyperlink(label, url) {
  return `\x1B]8;;${sanitizeTerminalText(url)}\x1B\\${sanitizeTerminalText(label)}\x1B]8;;\x1B\\`;
}
function canRenderPanel(ctx) {
  return ctx.hasUI && ctx.mode === "tui";
}
async function showStatus(state, ctx) {
  if (!ctx.hasUI) return;
  const lines = ["MCP Server Status:", ""];
  for (const name of Object.keys(state.config.mcpServers)) {
    const definition = state.config.mcpServers[name];
    if (isServerDisabled(definition)) {
      lines.push(`\u2298 ${name}: disabled (run /mcp enable ${name}, then /reload)`);
      continue;
    }
    const connection = state.manager.getConnection(name);
    const metadata = state.toolMetadata.get(name);
    const toolCount = metadata?.length ?? 0;
    const failedAgo = getFailureAgeSeconds(state, name);
    let status = "not connected";
    let statusIcon = "\u25CB";
    let failed = false;
    if (connection?.status === "connected") {
      status = "connected";
      statusIcon = "\u2713";
    } else if (connection?.status === "needs-auth") {
      status = "needs auth";
      statusIcon = "\u26A0";
    } else if (failedAgo !== null) {
      const reason = sanitizeTerminalText(getFailureMessage(state, name) ?? "");
      status = reason ? `failed ${failedAgo}s ago \u2014 ${reason}` : `failed ${failedAgo}s ago`;
      statusIcon = "\u2717";
      failed = true;
    } else if (metadata !== void 0) {
      status = "cached";
    }
    const toolSuffix = failed ? "" : ` (${toolCount} tools${status === "cached" ? ", cached" : ""})`;
    lines.push(`${statusIcon} ${name}: ${status}${toolSuffix}`);
  }
  if (Object.keys(state.config.mcpServers).length === 0) {
    lines.push("No MCP servers configured");
    lines.push("Run /mcp setup to adopt imports or scaffold a starter .mcp.json");
  }
  ctx.ui.notify(lines.join("\n"), "info");
}
async function showPrompts(state, ctx) {
  if (!ctx.hasUI) return;
  const allPrompts = [...state.promptMetadata?.values() ?? []].flat();
  const failedPromptServers = [...state.manager.getAllConnections?.() ?? []].filter(([, connection]) => connection.status === "connected" && connection.promptDiscoveryFailed).map(([serverName]) => serverName).sort();
  if (allPrompts.length === 0) {
    const failureNote = failedPromptServers.length > 0 ? ` Prompt discovery failed for: ${failedPromptServers.join(", ")}.` : "";
    ctx.ui.notify(`No MCP prompts available. Prompts are discovered when servers with the \`prompts\` capability connect.${failureNote}`, "info");
    return;
  }
  const lines = ["MCP Prompts:", ""];
  const grouped = /* @__PURE__ */ new Map();
  for (const prompt of allPrompts) {
    const list = grouped.get(prompt.serverName) ?? [];
    list.push(prompt);
    grouped.set(prompt.serverName, list);
  }
  for (const [serverName, prompts] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${serverName}:`);
    for (const prompt of prompts.sort((a, b) => a.commandName.localeCompare(b.commandName))) {
      const args = prompt.arguments.map((argument) => argument.required ? `<${argument.name}>` : `[${argument.name}]`).join(" ");
      lines.push(`  /${prompt.commandName}${args ? ` ${args}` : ""}`);
      if (prompt.description) lines.push(`      ${prompt.description}`);
    }
    lines.push("");
  }
  lines.push(`Total: ${allPrompts.length} prompt${allPrompts.length === 1 ? "" : "s"}`);
  if (failedPromptServers.length > 0) {
    lines.push(`Prompt discovery failed for: ${failedPromptServers.join(", ")}. Cached prompt metadata may be stale.`);
  }
  ctx.ui.notify(lines.join("\n"), "info");
}
async function showTools(state, ctx) {
  if (!ctx.hasUI) return;
  const allTools = [...state.toolMetadata.entries()].filter(([serverName]) => !isServerDisabled(state.config.mcpServers[serverName])).filter(([serverName]) => !isServerInActiveFailureBackoff(state, serverName)).flatMap(([, metadata]) => metadata.map((m) => m.name));
  if (allTools.length === 0) {
    ctx.ui.notify("No MCP tools available", "info");
    return;
  }
  const lines = [
    "MCP Tools:",
    "",
    ...allTools.map((t) => `  ${t}`),
    "",
    `Total: ${allTools.length} tools`
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}
async function reconnectServer(state, ctx, name) {
  const definition = state.config.mcpServers[name];
  const ui = ctx.hasUI ? ctx.ui : void 0;
  const signal = state.owner?.signal;
  if (!definition) {
    if (ui) {
      ui.notify(`Server "${name}" not found in config`, "error");
    }
    return false;
  }
  if (isServerDisabled(definition)) {
    if (ui) ui.notify(`MCP: ${name} is disabled. Run /mcp enable ${name}, then /reload.`, "warning");
    return false;
  }
  try {
    await state.manager.close(name);
    state.owner?.throwIfInactive();
    const connection = signal ? await state.manager.connect(name, definition, signal) : await state.manager.connect(name, definition);
    state.owner?.throwIfInactive();
    if (connection.status === "needs-auth") {
      if (ui) {
        ui.notify(`MCP: ${name} requires OAuth. Run /mcp-auth ${name} first.`, "warning");
      }
      updateStatusBar(state);
      return false;
    }
    const prefix = state.config.settings?.toolPrefix ?? "server";
    const { metadata, failedTools } = buildToolMetadata(connection.tools, connection.resources, definition, name, prefix, state.config.mcpServers, state.toolMetadata);
    state.toolMetadata.set(name, metadata);
    if (!connection.promptDiscoveryFailed) {
      state.promptMetadata?.set(name, reconstructPromptMetadata(name, connection.prompts ?? [], prefix, definition));
      state.promptMetadataLive?.add(name);
    }
    if (connection.instructions) {
      state.serverInstructions.set(name, connection.instructions);
    } else {
      state.serverInstructions.delete(name);
    }
    updateMetadataCache(state, name);
    const restored = clearFailure(state, name, "command-reconnect");
    if (!restored) notifyToolMetadataUpdated(state, name, "command-reconnect");
    markKeepAliveAfterConnect(state, name);
    if (ui) {
      ui.notify(
        `MCP: Reconnected to ${name} (${connection.tools.length} tools, ${connection.resources.length} resources)`,
        "info"
      );
      if (failedTools.length > 0) {
        ui.notify(`MCP: ${name} - ${failedTools.length} tools skipped`, "warning");
      }
    }
    updateStatusBar(state);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAbortError(error, signal)) throw error;
    recordFailure(state, name, message);
    if (ui) {
      ui.notify(`MCP: Failed to reconnect to ${name}: ${sanitizeTerminalText(message)}`, "error");
    }
    updateStatusBar(state);
    return false;
  }
}
async function reconnectServers(state, ctx, targetServer) {
  if (targetServer && !state.config.mcpServers[targetServer]) {
    if (ctx.hasUI) {
      ctx.ui.notify(`Server "${targetServer}" not found in config`, "error");
    }
    return;
  }
  const names = targetServer ? [targetServer] : Object.keys(state.config.mcpServers);
  for (const name of names) {
    await reconnectServer(state, ctx, name);
  }
  updateStatusBar(state);
}
async function authenticateServer(serverName, config, ctx, signal, runtime) {
  const ui = ctx.hasUI ? ctx.ui : void 0;
  const cwd = ctx.cwd;
  signal ??= ctx.signal;
  if (!ui) return { ok: false, message: "OAuth authentication requires an interactive session." };
  const definition = config.mcpServers[serverName];
  if (!definition) {
    const message = `Server "${serverName}" not found in config`;
    ui.notify(message, "error");
    return { ok: false, message };
  }
  if (isServerDisabled(definition)) {
    const message = `Server "${serverName}" is disabled. Run /mcp enable ${serverName}, then /reload.`;
    ui.notify(message, "warning");
    return { ok: false, message };
  }
  if (!supportsOAuth(definition)) {
    const message = `Server "${serverName}" does not use OAuth authentication. Set "auth": "oauth" or omit auth for auto-detection.`;
    ui.notify(
      `Server "${serverName}" does not use OAuth authentication.
Set "auth": "oauth" or omit auth for auto-detection.`,
      "error"
    );
    return { ok: false, message };
  }
  try {
    const serverUrl = resolveServerUrl(definition);
    if (!serverUrl) {
      const message2 = `Server "${serverName}" has no URL configured (OAuth requires HTTP transport)`;
      ui.notify(message2, "error");
      return { ok: false, message: message2 };
    }
    ui.setStatus("mcp-auth", `Authenticating ${serverName}...`);
    const authStorageOptions = getAuthStorageOptions(config.settings?.oauthDir, cwd);
    const status = await authenticate(serverName, serverUrl, definition, {
      ...authStorageOptions.baseDir ? { authStorageOptions } : {},
      onAuthorizationUrl: () => {
      },
      onAuthorizationInput: async (authorizationUrl, inputSignal) => {
        if (inputSignal.aborted) return void 0;
        return ui.input(
          `Complete ${serverName} OAuth

${terminalHyperlink("Open authorization page", authorizationUrl)}
${authorizationUrl}

Approve access, then paste the full localhost callback URL below.`,
          void 0,
          { signal: inputSignal }
        );
      },
      ...signal ? { signal } : {},
      ...runtime ? { runtime } : {}
    });
    if (signal?.aborted) signal.throwIfAborted();
    if (status === "authenticated") {
      const message2 = `OAuth authentication successful for "${serverName}".`;
      ui.notify(message2, "info");
      return { ok: true, message: message2 };
    }
    const message = `OAuth authentication failed for "${serverName}".`;
    ui.notify(message, "error");
    return { ok: false, message };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    ui.notify(`Failed to authenticate "${serverName}": ${message}`, "error");
    return { ok: false, message };
  } finally {
    if (!signal?.aborted) ui.setStatus("mcp-auth", void 0);
  }
}
async function logoutServer(serverName, state, ctx) {
  const definition = state.config.mcpServers[serverName];
  const ui = ctx.hasUI ? ctx.ui : void 0;
  if (!definition) {
    const message2 = `Server "${serverName}" not found in config`;
    if (ui) ui.notify(message2, "error");
    return { ok: false, message: message2 };
  }
  const signal = state.owner?.signal;
  try {
    await removeAuth(serverName, { authStorageOptions: state.authStorageOptions, signal, runtime: state.oauthRuntime });
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    const message2 = error instanceof Error ? error.message : String(error);
    if (ui) {
      ui.notify(`Failed to clear OAuth credentials for "${serverName}": ${sanitizeTerminalText(message2)}`, "error");
    }
    return { ok: false, message: message2 };
  }
  state.owner?.throwIfInactive();
  try {
    await state.manager.close(serverName);
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    const message2 = error instanceof Error ? error.message : String(error);
    if (ui) {
      ui.notify(
        `OAuth credentials were cleared for "${serverName}", but its connection could not be closed: ${sanitizeTerminalText(message2)}`,
        "error"
      );
    }
    return { ok: false, message: message2 };
  }
  state.owner?.throwIfInactive();
  updateStatusBar(state);
  const message = `OAuth credentials cleared for "${serverName}". Run /mcp-auth ${serverName} to authenticate again.`;
  if (ui) ui.notify(message, "info");
  return { ok: true, message };
}
function validateBearerTokenStoreServer(serverName, state) {
  const safeName = sanitizeTerminalText(serverName);
  const definition = state.config.mcpServers[serverName];
  if (!definition) return { ok: false, message: `Server "${safeName}" not found in config`, type: "error" };
  if (isServerDisabled(definition)) return { ok: false, message: `Server "${safeName}" is disabled. Run /mcp enable ${safeName}, then /reload.`, type: "warning" };
  if (definition.auth !== "bearer" || definition.bearerTokenStore !== true) {
    return { ok: false, message: `Server "${safeName}" is not configured for bearerTokenStore.`, type: "error" };
  }
  let serverUrl;
  try {
    serverUrl = resolveServerUrl(definition);
  } catch {
    return { ok: false, message: `Server "${safeName}" has an invalid or unresolvable URL.`, type: "error" };
  }
  if (!serverUrl) return { ok: false, message: `Server "${safeName}" has no URL configured.`, type: "error" };
  return { ok: true, serverUrl };
}
async function manageBearerToken(action, serverName, state, ctx) {
  const ui = ctx.hasUI ? ctx.ui : void 0;
  const safeName = sanitizeTerminalText(serverName);
  const validation = validateBearerTokenStoreServer(serverName, state);
  if (!validation.ok) {
    if (ui) ui.notify(validation.message, validation.type);
    return { ok: false, message: validation.message };
  }
  if (action === "set") {
    const message2 = `Cannot store bearer token here: Pi extension UI has no masked secret input primitive. Run \`pi-mcp-adapter token set ${safeName}\` in a terminal; it reads the token from stdin only.`;
    if (ui) ui.notify(message2, "error");
    return { ok: false, message: message2 };
  }
  if (action === "status") {
    const status = inspectBearerTokenForUrl(serverName, validation.serverUrl);
    const message2 = status.status === "present" ? `Bearer token is stored for "${safeName}".` : status.status === "url-mismatch" ? `Bearer token is stored for "${safeName}", but its URL does not match the current server URL.` : status.status === "unavailable" ? status.message : `No bearer token is stored for "${safeName}".`;
    if (ui) ui.notify(message2, status.status === "unavailable" ? "error" : "info");
    return { ok: status.status !== "unavailable", message: message2 };
  }
  try {
    removeBearerToken(serverName);
  } catch (error) {
    const message2 = error instanceof Error ? error.message : String(error);
    if (ui) ui.notify(`Failed to remove bearer token for "${safeName}": ${sanitizeTerminalText(message2)}`, "error");
    return { ok: false, message: message2 };
  }
  const message = `Bearer token removed for "${safeName}".`;
  if (ui) ui.notify(message, "info");
  return { ok: true, message };
}
function buildSharedConfigNoticeLines(configOverridePath, cwd) {
  const discovery = getMcpStandardConfigSummary(configOverridePath, cwd);
  const onboardingState = loadOnboardingState();
  if (!discovery.hasSharedServers || onboardingState.sharedConfigHintShown) {
    return { lines: [], fingerprint: null };
  }
  const sharedSources = discovery.sources.filter((source) => source.kind === "shared" && source.serverCount > 0);
  const sourceList = sharedSources.map((source) => source.path).join(", ");
  return {
    lines: [
      `Using standard MCP config from ${sourceList}.`,
      "Pi only writes compatibility imports and adapter-specific overrides into Pi-owned files when needed."
    ],
    fingerprint: discovery.fingerprint
  };
}
async function openMcpSetup(state, pi, ctx, configOverridePath, mode = "setup", options = {}) {
  if (!ctx.hasUI) return { configChanged: false };
  if (!canRenderPanel(ctx)) {
    ctx.ui.notify(`The interactive MCP setup panel is only available in the terminal UI (current mode: ${ctx.mode}). Edit .mcp.json directly, or run /mcp status to review servers.`, "info");
    return { configChanged: false };
  }
  if (state.programmaticConfig) {
    ctx.ui.notify("MCP setup is unavailable when config is supplied by createMcpAdapter().", "info");
    return { configChanged: false };
  }
  const discovery = getMcpDiscoverySummary(configOverridePath, ctx.cwd, options);
  const onboardingState = loadOnboardingState();
  const { createMcpSetupPanel } = await import("./mcp-setup-panel-D3LDYR25.js");
  let configChanged = false;
  const callbacks = {
    previewImports: (imports) => previewCompatibilityImports(imports, configOverridePath),
    previewStarterProject: () => previewStarterProjectConfig(ctx.cwd),
    previewRepoPrompt: () => {
      const repoPrompt = getMcpDiscoverySummary(configOverridePath, ctx.cwd, options).repoPrompt;
      if (!repoPrompt.entry || !repoPrompt.targetPath || !repoPrompt.serverName) return null;
      return previewSharedServerEntry(repoPrompt.targetPath, repoPrompt.serverName, repoPrompt.entry);
    },
    previewKnownServer: (preset) => previewSharedServerEntry(getProjectConfigPath(ctx.cwd), preset.id, preset.entry),
    adoptImports: async (imports) => {
      const result = ensureCompatibilityImports(imports, configOverridePath);
      if (result.added.length > 0) configChanged = true;
      return result;
    },
    scaffoldProjectConfig: async () => {
      const path = writeStarterProjectConfig(ctx.cwd);
      configChanged = true;
      return { path };
    },
    addRepoPrompt: async () => {
      const repoPrompt = getMcpDiscoverySummary(configOverridePath, ctx.cwd, options).repoPrompt;
      if (!repoPrompt.entry || !repoPrompt.targetPath || !repoPrompt.serverName) {
        throw new Error("RepoPrompt is not available to add from this setup screen.");
      }
      const path = writeSharedServerEntry(repoPrompt.targetPath, repoPrompt.serverName, repoPrompt.entry);
      configChanged = true;
      return { path, serverName: repoPrompt.serverName };
    },
    addKnownServer: async (preset) => {
      const path = writeSharedServerEntry(getProjectConfigPath(ctx.cwd), preset.id, preset.entry);
      configChanged = true;
      return { path, serverName: preset.name };
    },
    openPath: async (targetPath) => {
      await openPath(pi, targetPath);
    },
    markSetupCompleted: () => {
      markSetupCompleted(discovery.fingerprint);
    }
  };
  return new Promise((resolve2) => {
    ctx.ui.custom(
      (tui, _theme, keybindings, done) => {
        return createMcpSetupPanel(discovery, callbacks, { mode, onboardingState, keybindings }, tui, () => {
          done(void 0);
          resolve2({ configChanged });
        });
      },
      { overlay: true, overlayOptions: { anchor: "center", width: 92 } }
    );
  });
}
function buildMcpPanelCallbacks(state, config, ctx, getOverlayHandle) {
  const authStatusFailures = /* @__PURE__ */ new Map();
  return {
    reconnect: (serverName) => reconnectServer(state, ctx, serverName),
    canAuthenticate: (serverName) => {
      const definition = config.mcpServers[serverName];
      return definition ? !isServerDisabled(definition) && supportsOAuth(definition) : false;
    },
    authenticate: async (serverName) => {
      const overlay = getOverlayHandle?.();
      overlay?.setHidden(true);
      try {
        return await authenticateServer(serverName, config, ctx, state.owner?.signal, state.oauthRuntime);
      } finally {
        overlay?.setHidden(false);
        overlay?.focus();
      }
    },
    getConnectionStatus: (serverName) => {
      authStatusFailures.delete(serverName);
      const definition = config.mcpServers[serverName];
      if (isServerDisabled(definition)) return "disabled";
      const connection = state.manager.getConnection(serverName);
      let serverUrl;
      try {
        serverUrl = definition ? resolveServerUrl(definition) : void 0;
      } catch {
        return "failed";
      }
      if (definition?.auth === "oauth" && serverUrl && definition.oauth !== false && definition.oauth?.grantType !== "client_credentials") {
        const authStatus = inspectAuthForUrl(serverName, serverUrl, state.authStorageOptions);
        if (authStatus.status === "unavailable") {
          authStatusFailures.set(serverName, authStatus.message);
          return "failed";
        }
        if (authStatus.status === "absent" || !authStatus.entry.tokens) {
          return "needs-auth";
        }
      }
      if (connection?.status === "needs-auth") return "needs-auth";
      if (connection?.status === "connected") return "connected";
      if (getFailureAgeSeconds(state, serverName) !== null) return "failed";
      return "idle";
    },
    getFailureMessage: (serverName) => authStatusFailures.get(serverName) ?? getFailureMessage(state, serverName),
    refreshCacheAfterReconnect: (serverName) => {
      const freshCache = loadMetadataCache();
      return freshCache?.servers?.[serverName] ?? null;
    }
  };
}
async function openMcpPanel(state, pi, ctx, configOverridePath, onDirectToolsConfigChanged) {
  if (state.programmaticConfig) {
    if (ctx.hasUI) {
      ctx.ui.notify("MCP status is shown from the in-memory SDK config; configuration discovery is unavailable.", "info");
      await showStatus(state, ctx);
    }
    return { configChanged: false };
  }
  if (!canRenderPanel(ctx)) {
    await showStatus(state, ctx);
    return { configChanged: false };
  }
  if (Object.keys(state.config.mcpServers).length === 0) {
    return openMcpSetup(state, pi, ctx, configOverridePath, "empty", { includeHostConfigs: false });
  }
  const config = state.config;
  const cache = loadMetadataCache();
  const configPath = pi.getFlag("mcp-config") ?? configOverridePath;
  const provenanceMap = getServerProvenance(configPath, ctx.cwd);
  const { lines: noticeLines, fingerprint } = buildSharedConfigNoticeLines(configPath, ctx.cwd);
  let overlayHandle;
  const callbacks = buildMcpPanelCallbacks(state, config, ctx, () => overlayHandle);
  const { createMcpPanel } = await import("./mcp-panel-4XPFQWFJ.js");
  let configChanged = false;
  await new Promise((resolve2) => {
    ctx.ui.custom(
      (tui, _theme, keybindings, done) => {
        return createMcpPanel(config, cache, provenanceMap, callbacks, tui, (result) => {
          void (async () => {
            if (!result.cancelled && result.changes.size > 0) {
              writeDirectToolsConfig(result.changes, provenanceMap, config);
              await onDirectToolsConfigChanged?.(result.changes);
              ctx.ui.notify("Direct tools updated for this session.", "info");
            }
            done(void 0);
            resolve2();
          })().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`Direct tools updated, but live refresh failed: ${message}`, "error");
            configChanged = true;
            done(void 0);
            resolve2();
          });
        }, { noticeLines, keybindings });
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: 82 },
        onHandle: (handle) => {
          overlayHandle = handle;
        }
      }
    );
  });
  if (noticeLines.length > 0 && fingerprint) {
    markSharedConfigHintShown(fingerprint);
  }
  return { configChanged };
}
async function openMcpAuthPanel(state, pi, ctx, configOverridePath) {
  if (!ctx.hasUI) return { configChanged: false };
  if (!canRenderPanel(ctx)) {
    ctx.ui.notify(`The interactive MCP auth panel is only available in the terminal UI (current mode: ${ctx.mode}). Use /mcp-auth <server> to authenticate a specific server.`, "info");
    return { configChanged: false };
  }
  if (state.programmaticConfig) {
    ctx.ui.notify("Use /mcp-auth <server> to authenticate a server from the in-memory SDK config.", "info");
    return { configChanged: false };
  }
  const config = state.config;
  const oauthServers = Object.entries(config.mcpServers).filter(
    ([, definition]) => !isServerDisabled(definition) && supportsOAuth(definition)
  );
  if (oauthServers.length === 0) {
    ctx.ui.notify("No OAuth-capable MCP servers are configured.", "warning");
    return { configChanged: false };
  }
  const cache = loadMetadataCache();
  const configPath = pi.getFlag("mcp-config") ?? configOverridePath;
  const provenanceMap = getServerProvenance(configPath, ctx.cwd);
  let overlayHandle;
  const callbacks = buildMcpPanelCallbacks(state, config, ctx, () => overlayHandle);
  const { createMcpPanel } = await import("./mcp-panel-4XPFQWFJ.js");
  await new Promise((resolve2) => {
    ctx.ui.custom(
      (tui, _theme, keybindings, done) => {
        return createMcpPanel(config, cache, provenanceMap, callbacks, tui, () => {
          done(void 0);
          resolve2();
        }, {
          authOnly: true,
          keybindings,
          noticeLines: ["Select an OAuth MCP server and press Enter or ctrl+a to authenticate."]
        });
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: 82 },
        onHandle: (handle) => {
          overlayHandle = handle;
        }
      }
    );
  });
  return { configChanged: false };
}
export {
  authenticateServer,
  logoutServer,
  manageBearerToken,
  openMcpAuthPanel,
  openMcpPanel,
  openMcpSetup,
  reconnectServer,
  reconnectServers,
  showPrompts,
  showStatus,
  showTools
};
