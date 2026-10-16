import type {
  McpManagementExecutionPolicy,
  McpManagementResourceSnapshot,
  McpManagementResourceTemplateSnapshot,
  McpManagementServerScope,
  McpManagementSnapshot,
} from "@earendil-works/pi-coding-agent";
import { computeServerHash } from "../catalog/metadata-cache.ts";
import { isToolAllowed } from "../catalog/tool-selectors.ts";
import { getToolNameCandidates, resolveToolPrefix } from "../catalog/tool-names.ts";
import type { McpConfig, ServerEntry, ToolPrefix } from "../contracts/core.ts";
import { resourceNameToToolName } from "../tools/resource-tools.ts";
import { isUiToolVisibleToModel } from "../ui/tool-visibility.ts";
import type { NativePanelConfiguration } from "./config-assembly.ts";
import type { CachedTool, MetadataCache } from "../contracts/core.ts";

export interface NativePanelResource {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly kind: "resource" | "app" | "template";
}

export interface NativePanelServerDetails {
  readonly scope: McpManagementServerScope;
  readonly catalogFreshness: "live" | "cached" | "missing";
  readonly resourceFreshness: "live" | "cached" | "missing";
  readonly resourcesAvailable: boolean;
  readonly resources: readonly NativePanelResource[];
  readonly toolExposures: ReadonlyMap<string, "codemode" | "deferred" | "direct" | "hidden">;
}

export interface NativeMcpPanelData {
  readonly config: McpConfig;
  readonly cache: MetadataCache | null;
  readonly details: ReadonlyMap<string, NativePanelServerDetails>;
  readonly visibleToolCountByServer: ReadonlyMap<string, number>;
  readonly visibleResourceCountByServer: ReadonlyMap<string, number>;
}

function asEntry(
  serverName: string,
  server: McpManagementSnapshot["servers"][number],
  configuration: NativePanelConfiguration,
  runtimePolicies: ReadonlyMap<string, McpManagementExecutionPolicy>,
): ServerEntry {
  const mapped = configuration.servers.get(serverName);
  const runtimePolicy = runtimePolicies.get(serverName);
  const directTools = server.directTools ?? mapped?.directTools;
  const includeTools = runtimePolicy?.includeTools ?? mapped?.includeTools;
  const excludeTools = runtimePolicy?.excludeTools ?? mapped?.excludeTools;
  const exposeResources = runtimePolicy?.exposeResources ?? mapped?.exposeResources;
  const toolPrefix = runtimePolicy?.toolPrefix ?? mapped?.toolPrefix ?? configuration.toolPrefix;
  return {
    enabled: server.enabled,
    exposure: server.exposure,
    ...(directTools === undefined
      ? {}
      : { directTools: typeof directTools === "boolean" ? directTools : [...directTools] }),
    ...(includeTools === undefined ? {} : { includeTools: [...includeTools] }),
    ...(excludeTools === undefined ? {} : { excludeTools: [...excludeTools] }),
    ...(exposeResources === undefined ? {} : { exposeResources }),
    ...(toolPrefix === undefined ? {} : { toolPrefix }),
  };
}

function currentCandidates(
  serverName: string,
  toolName: string,
  definition: ServerEntry,
  servers: McpManagementSnapshot["servers"],
  definitions: ReadonlyMap<string, ServerEntry>,
): Set<string> {
  const candidates = new Set<string>();
  for (const other of servers) {
    if (!other.enabled) continue;
    const otherDefinition = definitions.get(other.name);
    if (!otherDefinition) continue;
    const otherPrefix = resolveToolPrefix(otherDefinition, otherDefinition.toolPrefix ?? "server");
    for (const tool of other.catalog.tools) {
      if (tool.exposure === "hidden" || !isUiToolVisibleToModel(tool.uiVisibility)) continue;
      for (const candidate of getToolNameCandidates(tool.name, other.name, otherPrefix, false)) {
        candidates.add(candidate);
      }
    }
    if (otherDefinition.exposeResources !== false) {
      for (const resource of other.catalog.resources.items) {
        const resourceToolName = `read_${resourceNameToToolName(resource.name)}`;
        for (const candidate of getToolNameCandidates(resourceToolName, other.name, otherPrefix, false)) {
          candidates.add(candidate);
        }
      }
    }
  }
  const currentPrefix = resolveToolPrefix(definition, definition.toolPrefix ?? "server");
  for (const candidate of getToolNameCandidates(toolName, serverName, currentPrefix, false)) {
    candidates.delete(candidate);
  }
  return candidates;
}

function isToolAllowedByAdapter(
  name: string,
  serverName: string,
  definition: ServerEntry,
  servers: McpManagementSnapshot["servers"],
  definitions: ReadonlyMap<string, ServerEntry>,
): boolean {
  const prefix: ToolPrefix = definition.toolPrefix ?? "server";
  return isToolAllowed(
    name,
    serverName,
    prefix,
    definition.includeTools,
    definition.excludeTools,
    currentCandidates(serverName, name, definition, servers, definitions),
  );
}

function visibleTools(
  serverName: string,
  server: McpManagementSnapshot["servers"][number],
  definition: ServerEntry,
  servers: McpManagementSnapshot["servers"],
  definitions: ReadonlyMap<string, ServerEntry>,
): McpManagementSnapshot["servers"][number]["catalog"]["tools"] {
  return server.catalog.tools.filter((tool) =>
    isUiToolVisibleToModel(tool.uiVisibility) &&
    tool.exposure !== "hidden" &&
    isToolAllowedByAdapter(tool.name, serverName, definition, servers, definitions),
  );
}

function visibleResources(
  serverName: string,
  server: McpManagementSnapshot["servers"][number],
  definition: ServerEntry,
  servers: McpManagementSnapshot["servers"],
  definitions: ReadonlyMap<string, ServerEntry>,
): readonly McpManagementResourceSnapshot[] {
  if (definition.exposeResources === false || !server.catalog.resources.available) return [];
  return server.catalog.resources.items.filter((resource) => {
    const toolName = `read_${resourceNameToToolName(resource.name)}`;
    return isToolAllowedByAdapter(toolName, serverName, definition, servers, definitions);
  });
}

function countResources(
  serverName: string,
  server: McpManagementSnapshot["servers"][number],
  definition: ServerEntry,
  servers: McpManagementSnapshot["servers"],
  definitions: ReadonlyMap<string, ServerEntry>,
): number {
  const items = visibleResources(serverName, server, definition, servers, definitions);
  const templates = definition.exposeResources === false || !server.catalog.resources.available
    ? []
    : server.catalog.resources.templates.filter((template) => {
        const toolName = `read_${resourceNameToToolName(template.name)}`;
        return isToolAllowedByAdapter(toolName, serverName, definition, servers, definitions);
      });
  return items.length + templates.length;
}

function panelResources(
  items: readonly McpManagementResourceSnapshot[],
  templates: readonly McpManagementResourceTemplateSnapshot[],
): NativePanelResource[] {
  return [
    ...items.map((item) => ({
      name: item.name,
      ...(item.title === undefined ? {} : { title: item.title }),
      ...(item.description === undefined ? {} : { description: item.description }),
      ...(item.mimeType === undefined ? {} : { mimeType: item.mimeType }),
      kind: item.kind,
    })),
    ...templates.map((template) => ({
      name: template.name,
      ...(template.title === undefined ? {} : { title: template.title }),
      ...(template.description === undefined ? {} : { description: template.description }),
      ...(template.mimeType === undefined ? {} : { mimeType: template.mimeType }),
      kind: "template" as const,
    })),
  ];
}

function toCachedTool(tool: McpManagementSnapshot["servers"][number]["catalog"]["tools"][number]): CachedTool {
  return {
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    ...(tool.uiVisibility === undefined ? {} : { uiVisibility: [...tool.uiVisibility] }),
  };
}

export function createNativeMcpPanelData(
  snapshot: McpManagementSnapshot,
  configuration: NativePanelConfiguration,
  runtimePolicies: ReadonlyMap<string, McpManagementExecutionPolicy> = new Map(),
): NativeMcpPanelData {
  const definitions = new Map<string, ServerEntry>();
  for (const server of snapshot.servers) {
    definitions.set(server.name, asEntry(server.name, server, configuration, runtimePolicies));
  }

  const config: McpConfig = {
    mcpServers: Object.fromEntries(definitions),
    ...(configuration.directTools === undefined && configuration.toolPrefix === undefined
      ? {}
      : {
          settings: {
            ...(configuration.directTools === undefined ? {} : { directTools: configuration.directTools }),
            ...(configuration.toolPrefix === undefined ? {} : { toolPrefix: configuration.toolPrefix }),
          },
        }),
  };
  const cache: MetadataCache = { version: 1, servers: {} };
  const details = new Map<string, NativePanelServerDetails>();
  const visibleToolCountByServer = new Map<string, number>();
  const visibleResourceCountByServer = new Map<string, number>();

  for (const server of snapshot.servers) {
    const definition = definitions.get(server.name);
    if (!definition) continue;
    const metadata = server.catalog.freshness === "missing" ? undefined : {
      configHash: computeServerHash(definition),
      tools: server.catalog.tools.map(toCachedTool),
      resources: [],
      cachedAt: Date.now(),
    };
    if (metadata) cache.servers[server.name] = metadata;

    const resources = server.catalog.resources.freshness === "missing"
      ? []
      : panelResources(
          visibleResources(server.name, server, definition, snapshot.servers, definitions),
          definition.exposeResources === false || !server.catalog.resources.available
            ? []
            : server.catalog.resources.templates.filter((template) => {
                const toolName = `read_${resourceNameToToolName(template.name)}`;
                return isToolAllowedByAdapter(toolName, server.name, definition, snapshot.servers, definitions);
              }),
        );
    const resourceCount = countResources(server.name, server, definition, snapshot.servers, definitions);
    const tools = visibleTools(server.name, server, definition, snapshot.servers, definitions);
    visibleToolCountByServer.set(server.name, tools.length);
    visibleResourceCountByServer.set(server.name, resourceCount);
    details.set(server.name, {
      scope: server.scope,
      catalogFreshness: server.catalog.freshness,
      resourceFreshness: server.catalog.resources.freshness,
      resourcesAvailable: server.catalog.resources.available,
      resources,
      toolExposures: new Map(server.catalog.tools.map((tool) => [tool.name, tool.exposure])),
    });
  }

  return {
    config,
    cache: Object.keys(cache.servers).length > 0 ? cache : null,
    details,
    visibleToolCountByServer,
    visibleResourceCountByServer,
  };
}
