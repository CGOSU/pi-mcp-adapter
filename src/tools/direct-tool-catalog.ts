import { Check, Errors } from "typebox/value";
import type { MetadataCache, MetadataCatalogSnapshot } from "../catalog/metadata-cache.ts";
import { createCachedToolSelectorCandidateIndex, createMetadataCatalogSnapshot, parseDirectToolSelectors } from "../catalog/metadata-cache.ts";
import type { DirectToolSpec, McpConfig, ToolPrefix } from "../contracts/core.ts";
import { isServerDisabled } from "../contracts/core.ts";
import { formatToolName, resolveToolPrefix } from "../catalog/tool-names.ts";
import { isToolAllowed, type ToolSelectorCandidateIndex } from "../catalog/tool-selectors.ts";
import { isUiToolVisibleToModel } from "../ui/tool-visibility.ts";
import { resourceNameToToolName } from "./resource-tools.ts";

export { getMissingConfiguredDirectToolServers } from "../catalog/metadata-cache.ts";

const BUILTIN_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls", "mcp"]);

export const DIRECT_TOOLS_ADVISORY_THRESHOLD = 75;

/**
 * Recover one model-emitted JSON layer for schema-declared object and array
 * properties, then validate the complete input against the same schema.
 */
export function prepareDirectToolArguments(inputSchema: unknown, args: unknown): unknown {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) return args;
  const schema = inputSchema as Record<string, unknown>;
  if (schema.type !== "object") return args;
  const input = args && typeof args === "object" && !Array.isArray(args)
    ? args as Record<string, unknown>
    : null;
  const properties = schema.properties;
  let prepared: Record<string, unknown> | undefined;

  if (input && properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const [name, propertySchema] of Object.entries(properties)) {
      if (!Object.hasOwn(input, name) || typeof input[name] !== "string"
        || !propertySchema || typeof propertySchema !== "object" || Array.isArray(propertySchema)) continue;
      const expectedType = (propertySchema as Record<string, unknown>).type;
      if (expectedType !== "object" && expectedType !== "array") continue;
      try {
        const parsed: unknown = JSON.parse(input[name] as string);
        const matches = expectedType === "array"
          ? Array.isArray(parsed)
          : parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
        if (matches) {
          prepared ??= { ...input };
          prepared[name] = parsed;
        }
      } catch {
        // Validation below reports malformed or shape-incompatible values.
      }
    }
  }

  const candidate = prepared ?? args;
  if (!Check(inputSchema as never, candidate)) {
    const errors = Errors(inputSchema as never, candidate);
    const issues = errors.slice(0, 8).map((error) => ({
      instancePath: error.instancePath || "/",
      keyword: error.keyword,
      message: error.message,
    }));
    throw new TypeError(`MCP direct tool arguments do not match the advertised input schema: ${JSON.stringify({
      issues,
      total: errors.length,
      truncated: errors.length > issues.length,
    })}`);
  }
  return candidate;
}

export function resolveDirectTools(
  config: McpConfig,
  cache: MetadataCache | null,
  prefix: ToolPrefix,
  envOverride?: string[],
  unavailableServers: ReadonlySet<string> = new Set(),
  reservedNames?: Set<string>,
  snapshot?: MetadataCatalogSnapshot,
): DirectToolSpec[] {
  const catalog = snapshot ?? createMetadataCatalogSnapshot(config, cache);
  const catalogCache = catalog.cache;
  const specs: DirectToolSpec[] = [];
  if (!catalogCache) return specs;

  const seenNames = new Set<string>();
  let selectorCandidateIndex: ToolSelectorCandidateIndex | undefined;
  let selectorCandidateIndexInitialized = false;
  const getSelectorCandidateIndex = (): ToolSelectorCandidateIndex | undefined => {
    if (selectorCandidateIndexInitialized) return selectorCandidateIndex;
    selectorCandidateIndexInitialized = true;
    selectorCandidateIndex = createCachedToolSelectorCandidateIndex(config.mcpServers, catalogCache, prefix, catalog);
    return selectorCandidateIndex;
  };

  const envSelection = envOverride ? parseDirectToolSelectors(envOverride) : null;
  const globalDirect = config.settings?.directTools;

  for (const [serverName, definition] of Object.entries(config.mcpServers)) {
    if (isServerDisabled(definition)) continue;
    const serverCache = catalog.validEntries.get(serverName);
    if (!serverCache) continue;

    let toolFilter: true | string[] | false = false;

    if (envSelection) {
      if (envSelection.servers.has(serverName)) {
        toolFilter = true;
      } else if (envSelection.tools.has(serverName)) {
        toolFilter = [...envSelection.tools.get(serverName)!];
      }
    } else {
      if (definition.directTools !== undefined) {
        toolFilter = definition.directTools;
      } else if (globalDirect) {
        toolFilter = globalDirect;
      }
    }

    if (!toolFilter) continue;

    const effectivePrefix = resolveToolPrefix(definition, prefix);
    const hasToolFilters =
      (Array.isArray(definition.includeTools) && definition.includeTools.length > 0) ||
      (Array.isArray(definition.excludeTools) && definition.excludeTools.length > 0);
    const selectorIndex = hasToolFilters ? getSelectorCandidateIndex() : undefined;

    for (const tool of serverCache.tools ?? []) {
      if (!isUiToolVisibleToModel(tool.uiVisibility)) continue;
      if (toolFilter !== true && !toolFilter.includes(tool.name)) continue;
      if (!isToolAllowed(tool.name, serverName, effectivePrefix, definition.includeTools, definition.excludeTools, selectorIndex)) continue;
      const prefixedName = formatToolName(tool.name, serverName, effectivePrefix);
      if (BUILTIN_NAMES.has(prefixedName)) {
        console.warn(`MCP: skipping direct tool "${prefixedName}" (collides with builtin)`);
        continue;
      }
      if (seenNames.has(prefixedName)) {
        console.warn(`MCP: skipping duplicate direct tool "${prefixedName}" from "${serverName}"`);
        continue;
      }
      seenNames.add(prefixedName);
      specs.push({
        serverName,
        originalName: tool.name,
        prefixedName,
        description: tool.description ?? "",
        ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
        ...(tool.uiResourceUri !== undefined ? { uiResourceUri: tool.uiResourceUri } : {}),
        ...(tool.uiStreamMode !== undefined ? { uiStreamMode: tool.uiStreamMode } : {}),
      });
    }

    if (definition.exposeResources !== false) {
      for (const resource of serverCache.resources ?? []) {
        const baseName = `read_${resourceNameToToolName(resource.name)}`;
        if (toolFilter !== true && !toolFilter.includes(baseName)) continue;
        if (!isToolAllowed(baseName, serverName, effectivePrefix, definition.includeTools, definition.excludeTools, selectorIndex)) continue;
        const prefixedName = formatToolName(baseName, serverName, effectivePrefix);
        if (BUILTIN_NAMES.has(prefixedName)) {
          console.warn(`MCP: skipping direct resource tool "${prefixedName}" (collides with builtin)`);
          continue;
        }
        if (seenNames.has(prefixedName)) {
          console.warn(`MCP: skipping duplicate direct resource tool "${prefixedName}" from "${serverName}"`);
          continue;
        }
        seenNames.add(prefixedName);
        specs.push({
          serverName,
          originalName: baseName,
          prefixedName,
          description: resource.description ?? `Read resource: ${resource.uri}`,
          resourceUri: resource.uri,
        });
      }
    }
  }

  for (const spec of specs) reservedNames?.add(spec.prefixedName);

  const emittedSpecs = unavailableServers.size === 0
    ? specs
    : specs.filter((spec) => !unavailableServers.has(spec.serverName));

  if (config.settings?.warnOnLargeDirectTools !== false && emittedSpecs.length >= DIRECT_TOOLS_ADVISORY_THRESHOLD) {
    console.warn(`MCP: ${emittedSpecs.length} direct tools resolved. Each direct tool adds prompt context; README guidance recommends targeted sets of 5-20 tools and using the proxy or an explicit string[] when 75+ direct tools would be registered. Set settings.warnOnLargeDirectTools to false to hide this advisory.`);
  }

  return emittedSpecs;
}

/**
 * Pure function of config: the description must stay byte-stable across
 * runtime metadata changes (tool counts, instructions, connection state) so
 * re-registering the proxy tool never rewrites the cached prompt prefix.
 * Live counts/status belong to `mcp({ })`, full instructions to
 * `mcp({ instructions })`.
 */
export function buildProxyDescription(config: McpConfig): string {
  let desc = `MCP gateway — server status, tool search/describe, auth, and single MCP tool calls. When one request needs several MCP calls with logic between them, use mcpScript. Non-MCP Pi tools should be called directly, not through mcp.\n`;

  const serverNames = Object.keys(config.mcpServers)
    .filter((serverName) => !isServerDisabled(config.mcpServers[serverName]));
  if (serverNames.length > 0) {
    desc += `\nServers: ${serverNames.join(", ")}\n`;
  }

  const disabledServers = Object.entries(config.mcpServers)
    .filter(([, definition]) => isServerDisabled(definition))
    .map(([serverName]) => serverName);
  if (disabledServers.length > 0) {
    desc += `\nDisabled servers (enable with /mcp enable <server> and /reload): ${disabledServers.join(", ")}\n`;
  }

  desc += `\nUsage:\n`;
  desc += `  mcp({ })                              → Show server status and tool counts\n`;
  desc += `  mcp({ server: "name" })               → List tools from server\n`;
  desc += `  mcp({ search: "query" })              → Search MCP tools by name/description\n`;
  desc += `  mcp({ describe: "tool_name" })        → Show tool details and parameters\n`;
  desc += `  mcp({ instructions: "name" })         → Show full server usage instructions\n`;
  desc += `  mcp({ connect: "server-name" })       → Connect to a server and refresh metadata\n`;
  desc += `  mcp({ tool: "name", args: { key: "value" } })         → Call a tool (object args; JSON string also accepted)\n`;
  desc += `  mcp({ action: "ui-messages" })        → Retrieve accumulated messages from completed UI sessions\n`;
  desc += `  mcp({ action: "auth-start", server: "name" })      → Start manual OAuth and get a browser URL\n`;
  desc += `  mcp({ action: "auth-complete", server: "name", args: { redirectUrl: "..." } }) → Complete manual OAuth\n`;
  desc += `\nMode: action > tool (call) > connect > describe > instructions > search > server (list) > nothing (status)`;

  return desc;
}
