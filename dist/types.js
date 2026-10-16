// src/contracts/core.ts
function isServerDisabled(definition) {
  return definition?.disabled === true || definition?.enabled === false;
}
var MCP_TOOL_APPROVAL_REQUEST_EVENT = "pi-mcp-adapter:tool-approval-request";

// src/contracts/status.ts
var MCP_STATUS_EVENT = "pi-mcp-adapter/status/v1";
var MCP_STATUS_SNAPSHOT_VERSION = 1;

// src/contracts/ui.ts
function extractUiPromptText(params) {
  if (params.type === "prompt" || params.prompt) {
    const prompt = params.prompt ?? String(params.message ?? "");
    return prompt || void 0;
  }
  if (params.role === "user" && Array.isArray(params.content)) {
    const text = params.content.map((block) => block && typeof block === "object" && "text" in block ? String(block.text ?? "") : "").filter(Boolean).join("\n\n");
    return text || void 0;
  }
  return void 0;
}
function parseUiPromptHandoff(prompt) {
  const newlineIndex = prompt.indexOf("\n");
  if (newlineIndex <= 0) {
    return void 0;
  }
  const intent = prompt.slice(0, newlineIndex).trim();
  const payloadText = prompt.slice(newlineIndex + 1).trim();
  if (!intent || !payloadText) {
    return void 0;
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(intent)) {
    return void 0;
  }
  try {
    const parsed = JSON.parse(payloadText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return void 0;
    }
    return {
      intent,
      params: parsed,
      raw: prompt
    };
  } catch {
    return void 0;
  }
}
function createUiModelContextUpdate(params, maxChars = 12e3) {
  const payload = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== void 0)
  );
  if (Object.keys(payload).length === 0) return void 0;
  const serialized = JSON.stringify(payload);
  if (serialized.length <= maxChars) {
    return { payload, summary: serialized, truncated: false };
  }
  return {
    summary: `${serialized.slice(0, Math.max(0, maxChars - 1))}\u2026`,
    truncated: true
  };
}

// src/catalog/tool-names.ts
function sanitizeServerPrefix(serverName, preserveProviderValid = true) {
  const validCharacters = preserveProviderValid ? /^[A-Za-z0-9_-]$/ : /^[A-Za-z0-9]$/;
  return Array.from(
    serverName,
    (char) => validCharacters.test(char) ? char : `_${char.codePointAt(0).toString(16)}_`
  ).join("");
}
function getServerPrefix(serverName, mode) {
  if (mode === "none") return "";
  if (mode === "short") {
    let short = sanitizeServerPrefix(serverName.replace(/-?mcp$/i, ""));
    if (!short) short = "mcp";
    return short;
  }
  if (mode === "mcp") return `mcp__${sanitizeServerPrefix(serverName)}`;
  return sanitizeServerPrefix(serverName);
}
function formatToolName(toolName, serverName, prefix) {
  const p = getServerPrefix(serverName, prefix);
  const sanitized = toolName.replace(/\./g, "_");
  return p ? `${p}_${sanitized}` : sanitized;
}
function resolveToolPrefix(definition, globalPrefix) {
  return definition?.toolPrefix ?? globalPrefix ?? "server";
}
function resolveServerFromToolName(toolName, serverNames, prefix) {
  if (prefix === "none") return void 0;
  const candidates = [];
  for (const name of serverNames) {
    const p = getServerPrefix(name, prefix);
    if (p && toolName.startsWith(p + "_")) candidates.push({ name, prefix: p });
  }
  if (candidates.length === 0) return void 0;
  candidates.sort((a, b) => b.prefix.length - a.prefix.length);
  const best = candidates[0];
  if (candidates.some((c) => c.prefix === best.prefix && c.name !== best.name)) {
    return void 0;
  }
  return best?.name;
}
function sanitizePromptName(name) {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
  if (!cleaned) return "prompt";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}
function formatPromptCommandName(promptName, serverName, prefix) {
  const serverPart = getServerPrefix(serverName, prefix) || sanitizeServerPrefix(serverName) || "server";
  return `mcp__${serverPart}__${sanitizePromptName(promptName)}`;
}
function getLegacyServerPrefix(serverName, mode) {
  if (mode === "none") return "";
  if (mode === "short") return sanitizeServerPrefix(serverName.replace(/-?mcp$/i, ""), false) || "mcp";
  if (mode === "mcp") return `mcp__${sanitizeServerPrefix(serverName, false)}`;
  return sanitizeServerPrefix(serverName, false);
}
function formatLegacyToolName(toolName, serverName, prefix) {
  const serverPrefix = getLegacyServerPrefix(serverName, prefix);
  const sanitizedToolName = toolName.replace(/[.-]/g, "_");
  return serverPrefix ? `${serverPrefix}_${sanitizedToolName}` : sanitizedToolName;
}
function getToolNameCandidates(toolName, serverName, prefix, includeLegacy = true) {
  const candidates = /* @__PURE__ */ new Set([
    toolName,
    formatToolName(toolName, serverName, prefix),
    formatToolName(toolName, serverName, "server"),
    formatToolName(toolName, serverName, "short"),
    formatToolName(toolName, serverName, "mcp")
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

// src/catalog/tool-selectors.ts
function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
function createToolSelectorCandidateIndex(allCurrentCandidates, additionalCurrentCandidatesByToolName) {
  return {
    allCurrentCandidates,
    matchingCountByPattern: /* @__PURE__ */ new Map(),
    matcherByPattern: /* @__PURE__ */ new Map(),
    ...additionalCurrentCandidatesByToolName ? { additionalCurrentCandidatesByToolName } : {}
  };
}
function createLiveToolSelectorCandidateIndex(configuredServers, knownMetadata, prefix, includeMissingConfiguredCandidates = false) {
  const candidates = /* @__PURE__ */ new Set();
  const additionalCandidatesByToolName = /* @__PURE__ */ new Map();
  const evaluatedToolNames = /* @__PURE__ */ new Set();
  const knownServerNames = /* @__PURE__ */ new Set();
  const addCandidates = (target, originalName, serverName, serverPrefix) => {
    for (const candidate of getToolNameCandidates(originalName, serverName, serverPrefix, false)) target.add(candidate);
  };
  for (const [serverName, metadata] of knownMetadata) {
    const definition = configuredServers[serverName];
    if (!definition || isServerDisabled(definition)) continue;
    knownServerNames.add(serverName);
    const effectivePrefix = resolveToolPrefix(definition, prefix);
    for (const tool of metadata) {
      if (!tool?.originalName || tool.uiVisibility !== void 0 && !tool.uiVisibility.includes("model")) continue;
      evaluatedToolNames.add(tool.originalName);
      candidates.add(tool.name);
      addCandidates(candidates, tool.originalName, serverName, effectivePrefix);
    }
  }
  if (includeMissingConfiguredCandidates) {
    for (const [serverName, definition] of Object.entries(configuredServers)) {
      if (knownServerNames.has(serverName) || isServerDisabled(definition)) continue;
      const effectivePrefix = resolveToolPrefix(definition, prefix);
      for (const toolName of evaluatedToolNames) {
        let additionalCandidates = additionalCandidatesByToolName.get(toolName);
        if (!additionalCandidates) {
          additionalCandidates = /* @__PURE__ */ new Set();
          additionalCandidatesByToolName.set(toolName, additionalCandidates);
        }
        addCandidates(additionalCandidates, toolName, serverName, effectivePrefix);
        for (const candidate of getToolNameCandidates(toolName, serverName, effectivePrefix, false)) {
          additionalCandidates.add(candidate.replace(/-/g, "_"));
        }
      }
    }
  }
  return createToolSelectorCandidateIndex(candidates, additionalCandidatesByToolName);
}
function matchesToolPattern(candidates, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    if (!pattern.includes("*") && !pattern.includes("?") && candidates.has(pattern)) {
      return true;
    }
    if ((pattern.includes("*") || pattern.includes("?")) && [...candidates].some((candidate) => globToRegExp(pattern).test(candidate))) {
      return true;
    }
  }
  return false;
}
function indexHasOtherCurrentMatch(index, toolName, currentCandidates, pattern) {
  const additionalCandidates = index.additionalCurrentCandidatesByToolName?.get(toolName);
  const hasCandidate = (candidate) => index.allCurrentCandidates.has(candidate) || additionalCandidates?.has(candidate) === true;
  const isGlob = pattern.includes("*") || pattern.includes("?");
  if (!isGlob) {
    return hasCandidate(pattern) && !currentCandidates.has(pattern);
  }
  let matcher = index.matcherByPattern.get(pattern);
  if (!matcher) {
    matcher = globToRegExp(pattern);
    index.matcherByPattern.set(pattern, matcher);
  }
  let matchingCount = index.matchingCountByPattern.get(pattern);
  if (matchingCount === void 0) {
    matchingCount = 0;
    for (const candidate of index.allCurrentCandidates) {
      if (matcher.test(candidate)) matchingCount++;
    }
    index.matchingCountByPattern.set(pattern, matchingCount);
  }
  let totalMatchingCount = matchingCount;
  if (additionalCandidates) {
    for (const candidate of additionalCandidates) {
      if (!index.allCurrentCandidates.has(candidate) && matcher.test(candidate)) totalMatchingCount++;
    }
  }
  if (totalMatchingCount === 0) return false;
  let currentMatchingCount = 0;
  for (const candidate of currentCandidates) {
    if (hasCandidate(candidate) && matcher.test(candidate)) currentMatchingCount++;
  }
  return totalMatchingCount > currentMatchingCount;
}
function matchesToolSelector(toolName, serverName, prefix, patterns, otherCurrentCandidates) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const currentCandidates = getToolNameCandidates(toolName, serverName, prefix, false);
  if (matchesToolPattern(currentCandidates, patterns)) return true;
  if (!otherCurrentCandidates) return matchesToolPattern(getToolNameCandidates(toolName, serverName, prefix), patterns);
  const legacyCandidates = getToolNameCandidates(toolName, serverName, prefix);
  for (const candidate of currentCandidates) legacyCandidates.delete(candidate);
  return patterns.some((pattern) => {
    if (typeof pattern !== "string" || !matchesToolPattern(legacyCandidates, [pattern])) return false;
    const hasCollision = otherCurrentCandidates instanceof Set ? matchesToolPattern(otherCurrentCandidates, [pattern]) : indexHasOtherCurrentMatch(otherCurrentCandidates, toolName, currentCandidates, pattern);
    return !hasCollision;
  });
}
function isToolIncluded(toolName, serverName, prefix, includeTools, otherCurrentCandidates) {
  if (!Array.isArray(includeTools) || includeTools.length === 0) return true;
  return matchesToolSelector(toolName, serverName, prefix, includeTools, otherCurrentCandidates);
}
function isToolExcluded(toolName, serverName, prefix, excludeTools, otherCurrentCandidates) {
  return matchesToolSelector(toolName, serverName, prefix, excludeTools, otherCurrentCandidates);
}
function isToolAllowed(toolName, serverName, prefix, includeTools, excludeTools, otherCurrentCandidates) {
  return isToolIncluded(toolName, serverName, prefix, includeTools, otherCurrentCandidates) && !isToolExcluded(toolName, serverName, prefix, excludeTools, otherCurrentCandidates);
}

// src/ui/stream-types.ts
import { z } from "zod";
var UI_STREAM_HOST_CONTEXT_KEY = "pi-mcp-adapter/stream";
var UI_STREAM_REQUEST_META_KEY = "pi-mcp-adapter/stream-token";
var UI_STREAM_RESULT_PATCH_METHOD = "notifications/pi-mcp-adapter/ui-result-patch";
var SERVER_STREAM_RESULT_PATCH_METHOD = "notifications/pi-mcp-adapter/result-patch";
var UI_STREAM_STRUCTURED_CONTENT_KEY = "pi-mcp-adapter/stream";
var uiStreamModeSchema = z.enum(["eager", "stream-first"]);
var visualizationStreamPhaseSchema = z.enum(["shell", "narrative", "structure", "detail", "settled"]);
var visualizationStreamFrameTypeSchema = z.enum(["patch", "checkpoint", "final"]);
var visualizationStreamStatusSchema = z.enum(["ok", "error"]);
var looseRecordSchema = z.record(z.string(), z.unknown());
var looseArraySchema = z.array(z.unknown());
var uiStreamHostContextSchema = z.object({
  mode: uiStreamModeSchema,
  streamId: z.string().min(1),
  intermediateResultPatches: z.boolean(),
  partialInput: z.boolean()
});
var visualizationStreamEnvelopeSchema = z.object({
  streamId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  frameType: visualizationStreamFrameTypeSchema,
  phase: visualizationStreamPhaseSchema,
  status: visualizationStreamStatusSchema,
  message: z.string().optional(),
  spec: looseRecordSchema.optional(),
  checkpoint: looseRecordSchema.optional()
});
var uiStreamCallToolResultSchema = z.object({
  content: looseArraySchema.optional(),
  structuredContent: looseRecordSchema.optional(),
  isError: z.boolean().optional(),
  _meta: looseRecordSchema.optional()
}).passthrough();
var uiStreamResultPatchNotificationSchema = z.object({
  method: z.literal(UI_STREAM_RESULT_PATCH_METHOD),
  params: uiStreamCallToolResultSchema
});
var serverStreamResultPatchNotificationSchema = z.object({
  method: z.literal(SERVER_STREAM_RESULT_PATCH_METHOD),
  params: z.object({
    streamToken: z.string().min(1),
    result: uiStreamCallToolResultSchema
  })
});
function getUiStreamHostContext(hostContext) {
  const candidate = hostContext?.[UI_STREAM_HOST_CONTEXT_KEY];
  const parsed = uiStreamHostContextSchema.safeParse(candidate);
  return parsed.success ? parsed.data : void 0;
}
function getVisualizationStreamEnvelope(structuredContent) {
  if (!structuredContent || typeof structuredContent !== "object" || Array.isArray(structuredContent)) {
    return void 0;
  }
  const candidate = structuredContent[UI_STREAM_STRUCTURED_CONTENT_KEY];
  const parsed = visualizationStreamEnvelopeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : void 0;
}
export {
  MCP_STATUS_EVENT,
  MCP_STATUS_SNAPSHOT_VERSION,
  MCP_TOOL_APPROVAL_REQUEST_EVENT,
  SERVER_STREAM_RESULT_PATCH_METHOD,
  UI_STREAM_HOST_CONTEXT_KEY,
  UI_STREAM_REQUEST_META_KEY,
  UI_STREAM_RESULT_PATCH_METHOD,
  UI_STREAM_STRUCTURED_CONTENT_KEY,
  createLiveToolSelectorCandidateIndex,
  createToolSelectorCandidateIndex,
  createUiModelContextUpdate,
  extractUiPromptText,
  formatPromptCommandName,
  formatToolName,
  getServerPrefix,
  getToolNameCandidates,
  getUiStreamHostContext,
  getVisualizationStreamEnvelope,
  isServerDisabled,
  isToolAllowed,
  isToolExcluded,
  isToolIncluded,
  matchesToolPattern,
  parseUiPromptHandoff,
  resolveServerFromToolName,
  resolveToolPrefix,
  sanitizePromptName,
  serverStreamResultPatchNotificationSchema,
  uiStreamCallToolResultSchema,
  uiStreamHostContextSchema,
  uiStreamModeSchema,
  uiStreamResultPatchNotificationSchema,
  visualizationStreamEnvelopeSchema,
  visualizationStreamFrameTypeSchema,
  visualizationStreamPhaseSchema,
  visualizationStreamStatusSchema
};
