import {
  createCachedToolSelectorCandidateIndex,
  createMetadataCatalogSnapshot,
  formatToolName,
  isToolAllowed,
  isUiToolVisibleToModel,
  parseDirectToolSelectors,
  resolveToolPrefix,
  resourceNameToToolName
} from "./chunk-NBQZZ3IQ.js";
import {
  isServerDisabled
} from "./chunk-Z3P2QPCB.js";

// src/tools/direct-tool-catalog.ts
import { Check, Errors } from "typebox/value";
var BUILTIN_NAMES = /* @__PURE__ */ new Set(["read", "bash", "edit", "write", "grep", "find", "ls", "mcp"]);
var DIRECT_TOOLS_ADVISORY_THRESHOLD = 75;
function prepareDirectToolArguments(inputSchema, args) {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) return args;
  const schema = inputSchema;
  if (schema.type !== "object") return args;
  const input = args && typeof args === "object" && !Array.isArray(args) ? args : null;
  const properties = schema.properties;
  let prepared;
  if (input && properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const [name, propertySchema] of Object.entries(properties)) {
      if (!Object.hasOwn(input, name) || typeof input[name] !== "string" || !propertySchema || typeof propertySchema !== "object" || Array.isArray(propertySchema)) continue;
      const expectedType = propertySchema.type;
      if (expectedType !== "object" && expectedType !== "array") continue;
      try {
        const parsed = JSON.parse(input[name]);
        const matches = expectedType === "array" ? Array.isArray(parsed) : parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
        if (matches) {
          prepared ??= { ...input };
          prepared[name] = parsed;
        }
      } catch {
      }
    }
  }
  const candidate = prepared ?? args;
  if (!Check(inputSchema, candidate)) {
    const errors = Errors(inputSchema, candidate);
    const issues = errors.slice(0, 8).map((error) => ({
      instancePath: error.instancePath || "/",
      keyword: error.keyword,
      message: error.message
    }));
    throw new TypeError(`MCP direct tool arguments do not match the advertised input schema: ${JSON.stringify({
      issues,
      total: errors.length,
      truncated: errors.length > issues.length
    })}`);
  }
  return candidate;
}
function resolveDirectTools(config, cache, prefix, envOverride, unavailableServers = /* @__PURE__ */ new Set(), reservedNames, snapshot) {
  const catalog = snapshot ?? createMetadataCatalogSnapshot(config, cache);
  const catalogCache = catalog.cache;
  const specs = [];
  if (!catalogCache) return specs;
  const seenNames = /* @__PURE__ */ new Set();
  let selectorCandidateIndex;
  let selectorCandidateIndexInitialized = false;
  const getSelectorCandidateIndex = () => {
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
    let toolFilter = false;
    if (envSelection) {
      if (envSelection.servers.has(serverName)) {
        toolFilter = true;
      } else if (envSelection.tools.has(serverName)) {
        toolFilter = [...envSelection.tools.get(serverName)];
      }
    } else {
      if (definition.directTools !== void 0) {
        toolFilter = definition.directTools;
      } else if (globalDirect) {
        toolFilter = globalDirect;
      }
    }
    if (!toolFilter) continue;
    const effectivePrefix = resolveToolPrefix(definition, prefix);
    const hasToolFilters = Array.isArray(definition.includeTools) && definition.includeTools.length > 0 || Array.isArray(definition.excludeTools) && definition.excludeTools.length > 0;
    const selectorIndex = hasToolFilters ? getSelectorCandidateIndex() : void 0;
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
        ...tool.inputSchema !== void 0 ? { inputSchema: tool.inputSchema } : {},
        ...tool.uiResourceUri !== void 0 ? { uiResourceUri: tool.uiResourceUri } : {},
        ...tool.uiStreamMode !== void 0 ? { uiStreamMode: tool.uiStreamMode } : {}
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
          resourceUri: resource.uri
        });
      }
    }
  }
  for (const spec of specs) reservedNames?.add(spec.prefixedName);
  const emittedSpecs = unavailableServers.size === 0 ? specs : specs.filter((spec) => !unavailableServers.has(spec.serverName));
  if (config.settings?.warnOnLargeDirectTools !== false && emittedSpecs.length >= DIRECT_TOOLS_ADVISORY_THRESHOLD) {
    console.warn(`MCP: ${emittedSpecs.length} direct tools resolved. Each direct tool adds prompt context; README guidance recommends targeted sets of 5-20 tools and using the proxy or an explicit string[] when 75+ direct tools would be registered. Set settings.warnOnLargeDirectTools to false to hide this advisory.`);
  }
  return emittedSpecs;
}
function buildProxyDescription(config) {
  let desc = `MCP gateway \u2014 server status, tool search/describe, auth, and single MCP tool calls. When one request needs several MCP calls with logic between them, use mcpScript. Non-MCP Pi tools should be called directly, not through mcp.
`;
  const serverNames = Object.keys(config.mcpServers).filter((serverName) => !isServerDisabled(config.mcpServers[serverName]));
  if (serverNames.length > 0) {
    desc += `
Servers: ${serverNames.join(", ")}
`;
  }
  const disabledServers = Object.entries(config.mcpServers).filter(([, definition]) => isServerDisabled(definition)).map(([serverName]) => serverName);
  if (disabledServers.length > 0) {
    desc += `
Disabled servers (enable with /mcp enable <server> and /reload): ${disabledServers.join(", ")}
`;
  }
  desc += `
Usage:
`;
  desc += `  mcp({ })                              \u2192 Show server status and tool counts
`;
  desc += `  mcp({ server: "name" })               \u2192 List tools from server
`;
  desc += `  mcp({ search: "query" })              \u2192 Search MCP tools by name/description
`;
  desc += `  mcp({ describe: "tool_name" })        \u2192 Show tool details and parameters
`;
  desc += `  mcp({ instructions: "name" })         \u2192 Show full server usage instructions
`;
  desc += `  mcp({ connect: "server-name" })       \u2192 Connect to a server and refresh metadata
`;
  desc += `  mcp({ tool: "name", args: { key: "value" } })         \u2192 Call a tool (object args; JSON string also accepted)
`;
  desc += `  mcp({ action: "ui-messages" })        \u2192 Retrieve accumulated messages from completed UI sessions
`;
  desc += `  mcp({ action: "auth-start", server: "name" })      \u2192 Start manual OAuth and get a browser URL
`;
  desc += `  mcp({ action: "auth-complete", server: "name", args: { redirectUrl: "..." } }) \u2192 Complete manual OAuth
`;
  desc += `
Mode: action > tool (call) > connect > describe > instructions > search > server (list) > nothing (status)`;
  return desc;
}

export {
  DIRECT_TOOLS_ADVISORY_THRESHOLD,
  prepareDirectToolArguments,
  resolveDirectTools,
  buildProxyDescription
};
