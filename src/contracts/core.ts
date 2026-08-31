// Internal contract types without runtime UI schema dependencies.
import type {
  ListPromptsResult,
  ListResourcesResult,
  ListToolsResult,
  Transport as McpTransport,
} from "@modelcontextprotocol/client";
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";
import type { UiStreamMode } from "../ui/stream-types.js";
import type { UiToolVisibility } from "../ui/tool-visibility.js";

export type Transport = McpTransport;

type SdkTool = ListToolsResult["tools"][number];
type SdkResource = ListResourcesResult["resources"][number];
type SdkPrompt = ListPromptsResult["prompts"][number];
type SdkPromptArgument = NonNullable<SdkPrompt["arguments"]>[number];

// MCP wire definitions derive their field types from the installed SDK while
// retaining the adapter's deliberately smaller public surface.
export interface McpTool {
  name: SdkTool["name"];
  title?: SdkTool["title"];
  description?: SdkTool["description"];
  inputSchema?: SdkTool["inputSchema"]; // JSON Schema
  _meta?: SdkTool["_meta"];
}

export interface McpResource {
  uri: SdkResource["uri"];
  name: SdkResource["name"];
  description?: SdkResource["description"];
  mimeType?: SdkResource["mimeType"];
  _meta?: SdkResource["_meta"];
}

export interface McpPromptArgument {
  name: SdkPromptArgument["name"];
  description?: SdkPromptArgument["description"];
  required?: SdkPromptArgument["required"];
}

export interface McpPrompt {
  name: SdkPrompt["name"];
  title?: SdkPrompt["title"];
  description?: SdkPrompt["description"];
  arguments?: SdkPrompt["arguments"];
  _meta?: SdkPrompt["_meta"];
}

// Content types from MCP
export interface McpContent {
  type: "text" | "image" | "audio" | "resource" | "resource_link";
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: {
    uri: string;
    text?: string;
    blob?: string;
  };
  uri?: string;
  name?: string;
  description?: string;
}

// Pi content block type
export type ContentBlock = TextContent | ImageContent;

// OAuth configuration (SDK handles auto-discovery and dynamic registration)
export interface OAuthConfig {
  /** OAuth grant type (defaults to authorization_code) */
  grantType?: "authorization_code" | "client_credentials";
  /** Pre-registered client ID (optional, dynamic registration used if not provided) */
  clientId?: string;
  /** Client secret for confidential clients */
  clientSecret?: string;
  /** Requested OAuth scopes */
  scope?: string;
  /** Extra authorization URL parameters for provider-specific extensions. Flow-owned parameters cannot be overridden. */
  authorizationParams?: Record<string, string>;
  /** Exact authorization-code redirect URI for pre-registered clients */
  redirectUri?: string;
  /** Client display name for dynamic registration */
  clientName?: string;
  /** Client homepage URI for dynamic registration */
  clientUri?: string;
  /** Client logo URL for dynamic registration; shown on consent screens */
  logoUri?: string;
  /** Security-weakening escape hatch for known-misconfigured authorization servers. */
  skipIssuerMetadataValidation?: boolean;
}

/**
 * Trusted executable invoked for every outbound HTTP request. The adapter
 * writes a versioned JSON request envelope to stdin and expects a JSON object
 * containing headers on stdout. This is intended for caller-bound signing
 * schemes whose headers depend on the exact request body.
 */
export interface HttpRequestHeadersCommand {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

// Server configuration
export interface ServerEntry {
  command?: string;
  args?: string[];
  /** Explicit rmcp-mux Unix-domain socket path. Mutually exclusive with command and url. */
  socket?: string;
  env?: Record<string, string>;
  cwd?: string;
  // HTTP fields
  url?: string;
  headers?: Record<string, string>;
  /** Add or replace HTTP headers by running a trusted command for each request. */
  requestHeadersCommand?: HttpRequestHeadersCommand;
  /**
   * Authentication type:
   * - 'oauth' - Use OAuth 2.1 (auto-discovers endpoints, supports dynamic client registration)
   * - 'bearer' - Use static Bearer token
   * - false - Disable authentication
   * If not specified and url is present, OAuth will be auto-detected unless custom headers are configured
   */
  auth?: "oauth" | "bearer" | false;
  bearerToken?: string;
  bearerTokenEnv?: string;
  /** Read a static bearer token from the adapter-owned OS credential store. */
  bearerTokenStore?: true;
  /**
   * OAuth configuration (optional).
   * If not provided, the SDK will attempt dynamic client registration.
   * Set to false to explicitly disable OAuth for this server.
   */
  oauth?: OAuthConfig | false;
  lifecycle?: "keep-alive" | "lazy" | "lazy-keep-alive" | "eager";
  idleTimeout?: number; // minutes, overrides global setting
  requestTimeoutMs?: number; // milliseconds, overrides global request timeout when > 0
  // Resource handling
  exposeResources?: boolean;
  // Direct tool registration
  directTools?: boolean | string[];
  // Override settings.toolPrefix for this server.
  toolPrefix?: ToolPrefix;
  // Include/exclude specific MCP tools/resources by original or prefixed name
  includeTools?: string[];
  excludeTools?: string[];
  /**
   * Extra search keywords per tool, keyed by original name, prefixed name, or
   * glob (same matching rules as includeTools/excludeTools). Keywords boost
   * mcp({ search }) ranking only — they never appear in tool schemas,
   * describe output, or the metadata cache.
   */
  searchKeywords?: Record<string, string[]>;
  // Require interactive approval before calling matching MCP tools/resources.
  approveTools?: boolean | string[];
  // Debug
  debug?: boolean;  // Show server stderr (default: false)
  /** Enable metadata-only JSONL protocol tracing for this server. */
  trace?: boolean;
  /** Force a specific HTTP MCP transport. Used by Agent Plugins, whose `type` declares the transport and forbids client fallback. */
  httpTransport?: "streamable-http" | "sse";
  /** Client-managed persistent data directory for Agent Plugin stdio servers. */
  pluginDataDir?: string;
  /** Treat env values as already resolved literals. Used for Agent Plugin env rules. */
  literalEnv?: boolean;
  /**
   * MCP protocol era negotiation for this server. Defaults to `"legacy"`
   * (byte-equivalent to pre-2026 behavior — no `versionNegotiation` is sent).
   * `"auto"` offers the SDK's default 2026-07-28+ modern versions with
   * legacy fallback; `"2026-07-28"` pins the connection to that revision
   * with no fallback. `auto` and `2026-07-28` must be set explicitly.
   */
  protocolVersion?: "legacy" | "auto" | "2026-07-28";
  // Keep configuration visible without allowing connections or execution.
  disabled?: boolean;
}

/** Only the literal boolean `true` disables a server. */
export function isServerDisabled(definition: ServerEntry | undefined): boolean {
  return definition?.disabled === true;
}

// Output guard tuning (settings.outputGuard object form)
export interface McpOutputGuardSettings {
  /** Maximum inline MCP text output bytes before truncation/spill-to-disk. Defaults to 51200 (50 KiB). */
  maxBytes?: number;
  /** Maximum inline MCP text output lines before truncation/spill-to-disk. Defaults to 2000. */
  maxLines?: number;
  /** Maximum details.mcpResult JSON bytes kept raw; larger results are summarized and spilled to disk. Defaults to 16384 (16 KiB). */
  detailsMaxBytes?: number;
}

// Settings
export type ToolPrefix = "server" | "none" | "short" | "mcp";
export type McpFooterStatus = "full" | "compact" | "off";

export interface McpTraceSettings {
  /** Enable tracing for all servers unless a server sets trace to false. */
  enabled?: boolean;
  /** JSONL destination; relative paths are resolved from the session cwd. */
  file?: string;
  /** Maximum per-session trace file size in bytes. */
  maxBytes?: number;
  /** Maximum events retained in the per-session trace file. */
  maxEvents?: number;
}

export const MCP_TOOL_APPROVAL_REQUEST_EVENT = "pi-mcp-adapter:tool-approval-request" as const;

export type McpToolApprovalOrigin = "proxy" | "direct" | "script" | "resource" | "iframe";
export type McpToolApprovalDecision = "allow_once" | "allow_for_session" | "deny" | "abstain";
export type McpToolApprovalHandler = () => McpToolApprovalDecision | Promise<McpToolApprovalDecision>;

export interface McpToolApprovalRequest {
  requestId: string;
  serverName: string;
  originalToolName: string;
  prefixedToolName: string;
  args: Record<string, unknown>;
  origin: McpToolApprovalOrigin;
  signal?: AbortSignal;
  claim(handler: McpToolApprovalHandler): boolean;
}

export interface McpSettings {
  toolPrefix?: ToolPrefix;
  /** Show the plug prefix in MCP status and connection text (default: true). Set to false to disable it. */
  showStatusIcon?: boolean;
  /** Footer status verbosity: full details, compact connected/enabled count, or no footer status. Defaults to full. */
  mcpFooterStatus?: McpFooterStatus;
  /** Show successful startup connection notifications. Defaults to true. */
  notifyOnStartupConnect?: boolean;
  /** Agent Plugin package directories to load MCP servers from. */
  agentPluginPaths?: string[];
  idleTimeout?: number; // minutes, default 10, 0 to disable
  requestTimeoutMs?: number; // milliseconds, overrides the SDK request timeout when > 0
  directTools?: boolean;
  /**
   * Validate direct-tool inputs against the advertised schema after recovering
   * one JSON string layer for object and array properties. Defaults to false.
   */
  strictDirectToolArguments?: boolean;
  /**
   * Include the byte-bounded raw MCP result in direct-tool details. The default
   * `lean` mode keeps the existing small details object.
   */
  directToolResultDetails?: "lean" | "bounded";
  /** Show the advisory when 75 or more direct tools resolve. Defaults to true. */
  warnOnLargeDirectTools?: boolean;
  /** Register the trusted MCP-only JavaScript scripting tool. Defaults to true; set false to hide it. */
  scriptMode?: boolean;
  /** Render MCP tool results as compact self-rendered rows by default, or as the legacy boxed row. */
  toolResultRendering?: "compact" | "boxed";
  /** Number of result text lines to show before expansion. Supports 1, 2, or 3. Defaults to 1 in compact mode and 3 in boxed mode. */
  collapsedResultLines?: 1 | 2 | 3;
  /** Default approval gate for matching tools/resources; per-server settings override it. */
  approveTools?: boolean | string[];
  disableProxyTool?: boolean;
  /** Freeze direct-tool registration after the initial sync. Automatic metadata updates
   * (reconnects, lazy-connect, tool-list-changed) won't rebuild the system prompt,
   * preserving the prompt-cache prefix. The agent rediscovers explicitly via
   * mcp({ connect: "server" }). Default: false. */
  freezeDirectTools?: boolean;
  autoAuth?: boolean;
  sampling?: boolean;
  samplingAutoApprove?: boolean;
  elicitation?: boolean;
  /**
   * Guard oversized MCP tool/resource output before it is returned to the model.
   * Defaults to true (50 KiB / 2,000 lines inline text, 16 KiB details.mcpResult).
   * Set to false to restore raw MCP output behavior, or pass an object to tune
   * the limits. Env kill switch: MCP_OUTPUT_GUARD=0.
   */
  outputGuard?: boolean | McpOutputGuardSettings;
  /**
   * Opt-in metadata-only MCP protocol tracing. Payloads, prompts, tool
   * arguments/results, authorization data, and URLs are never persisted.
   */
  trace?: McpTraceSettings;
  /**
   * Message returned in tool results when a server needs (re-)authentication.
   * "${server}" is substituted with the server name. Defaults to a TUI
   * instruction when unset.
   */
  authRequiredMessage?: string;
  /**
   * Legacy OAuth tokens.json import directory.
   * Relative paths are resolved from the project root (cwd).
   * Takes precedence over the agent's mcp-oauth/ legacy import directory but
   * can still be overridden by the MCP_OAUTH_DIR env variable.
   *
   * Persistent OAuth credentials are stored in the operating system credential
   * store, not this directory. Existing plaintext tokens.json files found here
   * are imported once and removed.
   */
  oauthDir?: string;
}

// Root config
export interface McpConfig {
  mcpServers: Record<string, ServerEntry>;
  settings?: McpSettings;
}

export interface McpAdapterOptions {
  config?: McpConfig;
  configPath?: string;
}

// Alias for clarity
export type ServerDefinition = ServerEntry;

export interface ToolMetadata {
  name: string;           // Prefixed tool name (e.g., "xcodebuild_list_sims")
  originalName: string;   // Original MCP tool name (e.g., "list_sims")
  description: string;
  resourceUri?: string;   // For resource tools: the URI to read
  uiResourceUri?: string; // For app-enabled tools: the UI resource URI
  uiVisibility?: UiToolVisibility[];
  inputSchema?: unknown;  // JSON Schema for parameters (stored for describe/errors)
  uiStreamMode?: UiStreamMode;
}

export interface PromptMetadata {
  serverName: string;
  originalName: string;
  commandName: string;
  title?: string;
  description: string;
  arguments: McpPromptArgument[];
}

export interface DirectToolSpec {
  serverName: string;
  originalName: string;
  prefixedName: string;
  description: string;
  inputSchema?: unknown;
  resourceUri?: string;
  uiResourceUri?: string;
  uiStreamMode?: UiStreamMode;
}

export interface ServerProvenance {
  path: string;
  kind: "user" | "project" | "shared";
}

export interface McpAuthResult {
  ok: boolean;
  message?: string;
}

export interface CachedTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  uiResourceUri?: string;
  uiVisibility?: UiToolVisibility[];
  uiStreamMode?: "eager" | "stream-first";
}

export interface CachedResource {
  uri: string;
  name: string;
  description?: string;
}

export interface CachedPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}

export interface ServerCacheEntry {
  configHash: string;
  tools: CachedTool[];
  resources: CachedResource[];
  prompts?: CachedPrompt[];
  instructions?: string;
  cachedAt: number;
}

export interface MetadataCache {
  version: number;
  servers: Record<string, ServerCacheEntry>;
}

export interface McpPanelCallbacks {
  reconnect: (serverName: string) => Promise<boolean>;
  canAuthenticate: (serverName: string) => boolean;
  authenticate: (serverName: string) => Promise<McpAuthResult>;
  getConnectionStatus: (serverName: string) => "connected" | "idle" | "failed" | "needs-auth" | "disabled";
  getFailureMessage?: (serverName: string) => string | null;
  refreshCacheAfterReconnect: (serverName: string) => ServerCacheEntry | null;
}

export interface McpPanelResult {
  changes: Map<string, true | string[] | false>;
  cancelled: boolean;
}
