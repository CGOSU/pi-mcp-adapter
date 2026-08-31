import {
  mergeConfigs,
  readValidatedConfig
} from "./chunk-YZ65OQRG.js";
import {
  getConfigSources,
  isExclusiveConfigMode
} from "./chunk-KNN6K7BJ.js";
import {
  getAgentDir,
  getAgentPath,
  getConfigDirName
} from "./chunk-ELOBWFRH.js";

// src/config/package-mcp-loader.ts
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import stripJsonComments from "strip-json-comments";
function loadPackageMcpConfigs(cwd = process.cwd()) {
  const mcpServers = {};
  const seen = /* @__PURE__ */ new Set();
  for (const packageRoot of getConfiguredPackageRoots(cwd)) {
    const manifest = readPackageManifest(packageRoot);
    if (!manifest || typeof manifest.name !== "string" || !manifest.name) continue;
    const paths = getManifestMcpPaths(manifest.pi?.mcp, manifest.name);
    if (!paths) continue;
    const packagePrefix = formatPackageName(manifest.name);
    const packageServers = /* @__PURE__ */ new Set();
    for (const path of paths) {
      const configPath = resolvePackageConfigPath(packageRoot, path);
      if (!configPath) {
        console.warn(`Pi package ${manifest.name} skips MCP config ${path}: file must stay inside the package`);
        continue;
      }
      const config = readMcpConfig(configPath, manifest.name);
      if (!config) continue;
      for (const [serverName, server] of Object.entries(config.mcpServers)) {
        const normalizedName = `${packagePrefix}__${formatServerName(serverName)}`;
        if (packageServers.has(normalizedName) || seen.has(normalizedName)) {
          console.warn(`Pi package ${manifest.name} skips duplicate normalized MCP server ${normalizedName}`);
          continue;
        }
        packageServers.add(normalizedName);
        seen.add(normalizedName);
        mcpServers[normalizedName] = server;
      }
    }
  }
  return { mcpServers };
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
      if (root && !roots.includes(root)) roots.push(root);
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
    if (!server || typeof server !== "object" || Array.isArray(server)) {
      throw new Error(`Pi package ${packageName} MCP config ${path} server ${name} must be a JSON object`);
    }
    mcpServers[name] = server;
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
function loadAgentPluginConfigs(paths, cwd = process.cwd()) {
  const mcpServers = {};
  for (const pluginPath of getPluginPaths(paths)) {
    const loaded = loadAgentPluginMcpConfig(pluginPath, cwd);
    if (!loaded) continue;
    for (const [serverName, server] of Object.entries(loaded.mcpServers)) {
      if (mcpServers[serverName]) {
        console.warn(`Agent Plugin at ${resolvePluginPath(pluginPath, cwd)} skips duplicate normalized MCP server ${serverName}`);
        continue;
      }
      mcpServers[serverName] = server;
    }
  }
  return { mcpServers };
}
function getAgentPluginSummaries(paths, cwd = process.cwd()) {
  return getPluginPaths(paths).map((path) => {
    const pluginRoot = resolvePluginPath(path, cwd);
    const loaded = loadAgentPluginMcpConfig(path, cwd);
    const manifest = loaded ? readPluginManifest(pluginRoot, false) : null;
    return {
      path: pluginRoot,
      ...manifest?.name ? { name: manifest.name } : {},
      serverCount: loaded ? Object.keys(loaded.mcpServers).length : 0
    };
  });
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
    if (mcpServers[normalizedName]) {
      console.warn(`Agent Plugin ${manifest.name} skips invalid MCP server ${serverName}: normalized server name ${normalizedName} already exists`);
      continue;
    }
    mcpServers[normalizedName] = translated;
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

// src/config/load.ts
function loadConfigSources(overridePath, cwd = process.cwd()) {
  return getConfigSources(overridePath, cwd).map((source) => ({
    source,
    config: readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`)
  }));
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
function loadMcpConfig(overridePath, cwd = process.cwd()) {
  const loadedSources = loadConfigSources(overridePath, cwd);
  let config = { mcpServers: {} };
  for (const { config: loaded } of loadedSources) {
    if (!loaded) continue;
    config = mergeConfigs(config, loaded);
  }
  if (isExclusiveConfigMode()) return config;
  const packageConfig = loadPackageMcpConfigs(cwd);
  const pluginConfig = loadAgentPluginConfigs(config.settings?.agentPluginPaths, cwd);
  const packageServers = Object.fromEntries(
    Object.entries(packageConfig.mcpServers).filter(([name]) => !Object.hasOwn(pluginConfig.mcpServers, name))
  );
  return mergeConfigs({ mcpServers: packageServers }, mergeConfigs(pluginConfig, config));
}

// src/extension/failure-backoff.ts
var FAILURE_BACKOFF_MS = 60 * 1e3;
function getFailureAgeSeconds(state, serverName) {
  const failedAt = state.failureTracker.get(serverName);
  if (!failedAt) return null;
  const ageMs = Date.now() - failedAt;
  if (ageMs > FAILURE_BACKOFF_MS) return null;
  return Math.round(ageMs / 1e3);
}
function getFailureMessage(state, serverName) {
  if (getFailureAgeSeconds(state, serverName) === null) return null;
  return state.failureMessages?.get(serverName) ?? null;
}
function isServerInActiveFailureBackoff(state, serverName) {
  const connection = state.manager.getConnection(serverName);
  return connection?.status !== "connected" && connection?.status !== "needs-auth" && getFailureAgeSeconds(state, serverName) !== null;
}

// src/logger.ts
var LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
var LEVEL_PREFIX = {
  debug: "[MCP-UI:DEBUG]",
  info: "[MCP-UI]",
  warn: "[MCP-UI:WARN]",
  error: "[MCP-UI:ERROR]"
};
var Logger = class {
  minLevel = "info";
  handlers = [];
  defaultContext = {};
  setLevel(level) {
    this.minLevel = level;
  }
  setDefaultContext(context) {
    this.defaultContext = context;
  }
  addHandler(handler) {
    this.handlers.push(handler);
  }
  clearHandlers() {
    this.handlers = [];
  }
  shouldLog(level) {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }
  emit(level, message, context, error) {
    if (!this.shouldLog(level)) return;
    const entry = {
      level,
      message,
      context: { ...this.defaultContext, ...context },
      ...error !== void 0 ? { error } : {},
      timestamp: /* @__PURE__ */ new Date()
    };
    const prefix = LEVEL_PREFIX[level];
    const contextStr = formatContext(entry.context);
    const fullMessage = contextStr ? `${prefix} ${message} ${contextStr}` : `${prefix} ${message}`;
    if (level === "error") {
      console.error(fullMessage, error ?? "");
    } else if (level === "warn") {
      console.warn(fullMessage);
    } else if (level === "debug") {
      console.debug(fullMessage);
    } else {
      console.log(fullMessage);
    }
    for (const handler of this.handlers) {
      try {
        handler(entry);
      } catch {
      }
    }
  }
  debug(message, context) {
    this.emit("debug", message, context);
  }
  info(message, context) {
    this.emit("info", message, context);
  }
  warn(message, context) {
    this.emit("warn", message, context);
  }
  error(message, error, context) {
    this.emit("error", message, context, error);
  }
  /**
   * Create a child logger with additional default context.
   */
  child(context) {
    return new ChildLogger(this, context);
  }
};
var ChildLogger = class _ChildLogger {
  constructor(parent, context) {
    this.parent = parent;
    this.context = context;
  }
  parent;
  context;
  debug(message, context) {
    this.parent.debug(message, { ...this.context, ...context });
  }
  info(message, context) {
    this.parent.info(message, { ...this.context, ...context });
  }
  warn(message, context) {
    this.parent.warn(message, { ...this.context, ...context });
  }
  error(message, error, context) {
    this.parent.error(message, error, { ...this.context, ...context });
  }
  child(context) {
    return new _ChildLogger(this.parent, { ...this.context, ...context });
  }
};
function formatContext(context) {
  if (!context || Object.keys(context).length === 0) return "";
  const parts = [];
  for (const [key, value] of Object.entries(context)) {
    if (value !== void 0 && value !== null) {
      parts.push(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
  }
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}
var logger = new Logger();
if (process.env.MCP_UI_DEBUG === "1" || process.env.MCP_UI_DEBUG === "true") {
  logger.setLevel("debug");
}

// src/contracts/status.ts
var MCP_STATUS_EVENT = "pi-mcp-adapter/status/v1";
var MCP_STATUS_SNAPSHOT_VERSION = 1;

// src/extension/status.ts
function createMcpStatusSnapshot(state) {
  const servers = [];
  let totalTools = 0;
  let totalResources = 0;
  let connectedCount = 0;
  let disabledCount = 0;
  for (const name of Object.keys(state.config.mcpServers)) {
    const definition = state.config.mcpServers[name];
    const disabled = definition?.disabled === true;
    const connection = disabled ? void 0 : state.manager.getConnection(name);
    const failedAgoSeconds = disabled ? null : getFailureAgeSeconds(state, name);
    const activeFailure = !disabled && isServerInActiveFailureBackoff(state, name);
    const metadata = disabled || activeFailure ? void 0 : state.toolMetadata.get(name);
    const toolCount = metadata?.length ?? (connection?.status === "connected" ? connection.tools.length : 0);
    const resourceCount = disabled || activeFailure ? void 0 : state.resourceCounts?.get(name) ?? (connection?.status === "connected" ? connection.resources.length : void 0);
    let status = "not-connected";
    if (disabled) {
      status = "disabled";
      disabledCount++;
    } else if (connection?.status === "connected") {
      status = "connected";
      connectedCount++;
    } else if (connection?.status === "needs-auth") {
      status = "needs-auth";
    } else if (activeFailure) {
      status = "failed";
    } else if (metadata !== void 0) {
      status = "cached";
    }
    totalTools += disabled ? 0 : toolCount;
    if (!disabled && resourceCount !== void 0) totalResources += resourceCount;
    servers.push({
      name,
      status,
      toolCount,
      ...resourceCount !== void 0 ? { resourceCount } : {},
      ...status === "failed" && failedAgoSeconds !== null ? { failedAgoSeconds } : {},
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
function publishMcpStatusSnapshot(state, snapshot) {
  const events = state.statusEvents;
  if (!events) return;
  try {
    events.emit(MCP_STATUS_EVENT, snapshot ?? createMcpStatusSnapshot(state));
  } catch {
  }
}
function publishMcpStatusShutdown(events) {
  if (!events) return;
  try {
    events.emit(MCP_STATUS_EVENT, {
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

export {
  getAgentPluginSummaries,
  loadConfigSources,
  getMergedSettingsFromSources,
  cloneMcpConfig,
  loadMcpConfig,
  FAILURE_BACKOFF_MS,
  getFailureAgeSeconds,
  getFailureMessage,
  isServerInActiveFailureBackoff,
  logger,
  MCP_STATUS_EVENT,
  MCP_STATUS_SNAPSHOT_VERSION,
  publishMcpStatusSnapshot,
  publishMcpStatusShutdown
};
