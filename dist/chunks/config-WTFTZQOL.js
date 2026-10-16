import {
  AGENTS_GLOBAL_CONFIG_PATHS,
  GENERIC_GLOBAL_CONFIG_PATH,
  PROJECT_CONFIG_NAME,
  PROJECT_PI_CONFIG_NAME,
  REPOPROMPT_BINARY_CANDIDATES,
  getAgentDir,
  getAgentPath,
  getConfigDirName,
  getConfigDiscoveryPaths,
  getConfigPathFromArgv,
  getConfigSources,
  getEffectivePiGlobalConfigPath,
  getGenericGlobalConfigPath,
  getPiGlobalConfigPath,
  getProjectConfigPath,
  getProjectPiConfigPath,
  isExclusiveConfigMode,
  resolveConfiguredOAuthDir
} from "./chunk-3XMWBHNW.js";

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
function loadPackageMcpConfigs(cwd = process.cwd()) {
  const mcpServers = {};
  for (const source of loadPackageMcpConfigSources(cwd)) Object.assign(mcpServers, source.config.mcpServers);
  return { mcpServers };
}
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
import { existsSync as existsSync4 } from "node:fs";
import { dirname, join as join2, resolve as resolve3 } from "node:path";
function getConfigSourceSummaries(loadedSources) {
  return loadedSources.map(({ source, config, error, validationIssues }) => ({
    id: source.id,
    label: source.label,
    path: source.readPath,
    exists: existsSync4(source.readPath),
    scope: source.scope,
    kind: source.shared ? "shared" : "pi",
    serverCount: config ? Object.keys(config.mcpServers).length : 0,
    ...error ? { validationError: { code: error.code, message: error.message } } : validationIssues?.[0] ? { validationError: { code: validationIssues[0].code, message: validationIssues[0].message } } : {}
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
  let current = resolve3(cwd);
  while (true) {
    if (existsSync4(join2(current, ".git")) || existsSync4(join2(current, "package.json")) || existsSync4(join2(current, PROJECT_CONFIG_NAME)) || existsSync4(join2(current, ".pi"))) {
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
  const executablePath = REPOPROMPT_BINARY_CANDIDATES.find((candidate) => existsSync4(candidate));
  if (!executablePath) {
    return { configured: false };
  }
  const projectRoot = findProjectRoot(cwd);
  const targetPath = projectRoot ? join2(projectRoot, PROJECT_CONFIG_NAME) : GENERIC_GLOBAL_CONFIG_PATH;
  return {
    configured: false,
    executablePath,
    targetPath,
    serverName: "repoprompt",
    entry: buildRepoPromptEntry(executablePath)
  };
}

// src/config/write.ts
import { existsSync as existsSync5, mkdirSync, readFileSync as readFileSync4, renameSync, writeFileSync } from "node:fs";
import { dirname as dirname2 } from "node:path";

// src/contracts/core.ts
function isServerDisabled(definition) {
  return definition?.disabled === true || definition?.enabled === false;
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
  const existed = existsSync5(filePath);
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
  if (!existsSync5(filePath)) return {};
  try {
    const raw = parseJsonConfig(readFileSync4(filePath, "utf-8"));
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
function readValidatedConfigOrThrow(filePath, label) {
  const result = readValidatedConfig(filePath, label);
  if (!result.ok) {
    throw new Error(`${label} could not be used (${result.error.code}): ${result.error.message}`);
  }
  const firstIssue = result.issues?.[0];
  if (firstIssue) {
    throw new Error(`${label} contains an invalid entry (${firstIssue.code}): ${firstIssue.message}`);
  }
  return result.value;
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
  if (existsSync5(filePath)) {
    try {
      const parsed = parseJsonConfig(readFileSync4(filePath, "utf-8"));
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
      const loaded = readValidatedConfigOrThrow(source.readPath, `MCP config from ${source.readPath}`);
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
    if (source.kind === "extension") continue;
    const loaded = readValidatedConfigOrThrow(source.readPath, `MCP config from ${source.readPath}`);
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
  getConfigPathFromArgv,
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
