import {
  MCP_TOOL_APPROVAL_REQUEST_EVENT,
  computeServerHash,
  createCachedToolSelectorCandidateIndex,
  createMetadataCatalogSnapshot,
  formatToolName,
  getAgentDir,
  getAgentPath,
  getConfigDirName,
  getConfigPathFromArgv,
  getConfigSources,
  getProjectPiConfigPath,
  getToolNameCandidates,
  isExclusiveConfigMode,
  isServerCacheValid,
  isServerDisabled,
  isToolAllowed,
  isUiToolVisibleToModel,
  openUrl,
  parseDirectToolSelectors,
  resolveToolPrefix,
  resourceNameToToolName
} from "./chunks/chunk-YANXOPYG.js";

// src/tools/mcp-references.ts
var BUILTIN_NAMES = /* @__PURE__ */ new Set(["read", "bash", "edit", "write", "grep", "find", "ls", "mcp"]);
function namespaceProxyName(serverName) {
  return `mcp__${serverName.replace(/-/g, "_")}`;
}
function parseMcpReference(raw) {
  if (!raw.startsWith("mcp:")) return { raw };
  const rest = raw.slice("mcp:".length).trim();
  if (!rest) return { raw };
  const slash = rest.indexOf("/");
  if (slash === -1) return { raw, server: rest };
  const server = rest.slice(0, slash).trim();
  const tool = rest.slice(slash + 1).trim();
  return {
    raw,
    ...server ? { server } : {},
    ...tool ? { tool } : {}
  };
}
function resolveDirectSelection(config, definition, serverName, envOverride) {
  if (envOverride) {
    if (envOverride.servers.has(serverName)) return true;
    const selectedTools = envOverride.tools.get(serverName);
    return selectedTools ? [...selectedTools] : false;
  }
  if (definition.directTools !== void 0) return definition.directTools;
  return config.settings?.directTools === true;
}
function isMcpServerDirectlyRegistered(definition, settings, serverName, envOverride) {
  if (envOverride) return envOverride.servers.has(serverName);
  if (definition?.directTools !== void 0) {
    return definition.directTools === true || Array.isArray(definition.directTools) && definition.directTools.length > 0;
  }
  return settings?.directTools === true;
}
function hasCallableCachedTargets(entry, definition) {
  return entry.tools.length > 0 || definition.exposeResources !== false && (entry.resources?.length ?? 0) > 0;
}
function hasNamespaceProxy(config, cache, envOverride, collidingNamespaceNames, existingDirectNames, serverName, snapshot) {
  const definition = config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition)) return false;
  if (isMcpServerDirectlyRegistered(definition, config.settings, serverName, envOverride)) return false;
  const toolName = namespaceProxyName(serverName);
  if (collidingNamespaceNames.has(toolName) || existingDirectNames.has(toolName)) return false;
  const entry = resolveValidCache(definition, cache, serverName, snapshot);
  return !!entry && hasCallableCachedTargets(entry, definition);
}
function resolveValidCache(definition, cache, serverName, snapshot) {
  if (!definition) return void 0;
  if (snapshot) return snapshot.validEntries.get(serverName);
  const entry = cache?.servers[serverName];
  if (!entry || !isServerCacheValid(entry, definition)) return void 0;
  return entry;
}
function cachedServers(config, cache, snapshot) {
  const servers = [];
  if (!cache) return servers;
  for (const [serverName, definition] of Object.entries(config.mcpServers)) {
    if (isServerDisabled(definition)) continue;
    const entry = resolveValidCache(definition, cache, serverName, snapshot);
    if (!entry) continue;
    servers.push({ serverName, definition, entry, prefix: resolveToolPrefix(definition, config.settings?.toolPrefix) });
  }
  return servers;
}
function namespaceCollisionNames(config, cache, envOverride, existingDirectNames, snapshot) {
  const names = /* @__PURE__ */ new Map();
  if (!cache) return /* @__PURE__ */ new Set();
  for (const serverName of Object.keys(config.mcpServers)) {
    if (!hasNamespaceProxy(config, cache, envOverride, /* @__PURE__ */ new Set(), existingDirectNames, serverName, snapshot)) continue;
    const toolName = namespaceProxyName(serverName);
    names.set(toolName, (names.get(toolName) ?? 0) + 1);
  }
  return new Set([...names].filter(([, count]) => count > 1).map(([name]) => name));
}
function registeredDirectNames(config, cache, envOverride, selectorIndex, snapshot) {
  const owners = /* @__PURE__ */ new Map();
  for (const { serverName, definition, entry, prefix } of cachedServers(config, cache, snapshot)) {
    const selection = resolveDirectSelection(config, definition, serverName, envOverride);
    for (const { name, originalName } of directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex)) {
      if (!owners.has(name)) owners.set(name, { serverName, originalName });
    }
  }
  return owners;
}
function allCurrentCandidates(config, cache, snapshot) {
  if (!cache) return void 0;
  return createCachedToolSelectorCandidateIndex(config.mcpServers, cache, config.settings?.toolPrefix ?? "server", snapshot);
}
function directToolName(toolName, serverName, definition, prefix, selectorIndex) {
  if (!isToolAllowed(toolName, serverName, prefix, definition.includeTools, definition.excludeTools, selectorIndex)) return void 0;
  return formatToolName(toolName, serverName, prefix);
}
function directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex, onlyTool) {
  if (!selection) return [];
  const names = [];
  const addTool = (toolName) => {
    if (selection !== true && !selection.includes(toolName)) return;
    const name = directToolName(toolName, serverName, definition, prefix, selectorIndex);
    if (!name) return;
    if (BUILTIN_NAMES.has(name)) return;
    if (onlyTool !== void 0 && toolName !== onlyTool && name !== onlyTool) return;
    names.push({ name, originalName: toolName });
  };
  for (const tool of entry.tools) {
    if (!isUiToolVisibleToModel(tool.uiVisibility)) continue;
    addTool(tool.name);
  }
  if (definition.exposeResources !== false) {
    for (const resource of entry.resources ?? []) addTool(`read_${resourceNameToToolName(resource.name)}`);
  }
  return names;
}
function ownedDirectToolNames(names, serverName, directNameOwners) {
  return names.filter(({ name, originalName }) => {
    const owner = directNameOwners.get(name);
    return owner?.serverName === serverName && owner.originalName === originalName;
  }).map(({ name }) => name);
}
function hasAllowedProxyTool(entry, serverName, definition, prefix, selectorIndex, toolName) {
  if (toolName === void 0) return true;
  const matchesAllowedName = (baseName) => {
    if (!isToolAllowed(baseName, serverName, prefix, definition.includeTools, definition.excludeTools, selectorIndex)) return false;
    return toolName === formatToolName(baseName, serverName, prefix);
  };
  if (entry.tools.some(
    (tool) => isUiToolVisibleToModel(tool.uiVisibility) && matchesAllowedName(tool.name)
  )) return true;
  if (definition.exposeResources === false) return false;
  return (entry.resources ?? []).some((resource) => {
    const baseName = `read_${resourceNameToToolName(resource.name)}`;
    return matchesAllowedName(baseName);
  });
}
function addName(names, seen, name) {
  if (seen.has(name)) return;
  seen.add(name);
  names.push(name);
}
function resolveKnownServerReference(parsed, config, cache, envOverride, collidingNamespaceNames, existingDirectNames, directNameOwners, selectorIndex, names, seen, diagnostics, snapshot) {
  const serverName = parsed.server;
  const definition = config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition)) {
    diagnostics.push(`MCP reference "${parsed.raw}" refers to disabled or unknown server "${serverName}"`);
    return;
  }
  const entry = resolveValidCache(definition, cache, serverName, snapshot);
  if (!entry) {
    diagnostics.push(`MCP reference "${parsed.raw}" cannot be resolved: no valid cached metadata for server "${serverName}"`);
    return;
  }
  const prefix = resolveToolPrefix(definition, config.settings?.toolPrefix);
  const selection = resolveDirectSelection(config, definition, serverName, envOverride);
  const directNames = ownedDirectToolNames(
    directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex, parsed.tool),
    serverName,
    directNameOwners
  );
  if (directNames.length > 0) {
    for (const name of directNames) addName(names, seen, name);
    return;
  }
  if (hasNamespaceProxy(config, cache, envOverride, collidingNamespaceNames, existingDirectNames, serverName, snapshot)) {
    if (hasAllowedProxyTool(entry, serverName, definition, prefix, selectorIndex, parsed.tool)) {
      addName(names, seen, namespaceProxyName(serverName));
      return;
    }
    diagnostics.push(`MCP reference "${parsed.raw}" refers to unknown or hidden tool "${parsed.tool}" on server "${serverName}"`);
    return;
  }
  diagnostics.push(`MCP reference "${parsed.raw}" resolves to no registered tool`);
}
function resolveBareToolReference(raw, toolName, config, cache, envOverride, collidingNamespaceNames, existingDirectNames, directNameOwners, selectorIndex, names, seen, diagnostics, snapshot) {
  let matched = false;
  for (const { serverName, definition, entry, prefix } of cachedServers(config, cache, snapshot)) {
    const selection = resolveDirectSelection(config, definition, serverName, envOverride);
    const directNames = ownedDirectToolNames(
      directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex, toolName),
      serverName,
      directNameOwners
    );
    for (const name of directNames) {
      addName(names, seen, name);
      matched = true;
    }
    if (hasNamespaceProxy(config, cache, envOverride, collidingNamespaceNames, existingDirectNames, serverName, snapshot) && hasAllowedProxyTool(entry, serverName, definition, prefix, selectorIndex, toolName)) {
      addName(names, seen, namespaceProxyName(serverName));
      matched = true;
    }
  }
  if (!matched) diagnostics.push(`MCP reference "${raw}" does not match a configured server or cached tool`);
}
function resolveMcpToolReferences(refs, config, cache, envOverride, snapshot) {
  const names = [];
  const diagnostics = [];
  const seen = /* @__PURE__ */ new Set();
  if (!config) {
    return {
      names: refs.filter((ref) => !ref.startsWith("mcp:")),
      diagnostics: refs.filter((ref) => ref.startsWith("mcp:")).map((ref) => `MCP reference "${ref}" cannot be resolved: no MCP config`)
    };
  }
  const catalog = snapshot ?? createMetadataCatalogSnapshot(config, cache);
  const effectiveCache = catalog.cache;
  const parsedOverride = envOverride ? parseDirectToolSelectors(envOverride) : null;
  const selectorIndex = allCurrentCandidates(config, effectiveCache, catalog);
  const directNameOwners = registeredDirectNames(config, effectiveCache, parsedOverride, selectorIndex, catalog);
  const directNames = new Set(directNameOwners.keys());
  const collidingNamespaceNames = namespaceCollisionNames(config, effectiveCache, parsedOverride, directNames, catalog);
  for (const ref of refs) {
    if (!ref.startsWith("mcp:")) {
      addName(names, seen, ref);
      continue;
    }
    const parsed = parseMcpReference(ref);
    if (!parsed.server) {
      diagnostics.push(`MCP reference "${ref}" is empty after the "mcp:" prefix`);
      continue;
    }
    if (config.mcpServers[parsed.server]) {
      resolveKnownServerReference(parsed, config, effectiveCache, parsedOverride, collidingNamespaceNames, directNames, directNameOwners, selectorIndex, names, seen, diagnostics, catalog);
    } else if (parsed.tool === void 0) {
      resolveBareToolReference(ref, parsed.server, config, effectiveCache, parsedOverride, collidingNamespaceNames, directNames, directNameOwners, selectorIndex, names, seen, diagnostics, catalog);
    } else {
      diagnostics.push(`MCP reference "${ref}" refers to unknown server "${parsed.server}"`);
    }
  }
  return { names, diagnostics };
}

// src/contracts/status.ts
var MCP_STATUS_EVENT = "pi-mcp-adapter/status/v1";
var MCP_STATUS_SNAPSHOT_VERSION = 1;

// src/native/panel-data.ts
function asEntry(serverName, server, configuration, runtimePolicies2) {
  const mapped2 = configuration.servers.get(serverName);
  const runtimePolicy = runtimePolicies2.get(serverName);
  const directTools = server.directTools ?? mapped2?.directTools;
  const includeTools = runtimePolicy?.includeTools ?? mapped2?.includeTools;
  const excludeTools = runtimePolicy?.excludeTools ?? mapped2?.excludeTools;
  const exposeResources = runtimePolicy?.exposeResources ?? mapped2?.exposeResources;
  const toolPrefix = runtimePolicy?.toolPrefix ?? mapped2?.toolPrefix ?? configuration.toolPrefix;
  return {
    enabled: server.enabled,
    exposure: server.exposure,
    ...directTools === void 0 ? {} : { directTools: typeof directTools === "boolean" ? directTools : [...directTools] },
    ...includeTools === void 0 ? {} : { includeTools: [...includeTools] },
    ...excludeTools === void 0 ? {} : { excludeTools: [...excludeTools] },
    ...exposeResources === void 0 ? {} : { exposeResources },
    ...toolPrefix === void 0 ? {} : { toolPrefix }
  };
}
function currentCandidates(serverName, toolName, definition, servers, definitions) {
  const candidates = /* @__PURE__ */ new Set();
  for (const other of servers) {
    if (!other.enabled) continue;
    const otherDefinition = definitions.get(other.name);
    if (!otherDefinition) continue;
    const otherPrefix = resolveToolPrefix(otherDefinition, otherDefinition.toolPrefix ?? "server");
    for (const tool of other.catalog.tools) {
      if (tool.exposure === "hidden" || !isUiToolVisibleToModel(tool.uiVisibility)) continue;
      for (const candidate of getToolNameCandidates(tool.name, other.name, otherPrefix, false)) {
        candidates.add(candidate);
      }
    }
    if (otherDefinition.exposeResources !== false) {
      for (const resource of other.catalog.resources.items) {
        const resourceToolName = `read_${resourceNameToToolName(resource.name)}`;
        for (const candidate of getToolNameCandidates(resourceToolName, other.name, otherPrefix, false)) {
          candidates.add(candidate);
        }
      }
    }
  }
  const currentPrefix = resolveToolPrefix(definition, definition.toolPrefix ?? "server");
  for (const candidate of getToolNameCandidates(toolName, serverName, currentPrefix, false)) {
    candidates.delete(candidate);
  }
  return candidates;
}
function isToolAllowedByAdapter(name, serverName, definition, servers, definitions) {
  const prefix = definition.toolPrefix ?? "server";
  return isToolAllowed(
    name,
    serverName,
    prefix,
    definition.includeTools,
    definition.excludeTools,
    currentCandidates(serverName, name, definition, servers, definitions)
  );
}
function visibleTools(serverName, server, definition, servers, definitions) {
  return server.catalog.tools.filter(
    (tool) => isUiToolVisibleToModel(tool.uiVisibility) && tool.exposure !== "hidden" && isToolAllowedByAdapter(tool.name, serverName, definition, servers, definitions)
  );
}
function visibleResources(serverName, server, definition, servers, definitions) {
  if (definition.exposeResources === false || !server.catalog.resources.available) return [];
  return server.catalog.resources.items.filter((resource) => {
    const toolName = `read_${resourceNameToToolName(resource.name)}`;
    return isToolAllowedByAdapter(toolName, serverName, definition, servers, definitions);
  });
}
function countResources(serverName, server, definition, servers, definitions) {
  const items = visibleResources(serverName, server, definition, servers, definitions);
  const templates = definition.exposeResources === false || !server.catalog.resources.available ? [] : server.catalog.resources.templates.filter((template) => {
    const toolName = `read_${resourceNameToToolName(template.name)}`;
    return isToolAllowedByAdapter(toolName, serverName, definition, servers, definitions);
  });
  return items.length + templates.length;
}
function panelResources(items, templates) {
  return [
    ...items.map((item) => ({
      name: item.name,
      ...item.title === void 0 ? {} : { title: item.title },
      ...item.description === void 0 ? {} : { description: item.description },
      ...item.mimeType === void 0 ? {} : { mimeType: item.mimeType },
      kind: item.kind
    })),
    ...templates.map((template) => ({
      name: template.name,
      ...template.title === void 0 ? {} : { title: template.title },
      ...template.description === void 0 ? {} : { description: template.description },
      ...template.mimeType === void 0 ? {} : { mimeType: template.mimeType },
      kind: "template"
    }))
  ];
}
function toCachedTool(tool) {
  return {
    name: tool.name,
    ...tool.description === void 0 ? {} : { description: tool.description },
    ...tool.uiVisibility === void 0 ? {} : { uiVisibility: [...tool.uiVisibility] }
  };
}
function createNativeMcpPanelData(snapshot, configuration, runtimePolicies2 = /* @__PURE__ */ new Map()) {
  const definitions = /* @__PURE__ */ new Map();
  for (const server of snapshot.servers) {
    definitions.set(server.name, asEntry(server.name, server, configuration, runtimePolicies2));
  }
  const config = {
    mcpServers: Object.fromEntries(definitions),
    ...configuration.directTools === void 0 && configuration.toolPrefix === void 0 ? {} : {
      settings: {
        ...configuration.directTools === void 0 ? {} : { directTools: configuration.directTools },
        ...configuration.toolPrefix === void 0 ? {} : { toolPrefix: configuration.toolPrefix }
      }
    }
  };
  const cache = { version: 1, servers: {} };
  const details = /* @__PURE__ */ new Map();
  const visibleToolCountByServer = /* @__PURE__ */ new Map();
  const visibleResourceCountByServer = /* @__PURE__ */ new Map();
  for (const server of snapshot.servers) {
    const definition = definitions.get(server.name);
    if (!definition) continue;
    const metadata = server.catalog.freshness === "missing" ? void 0 : {
      configHash: computeServerHash(definition),
      tools: server.catalog.tools.map(toCachedTool),
      resources: [],
      cachedAt: Date.now()
    };
    if (metadata) cache.servers[server.name] = metadata;
    const resources = server.catalog.resources.freshness === "missing" ? [] : panelResources(
      visibleResources(server.name, server, definition, snapshot.servers, definitions),
      definition.exposeResources === false || !server.catalog.resources.available ? [] : server.catalog.resources.templates.filter((template) => {
        const toolName = `read_${resourceNameToToolName(template.name)}`;
        return isToolAllowedByAdapter(toolName, server.name, definition, snapshot.servers, definitions);
      })
    );
    const resourceCount = countResources(server.name, server, definition, snapshot.servers, definitions);
    const tools = visibleTools(server.name, server, definition, snapshot.servers, definitions);
    visibleToolCountByServer.set(server.name, tools.length);
    visibleResourceCountByServer.set(server.name, resourceCount);
    details.set(server.name, {
      scope: server.scope,
      catalogFreshness: server.catalog.freshness,
      resourceFreshness: server.catalog.resources.freshness,
      resourcesAvailable: server.catalog.resources.available,
      resources,
      toolExposures: new Map(server.catalog.tools.map((tool) => [tool.name, tool.exposure]))
    });
  }
  return {
    config,
    cache: Object.keys(cache.servers).length > 0 ? cache : null,
    details,
    visibleToolCountByServer,
    visibleResourceCountByServer
  };
}

// src/native/panel.ts
async function saveNativeDirectToolsChanges(handle, changes, isCurrentHandle) {
  const saved = [];
  const failed = [];
  const unknown = [];
  const notAttempted = [];
  const entries = [...changes.entries()];
  for (let index = 0; index < entries.length; index++) {
    const [name, selection] = entries[index];
    if (!isCurrentHandle()) {
      notAttempted.push(...entries.slice(index).map(([pendingName]) => pendingName));
      break;
    }
    try {
      const result = await handle.setDirectTools(name, Array.isArray(selection) ? [...selection] : selection);
      if (result.ok) {
        saved.push(name);
        continue;
      }
      failed.push({ name, message: result.error.message });
      if (result.error.code === "session-ended") {
        notAttempted.push(...entries.slice(index + 1).map(([pendingName]) => pendingName));
        break;
      }
    } catch {
      unknown.push(name);
      notAttempted.push(...entries.slice(index + 1).map(([pendingName]) => pendingName));
      break;
    }
  }
  return { saved, failed, unknown, notAttempted };
}
function serverIn(snapshot, name) {
  return snapshot?.servers.find((server) => server.name === name);
}
function panelCallbacks(options, getSnapshot, getOverlayHandle) {
  const { context, handle, pi } = options;
  const isCurrent = () => options.getCurrentHandle() === handle;
  const currentSnapshot = () => options.getCurrentSnapshot() ?? getSnapshot();
  return {
    canAuthenticate: (name) => {
      const server = serverIn(currentSnapshot(), name);
      return isCurrent() && server !== void 0 && server.enabled;
    },
    authenticate: async (name) => {
      if (!isCurrent()) return { ok: false, message: "The native MCP session has ended." };
      if (!context.hasUI) return { ok: false, message: "OAuth authentication requires an interactive session." };
      const overlay = getOverlayHandle();
      overlay?.setHidden(true);
      try {
        const result = await handle.signIn(name, {
          showAuthorizationUrl: (url) => {
            context.ui.notify(`Sign in to MCP server "${name}" in your browser:
${url.href}`, "info");
            void openUrl(pi, url.href, process.env.BROWSER, context.signal).catch(() => {
              context.ui.notify("The authorization page could not be opened automatically. Use the displayed link.", "warning");
            });
          },
          promptForRedirectUrl: async (signal) => context.ui.input(
            `Finish sign-in to MCP server "${name}". If the browser cannot reach this machine, paste its callback URL below.`,
            void 0,
            { signal }
          )
        }, context.signal);
        return result.ok ? { ok: true } : { ok: false, message: `Native MCP sign-in failed (${result.error.code}).` };
      } catch {
        return { ok: false, message: "Native MCP authentication could not be completed." };
      } finally {
        overlay?.setHidden(false);
        overlay?.focus();
      }
    },
    reconnect: async (name) => {
      if (!isCurrent()) return false;
      try {
        const result = await handle.reconnectServer(name);
        if (!result.ok) {
          context.ui.notify(`Native MCP reconnect failed for "${name}" (${result.error.code}).`, "error");
          return false;
        }
        const latest = handle.snapshot();
        return latest.ok && serverIn(latest.value, name)?.connectionStatus === "connected";
      } catch {
        context.ui.notify(`Native MCP reconnect failed for "${name}".`, "error");
        return false;
      }
    },
    getConnectionStatus: (name) => {
      const server = serverIn(currentSnapshot(), name);
      if (!server || !server.enabled || server.connectionStatus === "disabled") return "disabled";
      if (server.connectionStatus === "failed") return "failed";
      if (server.connectionStatus === "needs-auth") return "needs-auth";
      if (server.connectionStatus === "connecting" || server.connectionStatus === "starting") return "connecting";
      if (server.connectionStatus === "connected") return "connected";
      return "idle";
    },
    getFailureMessage: () => null,
    refreshCacheAfterReconnect: (name) => {
      let latest;
      try {
        latest = handle.snapshot();
      } catch {
        return null;
      }
      if (!latest.ok) return null;
      const server = serverIn(latest.value, name);
      if (!server || server.catalog.freshness !== "live") return null;
      const data = createNativeMcpPanelData(
        latest.value,
        options.configAssembly.getPanelConfiguration(options.getProjectTrust() === true),
        options.getRuntimePolicies()
      );
      return data.cache?.servers[name] ?? null;
    }
  };
}
function saveSummary(report) {
  const lines = [];
  if (report.saved.length > 0) lines.push(`Saved directTools for: ${report.saved.join(", ")}.`);
  for (const failure2 of report.failed) {
    lines.push(`Could not fully save/apply directTools for "${failure2.name}": ${failure2.message}`);
  }
  for (const name of report.unknown) {
    lines.push(`The directTools operation for "${name}" has an unknown outcome; it was not retried.`);
  }
  if (report.notAttempted.length > 0) {
    lines.push(`Not attempted after the native session changed: ${report.notAttempted.join(", ")}.`);
  }
  if (lines.length === 0) return void 0;
  return { message: lines.join("\n"), level: report.failed.length || report.unknown.length || report.notAttempted.length ? "error" : "info" };
}
function panelUnavailableResult(result) {
  return result.ok ? void 0 : result.error.message;
}
async function openNativeMcpPanel(options) {
  const { context, handle } = options;
  if (!context.hasUI) return;
  if (context.mode !== "tui") {
    const snapshot = handle.snapshot();
    if (!snapshot.ok) {
      context.ui.notify(snapshot.error.message, "error");
      return;
    }
    const lines = snapshot.value.servers.length === 0 ? ["No native MCP servers are visible in this session."] : snapshot.value.servers.map(
      (server) => `${server.name}: ${server.connectionStatus}; tools ${server.catalog.freshness}; resources ${server.catalog.resources.freshness}`
    );
    context.ui.notify(lines.join("\n"), "info");
    return;
  }
  if (options.getCurrentHandle() !== handle) {
    context.ui.notify("The native MCP session changed before the panel opened.", "error");
    return;
  }
  let initialSnapshot;
  try {
    initialSnapshot = handle.snapshot();
  } catch {
    context.ui.notify("The native MCP session snapshot could not be read.", "error");
    return;
  }
  const unavailable = panelUnavailableResult(initialSnapshot);
  if (unavailable) {
    context.ui.notify(unavailable, "error");
    return;
  }
  if (!initialSnapshot.ok) return;
  const { createMcpPanel } = await import("./chunks/mcp-panel-EHSHO42K.js");
  const configuration = options.configAssembly.getPanelConfiguration(options.getProjectTrust() === true);
  let overlayHandle;
  let activeView;
  let finished = false;
  await new Promise((resolve3) => {
    context.ui.custom(
      (tui, _theme, keybindings, done) => {
        let currentSnapshot = options.getCurrentSnapshot() ?? initialSnapshot.value;
        let data = createNativeMcpPanelData(currentSnapshot, configuration, options.getRuntimePolicies());
        const projectTrusted = options.getProjectTrust();
        const callbacks = panelCallbacks(options, () => currentSnapshot, () => overlayHandle);
        const component = createMcpPanel(
          data.config,
          data.cache,
          /* @__PURE__ */ new Map(),
          callbacks,
          tui,
          (result) => {
            if (finished) return;
            finished = true;
            options.setPanelView(void 0);
            void (async () => {
              if (!result.cancelled && result.changes.size > 0 && options.getCurrentHandle() === handle) {
                const report = await saveNativeDirectToolsChanges(handle, result.changes, () => options.getCurrentHandle() === handle);
                const summary = saveSummary(report);
                if (summary) context.ui.notify(summary.message, summary.level);
              } else if (!result.cancelled && result.changes.size > 0) {
                context.ui.notify("The native MCP session changed; directTools changes were not started.", "error");
              }
              done(void 0);
              resolve3();
            })().catch(() => {
              context.ui.notify("The native directTools operation could not be confirmed. It was not retried.", "error");
              done(void 0);
              resolve3();
            });
          },
          {
            keybindings,
            noticeLines: [
              "Direct-tool selection is saved through the native configuration owner.",
              "The saved selection is separate from this session's effective tool exposure."
            ],
            nativeDetails: data.details,
            showTokenEstimate: false,
            ...projectTrusted === void 0 ? {} : { projectTrusted }
          }
        );
        activeView = {
          handle,
          update: (snapshot, projectTrusted2) => {
            if (finished || options.getCurrentHandle() !== handle) return;
            currentSnapshot = snapshot;
            component.updateProjectTrust(projectTrusted2);
            data = createNativeMcpPanelData(
              snapshot,
              options.configAssembly.getPanelConfiguration(options.getProjectTrust() === true),
              options.getRuntimePolicies()
            );
            component.updateNativeData(data.config, data.cache, data.details);
          },
          markUnavailable: (message) => component.markNativeUnavailable(message)
        };
        options.setPanelView(activeView);
        return component;
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: 92 },
        onHandle: (overlay) => {
          overlayHandle = overlay;
        }
      }
    );
  });
  if (activeView && options.getCurrentHandle() === handle) options.setPanelView(void 0);
}

// src/native/status.ts
function createNativeStatusSnapshot(snapshot, configuration, runtimePolicies2 = /* @__PURE__ */ new Map()) {
  const panelData = createNativeMcpPanelData(snapshot, configuration, runtimePolicies2);
  const servers = [];
  let totalTools = 0;
  let totalResources = 0;
  let connectedCount = 0;
  let disabledCount = 0;
  for (const server of snapshot.servers) {
    const disabled = !server.enabled || server.connectionStatus === "disabled";
    let status;
    if (disabled) {
      status = "disabled";
      disabledCount++;
    } else if (server.connectionStatus === "failed") {
      status = "failed";
    } else if (server.connectionStatus === "needs-auth") {
      status = "needs-auth";
    } else if (server.connectionStatus === "connected") {
      status = "connected";
      connectedCount++;
    } else if (server.catalog.freshness === "cached") {
      status = "cached";
    } else {
      status = "not-connected";
    }
    const unavailableCatalog = disabled || status === "failed";
    const toolCount = unavailableCatalog ? 0 : panelData.visibleToolCountByServer.get(server.name) ?? 0;
    const resourceCount = unavailableCatalog || server.catalog.resources.freshness === "missing" ? void 0 : panelData.visibleResourceCountByServer.get(server.name) ?? 0;
    totalTools += disabled ? 0 : toolCount;
    if (!disabled && resourceCount !== void 0) totalResources += resourceCount;
    servers.push({
      name: server.name,
      status,
      toolCount,
      ...resourceCount === void 0 ? {} : { resourceCount },
      disabled
    });
  }
  return {
    version: MCP_STATUS_SNAPSHOT_VERSION,
    servers,
    totalTools,
    totalResources,
    connectedCount,
    disabledCount
  };
}
function publishNativeStatusSnapshot(pi, snapshot, configuration, runtimePolicies2 = /* @__PURE__ */ new Map()) {
  const status = createNativeStatusSnapshot(snapshot, configuration, runtimePolicies2);
  try {
    pi.events.emit(MCP_STATUS_EVENT, status);
  } catch {
  }
  return status;
}
function updateNativeStatusBar(pi, status) {
  if (!pi.hasUI) return;
  const failedCount = status.servers.filter((server) => server.status === "failed").length;
  const authCount = status.servers.filter((server) => server.status === "needs-auth").length;
  const cachedCount = status.servers.filter((server) => server.status === "cached").length;
  const disconnectedCount = status.servers.filter((server) => server.status === "not-connected").length;
  const message = [
    `${status.connectedCount} connected`,
    ...disconnectedCount ? [`${disconnectedCount} disconnected`] : [],
    ...cachedCount ? [`${cachedCount} cached`] : [],
    ...status.disabledCount ? [`${status.disabledCount} disabled`] : [],
    ...authCount ? [`${authCount} need auth`] : [],
    ...failedCount ? [`${failedCount} failed`] : []
  ].join(" \xB7 ");
  try {
    pi.ui.setStatus("mcp-adapter", status.servers.length > 0 ? `MCP: ${message}` : void 0);
  } catch {
  }
}
function clearNativeStatusBar(context) {
  updateNativeStatusBar(context, {
    version: MCP_STATUS_SNAPSHOT_VERSION,
    servers: [],
    totalTools: 0,
    totalResources: 0,
    connectedCount: 0,
    disabledCount: 0
  });
}
function publishNativeStatusShutdown(pi) {
  try {
    pi.events.emit(MCP_STATUS_EVENT, {
      version: MCP_STATUS_SNAPSHOT_VERSION,
      servers: [],
      totalTools: 0,
      totalResources: 0,
      connectedCount: 0,
      disabledCount: 0
    });
  } catch {
  }
}

// src/config/package-mcp-loader.ts
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import stripJsonComments from "strip-json-comments";

// src/config/validation.ts
var SERVER_FIELDS = /* @__PURE__ */ new Set([
  "enabled",
  "exposure",
  "toolExposure",
  "command",
  "args",
  "socket",
  "env",
  "cwd",
  "url",
  "headers",
  "requestHeadersCommand",
  "auth",
  "bearerToken",
  "bearerTokenEnv",
  "bearerTokenStore",
  "oauth",
  "lifecycle",
  "idleTimeout",
  "requestTimeoutMs",
  "exposeResources",
  "directTools",
  "toolPrefix",
  "includeTools",
  "excludeTools",
  "searchKeywords",
  "approveTools",
  "debug",
  "trace",
  "httpTransport",
  "pluginDataDir",
  "literalEnv",
  "protocolVersion",
  "disabled"
]);
var SETTINGS_FIELDS = /* @__PURE__ */ new Set([
  "toolPrefix",
  "showStatusIcon",
  "mcpFooterStatus",
  "notifyOnStartupConnect",
  "agentPluginPaths",
  "idleTimeout",
  "requestTimeoutMs",
  "directTools",
  "strictDirectToolArguments",
  "directToolResultDetails",
  "warnOnLargeDirectTools",
  "scriptMode",
  "toolResultRendering",
  "collapsedResultLines",
  "approveTools",
  "disableProxyTool",
  "freezeDirectTools",
  "autoAuth",
  "sampling",
  "samplingAutoApprove",
  "elicitation",
  "outputGuard",
  "trace",
  "authRequiredMessage",
  "oauthDir"
]);
var ROOT_FIELDS = /* @__PURE__ */ new Set(["mcpServers", "mcp-servers", "settings", "$schema", "imports"]);
var IGNORED_LEGACY_SETTINGS_FIELDS = /* @__PURE__ */ new Set(["hostConfigDiscovery"]);
var TOOL_PREFIXES = ["server", "none", "short", "mcp"];
var LIFECYCLE_MODES = ["keep-alive", "lazy", "lazy-keep-alive", "eager"];
var PROTOCOL_VERSIONS = ["legacy", "auto", "2026-07-28"];
var HTTP_TRANSPORTS = ["streamable-http", "sse"];
var URL_PROTOCOLS = /* @__PURE__ */ new Set(["http:", "https:"]);
var MAX_REQUEST_TIMEOUT_MS = 2147483647;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function addIssue(issues, code, path, message) {
  issues.push({ code, path, message });
}
function fail(issues) {
  const first = issues[0] ?? {
    code: "invalid-root",
    path: "config",
    message: "MCP configuration is invalid."
  };
  return {
    ok: false,
    error: { code: first.code, message: first.message, issues }
  };
}
function checkString(value, path, issues, code, expectation = "must be a string", allowEmpty = true) {
  if (typeof value !== "string" || !allowEmpty && value.trim().length === 0 || value.includes("\0")) {
    addIssue(issues, code, path, `${path} ${expectation}.`);
  }
}
function checkBoolean(value, path, issues, code) {
  if (typeof value !== "boolean") addIssue(issues, code, path, `${path} must be a boolean.`);
}
function checkEnum(value, values, path, issues, code) {
  if (typeof value !== "string" || !values.includes(value)) {
    addIssue(issues, code, path, `${path} must be one of: ${values.join(", ")}.`);
  }
}
function checkStringArray(value, path, issues, code) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.includes("\0"))) {
    addIssue(issues, code, path, `${path} must be an array of strings without NUL characters.`);
  }
}
function isValidDirectToolsSelection(value) {
  if (typeof value === "boolean") return true;
  try {
    if (!Array.isArray(value) || value.length > 256) return false;
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) return false;
      const toolName = value[index];
      if (typeof toolName !== "string" || toolName.length === 0 || toolName.length > 256 || /[\u0000-\u001f\u007f]/.test(toolName)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
function checkDirectToolsSelection(value, path, issues, code) {
  if (!isValidDirectToolsSelection(value)) {
    addIssue(issues, code, path, `${path} must be a boolean or an array of at most 256 bounded tool names.`);
  }
}
function checkStringRecord(value, path, issues, code) {
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== "string" || entry.includes("\0"))) {
    addIssue(issues, code, path, `${path} must be an object with string values without NUL characters.`);
  }
}
function checkHeaders(value, path, issues, code) {
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== "string" || entry.includes("\0"))) {
    addIssue(issues, code, path, `${path} must be an object with valid string header values.`);
    return;
  }
  const normalizedNames = Object.keys(value).map((name) => name.toLowerCase());
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    addIssue(issues, code, path, `${path} cannot contain duplicate header names with different casing.`);
    return;
  }
  try {
    new Headers(value);
  } catch {
    addIssue(issues, code, path, `${path} contains an invalid HTTP header name or value.`);
  }
}
function checkNumber(value, path, issues, code, minimum, integer = false, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || integer && !Number.isSafeInteger(value)) {
    const range = integer ? `a safe integer between ${minimum} and ${maximum}` : `a finite number between ${minimum} and ${maximum}`;
    addIssue(issues, code, path, `${path} must be ${range}.`);
  }
}
function checkHttpUrl(value, path, issues, code) {
  if (typeof value !== "string" || !URL.canParse(value)) {
    addIssue(issues, code, path, `${path} must be an absolute HTTP or HTTPS URL.`);
    return;
  }
  const url = new URL(value);
  if (!URL_PROTOCOLS.has(url.protocol) || url.username || url.password || url.hash) {
    addIssue(issues, code, path, `${path} must be an HTTP or HTTPS URL without embedded credentials or a fragment.`);
  }
}
function checkKnownFields(value, allowed, path, issues, code) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addIssue(issues, code, `${path}.${key}`, `${path}.${key} is not a supported configuration field.`);
  }
}
function validateOAuth(value, path, issues) {
  if (value === false) return;
  if (!isRecord(value)) {
    addIssue(issues, "invalid-server-field", path, `${path} must be false or an OAuth configuration object.`);
    return;
  }
  const fields = /* @__PURE__ */ new Set([
    "grantType",
    "clientId",
    "clientSecret",
    "scope",
    "authorizationParams",
    "redirectUri",
    "clientName",
    "clientUri",
    "logoUri",
    "skipIssuerMetadataValidation"
  ]);
  checkKnownFields(value, fields, path, issues, "unknown-server-field");
  if (value.grantType !== void 0) {
    checkEnum(value.grantType, ["authorization_code", "client_credentials"], `${path}.grantType`, issues, "invalid-nested-field");
  }
  for (const field of ["clientId", "clientSecret", "scope", "clientName"]) {
    if (value[field] !== void 0) checkString(value[field], `${path}.${field}`, issues, "invalid-nested-field");
  }
  for (const field of ["redirectUri", "clientUri", "logoUri"]) {
    if (value[field] !== void 0) checkHttpUrl(value[field], `${path}.${field}`, issues, "invalid-nested-field");
  }
  if (value.authorizationParams !== void 0) {
    checkStringRecord(value.authorizationParams, `${path}.authorizationParams`, issues, "invalid-nested-field");
  }
  if (value.skipIssuerMetadataValidation !== void 0) {
    checkBoolean(value.skipIssuerMetadataValidation, `${path}.skipIssuerMetadataValidation`, issues, "invalid-nested-field");
  }
}
function validateRequestHeadersCommand(value, path, issues) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid-server-field", path, `${path} must be a command configuration object.`);
    return;
  }
  const fields = /* @__PURE__ */ new Set(["command", "args", "env", "timeoutMs"]);
  checkKnownFields(value, fields, path, issues, "unknown-server-field");
  if (value.command === void 0) {
    addIssue(issues, "invalid-nested-field", `${path}.command`, `${path}.command is required.`);
  } else {
    checkString(value.command, `${path}.command`, issues, "invalid-nested-field", "must be a non-empty string", false);
  }
  if (value.args !== void 0) checkStringArray(value.args, `${path}.args`, issues, "invalid-nested-field");
  if (value.env !== void 0) checkStringRecord(value.env, `${path}.env`, issues, "invalid-nested-field");
  if (value.timeoutMs !== void 0 && (typeof value.timeoutMs !== "number" || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 6e4)) {
    addIssue(issues, "invalid-nested-field", `${path}.timeoutMs`, `${path}.timeoutMs must be an integer between 1 and 60000.`);
  }
}
function validateServerField(field, value, path, issues) {
  const code = "invalid-server-field";
  switch (field) {
    case "command":
    case "socket":
    case "cwd":
    case "bearerToken":
    case "bearerTokenEnv":
    case "pluginDataDir":
      checkString(value, path, issues, code, field === "command" || field === "socket" ? "must be a non-empty string" : "must be a string", field !== "command" && field !== "socket");
      break;
    case "args":
    case "includeTools":
    case "excludeTools":
      checkStringArray(value, path, issues, code);
      break;
    case "env":
      checkStringRecord(value, path, issues, code);
      break;
    case "headers":
      checkHeaders(value, path, issues, code);
      break;
    case "requestHeadersCommand":
      validateRequestHeadersCommand(value, path, issues);
      break;
    case "auth":
      if (value !== false && value !== "oauth" && value !== "bearer") {
        addIssue(issues, code, path, `${path} must be "oauth", "bearer", or false.`);
      }
      break;
    case "bearerTokenStore":
    case "exposeResources":
    case "enabled":
    case "debug":
    case "trace":
    case "literalEnv":
    case "disabled":
      checkBoolean(value, path, issues, code);
      break;
    case "oauth":
      validateOAuth(value, path, issues);
      break;
    case "lifecycle":
      checkEnum(value, LIFECYCLE_MODES, path, issues, code);
      break;
    case "exposure":
      checkEnum(value, ["codemode", "deferred", "direct", "hidden"], path, issues, code);
      break;
    case "toolExposure":
      if (!isRecord(value)) {
        addIssue(issues, code, path, `${path} must map tool names to exposure values.`);
      } else {
        for (const [name, exposure] of Object.entries(value)) {
          if (name.length === 0 || name.includes("\0")) {
            addIssue(issues, code, `${path}.<tool>`, `${path} contains an invalid tool name.`);
          }
          checkEnum(exposure, ["codemode", "deferred", "direct", "hidden"], `${path}.${name}`, issues, code);
        }
      }
      break;
    case "idleTimeout":
      checkNumber(value, path, issues, code, 0);
      break;
    case "requestTimeoutMs":
      checkNumber(value, path, issues, code, 0, false, MAX_REQUEST_TIMEOUT_MS);
      break;
    case "directTools":
      checkDirectToolsSelection(value, path, issues, code);
      break;
    case "toolPrefix":
      checkEnum(value, TOOL_PREFIXES, path, issues, code);
      break;
    case "searchKeywords":
      if (!isRecord(value)) {
        addIssue(issues, code, path, `${path} must map tool names to arrays of keywords.`);
      } else {
        for (const [name, keywords] of Object.entries(value)) {
          checkStringArray(keywords, `${path}.${name}`, issues, code);
        }
      }
      break;
    case "approveTools":
      if (typeof value !== "boolean") checkStringArray(value, path, issues, code);
      break;
    case "httpTransport":
      checkEnum(value, HTTP_TRANSPORTS, path, issues, code);
      break;
    case "protocolVersion":
      checkEnum(value, PROTOCOL_VERSIONS, path, issues, code);
      break;
    case "url":
      checkHttpUrl(value, path, issues, code);
      break;
  }
}
function validateServerEntry(name, raw, options = {}) {
  const issues = [];
  if (name.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(name)) {
    addIssue(issues, "invalid-server-name", "mcpServers.<entry>", "Server names must be non-empty and contain no control characters.");
  }
  if (!isRecord(raw)) {
    addIssue(issues, "invalid-server-entry", "mcpServers.<entry>", "Each server entry must be an object.");
    return fail(issues);
  }
  checkKnownFields(raw, SERVER_FIELDS, "mcpServers.<entry>", issues, "unknown-server-field");
  const transports = ["command", "url", "socket"].filter((field) => raw[field] !== void 0);
  if (transports.length > 1 || options.requireTransport && transports.length !== 1) {
    addIssue(issues, "invalid-server-entry", "mcpServers.<entry>", "A server entry must configure exactly one transport.");
  }
  if (typeof raw.enabled === "boolean" && typeof raw.disabled === "boolean" && raw.enabled === raw.disabled) {
    addIssue(issues, "invalid-server-entry", "mcpServers.<entry>", "enabled and disabled specify conflicting server states.");
  }
  for (const [field, value] of Object.entries(raw)) {
    if (SERVER_FIELDS.has(field) && value !== void 0) validateServerField(field, value, `mcpServers.<entry>.${field}`, issues);
  }
  if (issues.length > 0) return fail(issues);
  return { ok: true, value: structuredClone(raw) };
}
function validateSetting(field, value, issues) {
  const path = `settings.${field}`;
  const code = "invalid-setting";
  switch (field) {
    case "toolPrefix":
      checkEnum(value, TOOL_PREFIXES, path, issues, code);
      break;
    case "showStatusIcon":
    case "mcpFooterStatus":
      if (field === "showStatusIcon") checkBoolean(value, path, issues, code);
      else checkEnum(value, ["full", "compact", "off"], path, issues, code);
      break;
    case "notifyOnStartupConnect":
    case "directTools":
    case "strictDirectToolArguments":
    case "warnOnLargeDirectTools":
    case "scriptMode":
    case "disableProxyTool":
    case "freezeDirectTools":
    case "autoAuth":
    case "sampling":
    case "samplingAutoApprove":
    case "elicitation":
      checkBoolean(value, path, issues, code);
      break;
    case "agentPluginPaths":
      checkStringArray(value, path, issues, code);
      break;
    case "idleTimeout":
      checkNumber(value, path, issues, code, 0);
      break;
    case "requestTimeoutMs":
      checkNumber(value, path, issues, code, 0, false, MAX_REQUEST_TIMEOUT_MS);
      break;
    case "directToolResultDetails":
      checkEnum(value, ["lean", "bounded"], path, issues, code);
      break;
    case "toolResultRendering":
      checkEnum(value, ["compact", "boxed"], path, issues, code);
      break;
    case "collapsedResultLines":
      if (value !== 1 && value !== 2 && value !== 3) {
        addIssue(issues, code, path, `${path} must be 1, 2, or 3.`);
      }
      break;
    case "approveTools":
      if (typeof value !== "boolean") checkStringArray(value, path, issues, code);
      break;
    case "outputGuard":
      if (typeof value !== "boolean") {
        if (!isRecord(value)) {
          addIssue(issues, code, path, `${path} must be a boolean or an output-guard settings object.`);
          break;
        }
        const fields = /* @__PURE__ */ new Set(["maxBytes", "maxLines", "detailsMaxBytes"]);
        checkKnownFields(value, fields, path, issues, "unknown-settings-field");
        for (const [name, limit] of Object.entries(value)) {
          if (fields.has(name)) checkNumber(limit, `${path}.${name}`, issues, "invalid-nested-field", 1, true);
        }
      }
      break;
    case "trace":
      if (!isRecord(value)) {
        addIssue(issues, code, path, `${path} must be a trace settings object.`);
        break;
      }
      checkKnownFields(value, /* @__PURE__ */ new Set(["enabled", "file", "maxBytes", "maxEvents"]), path, issues, "unknown-settings-field");
      if (value.enabled !== void 0) checkBoolean(value.enabled, `${path}.enabled`, issues, "invalid-nested-field");
      if (value.file !== void 0) checkString(value.file, `${path}.file`, issues, "invalid-nested-field", "must be a non-empty string", false);
      if (value.maxBytes !== void 0) checkNumber(value.maxBytes, `${path}.maxBytes`, issues, "invalid-nested-field", 1, true);
      if (value.maxEvents !== void 0) checkNumber(value.maxEvents, `${path}.maxEvents`, issues, "invalid-nested-field", 1, true);
      break;
    case "authRequiredMessage":
    case "oauthDir":
      checkString(value, path, issues, code);
      break;
  }
}
function validateMcpConfig(raw) {
  const issues = [];
  if (!isRecord(raw)) {
    addIssue(issues, "invalid-root", "config", "MCP configuration root must be an object.");
    return fail(issues);
  }
  checkKnownFields(raw, ROOT_FIELDS, "config", issues, "invalid-root");
  if (raw.$schema !== void 0 && typeof raw.$schema !== "string") {
    addIssue(issues, "invalid-root", "config.$schema", "config.$schema must be a string.");
  }
  if (Object.hasOwn(raw, "mcpServers") && Object.hasOwn(raw, "mcp-servers")) {
    addIssue(issues, "conflicting-server-map", "config", "Use only one of mcpServers or mcp-servers.");
  }
  const serverMap = Object.hasOwn(raw, "mcpServers") ? raw.mcpServers : raw["mcp-servers"];
  if (serverMap !== void 0 && !isRecord(serverMap)) {
    addIssue(issues, "invalid-server-map", "mcpServers", "mcpServers must be an object keyed by server name.");
  }
  const servers = {};
  const serverIssues = [];
  if (isRecord(serverMap)) {
    for (const [name, entry] of Object.entries(serverMap)) {
      const validated = validateServerEntry(name, entry);
      if (validated.ok) servers[name] = validated.value;
      else serverIssues.push(...validated.error.issues);
    }
  }
  let settings;
  if (raw.settings !== void 0) {
    if (!isRecord(raw.settings)) {
      addIssue(issues, "invalid-settings", "settings", "settings must be an object.");
    } else {
      checkKnownFields(raw.settings, /* @__PURE__ */ new Set([...SETTINGS_FIELDS, ...IGNORED_LEGACY_SETTINGS_FIELDS]), "settings", issues, "unknown-settings-field");
      for (const [field, value] of Object.entries(raw.settings)) {
        if (SETTINGS_FIELDS.has(field)) validateSetting(field, value, issues);
      }
      settings = structuredClone(raw.settings);
      delete settings.hostConfigDiscovery;
    }
  }
  if (issues.length > 0) return fail([...issues, ...serverIssues]);
  return {
    ok: true,
    value: { mcpServers: servers, ...settings === void 0 ? {} : { settings } },
    ...serverIssues.length === 0 ? {} : { issues: serverIssues }
  };
}

// src/config/package-mcp-loader.ts
function loadPackageMcpConfigSources(cwd = process.cwd()) {
  const sources = [];
  const seen = /* @__PURE__ */ new Set();
  for (const configuredPackage of getConfiguredPackageRoots(cwd)) {
    const { root: packageRoot, scope } = configuredPackage;
    const manifest = readPackageManifest(packageRoot);
    if (!manifest || typeof manifest.name !== "string" || !manifest.name) continue;
    const paths = getManifestMcpPaths(manifest.pi?.mcp, manifest.name);
    if (!paths) continue;
    const packagePrefix = formatPackageName(manifest.name);
    for (const path of paths) {
      const configPath = resolvePackageConfigPath(packageRoot, path);
      if (!configPath) {
        console.warn(`Pi package ${manifest.name} skips MCP config ${path}: file must stay inside the package`);
        continue;
      }
      const config = readMcpConfig(configPath, manifest.name);
      if (!config) continue;
      const mcpServers = {};
      for (const [serverName, server] of Object.entries(config.mcpServers)) {
        const normalizedName = `${packagePrefix}__${formatServerName(serverName)}`;
        if (seen.has(normalizedName)) {
          console.warn(`Pi package ${manifest.name} skips duplicate normalized MCP server ${normalizedName}`);
          continue;
        }
        seen.add(normalizedName);
        mcpServers[normalizedName] = server;
      }
      if (Object.keys(mcpServers).length === 0) continue;
      const project = scope === "project";
      sources.push({
        source: {
          id: project ? "pi-package-project" : "pi-package-global",
          label: `Pi package ${manifest.name} MCP config`,
          readPath: configPath,
          writePath: project ? getProjectPiConfigPath(cwd) : getAgentPath("mcp.json"),
          kind: project ? "project" : "user",
          shared: false,
          scope: project ? "project" : "global"
        },
        config: { mcpServers }
      });
    }
  }
  return sources;
}
function getConfiguredPackageRoots(cwd) {
  const roots = [];
  for (const [settingsPath, scope] of [
    [join(cwd, getConfigDirName(), "settings.json"), "project"],
    [join(getAgentDir(), "settings.json"), "user"]
  ]) {
    const settings = readOptionalJson(settingsPath, `${scope} Pi settings`);
    if (settings === void 0) continue;
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      throw new Error(`${scope} Pi settings ${settingsPath} must be a JSON object`);
    }
    const packages = settings.packages;
    if (packages === void 0) continue;
    if (!Array.isArray(packages)) throw new Error(`${scope} Pi settings ${settingsPath} packages must be an array`);
    for (const entry of packages) {
      const source = typeof entry === "string" ? entry : entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.source === "string" ? entry.source : void 0;
      if (!source) throw new Error(`${scope} Pi settings ${settingsPath} package entries must be strings or objects with a string source`);
      const root = resolvePackageRoot(source, scope, cwd);
      if (root && !roots.some((entry2) => entry2.root === root)) roots.push({ root, scope });
    }
  }
  return roots;
}
function resolvePackageRoot(source, scope, cwd) {
  const baseDir = scope === "user" ? getAgentDir() : join(cwd, getConfigDirName());
  if (source.startsWith("npm:")) {
    const name = source.slice(4).trim().match(/^(@?[^@]+(?:\/[^@]+)?)/)?.[1];
    return name ? resolveContainedPath(join(baseDir, "npm", "node_modules"), name) : null;
  }
  const gitSource = source.startsWith("git:") ? source.slice(4).trim() : /^(?:(?:https?|ssh):\/\/|git@[^:]+:)/.test(source) ? source : null;
  if (gitSource) {
    const value = gitSource.replace(/^ssh:\/\/git@/, "").replace(/^git@([^:]+):/, "$1/").replace(/^[a-z]+:\/\//i, "");
    const path = value.replace(/@[^/]+$/, "").replace(/\.git$/, "");
    return path && !path.startsWith("/") ? resolveContainedPath(join(baseDir, "git"), path) : null;
  }
  return isAbsolute(source) ? resolve(source) : resolve(baseDir, source);
}
function readPackageManifest(packageRoot) {
  const manifest = readOptionalJson(join(packageRoot, "package.json"), `Pi package manifest ${packageRoot}`);
  return manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest : null;
}
function getManifestMcpPaths(value, packageName) {
  const paths = typeof value === "string" ? [value] : Array.isArray(value) && value.every((path) => typeof path === "string") ? value : null;
  if (value !== void 0 && !paths) console.warn(`Pi package ${packageName} ignores invalid pi.mcp manifest entry`);
  return paths;
}
function readMcpConfig(path, packageName) {
  const config = readRequiredJson(path, `Pi package ${packageName} MCP config`);
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Pi package ${packageName} MCP config ${path} must be a JSON object`);
  }
  const servers = config.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error(`Pi package ${packageName} MCP config ${path} must contain a JSON object mcpServers field`);
  }
  const mcpServers = {};
  for (const [name, server] of Object.entries(servers)) {
    const validated = validateServerEntry(name, server);
    if (!validated.ok) {
      throw new Error(
        `Pi package ${packageName} MCP config ${path} contains an invalid server (${validated.error.code}): ${validated.error.message}`
      );
    }
    mcpServers[name] = validated.value;
  }
  return { mcpServers };
}
function readRequiredJson(path, description) {
  try {
    return JSON.parse(stripJsonComments(readFileSync(path, "utf8"), { trailingCommas: true }));
  } catch (error) {
    throw new Error(`${description} ${path} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
function readOptionalJson(path, description) {
  if (!existsSync(path)) return void 0;
  return readRequiredJson(path, description);
}
function resolveContainedPath(root, path) {
  const resolved = resolve(root, path);
  const rel = relative(root, resolved);
  return rel === "" || !rel.startsWith("..") && !rel.startsWith(sep) && !isAbsolute(rel) ? resolved : null;
}
function resolvePackageConfigPath(packageRoot, path) {
  const lexicalPath = resolveContainedPath(packageRoot, path);
  if (!lexicalPath || !existsSync(lexicalPath) || !statSync(lexicalPath).isFile()) return null;
  try {
    const realPackageRoot = realpathSync(packageRoot);
    const realConfigPath = realpathSync(lexicalPath);
    return resolveContainedPath(realPackageRoot, realConfigPath);
  } catch {
    return null;
  }
}
function formatPackageName(name) {
  return name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "") || "package";
}
function formatServerName(name) {
  return name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "") || "server";
}

// src/config/agent-plugin-loader.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, statSync as statSync2 } from "node:fs";
import { isAbsolute as isAbsolute2, relative as relative2, resolve as resolve2, sep as sep2 } from "node:path";
var PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
var MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
var PLUGIN_NAME_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
var PLUGIN_MANIFEST_FIELDS = /* @__PURE__ */ new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions"
]);
var MCP_CONFIG_FIELDS = /* @__PURE__ */ new Set(["$schema", "mcpServers"]);
var STDIO_FIELDS = /* @__PURE__ */ new Set(["type", "command", "args", "env", "cwd"]);
var HTTP_FIELDS = /* @__PURE__ */ new Set(["type", "url", "headers"]);
function loadAgentPluginConfigSources(paths, cwd, provenance) {
  const sources = [];
  const seen = /* @__PURE__ */ new Set();
  for (const pluginPath of getPluginPaths(paths)) {
    const pluginRoot = resolvePluginPath(pluginPath, cwd);
    const config = loadAgentPluginMcpConfig(pluginPath, cwd);
    if (!config) continue;
    const mcpServers = {};
    for (const [serverName, server] of Object.entries(config.mcpServers)) {
      if (seen.has(serverName)) {
        console.warn(`Agent Plugin at ${pluginRoot} skips duplicate normalized MCP server ${serverName}`);
        continue;
      }
      seen.add(serverName);
      mcpServers[serverName] = server;
    }
    if (Object.keys(mcpServers).length === 0) continue;
    const project = provenance.scope === "project";
    sources.push({
      source: {
        id: project ? "agent-plugin-project" : "agent-plugin-global",
        label: "Agent Plugin MCP config",
        readPath: resolve2(pluginRoot, "mcp.json"),
        writePath: project ? getProjectPiConfigPath(cwd) : getAgentPath("mcp.json"),
        kind: project ? "project" : "user",
        shared: false,
        scope: provenance.scope
      },
      config: { mcpServers }
    });
  }
  return sources;
}
function getPluginPaths(paths) {
  return Array.isArray(paths) ? paths.filter((path) => typeof path === "string") : [];
}
function loadAgentPluginMcpConfig(path, cwd) {
  const pluginRoot = resolvePluginPath(path, cwd);
  const manifest = readPluginManifest(pluginRoot, true);
  if (!manifest) return null;
  const mcpPath = resolve2(pluginRoot, "mcp.json");
  if (!existsSync2(mcpPath)) return { mcpServers: {} };
  if (!statSync2(mcpPath).isFile()) {
    console.warn(`Agent Plugin ${manifest.name} has invalid MCP config: mcp.json is not a regular file`);
    return { mcpServers: {} };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync2(mcpPath, "utf8"));
  } catch (error) {
    console.warn(`Agent Plugin ${manifest.name} has invalid MCP config: failed to parse mcp.json`, error);
    return { mcpServers: {} };
  }
  return translateAgentPluginMcpConfig(raw, manifest, pluginRoot);
}
function readPluginManifest(pluginRoot, report) {
  const manifestPath = resolve2(pluginRoot, "plugin.json");
  if (!existsSync2(manifestPath)) {
    if (report) console.warn(`Agent Plugin at ${pluginRoot} is invalid: missing plugin.json`);
    return null;
  }
  if (!statSync2(manifestPath).isFile()) {
    if (report) console.warn(`Agent Plugin at ${pluginRoot} is invalid: plugin.json is not a regular file`);
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync2(manifestPath, "utf8"));
  } catch (error) {
    if (report) console.warn(`Agent Plugin at ${pluginRoot} is invalid: failed to parse plugin.json`, error);
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (report) console.warn(`Agent Plugin at ${pluginRoot} is invalid: plugin.json must be an object`);
    return null;
  }
  const manifest = raw;
  for (const key of Object.keys(manifest)) {
    if (!PLUGIN_MANIFEST_FIELDS.has(key) && report) {
      console.warn(`Agent Plugin at ${pluginRoot} ignores unknown plugin.json field: ${key}`);
    }
  }
  if (manifest.$schema !== PLUGIN_SCHEMA) {
    if (report) console.warn(`Agent Plugin at ${pluginRoot} is invalid: unsupported plugin.json $schema`);
    return null;
  }
  if (typeof manifest.name !== "string" || manifest.name.length < 1 || manifest.name.length > 64 || !PLUGIN_NAME_PATTERN.test(manifest.name)) {
    if (report) console.warn(`Agent Plugin at ${pluginRoot} is invalid: plugin.json name is invalid`);
    return null;
  }
  if (manifest.extensions !== void 0 && (!manifest.extensions || typeof manifest.extensions !== "object" || Array.isArray(manifest.extensions))) {
    if (report) console.warn(`Agent Plugin ${manifest.name} ignores non-object plugin.json extensions`);
  }
  return { name: manifest.name };
}
function translateAgentPluginMcpConfig(raw, manifest, pluginRoot) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.warn(`Agent Plugin ${manifest.name} has invalid MCP config: mcp.json must be an object`);
    return { mcpServers: {} };
  }
  const mcpConfig = raw;
  for (const key of Object.keys(mcpConfig)) {
    if (!MCP_CONFIG_FIELDS.has(key)) {
      console.warn(`Agent Plugin ${manifest.name} has invalid MCP config: unknown top-level field ${key}`);
      return { mcpServers: {} };
    }
  }
  if (mcpConfig.$schema !== MCP_SCHEMA) {
    console.warn(`Agent Plugin ${manifest.name} has invalid MCP config: unsupported mcp.json $schema`);
    return { mcpServers: {} };
  }
  if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== "object" || Array.isArray(mcpConfig.mcpServers)) {
    console.warn(`Agent Plugin ${manifest.name} has invalid MCP config: mcpServers must be an object`);
    return { mcpServers: {} };
  }
  const mcpServers = {};
  for (const [serverName, entry] of Object.entries(mcpConfig.mcpServers)) {
    const translated = translateAgentPluginServer(manifest, pluginRoot, serverName, entry);
    if (!translated) continue;
    const normalizedName = formatAgentPluginServerName(manifest.name, serverName);
    const validated = validateServerEntry(normalizedName, translated);
    if (!validated.ok) {
      console.warn(
        `Agent Plugin ${manifest.name} skips invalid MCP server ${serverName} (${validated.error.code}): ${validated.error.message}`
      );
      continue;
    }
    if (mcpServers[normalizedName]) {
      console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: normalized server name ${normalizedName} already exists`);
      continue;
    }
    mcpServers[normalizedName] = validated.value;
  }
  return { mcpServers };
}
function translateAgentPluginServer(manifest, pluginRoot, serverName, entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: entry must be an object`);
    return null;
  }
  const raw = entry;
  if (raw.type === "stdio") return translateStdioServer(manifest, pluginRoot, serverName, raw);
  if (raw.type === "streamable-http" || raw.type === "sse") return translateHttpServer(manifest, serverName, raw, raw.type);
  console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: unsupported type`);
  return null;
}
function translateStdioServer(manifest, pluginRoot, serverName, raw) {
  for (const key of Object.keys(raw)) {
    if (!STDIO_FIELDS.has(key)) return skipServer(manifest, serverName, `unknown field ${key}`);
  }
  if (typeof raw.command !== "string" || raw.command.length === 0) return skipServer(manifest, serverName, "command must be a non-empty string");
  if (!isBareCommand(raw.command) && !raw.command.startsWith("./")) return skipServer(manifest, serverName, "command must be bare or plugin-relative");
  const args = translateStringArray(raw.args, manifest, serverName, "args");
  if (args === null) return null;
  const env = translateEnv(raw.env, manifest, serverName);
  if (env === null) return null;
  const command = raw.command.startsWith("./") ? resolveContainedPath2(pluginRoot, raw.command, pluginRoot) : raw.command;
  if (command === null) return skipServer(manifest, serverName, "command must stay inside the plugin directory");
  const pluginDataDir = getAgentPath("agent-plugin-data", manifest.name);
  const cwd = resolvePluginCwd(raw.cwd, pluginRoot, pluginDataDir);
  if (cwd === null) return skipServer(manifest, serverName, "cwd must be plugin-relative, PLUGIN_ROOT-rooted, or PLUGIN_DATA-rooted");
  return {
    command,
    args: args.map((value) => expandPluginPlaceholders(value, pluginRoot, pluginDataDir)),
    env: {
      ...Object.fromEntries(Object.entries(env).map(([key, value]) => [key, expandPluginPlaceholders(value, pluginRoot, pluginDataDir)])),
      PLUGIN_ROOT: pluginRoot,
      PLUGIN_DATA: pluginDataDir
    },
    cwd,
    pluginDataDir,
    literalEnv: true
  };
}
function translateHttpServer(manifest, serverName, raw, type) {
  for (const key of Object.keys(raw)) {
    if (!HTTP_FIELDS.has(key)) return skipServer(manifest, serverName, `unknown field ${key}`);
  }
  if (typeof raw.url !== "string" || raw.url.length === 0) return skipServer(manifest, serverName, "url must be a non-empty string");
  if (!isValidAgentPluginUrl(raw.url)) return skipServer(manifest, serverName, "url must be an allowed absolute HTTP(S) URL");
  const headers = translateHeaders(raw.headers, manifest, serverName);
  if (headers === null) return null;
  return {
    url: raw.url,
    httpTransport: type,
    ...headers ? { headers } : {}
  };
}
function formatAgentPluginServerName(pluginName, serverName) {
  const pluginPart = pluginName.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "") || "plugin";
  const serverPart = serverName.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "") || "server";
  return `${pluginPart}__${serverPart}`;
}
function skipServer(manifest, serverName, reason) {
  console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: ${reason}`);
  return null;
}
function translateStringArray(value, manifest, serverName, field) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: ${field} must be an array of strings`);
    return null;
  }
  return value;
}
function translateEnv(value, manifest, serverName) {
  if (value === void 0) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: env must be an object of strings`);
    return null;
  }
  const env = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "PLUGIN_ROOT" || key === "PLUGIN_DATA") {
      console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: env must not define ${key}`);
      return null;
    }
    if (typeof entry !== "string") {
      console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: env values must be strings`);
      return null;
    }
    env[key] = entry;
  }
  return env;
}
function translateHeaders(value, manifest, serverName) {
  if (value === void 0) return void 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: headers must be an object of strings`);
    return null;
  }
  const headers = {};
  const seen = /* @__PURE__ */ new Set();
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: header values must be strings`);
      return null;
    }
    const normalized = key.toLowerCase();
    if (seen.has(normalized)) {
      console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: duplicate header ${key}`);
      return null;
    }
    seen.add(normalized);
    headers[key] = entry;
  }
  try {
    new Headers(headers);
  } catch {
    console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: headers are not valid HTTP fields`);
    return null;
  }
  return Object.keys(headers).length > 0 ? headers : void 0;
}
function resolvePluginPath(path, cwd) {
  if (path === "~") return resolve2(process.env.HOME ?? "", ".");
  if (path.startsWith("~/")) return resolve2(process.env.HOME ?? "", path.slice(2));
  return isAbsolute2(path) ? resolve2(path) : resolve2(cwd, path);
}
function isBareCommand(command) {
  return !command.includes("/") && !command.includes("\\") && !command.includes("${PLUGIN_ROOT}") && !command.includes("${PLUGIN_DATA}");
}
function resolvePluginCwd(value, pluginRoot, pluginDataDir) {
  if (value === void 0) return pluginRoot;
  if (typeof value !== "string") return null;
  if (value.startsWith("./")) return resolveContainedPath2(pluginRoot, value, pluginRoot);
  if (value === "${PLUGIN_ROOT}" || value.startsWith("${PLUGIN_ROOT}/")) {
    return resolveContainedPath2(pluginRoot, value.replace("${PLUGIN_ROOT}", "."), pluginRoot);
  }
  if (value === "${PLUGIN_DATA}" || value.startsWith("${PLUGIN_DATA}/")) {
    return resolveContainedPath2(pluginDataDir, value.replace("${PLUGIN_DATA}", "."), pluginDataDir);
  }
  return null;
}
function resolveContainedPath2(root, value, containmentRoot) {
  const resolved = resolve2(root, value);
  const rel = relative2(containmentRoot, resolved);
  if (rel === "" || !rel.startsWith("..") && !rel.startsWith(sep2) && !isAbsolute2(rel)) return resolved;
  return null;
}
function expandPluginPlaceholders(value, pluginRoot, pluginDataDir) {
  return value.replaceAll("${PLUGIN_ROOT}", pluginRoot).replaceAll("${PLUGIN_DATA}", pluginDataDir);
}
function isValidAgentPluginUrl(value) {
  if (value.includes("${") || value.includes("$env:") || value.includes("{env:")) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "https:") return true;
  return isLoopbackHost(url.hostname);
}
function isLoopbackHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  return false;
}

// src/config/merge.ts
function mergeConfigs(base, next) {
  const settings = next.settings ? { ...base.settings, ...next.settings } : base.settings;
  return {
    mcpServers: mergeServerMaps(base.mcpServers, next.mcpServers),
    ...settings !== void 0 ? { settings } : {}
  };
}
var URL_BOUND_AUTH_FIELDS = ["headers", "bearerToken", "bearerTokenEnv", "bearerTokenStore", "requestHeadersCommand"];
function mergeServerMaps(base, next) {
  const merged = { ...base };
  for (const [name, definition] of Object.entries(next)) {
    const existing = merged[name];
    let baseEntry = existing ?? {};
    if (existing && typeof definition.command === "string") {
      baseEntry = { ...existing };
      for (const field of [
        "url",
        "headers",
        "requestHeadersCommand",
        "auth",
        "bearerToken",
        "bearerTokenEnv",
        "oauth",
        "httpTransport",
        "socket"
      ]) {
        delete baseEntry[field];
      }
    } else if (existing && typeof definition.url === "string") {
      baseEntry = { ...existing };
      for (const field of [
        "command",
        "args",
        "env",
        "cwd",
        "pluginDataDir",
        "literalEnv",
        "socket"
      ]) {
        delete baseEntry[field];
      }
    } else if (existing && typeof definition.socket === "string") {
      baseEntry = { ...existing };
      for (const field of [
        "command",
        "args",
        "env",
        "cwd",
        "pluginDataDir",
        "literalEnv",
        "url",
        "headers",
        "requestHeadersCommand",
        "auth",
        "bearerToken",
        "bearerTokenEnv",
        "oauth",
        "httpTransport"
      ]) {
        delete baseEntry[field];
      }
    }
    if (existing && typeof definition.url === "string" && definition.url !== existing.url) {
      if (baseEntry === existing) baseEntry = { ...existing };
      for (const field of URL_BOUND_AUTH_FIELDS) {
        delete baseEntry[field];
      }
      if (baseEntry.oauth !== false) {
        delete baseEntry.oauth;
      }
    }
    merged[name] = { ...baseEntry, ...definition };
  }
  return merged;
}

// src/config/read.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";
import stripJsonComments2 from "strip-json-comments";
function parseJsonConfig(raw) {
  return JSON.parse(stripJsonComments2(raw, { trailingCommas: true }));
}
function readValidatedConfig(path, _label) {
  try {
    if (!existsSync3(path)) return { ok: true, value: null };
    let parsed;
    try {
      parsed = parseJsonConfig(readFileSync3(path, "utf-8"));
    } catch {
      return { ok: false, error: { code: "invalid-json", message: "Configuration file is not valid JSON.", issues: [] } };
    }
    const validated = validateMcpConfig(parsed);
    return validated.ok ? { ok: true, value: validated.value, ...validated.issues ? { issues: validated.issues } : {} } : validated;
  } catch {
    return { ok: false, error: { code: "read-failed", message: "Configuration file could not be read.", issues: [] } };
  }
}

// src/config/load.ts
function loadConfigSources(overridePath, cwd = process.cwd()) {
  return getConfigSources(overridePath, cwd).map((source) => {
    const result = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
    if (result.ok) {
      if (result.issues?.length) {
        const first = result.issues[0];
        console.warn(`MCP config source ${source.readPath} contains invalid entries (${first.code}): ${first.message}`);
      }
      return {
        source,
        config: result.value,
        ...result.issues?.length ? { validationIssues: result.issues } : {}
      };
    }
    console.warn(`Failed to load MCP config from ${source.readPath} (${result.error.code}): ${result.error.message}`);
    return { source, config: null, error: result.error };
  });
}
function getMergedSettingsFromSources(sources) {
  let settings;
  for (const { config } of sources) {
    if (config?.settings) settings = { ...settings, ...config.settings };
  }
  return settings;
}
function cloneMcpConfig(config) {
  return structuredClone(config);
}

// src/native/config-mapping.ts
var mapped = (owner, reason) => ({ owner, status: "mapped", reason });
var deferred = (owner, reason) => ({ owner, status: "deferred", reason });
var adapterOwned = (owner, reason) => ({ owner, status: "adapter-owned", reason });
var SERVER_ENTRY_FIELD_MAPPING = {
  enabled: mapped("native-config", "Native enablement; adapter disabled is accepted as its inverse."),
  exposure: mapped("native-config", "Native server exposure policy."),
  toolExposure: mapped("native-config", "Native per-tool exposure overrides."),
  command: mapped("native-config", "Native stdio command."),
  args: mapped("native-config", "Native stdio arguments."),
  socket: mapped("native-transport", "The native owner creates an explicit Unix-domain socket transport."),
  env: mapped("native-config", "Native stdio environment, unless literalEnv changes interpolation semantics."),
  cwd: mapped("native-config", "Native stdio working directory."),
  url: mapped("native-config", "Native streamable-HTTP endpoint; blocked when a deferred transport/auth policy applies."),
  headers: mapped("native-config", "Native HTTP headers; values remain sensitive and are never surfaced in snapshots."),
  requestHeadersCommand: mapped("native-transport", "The native HTTP transport invokes the trusted signer for every request."),
  auth: mapped("native-credentials", "Bearer, OAuth, provider, and disabled modes are selected by the native connection owner."),
  bearerToken: mapped("native-credentials", "The native owner resolves the configured bearer secret without exposing it in snapshots."),
  bearerTokenEnv: mapped("native-credentials", "The native owner resolves the named bearer environment variable."),
  bearerTokenStore: mapped("native-credentials", "The native owner reads the adapter keyring through its credential backend."),
  oauth: mapped("native-credentials", "Supported OAuth settings map to the native owner and shared secure credential store."),
  lifecycle: mapped("native-lifecycle", "Opt-in lifecycle is owned by the native MCP runtime."),
  idleTimeout: mapped("native-lifecycle", "Idle timeout uses minutes in both adapter and native config."),
  requestTimeoutMs: mapped("native-transport", "Millisecond timeouts pass through as milliseconds without unit conversion."),
  exposeResources: mapped("native-execution-policy", "Resource visibility and reads are filtered by the native owner."),
  directTools: mapped("native-execution-policy", "Direct selectors and MCP_DIRECT_TOOLS are evaluated in the native execution pipeline."),
  toolPrefix: mapped("native-execution-policy", "Native tool definitions use the adapter's established prefix for migrated servers."),
  includeTools: mapped("native-execution-policy", "Include rules filter native catalogs and are rechecked at execution."),
  excludeTools: mapped("native-execution-policy", "Exclude rules filter native catalogs and are rechecked at execution."),
  searchKeywords: adapterOwned("adapter-catalog", "Search ranking metadata stays out of tool schemas and is retained for adapter catalog search."),
  approveTools: mapped("native-execution-policy", "Once/session/deny/abstain approval is enforced before native MCP requests."),
  debug: deferred("adapter-observability", "Adapter stderr behavior is not mapped to a native logging policy yet."),
  trace: deferred("adapter-observability", "Metadata-only adapter tracing remains adapter-owned until explicitly migrated."),
  httpTransport: mapped("native-transport", "Explicit SSE/streamable HTTP selection is owned by the native connection."),
  pluginDataDir: mapped("native-transport", "The native stdio owner prepares the Agent Plugin data directory."),
  literalEnv: mapped("native-transport", "Literal plugin environment values bypass native interpolation."),
  protocolVersion: mapped("native-transport", "Legacy is preserved; unsupported modern remote versions are blocked before connection."),
  disabled: mapped("native-config", "Maps explicitly to native enabled = !disabled.")
};
var MCP_SETTINGS_FIELD_MAPPING = {
  toolPrefix: mapped("native-execution-policy", "Per-server native tool definitions retain the adapter prefix behavior."),
  showStatusIcon: adapterOwned("adapter-presentation", "Adapter status presentation only."),
  mcpFooterStatus: adapterOwned("adapter-presentation", "Adapter footer presentation only."),
  notifyOnStartupConnect: adapterOwned("adapter-presentation", "Adapter startup notification policy only."),
  agentPluginPaths: mapped("native-config", "Plugin-derived servers carry the trust scope and source provenance of the winning settings entry."),
  idleTimeout: mapped("native-lifecycle", "Native owner global idle timeout, in minutes."),
  requestTimeoutMs: mapped("native-transport", "Global request timeout passes through in milliseconds."),
  directTools: mapped("native-execution-policy", "Global direct-tool selection is resolved per server without overriding native hidden exposure."),
  strictDirectToolArguments: mapped("native-execution-policy", "Strict direct-tool parameters are validated in native tool execution."),
  directToolResultDetails: mapped("native-execution-policy", "Native result details retain the configured bounded/lean policy."),
  warnOnLargeDirectTools: adapterOwned("adapter-presentation", "Adapter advisory notification only."),
  scriptMode: deferred("adapter-runtime-surface", "Must not create a second MCP script or proxy execution surface."),
  toolResultRendering: adapterOwned("adapter-presentation", "Tool result rendering only."),
  collapsedResultLines: adapterOwned("adapter-presentation", "Tool result presentation only."),
  approveTools: mapped("native-execution-policy", "Adapter approval and Pi's independent permission/trust checks both apply."),
  disableProxyTool: deferred("adapter-runtime-surface", "Must not register a duplicate MCP proxy tool."),
  freezeDirectTools: mapped("native-execution-policy", "Direct definitions keep their initial registration while calls still validate live availability."),
  autoAuth: deferred("native-credentials", "Authentication automation must remain within the native credential owner."),
  sampling: mapped("native-execution-policy", "Sampling is advertised and handled by the native connection with explicit consent."),
  samplingAutoApprove: mapped("native-execution-policy", "Only an explicit adapter setting bypasses sampling confirmation."),
  elicitation: mapped("native-execution-policy", "Native connection handlers retain user approval and cancellation."),
  outputGuard: mapped("native-execution-policy", "Native tool and resource results use the configured output bounds."),
  trace: deferred("adapter-observability", "Adapter metadata-only tracing remains adapter-owned until explicitly migrated."),
  authRequiredMessage: adapterOwned("adapter-presentation", "Authentication instruction text is adapter presentation."),
  oauthDir: deferred("adapter-credentials", "Legacy OAuth import path does not authorize plaintext credential migration.")
};
var DEFERRED_NATIVE_CONFIG_SOURCES = [];
var ENTRY_SWITCH_BLOCKERS = Object.freeze([]);
function nativeProvenance(source) {
  return {
    sourceId: source.id,
    scope: source.scope,
    kind: source.kind,
    sourcePath: source.readPath,
    writePath: source.writePath,
    shared: source.shared
  };
}
function deferredServerFields(entry) {
  return Object.keys(SERVER_ENTRY_FIELD_MAPPING).filter((field) => {
    if (SERVER_ENTRY_FIELD_MAPPING[field].status !== "deferred") return false;
    const value = entry[field];
    if (field === "debug" || field === "trace") return value === true;
    return value !== void 0;
  });
}
function blockingIssues(name, entry) {
  const issues = [];
  if (entry.protocolVersion === "auto" || entry.protocolVersion === "2026-07-28") {
    issues.push({
      code: "unsupported-protocol-version",
      field: "protocolVersion",
      message: `MCP server "${name}" requests remote protocol ${entry.protocolVersion}, which the native Pi 1.2.0 client does not support.`
    });
  }
  const redirectUri = typeof entry.oauth === "object" && entry.oauth !== null ? entry.oauth.redirectUri : void 0;
  if (redirectUri !== void 0) {
    const redirect = URL.canParse(redirectUri) ? new URL(redirectUri) : void 0;
    const loopback = redirect && redirect.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname);
    if (!loopback) {
      issues.push({
        code: "unsupported-oauth-redirect",
        field: "oauth.redirectUri",
        message: `MCP server "${name}" configures a redirect URI that cannot be served by the native loopback OAuth callback.`
      });
    }
  }
  return issues;
}
function mapOAuthConfig(entry) {
  const oauth = entry.oauth;
  if (oauth === void 0 || oauth === false) return oauth;
  const { redirectUri, ...settings } = oauth;
  return {
    ...settings,
    ...redirectUri === void 0 ? {} : { callbackUrl: redirectUri }
  };
}
function mapNativeServerConfig(entry, globalTimeoutMs) {
  const configuredTimeout = entry.requestTimeoutMs !== void 0 && entry.requestTimeoutMs > 0 ? entry.requestTimeoutMs : globalTimeoutMs !== void 0 && globalTimeoutMs > 0 ? globalTimeoutMs : void 0;
  const oauth = mapOAuthConfig(entry);
  const common = {
    ...configuredTimeout === void 0 ? {} : { requestTimeoutMs: configuredTimeout },
    ...entry.protocolVersion === void 0 ? {} : { protocolVersion: entry.protocolVersion },
    ...entry.lifecycle === void 0 ? {} : { lifecycle: entry.lifecycle },
    ...entry.idleTimeout === void 0 ? {} : { idleTimeout: entry.idleTimeout },
    ...entry.enabled !== void 0 ? { enabled: entry.enabled } : entry.disabled === void 0 ? {} : { enabled: !entry.disabled },
    ...entry.exposure === void 0 ? {} : { exposure: entry.exposure },
    ...entry.toolExposure === void 0 ? {} : { toolExposure: { ...entry.toolExposure } },
    ...entry.directTools === void 0 ? {} : { directTools: Array.isArray(entry.directTools) ? [...entry.directTools] : entry.directTools }
  };
  if (entry.command !== void 0) {
    return {
      ...common,
      type: "stdio",
      command: entry.command,
      ...entry.args === void 0 ? {} : { args: [...entry.args] },
      ...entry.env === void 0 ? {} : { env: { ...entry.env } },
      ...entry.cwd === void 0 ? {} : { cwd: entry.cwd },
      ...entry.pluginDataDir === void 0 ? {} : { pluginDataDir: entry.pluginDataDir },
      ...entry.literalEnv === void 0 ? {} : { literalEnv: entry.literalEnv }
    };
  }
  if (entry.url !== void 0) {
    return {
      ...common,
      type: "http",
      url: entry.url,
      ...entry.headers === void 0 ? {} : { headers: { ...entry.headers } },
      ...entry.requestHeadersCommand === void 0 ? {} : { requestHeadersCommand: structuredClone(entry.requestHeadersCommand) },
      ...entry.auth === void 0 ? {} : { auth: entry.auth },
      ...entry.bearerToken === void 0 ? {} : { bearerToken: entry.bearerToken },
      ...entry.bearerTokenEnv === void 0 ? {} : { bearerTokenEnv: entry.bearerTokenEnv },
      ...entry.bearerTokenStore === void 0 ? {} : { bearerTokenStore: entry.bearerTokenStore },
      ...oauth === void 0 ? {} : { oauth: structuredClone(oauth) },
      ...entry.httpTransport === void 0 ? {} : { httpTransport: entry.httpTransport }
    };
  }
  if (entry.socket !== void 0) return { ...common, type: "socket", socket: entry.socket };
  return void 0;
}
function mapDirectToolSelection(serverName, entry, settings) {
  const raw = process.env.MCP_DIRECT_TOOLS;
  if (raw === void 0) return entry.directTools ?? settings?.directTools ?? false;
  if (raw === "__none__") return false;
  let selectServer = false;
  const selectedTools = /* @__PURE__ */ new Set();
  for (let selector of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
    selector = selector.replace(/\/+$/, "");
    if (!selector.includes("/")) {
      if (selector === serverName) selectServer = true;
      continue;
    }
    const [server, tool] = selector.split("/", 2);
    if (server !== serverName) continue;
    if (tool) selectedTools.add(tool);
    else selectServer = true;
  }
  return selectServer ? true : [...selectedTools];
}
function mapExecutionPolicy(serverName, entry, settings) {
  const envGuard = process.env.MCP_OUTPUT_GUARD;
  const configuredGuard = settings?.outputGuard;
  const outputGuard = envGuard === "0" ? false : envGuard === "1" ? true : configuredGuard ?? true;
  const approval = entry.approveTools !== void 0 ? entry.approveTools : settings?.approveTools;
  return {
    directTools: mapDirectToolSelection(serverName, entry, settings),
    includeTools: [...entry.includeTools ?? []],
    excludeTools: [...entry.excludeTools ?? []],
    toolPrefix: entry.toolPrefix ?? settings?.toolPrefix ?? "server",
    searchKeywords: structuredClone(entry.searchKeywords ?? {}),
    exposeResources: entry.exposeResources !== false,
    ...approval === void 0 ? {} : { approveTools: Array.isArray(approval) ? [...approval] : approval },
    strictDirectToolArguments: settings?.strictDirectToolArguments === true,
    directToolResultDetails: settings?.directToolResultDetails ?? "lean",
    freezeDirectTools: settings?.freezeDirectTools === true,
    outputGuard: typeof outputGuard === "object" ? structuredClone(outputGuard) : outputGuard,
    sampling: settings?.sampling !== false,
    samplingAutoApprove: settings?.samplingAutoApprove === true,
    elicitation: settings?.elicitation !== false
  };
}
function mapSettings(settings, provenance) {
  const present = settings ? Object.keys(settings) : [];
  return {
    ...settings?.idleTimeout === void 0 ? {} : { idleTimeout: settings.idleTimeout },
    ...settings?.requestTimeoutMs === void 0 ? {} : { requestTimeoutMs: settings.requestTimeoutMs },
    ...settings?.directTools === void 0 ? {} : { directTools: settings.directTools },
    ...settings?.toolPrefix === void 0 ? {} : { toolPrefix: settings.toolPrefix },
    deferredFields: present.filter((field) => MCP_SETTINGS_FIELD_MAPPING[field].status === "deferred"),
    adapterOwnedFields: present.filter((field) => MCP_SETTINGS_FIELD_MAPPING[field].status === "adapter-owned"),
    provenance
  };
}
function mapLoadedConfigSourcesToNative(sources) {
  let config = { mcpServers: {} };
  const serverSources = /* @__PURE__ */ new Map();
  const settingsSources = {};
  for (const loaded of sources) {
    if (loaded.error || loaded.validationIssues?.length) {
      const code = loaded.error?.code ?? loaded.validationIssues?.[0]?.code ?? "invalid-root";
      return {
        ok: false,
        error: {
          code: "invalid-source",
          message: `MCP config source ${loaded.source.id} failed validation (${code}).`,
          sourceId: loaded.source.id
        }
      };
    }
    if (!loaded.config) continue;
    config = mergeConfigs(config, loaded.config);
    for (const name of Object.keys(loaded.config.mcpServers)) serverSources.set(name, loaded.source);
    for (const field of Object.keys(loaded.config.settings ?? {})) {
      settingsSources[field] = nativeProvenance(loaded.source);
    }
  }
  const servers = [];
  for (const [name, entry] of Object.entries(config.mcpServers)) {
    const source = serverSources.get(name);
    if (!source) {
      return {
        ok: false,
        error: { code: "missing-provenance", message: "A configured MCP server has no source provenance." }
      };
    }
    const validated = validateServerEntry(name, entry, { requireTransport: true });
    if (!validated.ok) {
      return {
        ok: false,
        error: {
          code: "invalid-server-entry",
          message: `A configured MCP server failed validation (${validated.error.code}).`,
          sourceId: source.id
        }
      };
    }
    const deferredFields = deferredServerFields(validated.value);
    const issues = blockingIssues(name, validated.value);
    const connectable = deferredFields.length === 0 && issues.length === 0;
    servers.push({
      name,
      connectable,
      config: connectable ? mapNativeServerConfig(validated.value, config.settings?.requestTimeoutMs) ?? {} : {},
      executionPolicy: mapExecutionPolicy(name, validated.value, config.settings),
      provenance: nativeProvenance(source),
      deferredFields,
      blockingIssues: issues
    });
  }
  return {
    ok: true,
    value: {
      nativeEntrySwitchAllowed: true,
      entrySwitchBlockers: ENTRY_SWITCH_BLOCKERS,
      deferredSources: DEFERRED_NATIVE_CONFIG_SOURCES,
      servers,
      settings: mapSettings(config.settings, settingsSources)
    }
  };
}

// src/auth/mcp-auth.ts
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { createRequire } from "module";
import { readFileSync as readFileSync4, existsSync as existsSync4, rmSync } from "fs";
import { dirname, join as join2 } from "path";
import { fileURLToPath } from "url";
var require2 = createRequire(import.meta.url);
var AUTH_SECRET_SERVICE = "pi-mcp-adapter.oauth";
var TEST_AUTH_STORE_ENV = "PI_MCP_ADAPTER_TEST_AUTH_STORE";
var AUTH_SECRET_CHUNK_SIZE = 1e3;
var AUTH_SECRET_VALUE_LIMIT = 1280;
var KEYRING_RECOVERY_DISABLED_ENV = "PI_MCP_ADAPTER_DISABLE_KEYRING_RECOVERY";
var KEYRING_RECOVERY_KEYCTL_ENV = "PI_MCP_ADAPTER_KEYRING_RECOVERY_KEYCTL";
var KEYRING_RECOVERY_NODE_ENV = "PI_MCP_ADAPTER_KEYRING_RECOVERY_NODE";
var KEYRING_RECOVERY_HELPER_ENV = "PI_MCP_ADAPTER_KEYRING_RECOVERY_HELPER";
var TEST_LINUX_KEYRING_RECOVERY_ENV = "PI_MCP_ADAPTER_TEST_LINUX_KEYRING_RECOVERY";
var AUTH_CACHE_DISABLED_ENV = "PI_MCP_ADAPTER_DISABLE_AUTH_CACHE";
var KEYRING_RECOVERY_TIMEOUT_MS = 1e4;
var AUTH_CHUNK_MANIFEST_KEY = "__piMcpAdapterOAuthChunked";
var OAuthCredentialStoreError = class extends Error {
  constructor(message, operation, cause) {
    super(message, { cause });
    this.operation = operation;
    this.name = "OAuthCredentialStoreError";
  }
  operation;
  code = "OAUTH_CREDENTIAL_STORE_UNAVAILABLE";
};
function causeChainContains(error, pattern) {
  const seen = /* @__PURE__ */ new Set();
  let current = error;
  while (typeof current === "object" && current !== null || typeof current === "function") {
    if (seen.has(current)) break;
    seen.add(current);
    const candidate = current;
    if ([candidate.name, candidate.message, candidate.code].some((value) => typeof value === "string" && pattern.test(value))) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
var KeyringEntryClass;
var memoryAuthEntries = /* @__PURE__ */ new Map();
var testAuthSecretStoreReadCount = 0;
var authEntryCache = /* @__PURE__ */ new Map();
function isAuthEntryCacheEnabled() {
  return process.env[AUTH_CACHE_DISABLED_ENV] !== "1";
}
function cloneAuthEntry(entry) {
  return entry === void 0 ? void 0 : structuredClone(entry);
}
var memoryAuthSecretStore = {
  read(account) {
    testAuthSecretStoreReadCount++;
    return memoryAuthEntries.get(account);
  },
  write(account, payload) {
    memoryAuthEntries.set(account, payload);
  },
  remove(account) {
    memoryAuthEntries.delete(account);
  }
};
var keyringAuthSecretStore = {
  read(account) {
    return getKeyringEntry(account).getPassword() ?? void 0;
  },
  write(account, payload) {
    getKeyringEntry(account).setPassword(payload);
  },
  remove(account) {
    getKeyringEntry(account).deleteCredential();
  }
};
var sizeLimitedAuthSecretStore = {
  read(account) {
    testAuthSecretStoreReadCount++;
    return memoryAuthEntries.get(account);
  },
  write(account, payload) {
    if (payload.length > AUTH_SECRET_VALUE_LIMIT) {
      throw new Error(`Value of 'password encoded as UTF-16' is longer than the platform limit of ${AUTH_SECRET_VALUE_LIMIT * 2} chars`);
    }
    memoryAuthEntries.set(account, payload);
  },
  remove(account) {
    memoryAuthEntries.delete(account);
  }
};
var unavailableAuthSecretStore = {
  read() {
    testAuthSecretStoreReadCount++;
    throw new Error("simulated secure credential store unavailable");
  },
  write() {
    throw new Error("simulated secure credential store unavailable");
  },
  remove() {
    throw new Error("simulated secure credential store unavailable");
  }
};
function createKeyRevokedTestError() {
  return new Error("Couldn't access platform storage: KeyRevoked", { cause: new Error("KeyRevoked") });
}
var keyRevokedAuthSecretStore = {
  read() {
    testAuthSecretStoreReadCount++;
    throw createKeyRevokedTestError();
  },
  write() {
    throw createKeyRevokedTestError();
  },
  remove() {
    throw createKeyRevokedTestError();
  }
};
function getAuthSecretStore() {
  if (process.env[TEST_AUTH_STORE_ENV] === "memory") return memoryAuthSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV] === "sizelimited") return sizeLimitedAuthSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV] === "unavailable") return unavailableAuthSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV] === "keyrevoked") return keyRevokedAuthSecretStore;
  return keyringAuthSecretStore;
}
function getKeyringEntry(account) {
  try {
    KeyringEntryClass ??= loadKeyringEntryClass();
    return new KeyringEntryClass(AUTH_SECRET_SERVICE, account);
  } catch (error) {
    throw new Error("OAuth secure credential storage is unavailable. Configure the OS credential store and retry authentication.", { cause: error });
  }
}
function loadKeyringEntryClass(keyringRequire = require2, platform = process.platform, arch = process.arch) {
  try {
    return keyringRequire("@napi-rs/keyring").Entry;
  } catch (loaderError) {
    try {
      return loadKeyringNativeBindingFallback(keyringRequire, platform, arch).Entry;
    } catch (fallbackError) {
      throw new Error(`Failed to load @napi-rs/keyring; absolute-path native binding fallback also failed: ${formatErrorMessage(fallbackError)}`, {
        cause: loaderError
      });
    }
  }
}
function loadKeyringNativeBindingFallback(keyringRequire, platform, arch) {
  const targets = getKeyringNativeBindingTargets(platform, arch);
  if (targets.length === 0) {
    throw new Error(`Unsupported @napi-rs/keyring native binding target: ${platform}-${arch}`);
  }
  let lastError;
  for (const target of targets) {
    try {
      const packageJsonPath = keyringRequire.resolve(`${target.packageName}/package.json`);
      return keyringRequire(join2(dirname(packageJsonPath), target.bindingFile));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
function getKeyringNativeBindingTargets(platform, arch) {
  return getKeyringNativeBindingSuffixes(platform, arch).map((suffix) => ({
    packageName: `@napi-rs/keyring-${suffix}`,
    bindingFile: `keyring.${suffix}.node`
  }));
}
function getKeyringNativeBindingSuffixes(platform, arch) {
  if (platform === "darwin") {
    if (arch === "arm64") return ["darwin-arm64"];
    if (arch === "x64") return ["darwin-x64"];
  }
  if (platform === "win32") {
    if (arch === "arm64") return ["win32-arm64-msvc"];
    if (arch === "x64") return ["win32-x64-msvc"];
    if (arch === "ia32") return ["win32-ia32-msvc"];
  }
  if (platform === "linux") {
    if (arch === "arm64") return ["linux-arm64-gnu", "linux-arm64-musl"];
    if (arch === "arm") return ["linux-arm-gnueabihf"];
    if (arch === "riscv64") return ["linux-riscv64-gnu"];
    if (arch === "x64") return ["linux-x64-gnu", "linux-x64-musl"];
  }
  if (platform === "freebsd" && arch === "x64") return ["freebsd-x64"];
  return [];
}
function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function isLinuxKeyringRecoveryEnabled() {
  if (process.env[KEYRING_RECOVERY_DISABLED_ENV] === "1") return false;
  return process.platform === "linux" || process.env[TEST_LINUX_KEYRING_RECOVERY_ENV] === "1";
}
function shouldAttemptLinuxKeyringRecovery(error) {
  return isLinuxKeyringRecoveryEnabled() && causeChainContains(error, /key\s*(?:has been\s*)?revoked|keyrevoked/i);
}
function runLinuxKeyringRecoveryOperation(operation, account, payload) {
  const keyctl = process.env[KEYRING_RECOVERY_KEYCTL_ENV]?.trim() || "keyctl";
  const node = process.env[KEYRING_RECOVERY_NODE_ENV]?.trim() || "node";
  const helper = process.env[KEYRING_RECOVERY_HELPER_ENV]?.trim() || fileURLToPath(new URL("./mcp-keyring-helper.cjs", import.meta.url));
  const request = JSON.stringify({ operation, service: AUTH_SECRET_SERVICE, account, payload });
  const result = spawnSync(keyctl, ["session", "-", node, helper], {
    input: `${request}
`,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: KEYRING_RECOVERY_TIMEOUT_MS,
    windowsHide: true
  });
  if (result.error) {
    throw new Error(`Linux keyring recovery helper could not start: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`Linux keyring recovery helper failed with exit code ${result.status ?? "unknown"}`);
  }
  let response;
  try {
    response = JSON.parse(result.stdout.trim());
  } catch (error) {
    throw new Error("Linux keyring recovery helper returned invalid JSON", { cause: error });
  }
  if (typeof response !== "object" || response === null || typeof response.ok !== "boolean") {
    throw new Error("Linux keyring recovery helper returned an invalid response");
  }
  const typedResponse = response;
  if (typedResponse.ok === false) {
    throw new Error(typedResponse.error || "Linux keyring recovery helper failed");
  }
  if (operation === "read" && typedResponse.found === true && typeof typedResponse.value !== "string") {
    throw new Error("Linux keyring recovery helper returned an invalid read response");
  }
  return typedResponse;
}
var linuxKeyringRecoveryAuthSecretStore = {
  read(account) {
    const response = runLinuxKeyringRecoveryOperation("read", account);
    return response.ok && response.found === true ? response.value : void 0;
  },
  write(account, payload) {
    runLinuxKeyringRecoveryOperation("write", account, payload);
  },
  remove(account) {
    runLinuxKeyringRecoveryOperation("remove", account);
  }
};
function getAuthBaseDir(options = {}) {
  const override = process.env.MCP_OAUTH_DIR?.trim();
  if (override) return override;
  return options.baseDir ?? getAgentPath("mcp-oauth");
}
function getServerDir(serverName, options) {
  if (typeof serverName !== "string") {
    throw new Error(`Invalid MCP server name: ${JSON.stringify(serverName)}`);
  }
  const storageKey = getAuthEntryAccount(serverName);
  return join2(getAuthBaseDir(options), storageKey);
}
function getAuthEntryAccount(serverName) {
  if (typeof serverName !== "string") {
    throw new Error(`Invalid MCP server name: ${JSON.stringify(serverName)}`);
  }
  return `sha256-${createHash("sha256").update(serverName, "utf8").digest("hex")}`;
}
function getAuthEntryFilePath(serverName, options) {
  return join2(getServerDir(serverName, options), "tokens.json");
}
function parseJsonPayload(serverName, payload, source) {
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error(`Failed to parse OAuth credentials for ${serverName} from ${source}`, { cause: error });
  }
}
function parseAuthEntryPayload(serverName, payload, source) {
  const parsed = parseJsonPayload(serverName, payload, source);
  const entry = toAuthEntry(parsed);
  if (!entry) {
    throw new Error(`Failed to parse OAuth credentials for ${serverName} from ${source}: invalid credential shape`);
  }
  return entry;
}
function toAuthEntry(value) {
  const entry = toRecord(value);
  if (!entry) return void 0;
  const codeVerifier = optionalString(entry.codeVerifier);
  const oauthState = optionalString(entry.oauthState);
  const serverUrl = optionalString(entry.serverUrl);
  if (codeVerifier === null || oauthState === null || serverUrl === null) return void 0;
  const tokens = entry.tokens === void 0 ? void 0 : toStoredTokens(entry.tokens);
  const clientInfo = entry.clientInfo === void 0 ? void 0 : toStoredClientInfo(entry.clientInfo);
  const nativeOAuth = entry.nativeOAuth === void 0 ? void 0 : toNativeOAuthStorageMetadata(entry.nativeOAuth);
  if (entry.tokens !== void 0 && !tokens || entry.clientInfo !== void 0 && !clientInfo || entry.nativeOAuth !== void 0 && !nativeOAuth) return void 0;
  const authEntry = {};
  if (tokens) authEntry.tokens = tokens;
  if (clientInfo) authEntry.clientInfo = clientInfo;
  if (codeVerifier !== void 0) authEntry.codeVerifier = codeVerifier;
  if (oauthState !== void 0) authEntry.oauthState = oauthState;
  if (nativeOAuth !== void 0) authEntry.nativeOAuth = nativeOAuth;
  if (serverUrl !== void 0) authEntry.serverUrl = serverUrl;
  return authEntry;
}
function toStoredTokens(value) {
  const tokens = toRecord(value);
  if (!tokens || typeof tokens.accessToken !== "string") return void 0;
  const refreshToken = optionalString(tokens.refreshToken);
  const scope = optionalString(tokens.scope);
  const issuer = optionalString(tokens.issuer);
  const expiresAt = optionalNumber(tokens.expiresAt);
  if (refreshToken === null || scope === null || issuer === null || expiresAt === null) return void 0;
  const storedTokens = { accessToken: tokens.accessToken };
  if (refreshToken !== void 0) storedTokens.refreshToken = refreshToken;
  if (expiresAt !== void 0) storedTokens.expiresAt = expiresAt;
  if (scope !== void 0) storedTokens.scope = scope;
  if (issuer !== void 0) storedTokens.issuer = issuer;
  return storedTokens;
}
function toStoredClientInfo(value) {
  const clientInfo = toRecord(value);
  if (!clientInfo || typeof clientInfo.clientId !== "string") return void 0;
  const clientSecret = optionalString(clientInfo.clientSecret);
  const issuer = optionalString(clientInfo.issuer);
  const clientIdIssuedAt = optionalNumber(clientInfo.clientIdIssuedAt);
  const clientSecretExpiresAt = optionalNumber(clientInfo.clientSecretExpiresAt);
  const configPreRegistered = optionalBoolean(clientInfo.configPreRegistered);
  const tokenEndpointAuthMethod = optionalString(clientInfo.tokenEndpointAuthMethod);
  const grantTypes = optionalStringArray(clientInfo.grantTypes);
  const responseTypes = optionalStringArray(clientInfo.responseTypes);
  const applicationType = optionalString(clientInfo.applicationType);
  const clientName = optionalString(clientInfo.clientName);
  const clientUri = optionalString(clientInfo.clientUri);
  const logoUri = optionalString(clientInfo.logoUri);
  const scope = optionalString(clientInfo.scope);
  const contacts = optionalStringArray(clientInfo.contacts);
  const tosUri = optionalString(clientInfo.tosUri);
  const policyUri = optionalString(clientInfo.policyUri);
  const jwksUri = optionalString(clientInfo.jwksUri);
  const jwks = clientInfo.jwks === void 0 ? void 0 : toAuthJsonValue(clientInfo.jwks);
  const softwareId = optionalString(clientInfo.softwareId);
  const softwareVersion = optionalString(clientInfo.softwareVersion);
  const softwareStatement = optionalString(clientInfo.softwareStatement);
  if (clientSecret === null || issuer === null || clientIdIssuedAt === null || clientSecretExpiresAt === null || configPreRegistered === null || tokenEndpointAuthMethod === null || grantTypes === null || responseTypes === null || applicationType === null || clientName === null || clientUri === null || logoUri === null || scope === null || contacts === null || tosUri === null || policyUri === null || jwksUri === null || clientInfo.jwks !== void 0 && jwks === void 0 || softwareId === null || softwareVersion === null || softwareStatement === null) return void 0;
  const storedClient = { clientId: clientInfo.clientId };
  const redirectUris = stringArray(clientInfo.redirectUris);
  if (clientSecret !== void 0) storedClient.clientSecret = clientSecret;
  if (clientIdIssuedAt !== void 0) storedClient.clientIdIssuedAt = clientIdIssuedAt;
  if (clientSecretExpiresAt !== void 0) storedClient.clientSecretExpiresAt = clientSecretExpiresAt;
  if (redirectUris !== void 0) storedClient.redirectUris = redirectUris;
  if (tokenEndpointAuthMethod !== void 0) storedClient.tokenEndpointAuthMethod = tokenEndpointAuthMethod;
  if (grantTypes !== void 0) storedClient.grantTypes = grantTypes;
  if (responseTypes !== void 0) storedClient.responseTypes = responseTypes;
  if (applicationType !== void 0) storedClient.applicationType = applicationType;
  if (clientName !== void 0) storedClient.clientName = clientName;
  if (clientUri !== void 0) storedClient.clientUri = clientUri;
  if (logoUri !== void 0) storedClient.logoUri = logoUri;
  if (scope !== void 0) storedClient.scope = scope;
  if (contacts !== void 0) storedClient.contacts = contacts;
  if (tosUri !== void 0) storedClient.tosUri = tosUri;
  if (policyUri !== void 0) storedClient.policyUri = policyUri;
  if (jwksUri !== void 0) storedClient.jwksUri = jwksUri;
  if (jwks !== void 0) storedClient.jwks = jwks;
  if (softwareId !== void 0) storedClient.softwareId = softwareId;
  if (softwareVersion !== void 0) storedClient.softwareVersion = softwareVersion;
  if (softwareStatement !== void 0) storedClient.softwareStatement = softwareStatement;
  if (issuer !== void 0) storedClient.issuer = issuer;
  if (configPreRegistered !== void 0) storedClient.configPreRegistered = configPreRegistered;
  return storedClient;
}
function optionalStringArray(value) {
  if (value === void 0) return void 0;
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : null;
}
function toNativeOAuthStorageMetadata(value) {
  const metadata = toRecord(value);
  if (!metadata) return void 0;
  const tokenType = optionalString(metadata.tokenType);
  const idToken = optionalString(metadata.idToken);
  const discovery = metadata.discovery === void 0 ? void 0 : toAuthJsonObject(metadata.discovery);
  if (tokenType === null || idToken === null || metadata.discovery !== void 0 && !discovery) return void 0;
  const result = {};
  if (tokenType !== void 0) result.tokenType = tokenType;
  if (idToken !== void 0) result.idToken = idToken;
  if (discovery !== void 0) result.discovery = discovery;
  return result;
}
function toAuthJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (Array.isArray(value)) {
    const items = value.map(toAuthJsonValue);
    return items.some((item) => item === void 0) ? void 0 : items;
  }
  const record = toRecord(value);
  if (!record) return void 0;
  const result = /* @__PURE__ */ Object.create(null);
  for (const [key, item] of Object.entries(record)) {
    const parsed = toAuthJsonValue(item);
    if (parsed === void 0) return void 0;
    result[key] = parsed;
  }
  return result;
}
function toAuthJsonObject(value) {
  const parsed = toAuthJsonValue(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
}
function toRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function optionalString(value) {
  if (value === void 0) return void 0;
  return typeof value === "string" ? value : null;
}
function optionalNumber(value) {
  if (value === void 0) return void 0;
  return typeof value === "number" ? value : null;
}
function optionalBoolean(value) {
  if (value === void 0) return void 0;
  return typeof value === "boolean" ? value : null;
}
function stringArray(value) {
  return Array.isArray(value) && value.every((uri) => typeof uri === "string") ? value : void 0;
}
function isAuthEntryChunkManifest(value) {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value;
  return manifest[AUTH_CHUNK_MANIFEST_KEY] === 1 && typeof manifest.chunkCount === "number" && Number.isInteger(manifest.chunkCount) && manifest.chunkCount > 0 && typeof manifest.chunkDigest === "string" && /^[a-f0-9]{16}$/.test(manifest.chunkDigest);
}
function getAuthEntryChunkAccount(account, manifest, index) {
  return `${account}.chunk.${manifest.chunkDigest}.${index}`;
}
function getAuthEntryChunkAccounts(account, manifest) {
  return Array.from({ length: manifest.chunkCount }, (_, index) => getAuthEntryChunkAccount(account, manifest, index));
}
function readChunkManifestFromPayload(serverName, payload, source) {
  const parsed = parseJsonPayload(serverName, payload, source);
  return isAuthEntryChunkManifest(parsed) ? parsed : void 0;
}
function readExistingChunkManifest(store, serverName, account) {
  try {
    const payload = store.read(account);
    return payload === void 0 ? void 0 : readChunkManifestFromPayload(serverName, payload, "OS secure credential store");
  } catch {
    return void 0;
  }
}
function removeChunkPayloads(store, account, manifest) {
  for (const chunkAccount2 of getAuthEntryChunkAccounts(account, manifest)) {
    store.remove(chunkAccount2);
  }
}
function tryRemoveChunkPayloads(store, account, manifest) {
  if (!manifest) return;
  try {
    removeChunkPayloads(store, account, manifest);
  } catch {
  }
}
function createChunkManifest(payload) {
  return {
    [AUTH_CHUNK_MANIFEST_KEY]: 1,
    chunkCount: Math.ceil(payload.length / AUTH_SECRET_CHUNK_SIZE),
    chunkDigest: createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16)
  };
}
function readChunkedAuthEntry(store, serverName, account, manifest) {
  const chunks = getAuthEntryChunkAccounts(account, manifest).map((chunkAccount2) => {
    try {
      const chunk = store.read(chunkAccount2);
      if (chunk === void 0) {
        throw new Error(`Missing OAuth credential chunk ${chunkAccount2} for ${serverName}`);
      }
      return chunk;
    } catch (error) {
      throw new OAuthCredentialStoreError(
        `Failed to read OAuth credentials for ${serverName} from the OS secure credential store`,
        "read",
        error
      );
    }
  });
  return parseAuthEntryPayload(serverName, chunks.join(""), "OS secure credential store chunks");
}
function readLegacyAuthEntry(serverName, options) {
  const filePath = getAuthEntryFilePath(serverName, options);
  if (!existsSync4(filePath)) return void 0;
  const data = readFileSync4(filePath, "utf-8");
  return parseAuthEntryPayload(serverName, data, filePath);
}
function removeLegacyAuthEntry(serverName, options) {
  const filePath = getAuthEntryFilePath(serverName, options);
  if (!existsSync4(filePath)) return;
  try {
    rmSync(filePath, { force: true });
  } catch (error) {
    throw new Error(`Failed to remove legacy plaintext OAuth credentials for ${serverName} at ${filePath}`, { cause: error });
  }
  const dir = getServerDir(serverName, options);
  try {
    rmSync(dir, { recursive: true });
  } catch {
  }
}
function writeSecureAuthEntryToStore(store, serverName, entry) {
  const account = getAuthEntryAccount(serverName);
  const payload = JSON.stringify(entry);
  const previousManifest = readExistingChunkManifest(store, serverName, account);
  const manifest = payload.length > AUTH_SECRET_CHUNK_SIZE ? createChunkManifest(payload) : void 0;
  try {
    if (manifest) {
      for (let index = 0; index < manifest.chunkCount; index++) {
        const chunk = payload.slice(index * AUTH_SECRET_CHUNK_SIZE, (index + 1) * AUTH_SECRET_CHUNK_SIZE);
        store.write(getAuthEntryChunkAccount(account, manifest, index), chunk);
      }
      store.write(account, JSON.stringify(manifest));
    } else {
      store.write(account, payload);
    }
    if (previousManifest?.chunkDigest !== manifest?.chunkDigest) {
      tryRemoveChunkPayloads(store, account, previousManifest);
    }
  } catch (error) {
    tryRemoveChunkPayloads(store, account, manifest);
    throw new OAuthCredentialStoreError(
      `Failed to write OAuth credentials for ${serverName} to the OS secure credential store`,
      "write",
      error
    );
  }
  publishAuthEntryToCache(serverName, payload);
}
function publishAuthEntryToCache(serverName, payload) {
  if (!isAuthEntryCacheEnabled()) return;
  const normalized = toAuthEntry(JSON.parse(payload));
  if (!normalized) {
    authEntryCache.delete(serverName);
    return;
  }
  authEntryCache.set(serverName, cloneAuthEntry(normalized));
}
function writeSecureAuthEntry(serverName, entry) {
  try {
    writeSecureAuthEntryToStore(getAuthSecretStore(), serverName, entry);
  } catch (error) {
    if (!shouldAttemptLinuxKeyringRecovery(error)) throw error;
    writeSecureAuthEntryToStore(linuxKeyringRecoveryAuthSecretStore, serverName, entry);
  }
}
function readAuthEntryFromStore(store, serverName, options, behavior = {}) {
  const account = getAuthEntryAccount(serverName);
  let payload;
  try {
    payload = store.read(account);
  } catch (error) {
    throw new OAuthCredentialStoreError(
      `Failed to read OAuth credentials for ${serverName} from the OS secure credential store`,
      "read",
      error
    );
  }
  if (payload !== void 0) {
    const manifest = readChunkManifestFromPayload(serverName, payload, "OS secure credential store");
    const entry = manifest ? readChunkedAuthEntry(store, serverName, account, manifest) : parseAuthEntryPayload(serverName, payload, "OS secure credential store");
    removeLegacyAuthEntry(serverName, options);
    return entry;
  }
  const legacyEntry = readLegacyAuthEntry(serverName, options);
  if (!legacyEntry) return void 0;
  if (behavior.migrateLegacy === false) return legacyEntry;
  writeSecureAuthEntryToStore(store, serverName, legacyEntry);
  removeLegacyAuthEntry(serverName, options);
  return legacyEntry;
}
function readAuthEntry(serverName, options, behavior = {}) {
  const cacheable = behavior.migrateLegacy !== false && isAuthEntryCacheEnabled();
  if (cacheable && authEntryCache.has(serverName)) {
    return cloneAuthEntry(authEntryCache.get(serverName));
  }
  let entry;
  try {
    entry = readAuthEntryFromStore(getAuthSecretStore(), serverName, options, behavior);
  } catch (error) {
    if (!shouldAttemptLinuxKeyringRecovery(error)) throw error;
    entry = readAuthEntryFromStore(linuxKeyringRecoveryAuthSecretStore, serverName, options, behavior);
  }
  if (cacheable) authEntryCache.set(serverName, cloneAuthEntry(entry));
  return entry;
}
function getAuthEntry(serverName, options) {
  return readAuthEntry(serverName, options);
}
function saveAuthEntry(serverName, entry, serverUrl, options) {
  if (serverUrl) {
    entry.serverUrl = serverUrl;
  }
  writeSecureAuthEntry(serverName, entry);
  removeLegacyAuthEntry(serverName, options);
}
function removeAuthEntryFromStore(store, serverName) {
  const account = getAuthEntryAccount(serverName);
  try {
    const payload = store.read(account);
    const manifest = payload === void 0 ? void 0 : readChunkManifestFromPayload(serverName, payload, "OS secure credential store");
    if (manifest) removeChunkPayloads(store, account, manifest);
    store.remove(account);
  } catch (error) {
    throw new OAuthCredentialStoreError(
      `Failed to remove OAuth credentials for ${serverName} from the OS secure credential store`,
      "remove",
      error
    );
  }
}
function removeAuthEntry(serverName, options) {
  try {
    removeAuthEntryFromStore(getAuthSecretStore(), serverName);
  } catch (error) {
    if (!shouldAttemptLinuxKeyringRecovery(error)) throw error;
    removeAuthEntryFromStore(linuxKeyringRecoveryAuthSecretStore, serverName);
  }
  authEntryCache.delete(serverName);
  removeLegacyAuthEntry(serverName, options);
}
function invalidateAuthEntryCache(serverName) {
  authEntryCache.delete(serverName);
}

// src/auth/mcp-bearer-store.ts
import { createHash as createHash2 } from "node:crypto";
import { createRequire as createRequire2 } from "node:module";
import { dirname as dirname2, join as join3 } from "node:path";
var require3 = createRequire2(import.meta.url);
var BEARER_SECRET_SERVICE = "pi-mcp-adapter.bearer";
var TEST_AUTH_STORE_ENV2 = "PI_MCP_ADAPTER_TEST_AUTH_STORE";
var BEARER_SECRET_VALUE_LIMIT = 1280;
var KeyringEntryClass2;
var memoryBearerEntries = /* @__PURE__ */ new Map();
var testBearerSecretStoreReadCount = 0;
var BearerCredentialStoreError = class extends Error {
  code = "BEARER_CREDENTIAL_STORE_UNAVAILABLE";
  operation;
  // No parameter properties: cli.js loads this module under plain Node
  // type stripping, which rejects non-erasable TypeScript syntax.
  constructor(message, operation, cause) {
    super(message, { cause });
    this.name = "BearerCredentialStoreError";
    this.operation = operation;
  }
};
var memoryBearerSecretStore = {
  read(account) {
    testBearerSecretStoreReadCount++;
    return memoryBearerEntries.get(account);
  },
  write(account, payload) {
    memoryBearerEntries.set(account, payload);
  },
  remove(account) {
    memoryBearerEntries.delete(account);
  }
};
var sizeLimitedBearerSecretStore = {
  read(account) {
    testBearerSecretStoreReadCount++;
    return memoryBearerEntries.get(account);
  },
  write(account, payload) {
    if (payload.length > BEARER_SECRET_VALUE_LIMIT) {
      throw new Error(`Value of 'password encoded as UTF-16' is longer than the platform limit of ${BEARER_SECRET_VALUE_LIMIT * 2} chars`);
    }
    memoryBearerEntries.set(account, payload);
  },
  remove(account) {
    memoryBearerEntries.delete(account);
  }
};
var unavailableBearerSecretStore = {
  read() {
    testBearerSecretStoreReadCount++;
    throw new Error("simulated secure credential store unavailable");
  },
  write() {
    throw new Error("simulated secure credential store unavailable");
  },
  remove() {
    throw new Error("simulated secure credential store unavailable");
  }
};
var keyringBearerSecretStore = {
  read(account) {
    return getKeyringEntry2(account).getPassword() ?? void 0;
  },
  write(account, payload) {
    getKeyringEntry2(account).setPassword(payload);
  },
  remove(account) {
    getKeyringEntry2(account).deleteCredential();
  }
};
function getBearerSecretStore() {
  if (process.env[TEST_AUTH_STORE_ENV2] === "memory") return memoryBearerSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV2] === "sizelimited") return sizeLimitedBearerSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV2] === "unavailable") return unavailableBearerSecretStore;
  return keyringBearerSecretStore;
}
function getKeyringEntry2(account) {
  try {
    KeyringEntryClass2 ??= loadKeyringEntryClass2();
    return new KeyringEntryClass2(BEARER_SECRET_SERVICE, account);
  } catch (error) {
    throw new Error("Bearer token secure credential storage is unavailable. Configure the OS credential store and retry.", { cause: error });
  }
}
function loadKeyringEntryClass2(keyringRequire = require3, platform = process.platform, arch = process.arch) {
  try {
    return keyringRequire("@napi-rs/keyring").Entry;
  } catch (loaderError) {
    try {
      return loadKeyringNativeBindingFallback2(keyringRequire, platform, arch).Entry;
    } catch (fallbackError) {
      const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`Failed to load @napi-rs/keyring; absolute-path native binding fallback also failed: ${message}`, { cause: loaderError });
    }
  }
}
function loadKeyringNativeBindingFallback2(keyringRequire, platform, arch) {
  const targets = getKeyringNativeBindingSuffixes2(platform, arch).map((suffix) => ({
    packageName: `@napi-rs/keyring-${suffix}`,
    bindingFile: `keyring.${suffix}.node`
  }));
  let lastError;
  for (const target of targets) {
    try {
      const packageJsonPath = keyringRequire.resolve(`${target.packageName}/package.json`);
      return keyringRequire(join3(dirname2(packageJsonPath), target.bindingFile));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
function getKeyringNativeBindingSuffixes2(platform, arch) {
  if (platform === "darwin") {
    if (arch === "arm64") return ["darwin-arm64"];
    if (arch === "x64") return ["darwin-x64"];
  }
  if (platform === "win32") {
    if (arch === "arm64") return ["win32-arm64-msvc"];
    if (arch === "x64") return ["win32-x64-msvc"];
    if (arch === "ia32") return ["win32-ia32-msvc"];
  }
  if (platform === "linux") {
    if (arch === "arm64") return ["linux-arm64-gnu", "linux-arm64-musl"];
    if (arch === "arm") return ["linux-arm-gnueabihf"];
    if (arch === "riscv64") return ["linux-riscv64-gnu"];
    if (arch === "x64") return ["linux-x64-gnu", "linux-x64-musl"];
  }
  if (platform === "freebsd" && arch === "x64") return ["freebsd-x64"];
  return [];
}
function getBearerAccount(serverName) {
  if (typeof serverName !== "string") {
    throw new Error(`Invalid MCP server name: ${JSON.stringify(serverName)}`);
  }
  return `sha256-${createHash2("sha256").update(serverName, "utf8").digest("hex")}`;
}
function parseBearerPayload(serverName, payload) {
  const parsed = parseStoredBearerJson(serverName, payload);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Stored bearer token record for ${serverName} has invalid shape`);
  }
  const record = parsed;
  if (typeof record.token !== "string" || typeof record.serverUrl !== "string") {
    throw new Error(`Stored bearer token record for ${serverName} has invalid shape`);
  }
  return { token: record.token, serverUrl: record.serverUrl };
}
function parseStoredBearerJson(serverName, payload) {
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(`Failed to parse stored bearer token record for ${serverName}`);
  }
}
function isBearerChunkManifest(value) {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value;
  return manifest.__piMcpAdapterBearerChunked === 1 && typeof manifest.chunkCount === "number" && Number.isInteger(manifest.chunkCount) && manifest.chunkCount > 0 && typeof manifest.chunkDigest === "string" && /^[a-f0-9]{16}$/.test(manifest.chunkDigest);
}
function readManifest(serverName, payload) {
  const parsed = parseStoredBearerJson(serverName, payload);
  return isBearerChunkManifest(parsed) ? parsed : void 0;
}
function chunkAccount(account, manifest, index) {
  return `${account}.chunk.${manifest.chunkDigest}.${index}`;
}
function chunkAccounts(account, manifest) {
  return Array.from({ length: manifest.chunkCount }, (_, index) => chunkAccount(account, manifest, index));
}
function readBearerRecordFromStore(store, serverName) {
  const account = getBearerAccount(serverName);
  let payload;
  try {
    payload = store.read(account);
  } catch (error) {
    throw new BearerCredentialStoreError(
      `Failed to read bearer token for ${serverName} from the OS secure credential store`,
      "read",
      error
    );
  }
  if (payload === void 0) return void 0;
  try {
    const manifest = readManifest(serverName, payload);
    const recordPayload = manifest ? chunkAccounts(account, manifest).map((chunkName) => {
      const chunk = store.read(chunkName);
      if (chunk === void 0) throw new Error(`Missing bearer token chunk for ${serverName}`);
      return chunk;
    }).join("") : payload;
    return parseBearerPayload(serverName, recordPayload);
  } catch (error) {
    throw new BearerCredentialStoreError(
      `Failed to read bearer token for ${serverName} from the OS secure credential store`,
      "read",
      error
    );
  }
}
function getBearerTokenForUrl(serverName, serverUrl) {
  const record = readBearerRecordFromStore(getBearerSecretStore(), serverName);
  if (!record) return void 0;
  return record.serverUrl === serverUrl ? record.token : void 0;
}

// src/native/oauth-credential-backend.ts
function normalizeUrl(serverUrl) {
  try {
    return new URL(serverUrl).href;
  } catch {
    throw new Error("Invalid MCP OAuth server URL.");
  }
}
function toAuthJsonValue2(value, ancestors = /* @__PURE__ */ new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value !== "object" || ancestors.has(value)) return void 0;
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    const items = value.map((item) => toAuthJsonValue2(item, ancestors));
    if (!items.some((item) => item === void 0)) result = items;
  } else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
    const object = /* @__PURE__ */ Object.create(null);
    let valid = true;
    for (const [key, item] of Object.entries(value)) {
      const parsed = toAuthJsonValue2(item, ancestors);
      if (parsed === void 0) {
        valid = false;
        break;
      }
      object[key] = parsed;
    }
    if (valid) result = object;
  }
  ancestors.delete(value);
  return result;
}
function toAuthJsonObject2(value) {
  const parsed = toAuthJsonValue2(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function toNativeDiscoveryState(value) {
  const authorizationServerUrl = value.authorizationServerUrl;
  if (typeof authorizationServerUrl !== "string") return void 0;
  const serverMetadata = value.authorizationServerMetadata;
  if (serverMetadata !== void 0) {
    if (!isRecord2(serverMetadata) || typeof serverMetadata.issuer !== "string" || typeof serverMetadata.authorization_endpoint !== "string" || typeof serverMetadata.token_endpoint !== "string" || !isStringArray(serverMetadata.response_types_supported)) return void 0;
  }
  const resourceMetadata = value.resourceMetadata;
  if (resourceMetadata !== void 0) {
    if (!isRecord2(resourceMetadata) || typeof resourceMetadata.resource !== "string") return void 0;
    if (resourceMetadata.authorization_servers !== void 0 && !isStringArray(resourceMetadata.authorization_servers)) return void 0;
    if (resourceMetadata.scopes_supported !== void 0 && !isStringArray(resourceMetadata.scopes_supported)) {
      return void 0;
    }
  }
  const resourceMetadataUrl = value.resourceMetadataUrl;
  if (resourceMetadataUrl !== void 0 && typeof resourceMetadataUrl !== "string") return void 0;
  return {
    authorizationServerUrl,
    ...serverMetadata === void 0 ? {} : { authorizationServerMetadata: serverMetadata },
    ...resourceMetadata === void 0 ? {} : { resourceMetadata },
    ...resourceMetadataUrl === void 0 ? {} : { resourceMetadataUrl }
  };
}
function readFreshAuthEntry(serverName) {
  invalidateAuthEntryCache(serverName);
  return getAuthEntry(serverName);
}
function toNativeClientInformation(clientInfo) {
  if (!clientInfo || clientInfo.configPreRegistered || clientInfo.clientSecret === void 0 && clientInfo.clientIdIssuedAt === void 0 && clientInfo.clientSecretExpiresAt === void 0 && clientInfo.redirectUris === void 0) return void 0;
  const jwks = clientInfo.jwks === void 0 ? void 0 : toAuthJsonValue2(clientInfo.jwks);
  if (clientInfo.jwks !== void 0 && jwks === void 0) {
    throw new Error("Stored native MCP OAuth client metadata is invalid.");
  }
  return {
    client_id: clientInfo.clientId,
    ...clientInfo.clientSecret === void 0 ? {} : { client_secret: clientInfo.clientSecret },
    ...clientInfo.clientIdIssuedAt === void 0 ? {} : { client_id_issued_at: clientInfo.clientIdIssuedAt },
    ...clientInfo.clientSecretExpiresAt === void 0 ? {} : { client_secret_expires_at: clientInfo.clientSecretExpiresAt },
    ...clientInfo.redirectUris === void 0 ? {} : { redirect_uris: [...clientInfo.redirectUris] },
    ...clientInfo.tokenEndpointAuthMethod === void 0 ? {} : { token_endpoint_auth_method: clientInfo.tokenEndpointAuthMethod },
    ...clientInfo.grantTypes === void 0 ? {} : { grant_types: [...clientInfo.grantTypes] },
    ...clientInfo.responseTypes === void 0 ? {} : { response_types: [...clientInfo.responseTypes] },
    ...clientInfo.applicationType === void 0 ? {} : { application_type: clientInfo.applicationType },
    ...clientInfo.clientName === void 0 ? {} : { client_name: clientInfo.clientName },
    ...clientInfo.clientUri === void 0 ? {} : { client_uri: clientInfo.clientUri },
    ...clientInfo.logoUri === void 0 ? {} : { logo_uri: clientInfo.logoUri },
    ...clientInfo.scope === void 0 ? {} : { scope: clientInfo.scope },
    ...clientInfo.contacts === void 0 ? {} : { contacts: [...clientInfo.contacts] },
    ...clientInfo.tosUri === void 0 ? {} : { tos_uri: clientInfo.tosUri },
    ...clientInfo.policyUri === void 0 ? {} : { policy_uri: clientInfo.policyUri },
    ...clientInfo.jwksUri === void 0 ? {} : { jwks_uri: clientInfo.jwksUri },
    ...jwks === void 0 ? {} : { jwks },
    ...clientInfo.softwareId === void 0 ? {} : { software_id: clientInfo.softwareId },
    ...clientInfo.softwareVersion === void 0 ? {} : { software_version: clientInfo.softwareVersion },
    ...clientInfo.softwareStatement === void 0 ? {} : { software_statement: clientInfo.softwareStatement },
    ...clientInfo.issuer === void 0 ? {} : { issuer: clientInfo.issuer }
  };
}
function toStoredClientInformation(clientInfo, issuer) {
  if (!clientInfo) return void 0;
  const boundIssuer = clientInfo.issuer ?? issuer;
  const jwks = clientInfo.jwks === void 0 ? void 0 : toAuthJsonValue2(clientInfo.jwks);
  if (clientInfo.jwks !== void 0 && jwks === void 0) {
    throw new Error("MCP OAuth client metadata contains a non-JSON value.");
  }
  return {
    clientId: clientInfo.client_id,
    ...clientInfo.client_secret === void 0 ? {} : { clientSecret: clientInfo.client_secret },
    ...clientInfo.client_id_issued_at === void 0 ? {} : { clientIdIssuedAt: clientInfo.client_id_issued_at },
    ...clientInfo.client_secret_expires_at === void 0 ? {} : { clientSecretExpiresAt: clientInfo.client_secret_expires_at },
    ...clientInfo.redirect_uris === void 0 ? {} : { redirectUris: [...clientInfo.redirect_uris] },
    ...clientInfo.token_endpoint_auth_method === void 0 ? {} : { tokenEndpointAuthMethod: clientInfo.token_endpoint_auth_method },
    ...clientInfo.grant_types === void 0 ? {} : { grantTypes: [...clientInfo.grant_types] },
    ...clientInfo.response_types === void 0 ? {} : { responseTypes: [...clientInfo.response_types] },
    ...clientInfo.application_type === void 0 ? {} : { applicationType: clientInfo.application_type },
    ...clientInfo.client_name === void 0 ? {} : { clientName: clientInfo.client_name },
    ...clientInfo.client_uri === void 0 ? {} : { clientUri: clientInfo.client_uri },
    ...clientInfo.logo_uri === void 0 ? {} : { logoUri: clientInfo.logo_uri },
    ...clientInfo.scope === void 0 ? {} : { scope: clientInfo.scope },
    ...clientInfo.contacts === void 0 ? {} : { contacts: [...clientInfo.contacts] },
    ...clientInfo.tos_uri === void 0 ? {} : { tosUri: clientInfo.tos_uri },
    ...clientInfo.policy_uri === void 0 ? {} : { policyUri: clientInfo.policy_uri },
    ...clientInfo.jwks_uri === void 0 ? {} : { jwksUri: clientInfo.jwks_uri },
    ...jwks === void 0 ? {} : { jwks },
    ...clientInfo.software_id === void 0 ? {} : { softwareId: clientInfo.software_id },
    ...clientInfo.software_version === void 0 ? {} : { softwareVersion: clientInfo.software_version },
    ...clientInfo.software_statement === void 0 ? {} : { softwareStatement: clientInfo.software_statement },
    ...boundIssuer === void 0 ? {} : { issuer: boundIssuer }
  };
}
function toNativeTokens(entry) {
  if (!entry.tokens) return void 0;
  return {
    access_token: entry.tokens.accessToken,
    token_type: entry.nativeOAuth?.tokenType ?? "Bearer",
    ...entry.tokens.refreshToken === void 0 ? {} : { refresh_token: entry.tokens.refreshToken },
    ...entry.tokens.scope === void 0 ? {} : { scope: entry.tokens.scope },
    ...entry.nativeOAuth?.idToken === void 0 ? {} : { id_token: entry.nativeOAuth.idToken },
    ...entry.tokens.issuer === void 0 ? {} : { issuer: entry.tokens.issuer }
  };
}
function toStoredTokens2(tokens, tokensExpireAt, issuer) {
  if (!tokens) return void 0;
  const expiresAt = tokensExpireAt === void 0 ? tokens.expires_in === void 0 ? void 0 : Date.now() / 1e3 + tokens.expires_in : tokensExpireAt / 1e3;
  const boundIssuer = tokens.issuer ?? issuer;
  return {
    accessToken: tokens.access_token,
    ...tokens.refresh_token === void 0 ? {} : { refreshToken: tokens.refresh_token },
    ...expiresAt === void 0 ? {} : { expiresAt },
    ...tokens.scope === void 0 ? {} : { scope: tokens.scope },
    ...boundIssuer === void 0 ? {} : { issuer: boundIssuer }
  };
}
function toNativeState(entry, serverUrl) {
  const discovery = entry.nativeOAuth?.discovery === void 0 ? void 0 : toNativeDiscoveryState(entry.nativeOAuth.discovery);
  if (entry.nativeOAuth?.discovery !== void 0 && !discovery) {
    throw new Error("Stored native MCP OAuth discovery state is invalid.");
  }
  const clientInformation = toNativeClientInformation(entry.clientInfo);
  const tokens = toNativeTokens(entry);
  return {
    serverUrl: normalizeUrl(serverUrl),
    ...clientInformation === void 0 ? {} : { clientInformation },
    ...tokens === void 0 ? {} : { tokens },
    ...entry.tokens?.expiresAt === void 0 ? {} : { tokensExpireAt: entry.tokens.expiresAt * 1e3 },
    ...entry.codeVerifier === void 0 ? {} : { codeVerifier: entry.codeVerifier },
    ...entry.oauthState === void 0 ? {} : { oauthState: entry.oauthState },
    ...discovery === void 0 ? {} : { discovery: structuredClone(discovery) }
  };
}
function toAuthEntry2(state, previous, serverUrl) {
  const normalizedServerUrl = normalizeUrl(serverUrl);
  if (normalizeUrl(state.serverUrl) !== normalizedServerUrl) {
    throw new Error("MCP OAuth state belongs to a different server URL.");
  }
  const issuer = state.discovery?.authorizationServerMetadata?.issuer;
  const discovery = state.discovery === void 0 ? void 0 : toAuthJsonObject2(state.discovery);
  if (state.discovery !== void 0 && !discovery) {
    throw new Error("MCP OAuth discovery metadata contains a non-JSON value.");
  }
  const tokens = toStoredTokens2(state.tokens, state.tokensExpireAt, issuer);
  const clientInfo = toStoredClientInformation(state.clientInformation, issuer);
  const nativeOAuth = {
    ...state.tokens?.token_type === void 0 ? {} : { tokenType: state.tokens.token_type },
    ...state.tokens?.id_token === void 0 ? {} : { idToken: state.tokens.id_token },
    ...discovery === void 0 ? {} : { discovery }
  };
  const entry = {
    ...previous?.serverUrl === serverUrl ? previous : {},
    serverUrl
  };
  if (tokens === void 0) delete entry.tokens;
  else entry.tokens = tokens;
  if (clientInfo === void 0) delete entry.clientInfo;
  else entry.clientInfo = clientInfo;
  if (state.codeVerifier === void 0) delete entry.codeVerifier;
  else entry.codeVerifier = state.codeVerifier;
  if (state.oauthState === void 0) delete entry.oauthState;
  else entry.oauthState = state.oauthState;
  if (Object.keys(nativeOAuth).length === 0) delete entry.nativeOAuth;
  else entry.nativeOAuth = nativeOAuth;
  return entry;
}
function createNativeMcpOAuthCredentialBackend(managedServerNames) {
  const handlesServer = (name) => {
    const names = typeof managedServerNames === "function" ? managedServerNames() : managedServerNames;
    return names.includes(name);
  };
  const readState = (name, serverUrl) => {
    const entry = readFreshAuthEntry(name);
    if (!entry || entry.serverUrl !== serverUrl) return void 0;
    return toNativeState(entry, serverUrl);
  };
  const forServer = (name, serverUrl) => ({
    load: () => readState(name, serverUrl),
    save: (state) => {
      const previous = readFreshAuthEntry(name);
      const entry = toAuthEntry2(state, previous, serverUrl);
      saveAuthEntry(name, entry, serverUrl);
    }
  });
  return {
    handlesServer,
    forServer,
    tokens: (name, serverUrl) => readState(name, serverUrl)?.tokens,
    bearerToken: (name, serverUrl) => getBearerTokenForUrl(name, normalizeUrl(serverUrl)),
    remove: (name, serverUrl) => {
      const entry = readFreshAuthEntry(name);
      if (!entry || entry.serverUrl !== serverUrl) return false;
      removeAuthEntry(name);
      return true;
    }
  };
}

// src/native/config-write.ts
import { randomUUID } from "node:crypto";
import { existsSync as existsSync5, mkdirSync, readFileSync as readFileSync5, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname as dirname3 } from "node:path";
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDirectToolsSelection(value) {
  if (typeof value === "boolean") return true;
  try {
    if (!Array.isArray(value) || value.length > 256) return false;
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) return false;
      const toolName = value[index];
      if (typeof toolName !== "string" || toolName.length === 0 || toolName.length > 256 || /[\u0000-\u001f\u007f]/.test(toolName)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
function readConfig(path) {
  if (!existsSync5(path)) return {};
  let parsed;
  try {
    parsed = parseJsonConfig(readFileSync5(path, "utf8"));
  } catch {
    throw new Error("The MCP config file cannot be parsed safely.");
  }
  if (!isRecord3(parsed) || parsed.mcpServers !== void 0 && !isRecord3(parsed.mcpServers)) {
    throw new Error("The MCP config file must contain an object mcpServers field.");
  }
  return parsed;
}
function updateServer(servers, serverName, patch, allowCreate) {
  const existing = servers[serverName];
  if (existing === void 0 && !allowCreate) {
    throw new Error("The MCP config source no longer contains this server.");
  }
  if (existing !== void 0 && !isRecord3(existing)) {
    throw new Error("The MCP config entry cannot be updated safely.");
  }
  const server = existing === void 0 ? {} : { ...existing };
  const isOverride = server.command === void 0 && server.url === void 0 && server.socket === void 0 && server.type === void 0;
  if (patch.enabled !== void 0) {
    delete server.disabled;
    if (patch.enabled && !isOverride) delete server.enabled;
    else server.enabled = patch.enabled;
  }
  if (patch.exposure !== void 0) {
    if (patch.exposure === "codemode" && !isOverride) delete server.exposure;
    else server.exposure = patch.exposure;
  }
  if (patch.toolExposure !== void 0) {
    const current = server.toolExposure;
    if (current !== void 0 && !isRecord3(current)) {
      throw new Error("The MCP tool exposure entry cannot be updated safely.");
    }
    server.toolExposure = { ...current ?? {}, ...patch.toolExposure };
  }
  if ("directTools" in patch && patch.directTools !== void 0) {
    if (!isDirectToolsSelection(patch.directTools)) {
      throw new Error("The MCP direct-tool selection is invalid.");
    }
    server.directTools = Array.isArray(patch.directTools) ? [...patch.directTools] : patch.directTools;
  }
  servers[serverName] = server;
}
function writeNativeMcpConfigPatch(path, serverName, patch, allowCreateOverride) {
  const parsed = readConfig(path);
  const serverKey = parsed.mcpServers === void 0 && parsed["mcp-servers"] !== void 0 ? "mcp-servers" : "mcpServers";
  const value = parsed[serverKey];
  if (value !== void 0 && !isRecord3(value)) {
    throw new Error("The MCP config server map cannot be updated safely.");
  }
  const servers = value === void 0 ? {} : { ...value };
  updateServer(servers, serverName, patch, allowCreateOverride);
  parsed[serverKey] = servers;
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryFileExists = false;
  try {
    mkdirSync(dirname3(path), { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}
`, { encoding: "utf8", flag: "wx", mode: 384 });
    temporaryFileExists = true;
    renameSync(temporaryPath, path);
    temporaryFileExists = false;
  } catch {
    if (temporaryFileExists) {
      try {
        unlinkSync(temporaryPath);
      } catch {
      }
    }
    throw new Error("The MCP config change could not be written safely.");
  }
}

// src/native/config-assembly.ts
var PROGRAMMATIC_SOURCE = "pi-mcp-adapter:programmatic-config";
function programmaticSource(config) {
  const source = {
    id: "adapter-config",
    label: "Pi MCP adapter programmatic config",
    readPath: PROGRAMMATIC_SOURCE,
    writePath: PROGRAMMATIC_SOURCE,
    kind: "extension",
    shared: false,
    scope: "extension"
  };
  const validated = validateMcpConfig(config);
  if (!validated.ok) return [{ source, config: null, error: validated.error }];
  return [{
    source,
    config: cloneMcpConfig(validated.value),
    ...validated.issues === void 0 ? {} : { validationIssues: validated.issues }
  }];
}
function nativeConfigSources(options, cwd) {
  if (options.config !== void 0) return programmaticSource(options.config);
  const baseSources = loadConfigSources(options.configPath ?? getConfigPathFromArgv(), cwd);
  if (isExclusiveConfigMode()) return baseSources;
  const basePlan = mapLoadedConfigSourcesToNative(baseSources);
  if (!basePlan.ok) return baseSources;
  const settings = getMergedSettingsFromSources(baseSources);
  const pluginSettingsScope = basePlan.value.settings.provenance.agentPluginPaths?.scope;
  const pluginSources = settings?.agentPluginPaths?.length && pluginSettingsScope && pluginSettingsScope !== "extension" ? loadAgentPluginConfigSources(settings.agentPluginPaths, cwd, { scope: pluginSettingsScope }) : [];
  const packageSources = loadPackageMcpConfigSources(cwd);
  return [
    ...packageSources,
    ...pluginSources,
    ...baseSources
  ];
}
function describeServerIssue(server) {
  if (server.deferredFields.length > 0) {
    return `An MCP server entry could not be imported because these fields are not supported by the native owner: ${server.deferredFields.join(", ")}.`;
  }
  if (server.blockingIssues.length > 0) {
    return server.blockingIssues.map((issue) => issue.message).join(" ");
  }
  return void 0;
}
function settingsWarnings(fields) {
  return fields.length === 0 ? [] : [`These adapter settings are retained in configuration but are not activated by the native MCP owner: ${fields.join(", ")}.`];
}
function mapNativeServer(server) {
  if (!server.connectable || !("command" in server.config || "url" in server.config || "socket" in server.config)) {
    return void 0;
  }
  return {
    name: server.name,
    config: server.config,
    executionPolicy: server.executionPolicy,
    source: server.provenance.sourcePath,
    scope: server.provenance.scope
  };
}
function createNativeConfigAssembly(options) {
  const provenanceByServer = /* @__PURE__ */ new Map();
  const managedServerNames = /* @__PURE__ */ new Set();
  let activeCwd = process.cwd();
  let panelConfiguration = { servers: /* @__PURE__ */ new Map() };
  const updatePanelConfiguration = (plan) => {
    const servers = /* @__PURE__ */ new Map();
    for (const server of plan.servers) {
      const config = server.config;
      servers.set(server.name, {
        ...config.directTools === void 0 ? {} : { directTools: Array.isArray(config.directTools) ? [...config.directTools] : config.directTools },
        includeTools: [...server.executionPolicy.includeTools ?? []],
        excludeTools: [...server.executionPolicy.excludeTools ?? []],
        exposeResources: server.executionPolicy.exposeResources !== false,
        ...server.executionPolicy.toolPrefix === void 0 ? {} : { toolPrefix: server.executionPolicy.toolPrefix },
        scope: server.provenance.scope
      });
    }
    const directToolsScope = plan.settings.provenance.directTools?.scope;
    const toolPrefixScope = plan.settings.provenance.toolPrefix?.scope;
    panelConfiguration = {
      ...plan.settings.directTools === void 0 ? {} : { directTools: plan.settings.directTools },
      ...directToolsScope === void 0 ? {} : { directToolsScope },
      ...plan.settings.toolPrefix === void 0 ? {} : { toolPrefix: plan.settings.toolPrefix },
      ...toolPrefixScope === void 0 ? {} : { toolPrefixScope },
      servers
    };
  };
  const assembly = {
    loadConfig: (context) => {
      activeCwd = context.cwd;
      let mapped2;
      try {
        mapped2 = mapLoadedConfigSourcesToNative(nativeConfigSources(options, context.cwd));
      } catch {
        provenanceByServer.clear();
        managedServerNames.clear();
        panelConfiguration = { servers: /* @__PURE__ */ new Map() };
        return { servers: [], errors: ["Adapter MCP configuration could not be loaded safely."] };
      }
      if (!mapped2.ok) {
        provenanceByServer.clear();
        managedServerNames.clear();
        panelConfiguration = { servers: /* @__PURE__ */ new Map() };
        return { servers: [], errors: [mapped2.error.message] };
      }
      const plan = mapped2.value;
      updatePanelConfiguration(plan);
      provenanceByServer.clear();
      managedServerNames.clear();
      const servers = [];
      const errors = settingsWarnings(plan.settings.deferredFields);
      for (const serverPlan of plan.servers) {
        provenanceByServer.set(serverPlan.name, serverPlan.provenance);
        managedServerNames.add(serverPlan.name);
        const issue = describeServerIssue(serverPlan);
        if (issue) errors.push(issue);
        const server = mapNativeServer(serverPlan);
        if (server) servers.push(server);
      }
      const projectConfig = context.isProjectTrusted() ? getProjectPiConfigPath(context.cwd) : void 0;
      return {
        servers,
        errors,
        ...plan.settings.idleTimeout === void 0 ? {} : { idleTimeout: plan.settings.idleTimeout },
        ...projectConfig === void 0 ? {} : { projectConfig }
      };
    },
    updateConfig: (entry, patch) => {
      const provenance = provenanceByServer.get(entry.name);
      if (!provenance || entry.scope === "extension" || entry.source !== provenance.sourcePath) {
        throw new Error("The MCP server's configuration provenance is no longer available.");
      }
      const projectOverridePath = getProjectPiConfigPath(activeCwd);
      const path = entry.override ?? provenance.writePath;
      if (entry.override !== void 0 && path !== projectOverridePath) {
        throw new Error("The MCP server's project override target is not authorized by its configuration provenance.");
      }
      const allowCreateOverride = path !== provenance.sourcePath;
      writeNativeMcpConfigPatch(path, entry.name, patch, allowCreateOverride);
    },
    credentialsBackend: createNativeMcpOAuthCredentialBackend(() => [...managedServerNames])
  };
  return {
    provenanceByServer,
    managedServerNames,
    assembly,
    getPanelConfiguration: (projectTrusted) => {
      const includeProjectConfiguration = projectTrusted === true;
      const directTools = panelConfiguration.directToolsScope === "project" && !includeProjectConfiguration ? void 0 : panelConfiguration.directTools;
      const toolPrefix = panelConfiguration.toolPrefixScope === "project" && !includeProjectConfiguration ? void 0 : panelConfiguration.toolPrefix;
      return {
        ...directTools === void 0 ? {} : { directTools },
        ...directTools === void 0 || panelConfiguration.directToolsScope === void 0 ? {} : { directToolsScope: panelConfiguration.directToolsScope },
        ...toolPrefix === void 0 ? {} : { toolPrefix },
        ...toolPrefix === void 0 || panelConfiguration.toolPrefixScope === void 0 ? {} : { toolPrefixScope: panelConfiguration.toolPrefixScope },
        servers: new Map([...panelConfiguration.servers].filter(([, server]) => includeProjectConfiguration || server.scope !== "project").map(([name, server]) => [name, {
          ...server,
          ...server.directTools === void 0 ? {} : { directTools: Array.isArray(server.directTools) ? [...server.directTools] : server.directTools },
          includeTools: [...server.includeTools],
          excludeTools: [...server.excludeTools]
        }]))
      };
    }
  };
}

// src/native/management-bridge.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
var REQUIRED_CAPABILITIES = [
  "server.snapshot",
  "server.subscribe",
  "server.enable",
  "server.disable",
  "server.reconnect",
  "server.set-exposure",
  "tool.set-exposure",
  "catalog.refresh",
  "catalog.resources",
  "catalog.prompts",
  "resource.read",
  "resource.read-app",
  "prompt.get",
  "app.call-tool",
  "oauth.sign-in",
  "oauth.sign-out",
  "server.set-direct-tools",
  "execution.set-policy"
];
var PROTOCOL_ID = "pi.mcp-management";
var PROTOCOL_VERSION = 1;
var DISCOVERY_EVENT = "pi:mcp-management:discover";
var AVAILABLE_EVENT = "pi:mcp-management:available";
var RESPONSE_EVENT_PREFIX = "pi:mcp-management:response:";
var DISCOVERY_TIMEOUT_MS = 750;
var MANAGEMENT_ERROR_CODES = /* @__PURE__ */ new Set([
  "invalid-request",
  "invalid-input",
  "unsupported-protocol",
  "unsupported-version",
  "missing-capabilities",
  "session-unavailable",
  "session-ended",
  "server-not-found",
  "server-disabled",
  "server-not-connected",
  "unsupported-tool-name",
  "resource-not-found",
  "resource-read-denied",
  "resource-read-approval-required",
  "prompt-not-found",
  "app-tool-not-found",
  "app-tool-denied",
  "app-tool-approval-required",
  "config-update-failed",
  "catalog-refresh-failed",
  "oauth-unavailable",
  "sign-in-cancelled",
  "authentication-failed",
  "sign-out-failed",
  "operation-failed"
]);
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getPublicExport(name) {
  return PiCodingAgent[name];
}
function failure(code, message) {
  return { ok: false, error: { code, message } };
}
function isStringArray2(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function getCapabilities(value) {
  if (!isStringArray2(value)) return void 0;
  const supported = getPublicExport("MCP_MANAGEMENT_CAPABILITIES");
  if (!isStringArray2(supported)) return void 0;
  const supportedCapabilities = new Set(supported);
  return value.filter((capability) => supportedCapabilities.has(capability));
}
function hasRequiredCapabilities(capabilities) {
  const offered = new Set(capabilities);
  return REQUIRED_CAPABILITIES.every((capability) => offered.has(capability));
}
function isManagementHandle(value) {
  if (!isRecord4(value)) return false;
  try {
    return value.protocolVersion === PROTOCOL_VERSION && isStringArray2(value.capabilities) && hasRequiredCapabilities(value.capabilities) && typeof value.snapshot === "function" && typeof value.subscribe === "function" && typeof value.setServerEnabled === "function" && typeof value.reconnectServer === "function" && typeof value.setServerExposure === "function" && typeof value.setToolExposure === "function" && typeof value.setDirectTools === "function" && typeof value.setExecutionPolicy === "function" && typeof value.refreshCatalog === "function" && typeof value.readResource === "function" && typeof value.readAppResource === "function" && typeof value.getPrompt === "function" && typeof value.callAppTool === "function" && typeof value.signIn === "function" && typeof value.signOut === "function";
  } catch {
    return false;
  }
}
function isManagementError(value) {
  if (!isRecord4(value)) return false;
  return typeof value.code === "string" && MANAGEMENT_ERROR_CODES.has(value.code) && typeof value.message === "string";
}
function parseDiscoveryResponse(value, requestId) {
  if (!isRecord4(value) || value.protocol !== PROTOCOL_ID || value.requestId !== requestId) {
    return failure("invalid-response", "Pi returned an invalid MCP management discovery response.");
  }
  if (value.version !== PROTOCOL_VERSION) {
    return failure("unsupported-version", "Pi returned an unsupported MCP management protocol version.");
  }
  const capabilities = getCapabilities(value.capabilities);
  if (!capabilities) {
    return failure("invalid-response", "Pi returned an invalid MCP management capability list.");
  }
  if (!hasRequiredCapabilities(capabilities)) {
    const missing = REQUIRED_CAPABILITIES.filter((capability) => !capabilities.includes(capability));
    return failure(
      "missing-capabilities",
      `Pi native MCP management is missing required capabilities: ${missing.join(", ")}. Install the patched Pi 1.2.0 API.`
    );
  }
  if (!isRecord4(value.result) || typeof value.result.ok !== "boolean") {
    return failure("invalid-response", "Pi returned an invalid MCP management result.");
  }
  if (!value.result.ok) {
    if (!isManagementError(value.result.error)) {
      return failure("invalid-response", "Pi returned an invalid MCP management error.");
    }
    return failure(value.result.error.code, value.result.error.message);
  }
  if (!isManagementHandle(value.result.value)) {
    return failure("invalid-response", "Pi returned an invalid MCP management handle.");
  }
  const handleCapabilities = getCapabilities(value.result.value.capabilities);
  if (!handleCapabilities || !hasRequiredCapabilities(handleCapabilities)) {
    return failure("missing-capabilities", "Pi's MCP management handle does not provide every required capability.");
  }
  return { ok: true, value: value.result.value };
}
function parseAvailability(value) {
  if (!isRecord4(value) || value.protocol !== PROTOCOL_ID || typeof value.available !== "boolean") return void 0;
  if (value.version !== PROTOCOL_VERSION) return void 0;
  const capabilities = getCapabilities(value.capabilities);
  if (!capabilities) return void 0;
  return { protocol: PROTOCOL_ID, version: PROTOCOL_VERSION, available: value.available, capabilities };
}
function getNativeManagementRuntime() {
  const protocolId = getPublicExport("MCP_MANAGEMENT_PROTOCOL_ID");
  const protocolVersion = getPublicExport("MCP_MANAGEMENT_PROTOCOL_VERSION");
  const discoveryEvent = getPublicExport("MCP_MANAGEMENT_DISCOVERY_EVENT");
  const availableEvent = getPublicExport("MCP_MANAGEMENT_AVAILABLE_EVENT");
  const responseEventPrefix = getPublicExport("MCP_MANAGEMENT_RESPONSE_EVENT_PREFIX");
  const supportedCapabilities = getPublicExport("MCP_MANAGEMENT_CAPABILITIES");
  const installAssembly = getPublicExport("installMcpOwnerAssembly");
  if (protocolId === void 0 || protocolVersion === void 0 || discoveryEvent === void 0 || availableEvent === void 0 || responseEventPrefix === void 0 || supportedCapabilities === void 0 || installAssembly === void 0) {
    return failure(
      "missing-public-api",
      "This Pi host does not expose the patched native MCP management API. Install the patched Pi 1.2.0 package; adapter runtime fallback is disabled."
    );
  }
  if (protocolId !== PROTOCOL_ID || protocolVersion !== PROTOCOL_VERSION || discoveryEvent !== DISCOVERY_EVENT || availableEvent !== AVAILABLE_EVENT || responseEventPrefix !== RESPONSE_EVENT_PREFIX || !isStringArray2(supportedCapabilities) || typeof installAssembly !== "function") {
    return failure("invalid-public-api", "The Pi host exposes an incompatible native MCP management API.");
  }
  const supported = new Set(supportedCapabilities);
  const missing = REQUIRED_CAPABILITIES.filter((capability) => !supported.has(capability));
  if (missing.length > 0) {
    return failure(
      "missing-capabilities",
      `Pi native MCP management is missing required capabilities: ${missing.join(", ")}.`
    );
  }
  return {
    ok: true,
    value: {
      protocolId: PROTOCOL_ID,
      protocolVersion: PROTOCOL_VERSION,
      discoveryEvent,
      availableEvent,
      responseEventPrefix,
      requiredCapabilities: REQUIRED_CAPABILITIES,
      installAssembly
    }
  };
}
function installNativeMcpOwnerAssembly(assembly, events) {
  const runtime = getNativeManagementRuntime();
  if (!runtime.ok) return runtime;
  const result = runtime.value.installAssembly(assembly, events);
  if (!result.ok) {
    return failure("invalid-public-api", result.error.message);
  }
  return { ok: true, value: result.value };
}
var NativeMcpManagementBridge = class {
  constructor(pi, onHandle, onSnapshot, onUnavailable) {
    this.pi = pi;
    this.onHandle = onHandle;
    this.onSnapshot = onSnapshot;
    this.onUnavailable = onUnavailable;
  }
  pi;
  onHandle;
  onSnapshot;
  onUnavailable;
  handle;
  pending;
  unsubscribeAvailability;
  unsubscribeHandle;
  cancelPending;
  generation = 0;
  startSession() {
    this.stopSession();
    const generation = ++this.generation;
    const runtime = getNativeManagementRuntime();
    if (!runtime.ok) {
      this.onUnavailable(runtime.error);
      return;
    }
    this.unsubscribeAvailability = this.pi.events.on(runtime.value.availableEvent, (event) => {
      const availability = parseAvailability(event);
      if (!availability) return;
      if (!availability.available) {
        this.clearHandle();
        this.onUnavailable({ code: "session-ended", message: "Pi native MCP management is no longer available in this session." });
        return;
      }
      if (this.handle) return;
      this.restartDiscovery(generation);
    });
    void this.discover(generation);
  }
  stopSession() {
    this.generation++;
    this.cancelPending?.();
    this.cancelPending = void 0;
    this.pending = void 0;
    this.unsubscribeAvailability?.();
    this.unsubscribeAvailability = void 0;
    this.clearHandle();
  }
  get currentHandle() {
    return this.handle;
  }
  async discoverCurrent() {
    const runtime = getNativeManagementRuntime();
    if (!runtime.ok) {
      this.onUnavailable(runtime.error);
      return runtime;
    }
    if (this.handle) return { ok: true, value: this.handle };
    return this.discover(this.generation);
  }
  clearHandle() {
    this.unsubscribeHandle?.();
    this.unsubscribeHandle = void 0;
    this.handle = void 0;
  }
  restartDiscovery(generation) {
    if (this.pending) {
      const cancel = this.cancelPending;
      this.pending = void 0;
      this.cancelPending = void 0;
      cancel?.();
    }
    void this.discover(generation);
  }
  discover(generation) {
    if (this.pending) return this.pending;
    const runtime = getNativeManagementRuntime();
    if (!runtime.ok) {
      this.onUnavailable(runtime.error);
      return Promise.resolve(runtime);
    }
    const result = this.requestHandle(runtime.value, generation);
    this.pending = result;
    void result.then((discovery) => {
      if (this.generation !== generation || this.pending !== result) return;
      this.pending = void 0;
      this.cancelPending = void 0;
      if (!discovery.ok) {
        this.onUnavailable(discovery.error);
        return;
      }
      this.clearHandle();
      this.handle = discovery.value;
      const subscribed = this.handle.subscribe((snapshot) => {
        if (this.generation !== generation || this.handle !== discovery.value) return;
        this.onSnapshot(snapshot);
      });
      if (!subscribed.ok) {
        this.handle = void 0;
        this.onUnavailable({ code: "invalid-response", message: subscribed.error.message });
        return;
      }
      this.unsubscribeHandle = subscribed.value;
      this.onHandle(discovery.value);
    });
    return result;
  }
  requestHandle(runtime, generation) {
    const requestId = randomUUID2();
    const channel = `${runtime.responseEventPrefix}${requestId}`;
    const request = {
      protocol: runtime.protocolId,
      version: runtime.protocolVersion,
      requestId,
      requiredCapabilities: runtime.requiredCapabilities
    };
    return new Promise((resolve3) => {
      let settled = false;
      const unsubscribe = this.pi.events.on(channel, (event) => {
        finish(parseDiscoveryResponse(event, requestId));
      });
      const timer = setTimeout(() => {
        finish(failure(
          "discovery-timeout",
          "No Pi native MCP owner responded to discovery. The adapter does not start a separate MCP runtime."
        ));
      }, DISCOVERY_TIMEOUT_MS);
      const cancel = () => finish(failure("session-ended", "The MCP management discovery session ended."));
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        if (this.cancelPending === cancel) this.cancelPending = void 0;
        resolve3(this.generation === generation ? result : failure("session-ended", "The MCP management session changed."));
      };
      this.cancelPending = cancel;
      this.pi.events.emit(runtime.discoveryEvent, request);
    });
  }
};

// src/native/extension.ts
var PROGRAMMATIC_SOURCE2 = "pi-mcp-adapter:programmatic-config";
var DISPOSE_TIMEOUT_MS = 5e3;
var adapters = /* @__PURE__ */ new WeakMap();
function mapRuntimeServer(name, definition) {
  const validated = validateServerEntry(name, definition, { requireTransport: true });
  if (!validated.ok) {
    throw new Error(`MCP server definition is invalid (${validated.error.code}): ${validated.error.message}`);
  }
  const source = {
    source: {
      id: "adapter-config",
      label: "Pi MCP adapter runtime registration",
      readPath: PROGRAMMATIC_SOURCE2,
      writePath: PROGRAMMATIC_SOURCE2,
      kind: "extension",
      shared: false,
      scope: "extension"
    },
    config: { mcpServers: { [name]: validated.value } }
  };
  const mapped2 = mapLoadedConfigSourcesToNative([source]);
  if (!mapped2.ok) throw new Error(`MCP server definition could not be mapped (${mapped2.error.code}).`);
  const server = mapped2.value.servers.find((entry) => entry.name === name);
  if (!server?.connectable || !("command" in server.config || "url" in server.config || "socket" in server.config)) {
    const fields = server?.deferredFields ?? [];
    const issues = server?.blockingIssues.map((issue) => issue.message) ?? [];
    const details = [...fields.length ? [`unsupported fields: ${fields.join(", ")}`] : [], ...issues].join(" ");
    throw new Error(details || "MCP server definition has no native transport.");
  }
  return { config: server.config, executionPolicy: server.executionPolicy };
}
function notify(state, message, level = "info") {
  if (state.context?.hasUI) state.context.ui.notify(message, level);
  else if (level === "error") console.error(`MCP adapter: ${message}`);
}
function runtimePolicies(state) {
  return new Map([...state.registrations].map(([name, registration]) => [name, registration.executionPolicy]));
}
function publishSnapshot(state, snapshot) {
  const previousHandle = state.handle;
  const handle = state.bridge.currentHandle;
  if (handle && previousHandle && previousHandle !== handle && state.panelView?.handle === previousHandle) {
    state.panelView.markUnavailable("The native MCP session changed; reopen the panel to edit the current session.");
  }
  if (handle) state.handle = handle;
  state.snapshot = snapshot;
  applyRuntimePolicies(state, snapshot);
  const status = publishNativeStatusSnapshot(
    state.pi,
    snapshot,
    state.configAssembly.getPanelConfiguration(state.context?.isProjectTrusted() === true),
    runtimePolicies(state)
  );
  if (state.context) updateNativeStatusBar(state.context, status);
  if (state.panelView && state.panelView.handle === handle) {
    state.panelView.update(snapshot, state.context?.isProjectTrusted());
  }
}
function formatSnapshot(state, snapshot) {
  if (snapshot.servers.length === 0) return "No native MCP servers are visible in this session.";
  const status = createNativeStatusSnapshot(
    snapshot,
    state.configAssembly.getPanelConfiguration(state.context?.isProjectTrusted() === true),
    runtimePolicies(state)
  );
  return snapshot.servers.map((server) => {
    const counts = status.servers.find((entry) => entry.name === server.name);
    const toolCount = counts?.toolCount ?? 0;
    const resourceCount = counts?.resourceCount;
    return `${server.name}: ${server.connectionStatus}; catalog ${server.catalog.freshness} (${toolCount} tools); resources ${server.catalog.resources.freshness}${resourceCount === void 0 ? "" : ` (${resourceCount})`}`;
  }).join("\n");
}
function applyRuntimePolicies(state, snapshot) {
  const handle = state.handle;
  if (!handle) return;
  for (const [name, registration] of state.registrations) {
    if (registration.appliedHandles.has(handle) || !snapshot.servers.some((server) => server.name === name)) continue;
    registration.appliedHandles.add(handle);
    void handle.setExecutionPolicy(name, registration.executionPolicy).then((result) => {
      if (result.ok || state.handle !== handle || state.registrations.get(name) !== registration) return;
      notify(state, `Native MCP policy for "${name}" was not applied: ${result.error.message}`, "error");
    });
  }
}
function installAdapter(pi, options) {
  const previous = adapters.get(pi);
  if (previous) return previous;
  const configAssembly = createNativeConfigAssembly(options);
  const assemblyResult = installNativeMcpOwnerAssembly(configAssembly.assembly, pi.events);
  let currentState;
  const bridge = new NativeMcpManagementBridge(
    pi,
    (handle) => {
      const state2 = currentState;
      if (!state2) return;
      state2.handle = handle;
      const snapshot = handle.snapshot();
      if (snapshot.ok) {
        publishSnapshot(state2, snapshot.value);
      } else {
        notify(state2, snapshot.error.message, "error");
      }
    },
    (snapshot) => {
      const state2 = currentState;
      if (!state2) return;
      publishSnapshot(state2, snapshot);
    },
    (error) => {
      const state2 = currentState;
      if (!state2) return;
      if (error.code === "session-ended") {
        const panelView = state2.panelView;
        if (panelView && panelView.handle === state2.handle) panelView.markUnavailable(error.message);
        state2.handle = void 0;
        state2.snapshot = void 0;
      }
      if (error.code !== "discovery-timeout") notify(state2, error.message, "error");
    }
  );
  const state = {
    pi,
    configAssembly,
    bridge,
    registrations: /* @__PURE__ */ new Map(),
    handle: void 0,
    snapshot: void 0,
    panelView: void 0,
    context: void 0,
    ...assemblyResult.ok ? {} : { assemblyInstallError: assemblyResult.error }
  };
  currentState = state;
  adapters.set(pi, state);
  pi.on("session_start", (_event, context) => {
    const panelView = state.panelView;
    if (panelView && panelView.handle === state.handle) {
      panelView.markUnavailable("The native MCP session changed; reopen the panel to edit the current session.");
    }
    state.handle = void 0;
    state.snapshot = void 0;
    publishNativeStatusShutdown(pi);
    clearNativeStatusBar(context);
    state.context = context;
    if (state.assemblyInstallError) {
      notify(state, state.assemblyInstallError.message, "error");
      return;
    }
    state.bridge.startSession();
  });
  pi.on("session_shutdown", () => {
    const panelView = state.panelView;
    if (panelView && panelView.handle === state.handle) {
      panelView.markUnavailable("The native MCP session has ended; panel changes are no longer saved.");
    }
    state.bridge.stopSession();
    state.handle = void 0;
    state.snapshot = void 0;
    publishNativeStatusShutdown(pi);
    if (state.context) clearNativeStatusBar(state.context);
    state.context = void 0;
  });
  pi.registerCommand("mcp-adapter", {
    description: "Show native MCP status managed by pi-mcp-adapter",
    handler: async (_args, context) => {
      state.context = context;
      if (state.assemblyInstallError) {
        notify(state, state.assemblyInstallError.message, "error");
        return;
      }
      const discovered = await state.bridge.discoverCurrent();
      if (!discovered.ok) {
        notify(state, discovered.error.message, "error");
        return;
      }
      const snapshot = discovered.value.snapshot();
      if (!snapshot.ok) {
        notify(state, snapshot.error.message, "error");
        return;
      }
      state.handle = discovered.value;
      publishSnapshot(state, snapshot.value);
      if (context.mode !== "tui") {
        const trustNotice = context.isProjectTrusted() ? void 0 : "Project MCP sources are omitted until Pi project trust is granted.";
        notify(state, [trustNotice, formatSnapshot(state, snapshot.value)].filter(Boolean).join("\n"));
        return;
      }
      await openNativeMcpPanel({
        pi,
        context,
        handle: discovered.value,
        getCurrentHandle: () => state.handle,
        getCurrentSnapshot: () => state.snapshot,
        getProjectTrust: () => context.isProjectTrusted(),
        configAssembly: state.configAssembly,
        getRuntimePolicies: () => runtimePolicies(state),
        setPanelView: (view) => {
          if (view !== void 0 || state.panelView?.handle === discovered.value) state.panelView = view;
        }
      });
    }
  });
  if (!state.assemblyInstallError) state.bridge.startSession();
  else notify(state, state.assemblyInstallError.message, "error");
  return state;
}
function createMcpAdapter(options = {}) {
  const factoryOptions = {
    ...options.config === void 0 ? {} : { config: cloneMcpConfig(options.config) },
    ...options.configPath === void 0 ? {} : { configPath: options.configPath }
  };
  return (pi) => {
    installAdapter(pi, factoryOptions);
  };
}
function waitForServerRemoval(handle, name) {
  const current = handle.snapshot();
  if (!current.ok || !current.value.servers.some((server) => server.name === name)) return Promise.resolve();
  return new Promise((resolve3, reject) => {
    let finished = false;
    let unsubscribe;
    const timer = setTimeout(() => finish(new Error(`Native MCP owner did not retract server "${name}" before timeout.`)), DISPOSE_TIMEOUT_MS);
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      unsubscribe?.();
      if (error) reject(error);
      else resolve3();
    };
    const subscription = handle.subscribe((snapshot) => {
      if (!snapshot.servers.some((server) => server.name === name)) finish();
    });
    if (!subscription.ok) {
      finish(new Error(subscription.error.message));
      return;
    }
    unsubscribe = subscription.value;
    if (finished) unsubscribe();
  });
}
function registerMcpServer(options) {
  const { pi, name, definition } = options;
  const state = adapters.get(pi);
  if (!state) throw new Error("pi-mcp-adapter is not installed for this Pi instance");
  if (state.assemblyInstallError) throw new Error(state.assemblyInstallError.message);
  if (typeof name !== "string" || name.trim() === "") throw new Error("MCP server name must be a non-empty string");
  if (state.registrations.has(name) || state.configAssembly.managedServerNames.has(name)) {
    throw new Error(`MCP server "${name}" is already registered`);
  }
  if (pi.getMcpServers().some((server) => server.name === name)) {
    throw new Error(`MCP server "${name}" is already registered`);
  }
  const mapped2 = mapRuntimeServer(name, definition);
  const registration = {
    executionPolicy: mapped2.executionPolicy,
    appliedHandles: /* @__PURE__ */ new WeakSet()
  };
  pi.registerMcpServer(name, mapped2.config);
  state.registrations.set(name, registration);
  if (state.snapshot) applyRuntimePolicies(state, state.snapshot);
  let disposal;
  return {
    dispose: () => {
      if (disposal) return disposal;
      disposal = (async () => {
        const handle = state.handle;
        const removal = handle ? waitForServerRemoval(handle, name) : Promise.resolve();
        try {
          pi.unregisterMcpServer(name);
        } catch (error) {
          void removal.catch(() => void 0);
          throw error;
        }
        state.registrations.delete(name);
        await removal;
      })();
      return disposal;
    }
  };
}
var extension_default = createMcpAdapter();
export {
  MCP_STATUS_EVENT,
  MCP_STATUS_SNAPSHOT_VERSION,
  MCP_TOOL_APPROVAL_REQUEST_EVENT,
  createMcpAdapter,
  extension_default as default,
  namespaceProxyName,
  parseMcpReference,
  registerMcpServer,
  resolveMcpToolReferences
};
