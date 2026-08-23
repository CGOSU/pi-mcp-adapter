import type { ServerEntry, ToolPrefix } from "../contracts/core.js";
export declare function getServerPrefix(serverName: string, mode: ToolPrefix): string;
/**
 * Format a tool name with server prefix.
 */
export declare function formatToolName(toolName: string, serverName: string, prefix: ToolPrefix): string;
export declare function resolveToolPrefix(definition?: Pick<ServerEntry, "toolPrefix">, globalPrefix?: ToolPrefix): ToolPrefix;
/**
 * Resolve a configured MCP server name from a prefixed tool name.
 *
 * When the proxy tool is addressed with a fully-qualified name such as
 * `searxng_searxng_web_search`, downstream policy systems (for example a
 * permission gate) need to recover the owning server so they can evaluate
 * server-scoped rules against the bare server name. This performs the inverse
 * of {@link getServerPrefix}: it finds the longest configured server prefix
 * that the tool name starts with and returns that server's name.
 *
 * @param toolName - the tool name as passed to the proxy `mcp({ tool })` call.
 * @param serverNames - the configured MCP server names (keys of `mcpServers`).
 * @param prefix - the active tool-prefix mode.
 * @returns the resolved server name, or `undefined` when no prefix matches or
 *   the prefix mode is `"none"`.
 */
export declare function resolveServerFromToolName(toolName: string, serverNames: Iterable<string>, prefix: ToolPrefix): string | undefined;
export declare function sanitizePromptName(name: string): string;
export declare function formatPromptCommandName(promptName: string, serverName: string, prefix: ToolPrefix): string;
export declare function getToolNameCandidates(toolName: string, serverName: string, prefix: ToolPrefix, includeLegacy?: boolean): Set<string>;
