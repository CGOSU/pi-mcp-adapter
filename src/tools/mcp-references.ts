import { isUiToolVisibleToModel } from "../ui/tool-visibility.ts";
import { resourceNameToToolName } from "./resource-tools.ts";
import { createCachedToolSelectorCandidateIndex, createMetadataCatalogSnapshot, isServerCacheValid, parseDirectToolSelectors, type MetadataCache, type MetadataCatalogSnapshot } from "../catalog/metadata-cache.ts";
import { formatToolName, resolveToolPrefix } from "../catalog/tool-names.ts";
import { isToolAllowed, type ToolSelectorCandidateIndex } from "../catalog/tool-selectors.ts";
import { isServerDisabled } from "../contracts/core.ts";
import type { CachedTool, McpConfig, ServerCacheEntry, ServerEntry, ToolPrefix } from "../contracts/core.ts";

export interface ParsedMcpReference {
  raw: string;
  server?: string;
  tool?: string;
}

export interface McpReferenceResolution {
  names: string[];
  diagnostics: string[];
}

export type DirectToolSelectorOverride = { servers: Set<string>; tools: Map<string, Set<string>> };
type DirectSelection = true | string[] | false;
type DirectNameOwner = { serverName: string; originalName: string };
type DirectNameEntry = { name: string; originalName: string };
type CachedServer = { serverName: string; definition: ServerEntry; entry: ServerCacheEntry; prefix: ToolPrefix };

const BUILTIN_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls", "mcp"]);

export function namespaceProxyName(serverName: string): string {
  return `mcp__${serverName.replace(/-/g, "_")}`;
}

export function parseMcpReference(raw: string): ParsedMcpReference {
  if (!raw.startsWith("mcp:")) return { raw };
  const rest = raw.slice("mcp:".length).trim();
  if (!rest) return { raw };

  const slash = rest.indexOf("/");
  if (slash === -1) return { raw, server: rest };

  const server = rest.slice(0, slash).trim();
  const tool = rest.slice(slash + 1).trim();
  return {
    raw,
    ...(server ? { server } : {}),
    ...(tool ? { tool } : {}),
  };
}

function resolveDirectSelection(
  config: McpConfig,
  definition: Pick<ServerEntry, "directTools">,
  serverName: string,
  envOverride: DirectToolSelectorOverride | null,
): DirectSelection {
  if (envOverride) {
    if (envOverride.servers.has(serverName)) return true;
    const selectedTools = envOverride.tools.get(serverName);
    return selectedTools ? [...selectedTools] : false;
  }
  if (definition.directTools !== undefined) return definition.directTools;
  return config.settings?.directTools === true;
}

export function isMcpServerDirectlyRegistered(
  definition: { directTools?: boolean | string[] } | undefined,
  settings: McpConfig["settings"],
  serverName: string,
  envOverride: DirectToolSelectorOverride | null,
): boolean {
  if (envOverride) return envOverride.servers.has(serverName);
  if (definition?.directTools !== undefined) {
    return definition.directTools === true || (Array.isArray(definition.directTools) && definition.directTools.length > 0);
  }
  return settings?.directTools === true;
}

export function hasCallableCachedTargets(entry: Pick<ServerCacheEntry, "tools" | "resources">, definition: Pick<ServerEntry, "exposeResources">): boolean {
  return entry.tools.length > 0 || (definition.exposeResources !== false && (entry.resources?.length ?? 0) > 0);
}

function hasNamespaceProxy(
  config: McpConfig,
  cache: MetadataCache | null,
  envOverride: DirectToolSelectorOverride | null,
  collidingNamespaceNames: ReadonlySet<string>,
  existingDirectNames: ReadonlySet<string>,
  serverName: string,
  snapshot?: MetadataCatalogSnapshot,
): boolean {
  const definition = config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition)) return false;
  if (isMcpServerDirectlyRegistered(definition, config.settings, serverName, envOverride)) return false;
  const toolName = namespaceProxyName(serverName);
  if (collidingNamespaceNames.has(toolName) || existingDirectNames.has(toolName)) return false;
  const entry = resolveValidCache(definition, cache, serverName, snapshot);
  return !!entry && hasCallableCachedTargets(entry, definition);
}

function resolveValidCache(
  definition: ServerEntry | undefined,
  cache: MetadataCache | null,
  serverName: string,
  snapshot?: MetadataCatalogSnapshot,
): ServerCacheEntry | undefined {
  if (!definition) return undefined;
  if (snapshot) return snapshot.validEntries.get(serverName);
  const entry = cache?.servers[serverName];
  if (!entry || !isServerCacheValid(entry, definition)) return undefined;
  return entry;
}

function cachedServers(config: McpConfig, cache: MetadataCache | null, snapshot?: MetadataCatalogSnapshot): CachedServer[] {
  const servers: CachedServer[] = [];
  if (!cache) return servers;
  for (const [serverName, definition] of Object.entries(config.mcpServers)) {
    if (isServerDisabled(definition)) continue;
    const entry = resolveValidCache(definition, cache, serverName, snapshot);
    if (!entry) continue;
    servers.push({ serverName, definition, entry, prefix: resolveToolPrefix(definition, config.settings?.toolPrefix) });
  }
  return servers;
}

function namespaceCollisionNames(
  config: McpConfig,
  cache: MetadataCache | null,
  envOverride: DirectToolSelectorOverride | null,
  existingDirectNames: ReadonlySet<string>,
  snapshot?: MetadataCatalogSnapshot,
): Set<string> {
  const names = new Map<string, number>();
  if (!cache) return new Set();
  for (const serverName of Object.keys(config.mcpServers)) {
    if (!hasNamespaceProxy(config, cache, envOverride, new Set(), existingDirectNames, serverName, snapshot)) continue;
    const toolName = namespaceProxyName(serverName);
    names.set(toolName, (names.get(toolName) ?? 0) + 1);
  }
  return new Set([...names].filter(([, count]) => count > 1).map(([name]) => name));
}

function registeredDirectNames(
  config: McpConfig,
  cache: MetadataCache | null,
  envOverride: DirectToolSelectorOverride | null,
  selectorIndex: ToolSelectorCandidateIndex | undefined,
  snapshot?: MetadataCatalogSnapshot,
): Map<string, DirectNameOwner> {
  const owners = new Map<string, DirectNameOwner>();
  for (const { serverName, definition, entry, prefix } of cachedServers(config, cache, snapshot)) {
    const selection = resolveDirectSelection(config, definition, serverName, envOverride);
    for (const { name, originalName } of directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex)) {
      if (!owners.has(name)) owners.set(name, { serverName, originalName });
    }
  }
  return owners;
}

function allCurrentCandidates(
  config: McpConfig,
  cache: MetadataCache | null,
  snapshot?: MetadataCatalogSnapshot,
): ToolSelectorCandidateIndex | undefined {
  if (!cache) return undefined;
  return createCachedToolSelectorCandidateIndex(config.mcpServers, cache, config.settings?.toolPrefix ?? "server", snapshot);
}

function directToolName(
  toolName: string,
  serverName: string,
  definition: ServerEntry,
  prefix: ToolPrefix,
  selectorIndex: ToolSelectorCandidateIndex | undefined,
): string | undefined {
  if (!isToolAllowed(toolName, serverName, prefix, definition.includeTools, definition.excludeTools, selectorIndex)) return undefined;
  return formatToolName(toolName, serverName, prefix);
}

function directNameEntries(
  entry: ServerCacheEntry,
  serverName: string,
  definition: ServerEntry,
  prefix: ToolPrefix,
  selection: DirectSelection,
  selectorIndex: ToolSelectorCandidateIndex | undefined,
  onlyTool?: string,
): DirectNameEntry[] {
  if (!selection) return [];
  const names: DirectNameEntry[] = [];
  const addTool = (toolName: string): void => {
    if (selection !== true && !selection.includes(toolName)) return;
    const name = directToolName(toolName, serverName, definition, prefix, selectorIndex);
    if (!name) return;
    if (BUILTIN_NAMES.has(name)) return;
    if (onlyTool !== undefined && toolName !== onlyTool && name !== onlyTool) return;
    names.push({ name, originalName: toolName });
  };

  for (const tool of entry.tools) {
    if (!isUiToolVisibleToModel(tool.uiVisibility)) continue;
    addTool(tool.name);
  }
  if (definition.exposeResources !== false) {
    for (const resource of entry.resources ?? []) addTool(`read_${resourceNameToToolName(resource.name)}`);
  }
  return names;
}

function ownedDirectToolNames(names: DirectNameEntry[], serverName: string, directNameOwners: ReadonlyMap<string, DirectNameOwner>): string[] {
  return names
    .filter(({ name, originalName }) => {
      const owner = directNameOwners.get(name);
      return owner?.serverName === serverName && owner.originalName === originalName;
    })
    .map(({ name }) => name);
}

function hasAllowedProxyTool(
  entry: Pick<ServerCacheEntry, "tools" | "resources">,
  serverName: string,
  definition: ServerEntry,
  prefix: ToolPrefix,
  selectorIndex: ToolSelectorCandidateIndex | undefined,
  toolName: string | undefined,
): boolean {
  if (toolName === undefined) return true;
  const matchesAllowedName = (baseName: string) => {
    if (!isToolAllowed(baseName, serverName, prefix, definition.includeTools, definition.excludeTools, selectorIndex)) return false;
    return toolName === formatToolName(baseName, serverName, prefix);
  };
  if (entry.tools.some((tool: CachedTool) =>
    isUiToolVisibleToModel(tool.uiVisibility) &&
    matchesAllowedName(tool.name)
  )) return true;
  if (definition.exposeResources === false) return false;
  return (entry.resources ?? []).some((resource) => {
    const baseName = `read_${resourceNameToToolName(resource.name)}`;
    return matchesAllowedName(baseName);
  });
}

function addName(names: string[], seen: Set<string>, name: string): void {
  if (seen.has(name)) return;
  seen.add(name);
  names.push(name);
}

function resolveKnownServerReference(
  parsed: ParsedMcpReference,
  config: McpConfig,
  cache: MetadataCache | null,
  envOverride: DirectToolSelectorOverride | null,
  collidingNamespaceNames: ReadonlySet<string>,
  existingDirectNames: ReadonlySet<string>,
  directNameOwners: ReadonlyMap<string, DirectNameOwner>,
  selectorIndex: ToolSelectorCandidateIndex | undefined,
  names: string[],
  seen: Set<string>,
  diagnostics: string[],
  snapshot?: MetadataCatalogSnapshot,
): void {
  const serverName = parsed.server!;
  const definition = config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition)) {
    diagnostics.push(`MCP reference "${parsed.raw}" refers to disabled or unknown server "${serverName}"`);
    return;
  }
  const entry = resolveValidCache(definition, cache, serverName, snapshot);
  if (!entry) {
    diagnostics.push(`MCP reference "${parsed.raw}" cannot be resolved: no valid cached metadata for server "${serverName}"`);
    return;
  }

  const prefix = resolveToolPrefix(definition, config.settings?.toolPrefix);
  const selection = resolveDirectSelection(config, definition, serverName, envOverride);
  const directNames = ownedDirectToolNames(
    directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex, parsed.tool),
    serverName,
    directNameOwners,
  );
  if (directNames.length > 0) {
    for (const name of directNames) addName(names, seen, name);
    return;
  }

  if (hasNamespaceProxy(config, cache, envOverride, collidingNamespaceNames, existingDirectNames, serverName, snapshot)) {
    if (hasAllowedProxyTool(entry, serverName, definition, prefix, selectorIndex, parsed.tool)) {
      addName(names, seen, namespaceProxyName(serverName));
      return;
    }
    diagnostics.push(`MCP reference "${parsed.raw}" refers to unknown or hidden tool "${parsed.tool}" on server "${serverName}"`);
    return;
  }

  diagnostics.push(`MCP reference "${parsed.raw}" resolves to no registered tool`);
}

function resolveBareToolReference(
  raw: string,
  toolName: string,
  config: McpConfig,
  cache: MetadataCache | null,
  envOverride: DirectToolSelectorOverride | null,
  collidingNamespaceNames: ReadonlySet<string>,
  existingDirectNames: ReadonlySet<string>,
  directNameOwners: ReadonlyMap<string, DirectNameOwner>,
  selectorIndex: ToolSelectorCandidateIndex | undefined,
  names: string[],
  seen: Set<string>,
  diagnostics: string[],
  snapshot?: MetadataCatalogSnapshot,
): void {
  let matched = false;
  for (const { serverName, definition, entry, prefix } of cachedServers(config, cache, snapshot)) {
    const selection = resolveDirectSelection(config, definition, serverName, envOverride);
    const directNames = ownedDirectToolNames(
      directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex, toolName),
      serverName,
      directNameOwners,
    );
    for (const name of directNames) {
      addName(names, seen, name);
      matched = true;
    }
    if (hasNamespaceProxy(config, cache, envOverride, collidingNamespaceNames, existingDirectNames, serverName, snapshot) &&
        hasAllowedProxyTool(entry, serverName, definition, prefix, selectorIndex, toolName)) {
      addName(names, seen, namespaceProxyName(serverName));
      matched = true;
    }
  }
  if (!matched) diagnostics.push(`MCP reference "${raw}" does not match a configured server or cached tool`);
}

export function resolveMcpToolReferences(
  refs: string[],
  config: McpConfig | null,
  cache: MetadataCache | null,
  envOverride?: string[],
  snapshot?: MetadataCatalogSnapshot,
): McpReferenceResolution {
  const names: string[] = [];
  const diagnostics: string[] = [];
  const seen = new Set<string>();

  if (!config) {
    return {
      names: refs.filter((ref) => !ref.startsWith("mcp:")),
      diagnostics: refs.filter((ref) => ref.startsWith("mcp:")).map((ref) => `MCP reference "${ref}" cannot be resolved: no MCP config`),
    };
  }

  const catalog = snapshot ?? createMetadataCatalogSnapshot(config, cache);
  const effectiveCache = catalog.cache;
  const parsedOverride = envOverride ? parseDirectToolSelectors(envOverride) : null;
  const selectorIndex = allCurrentCandidates(config, effectiveCache, catalog);
  const directNameOwners = registeredDirectNames(config, effectiveCache, parsedOverride, selectorIndex, catalog);
  const directNames = new Set(directNameOwners.keys());
  const collidingNamespaceNames = namespaceCollisionNames(config, effectiveCache, parsedOverride, directNames, catalog);

  for (const ref of refs) {
    if (!ref.startsWith("mcp:")) {
      addName(names, seen, ref);
      continue;
    }
    const parsed = parseMcpReference(ref);
    if (!parsed.server) {
      diagnostics.push(`MCP reference "${ref}" is empty after the "mcp:" prefix`);
      continue;
    }
    if (config.mcpServers[parsed.server]) {
      resolveKnownServerReference(parsed, config, effectiveCache, parsedOverride, collidingNamespaceNames, directNames, directNameOwners, selectorIndex, names, seen, diagnostics, catalog);
    } else if (parsed.tool === undefined) {
      resolveBareToolReference(ref, parsed.server, config, effectiveCache, parsedOverride, collidingNamespaceNames, directNames, directNameOwners, selectorIndex, names, seen, diagnostics, catalog);
    } else {
      diagnostics.push(`MCP reference "${ref}" refers to unknown server "${parsed.server}"`);
    }
  }

  return { names, diagnostics };
}
