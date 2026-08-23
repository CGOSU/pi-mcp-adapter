// Tool naming and prompt command naming.
import type { ServerEntry, ToolPrefix } from "../contracts/core.js";

/**
 * Get server prefix based on tool prefix mode.
 */
function sanitizeServerPrefix(serverName: string, preserveProviderValid = true): string {
  const validCharacters = preserveProviderValid ? /^[A-Za-z0-9_-]$/ : /^[A-Za-z0-9]$/;
  return Array.from(serverName, char =>
    validCharacters.test(char) ? char : `_${char.codePointAt(0)!.toString(16)}_`,
  ).join("");
}

export function getServerPrefix(
  serverName: string,
  mode: ToolPrefix
): string {
  if (mode === "none") return "";
  if (mode === "short") {
    let short = sanitizeServerPrefix(serverName.replace(/-?mcp$/i, ""));
    if (!short) short = "mcp";
    return short;
  }
  if (mode === "mcp") return `mcp__${sanitizeServerPrefix(serverName)}`;
  return sanitizeServerPrefix(serverName);
}

/**
 * Format a tool name with server prefix.
 */
export function formatToolName(
  toolName: string,
  serverName: string,
  prefix: ToolPrefix
): string {
  const p = getServerPrefix(serverName, prefix);
  const sanitized = toolName.replace(/\./g, "_");
  return p ? `${p}_${sanitized}` : sanitized;
}

export function resolveToolPrefix(
  definition?: Pick<ServerEntry, "toolPrefix">,
  globalPrefix?: ToolPrefix,
): ToolPrefix {
  return definition?.toolPrefix ?? globalPrefix ?? "server";
}


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
export function resolveServerFromToolName(
  toolName: string,
  serverNames: Iterable<string>,
  prefix: ToolPrefix,
): string | undefined {
  if (prefix === "none") return undefined;
  const candidates: { name: string; prefix: string }[] = [];
  for (const name of serverNames) {
    const p = getServerPrefix(name, prefix);
    if (p && toolName.startsWith(p + "_")) candidates.push({ name, prefix: p });
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.prefix.length - a.prefix.length);
  const best = candidates[0];
  // Fail safe: short mode can intentionally map names such as foo and foo-mcp
  // to the same prefix. Return undefined so a downstream permission gate uses
  // its existing wildcard path rather than enforcing a rule against the wrong server.
  if (candidates.some((c) => c.prefix === best!.prefix && c.name !== best!.name)) {
    return undefined;
  }
  return best?.name;
}

export function sanitizePromptName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
  if (!cleaned) return "prompt";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function formatPromptCommandName(
  promptName: string,
  serverName: string,
  prefix: ToolPrefix,
): string {
  const serverPart = getServerPrefix(serverName, prefix) || sanitizeServerPrefix(serverName) || "server";
  return `mcp__${serverPart}__${sanitizePromptName(promptName)}`;
}

function getLegacyServerPrefix(serverName: string, mode: ToolPrefix): string {
  if (mode === "none") return "";
  if (mode === "short") return sanitizeServerPrefix(serverName.replace(/-?mcp$/i, ""), false) || "mcp";
  if (mode === "mcp") return `mcp__${sanitizeServerPrefix(serverName, false)}`;
  return sanitizeServerPrefix(serverName, false);
}

function formatLegacyToolName(toolName: string, serverName: string, prefix: ToolPrefix): string {
  const serverPrefix = getLegacyServerPrefix(serverName, prefix);
  const sanitizedToolName = toolName.replace(/[.-]/g, "_");
  return serverPrefix ? `${serverPrefix}_${sanitizedToolName}` : sanitizedToolName;
}

export function getToolNameCandidates(toolName: string, serverName: string, prefix: ToolPrefix, includeLegacy = true): Set<string> {
  const candidates = new Set<string>([
    toolName,
    formatToolName(toolName, serverName, prefix),
    formatToolName(toolName, serverName, "server"),
    formatToolName(toolName, serverName, "short"),
    formatToolName(toolName, serverName, "mcp"),
  ]);
  if (includeLegacy) {
    const legacyToolName = toolName.replace(/-/g, "_");
    candidates.add(legacyToolName);
    candidates.add(formatToolName(legacyToolName, serverName, prefix));
    candidates.add(formatToolName(legacyToolName, serverName, "server"));
    candidates.add(formatToolName(legacyToolName, serverName, "short"));
    candidates.add(formatToolName(legacyToolName, serverName, "mcp"));
    candidates.add(formatLegacyToolName(toolName, serverName, prefix));
    candidates.add(formatLegacyToolName(toolName, serverName, "server"));
    candidates.add(formatLegacyToolName(toolName, serverName, "short"));
    candidates.add(formatLegacyToolName(toolName, serverName, "mcp"));
    candidates.add(formatToolName(toolName, serverName, prefix).replace(/-/g, "_"));
    candidates.add(formatToolName(toolName, serverName, "server").replace(/-/g, "_"));
    candidates.add(formatToolName(toolName, serverName, "short").replace(/-/g, "_"));
    candidates.add(formatToolName(toolName, serverName, "mcp").replace(/-/g, "_"));
  }
  return candidates;
}
