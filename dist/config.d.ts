import { z } from "zod";
export declare const UI_STREAM_HOST_CONTEXT_KEY = "pi-mcp-adapter/stream";
export declare const UI_STREAM_REQUEST_META_KEY = "pi-mcp-adapter/stream-token";
export declare const UI_STREAM_RESULT_PATCH_METHOD = "notifications/pi-mcp-adapter/ui-result-patch";
export declare const SERVER_STREAM_RESULT_PATCH_METHOD = "notifications/pi-mcp-adapter/result-patch";
export declare const UI_STREAM_STRUCTURED_CONTENT_KEY = "pi-mcp-adapter/stream";
export declare const uiStreamModeSchema: z.ZodEnum<{
    eager: "eager";
    "stream-first": "stream-first";
}>;
export type UiStreamMode = z.infer<typeof uiStreamModeSchema>;
export declare const visualizationStreamPhaseSchema: z.ZodEnum<{
    shell: "shell";
    narrative: "narrative";
    structure: "structure";
    detail: "detail";
    settled: "settled";
}>;
export type VisualizationStreamPhase = z.infer<typeof visualizationStreamPhaseSchema>;
export declare const visualizationStreamFrameTypeSchema: z.ZodEnum<{
    patch: "patch";
    checkpoint: "checkpoint";
    final: "final";
}>;
export type VisualizationStreamFrameType = z.infer<typeof visualizationStreamFrameTypeSchema>;
export declare const visualizationStreamStatusSchema: z.ZodEnum<{
    ok: "ok";
    error: "error";
}>;
export type VisualizationStreamStatus = z.infer<typeof visualizationStreamStatusSchema>;
export declare const uiStreamHostContextSchema: z.ZodObject<{
    mode: z.ZodEnum<{
        eager: "eager";
        "stream-first": "stream-first";
    }>;
    streamId: z.ZodString;
    intermediateResultPatches: z.ZodBoolean;
    partialInput: z.ZodBoolean;
}, z.core.$strip>;
export type UiStreamHostContext = z.infer<typeof uiStreamHostContextSchema>;
export declare const visualizationStreamEnvelopeSchema: z.ZodObject<{
    streamId: z.ZodString;
    sequence: z.ZodNumber;
    frameType: z.ZodEnum<{
        patch: "patch";
        checkpoint: "checkpoint";
        final: "final";
    }>;
    phase: z.ZodEnum<{
        shell: "shell";
        narrative: "narrative";
        structure: "structure";
        detail: "detail";
        settled: "settled";
    }>;
    status: z.ZodEnum<{
        ok: "ok";
        error: "error";
    }>;
    message: z.ZodOptional<z.ZodString>;
    spec: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    checkpoint: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type VisualizationStreamEnvelope = z.infer<typeof visualizationStreamEnvelopeSchema>;
export declare const uiStreamCallToolResultSchema: z.ZodObject<{
    content: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    isError: z.ZodOptional<z.ZodBoolean>;
    _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$loose>;
export type UiStreamCallToolResult = z.infer<typeof uiStreamCallToolResultSchema>;
export declare const uiStreamResultPatchNotificationSchema: z.ZodObject<{
    method: z.ZodLiteral<"notifications/pi-mcp-adapter/ui-result-patch">;
    params: z.ZodObject<{
        content: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        isError: z.ZodOptional<z.ZodBoolean>;
        _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$loose>;
}, z.core.$strip>;
export type UiStreamResultPatchNotification = z.infer<typeof uiStreamResultPatchNotificationSchema>;
export declare const serverStreamResultPatchNotificationSchema: z.ZodObject<{
    method: z.ZodLiteral<"notifications/pi-mcp-adapter/result-patch">;
    params: z.ZodObject<{
        streamToken: z.ZodString;
        result: z.ZodObject<{
            content: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            isError: z.ZodOptional<z.ZodBoolean>;
            _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, z.core.$loose>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type ServerStreamResultPatchNotification = z.infer<typeof serverStreamResultPatchNotificationSchema>;
export interface UiStreamSummary {
    streamId: string;
    mode: UiStreamMode;
    frames: number;
    phases: VisualizationStreamPhase[];
    finalStatus?: VisualizationStreamStatus;
    lastMessage?: string;
}
export declare function getUiStreamHostContext(hostContext: Record<string, unknown> | undefined): UiStreamHostContext | undefined;
export declare function getVisualizationStreamEnvelope(structuredContent: unknown): VisualizationStreamEnvelope | undefined;

export type UiToolVisibility = "model" | "app";
export declare function extractUiToolVisibility(meta: Record<string, unknown> | undefined): UiToolVisibility[] | undefined;
export declare function isUiToolVisibleToModel(visibility: readonly UiToolVisibility[] | undefined): boolean;
export declare function isUiToolCallableByApp(visibility: readonly UiToolVisibility[] | undefined): boolean;

import type { ListPromptsResult, ListResourcesResult, ListToolsResult, Transport as McpTransport } from "@modelcontextprotocol/client";
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";


export type Transport = McpTransport;
type SdkTool = ListToolsResult["tools"][number];
type SdkResource = ListResourcesResult["resources"][number];
type SdkPrompt = ListPromptsResult["prompts"][number];
type SdkPromptArgument = NonNullable<SdkPrompt["arguments"]>[number];
export interface McpTool {
    name: SdkTool["name"];
    title?: SdkTool["title"];
    description?: SdkTool["description"];
    inputSchema?: SdkTool["inputSchema"];
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
export type ContentBlock = TextContent | ImageContent;
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
export interface ServerEntry {
    /** Pi-native enablement field accepted when reading shared Pi MCP configuration. */
    enabled?: boolean;
    /** Pi-native tool exposure policy accepted when reading shared Pi MCP configuration. */
    exposure?: "codemode" | "deferred" | "direct" | "hidden";
    /** Per-tool exposure overrides from Pi-native MCP configuration. */
    toolExposure?: Record<string, "codemode" | "deferred" | "direct" | "hidden">;
    command?: string;
    args?: string[];
    /** Explicit rmcp-mux Unix-domain socket path. Mutually exclusive with command and url. */
    socket?: string;
    env?: Record<string, string>;
    cwd?: string;
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
    idleTimeout?: number;
    requestTimeoutMs?: number;
    exposeResources?: boolean;
    directTools?: boolean | string[];
    toolPrefix?: ToolPrefix;
    includeTools?: string[];
    excludeTools?: string[];
    /**
     * Extra search keywords per tool, keyed by original name, prefixed name, or
     * glob (same matching rules as includeTools/excludeTools). Keywords boost
     * mcp({ search }) ranking only — they never appear in tool schemas,
     * describe output, or the metadata cache.
     */
    searchKeywords?: Record<string, string[]>;
    approveTools?: boolean | string[];
    debug?: boolean;
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
    disabled?: boolean;
}
/** Only the literal boolean `true` disables a server. */
export declare function isServerDisabled(definition: ServerEntry | undefined): boolean;
export interface McpOutputGuardSettings {
    /** Maximum inline MCP text output bytes before truncation/spill-to-disk. Defaults to 51200 (50 KiB). */
    maxBytes?: number;
    /** Maximum inline MCP text output lines before truncation/spill-to-disk. Defaults to 2000. */
    maxLines?: number;
    /** Maximum details.mcpResult JSON bytes kept raw; larger results are summarized and spilled to disk. Defaults to 16384 (16 KiB). */
    detailsMaxBytes?: number;
}
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
export declare const MCP_TOOL_APPROVAL_REQUEST_EVENT: "pi-mcp-adapter:tool-approval-request";
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
    idleTimeout?: number;
    requestTimeoutMs?: number;
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
export interface McpConfig {
    mcpServers: Record<string, ServerEntry>;
    settings?: McpSettings;
}
export interface McpAdapterOptions {
    config?: McpConfig;
    configPath?: string;
}
export type ServerDefinition = ServerEntry;
export interface ToolMetadata {
    name: string;
    originalName: string;
    description: string;
    resourceUri?: string;
    uiResourceUri?: string;
    uiVisibility?: UiToolVisibility[];
    inputSchema?: unknown;
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
    arguments?: {
        name: string;
        description?: string;
        required?: boolean;
    }[];
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
    getConnectionStatus: (serverName: string) => "connected" | "idle" | "failed" | "needs-auth" | "connecting" | "disabled";
    getFailureMessage?: (serverName: string) => string | null;
    refreshCacheAfterReconnect: (serverName: string) => ServerCacheEntry | null;
}
export interface McpPanelResult {
    changes: Map<string, true | string[] | false>;
    cancelled: boolean;
}
export {};

export interface AgentPluginSummary {
    path: string;
    name?: string;
    serverCount: number;
}
export interface AgentPluginMcpConfigSource {
    readonly source: ConfigSourceSpec;
    readonly config: McpConfig;
}
export declare function loadAgentPluginConfigSources(paths: unknown, cwd: string, provenance: {
    readonly scope: "global" | "project";
}): AgentPluginMcpConfigSource[];
export declare function loadAgentPluginConfigs(paths: unknown, cwd?: string): McpConfig;
export declare function getAgentPluginSummaries(paths: unknown, cwd?: string): AgentPluginSummary[];

export interface KnownServerPreset {
    id: string;
    name: string;
    summary: string;
    entry: ServerEntry;
}
export declare const KNOWN_SERVER_PRESETS: readonly KnownServerPreset[];
export interface ConfigSourceSpec {
    id: "shared-global" | "agents-global" | "agents-nested-global" | "pi-global" | "shared-project" | "agents-project" | "agents-nested-project" | "pi-project" | "adapter-config" | "pi-package-global" | "pi-package-project" | "agent-plugin-global" | "agent-plugin-project";
    label: string;
    readPath: string;
    writePath: string;
    kind: "user" | "project" | "shared" | "extension";
    shared: boolean;
    scope: "global" | "project" | "extension";
}
export interface ConfigDiscoveryPath {
    label: string;
    path: string;
    exists: boolean;
}
export interface ConfigDiscoverySource extends ConfigDiscoveryPath {
    id: ConfigSourceSpec["id"];
    scope: ConfigSourceSpec["scope"];
    kind: "shared" | "pi";
    serverCount: number;
    validationError?: {
        code: string;
        message: string;
    };
}
export interface McpConfigConflict {
    serverName: string;
    sources: Array<{
        kind: "shared" | "pi";
        path: string;
    }>;
    winner: {
        kind: "shared" | "pi";
        path: string;
    };
}
export interface RepoPromptDiscovery {
    configured: boolean;
    configuredPath?: string;
    executablePath?: string;
    targetPath?: string;
    serverName?: string;
    entry?: ServerEntry;
}
export interface McpDiscoverySummary {
    sources: ConfigDiscoverySource[];
    agentPlugins: AgentPluginSummary[];
    conflicts: McpConfigConflict[];
    hasAnyConfig: boolean;
    hasAnyDetectedPaths: boolean;
    hasSharedServers: boolean;
    hasPiOwnedServers: boolean;
    totalServerCount: number;
    fingerprint: string;
    repoPrompt: RepoPromptDiscovery;
}
export interface McpStandardConfigSummary {
    sources: ConfigDiscoverySource[];
    hasSharedServers: boolean;
    fingerprint: string;
}
export interface ConfigWritePreview {
    path: string;
    existed: boolean;
    changed: boolean;
    beforeText: string;
    afterText: string;
    diffText: string;
}

export declare const GENERIC_GLOBAL_CONFIG_PATH: string;
export declare const AGENTS_GLOBAL_CONFIG_PATHS: readonly [string, string];

export declare const PROJECT_PI_CONFIG_NAME = "mcp.json";
export declare const REPOPROMPT_BINARY_CANDIDATES: string[];
export declare function getConfigPathFromArgv(argv?: readonly string[]): string | undefined;
export declare function getPiGlobalConfigPath(overridePath?: string): string;
export declare function getGenericGlobalConfigPath(): string;
export declare function getProjectConfigPath(cwd?: string): string;
export declare function getProjectPiConfigPath(cwd?: string): string;
export declare function getConfigDiscoveryPaths(overridePath?: string, cwd?: string): ConfigDiscoveryPath[];
export declare function getConfigSources(overridePath?: string, cwd?: string): ConfigSourceSpec[];
export declare function isExclusiveConfigMode(): boolean;
export declare function getEffectivePiGlobalConfigPath(overridePath?: string): string;
export declare function resolveConfiguredOAuthDir(raw: unknown, cwd?: string): string | undefined;

export type ConfigValidationCode = "invalid-root" | "invalid-server-map" | "invalid-server-name" | "invalid-server-entry" | "unknown-server-field" | "invalid-server-field" | "invalid-settings" | "unknown-settings-field" | "invalid-setting" | "invalid-nested-field" | "conflicting-server-map";
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
export type ConfigValidationResult<T> = {
    readonly ok: true;
    readonly value: T;
    readonly issues?: readonly ConfigValidationIssue[];
} | {
    readonly ok: false;
    readonly error: ConfigValidationError;
};
export declare function validateServerEntry(name: string, raw: unknown, options?: {
    requireTransport?: boolean;
}): ConfigValidationResult<ServerEntry>;
export declare function validateMcpConfig(raw: unknown): ConfigValidationResult<McpConfig>;

export type ConfigReadError = ConfigValidationError | {
    readonly code: "invalid-json" | "read-failed";
    readonly message: string;
    readonly issues: readonly [];
};
export type ConfigReadResult = {
    readonly ok: true;
    readonly value: McpConfig | null;
    readonly issues?: readonly ConfigValidationIssue[];
} | {
    readonly ok: false;
    readonly error: ConfigReadError;
};
export declare function parseJsonConfig(raw: string): unknown;
export declare function readValidatedConfig(path: string, _label: string): ConfigReadResult;

export interface LoadedConfigSource {
    source: ConfigSourceSpec;
    config: McpConfig | null;
    error?: ConfigReadError;
    validationIssues?: readonly ConfigValidationIssue[];
}
export declare function loadConfigSources(overridePath?: string, cwd?: string): LoadedConfigSource[];
export declare function getMergedSettingsFromSources(sources: readonly LoadedConfigSource[]): McpSettings | undefined;
export declare function cloneMcpConfig(config: McpConfig): McpConfig;
export declare function loadMcpConfig(overridePath?: string, cwd?: string): McpConfig;
export declare function getMergedSettings(overridePath?: string, cwd?: string): McpSettings | undefined;

export declare function getMcpStandardConfigSummary(overridePath?: string, cwd?: string): McpStandardConfigSummary;
export declare function getMcpDiscoverySummary(overridePath?: string, cwd?: string): McpDiscoverySummary;

export interface ServerDisabledOverrideResult {
    path: string;
    changed: boolean;
}
/**
 * Persist only the disabled field in the project Pi layer. Enabling writes an
 * explicit false only when a lower-precedence source is itself disabled; this
 * writer never copies a server definition or its credentials into the file.
 */
export declare function writeProjectServerDisabledOverride(overridePath: string | undefined, cwd: string, serverName: string, disabled: boolean): ServerDisabledOverrideResult;
export declare function buildStarterProjectConfig(): McpConfig;
export declare function previewStarterProjectConfig(cwd?: string): ConfigWritePreview;
export declare function writeStarterProjectConfig(cwd?: string): string;
export declare function previewSharedServerEntry(filePath: string, serverName: string, entry: ServerEntry): ConfigWritePreview;
export declare function writeSharedServerEntry(filePath: string, serverName: string, entry: ServerEntry): string;
export declare function getServerProvenance(overridePath?: string, cwd?: string): Map<string, ServerProvenance>;
export declare function writeDirectToolsConfig(changes: Map<string, true | string[] | false>, provenance: Map<string, ServerProvenance>, fullConfig: McpConfig): void;
