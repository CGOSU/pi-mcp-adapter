import type { McpManagementExecutionPolicy, McpServerConfig as PiMcpServerConfig } from "@earendil-works/pi-coding-agent";
import type { ConfigSourceSpec } from "../config/contracts.js";
import type { LoadedConfigSource } from "../config/load.js";
import { mergeConfigs } from "../config/merge.js";
import { validateServerEntry } from "../config/validation.ts";
import type { McpConfig, McpSettings, ServerEntry, ToolPrefix } from "../contracts/core.js";

export type ConfigFieldOwner =
  | "native-config"
  | "native-lifecycle"
  | "native-transport"
  | "native-credentials"
  | "native-execution-policy"
  | "adapter-config-source"
  | "adapter-credentials"
  | "adapter-presentation"
  | "adapter-observability"
  | "adapter-catalog"
  | "adapter-runtime-surface";

export interface ConfigFieldMapping {
  readonly owner: ConfigFieldOwner;
  readonly status: "mapped" | "deferred" | "adapter-owned";
  readonly reason: string;
}

const mapped = (owner: ConfigFieldOwner, reason: string): ConfigFieldMapping => ({ owner, status: "mapped", reason });
const deferred = (owner: ConfigFieldOwner, reason: string): ConfigFieldMapping => ({ owner, status: "deferred", reason });
const adapterOwned = (owner: ConfigFieldOwner, reason: string): ConfigFieldMapping => ({ owner, status: "adapter-owned", reason });

/** Exhaustive ownership ledger: adding a ServerEntry field requires an explicit migration decision. */
export const SERVER_ENTRY_FIELD_MAPPING = {
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
  disabled: mapped("native-config", "Maps explicitly to native enabled = !disabled."),
} satisfies Record<keyof ServerEntry, ConfigFieldMapping>;

/** Exhaustive ownership ledger: presentation settings remain out of native server execution config. */
export const MCP_SETTINGS_FIELD_MAPPING = {
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
  oauthDir: deferred("adapter-credentials", "Legacy OAuth import path does not authorize plaintext credential migration."),
} satisfies Record<keyof McpSettings, ConfigFieldMapping>;

export interface NativeConfigProvenance {
  readonly sourceId: ConfigSourceSpec["id"];
  readonly scope: ConfigSourceSpec["scope"];
  readonly kind: ConfigSourceSpec["kind"];
  readonly sourcePath: string;
  readonly writePath: string;
  readonly shared: boolean;
}

export interface NativeOAuthConfigSubset {
  readonly grantType?: "authorization_code" | "client_credentials";
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly callbackPort?: number;
  readonly callbackUrl?: string;
  readonly scope?: string;
  readonly authorizationParams?: Readonly<Record<string, string>>;
  readonly clientName?: string;
  readonly clientUri?: string;
  readonly logoUri?: string;
  readonly skipIssuerMetadataValidation?: boolean;
}

export type NativeServerConfigSubset = PiMcpServerConfig;

export interface NativeConfigServerIssue {
  readonly code: "unsupported-protocol-version" | "unsupported-oauth-redirect";
  readonly field: "protocolVersion" | "oauth.redirectUri";
  readonly message: string;
}

export type NativeExecutionPolicySubset = McpManagementExecutionPolicy;

export interface NativeConfigServerPlan {
  readonly name: string;
  readonly connectable: boolean;
  readonly config: NativeServerConfigSubset | {};
  readonly executionPolicy: NativeExecutionPolicySubset;
  readonly provenance: NativeConfigProvenance;
  readonly deferredFields: readonly (keyof ServerEntry)[];
  readonly blockingIssues: readonly NativeConfigServerIssue[];
}

export interface NativeConfigSettingsPlan {
  readonly idleTimeout?: number;
  readonly requestTimeoutMs?: number;
  readonly directTools?: boolean;
  readonly toolPrefix?: ToolPrefix;
  readonly deferredFields: readonly (keyof McpSettings)[];
  readonly adapterOwnedFields: readonly (keyof McpSettings)[];
  readonly provenance: Readonly<Partial<Record<keyof McpSettings, NativeConfigProvenance>>>;
}

export const DEFERRED_NATIVE_CONFIG_SOURCES = [] as const;

export interface NativeConfigMappingPlan {
  readonly nativeEntrySwitchAllowed: true;
  readonly entrySwitchBlockers: readonly string[];
  readonly deferredSources: typeof DEFERRED_NATIVE_CONFIG_SOURCES;
  readonly servers: readonly NativeConfigServerPlan[];
  readonly settings: NativeConfigSettingsPlan;
}

const ENTRY_SWITCH_BLOCKERS: readonly string[] = Object.freeze([]);

export interface NativeConfigMappingError {
  readonly code: "invalid-source" | "invalid-server-entry" | "missing-provenance";
  readonly message: string;
  readonly sourceId?: ConfigSourceSpec["id"];
}

export type NativeConfigMappingResult =
  | { readonly ok: true; readonly value: NativeConfigMappingPlan }
  | { readonly ok: false; readonly error: NativeConfigMappingError };

function nativeProvenance(source: ConfigSourceSpec): NativeConfigProvenance {
  return {
    sourceId: source.id,
    scope: source.scope,
    kind: source.kind,
    sourcePath: source.readPath,
    writePath: source.writePath,
    shared: source.shared,
  };
}

function deferredServerFields(entry: ServerEntry): (keyof ServerEntry)[] {
  return (Object.keys(SERVER_ENTRY_FIELD_MAPPING) as (keyof ServerEntry)[]).filter((field) => {
    if (SERVER_ENTRY_FIELD_MAPPING[field].status !== "deferred") return false;
    const value = entry[field];
    if (field === "debug" || field === "trace") return value === true;
    return value !== undefined;
  });
}

function blockingIssues(name: string, entry: ServerEntry): NativeConfigServerIssue[] {
  const issues: NativeConfigServerIssue[] = [];
  if (entry.protocolVersion === "auto" || entry.protocolVersion === "2026-07-28") {
    issues.push({
      code: "unsupported-protocol-version",
      field: "protocolVersion",
      message: `MCP server "${name}" requests remote protocol ${entry.protocolVersion}, which the native Pi 1.2.0 client does not support.`,
    });
  }
  const redirectUri = typeof entry.oauth === "object" && entry.oauth !== null ? entry.oauth.redirectUri : undefined;
  if (redirectUri !== undefined) {
    const redirect = URL.canParse(redirectUri) ? new URL(redirectUri) : undefined;
    const loopback = redirect && redirect.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname);
    if (!loopback) {
      issues.push({
        code: "unsupported-oauth-redirect",
        field: "oauth.redirectUri",
        message: `MCP server "${name}" configures a redirect URI that cannot be served by the native loopback OAuth callback.`,
      });
    }
  }
  return issues;
}

function mapOAuthConfig(entry: ServerEntry): NativeOAuthConfigSubset | false | undefined {
  const oauth = entry.oauth;
  if (oauth === undefined || oauth === false) return oauth;
  const { redirectUri, ...settings } = oauth;
  return {
    ...settings,
    ...(redirectUri === undefined ? {} : { callbackUrl: redirectUri }),
  };
}

function mapNativeServerConfig(entry: ServerEntry, globalTimeoutMs: number | undefined): NativeServerConfigSubset | undefined {
  const configuredTimeout = entry.requestTimeoutMs !== undefined && entry.requestTimeoutMs > 0
    ? entry.requestTimeoutMs
    : globalTimeoutMs !== undefined && globalTimeoutMs > 0
      ? globalTimeoutMs
      : undefined;
  const oauth = mapOAuthConfig(entry);
  const common = {
    ...(configuredTimeout === undefined ? {} : { requestTimeoutMs: configuredTimeout }),
    ...(entry.protocolVersion === undefined ? {} : { protocolVersion: entry.protocolVersion }),
    ...(entry.lifecycle === undefined ? {} : { lifecycle: entry.lifecycle }),
    ...(entry.idleTimeout === undefined ? {} : { idleTimeout: entry.idleTimeout }),
    ...(entry.enabled !== undefined ? { enabled: entry.enabled } : entry.disabled === undefined ? {} : { enabled: !entry.disabled }),
    ...(entry.exposure === undefined ? {} : { exposure: entry.exposure }),
    ...(entry.toolExposure === undefined ? {} : { toolExposure: { ...entry.toolExposure } }),
    ...(entry.directTools === undefined
      ? {}
      : { directTools: Array.isArray(entry.directTools) ? [...entry.directTools] : entry.directTools }),
  };
  if (entry.command !== undefined) {
    return {
      ...common,
      type: "stdio",
      command: entry.command,
      ...(entry.args === undefined ? {} : { args: [...entry.args] }),
      ...(entry.env === undefined ? {} : { env: { ...entry.env } }),
      ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
      ...(entry.pluginDataDir === undefined ? {} : { pluginDataDir: entry.pluginDataDir }),
      ...(entry.literalEnv === undefined ? {} : { literalEnv: entry.literalEnv }),
    };
  }
  if (entry.url !== undefined) {
    return {
      ...common,
      type: "http",
      url: entry.url,
      ...(entry.headers === undefined ? {} : { headers: { ...entry.headers } }),
      ...(entry.requestHeadersCommand === undefined ? {} : { requestHeadersCommand: structuredClone(entry.requestHeadersCommand) }),
      ...(entry.auth === undefined ? {} : { auth: entry.auth }),
      ...(entry.bearerToken === undefined ? {} : { bearerToken: entry.bearerToken }),
      ...(entry.bearerTokenEnv === undefined ? {} : { bearerTokenEnv: entry.bearerTokenEnv }),
      ...(entry.bearerTokenStore === undefined ? {} : { bearerTokenStore: entry.bearerTokenStore }),
      ...(oauth === undefined ? {} : { oauth: structuredClone(oauth) }),
      ...(entry.httpTransport === undefined ? {} : { httpTransport: entry.httpTransport }),
    };
  }
  if (entry.socket !== undefined) return { ...common, type: "socket", socket: entry.socket };
  return undefined;
}

function mapDirectToolSelection(
  serverName: string,
  entry: ServerEntry,
  settings: McpSettings | undefined,
): boolean | readonly string[] {
  const raw = process.env.MCP_DIRECT_TOOLS;
  if (raw === undefined) return entry.directTools ?? settings?.directTools ?? false;
  if (raw === "__none__") return false;

  let selectServer = false;
  const selectedTools = new Set<string>();
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

function mapExecutionPolicy(
  serverName: string,
  entry: ServerEntry,
  settings: McpSettings | undefined,
): NativeExecutionPolicySubset {
  const envGuard = process.env.MCP_OUTPUT_GUARD;
  const configuredGuard = settings?.outputGuard;
  const outputGuard = envGuard === "0" ? false : envGuard === "1" ? true : configuredGuard ?? true;
  const approval = entry.approveTools !== undefined ? entry.approveTools : settings?.approveTools;
  return {
    directTools: mapDirectToolSelection(serverName, entry, settings),
    includeTools: [...(entry.includeTools ?? [])],
    excludeTools: [...(entry.excludeTools ?? [])],
    toolPrefix: entry.toolPrefix ?? settings?.toolPrefix ?? "server",
    searchKeywords: structuredClone(entry.searchKeywords ?? {}),
    exposeResources: entry.exposeResources !== false,
    ...(approval === undefined ? {} : { approveTools: Array.isArray(approval) ? [...approval] : approval }),
    strictDirectToolArguments: settings?.strictDirectToolArguments === true,
    directToolResultDetails: settings?.directToolResultDetails ?? "lean",
    freezeDirectTools: settings?.freezeDirectTools === true,
    outputGuard: typeof outputGuard === "object" ? structuredClone(outputGuard) : outputGuard,
    sampling: settings?.sampling !== false,
    samplingAutoApprove: settings?.samplingAutoApprove === true,
    elicitation: settings?.elicitation !== false,
  };
}

function mapSettings(
  settings: McpSettings | undefined,
  provenance: Partial<Record<keyof McpSettings, NativeConfigProvenance>>,
): NativeConfigSettingsPlan {
  const present = settings ? (Object.keys(settings) as (keyof McpSettings)[]) : [];
  return {
    ...(settings?.idleTimeout === undefined ? {} : { idleTimeout: settings.idleTimeout }),
    ...(settings?.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: settings.requestTimeoutMs }),
    ...(settings?.directTools === undefined ? {} : { directTools: settings.directTools }),
    ...(settings?.toolPrefix === undefined ? {} : { toolPrefix: settings.toolPrefix }),
    deferredFields: present.filter((field) => MCP_SETTINGS_FIELD_MAPPING[field].status === "deferred"),
    adapterOwnedFields: present.filter((field) => MCP_SETTINGS_FIELD_MAPPING[field].status === "adapter-owned"),
    provenance,
  };
}

/**
 * Merge validated configuration sources in their established order and carry the winning source's
 * scope and write target into every native import record. No caller-supplied trust boolean exists;
 * the native owner must check its own ExtensionContext.isProjectTrusted() before connection or writes.
 */
export function mapLoadedConfigSourcesToNative(sources: readonly LoadedConfigSource[]): NativeConfigMappingResult {
  let config: McpConfig = { mcpServers: {} };
  const serverSources = new Map<string, ConfigSourceSpec>();
  const settingsSources: Partial<Record<keyof McpSettings, NativeConfigProvenance>> = {};

  for (const loaded of sources) {
    if (loaded.error || loaded.validationIssues?.length) {
      const code = loaded.error?.code ?? loaded.validationIssues?.[0]?.code ?? "invalid-root";
      return {
        ok: false,
        error: {
          code: "invalid-source",
          message: `MCP config source ${loaded.source.id} failed validation (${code}).`,
          sourceId: loaded.source.id,
        },
      };
    }
    if (!loaded.config) continue;
    config = mergeConfigs(config, loaded.config);
    for (const name of Object.keys(loaded.config.mcpServers)) serverSources.set(name, loaded.source);
    for (const field of Object.keys(loaded.config.settings ?? {}) as (keyof McpSettings)[]) {
      settingsSources[field] = nativeProvenance(loaded.source);
    }
  }

  const servers: NativeConfigServerPlan[] = [];
  for (const [name, entry] of Object.entries(config.mcpServers)) {
    const source = serverSources.get(name);
    if (!source) {
      return {
        ok: false,
        error: { code: "missing-provenance", message: "A configured MCP server has no source provenance." },
      };
    }
    const validated = validateServerEntry(name, entry, { requireTransport: true });
    if (!validated.ok) {
      return {
        ok: false,
        error: {
          code: "invalid-server-entry",
          message: `A configured MCP server failed validation (${validated.error.code}).`,
          sourceId: source.id,
        },
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
      blockingIssues: issues,
    });
  }

  return {
    ok: true,
    value: {
      nativeEntrySwitchAllowed: true,
      entrySwitchBlockers: ENTRY_SWITCH_BLOCKERS,
      deferredSources: DEFERRED_NATIVE_CONFIG_SOURCES,
      servers,
      settings: mapSettings(config.settings, settingsSources),
    },
  };
}
