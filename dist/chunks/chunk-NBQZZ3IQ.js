import {
  extractToolUiStreamMode,
  interpolateEnvRecord,
  interpolateEnvVars,
  isServerDisabled,
  resolveBearerToken,
  resolveConfigPath,
  resolveServerUrl
} from "./chunk-Z3P2QPCB.js";
import {
  getAgentPath
} from "./chunk-ELOBWFRH.js";

// src/catalog/tool-names.ts
function sanitizeServerPrefix(serverName, preserveProviderValid = true) {
  const validCharacters = preserveProviderValid ? /^[A-Za-z0-9_-]$/ : /^[A-Za-z0-9]$/;
  return Array.from(
    serverName,
    (char) => validCharacters.test(char) ? char : `_${char.codePointAt(0).toString(16)}_`
  ).join("");
}
function getServerPrefix(serverName, mode) {
  if (mode === "none") return "";
  if (mode === "short") {
    let short = sanitizeServerPrefix(serverName.replace(/-?mcp$/i, ""));
    if (!short) short = "mcp";
    return short;
  }
  if (mode === "mcp") return `mcp__${sanitizeServerPrefix(serverName)}`;
  return sanitizeServerPrefix(serverName);
}
function formatToolName(toolName, serverName, prefix) {
  const p = getServerPrefix(serverName, prefix);
  const sanitized = toolName.replace(/\./g, "_");
  return p ? `${p}_${sanitized}` : sanitized;
}
function resolveToolPrefix(definition, globalPrefix) {
  return definition?.toolPrefix ?? globalPrefix ?? "server";
}
function sanitizePromptName(name) {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
  if (!cleaned) return "prompt";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}
function formatPromptCommandName(promptName, serverName, prefix) {
  const serverPart = getServerPrefix(serverName, prefix) || sanitizeServerPrefix(serverName) || "server";
  return `mcp__${serverPart}__${sanitizePromptName(promptName)}`;
}
function getLegacyServerPrefix(serverName, mode) {
  if (mode === "none") return "";
  if (mode === "short") return sanitizeServerPrefix(serverName.replace(/-?mcp$/i, ""), false) || "mcp";
  if (mode === "mcp") return `mcp__${sanitizeServerPrefix(serverName, false)}`;
  return sanitizeServerPrefix(serverName, false);
}
function formatLegacyToolName(toolName, serverName, prefix) {
  const serverPrefix = getLegacyServerPrefix(serverName, prefix);
  const sanitizedToolName = toolName.replace(/[.-]/g, "_");
  return serverPrefix ? `${serverPrefix}_${sanitizedToolName}` : sanitizedToolName;
}
function getToolNameCandidates(toolName, serverName, prefix, includeLegacy = true) {
  const candidates = /* @__PURE__ */ new Set([
    toolName,
    formatToolName(toolName, serverName, prefix),
    formatToolName(toolName, serverName, "server"),
    formatToolName(toolName, serverName, "short"),
    formatToolName(toolName, serverName, "mcp")
  ]);
  if (includeLegacy) {
    const legacyToolName = toolName.replace(/-/g, "_");
    candidates.add(legacyToolName);
    candidates.add(formatToolName(legacyToolName, serverName, prefix));
    candidates.add(formatToolName(legacyToolName, serverName, "server"));
    candidates.add(formatToolName(legacyToolName, serverName, "short"));
    candidates.add(formatToolName(legacyToolName, serverName, "mcp"));
    candidates.add(formatLegacyToolName(toolName, serverName, prefix));
    candidates.add(formatLegacyToolName(toolName, serverName, "server"));
    candidates.add(formatLegacyToolName(toolName, serverName, "short"));
    candidates.add(formatLegacyToolName(toolName, serverName, "mcp"));
    candidates.add(formatToolName(toolName, serverName, prefix).replace(/-/g, "_"));
    candidates.add(formatToolName(toolName, serverName, "server").replace(/-/g, "_"));
    candidates.add(formatToolName(toolName, serverName, "short").replace(/-/g, "_"));
    candidates.add(formatToolName(toolName, serverName, "mcp").replace(/-/g, "_"));
  }
  return candidates;
}

// src/catalog/tool-selectors.ts
function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
function createToolSelectorCandidateIndex(allCurrentCandidates, additionalCurrentCandidatesByToolName) {
  return {
    allCurrentCandidates,
    matchingCountByPattern: /* @__PURE__ */ new Map(),
    matcherByPattern: /* @__PURE__ */ new Map(),
    ...additionalCurrentCandidatesByToolName ? { additionalCurrentCandidatesByToolName } : {}
  };
}
function createLiveToolSelectorCandidateIndex(configuredServers, knownMetadata, prefix, includeMissingConfiguredCandidates = false) {
  const candidates = /* @__PURE__ */ new Set();
  const additionalCandidatesByToolName = /* @__PURE__ */ new Map();
  const evaluatedToolNames = /* @__PURE__ */ new Set();
  const knownServerNames = /* @__PURE__ */ new Set();
  const addCandidates = (target, originalName, serverName, serverPrefix) => {
    for (const candidate of getToolNameCandidates(originalName, serverName, serverPrefix, false)) target.add(candidate);
  };
  for (const [serverName, metadata] of knownMetadata) {
    const definition = configuredServers[serverName];
    if (!definition || isServerDisabled(definition)) continue;
    knownServerNames.add(serverName);
    const effectivePrefix = resolveToolPrefix(definition, prefix);
    for (const tool of metadata) {
      if (!tool?.originalName || tool.uiVisibility !== void 0 && !tool.uiVisibility.includes("model")) continue;
      evaluatedToolNames.add(tool.originalName);
      candidates.add(tool.name);
      addCandidates(candidates, tool.originalName, serverName, effectivePrefix);
    }
  }
  if (includeMissingConfiguredCandidates) {
    for (const [serverName, definition] of Object.entries(configuredServers)) {
      if (knownServerNames.has(serverName) || isServerDisabled(definition)) continue;
      const effectivePrefix = resolveToolPrefix(definition, prefix);
      for (const toolName of evaluatedToolNames) {
        let additionalCandidates = additionalCandidatesByToolName.get(toolName);
        if (!additionalCandidates) {
          additionalCandidates = /* @__PURE__ */ new Set();
          additionalCandidatesByToolName.set(toolName, additionalCandidates);
        }
        addCandidates(additionalCandidates, toolName, serverName, effectivePrefix);
        for (const candidate of getToolNameCandidates(toolName, serverName, effectivePrefix, false)) {
          additionalCandidates.add(candidate.replace(/-/g, "_"));
        }
      }
    }
  }
  return createToolSelectorCandidateIndex(candidates, additionalCandidatesByToolName);
}
function matchesToolPattern(candidates, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    if (!pattern.includes("*") && !pattern.includes("?") && candidates.has(pattern)) {
      return true;
    }
    if ((pattern.includes("*") || pattern.includes("?")) && [...candidates].some((candidate) => globToRegExp(pattern).test(candidate))) {
      return true;
    }
  }
  return false;
}
function indexHasOtherCurrentMatch(index, toolName, currentCandidates, pattern) {
  const additionalCandidates = index.additionalCurrentCandidatesByToolName?.get(toolName);
  const hasCandidate = (candidate) => index.allCurrentCandidates.has(candidate) || additionalCandidates?.has(candidate) === true;
  const isGlob = pattern.includes("*") || pattern.includes("?");
  if (!isGlob) {
    return hasCandidate(pattern) && !currentCandidates.has(pattern);
  }
  let matcher = index.matcherByPattern.get(pattern);
  if (!matcher) {
    matcher = globToRegExp(pattern);
    index.matcherByPattern.set(pattern, matcher);
  }
  let matchingCount = index.matchingCountByPattern.get(pattern);
  if (matchingCount === void 0) {
    matchingCount = 0;
    for (const candidate of index.allCurrentCandidates) {
      if (matcher.test(candidate)) matchingCount++;
    }
    index.matchingCountByPattern.set(pattern, matchingCount);
  }
  let totalMatchingCount = matchingCount;
  if (additionalCandidates) {
    for (const candidate of additionalCandidates) {
      if (!index.allCurrentCandidates.has(candidate) && matcher.test(candidate)) totalMatchingCount++;
    }
  }
  if (totalMatchingCount === 0) return false;
  let currentMatchingCount = 0;
  for (const candidate of currentCandidates) {
    if (hasCandidate(candidate) && matcher.test(candidate)) currentMatchingCount++;
  }
  return totalMatchingCount > currentMatchingCount;
}
function matchesToolSelector(toolName, serverName, prefix, patterns, otherCurrentCandidates) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const currentCandidates = getToolNameCandidates(toolName, serverName, prefix, false);
  if (matchesToolPattern(currentCandidates, patterns)) return true;
  if (!otherCurrentCandidates) return matchesToolPattern(getToolNameCandidates(toolName, serverName, prefix), patterns);
  const legacyCandidates = getToolNameCandidates(toolName, serverName, prefix);
  for (const candidate of currentCandidates) legacyCandidates.delete(candidate);
  return patterns.some((pattern) => {
    if (typeof pattern !== "string" || !matchesToolPattern(legacyCandidates, [pattern])) return false;
    const hasCollision = otherCurrentCandidates instanceof Set ? matchesToolPattern(otherCurrentCandidates, [pattern]) : indexHasOtherCurrentMatch(otherCurrentCandidates, toolName, currentCandidates, pattern);
    return !hasCollision;
  });
}
function isToolIncluded(toolName, serverName, prefix, includeTools, otherCurrentCandidates) {
  if (!Array.isArray(includeTools) || includeTools.length === 0) return true;
  return matchesToolSelector(toolName, serverName, prefix, includeTools, otherCurrentCandidates);
}
function isToolExcluded(toolName, serverName, prefix, excludeTools, otherCurrentCandidates) {
  return matchesToolSelector(toolName, serverName, prefix, excludeTools, otherCurrentCandidates);
}
function isToolAllowed(toolName, serverName, prefix, includeTools, excludeTools, otherCurrentCandidates) {
  return isToolIncluded(toolName, serverName, prefix, includeTools, otherCurrentCandidates) && !isToolExcluded(toolName, serverName, prefix, excludeTools, otherCurrentCandidates);
}

// src/tools/resource-tools.ts
function resourceNameToToolName(name) {
  let result = name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+/, "").replace(/_+$/, "").toLowerCase();
  if (!result || /^\d/.test(result)) {
    result = "resource" + (result ? "_" + result : "");
  }
  return result;
}

// src/ui/tool-visibility.ts
function extractUiToolVisibility(meta) {
  if (!meta || typeof meta !== "object") return void 0;
  const ui = meta.ui;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) return void 0;
  const visibility = ui.visibility;
  if (visibility === void 0) return void 0;
  if (!Array.isArray(visibility)) return [];
  const values = [];
  for (const entry of visibility) {
    if (entry !== "model" && entry !== "app") return [];
    if (!values.includes(entry)) values.push(entry);
  }
  return values;
}
function isUiToolVisibleToModel(visibility) {
  return visibility === void 0 || visibility.includes("model");
}
function isUiToolCallableByApp(visibility) {
  return visibility === void 0 || visibility.includes("app");
}

// src/catalog/metadata-cache.ts
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

// src/ui/app-bridge-helpers.ts
var RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
var RESOURCE_URI_META_KEY = "ui/resourceUri";
function getToolUiResourceUri(tool) {
  const meta = tool._meta;
  let resourceUri = getNestedResourceUri(meta);
  if (resourceUri === void 0) {
    resourceUri = meta?.[RESOURCE_URI_META_KEY];
  }
  if (typeof resourceUri === "string" && resourceUri.startsWith("ui://")) {
    return resourceUri;
  }
  if (resourceUri !== void 0) {
    throw new Error(`Invalid UI resource URI: ${JSON.stringify(resourceUri)}`);
  }
  return void 0;
}
function buildAllowAttribute(permissions) {
  if (!permissions) return "";
  const allowed = [];
  if (permissions.camera) allowed.push("camera");
  if (permissions.microphone) allowed.push("microphone");
  if (permissions.geolocation) allowed.push("geolocation");
  if (permissions.clipboardWrite) allowed.push("clipboard-write");
  return allowed.join("; ");
}
function getNestedResourceUri(meta) {
  const ui = meta?.ui;
  if (!ui || typeof ui !== "object") return void 0;
  return ui.resourceUri;
}

// src/catalog/metadata-cache.ts
var CACHE_VERSION = 1;
var CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
function createMetadataCatalogSnapshot(config, cache = loadMetadataCache(), environment = process.env, maxAgeMs = CACHE_MAX_AGE_MS) {
  const capturedAt = Date.now();
  const validEntries = /* @__PURE__ */ new Map();
  const configHashes = /* @__PURE__ */ new Map();
  if (!cache) return Object.freeze({ cache, validEntries, configHashes, capturedAt });
  for (const [serverName, definition] of Object.entries(config.mcpServers)) {
    if (isServerDisabled(definition)) continue;
    const entry = cache.servers?.[serverName];
    if (!entry) continue;
    let configHash;
    try {
      configHash = computeServerHash(definition, environment);
    } catch {
      continue;
    }
    configHashes.set(serverName, configHash);
    if (entry.configHash !== configHash || !entry.cachedAt || typeof entry.cachedAt !== "number") continue;
    if (maxAgeMs > 0 && capturedAt - entry.cachedAt > maxAgeMs) continue;
    validEntries.set(serverName, entry);
  }
  return Object.freeze({ cache, validEntries, configHashes, capturedAt });
}
function getMetadataCachePath() {
  return getAgentPath("mcp-cache.json");
}
function loadMetadataCache() {
  const cachePath = getMetadataCachePath();
  if (!existsSync(cachePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf-8"));
    if (!raw || typeof raw !== "object") return null;
    if (raw.version !== CACHE_VERSION) return null;
    if (!raw.servers || typeof raw.servers !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}
function saveMetadataCache(cache) {
  const cachePath = getMetadataCachePath();
  const dir = dirname(cachePath);
  mkdirSync(dir, { recursive: true });
  let merged = { version: CACHE_VERSION, servers: {} };
  try {
    if (existsSync(cachePath)) {
      const existing = JSON.parse(readFileSync(cachePath, "utf-8"));
      if (existing && existing.version === CACHE_VERSION && existing.servers) {
        merged.servers = { ...existing.servers };
      }
    }
  } catch {
  }
  merged.version = CACHE_VERSION;
  merged.servers = { ...merged.servers, ...cache.servers };
  const tmpPath = `${cachePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(merged), "utf-8");
  renameSync(tmpPath, cachePath);
}
function computeServerHash(definition, environment = process.env) {
  const identity = {
    command: definition.command,
    args: definition.args,
    socket: resolveConfigPath(definition.socket, environment),
    env: interpolateEnvRecord(definition.env, environment),
    cwd: resolveConfigPath(definition.cwd, environment),
    url: resolveServerUrl(definition, environment),
    headers: interpolateEnvRecord(definition.headers, environment),
    requestHeadersCommand: definition.requestHeadersCommand ? {
      command: interpolateEnvVars(definition.requestHeadersCommand.command, environment),
      args: definition.requestHeadersCommand.args?.map((argument) => interpolateEnvVars(argument, environment)),
      env: interpolateEnvRecord(definition.requestHeadersCommand.env, environment),
      timeoutMs: definition.requestHeadersCommand.timeoutMs
    } : void 0,
    auth: definition.auth,
    protocolVersion: definition.protocolVersion,
    bearerToken: resolveBearerToken(definition, environment),
    bearerTokenEnv: definition.bearerTokenEnv,
    exposeResources: definition.exposeResources,
    includeTools: definition.includeTools,
    excludeTools: definition.excludeTools
  };
  const normalized = stableStringify(identity);
  return createHash("sha256").update(normalized).digest("hex");
}
function isServerCacheValid(entry, definition, maxAgeMs = CACHE_MAX_AGE_MS, environment = process.env) {
  let configHash;
  try {
    configHash = computeServerHash(definition, environment);
  } catch {
    return false;
  }
  if (!entry || entry.configHash !== configHash) return false;
  if (!entry.cachedAt || typeof entry.cachedAt !== "number") return false;
  if (maxAgeMs > 0 && Date.now() - entry.cachedAt > maxAgeMs) return false;
  return true;
}
function parseDirectToolSelectors(selectors) {
  const servers = /* @__PURE__ */ new Set();
  const tools = /* @__PURE__ */ new Map();
  for (let selector of selectors) {
    selector = selector.replace(/\/+$/, "");
    if (selector.includes("/")) {
      const [server, tool] = selector.split("/", 2);
      if (server && tool) {
        const serverTools = tools.get(server) ?? /* @__PURE__ */ new Set();
        serverTools.add(tool);
        tools.set(server, serverTools);
      } else if (server) {
        servers.add(server);
      }
    } else if (selector) {
      servers.add(selector);
    }
  }
  return { servers, tools };
}
function getMissingConfiguredDirectToolServers(config, cache, envOverride, snapshot) {
  const catalog = snapshot ?? createMetadataCatalogSnapshot(config, cache);
  const missing = [];
  const globalDirect = config.settings?.directTools;
  const envSelection = envOverride ? parseDirectToolSelectors(envOverride) : null;
  for (const [serverName, definition] of Object.entries(config.mcpServers)) {
    if (isServerDisabled(definition)) continue;
    const hasDirectTools = envSelection ? envSelection.servers.has(serverName) || envSelection.tools.has(serverName) : definition.directTools !== void 0 ? !!definition.directTools : !!globalDirect;
    if (!hasDirectTools) continue;
    if (!catalog.validEntries.has(serverName)) {
      missing.push(serverName);
    }
  }
  return missing;
}
function reconstructToolMetadata(serverName, entry, prefix, definition, configuredServers, cache, sharedSelectorCandidateIndex, snapshot) {
  const metadata = [];
  const seenNames = /* @__PURE__ */ new Set();
  const effectivePrefix = resolveToolPrefix(definition, prefix);
  const hasToolFilters = Array.isArray(definition.includeTools) && definition.includeTools.length > 0 || Array.isArray(definition.excludeTools) && definition.excludeTools.length > 0;
  const selectorCandidateIndex = hasToolFilters ? sharedSelectorCandidateIndex ?? (configuredServers && cache ? createCachedToolSelectorCandidateIndex(configuredServers, cache, prefix, snapshot) : void 0) : void 0;
  for (const tool of entry.tools ?? []) {
    if (!tool?.name) continue;
    if (!isUiToolVisibleToModel(tool.uiVisibility)) {
      continue;
    }
    if (!isToolAllowed(tool.name, serverName, effectivePrefix, definition.includeTools, definition.excludeTools, selectorCandidateIndex)) {
      continue;
    }
    const name = formatToolName(tool.name, serverName, effectivePrefix);
    if (seenNames.has(name)) {
      continue;
    }
    seenNames.add(name);
    metadata.push({
      name,
      originalName: tool.name,
      description: tool.description ?? "",
      ...tool.inputSchema !== void 0 ? { inputSchema: tool.inputSchema } : {},
      ...tool.uiResourceUri !== void 0 ? { uiResourceUri: tool.uiResourceUri } : {},
      ...tool.uiVisibility !== void 0 ? { uiVisibility: tool.uiVisibility } : {},
      ...tool.uiStreamMode !== void 0 ? { uiStreamMode: tool.uiStreamMode } : {}
    });
  }
  if (definition.exposeResources !== false) {
    for (const resource of entry.resources ?? []) {
      if (!resource?.name || !resource?.uri) continue;
      const baseName = `read_${resourceNameToToolName(resource.name)}`;
      if (!isToolAllowed(baseName, serverName, effectivePrefix, definition.includeTools, definition.excludeTools, selectorCandidateIndex)) {
        continue;
      }
      const name = formatToolName(baseName, serverName, effectivePrefix);
      if (seenNames.has(name)) {
        continue;
      }
      seenNames.add(name);
      metadata.push({
        name,
        originalName: baseName,
        description: resource.description ?? `Read resource: ${resource.uri}`,
        resourceUri: resource.uri
      });
    }
  }
  return metadata;
}
function createCachedToolSelectorCandidateIndex(configuredServers, cache, prefix, snapshot) {
  const candidates = /* @__PURE__ */ new Set();
  for (const [serverName, definition] of Object.entries(configuredServers)) {
    if (isServerDisabled(definition)) continue;
    const entry = snapshot ? snapshot.validEntries.get(serverName) : cache.servers[serverName];
    if (!entry || !snapshot && !isServerCacheValid(entry, definition)) continue;
    const effectivePrefix = resolveToolPrefix(definition, prefix);
    for (const tool of entry.tools ?? []) {
      if (!isUiToolVisibleToModel(tool.uiVisibility)) continue;
      for (const candidate of getToolNameCandidates(tool.name, serverName, effectivePrefix, false)) candidates.add(candidate);
    }
    if (definition.exposeResources !== false) {
      for (const resource of entry.resources ?? []) {
        const baseName = `read_${resourceNameToToolName(resource.name)}`;
        for (const candidate of getToolNameCandidates(baseName, serverName, effectivePrefix, false)) candidates.add(candidate);
      }
    }
  }
  return createToolSelectorCandidateIndex(candidates);
}
function serializeTools(tools) {
  return tools.filter((t) => t?.name).map((t) => {
    const uiResourceUri = tryGetToolUiResourceUri(t);
    const uiVisibility = extractUiToolVisibility(t._meta);
    const uiStreamMode = extractToolUiStreamMode(t._meta);
    return {
      name: t.name,
      ...t.description !== void 0 ? { description: t.description } : {},
      ...t.inputSchema !== void 0 ? { inputSchema: t.inputSchema } : {},
      ...uiResourceUri !== void 0 ? { uiResourceUri } : {},
      ...uiVisibility !== void 0 ? { uiVisibility } : {},
      ...uiStreamMode !== void 0 ? { uiStreamMode } : {}
    };
  });
}
function serializeResources(resources) {
  return resources.filter((r) => r?.name && r?.uri).map((r) => ({
    uri: r.uri,
    name: r.name,
    ...r.description !== void 0 ? { description: r.description } : {}
  }));
}
function serializePrompts(prompts) {
  return (prompts ?? []).filter((prompt) => prompt?.name).map((prompt) => ({
    name: prompt.name,
    ...prompt.title !== void 0 ? { title: prompt.title } : {},
    ...prompt.description !== void 0 ? { description: prompt.description } : {},
    ...Array.isArray(prompt.arguments) ? {
      arguments: prompt.arguments.filter((argument) => argument?.name).map((argument) => ({
        name: argument.name,
        ...argument.description !== void 0 ? { description: argument.description } : {},
        ...argument.required !== void 0 ? { required: argument.required } : {}
      }))
    } : {}
  }));
}
function reconstructPromptMetadata(serverName, prompts, prefix, definition) {
  const effectivePrefix = resolveToolPrefix(definition, prefix);
  return (prompts ?? []).filter((prompt) => prompt?.name).map((prompt) => {
    const args = Array.isArray(prompt.arguments) ? prompt.arguments.filter((argument) => argument?.name).map((argument) => ({
      name: argument.name,
      ...argument.description !== void 0 ? { description: argument.description } : {},
      ...argument.required !== void 0 ? { required: argument.required } : {}
    })) : [];
    return {
      serverName,
      originalName: prompt.name,
      commandName: formatPromptCommandName(prompt.name, serverName, effectivePrefix),
      ...prompt.title !== void 0 ? { title: prompt.title } : {},
      description: prompt.description ?? "",
      arguments: args
    };
  });
}
function stableStringify(value) {
  if (value === null || value === void 0 || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    return serialized === void 0 ? "undefined" : serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
function tryGetToolUiResourceUri(tool) {
  try {
    return getToolUiResourceUri({ _meta: tool._meta });
  } catch {
    return void 0;
  }
}

export {
  RESOURCE_MIME_TYPE,
  getToolUiResourceUri,
  buildAllowAttribute,
  getServerPrefix,
  formatToolName,
  resolveToolPrefix,
  getToolNameCandidates,
  createToolSelectorCandidateIndex,
  createLiveToolSelectorCandidateIndex,
  matchesToolPattern,
  isToolAllowed,
  resourceNameToToolName,
  extractUiToolVisibility,
  isUiToolVisibleToModel,
  isUiToolCallableByApp,
  createMetadataCatalogSnapshot,
  getMetadataCachePath,
  loadMetadataCache,
  saveMetadataCache,
  computeServerHash,
  isServerCacheValid,
  parseDirectToolSelectors,
  getMissingConfiguredDirectToolServers,
  reconstructToolMetadata,
  createCachedToolSelectorCandidateIndex,
  serializeTools,
  serializeResources,
  serializePrompts,
  reconstructPromptMetadata
};
