// src/ui/tool-visibility.ts
function isUiToolVisibleToModel(visibility) {
  return visibility === void 0 || visibility.includes("model");
}

// src/tools/resource-tools.ts
function resourceNameToToolName(name) {
  let result = name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+/, "").replace(/_+$/, "").toLowerCase();
  if (!result || /^\d/.test(result)) {
    result = "resource" + (result ? "_" + result : "");
  }
  return result;
}

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

// src/contracts/core.ts
function isServerDisabled(definition) {
  return definition?.disabled === true || definition?.enabled === false;
}
var MCP_TOOL_APPROVAL_REQUEST_EVENT = "pi-mcp-adapter:tool-approval-request";

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

// src/utils.ts
import { homedir as homedir3, platform } from "node:os";
import { extname, isAbsolute, join as join3 } from "node:path";

// src/config/paths.ts
import { homedir as homedir2 } from "node:os";
import { join as join2, resolve as resolve2 } from "node:path";

// src/config/agent-dir.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
function getConfigDirName() {
  const configDir = readPiConfig()?.configDir;
  return typeof configDir === "string" && configDir.trim() ? configDir.trim() : ".pi";
}
function getAgentDir() {
  const piConfig = readPiConfig();
  const name = piConfig?.name;
  const appName = typeof name === "string" && name.trim() ? name.trim() : "pi";
  const configured = process.env[`${appName.toUpperCase()}_CODING_AGENT_DIR`]?.trim();
  if (!configured) {
    return join(homedir(), getConfigDirName(), "agent");
  }
  if (configured === "~") {
    return homedir();
  }
  if (configured.startsWith("~/")) {
    return resolve(homedir(), configured.slice(2));
  }
  return resolve(configured);
}
function getAgentPath(...segments) {
  return join(getAgentDir(), ...segments);
}
function readPiConfig() {
  const dir = process.env.PI_PACKAGE_DIR?.trim();
  if (!dir) return void 0;
  try {
    const manifest = JSON.parse(readFileSync(join(resolve(dir), "package.json"), "utf8"));
    return manifest.piConfig;
  } catch {
    return void 0;
  }
}

// src/config/paths.ts
var GENERIC_GLOBAL_CONFIG_PATH = join2(homedir2(), ".config", "mcp", "mcp.json");
var AGENTS_GLOBAL_CONFIG_PATHS = [
  join2(homedir2(), ".agents", "mcp.json"),
  join2(homedir2(), ".agents", "mcp", "mcp.json")
];
var PROJECT_CONFIG_NAME = ".mcp.json";
var PROJECT_PI_CONFIG_NAME = "mcp.json";
var REPOPROMPT_BINARY_CANDIDATES = [
  join2(homedir2(), "RepoPrompt", "repoprompt_cli"),
  "/Applications/Repo Prompt.app/Contents/MacOS/repoprompt-mcp"
];
function getConfigPathFromArgv(argv = process.argv) {
  const index = argv.indexOf("--mcp-config");
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : void 0;
}
function getPiGlobalConfigPath(overridePath) {
  return overridePath ? resolve2(overridePath) : getAgentPath("mcp.json");
}
function getProjectConfigPath(cwd = process.cwd()) {
  return resolve2(cwd, PROJECT_CONFIG_NAME);
}
function getProjectPiConfigPath(cwd = process.cwd()) {
  return resolve2(cwd, getConfigDirName(), PROJECT_PI_CONFIG_NAME);
}
function getConfigSources(overridePath, cwd = process.cwd()) {
  const userPath = getEffectivePiGlobalConfigPath(overridePath);
  const projectPath = getProjectConfigPath(cwd);
  const projectPiPath = getProjectPiConfigPath(cwd);
  const projectAgentsPaths = [
    resolve2(cwd, ".agents", "mcp.json"),
    resolve2(cwd, ".agents", "mcp", "mcp.json")
  ];
  const sources = [];
  if (isExclusiveConfigMode()) {
    return [{
      id: "pi-global",
      label: "Pi exclusive config",
      readPath: userPath,
      writePath: userPath,
      kind: "user",
      shared: false,
      scope: "global"
    }];
  }
  if (GENERIC_GLOBAL_CONFIG_PATH !== userPath) {
    sources.push({
      id: "shared-global",
      label: "user-global standard MCP",
      readPath: GENERIC_GLOBAL_CONFIG_PATH,
      writePath: userPath,
      kind: "shared",
      shared: true,
      scope: "global"
    });
  }
  for (const [index, agentsPath] of AGENTS_GLOBAL_CONFIG_PATHS.entries()) {
    if (agentsPath === userPath || agentsPath === GENERIC_GLOBAL_CONFIG_PATH) continue;
    sources.push({
      id: index === 0 ? "agents-global" : "agents-nested-global",
      label: index === 0 ? "user-global .agents MCP" : "user-global .agents nested MCP",
      readPath: agentsPath,
      writePath: userPath,
      kind: "shared",
      shared: true,
      scope: "global"
    });
  }
  sources.push({
    id: "pi-global",
    label: "Pi global override",
    readPath: userPath,
    writePath: userPath,
    kind: "user",
    shared: false,
    scope: "global"
  });
  if (projectPath !== userPath) {
    sources.push({
      id: "shared-project",
      label: "project standard MCP",
      readPath: projectPath,
      writePath: projectPath,
      kind: "project",
      shared: true,
      scope: "project"
    });
  }
  for (const [index, agentsPath] of projectAgentsPaths.entries()) {
    if ([userPath, projectPath, projectPiPath, GENERIC_GLOBAL_CONFIG_PATH, ...AGENTS_GLOBAL_CONFIG_PATHS].includes(agentsPath)) continue;
    sources.push({
      id: index === 0 ? "agents-project" : "agents-nested-project",
      label: index === 0 ? "project .agents MCP" : "project .agents nested MCP",
      readPath: agentsPath,
      writePath: agentsPath,
      kind: "project",
      shared: true,
      scope: "project"
    });
  }
  if (projectPiPath !== userPath && projectPiPath !== projectPath) {
    sources.push({
      id: "pi-project",
      label: "project Pi override",
      readPath: projectPiPath,
      writePath: projectPiPath,
      kind: "project",
      shared: false,
      scope: "project"
    });
  }
  return sources;
}
function isExclusiveConfigMode() {
  return process.env.PI_MCP_CONFIG_MODE?.trim().toLowerCase() === "exclusive";
}
function getEffectivePiGlobalConfigPath(overridePath) {
  return getPiGlobalConfigPath(isExclusiveConfigMode() ? void 0 : overridePath);
}

// src/utils.ts
async function execOpen(pi, target, browser, signal) {
  const os = platform();
  if (os === "darwin") {
    if (browser) {
      return isAbsolute(browser) && extname(browser).toLowerCase() !== ".app" ? pi.exec(browser, [target], signal ? { signal } : {}) : pi.exec("open", ["-a", browser, target], signal ? { signal } : {});
    }
    return pi.exec("open", [target], signal ? { signal } : {});
  }
  if (os === "win32") {
    return browser ? pi.exec("cmd", ["/c", "start", "", browser, target], signal ? { signal } : {}) : pi.exec("cmd", ["/c", "start", "", target], signal ? { signal } : {});
  }
  return browser ? pi.exec(browser, [target], signal ? { signal } : {}) : pi.exec("xdg-open", [target], signal ? { signal } : {});
}
async function openUrl(pi, url, browser, signal) {
  const result = await execOpen(pi, url, browser, signal);
  if (result.code !== 0) {
    throw new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);
  }
}
function interpolateEnvVars(value, environment = process.env) {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => environment[name] ?? "").replace(/\$env:(\w+)/g, (_, name) => environment[name] ?? "").replace(/\{env:(\w+)\}/g, (_, name) => environment[name] ?? "");
}
function getMissingEnvVars(value, environment) {
  const missing = /* @__PURE__ */ new Set();
  for (const match of value.matchAll(/\$\{(\w+)\}|\$env:(\w+)|\{env:(\w+)\}/g)) {
    const name = match[1] ?? match[2] ?? match[3];
    if (name && environment[name] === void 0) {
      missing.add(name);
    }
  }
  return [...missing];
}
function interpolateSecretExpression(value, environment) {
  if (value.startsWith("!!")) return interpolateEnvVars(value.slice(1), environment);
  return value.startsWith("!") ? value : interpolateEnvVars(value, environment);
}
function interpolateEnvRecord(values, environment = process.env) {
  if (!values) return void 0;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    interpolateSecretExpression(value, environment)
  ]));
}
var COMMAND_SECRET_MAX_OUTPUT_BYTES = 1024 * 1024;
function resolveServerUrl(definition, environment = process.env) {
  if (definition.url == null) return void 0;
  if (typeof definition.url !== "string") {
    throw new Error("MCP server URL must be a string");
  }
  const missing = getMissingEnvVars(definition.url, environment);
  if (missing.length > 0) {
    throw new Error(`Missing environment variable${missing.length === 1 ? "" : "s"} in MCP server URL: ${missing.join(", ")}`);
  }
  const resolved = interpolateEnvVars(definition.url, environment);
  try {
    new URL(resolved);
  } catch (error) {
    throw new Error(`Invalid MCP server URL after environment interpolation: ${resolved}`, { cause: error });
  }
  return resolved;
}
function resolveConfigPath(value, environment = process.env) {
  if (value === void 0) return void 0;
  const resolved = interpolateEnvVars(value, environment);
  if (resolved === "~") return homedir3();
  if (resolved.startsWith("~/") || resolved.startsWith("~\\")) {
    return join3(homedir3(), resolved.slice(2));
  }
  return resolved;
}
function resolveBearerToken(definition, environment = process.env) {
  if (definition.bearerToken !== void 0) {
    return interpolateSecretExpression(definition.bearerToken, environment);
  }
  return definition.bearerTokenEnv ? environment[definition.bearerTokenEnv] : void 0;
}
function stripOscSequences(text) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const isEscOsc = text.charCodeAt(index) === 27 && text[index + 1] === "]";
    const isC1Osc = text.charCodeAt(index) === 157;
    if (!isEscOsc && !isC1Osc) {
      result += text[index++];
      continue;
    }
    index += isEscOsc ? 2 : 1;
    while (index < text.length) {
      const code = text.charCodeAt(index++);
      if (code === 7 || code === 156) break;
      if (code === 27 && text[index] === "\\") {
        index++;
        break;
      }
    }
  }
  return result;
}
function sanitizeTerminalText(text) {
  return stripOscSequences(text).replace(/(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_])/g, "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
}

// src/catalog/metadata-cache.ts
import { existsSync, readFileSync as readFileSync2, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
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
    const raw = JSON.parse(readFileSync2(cachePath, "utf-8"));
    if (!raw || typeof raw !== "object") return null;
    if (raw.version !== CACHE_VERSION) return null;
    if (!raw.servers || typeof raw.servers !== "object") return null;
    return raw;
  } catch {
    return null;
  }
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

export {
  isUiToolVisibleToModel,
  resourceNameToToolName,
  getConfigDirName,
  getAgentDir,
  getAgentPath,
  formatToolName,
  resolveToolPrefix,
  getToolNameCandidates,
  isServerDisabled,
  MCP_TOOL_APPROVAL_REQUEST_EVENT,
  isToolAllowed,
  getConfigPathFromArgv,
  getProjectPiConfigPath,
  getConfigSources,
  isExclusiveConfigMode,
  openUrl,
  stripOscSequences,
  sanitizeTerminalText,
  createMetadataCatalogSnapshot,
  computeServerHash,
  isServerCacheValid,
  parseDirectToolSelectors,
  createCachedToolSelectorCandidateIndex
};
