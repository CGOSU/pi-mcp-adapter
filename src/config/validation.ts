import type { McpConfig, McpSettings, ServerEntry } from "../contracts/core.js";

export type ConfigValidationCode =
  | "invalid-root"
  | "invalid-server-map"
  | "invalid-server-name"
  | "invalid-server-entry"
  | "unknown-server-field"
  | "invalid-server-field"
  | "invalid-settings"
  | "unknown-settings-field"
  | "invalid-setting"
  | "invalid-nested-field"
  | "conflicting-server-map";

export interface ConfigValidationIssue {
  readonly code: ConfigValidationCode;
  readonly path: string;
  readonly message: string;
}

export interface ConfigValidationError {
  readonly code: ConfigValidationCode;
  readonly message: string;
  readonly issues: readonly ConfigValidationIssue[];
}

export type ConfigValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly issues?: readonly ConfigValidationIssue[] }
  | { readonly ok: false; readonly error: ConfigValidationError };

const SERVER_FIELDS = new Set([
  "enabled", "exposure", "toolExposure", "command", "args", "socket", "env", "cwd", "url", "headers",
  "requestHeadersCommand", "auth", "bearerToken", "bearerTokenEnv", "bearerTokenStore", "oauth", "lifecycle",
  "idleTimeout", "requestTimeoutMs", "exposeResources", "directTools", "toolPrefix", "includeTools", "excludeTools",
  "searchKeywords", "approveTools", "debug", "trace", "httpTransport", "pluginDataDir", "literalEnv",
  "protocolVersion", "disabled",
]);

const SETTINGS_FIELDS = new Set([
  "toolPrefix", "showStatusIcon", "mcpFooterStatus", "notifyOnStartupConnect", "agentPluginPaths",
  "idleTimeout", "requestTimeoutMs", "directTools", "strictDirectToolArguments", "directToolResultDetails",
  "warnOnLargeDirectTools", "scriptMode", "toolResultRendering", "collapsedResultLines", "approveTools",
  "disableProxyTool", "freezeDirectTools", "autoAuth", "sampling", "samplingAutoApprove", "elicitation",
  "outputGuard", "trace", "authRequiredMessage", "oauthDir",
]);

const ROOT_FIELDS = new Set(["mcpServers", "mcp-servers", "settings", "$schema", "imports"]);
const IGNORED_LEGACY_SETTINGS_FIELDS = new Set(["hostConfigDiscovery"]);
const TOOL_PREFIXES = ["server", "none", "short", "mcp"] as const;
const LIFECYCLE_MODES = ["keep-alive", "lazy", "lazy-keep-alive", "eager"] as const;
const PROTOCOL_VERSIONS = ["legacy", "auto", "2026-07-28"] as const;
const HTTP_TRANSPORTS = ["streamable-http", "sse"] as const;
const URL_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: ConfigValidationIssue[],
  code: ConfigValidationCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function fail<T>(issues: ConfigValidationIssue[]): ConfigValidationResult<T> {
  const first = issues[0] ?? {
    code: "invalid-root" as const,
    path: "config",
    message: "MCP configuration is invalid.",
  };
  return {
    ok: false,
    error: { code: first.code, message: first.message, issues },
  };
}

function checkString(
  value: unknown,
  path: string,
  issues: ConfigValidationIssue[],
  code: ConfigValidationCode,
  expectation = "must be a string",
  allowEmpty = true,
): void {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0) || value.includes("\0")) {
    addIssue(issues, code, path, `${path} ${expectation}.`);
  }
}

function checkBoolean(
  value: unknown,
  path: string,
  issues: ConfigValidationIssue[],
  code: ConfigValidationCode,
): void {
  if (typeof value !== "boolean") addIssue(issues, code, path, `${path} must be a boolean.`);
}

function checkEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
  issues: ConfigValidationIssue[],
  code: ConfigValidationCode,
): void {
  if (typeof value !== "string" || !values.includes(value as T)) {
    addIssue(issues, code, path, `${path} must be one of: ${values.join(", ")}.`);
  }
}

function checkStringArray(
  value: unknown,
  path: string,
  issues: ConfigValidationIssue[],
  code: ConfigValidationCode,
): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.includes("\0"))) {
    addIssue(issues, code, path, `${path} must be an array of strings without NUL characters.`);
  }
}

function isValidDirectToolsSelection(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  try {
    if (!Array.isArray(value) || value.length > 256) return false;
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) return false;
      const toolName: unknown = value[index];
      if (
        typeof toolName !== "string" ||
        toolName.length === 0 ||
        toolName.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(toolName)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function checkDirectToolsSelection(
  value: unknown,
  path: string,
  issues: ConfigValidationIssue[],
  code: ConfigValidationCode,
): void {
  if (!isValidDirectToolsSelection(value)) {
    addIssue(issues, code, path, `${path} must be a boolean or an array of at most 256 bounded tool names.`);
  }
}

function checkStringRecord(
  value: unknown,
  path: string,
  issues: ConfigValidationIssue[],
  code: ConfigValidationCode,
): void {
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== "string" || entry.includes("\0"))) {
    addIssue(issues, code, path, `${path} must be an object with string values without NUL characters.`);
  }
}

function checkHeaders(value: unknown, path: string, issues: ConfigValidationIssue[], code: ConfigValidationCode): void {
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
    new Headers(value as Record<string, string>);
  } catch {
    addIssue(issues, code, path, `${path} contains an invalid HTTP header name or value.`);
  }
}

function checkNumber(
  value: unknown,
  path: string,
  issues: ConfigValidationIssue[],
  code: ConfigValidationCode,
  minimum: number,
  integer = false,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isSafeInteger(value))
  ) {
    const range = integer ? `a safe integer between ${minimum} and ${maximum}` : `a finite number between ${minimum} and ${maximum}`;
    addIssue(issues, code, path, `${path} must be ${range}.`);
  }
}

function checkHttpUrl(value: unknown, path: string, issues: ConfigValidationIssue[], code: ConfigValidationCode): void {
  if (typeof value !== "string" || !URL.canParse(value)) {
    addIssue(issues, code, path, `${path} must be an absolute HTTP or HTTPS URL.`);
    return;
  }
  const url = new URL(value);
  if (!URL_PROTOCOLS.has(url.protocol) || url.username || url.password || url.hash) {
    addIssue(issues, code, path, `${path} must be an HTTP or HTTPS URL without embedded credentials or a fragment.`);
  }
}

function checkKnownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: ConfigValidationIssue[],
  code: ConfigValidationCode,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addIssue(issues, code, `${path}.${key}`, `${path}.${key} is not a supported configuration field.`);
  }
}

function validateOAuth(value: unknown, path: string, issues: ConfigValidationIssue[]): void {
  if (value === false) return;
  if (!isRecord(value)) {
    addIssue(issues, "invalid-server-field", path, `${path} must be false or an OAuth configuration object.`);
    return;
  }
  const fields = new Set([
    "grantType", "clientId", "clientSecret", "scope", "authorizationParams", "redirectUri", "clientName",
    "clientUri", "logoUri", "skipIssuerMetadataValidation",
  ]);
  checkKnownFields(value, fields, path, issues, "unknown-server-field");
  if (value.grantType !== undefined) {
    checkEnum(value.grantType, ["authorization_code", "client_credentials"], `${path}.grantType`, issues, "invalid-nested-field");
  }
  for (const field of ["clientId", "clientSecret", "scope", "clientName"] as const) {
    if (value[field] !== undefined) checkString(value[field], `${path}.${field}`, issues, "invalid-nested-field");
  }
  for (const field of ["redirectUri", "clientUri", "logoUri"] as const) {
    if (value[field] !== undefined) checkHttpUrl(value[field], `${path}.${field}`, issues, "invalid-nested-field");
  }
  if (value.authorizationParams !== undefined) {
    checkStringRecord(value.authorizationParams, `${path}.authorizationParams`, issues, "invalid-nested-field");
  }
  if (value.skipIssuerMetadataValidation !== undefined) {
    checkBoolean(value.skipIssuerMetadataValidation, `${path}.skipIssuerMetadataValidation`, issues, "invalid-nested-field");
  }
}

function validateRequestHeadersCommand(value: unknown, path: string, issues: ConfigValidationIssue[]): void {
  if (!isRecord(value)) {
    addIssue(issues, "invalid-server-field", path, `${path} must be a command configuration object.`);
    return;
  }
  const fields = new Set(["command", "args", "env", "timeoutMs"]);
  checkKnownFields(value, fields, path, issues, "unknown-server-field");
  if (value.command === undefined) {
    addIssue(issues, "invalid-nested-field", `${path}.command`, `${path}.command is required.`);
  } else {
    checkString(value.command, `${path}.command`, issues, "invalid-nested-field", "must be a non-empty string", false);
  }
  if (value.args !== undefined) checkStringArray(value.args, `${path}.args`, issues, "invalid-nested-field");
  if (value.env !== undefined) checkStringRecord(value.env, `${path}.env`, issues, "invalid-nested-field");
  if (
    value.timeoutMs !== undefined &&
    (typeof value.timeoutMs !== "number" || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 60_000)
  ) {
    addIssue(issues, "invalid-nested-field", `${path}.timeoutMs`, `${path}.timeoutMs must be an integer between 1 and 60000.`);
  }
}

function validateServerField(field: string, value: unknown, path: string, issues: ConfigValidationIssue[]): void {
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

export function validateServerEntry(
  name: string,
  raw: unknown,
  options: { requireTransport?: boolean } = {},
): ConfigValidationResult<ServerEntry> {
  const issues: ConfigValidationIssue[] = [];
  if (name.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(name)) {
    addIssue(issues, "invalid-server-name", "mcpServers.<entry>", "Server names must be non-empty and contain no control characters.");
  }
  if (!isRecord(raw)) {
    addIssue(issues, "invalid-server-entry", "mcpServers.<entry>", "Each server entry must be an object.");
    return fail(issues);
  }
  checkKnownFields(raw, SERVER_FIELDS, "mcpServers.<entry>", issues, "unknown-server-field");
  const transports = ["command", "url", "socket"].filter((field) => raw[field] !== undefined);
  if (transports.length > 1 || (options.requireTransport && transports.length !== 1)) {
    addIssue(issues, "invalid-server-entry", "mcpServers.<entry>", "A server entry must configure exactly one transport.");
  }
  if (
    typeof raw.enabled === "boolean" &&
    typeof raw.disabled === "boolean" &&
    raw.enabled === raw.disabled
  ) {
    addIssue(issues, "invalid-server-entry", "mcpServers.<entry>", "enabled and disabled specify conflicting server states.");
  }
  for (const [field, value] of Object.entries(raw)) {
    if (SERVER_FIELDS.has(field) && value !== undefined) validateServerField(field, value, `mcpServers.<entry>.${field}`, issues);
  }
  if (issues.length > 0) return fail(issues);
  return { ok: true, value: structuredClone(raw) as unknown as ServerEntry };
}

function validateSetting(field: string, value: unknown, issues: ConfigValidationIssue[]): void {
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
        const fields = new Set(["maxBytes", "maxLines", "detailsMaxBytes"]);
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
      checkKnownFields(value, new Set(["enabled", "file", "maxBytes", "maxEvents"]), path, issues, "unknown-settings-field");
      if (value.enabled !== undefined) checkBoolean(value.enabled, `${path}.enabled`, issues, "invalid-nested-field");
      if (value.file !== undefined) checkString(value.file, `${path}.file`, issues, "invalid-nested-field", "must be a non-empty string", false);
      if (value.maxBytes !== undefined) checkNumber(value.maxBytes, `${path}.maxBytes`, issues, "invalid-nested-field", 1, true);
      if (value.maxEvents !== undefined) checkNumber(value.maxEvents, `${path}.maxEvents`, issues, "invalid-nested-field", 1, true);
      break;
    case "authRequiredMessage":
    case "oauthDir":
      checkString(value, path, issues, code);
      break;
  }
}

export function validateMcpConfig(raw: unknown): ConfigValidationResult<McpConfig> {
  const issues: ConfigValidationIssue[] = [];
  if (!isRecord(raw)) {
    addIssue(issues, "invalid-root", "config", "MCP configuration root must be an object.");
    return fail(issues);
  }
  checkKnownFields(raw, ROOT_FIELDS, "config", issues, "invalid-root");
  if (raw.$schema !== undefined && typeof raw.$schema !== "string") {
    addIssue(issues, "invalid-root", "config.$schema", "config.$schema must be a string.");
  }
  if (Object.hasOwn(raw, "mcpServers") && Object.hasOwn(raw, "mcp-servers")) {
    addIssue(issues, "conflicting-server-map", "config", "Use only one of mcpServers or mcp-servers.");
  }
  const serverMap = Object.hasOwn(raw, "mcpServers") ? raw.mcpServers : raw["mcp-servers"];
  if (serverMap !== undefined && !isRecord(serverMap)) {
    addIssue(issues, "invalid-server-map", "mcpServers", "mcpServers must be an object keyed by server name.");
  }
  const servers: Record<string, ServerEntry> = {};
  const serverIssues: ConfigValidationIssue[] = [];
  if (isRecord(serverMap)) {
    for (const [name, entry] of Object.entries(serverMap)) {
      const validated = validateServerEntry(name, entry);
      if (validated.ok) servers[name] = validated.value;
      else serverIssues.push(...validated.error.issues);
    }
  }

  let settings: McpSettings | undefined;
  if (raw.settings !== undefined) {
    if (!isRecord(raw.settings)) {
      addIssue(issues, "invalid-settings", "settings", "settings must be an object.");
    } else {
      checkKnownFields(raw.settings, new Set([...SETTINGS_FIELDS, ...IGNORED_LEGACY_SETTINGS_FIELDS]), "settings", issues, "unknown-settings-field");
      for (const [field, value] of Object.entries(raw.settings)) {
        if (SETTINGS_FIELDS.has(field)) validateSetting(field, value, issues);
      }
      settings = structuredClone(raw.settings) as unknown as McpSettings;
      delete (settings as McpSettings & { hostConfigDiscovery?: unknown }).hostConfigDiscovery;
    }
  }

  if (issues.length > 0) return fail([...issues, ...serverIssues]);
  return {
    ok: true,
    value: { mcpServers: servers, ...(settings === undefined ? {} : { settings }) },
    ...(serverIssues.length === 0 ? {} : { issues: serverIssues }),
  };
}
