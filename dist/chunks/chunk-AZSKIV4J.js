import {
  IMPORT_PATHS,
  getConfigSources,
  isExclusiveConfigMode
} from "./chunk-PI2QHUXN.js";
import {
  toStringRecord
} from "./chunk-Z3P2QPCB.js";
import {
  getAgentDir,
  getAgentPath,
  getConfigDirName
} from "./chunk-ELOBWFRH.js";

// src/config/read.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import stripJsonComments from "strip-json-comments";
function resolveImportCandidates(importKind, cwd) {
  return (IMPORT_PATHS[importKind] ?? []).map((candidate) => {
    if (importKind === "opencode" && candidate === "./opencode.json") {
      const start = resolve(cwd);
      let gitRoot;
      let current = start;
      while (true) {
        if (existsSync(join(current, ".git"))) {
          gitRoot = current;
          break;
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
      if (!gitRoot) return join(start, "opencode.json");
      current = start;
      while (true) {
        const projectConfig = join(current, "opencode.json");
        if (existsSync(projectConfig) || current === gitRoot) return projectConfig;
        current = dirname(current);
      }
    }
    return candidate.startsWith(".") ? resolve(cwd, candidate) : candidate;
  });
}
function parseJsonConfig(raw) {
  return JSON.parse(stripJsonComments(raw, { trailingCommas: true }));
}
function readImportedConfig(path) {
  const raw = readFileSync(path, "utf-8");
  return path.endsWith(".toml") ? parseToml(raw) : parseJsonConfig(raw);
}
function loadImportedConfig(importKind, cwd, warningPrefix) {
  if (importKind === "opencode") {
    let merged = {};
    let highestPrecedencePath;
    for (const path of resolveImportCandidates(importKind, cwd)) {
      if (!existsSync(path)) continue;
      try {
        const value = readImportedConfig(path);
        if (value && typeof value === "object" && !Array.isArray(value)) {
          merged = mergeOpenCodeConfigs(merged, value);
          highestPrecedencePath = path;
        }
      } catch (error) {
        console.warn(warningPrefix, error);
      }
    }
    return highestPrecedencePath ? { path: highestPrecedencePath, value: merged } : null;
  }
  for (const path of resolveImportCandidates(importKind, cwd)) {
    if (!existsSync(path)) continue;
    try {
      return { path, value: readImportedConfig(path) };
    } catch (error) {
      console.warn(warningPrefix, error);
    }
  }
  return null;
}
function readValidatedConfig(path, label) {
  if (!existsSync(path)) return null;
  try {
    return validateConfig(parseJsonConfig(readFileSync(path, "utf-8")));
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
    ...Array.isArray(raw.imports) ? { imports: raw.imports } : {},
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
function mergeOpenCodeConfigs(base, next) {
  const baseMcp = base.mcp;
  const nextMcp = next.mcp;
  const mergedMcp = {
    ...baseMcp && typeof baseMcp === "object" && !Array.isArray(baseMcp) ? baseMcp : {}
  };
  if (nextMcp && typeof nextMcp === "object" && !Array.isArray(nextMcp)) {
    for (const [name, nextEntry] of Object.entries(nextMcp)) {
      const baseEntry = mergedMcp[name];
      if (baseEntry && typeof baseEntry === "object" && !Array.isArray(baseEntry) && nextEntry && typeof nextEntry === "object" && !Array.isArray(nextEntry)) {
        const safeBase = { ...baseEntry };
        const override = nextEntry;
        if (typeof override.type === "string" && override.type !== safeBase.type) {
          for (const field of ["command", "environment", "cwd", "url", "headers", "oauth"]) delete safeBase[field];
        }
        if (typeof override.url === "string" && override.url !== safeBase.url) {
          delete safeBase.headers;
          delete safeBase.oauth;
        }
        if (Array.isArray(override.command)) {
          const baseCommand = safeBase.command;
          const commandChanged = !Array.isArray(baseCommand) || override.command.length !== baseCommand.length || override.command.some((value, index) => value !== baseCommand[index]);
          if (commandChanged) {
            delete safeBase.environment;
            delete safeBase.cwd;
          }
        }
        const mergedEntry = { ...safeBase, ...override };
        for (const field of ["environment", "headers", "oauth"]) {
          const baseField = safeBase[field];
          const nextField = override[field];
          if (baseField && typeof baseField === "object" && !Array.isArray(baseField) && nextField && typeof nextField === "object" && !Array.isArray(nextField)) {
            mergedEntry[field] = { ...baseField, ...nextField };
          }
        }
        mergedMcp[name] = mergedEntry;
      } else {
        mergedMcp[name] = nextEntry;
      }
    }
  }
  return { ...base, ...next, mcp: mergedMcp };
}
function extractServers(config, kind) {
  if (!config || typeof config !== "object") return {};
  const obj = config;
  let servers;
  switch (kind) {
    case "claude-desktop":
    case "claude-code":
      servers = obj.mcpServers;
      break;
    case "codex":
      servers = obj.mcp_servers ?? obj.mcpServers;
      break;
    case "cursor":
    case "windsurf":
    case "vscode":
      servers = obj.mcpServers ?? obj["mcp-servers"];
      break;
    case "opencode":
      servers = obj.mcp;
      break;
    default:
      return {};
  }
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return {};
  }
  const mappedServers = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (kind === "opencode") {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const raw = entry;
      if (raw.enabled === false) continue;
      if (raw.type === "local" && Array.isArray(raw.command) && raw.command.length > 0 && raw.command.every((value) => typeof value === "string")) {
        const env = toStringRecord(raw.environment);
        const command = raw.command[0];
        if (command === void 0) continue;
        const mapped2 = {
          command,
          args: raw.command.slice(1),
          ...env ? { env } : {},
          ...typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}
        };
        mappedServers[name] = mapped2;
        continue;
      }
      if (raw.type === "remote" && typeof raw.url === "string") {
        const headers = toStringRecord(raw.headers);
        const mapped2 = {
          url: raw.url,
          ...headers ? { headers } : {}
        };
        if (raw.oauth === false) {
          mapped2.oauth = false;
        } else if (raw.oauth && typeof raw.oauth === "object" && !Array.isArray(raw.oauth)) {
          const oauth = raw.oauth;
          mapped2.auth = "oauth";
          mapped2.oauth = {
            ...typeof oauth.clientId === "string" ? { clientId: oauth.clientId } : {},
            ...typeof oauth.clientSecret === "string" ? { clientSecret: oauth.clientSecret } : {},
            ...typeof oauth.scope === "string" ? { scope: oauth.scope } : {},
            ...typeof oauth.skipIssuerMetadataValidation === "boolean" ? { skipIssuerMetadataValidation: oauth.skipIssuerMetadataValidation } : {}
          };
        }
        mappedServers[name] = mapped2;
      }
      continue;
    }
    if (!isRecord(entry)) continue;
    if (kind !== "codex") {
      mappedServers[name] = entry;
      continue;
    }
    const mapped = { ...entry };
    const bearerTokenEnv = mapped.bearer_token_env_var;
    const httpHeaders = mapped.http_headers;
    const envHttpHeaders = mapped.env_http_headers;
    if (typeof bearerTokenEnv === "string") {
      mapped.bearerTokenEnv = bearerTokenEnv;
      if (mapped.auth === void 0) mapped.auth = "bearer";
    }
    if (httpHeaders && typeof httpHeaders === "object" && !Array.isArray(httpHeaders)) {
      mapped.headers = { ...mapped.headers, ...httpHeaders };
    }
    if (envHttpHeaders && typeof envHttpHeaders === "object" && !Array.isArray(envHttpHeaders)) {
      const headers = { ...mapped.headers };
      for (const [header, envVar] of Object.entries(envHttpHeaders)) {
        if (typeof envVar === "string" && headers[header] === void 0) headers[header] = `$env:${envVar}`;
      }
      mapped.headers = headers;
    }
    delete mapped.bearer_token_env_var;
    delete mapped.http_headers;
    delete mapped.env_http_headers;
    mappedServers[name] = mapped;
  }
  return mappedServers;
}

// src/config/merge.ts
function mergeConfigs(base, next) {
  const imports = mergeImports(base.imports, next.imports);
  const settings = next.settings ? { ...base.settings, ...next.settings } : base.settings;
  return {
    mcpServers: mergeServerMaps(base.mcpServers, next.mcpServers),
    ...imports !== void 0 ? { imports } : {},
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
function mergeImports(left, right) {
  const merged = [...left ?? [], ...right ?? []];
  if (merged.length === 0) return void 0;
  return [...new Set(merged)];
}
function expandImports(config, cwd = process.cwd()) {
  if (!config.imports?.length) return config;
  const importedServers = {};
  for (const importKind of config.imports) {
    const imported = loadImportedConfig(importKind, cwd, `Failed to import MCP config from ${importKind}:`);
    if (!imported) continue;
    const servers = extractServers(imported.value, importKind);
    for (const [name, definition] of Object.entries(servers)) {
      if (!importedServers[name]) {
        importedServers[name] = definition;
      }
    }
  }
  return {
    imports: config.imports,
    ...config.settings !== void 0 ? { settings: config.settings } : {},
    mcpServers: mergeServerMaps(importedServers, config.mcpServers)
  };
}

// src/config/package-mcp-loader.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, realpathSync, statSync } from "node:fs";
import { isAbsolute, join as join2, relative, resolve as resolve2, sep } from "node:path";
import stripJsonComments2 from "strip-json-comments";
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
    [join2(cwd, getConfigDirName(), "settings.json"), "project"],
    [join2(getAgentDir(), "settings.json"), "user"]
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
  const baseDir = scope === "user" ? getAgentDir() : join2(cwd, getConfigDirName());
  if (source.startsWith("npm:")) {
    const name = source.slice(4).trim().match(/^(@?[^@]+(?:\/[^@]+)?)/)?.[1];
    return name ? resolveContainedPath(join2(baseDir, "npm", "node_modules"), name) : null;
  }
  const gitSource = source.startsWith("git:") ? source.slice(4).trim() : /^(?:(?:https?|ssh):\/\/|git@[^:]+:)/.test(source) ? source : null;
  if (gitSource) {
    const value = gitSource.replace(/^ssh:\/\/git@/, "").replace(/^git@([^:]+):/, "$1/").replace(/^[a-z]+:\/\//i, "");
    const path = value.replace(/@[^/]+$/, "").replace(/\.git$/, "");
    return path && !path.startsWith("/") ? resolveContainedPath(join2(baseDir, "git"), path) : null;
  }
  return isAbsolute(source) ? resolve2(source) : resolve2(baseDir, source);
}
function readPackageManifest(packageRoot) {
  const manifest = readOptionalJson(join2(packageRoot, "package.json"), `Pi package manifest ${packageRoot}`);
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
    return JSON.parse(stripJsonComments2(readFileSync2(path, "utf8"), { trailingCommas: true }));
  } catch (error) {
    throw new Error(`${description} ${path} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
function readOptionalJson(path, description) {
  if (!existsSync2(path)) return void 0;
  return readRequiredJson(path, description);
}
function resolveContainedPath(root, path) {
  const resolved = resolve2(root, path);
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
import { isAbsolute as isAbsolute2, relative as relative2, resolve as resolve3, sep as sep2 } from "node:path";
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
  const mcpPath = resolve3(pluginRoot, "mcp.json");
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
  const manifestPath = resolve3(pluginRoot, "plugin.json");
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
  if (path === "~") return resolve3(process.env.HOME ?? "", ".");
  if (path.startsWith("~/")) return resolve3(process.env.HOME ?? "", path.slice(2));
  return isAbsolute2(path) ? resolve3(path) : resolve3(cwd, path);
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
  const resolved = resolve3(root, value);
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
function getConfiguredHostConfigDiscoveryFromSources(sources) {
  const value = getMergedSettingsFromSources(sources)?.hostConfigDiscovery;
  return value === "off" || value === "prompt" || value === "on" ? value : "off";
}
function cloneMcpConfig(config) {
  return structuredClone(config);
}
function loadMcpConfig(overridePath, cwd = process.cwd()) {
  const loadedSources = loadConfigSources(overridePath, cwd);
  const hostConfigDiscovery = getConfiguredHostConfigDiscoveryFromSources(loadedSources);
  let config = !isExclusiveConfigMode() && hostConfigDiscovery === "on" ? loadDiscoveredHostConfigs(cwd) : { mcpServers: {} };
  for (const { config: loaded } of loadedSources) {
    if (!loaded) continue;
    config = mergeConfigs(config, expandImports(loaded, cwd));
  }
  if (isExclusiveConfigMode()) return config;
  const packageConfig = loadPackageMcpConfigs(cwd);
  const pluginConfig = loadAgentPluginConfigs(config.settings?.agentPluginPaths, cwd);
  const packageServers = Object.fromEntries(
    Object.entries(packageConfig.mcpServers).filter(([name]) => !Object.hasOwn(pluginConfig.mcpServers, name))
  );
  return mergeConfigs({ mcpServers: packageServers }, mergeConfigs(pluginConfig, config));
}
function getConfiguredHostConfigDiscovery(overridePath, cwd = process.cwd()) {
  return getConfiguredHostConfigDiscoveryFromSources(loadConfigSources(overridePath, cwd));
}
function loadDiscoveredHostConfigs(cwd) {
  let config = { mcpServers: {} };
  for (const importKind of Object.keys(IMPORT_PATHS)) {
    const imported = loadImportedConfig(importKind, cwd, `Failed to discover imported MCP config from ${importKind}:`);
    if (!imported) continue;
    config = mergeConfigs(config, {
      mcpServers: extractServers(imported.value, importKind)
    });
  }
  return config;
}

export {
  getAgentPluginSummaries,
  parseJsonConfig,
  loadImportedConfig,
  readValidatedConfig,
  extractServers,
  mergeConfigs,
  expandImports,
  loadConfigSources,
  getMergedSettingsFromSources,
  getConfiguredHostConfigDiscoveryFromSources,
  cloneMcpConfig,
  loadMcpConfig,
  getConfiguredHostConfigDiscovery
};
