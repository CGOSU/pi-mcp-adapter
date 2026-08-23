import type { CallToolResult, ContentBlock as McpContentBlock } from "@modelcontextprotocol/client";
import type { UiStreamSummary } from "../ui/stream-types.js";
export interface UiResourceMeta {
    csp?: UiResourceCsp;
    permissions?: UiResourcePermissions;
    domain?: string;
    prefersBorder?: boolean;
}
export interface UiResourceContent {
    uri: string;
    html: string;
    mimeType?: string;
    meta: UiResourceMeta;
}
export interface UiProxyRequestBody<TParams> {
    token: string;
    params: TParams;
}
export interface UiProxyResult<T = Record<string, unknown>> {
    ok: boolean;
    result?: T;
    error?: string;
}
export interface UiResourceCsp {
    resourceDomains?: string[];
    connectDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
}
export interface UiResourcePermissions {
    camera?: {};
    microphone?: {};
    geolocation?: {};
    clipboardWrite?: {};
}
export interface UiToolInfo {
    id?: string | number;
    tool: {
        name: string;
        description?: string;
        inputSchema?: unknown;
    };
}
export interface UiHostContext {
    toolInfo?: UiToolInfo;
    theme?: "light" | "dark";
    styles?: Record<string, unknown>;
    displayMode?: UiDisplayMode;
    availableDisplayModes?: UiDisplayMode[];
    containerDimensions?: {
        width?: number;
        maxWidth?: number;
        height?: number;
        maxHeight?: number;
    };
    [key: string]: unknown;
}
export type UiDisplayMode = "inline" | "fullscreen" | "pip";
/**
 * Live handle to a started UI tool session. Lives here (leaf module) so
 * `state.ts` can reference it without importing `src/ui/server.ts`, which
 * imports the state type back — an import cycle at type level.
 */
export interface UiServerHandle {
    url: string;
    port: number;
    sessionToken: string;
    serverName: string;
    toolName: string;
    viewer?: "browser" | "glimpse" | "suppressed";
    windowOpen?: boolean;
    close: (reason?: string) => void;
    sendToolInput: (args: Record<string, unknown>) => void;
    sendToolResult: (result: CallToolResult) => void;
    sendResultPatch: (result: CallToolResult) => void;
    sendToolCancelled: (reason: string) => void;
    sendHostContext: (context: UiHostContext) => void;
    /** Get accumulated messages from this session */
    getSessionMessages: () => UiSessionMessages;
    getStreamSummary: () => UiStreamSummary | undefined;
}
export interface UiMessageParams {
    role?: string;
    content?: unknown[];
    type?: "prompt" | "notify" | "intent" | "message";
    message?: string;
    prompt?: string;
    intent?: string;
    params?: Record<string, unknown>;
    [key: string]: unknown;
}
/**
 * Extract prompt text from either legacy MCP UI message shapes or native AppBridge user messages.
 */
export declare function extractUiPromptText(params: UiMessageParams): string | undefined;
/**
 * Structured UI handoff recovered from a canonical prompt envelope.
 */
export interface UiPromptHandoff {
    intent: string;
    params: Record<string, unknown>;
    raw: string;
}
/**
 * Parse a canonical named UI handoff encoded as `intent\n{json}`.
 */
export declare function parseUiPromptHandoff(prompt: string): UiPromptHandoff | undefined;
/**
 * Accumulated messages from a UI session.
 * Collected during the session and available when it ends.
 */
export interface UiSessionMessages {
    prompts: string[];
    notifications: string[];
    intents: Array<{
        intent: string;
        params?: Record<string, unknown>;
    }>;
    contexts: UiModelContextUpdate[];
}
export interface UiModelContextUpdate {
    summary: string;
    truncated: boolean;
    payload?: Record<string, unknown>;
}
export interface UiModelContextParams {
    content?: McpContentBlock[];
    structuredContent?: Record<string, unknown>;
}
export declare function createUiModelContextUpdate(params: UiModelContextParams, maxChars?: number): UiModelContextUpdate | undefined;
export interface UiOpenLinkResult {
    isError?: boolean;
    [key: string]: unknown;
}
export interface UiDisplayModeRequest {
    mode?: UiDisplayMode;
}
export interface UiDisplayModeResult {
    mode: UiDisplayMode;
    [key: string]: unknown;
}
