// src/config/contracts.ts
var KNOWN_SERVER_PRESETS = [
  {
    id: "deepwiki",
    name: "DeepWiki",
    summary: "Ask questions about public GitHub repositories.",
    entry: { url: "https://mcp.deepwiki.com/mcp", protocolVersion: "auto" }
  },
  {
    id: "context7",
    name: "Context7",
    summary: "Look up current library documentation and examples.",
    entry: { url: "https://mcp.context7.com/mcp", protocolVersion: "auto" }
  },
  {
    id: "notion",
    name: "Notion",
    summary: "Search and work with your Notion workspace.",
    entry: { url: "https://mcp.notion.com/mcp", auth: "oauth", protocolVersion: "auto" }
  },
  {
    id: "github",
    name: "GitHub",
    summary: "Work with GitHub through your Copilot account.",
    entry: { url: "https://api.githubcopilot.com/mcp", auth: "oauth", protocolVersion: "auto" }
  },
  {
    id: "chrome-devtools",
    name: "Chrome DevTools",
    summary: "Inspect and automate a local Chrome browser.",
    entry: { command: "npx", args: ["-y", "chrome-devtools-mcp@1.6.0"] }
  }
];

// src/config/paths.ts
import { existsSync } from "node:fs";
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
function getPiGlobalConfigPath(overridePath) {
  return overridePath ? resolve2(overridePath) : getAgentPath("mcp.json");
}
function getGenericGlobalConfigPath() {
  return GENERIC_GLOBAL_CONFIG_PATH;
}
function getProjectConfigPath(cwd = process.cwd()) {
  return resolve2(cwd, PROJECT_CONFIG_NAME);
}
function getProjectPiConfigPath(cwd = process.cwd()) {
  return resolve2(cwd, getConfigDirName(), PROJECT_PI_CONFIG_NAME);
}
function getConfigDiscoveryPaths(overridePath, cwd = process.cwd()) {
  return getConfigSources(overridePath, cwd).map((source) => ({
    label: source.label,
    path: source.readPath,
    exists: existsSync(source.readPath)
  }));
}
function getConfigSources(overridePath, cwd = process.cwd()) {
  const userPath = getEffectivePiGlobalConfigPath(overridePath);
  const projectPath = getProjectConfigPath(cwd);
  const projectPiPath = getProjectPiConfigPath(cwd);
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
function resolveConfiguredOAuthDir(raw, cwd = process.cwd()) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "string") {
    throw new Error("settings.oauthDir must be a string");
  }
  const trimmed = raw.trim();
  if (!trimmed) return void 0;
  return resolve2(cwd, trimmed);
}

// src/config/package-mcp-loader.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, realpathSync, statSync } from "node:fs";
import { isAbsolute, join as join3, relative, resolve as resolve3, sep } from "node:path";
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
    [join3(cwd, getConfigDirName(), "settings.json"), "project"],
    [join3(getAgentDir(), "settings.json"), "user"]
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
  const baseDir = scope === "user" ? getAgentDir() : join3(cwd, getConfigDirName());
  if (source.startsWith("npm:")) {
    const name = source.slice(4).trim().match(/^(@?[^@]+(?:\/[^@]+)?)/)?.[1];
    return name ? resolveContainedPath(join3(baseDir, "npm", "node_modules"), name) : null;
  }
  const gitSource = source.startsWith("git:") ? source.slice(4).trim() : /^(?:(?:https?|ssh):\/\/|git@[^:]+:)/.test(source) ? source : null;
  if (gitSource) {
    const value = gitSource.replace(/^ssh:\/\/git@/, "").replace(/^git@([^:]+):/, "$1/").replace(/^[a-z]+:\/\//i, "");
    const path = value.replace(/@[^/]+$/, "").replace(/\.git$/, "");
    return path && !path.startsWith("/") ? resolveContainedPath(join3(baseDir, "git"), path) : null;
  }
  return isAbsolute(source) ? resolve3(source) : resolve3(baseDir, source);
}
function readPackageManifest(packageRoot) {
  const manifest = readOptionalJson(join3(packageRoot, "package.json"), `Pi package manifest ${packageRoot}`);
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
    return JSON.parse(stripJsonComments(readFileSync2(path, "utf8"), { trailingCommas: true }));
  } catch (error) {
    throw new Error(`${description} ${path} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
function readOptionalJson(path, description) {
  if (!existsSync2(path)) return void 0;
  return readRequiredJson(path, description);
}
function resolveContainedPath(root, path) {
  const resolved = resolve3(root, path);
  const rel = relative(root, resolved);
  return rel === "" || !rel.startsWith("..") && !rel.startsWith(sep) && !isAbsolute(rel) ? resolved : null;
}
function resolvePackageConfigPath(packageRoot, path) {
  const lexicalPath = resolveContainedPath(packageRoot, path);
  if (!lexicalPath || !existsSync2(lexicalPath) || !statSync(lexicalPath).isFile()) return null;
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
import { existsSync as existsSync3, readFileSync as readFileSync3, statSync as statSync2 } from "node:fs";
import { isAbsolute as isAbsolute2, relative as relative2, resolve as resolve4, sep as sep2 } from "node:path";
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
  const mcpPath = resolve4(pluginRoot, "mcp.json");
  if (!existsSync3(mcpPath)) return { mcpServers: {} };
  if (!statSync2(mcpPath).isFile()) {
    console.warn(`Agent Plugin ${manifest.name} has invalid MCP config: mcp.json is not a regular file`);
    return { mcpServers: {} };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync3(mcpPath, "utf8"));
  } catch (error) {
    console.warn(`Agent Plugin ${manifest.name} has invalid MCP config: failed to parse mcp.json`, error);
    return { mcpServers: {} };
  }
  return translateAgentPluginMcpConfig(raw, manifest, pluginRoot);
}
function readPluginManifest(pluginRoot, report) {
  const manifestPath = resolve4(pluginRoot, "plugin.json");
  if (!existsSync3(manifestPath)) {
    if (report) console.warn(`Agent Plugin at ${pluginRoot} is invalid: missing plugin.json`);
    return null;
  }
  if (!statSync2(manifestPath).isFile()) {
    if (report) console.warn(`Agent Plugin at ${pluginRoot} is invalid: plugin.json is not a regular file`);
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync3(manifestPath, "utf8"));
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
  if (path === "~") return resolve4(process.env.HOME ?? "", ".");
  if (path.startsWith("~/")) return resolve4(process.env.HOME ?? "", path.slice(2));
  return isAbsolute2(path) ? resolve4(path) : resolve4(cwd, path);
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
  const resolved = resolve4(root, value);
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
import { existsSync as existsSync4, readFileSync as readFileSync4 } from "node:fs";
import stripJsonComments2 from "strip-json-comments";
function parseJsonConfig(raw) {
  return JSON.parse(stripJsonComments2(raw, { trailingCommas: true }));
}
function readValidatedConfig(path, label) {
  if (!existsSync4(path)) return null;
  try {
    return validateConfig(parseJsonConfig(readFileSync4(path, "utf-8")));
  } catch (error) {
    console.warn(`Failed to load ${label}:`, error);
    return null;
  }
}
function validateConfig(raw) {
  if (!isRecord(raw)) {
    return { mcpServers: {} };
  }
  return {
    mcpServers: toServerEntries(raw.mcpServers ?? raw["mcp-servers"]),
    ...raw.settings !== void 0 ? { settings: raw.settings } : {}
  };
}
function toServerEntries(servers) {
  if (!isRecord(servers)) return {};
  const entries = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (isServerEntry(entry)) entries[name] = entry;
  }
  return entries;
}
function isServerEntry(value) {
  return isRecord(value);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
function getMergedSettings(overridePath, cwd = process.cwd()) {
  return getMergedSettingsFromSources(loadConfigSources(overridePath, cwd));
}

// src/config/discovery.ts
import { existsSync as existsSync5 } from "node:fs";
import { dirname, join as join4, resolve as resolve5 } from "node:path";
function getConfigSourceSummaries(loadedSources) {
  return loadedSources.map(({ source, config }) => ({
    id: source.id,
    label: source.label,
    path: source.readPath,
    exists: existsSync5(source.readPath),
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
function getMcpDiscoverySummary(overridePath, cwd = process.cwd()) {
  const loadedSources = loadConfigSources(overridePath, cwd);
  const sources = getConfigSourceSummaries(loadedSources);
  const settings = getMergedSettingsFromSources(loadedSources);
  const agentPlugins = isExclusiveConfigMode() ? [] : getAgentPluginSummaries(settings?.agentPluginPaths, cwd);
  const conflicts = getConfigConflicts(loadedSources);
  const totalServerCount = sources.reduce((sum, source) => sum + source.serverCount, 0) + agentPlugins.reduce((sum, plugin) => sum + plugin.serverCount, 0);
  const hasSharedServers = sources.some((source) => source.kind === "shared" && source.serverCount > 0) || agentPlugins.some((plugin) => plugin.serverCount > 0);
  const hasPiOwnedServers = sources.some((source) => source.kind === "pi" && source.serverCount > 0);
  const hasAnyDetectedPaths = sources.some((source) => source.exists) || agentPlugins.length > 0;
  const hasAnyConfig = totalServerCount > 0 || hasAnyDetectedPaths;
  const summaryWithoutRepoPrompt = {
    sources,
    agentPlugins,
    conflicts,
    hasAnyConfig,
    hasAnyDetectedPaths,
    hasSharedServers,
    hasPiOwnedServers,
    totalServerCount
  };
  return {
    ...summaryWithoutRepoPrompt,
    fingerprint: JSON.stringify({
      sources: sources.map((source) => [source.id, source.exists, source.serverCount]),
      agentPlugins: agentPlugins.map((entry) => [entry.path, entry.name, entry.serverCount]),
      conflicts
    }),
    repoPrompt: detectRepoPrompt(summaryWithoutRepoPrompt, cwd, loadedSources)
  };
}
function getConfigConflicts(loadedSources) {
  const seen = /* @__PURE__ */ new Map();
  const record = (name, source) => {
    const entries = seen.get(name) ?? [];
    if (!entries.some((entry) => entry.kind === source.kind && entry.path === source.path)) entries.push(source);
    seen.set(name, entries);
  };
  for (const { source, config } of loadedSources) {
    if (!config) continue;
    for (const name of Object.keys(config.mcpServers)) {
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
  let current = resolve5(cwd);
  while (true) {
    if (existsSync5(join4(current, ".git")) || existsSync5(join4(current, "package.json")) || existsSync5(join4(current, PROJECT_CONFIG_NAME)) || existsSync5(join4(current, ".pi"))) {
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
  const executablePath = REPOPROMPT_BINARY_CANDIDATES.find((candidate) => existsSync5(candidate));
  if (!executablePath) {
    return { configured: false };
  }
  const projectRoot = findProjectRoot(cwd);
  const targetPath = projectRoot ? join4(projectRoot, PROJECT_CONFIG_NAME) : GENERIC_GLOBAL_CONFIG_PATH;
  return {
    configured: false,
    executablePath,
    targetPath,
    serverName: "repoprompt",
    entry: buildRepoPromptEntry(executablePath)
  };
}

// src/config/write.ts
import { existsSync as existsSync6, mkdirSync, readFileSync as readFileSync5, renameSync, writeFileSync } from "node:fs";
import { dirname as dirname2 } from "node:path";

// src/contracts/core.ts
function isServerDisabled(definition) {
  return definition?.disabled === true;
}

// src/config/write.ts
function serializeRawConfig(raw) {
  return `${JSON.stringify(raw, null, 2)}
`;
}
function buildUnifiedDiff(beforeText, afterText) {
  if (beforeText === afterText) return "(no changes)";
  const before = beforeText.split("\n");
  const after = afterText.split("\n");
  const rows = before.length;
  const cols = after.length;
  const lcs = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));
  for (let i2 = rows - 1; i2 >= 0; i2--) {
    for (let j2 = cols - 1; j2 >= 0; j2--) {
      const row = lcs[i2];
      const nextRow = lcs[i2 + 1];
      if (!row || !nextRow) continue;
      row[j2] = before[i2] === after[j2] ? (nextRow[j2 + 1] ?? 0) + 1 : Math.max(nextRow[j2] ?? 0, row[j2 + 1] ?? 0);
    }
  }
  const lines = ["--- before", "+++ after"];
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && before[i] === after[j]) {
      lines.push(`  ${before[i]}`);
      i++;
      j++;
      continue;
    }
    if (j < cols && (i === rows || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))) {
      lines.push(`+ ${after[j]}`);
      j++;
      continue;
    }
    if (i < rows) {
      lines.push(`- ${before[i]}`);
      i++;
    }
  }
  return lines.join("\n");
}
function buildConfigWritePreview(filePath, nextRaw) {
  const existed = existsSync6(filePath);
  const beforeRaw = readRawConfigObject(filePath);
  const beforeText = existed ? serializeRawConfig(beforeRaw) : "";
  const afterText = serializeRawConfig(nextRaw);
  return {
    path: filePath,
    existed,
    changed: beforeText !== afterText,
    beforeText,
    afterText,
    diffText: buildUnifiedDiff(beforeText, afterText)
  };
}
function readRawConfigObject(filePath) {
  if (!existsSync6(filePath)) return {};
  try {
    const raw = parseJsonConfig(readFileSync5(filePath, "utf-8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}
function writeRawConfigObject(filePath, raw) {
  mkdirSync(dirname2(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(raw, null, 2)}
`, "utf-8");
  renameSync(tmpPath, filePath);
}
function getServersObject(raw) {
  const existing = raw.mcpServers ?? raw["mcp-servers"] ?? {};
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return {};
  }
  return existing;
}
function setServersObject(raw, servers) {
  delete raw["mcp-servers"];
  raw.mcpServers = servers;
}
function writeProjectServerDisabledOverride(overridePath, cwd, serverName, disabled) {
  const filePath = getProjectPiConfigPath(cwd);
  let raw = {};
  if (existsSync6(filePath)) {
    try {
      const parsed = parseJsonConfig(readFileSync5(filePath, "utf-8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("root value must be an object");
      }
      raw = parsed;
    } catch (error) {
      throw new Error(`Failed to read project MCP override at ${filePath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  const serverKey = raw.mcpServers !== void 0 ? "mcpServers" : raw["mcp-servers"] !== void 0 ? "mcp-servers" : "mcpServers";
  const rawServers = raw[serverKey];
  if (rawServers !== void 0 && (!rawServers || typeof rawServers !== "object" || Array.isArray(rawServers))) {
    throw new Error(`Failed to update project MCP override at ${filePath}: ${serverKey} must be an object`);
  }
  const servers = rawServers ?? {};
  const previous = servers[serverName];
  if (previous !== void 0 && (!previous || typeof previous !== "object" || Array.isArray(previous))) {
    throw new Error(`Failed to update project MCP override at ${filePath}: server "${serverName}" must be an object`);
  }
  const existing = previous;
  let next;
  if (disabled) {
    next = { ...existing, disabled: true };
  } else {
    next = Object.fromEntries(Object.entries(existing ?? {}).filter(([key]) => key !== "disabled"));
    let lowerConfig = { mcpServers: {} };
    for (const source of getConfigSources(overridePath, cwd)) {
      if (source.readPath === filePath) continue;
      const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
      if (loaded) lowerConfig = mergeConfigs(lowerConfig, loaded);
    }
    if (isServerDisabled(lowerConfig.mcpServers[serverName])) next.disabled = false;
  }
  if (!existing && Object.keys(next).length === 0 || JSON.stringify(existing) === JSON.stringify(next)) {
    return { path: filePath, changed: false };
  }
  if (Object.keys(next).length === 0) delete servers[serverName];
  else servers[serverName] = next;
  raw[serverKey] = servers;
  writeRawConfigObject(filePath, raw);
  return { path: filePath, changed: true };
}
function buildStarterProjectConfig() {
  return {
    mcpServers: {}
  };
}
function previewStarterProjectConfig(cwd = process.cwd()) {
  const targetPath = getProjectConfigPath(cwd);
  const nextRaw = { mcpServers: buildStarterProjectConfig().mcpServers };
  return buildConfigWritePreview(targetPath, nextRaw);
}
function writeStarterProjectConfig(cwd = process.cwd()) {
  const targetPath = getProjectConfigPath(cwd);
  const raw = { mcpServers: buildStarterProjectConfig().mcpServers };
  writeRawConfigObject(targetPath, raw);
  return targetPath;
}
function previewSharedServerEntry(filePath, serverName, entry) {
  const raw = readRawConfigObject(filePath);
  const nextRaw = { ...raw };
  const servers = getServersObject(nextRaw);
  servers[serverName] = entry;
  setServersObject(nextRaw, servers);
  return buildConfigWritePreview(filePath, nextRaw);
}
function writeSharedServerEntry(filePath, serverName, entry) {
  const raw = readRawConfigObject(filePath);
  const servers = getServersObject(raw);
  servers[serverName] = entry;
  setServersObject(raw, servers);
  writeRawConfigObject(filePath, raw);
  return filePath;
}
function getServerProvenance(overridePath, cwd = process.cwd()) {
  const provenance = /* @__PURE__ */ new Map();
  for (const source of getConfigSources(overridePath, cwd)) {
    const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
    if (!loaded) continue;
    for (const name of Object.keys(loaded.mcpServers)) {
      provenance.set(name, {
        path: source.writePath,
        kind: source.kind
      });
    }
  }
  return provenance;
}
function writeDirectToolsConfig(changes, provenance, fullConfig) {
  const byPath = /* @__PURE__ */ new Map();
  for (const [serverName, value] of changes) {
    const prov = provenance.get(serverName);
    if (!prov) continue;
    const targetPath = prov.path;
    if (!byPath.has(targetPath)) byPath.set(targetPath, []);
    byPath.get(targetPath).push({ name: serverName, value, prov });
  }
  for (const [filePath, entries] of byPath) {
    const raw = readRawConfigObject(filePath);
    const servers = getServersObject(raw);
    for (const { name, value, prov } of entries) {
      if (prov.kind === "shared") {
        const fullDef = fullConfig.mcpServers[name];
        if (fullDef) {
          servers[name] = { ...fullDef, directTools: value };
        }
      } else if (servers[name]) {
        servers[name] = { ...servers[name], directTools: value };
      }
    }
    setServersObject(raw, servers);
    writeRawConfigObject(filePath, raw);
  }
}
export {
  AGENTS_GLOBAL_CONFIG_PATHS,
  GENERIC_GLOBAL_CONFIG_PATH,
  KNOWN_SERVER_PRESETS,
  PROJECT_CONFIG_NAME,
  PROJECT_PI_CONFIG_NAME,
  REPOPROMPT_BINARY_CANDIDATES,
  buildStarterProjectConfig,
  cloneMcpConfig,
  getConfigDiscoveryPaths,
  getConfigSources,
  getEffectivePiGlobalConfigPath,
  getGenericGlobalConfigPath,
  getMcpDiscoverySummary,
  getMcpStandardConfigSummary,
  getMergedSettings,
  getMergedSettingsFromSources,
  getPiGlobalConfigPath,
  getProjectConfigPath,
  getProjectPiConfigPath,
  getServerProvenance,
  isExclusiveConfigMode,
  loadConfigSources,
  loadMcpConfig,
  previewSharedServerEntry,
  previewStarterProjectConfig,
  resolveConfiguredOAuthDir,
  writeDirectToolsConfig,
  writeProjectServerDisabledOverride,
  writeSharedServerEntry,
  writeStarterProjectConfig
};
