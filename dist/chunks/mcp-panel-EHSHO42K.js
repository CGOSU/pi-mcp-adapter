import {
  getToolNameCandidates,
  isServerCacheValid,
  isServerDisabled,
  isToolAllowed,
  isUiToolVisibleToModel,
  resolveToolPrefix,
  resourceNameToToolName,
  sanitizeTerminalText,
  stripOscSequences
} from "./chunk-YANXOPYG.js";

// src/ui/mcp-panel.ts
import { matchesKey as matchesKey2, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";

// src/ui/panel-keys.ts
import { matchesKey } from "@earendil-works/pi-tui";
function configuredSaveKeys(keybindings) {
  const explicit = keybindings?.getUserBindings?.()["mcp.panel.save"];
  if (explicit !== void 0) return { keys: Array.isArray(explicit) ? explicit : [explicit], configured: true };
  return { keys: [], configured: false };
}
function createPanelKeys(keybindings) {
  const saveBinding = configuredSaveKeys(keybindings);
  if (keybindings) {
    return {
      selectUp: (data) => keybindings.matches(data, "tui.select.up"),
      selectDown: (data) => keybindings.matches(data, "tui.select.down"),
      selectConfirm: (data) => keybindings.matches(data, "tui.select.confirm"),
      save: (data) => saveBinding.keys.length > 0 ? saveBinding.keys.some((key) => matchesKey(data, key)) : !saveBinding.configured && matchesKey(data, "ctrl+s"),
      saveLabel: () => saveBinding.keys[0] ?? (saveBinding.configured ? null : "ctrl+s")
    };
  }
  return {
    selectUp: (data) => matchesKey(data, "up"),
    selectDown: (data) => matchesKey(data, "down"),
    selectConfirm: (data) => matchesKey(data, "return"),
    save: (data) => matchesKey(data, "ctrl+s"),
    saveLabel: () => "ctrl+s"
  };
}

// src/ui/mcp-panel.ts
var DEFAULT_THEME = {
  border: "2",
  title: "2",
  selected: "36",
  direct: "32",
  needsAuth: "33",
  placeholder: "2;3",
  description: "2",
  hint: "2",
  confirm: "32",
  cancel: "31"
};
function fg(code, text) {
  if (!code) return text;
  return `\x1B[${code}m${text}\x1B[0m`;
}
var RAINBOW_COLORS = [
  "38;2;178;129;214",
  "38;2;215;135;175",
  "38;2;254;188;56",
  "38;2;228;192;15",
  "38;2;137;210;129",
  "38;2;0;175;175",
  "38;2;23;143;185"
];
function rainbowProgress(filled, total) {
  const dots = [];
  for (let i = 0; i < total; i++) {
    const color = RAINBOW_COLORS[i % RAINBOW_COLORS.length];
    if (!color) continue;
    dots.push(fg(color, i < filled ? "\u25CF" : "\u25CB"));
  }
  return dots.join(" ");
}
function fuzzyScore(query, text) {
  const lq = query.toLowerCase();
  const lt = text.toLowerCase();
  if (lt.includes(lq)) return 100 + lq.length / lt.length * 50;
  let score = 0;
  let qi = 0;
  let consecutive = 0;
  for (let i = 0; i < lt.length && qi < lq.length; i++) {
    if (lt[i] === lq[qi]) {
      score += 10 + consecutive;
      consecutive += 5;
      qi++;
    } else {
      consecutive = 0;
    }
  }
  return qi === lq.length ? score : 0;
}
function sanitizeDisplayText(text) {
  return sanitizeTerminalText(text ?? "");
}
function sanitizeRowContent(content) {
  const withoutOsc = stripOscSequences(content);
  let result = "";
  let pendingSpace = false;
  for (let i = 0; i < withoutOsc.length; i++) {
    const rest = withoutOsc.slice(i);
    const ansi = rest.match(/^(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_])/);
    if (ansi) {
      result += ansi[0];
      i += ansi[0].length - 1;
      continue;
    }
    const code = withoutOsc.charCodeAt(i);
    if (code <= 31 || code === 127 || code >= 128 && code <= 159) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && result && !result.endsWith(" ")) {
      result += " ";
    }
    pendingSpace = false;
    result += withoutOsc[i];
  }
  return result;
}
function estimateTokens(tool) {
  const schemaLen = JSON.stringify(tool.inputSchema ?? {}).length;
  const descLen = tool.description?.length ?? 0;
  return Math.ceil((tool.name.length + descLen + schemaLen) / 4) + 10;
}
var McpPanel = class _McpPanel {
  constructor(config, cache, provenance, callbacks, tui, done, options = {}) {
    this.config = config;
    this.cache = cache;
    this.provenance = provenance;
    this.callbacks = callbacks;
    this.done = done;
    this.tui = tui;
    this.baseNoticeLines = options.noticeLines ?? [];
    this.projectUntrusted = options.projectTrusted === false;
    this.noticeLines = this.composeNoticeLines();
    this.authOnly = options.authOnly === true;
    this.keys = createPanelKeys(options.keybindings);
    this.prefix = config.settings?.toolPrefix ?? "server";
    this.nativeDetails = options.nativeDetails;
    this.showTokenEstimate = options.showTokenEstimate !== false;
    this.loadServers();
    this.rebuildVisibleItems();
    this.resetInactivityTimeout();
  }
  config;
  cache;
  provenance;
  callbacks;
  done;
  noticeLines;
  baseNoticeLines;
  projectUntrusted = false;
  prefix;
  servers = [];
  cursorIndex = 0;
  nameQuery = "";
  descSearchActive = false;
  descQuery = "";
  dirty = false;
  confirmingDiscard = false;
  discardSelected = 1;
  authNotice = null;
  authInFlight = null;
  inactivityTimeout = null;
  visibleItems = [];
  tui;
  t = DEFAULT_THEME;
  authOnly;
  keys;
  nativeDetails;
  showTokenEstimate;
  nativeUnavailable = false;
  static MAX_VISIBLE = 12;
  static INACTIVITY_MS = 6e4;
  loadServers(previousServers = /* @__PURE__ */ new Map()) {
    this.servers = [];
    for (const [serverName, definition] of Object.entries(this.config.mcpServers)) {
      if (this.authOnly && !this.callbacks.canAuthenticate(serverName)) continue;
      const previous = previousServers.get(serverName);
      const previousTools = new Map(previous?.tools.map((tool) => [tool.name, tool]));
      const cachedEntry = this.cache?.servers?.[serverName];
      const serverCache = cachedEntry && isServerCacheValid(cachedEntry, definition) ? cachedEntry : void 0;
      const globalDirect = this.config.settings?.directTools;
      let directSelection = false;
      if (definition.directTools !== void 0) {
        directSelection = definition.directTools;
      } else if (globalDirect) {
        directSelection = globalDirect;
      }
      const toolFilter = previous?.wholeSelectionOverride ?? directSelection;
      const tools = [];
      if (serverCache && !this.authOnly && !isServerDisabled(definition)) {
        for (const tool of serverCache.tools ?? []) {
          if (!isUiToolVisibleToModel(tool.uiVisibility)) continue;
          if (!isToolAllowed(tool.name, serverName, this.prefix, definition.includeTools, definition.excludeTools, this.getOtherCurrentCandidates(serverName, definition, serverCache, tool.name))) {
            continue;
          }
          const selectedByDraft = toolFilter === true || Array.isArray(toolFilter) && toolFilter.includes(tool.name);
          const wasDirect = directSelection === true || Array.isArray(directSelection) && directSelection.includes(tool.name);
          const previousTool = previousTools.get(tool.name);
          const isDirect = previousTool && previousTool.isDirect !== previousTool.wasDirect ? previousTool.isDirect : selectedByDraft;
          const effectiveExposure = this.nativeDetails?.get(serverName)?.toolExposures.get(tool.name);
          tools.push({
            name: tool.name,
            description: tool.description ?? "",
            isDirect,
            wasDirect,
            estimatedTokens: this.showTokenEstimate ? estimateTokens(tool) : 0,
            ...effectiveExposure === void 0 ? {} : { effectiveExposure }
          });
        }
        if (definition.exposeResources !== false) {
          for (const resource of serverCache.resources ?? []) {
            const baseName = `read_${resourceNameToToolName(resource.name)}`;
            if (!isToolAllowed(baseName, serverName, this.prefix, definition.includeTools, definition.excludeTools, this.getOtherCurrentCandidates(serverName, definition, serverCache, baseName))) {
              continue;
            }
            const selectedByDraft = toolFilter === true || Array.isArray(toolFilter) && toolFilter.includes(baseName);
            const wasDirect = directSelection === true || Array.isArray(directSelection) && directSelection.includes(baseName);
            const previousTool = previousTools.get(baseName);
            const isDirect = previousTool && previousTool.isDirect !== previousTool.wasDirect ? previousTool.isDirect : selectedByDraft;
            const ct = {
              name: baseName,
              ...resource.description !== void 0 ? { description: resource.description } : {}
            };
            tools.push({
              name: baseName,
              description: resource.description ?? `Read resource: ${resource.uri}`,
              isDirect,
              wasDirect,
              estimatedTokens: this.showTokenEstimate ? estimateTokens(ct) : 0
            });
          }
        }
      }
      const representedNames = new Set(tools.map((tool) => tool.name));
      const availableNames = [
        ...(serverCache?.tools ?? []).map((tool) => tool.name),
        ...definition.exposeResources === false ? [] : (serverCache?.resources ?? []).map((resource) => `read_${resourceNameToToolName(resource.name)}`)
      ];
      const persistedNames = Array.isArray(directSelection) ? directSelection : directSelection === true ? availableNames : [];
      const unrepresentedDirectTools = [...new Set(persistedNames.filter((name) => !representedNames.has(name)))];
      const detail = this.nativeDetails?.get(serverName);
      for (const tool of tools) {
        const previousTool = previousTools.get(tool.name);
        if (previousTool && previousTool.isDirect !== previousTool.wasDirect) tool.isDirect = previousTool.isDirect;
        const effectiveExposure = detail?.toolExposures.get(tool.name);
        if (effectiveExposure !== void 0) tool.effectiveExposure = effectiveExposure;
      }
      const resources = detail?.resources ?? [];
      const status = this.callbacks.getConnectionStatus(serverName);
      const failureMessage = this.callbacks.getFailureMessage?.(serverName) ?? null;
      let directCount = 0;
      let directTokens = 0;
      for (const tool of tools) {
        if (!tool.isDirect) continue;
        directCount++;
        directTokens += tool.estimatedTokens;
      }
      this.servers.push({
        name: serverName,
        expanded: previous?.expanded ?? false,
        ...definition.includeTools !== void 0 ? { includeTools: definition.includeTools } : {},
        ...definition.excludeTools !== void 0 ? { excludeTools: definition.excludeTools } : {},
        exposeResources: definition.exposeResources !== false,
        directSelection: Array.isArray(directSelection) ? [...directSelection] : directSelection,
        ...previous?.wholeSelectionOverride === void 0 ? {} : { wholeSelectionOverride: previous.wholeSelectionOverride },
        connectionStatus: status,
        failureMessage,
        tools,
        resources: [...resources],
        unrepresentedDirectTools,
        directCount,
        directTokens,
        hasCachedData: detail ? detail.catalogFreshness !== "missing" : !!serverCache,
        ...detail === void 0 ? {} : {
          catalogFreshness: detail.catalogFreshness,
          resourceFreshness: detail.resourceFreshness,
          sourceScope: detail.scope
        }
      });
    }
  }
  composeNoticeLines() {
    return [
      ...this.baseNoticeLines,
      ...this.projectUntrusted ? ["Project MCP sources are omitted until Pi project trust is granted."] : []
    ];
  }
  updateProjectTrust(projectTrusted) {
    if (projectTrusted === void 0 || this.projectUntrusted === !projectTrusted) return;
    this.projectUntrusted = !projectTrusted;
    this.noticeLines = this.composeNoticeLines();
    this.tui.requestRender();
  }
  updateNativeData(config, cache, nativeDetails) {
    const previousServers = new Map(this.servers.map((server) => [server.name, server]));
    this.config = config;
    this.cache = cache;
    this.nativeDetails = nativeDetails;
    this.prefix = config.settings?.toolPrefix ?? "server";
    this.loadServers(previousServers);
    this.rebuildVisibleItems();
    this.updateDirty();
    this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
    this.tui.requestRender();
  }
  markNativeUnavailable(message) {
    if (this.nativeUnavailable) return;
    this.nativeUnavailable = true;
    this.authNotice = message;
    this.noticeLines = [...this.noticeLines, message];
    for (const server of this.servers) {
      if (server.connectionStatus !== "disabled") server.connectionStatus = "idle";
      if (server.catalogFreshness === "live") server.catalogFreshness = "cached";
      if (server.resourceFreshness === "live") server.resourceFreshness = "cached";
    }
    this.tui.requestRender();
  }
  resetInactivityTimeout() {
    if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
    this.inactivityTimeout = setTimeout(() => {
      this.cleanup();
      this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
    }, _McpPanel.INACTIVITY_MS);
  }
  cleanup() {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }
  }
  rebuildVisibleItems() {
    const query = this.descSearchActive ? this.descQuery : this.nameQuery;
    const mode = this.descSearchActive ? "desc" : "name";
    this.visibleItems = [];
    for (let si = 0; si < this.servers.length; si++) {
      const server = this.servers[si];
      if (!server) continue;
      if (query && this.authOnly) {
        const score = mode === "name" ? fuzzyScore(query, server.name) : 0;
        if (score > 0) {
          this.visibleItems.push({ type: "server", serverIndex: si });
        }
        continue;
      }
      this.visibleItems.push({ type: "server", serverIndex: si });
      if (server.expanded || query) {
        for (let ti = 0; ti < server.tools.length; ti++) {
          const tool = server.tools[ti];
          if (!tool) continue;
          if (query) {
            const score = mode === "name" ? Math.max(
              fuzzyScore(query, tool.name),
              fuzzyScore(query, server.name) * 0.6
            ) : fuzzyScore(query, tool.description);
            if (score === 0) continue;
          }
          this.visibleItems.push({ type: "tool", serverIndex: si, toolIndex: ti });
        }
        for (let ri = 0; ri < server.resources.length; ri++) {
          const resource = server.resources[ri];
          if (!resource) continue;
          if (query) {
            const resourceName = resource.title ?? resource.name;
            const score = mode === "name" ? Math.max(fuzzyScore(query, resourceName), fuzzyScore(query, server.name) * 0.6) : fuzzyScore(query, resource.description ?? resourceName);
            if (score === 0) continue;
          }
          this.visibleItems.push({ type: "resource", serverIndex: si, resourceIndex: ri });
        }
      }
    }
    if (query && !this.authOnly) {
      this.visibleItems = this.visibleItems.filter((item) => {
        if (item.type === "server") {
          return this.visibleItems.some(
            (other) => other.serverIndex === item.serverIndex && other.type !== "server"
          );
        }
        return true;
      });
    }
  }
  updateDirty() {
    this.dirty = this.servers.some(
      (server) => server.tools.some((tool) => tool.isDirect !== tool.wasDirect) || server.wholeSelectionOverride !== void 0 && !(typeof server.directSelection === "boolean" && server.directSelection === server.wholeSelectionOverride)
    );
  }
  buildResult() {
    const changes = /* @__PURE__ */ new Map();
    for (const server of this.servers) {
      const toolsChanged = server.tools.some((tool) => tool.isDirect !== tool.wasDirect);
      const overrideChanged = server.wholeSelectionOverride !== void 0 && !(typeof server.directSelection === "boolean" && server.directSelection === server.wholeSelectionOverride);
      if (!toolsChanged && !overrideChanged) continue;
      if (overrideChanged) {
        changes.set(server.name, server.wholeSelectionOverride ?? false);
        continue;
      }
      const directTools = [
        ...server.tools.filter((t) => t.isDirect).map((tool) => tool.name),
        ...server.unrepresentedDirectTools
      ];
      if (directTools.length === server.tools.length && server.tools.length > 0 && server.unrepresentedDirectTools.length === 0) {
        changes.set(server.name, true);
      } else if (directTools.length === 0) {
        changes.set(server.name, false);
      } else {
        changes.set(server.name, directTools);
      }
    }
    return { changes, cancelled: false };
  }
  handleInput(data) {
    this.resetInactivityTimeout();
    if (!this.authInFlight) this.authNotice = null;
    if (this.confirmingDiscard) {
      this.handleDiscardInput(data);
      return;
    }
    if (matchesKey2(data, "ctrl+c")) {
      this.cleanup();
      this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
      return;
    }
    if (this.nativeUnavailable) {
      if (matchesKey2(data, "escape")) {
        this.cleanup();
        this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
      }
      return;
    }
    if (this.keys.save(data)) {
      this.cleanup();
      this.done(this.buildResult());
      return;
    }
    if (this.descSearchActive) {
      if (matchesKey2(data, "escape") || this.keys.selectConfirm(data)) {
        this.descSearchActive = false;
        this.descQuery = "";
        this.rebuildVisibleItems();
        this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
        return;
      }
      if (matchesKey2(data, "backspace")) {
        if (this.descQuery.length > 0) {
          this.descQuery = this.descQuery.slice(0, -1);
          this.rebuildVisibleItems();
          this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
        }
        return;
      }
      if (this.keys.selectUp(data)) {
        this.moveCursor(-1);
        return;
      }
      if (this.keys.selectDown(data)) {
        this.moveCursor(1);
        return;
      }
      if (matchesKey2(data, "space")) {
        const item = this.visibleItems[this.cursorIndex];
        if (item) this.toggleItem(item);
        return;
      }
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        this.descQuery += data;
        this.rebuildVisibleItems();
        this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
        return;
      }
      return;
    }
    if (matchesKey2(data, "escape")) {
      if (this.nameQuery) {
        this.nameQuery = "";
        this.rebuildVisibleItems();
        this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
        return;
      }
      if (this.dirty) {
        this.confirmingDiscard = true;
        this.discardSelected = 1;
        return;
      }
      this.cleanup();
      this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
      return;
    }
    if (this.keys.selectUp(data)) {
      this.moveCursor(-1);
      return;
    }
    if (this.keys.selectDown(data)) {
      this.moveCursor(1);
      return;
    }
    if (matchesKey2(data, "space")) {
      const item = this.visibleItems[this.cursorIndex];
      if (item && !this.authOnly) this.toggleItem(item);
      return;
    }
    if (this.keys.selectConfirm(data)) {
      const item = this.visibleItems[this.cursorIndex];
      if (!item) return;
      const server = this.servers[item.serverIndex];
      if (!server) return;
      if (item.type === "server") {
        if (server.connectionStatus === "disabled") return;
        if (this.authOnly || server.connectionStatus === "needs-auth") {
          this.authenticateServer(server);
          return;
        }
        server.expanded = !server.expanded;
        this.rebuildVisibleItems();
        this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
      } else if (item.toolIndex !== void 0) {
        const tool = server.tools[item.toolIndex];
        if (!tool) return;
        this.toggleToolDirect(server, tool);
        this.updateDirty();
      }
      return;
    }
    if (matchesKey2(data, "ctrl+a")) {
      const item = this.visibleItems[this.cursorIndex];
      if (item) this.authenticateSelectedServer(item);
      return;
    }
    if (matchesKey2(data, "ctrl+r")) {
      const item = this.visibleItems[this.cursorIndex];
      if (!item) return;
      const server = this.servers[item.serverIndex];
      if (server) this.reconnectServer(server);
      return;
    }
    if (matchesKey2(data, "ctrl+y")) {
      const item = this.visibleItems[this.cursorIndex];
      if (!item) return;
      const server = this.servers[item.serverIndex];
      if (!server || server.connectionStatus !== "failed" || !server.failureMessage) return;
      const serverName = sanitizeDisplayText(server.name);
      const failureMessage = sanitizeDisplayText(server.failureMessage);
      copyToClipboard(failureMessage).then(() => {
        this.authNotice = `Copied error for ${serverName} to clipboard`;
        this.tui.requestRender();
      }).catch((error) => {
        const message = sanitizeDisplayText(error instanceof Error ? error.message : String(error));
        this.authNotice = `Failed to copy error for ${serverName}: ${message}`;
        this.tui.requestRender();
      });
      return;
    }
    if (data === "?") {
      if (this.authOnly) return;
      this.descSearchActive = true;
      this.descQuery = "";
      this.rebuildVisibleItems();
      this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
      return;
    }
    if (matchesKey2(data, "backspace")) {
      if (this.nameQuery.length > 0) {
        this.nameQuery = this.nameQuery.slice(0, -1);
        this.rebuildVisibleItems();
        this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
      }
      return;
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.nameQuery += data;
      this.rebuildVisibleItems();
      this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
      return;
    }
  }
  authenticateSelectedServer(item) {
    const server = this.servers[item.serverIndex];
    if (server) this.authenticateServer(server);
  }
  authenticateServer(server) {
    if (this.authInFlight) return;
    if (server.connectionStatus === "connecting" || server.connectionStatus === "disabled") return;
    const serverName = sanitizeDisplayText(server.name);
    if (!this.callbacks.canAuthenticate(server.name)) {
      this.authNotice = `${serverName} does not use OAuth authentication.`;
      return;
    }
    this.authInFlight = server.name;
    this.authNotice = `Authenticating ${serverName}...`;
    this.tui.requestRender();
    this.callbacks.authenticate(server.name).then((result) => {
      server.connectionStatus = this.callbacks.getConnectionStatus(server.name);
      if (result.ok) {
        this.authNotice = `OAuth finished for ${serverName}. Reconnecting...`;
        this.authInFlight = null;
        this.tui.requestRender();
        this.reconnectServer(server, { afterAuth: true });
        return;
      }
      const message = sanitizeDisplayText(result.message);
      this.authNotice = `OAuth failed for ${serverName}${message ? `: ${message}` : ". Check the notification for details."}`;
      this.authInFlight = null;
      this.tui.requestRender();
    }).catch((error) => {
      const message = sanitizeDisplayText(error instanceof Error ? error.message : String(error));
      server.connectionStatus = this.callbacks.getConnectionStatus(server.name);
      this.authNotice = `OAuth failed for ${serverName}: ${message}`;
      this.authInFlight = null;
      this.tui.requestRender();
    });
  }
  reconnectServer(server, options = {}) {
    if (server.connectionStatus === "connecting" || server.connectionStatus === "disabled") return;
    const serverName = sanitizeDisplayText(server.name);
    server.connectionStatus = "connecting";
    this.tui.requestRender();
    this.callbacks.reconnect(server.name).then((connected) => {
      server.connectionStatus = this.callbacks.getConnectionStatus(server.name);
      server.failureMessage = this.callbacks.getFailureMessage?.(server.name) ?? null;
      if (server.connectionStatus === "connected") {
        const entry = this.callbacks.refreshCacheAfterReconnect(server.name);
        if (entry) {
          this.cache ??= { version: 1, servers: {} };
          this.cache.servers[server.name] = entry;
          this.rebuildServerTools(server, entry);
          server.hasCachedData = true;
        }
      }
      if (options.afterAuth) {
        this.authNotice = connected && server.connectionStatus === "connected" ? `OAuth finished for ${serverName}. Reconnected.` : `OAuth finished for ${serverName}, but reconnect did not complete. Press ctrl+r to retry.`;
      }
      this.tui.requestRender();
    }).catch((error) => {
      server.connectionStatus = "failed";
      const message = sanitizeDisplayText(error instanceof Error ? error.message : String(error));
      this.authNotice = `Reconnect failed for ${serverName}: ${message}`;
      this.tui.requestRender();
    });
  }
  toggleItem(item) {
    if (this.authOnly) return;
    const server = this.servers[item.serverIndex];
    if (!server) return;
    if (item.type === "server") {
      const newState = !server.tools.every((t) => t.isDirect);
      if (newState) delete server.wholeSelectionOverride;
      else server.wholeSelectionOverride = false;
      let directTokens = 0;
      for (const tool of server.tools) {
        tool.isDirect = newState;
        if (newState) directTokens += tool.estimatedTokens;
      }
      server.directCount = newState ? server.tools.length : 0;
      server.directTokens = directTokens;
    } else if (item.toolIndex !== void 0) {
      const tool = server.tools[item.toolIndex];
      if (!tool) return;
      this.toggleToolDirect(server, tool);
    }
    this.updateDirty();
  }
  toggleToolDirect(server, tool) {
    delete server.wholeSelectionOverride;
    tool.isDirect = !tool.isDirect;
    server.directCount += tool.isDirect ? 1 : -1;
    server.directTokens += tool.isDirect ? tool.estimatedTokens : -tool.estimatedTokens;
  }
  handleDiscardInput(data) {
    if (matchesKey2(data, "ctrl+c")) {
      this.cleanup();
      this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
      return;
    }
    if (matchesKey2(data, "escape") || data === "n" || data === "N") {
      this.confirmingDiscard = false;
      return;
    }
    if (this.keys.selectConfirm(data)) {
      this.cleanup();
      if (this.discardSelected === 0) {
        this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
      } else {
        this.done(this.buildResult());
      }
      return;
    }
    if (data === "y" || data === "Y") {
      this.cleanup();
      this.done({ cancelled: true, changes: /* @__PURE__ */ new Map() });
      return;
    }
    if (matchesKey2(data, "left") || matchesKey2(data, "right") || matchesKey2(data, "tab")) {
      this.discardSelected = this.discardSelected === 0 ? 1 : 0;
    }
  }
  moveCursor(delta) {
    if (this.visibleItems.length === 0) return;
    this.cursorIndex = Math.max(0, Math.min(this.visibleItems.length - 1, this.cursorIndex + delta));
  }
  getOtherCurrentCandidates(serverName, definition, currentEntry, toolName) {
    const candidates = /* @__PURE__ */ new Set();
    for (const [otherServerName, otherDefinition] of Object.entries(this.config.mcpServers)) {
      if (isServerDisabled(otherDefinition)) continue;
      const cachedEntry = this.cache?.servers?.[otherServerName];
      const entry = otherServerName === serverName ? currentEntry : cachedEntry && isServerCacheValid(cachedEntry, otherDefinition) ? cachedEntry : void 0;
      const nativeResources = this.nativeDetails?.get(otherServerName)?.resources.filter((resource) => resource.kind !== "template");
      if (!entry && !nativeResources) continue;
      const otherPrefix = resolveToolPrefix(otherDefinition, this.prefix);
      for (const tool of entry?.tools ?? []) {
        if (!isUiToolVisibleToModel(tool.uiVisibility)) continue;
        for (const candidate of getToolNameCandidates(tool.name, otherServerName, otherPrefix, false)) candidates.add(candidate);
      }
      if (otherDefinition.exposeResources !== false) {
        const resources = nativeResources ?? entry?.resources ?? [];
        for (const resource of resources) {
          const baseName = `read_${resourceNameToToolName(resource.name)}`;
          for (const candidate of getToolNameCandidates(baseName, otherServerName, otherPrefix, false)) candidates.add(candidate);
        }
      }
    }
    for (const candidate of getToolNameCandidates(toolName, serverName, resolveToolPrefix(definition, this.prefix), false)) candidates.delete(candidate);
    return candidates;
  }
  rebuildServerTools(server, entry) {
    const existingState = new Map(server.tools.map((tool) => [tool.name, tool]));
    const draftSelection = server.wholeSelectionOverride ?? server.directSelection;
    const isSelectedByDraftPolicy = (name) => draftSelection === true || Array.isArray(draftSelection) && draftSelection.includes(name);
    const isSelectedBySavedPolicy = (name) => server.directSelection === true || Array.isArray(server.directSelection) && server.directSelection.includes(name);
    const newTools = [];
    for (const tool of entry.tools ?? []) {
      if (!isUiToolVisibleToModel(tool.uiVisibility)) continue;
      if (!isToolAllowed(tool.name, server.name, this.prefix, server.includeTools, server.excludeTools, this.getOtherCurrentCandidates(server.name, server, entry, tool.name))) {
        continue;
      }
      const previous = existingState.get(tool.name);
      const isDirect = previous?.isDirect ?? isSelectedByDraftPolicy(tool.name);
      const effectiveExposure = this.nativeDetails?.get(server.name)?.toolExposures.get(tool.name);
      newTools.push({
        name: tool.name,
        description: tool.description ?? "",
        isDirect,
        wasDirect: previous?.wasDirect ?? isSelectedBySavedPolicy(tool.name),
        estimatedTokens: this.showTokenEstimate ? estimateTokens(tool) : 0,
        ...effectiveExposure === void 0 ? {} : { effectiveExposure }
      });
    }
    if (server.exposeResources) {
      for (const resource of entry.resources ?? []) {
        const baseName = `read_${resourceNameToToolName(resource.name)}`;
        if (!isToolAllowed(baseName, server.name, this.prefix, server.includeTools, server.excludeTools, this.getOtherCurrentCandidates(server.name, server, entry, baseName))) {
          continue;
        }
        const previous = existingState.get(baseName);
        const isDirect = previous?.isDirect ?? isSelectedByDraftPolicy(baseName);
        const ct = {
          name: baseName,
          ...resource.description !== void 0 ? { description: resource.description } : {}
        };
        newTools.push({
          name: baseName,
          description: resource.description ?? `Read resource: ${resource.uri}`,
          isDirect,
          wasDirect: previous?.wasDirect ?? isSelectedBySavedPolicy(baseName),
          estimatedTokens: this.showTokenEstimate ? estimateTokens(ct) : 0
        });
      }
    }
    server.tools = newTools;
    const representedNames = new Set(newTools.map((tool) => tool.name));
    const candidateNames = [
      ...(entry.tools ?? []).map((tool) => tool.name),
      ...server.exposeResources ? (entry.resources ?? []).map((resource) => `read_${resourceNameToToolName(resource.name)}`) : []
    ];
    const persistedNames = Array.isArray(server.directSelection) ? server.directSelection : server.directSelection === true ? candidateNames : [];
    server.unrepresentedDirectTools = [...new Set(persistedNames.filter((name) => !representedNames.has(name)))];
    server.directCount = 0;
    server.directTokens = 0;
    for (const tool of newTools) {
      if (!tool.isDirect) continue;
      server.directCount++;
      server.directTokens += tool.estimatedTokens;
    }
    this.rebuildVisibleItems();
    this.updateDirty();
  }
  render(width) {
    const innerW = width - 2;
    const lines = [];
    const t = this.t;
    const bold = (s) => `\x1B[1m${s}\x1B[22m`;
    const italic = (s) => `\x1B[3m${s}\x1B[23m`;
    const inverse = (s) => `\x1B[7m${s}\x1B[27m`;
    const row = (content) => fg(t.border, "\u2502") + truncateToWidth(" " + sanitizeRowContent(content), innerW, "\u2026", true) + fg(t.border, "\u2502");
    const emptyRow = () => fg(t.border, "\u2502") + " ".repeat(innerW) + fg(t.border, "\u2502");
    const divider = () => fg(t.border, "\u251C" + "\u2500".repeat(innerW) + "\u2524");
    const titleText = this.authOnly ? " MCP OAuth " : " MCP Servers ";
    const borderLen = innerW - visibleWidth(titleText);
    const leftB = Math.floor(borderLen / 2);
    const rightB = borderLen - leftB;
    lines.push(fg(t.border, "\u256D" + "\u2500".repeat(leftB)) + fg(t.title, titleText) + fg(t.border, "\u2500".repeat(rightB) + "\u256E"));
    lines.push(emptyRow());
    const cursor = fg(t.selected, "\u2502");
    const searchIcon = fg(t.border, "\u25CE");
    if (this.descSearchActive) {
      lines.push(row(`${searchIcon}  ${fg(t.needsAuth, "desc:")} ${this.descQuery}${cursor}`));
    } else if (this.nameQuery) {
      lines.push(row(`${searchIcon}  ${this.nameQuery}${cursor}`));
    } else {
      lines.push(row(`${searchIcon}  ${fg(t.placeholder, italic("search..."))}`));
    }
    lines.push(emptyRow());
    if (this.noticeLines.length > 0) {
      for (const notice of this.noticeLines) {
        lines.push(row(fg(t.hint, italic(sanitizeDisplayText(notice)))));
      }
      lines.push(emptyRow());
    }
    lines.push(divider());
    if (this.servers.length === 0) {
      lines.push(emptyRow());
      lines.push(row(fg(t.hint, italic(this.nativeDetails ? "No native MCP servers are visible in this session." : this.authOnly ? "No OAuth-capable MCP servers configured." : "No MCP servers configured."))));
      lines.push(emptyRow());
    } else {
      const maxVis = _McpPanel.MAX_VISIBLE;
      const total = this.visibleItems.length;
      const startIdx = Math.max(0, Math.min(this.cursorIndex - Math.floor(maxVis / 2), total - maxVis));
      const endIdx = Math.min(startIdx + maxVis, total);
      lines.push(emptyRow());
      for (let i = startIdx; i < endIdx; i++) {
        const item = this.visibleItems[i];
        if (!item) continue;
        const isCursor = i === this.cursorIndex;
        const server = this.servers[item.serverIndex];
        if (!server) continue;
        if (item.type === "server") {
          lines.push(row(this.renderServerRow(server, isCursor)));
          if (isCursor && server.connectionStatus === "failed" && server.failureMessage) {
            for (const line of this.wrapText(sanitizeDisplayText(server.failureMessage), innerW - 6)) {
              lines.push(row(`    ${fg(t.cancel, line)}`));
            }
          }
        } else if (item.type === "tool" && item.toolIndex !== void 0) {
          const tool = server.tools[item.toolIndex];
          if (tool) lines.push(row(this.renderToolRow(tool, isCursor, innerW)));
        } else if (item.type === "resource" && item.resourceIndex !== void 0) {
          const resource = server.resources[item.resourceIndex];
          if (resource) lines.push(row(this.renderResourceRow(resource, server.resourceFreshness, isCursor, innerW)));
        }
      }
      lines.push(emptyRow());
      if (total > maxVis) {
        const prog = Math.round((this.cursorIndex + 1) / total * 10);
        lines.push(row(`${rainbowProgress(prog, 10)}  ${fg(t.hint, `${this.cursorIndex + 1}/${total}`)}`));
        lines.push(emptyRow());
      }
      if (this.authNotice) {
        lines.push(row(fg(t.needsAuth, italic(sanitizeDisplayText(this.authNotice)))));
        lines.push(emptyRow());
      }
    }
    lines.push(divider());
    lines.push(emptyRow());
    if (this.confirmingDiscard) {
      const discardBtn = this.discardSelected === 0 ? inverse(bold(fg(t.cancel, "  Discard  "))) : fg(t.hint, "  Discard  ");
      const keepBtn = this.discardSelected === 1 ? inverse(bold(fg(t.confirm, "  Keep & Close  "))) : fg(t.hint, "  Keep & Close  ");
      lines.push(row(`Discard unsaved changes?  ${discardBtn}   ${keepBtn}`));
    } else {
      if (this.authOnly) {
        lines.push(row(fg(t.description, "select a server to authenticate")));
      } else {
        let directCount = 0;
        let directTokens = 0;
        for (const server of this.servers) {
          directCount += server.directCount;
          directTokens += server.directTokens;
        }
        const stats = directCount > 0 ? this.showTokenEstimate ? `${directCount} direct  ~${directTokens.toLocaleString()} tokens` : `${directCount} saved direct` : "no direct tools";
        lines.push(row(fg(t.description, stats + (this.dirty ? fg(t.needsAuth, "  (unsaved)") : ""))));
      }
    }
    lines.push(emptyRow());
    const saveLabel = this.keys.saveLabel();
    const hints = this.authOnly ? [
      italic("\u2191\u2193") + " navigate",
      italic("\u23CE") + " auth",
      italic("ctrl+a") + " auth",
      italic("esc") + " clear/close",
      italic("ctrl+c") + " quit"
    ] : [
      italic("\u2191\u2193") + " navigate",
      italic("space") + " toggle",
      italic("\u23CE") + " expand/auth",
      italic("ctrl+a") + " auth",
      italic("ctrl+r") + " reconnect",
      ...this.selectedServerHasFailureMessage() ? [italic("ctrl+y") + " copy error"] : [],
      italic("?") + " desc search",
      ...saveLabel ? [italic(saveLabel) + " save"] : [],
      italic("esc") + " clear/close",
      italic("ctrl+c") + " quit"
    ];
    const gap = "  ";
    const gapW = 2;
    const maxW = innerW - 2;
    let curLine = "";
    let curW = 0;
    for (const hint of hints) {
      const hw = visibleWidth(hint);
      const needed = curW === 0 ? hw : gapW + hw;
      if (curW > 0 && curW + needed > maxW) {
        lines.push(row(fg(t.hint, curLine)));
        curLine = hint;
        curW = hw;
      } else {
        curLine += (curW > 0 ? gap : "") + hint;
        curW += needed;
      }
    }
    if (curLine) lines.push(row(fg(t.hint, curLine)));
    lines.push(fg(t.border, "\u2570" + "\u2500".repeat(innerW) + "\u256F"));
    return lines;
  }
  renderServerRow(server, isCursor) {
    const t = this.t;
    const bold = (s) => `\x1B[1m${s}\x1B[22m`;
    const expandIcon = server.expanded ? "\u25BE" : "\u25B8";
    const prefix = isCursor ? fg(t.selected, expandIcon) : fg(t.border, server.expanded ? expandIcon : "\xB7");
    const serverName = sanitizeDisplayText(server.name);
    const nameStr = isCursor ? bold(fg(t.selected, serverName)) : serverName;
    const statusLabel = this.renderConnectionStatus(server);
    const nativeLabels = server.catalogFreshness === void 0 ? "" : `  ${fg(t.description, `${server.sourceScope ?? "unknown"} \xB7 catalog ${server.catalogFreshness} \xB7 resources ${server.resourceFreshness ?? "missing"} (${server.resources.length})`)}`;
    if (!server.hasCachedData && !this.authOnly) {
      return `${prefix}   ${nameStr}  ${fg(t.description, server.catalogFreshness === "missing" ? "catalog missing" : "(not cached)")}${statusLabel}${nativeLabels}`;
    }
    const directCount = server.directCount;
    const totalCount = server.tools.length;
    let toggleIcon = fg(t.description, "\u25CB");
    if (directCount === totalCount && totalCount > 0) {
      toggleIcon = fg(t.direct, "\u25CF");
    } else if (directCount > 0) {
      toggleIcon = fg(t.needsAuth, "\u25D0");
    }
    let toolInfo = "";
    if (totalCount > 0) {
      toolInfo = `${directCount}/${totalCount}`;
      if (directCount > 0 && this.showTokenEstimate) {
        toolInfo += `  ~${server.directTokens.toLocaleString()}`;
      }
      toolInfo = fg(t.description, toolInfo);
    }
    return `${prefix} ${toggleIcon} ${nameStr}  ${toolInfo}${statusLabel}${nativeLabels}`;
  }
  selectedServerHasFailureMessage() {
    const item = this.visibleItems[this.cursorIndex];
    if (!item) return false;
    const server = this.servers[item.serverIndex];
    return server?.connectionStatus === "failed" && !!server.failureMessage;
  }
  wrapText(text, width) {
    const max = Math.max(8, width);
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    const splitLongWord = (word) => {
      let rest = word;
      while (visibleWidth(rest) > max) {
        let take = "";
        let index = 0;
        while (index < rest.length && visibleWidth(take + rest.charAt(index)) <= max) {
          take += rest.charAt(index);
          index++;
        }
        if (!take) take = rest.charAt(0);
        lines.push(take);
        rest = rest.slice(take.length);
      }
      return rest;
    };
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (visibleWidth(candidate) <= max) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = splitLongWord(word);
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [text];
  }
  renderConnectionStatus(server) {
    const t = this.t;
    if (this.authInFlight === server.name) return `  ${fg(t.needsAuth, "authenticating")}`;
    if (server.connectionStatus === "disabled") return `  ${fg(t.description, "disabled")}`;
    if (server.connectionStatus === "needs-auth") return `  ${fg(t.needsAuth, "needs auth")}`;
    if (server.connectionStatus === "connecting") return `  ${fg(t.needsAuth, "connecting")}`;
    if (server.connectionStatus === "failed") return `  ${fg(t.cancel, "failed")}`;
    if (this.nativeDetails?.has(server.name)) {
      return server.connectionStatus === "connected" ? `  ${fg(t.direct, "connected")}` : `  ${fg(t.description, "not connected")}`;
    }
    if (this.authOnly && server.connectionStatus === "connected") return `  ${fg(t.direct, "connected")}`;
    if (this.authOnly) return `  ${fg(t.description, "idle")}`;
    return "";
  }
  renderResourceRow(resource, freshness, isCursor, innerW) {
    const t = this.t;
    const cursor = isCursor ? fg(t.selected, "\u25B8") : " ";
    const title = sanitizeDisplayText(resource.title ?? resource.name);
    const description = sanitizeDisplayText(resource.description ?? resource.mimeType ?? "");
    const kind = resource.kind === "template" ? "template" : "resource";
    const freshnessLabel = freshness === void 0 ? "" : `  ${freshness}`;
    const prefixLen = 8 + visibleWidth(title);
    const maxDescLen = Math.max(0, innerW - prefixLen - 8);
    const desc = maxDescLen > 5 && description ? ` \u2014 ${truncateToWidth(description, maxDescLen, "\u2026")}` : "";
    return `  ${cursor} \u25C7 ${title}  ${fg(t.description, `${kind}${freshnessLabel}${desc}`)}`;
  }
  renderToolRow(tool, isCursor, innerW) {
    const t = this.t;
    const bold = (s) => `\x1B[1m${s}\x1B[22m`;
    const toggleIcon = tool.isDirect ? fg(t.direct, "\u25CF") : fg(t.description, "\u25CB");
    const cursor = isCursor ? fg(t.selected, "\u25B8") : " ";
    const toolName = sanitizeDisplayText(tool.name);
    const description = sanitizeDisplayText(tool.description);
    const nameStr = isCursor ? bold(fg(t.selected, toolName)) : toolName;
    const prefixLen = 7 + visibleWidth(toolName);
    const maxDescLen = Math.max(0, innerW - prefixLen - 8);
    const descStr = maxDescLen > 5 && description ? fg(t.description, "\u2014 " + truncateToWidth(description, maxDescLen, "\u2026")) : "";
    const exposure = tool.effectiveExposure === void 0 ? "" : `  ${fg(t.hint, `[${tool.effectiveExposure}]`)}`;
    return `  ${cursor} ${toggleIcon} ${nameStr} ${descStr}${exposure}`;
  }
  invalidate() {
  }
  dispose() {
    this.cleanup();
  }
};
function createMcpPanel(config, cache, provenance, callbacks, tui, done, options) {
  return new McpPanel(config, cache, provenance, callbacks, tui, done, options ?? {});
}
export {
  createMcpPanel
};
