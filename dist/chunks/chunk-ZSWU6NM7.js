import {
  ensureToolCallApproved,
  guardMcpOutput,
  guardedMcpDetails,
  isToolCallApprovalRequired,
  maybeStartUiSession,
  resolveMcpOutputGuardOptions,
  summarizeUiSessionResult
} from "./chunk-AQCTLUTP.js";
import {
  SessionRecoveryAuthRequiredError,
  buildToolMetadata,
  clearFailure,
  findToolByName,
  formatSchema,
  getToolNames,
  lazyConnect,
  markKeepAliveAfterConnect,
  notifyToolMetadataUpdated,
  recordFailure,
  updateMetadataCache,
  updateServerMetadata,
  updateStatusBar,
  withSessionRecovery
} from "./chunk-ZKXUDEBO.js";
import {
  getFailureAgeSeconds,
  isServerInActiveFailureBackoff
} from "./chunk-KLTV33HH.js";
import {
  abortable,
  authenticate,
  supportsOAuth,
  throwIfAborted
} from "./chunk-LETXAJ4X.js";
import {
  combineAbortSignals,
  isAbortError
} from "./chunk-YFB6HSH2.js";
import {
  resolveMcpResultContent,
  transformMcpContent,
  transformMcpResourceContents
} from "./chunk-QEVIMIQ3.js";
import {
  getServerPrefix,
  getToolNameCandidates,
  matchesToolPattern,
  reconstructPromptMetadata,
  resolveToolPrefix
} from "./chunk-PXMBC3S7.js";
import {
  formatAuthRequiredMessage,
  formatMcpStatus,
  normalizeToolArguments,
  resolveServerUrl,
  truncateAtWord
} from "./chunk-IOFHQSPP.js";
import {
  isServerDisabled
} from "./chunk-LVZ7J2NB.js";

// src/tools/proxy/call.ts
import { UrlElicitationRequiredError } from "@modelcontextprotocol/client";

// src/tools/search-ranking.ts
var MIN_STEM_LENGTH = 4;
var FIELD_WEIGHTS = {
  name: 12,
  originalName: 10,
  server: 8,
  description: 5,
  keywords: 5
};
var searchCache = /* @__PURE__ */ new WeakMap();
function resolveSearchKeywords(definition, toolOriginalName, serverName, globalPrefix) {
  const map = definition?.searchKeywords;
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  const candidates = getToolNameCandidates(toolOriginalName, serverName, resolveToolPrefix(definition, globalPrefix));
  const keywords = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [pattern, values] of Object.entries(map)) {
    if (!Array.isArray(values)) continue;
    if (!matchesToolPattern(candidates, [pattern])) continue;
    for (const value of values) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      keywords.push(trimmed);
    }
  }
  return keywords;
}
function normalizeSearchText(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_./:-]+/g, " ").toLowerCase();
}
function tokenize(value) {
  return normalizeSearchText(value).split(/[^a-z0-9]+/).filter(Boolean);
}
function prepareToolSearch(tool, server, keywords) {
  const fields = {
    name: normalizeSearchText(tool.name),
    originalName: normalizeSearchText(tool.originalName),
    server: normalizeSearchText(server),
    description: normalizeSearchText(tool.description)
  };
  const preparedFields = Object.entries(fields).map(([field, value]) => [field, value, tokenize(value)]);
  const keywordPhrases = keywords?.map((keyword) => normalizeSearchText(keyword).trim()).filter(Boolean) ?? [];
  return {
    tool,
    fields: preparedFields,
    nameTokens: preparedFields[0][2],
    keywordPhrases,
    keywordTokens: keywordPhrases.flatMap(tokenize)
  };
}
function scorePreparedToolMatch(prepared, normalizedQuery, queryTokens) {
  let score = 0;
  let phraseMatched = false;
  let wholeFieldExact = false;
  const matchedTokens = /* @__PURE__ */ new Set();
  for (const [field, value, fieldTokens] of prepared.fields) {
    const weight = FIELD_WEIGHTS[field];
    if (value === normalizedQuery) {
      score += weight * 14;
      phraseMatched = true;
      wholeFieldExact = true;
    } else if (value.startsWith(normalizedQuery)) {
      score += weight * 9;
      phraseMatched = true;
    } else if (value.includes(normalizedQuery)) {
      score += weight * 6;
      phraseMatched = true;
    }
    for (const token of queryTokens) {
      if (fieldTokens.includes(token)) {
        score += weight * 4;
        matchedTokens.add(token);
      } else if (fieldTokens.some((fieldToken) => fieldToken.startsWith(token) || fieldToken.length >= MIN_STEM_LENGTH && token.startsWith(fieldToken))) {
        score += weight * 2;
        matchedTokens.add(token);
      } else if (value.includes(token)) {
        score += weight;
        matchedTokens.add(token);
      }
    }
  }
  if (prepared.keywordPhrases.length > 0) {
    const weight = FIELD_WEIGHTS.keywords;
    let phraseScore = 0;
    for (const phrase of prepared.keywordPhrases) {
      if (phrase === normalizedQuery) {
        phraseScore = Math.max(phraseScore, weight * 14);
        phraseMatched = true;
        wholeFieldExact = true;
      } else if (phrase.startsWith(normalizedQuery)) {
        phraseScore = Math.max(phraseScore, weight * 9);
        phraseMatched = true;
      } else if (phrase.includes(normalizedQuery)) {
        phraseScore = Math.max(phraseScore, weight * 6);
        phraseMatched = true;
      }
    }
    score += phraseScore;
    for (const token of queryTokens) {
      if (prepared.keywordTokens.includes(token)) {
        score += weight * 4;
        matchedTokens.add(token);
      } else if (prepared.keywordTokens.some((keywordToken) => keywordToken.startsWith(token) || keywordToken.length >= MIN_STEM_LENGTH && token.startsWith(keywordToken))) {
        score += weight * 2;
        matchedTokens.add(token);
      } else if (prepared.keywordPhrases.some((phrase) => phrase.includes(token))) {
        score += weight;
        matchedTokens.add(token);
      }
    }
  }
  const coverage = matchedTokens.size / queryTokens.length;
  if (!phraseMatched && (queryTokens.length <= 2 ? coverage !== 1 : coverage < 0.6)) return null;
  score += coverage === 1 ? 25 : Math.round(coverage * 10);
  const firstQueryToken = queryTokens[0];
  if (firstQueryToken !== void 0 && prepared.nameTokens.includes(firstQueryToken)) score += 8;
  if (wholeFieldExact) score += 20;
  return score;
}
function getPreparedTools(state, serverName, metadata, definition, globalPrefix, includeKeywords) {
  let stateCache = searchCache.get(state);
  if (!stateCache) {
    stateCache = /* @__PURE__ */ new Map();
    searchCache.set(state, stateCache);
  }
  const toolPrefix = resolveToolPrefix(definition, globalPrefix);
  let cached = stateCache.get(serverName);
  if (cached?.metadata !== metadata || cached.searchKeywords !== definition?.searchKeywords || cached.toolPrefix !== toolPrefix) {
    cached = { metadata, searchKeywords: definition?.searchKeywords, toolPrefix };
    stateCache.set(serverName, cached);
  }
  const cacheKey = includeKeywords ? "withKeywords" : "withoutKeywords";
  let prepared = cached[cacheKey];
  if (!prepared) {
    prepared = metadata.map((tool) => prepareToolSearch(
      tool,
      serverName,
      includeKeywords && definition?.searchKeywords !== void 0 ? resolveSearchKeywords(definition, tool.originalName, serverName, globalPrefix) : void 0
    ));
    cached[cacheKey] = prepared;
  }
  return prepared;
}
function rankToolMatches(state, query, server, includeKeywords = true) {
  const matches = [];
  const normalizedQuery = normalizeSearchText(query).trim();
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return matches;
  const globalPrefix = state.config.settings?.toolPrefix ?? "server";
  for (const [serverName, metadata] of state.toolMetadata.entries()) {
    if (server && serverName !== server) continue;
    const definition = state.config.mcpServers[serverName];
    if (isServerDisabled(definition)) continue;
    if (isServerInActiveFailureBackoff(state, serverName)) continue;
    for (const prepared of getPreparedTools(state, serverName, metadata, definition, globalPrefix, includeKeywords)) {
      const score = scorePreparedToolMatch(prepared, normalizedQuery, queryTokens);
      if (score !== null) matches.push({ server: serverName, tool: prepared.tool, score });
    }
  }
  return matches.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
}
function paginate(items, offset, limit) {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 1;
  const total = items.length;
  const page = items.slice(safeOffset, safeOffset + safeLimit);
  const nextOffset = safeOffset + page.length;
  return {
    items: page,
    total,
    hasMore: nextOffset < total,
    nextOffset: nextOffset < total ? nextOffset : null
  };
}
function rankSuggestions(state, name, limit) {
  const stripped = Object.keys(state.config.mcpServers).flatMap((server) => ["server", "short", "mcp"].map((prefix) => getServerPrefix(server, prefix))).filter((candidate) => Boolean(candidate) && name.startsWith(`${candidate}_`)).sort((a, b) => b.length - a.length).map((candidate) => name.slice(candidate.length + 1));
  const query = stripped[0] ?? name;
  return rankToolMatches(state, query, void 0, false).slice(0, limit).map((match) => match.tool.name);
}

// src/tools/proxy/catalog.ts
import { createRequire } from "node:module";

// src/tools/ts-shape.ts
var UNSUPPORTED_KEYWORDS = ["if", "then", "else", "allOf", "not", "patternProperties", "additionalProperties"];
function renderTsShape(inputSchema) {
  try {
    if (!isSchema(inputSchema)) return null;
    const definitions = /* @__PURE__ */ new Map();
    for (const key of ["$defs", "definitions"]) {
      const rawDefinitions = inputSchema[key];
      if (rawDefinitions === void 0) continue;
      if (!isSchema(rawDefinitions)) return null;
      for (const [name, definition] of Object.entries(rawDefinitions)) {
        if (!isSchema(definition)) return null;
        definitions.set(`${key}/${decodePointerToken(name)}`, definition);
      }
    }
    const aliases = /* @__PURE__ */ new Map();
    const usedAliases = /* @__PURE__ */ new Set();
    let aliasIndex = 0;
    const aliasFor = (definitionKey) => {
      let alias = aliases.get(definitionKey);
      if (alias) return alias;
      const name = definitionKey.slice(definitionKey.indexOf("/") + 1);
      alias = /^[A-Za-z_$][\w$]*$/.test(name) && !usedAliases.has(name) ? name : `Definition${++aliasIndex}`;
      while (usedAliases.has(alias)) alias = `Definition${++aliasIndex}`;
      aliases.set(definitionKey, alias);
      usedAliases.add(alias);
      return alias;
    };
    const render = (schema) => {
      if (!isSchema(schema) || hasUnsupportedKeyword(schema)) return null;
      if ("$ref" in schema) {
        if (typeof schema.$ref !== "string") return null;
        const match = schema.$ref.match(/^#\/(\$defs|definitions)\/([^/]+)$/);
        if (!match) return null;
        const definitionGroup = match[1];
        const definitionName = match[2];
        if (definitionGroup === void 0 || definitionName === void 0) return null;
        const definitionKey = `${definitionGroup}/${decodePointerToken(definitionName)}`;
        if (!definitions.has(definitionKey)) return null;
        return aliasFor(definitionKey);
      }
      if (Array.isArray(schema.enum)) {
        const values = schema.enum.map(renderLiteral);
        return values.every((value) => value !== null) ? values.join(" | ") : null;
      }
      if (Object.hasOwn(schema, "const")) return renderLiteral(schema.const);
      if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
        const variants = schema.anyOf ?? schema.oneOf;
        if (variants.length === 0) return null;
        const rendered = variants.map(render);
        return rendered.every((value) => value !== null) ? rendered.join(" | ") : null;
      }
      if (schema.type === "object" || schema.properties !== void 0) {
        if (schema.properties === void 0) return "{}";
        if (!isSchema(schema.properties)) return null;
        const required = new Set(Array.isArray(schema.required) ? schema.required.filter((name) => typeof name === "string") : []);
        const properties = [];
        for (const [name, property] of Object.entries(schema.properties)) {
          const rendered = render(property);
          if (rendered === null) return null;
          properties.push(`${formatPropertyName(name)}${required.has(name) ? "" : "?"}: ${rendered};`);
        }
        return properties.length === 0 ? "{}" : `{ ${properties.join(" ")} }`;
      }
      if (schema.type === "array") {
        if (schema.items === void 0) return "unknown[]";
        const item = render(schema.items);
        return item === null ? null : `${needsParentheses(item) ? `(${item})` : item}[]`;
      }
      if (Array.isArray(schema.type)) {
        const types = schema.type.map(renderType);
        return types.every((type) => type !== null) ? types.join(" | ") : null;
      }
      if (typeof schema.type === "string") return renderType(schema.type);
      return "unknown";
    };
    const root = render(inputSchema);
    if (root === null) return null;
    const definitionsText = [];
    for (const [key, alias] of aliases) {
      const definition = definitions.get(key);
      if (!definition) return null;
      const rendered = render(definition);
      if (rendered === null) return null;
      definitionsText.push(`type ${alias} = ${rendered};`);
    }
    return definitionsText.length > 0 ? `${definitionsText.join("\n")}

${root}` : root;
  } catch {
    return null;
  }
}
function isSchema(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasUnsupportedKeyword(schema) {
  return UNSUPPORTED_KEYWORDS.some((keyword) => {
    if (!Object.hasOwn(schema, keyword)) return false;
    return keyword !== "additionalProperties" || schema.additionalProperties !== false;
  });
}
function decodePointerToken(token) {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}
function renderType(type) {
  switch (type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "object":
      return "{}";
    case "array":
      return "unknown[]";
    default:
      return null;
  }
}
function renderLiteral(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}
function formatPropertyName(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}
function needsParentheses(type) {
  return type.includes(" | ");
}

// src/tools/proxy/shared.ts
function getToolMatches(metadata, toolName, exact) {
  if (!metadata) return [];
  if (exact) return metadata.filter((tool) => tool.name === toolName);
  const normalizedName = toolName.replace(/-/g, "_");
  return metadata.filter((tool) => tool.name.replace(/-/g, "_") === normalizedName);
}
function getEnabledToolMatches(state, toolName, exact) {
  const matches = [];
  for (const [server, metadata] of state.toolMetadata) {
    if (isServerDisabled(state.config.mcpServers[server])) continue;
    for (const tool of getToolMatches(metadata, toolName, exact)) matches.push({ server, tool });
  }
  return matches;
}
function serverBackoffResult(state, mode, serverName) {
  const failedAgo = getFailureAgeSeconds(state, serverName) ?? 0;
  const message = `Server "${serverName}" not available (last failed ${failedAgo}s ago)`;
  return {
    content: [{ type: "text", text: message }],
    details: { mode, error: "server_backoff", server: serverName }
  };
}
function getSingleToolMatch(metadata, toolName) {
  const exactMatches = getToolMatches(metadata, toolName, true);
  const matches = exactMatches.length > 0 ? exactMatches : getToolMatches(metadata, toolName, false);
  return matches.length > 1 ? "ambiguous" : matches[0];
}
function ambiguousToolResult(mode, toolName) {
  const message = `Tool "${toolName}" matches multiple servers. Specify a server.`;
  return {
    content: [{ type: "text", text: message }],
    details: { mode, error: "ambiguous_tool", requestedTool: toolName, message }
  };
}
function disabledResult(mode, serverName) {
  const message = `Server "${serverName}" is disabled. Run /mcp enable ${serverName} and /reload to enable it.`;
  return {
    content: [{ type: "text", text: message }],
    details: { mode, error: "server_disabled", server: serverName, message }
  };
}
function getAuthRequiredMessage(state, serverName, defaultMessage = `Server "${serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`) {
  return formatAuthRequiredMessage(state.config, serverName, defaultMessage);
}
function getAuthFailedMessage(state, serverName, message) {
  const customGuidance = state.config.settings?.authRequiredMessage;
  if (customGuidance) {
    return `OAuth authentication failed for "${serverName}": ${message}. ${getAuthRequiredMessage(state, serverName)}`;
  }
  return `OAuth authentication failed for "${serverName}": ${message}. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`;
}
function getRedirectPort(authorizationUrl) {
  try {
    const redirectUri = new URL(authorizationUrl).searchParams.get("redirect_uri");
    if (!redirectUri) return void 0;
    const port = Number.parseInt(new URL(redirectUri).port, 10);
    return Number.isInteger(port) ? port : void 0;
  } catch {
    return void 0;
  }
}
function formatManualAuthInstructions(serverName, authorizationUrl) {
  const port = getRedirectPort(authorizationUrl);
  const portNote = port ? `
The redirect URL will use local port ${port}. On a remote server it is expected for that localhost page to fail locally; copy the address bar URL anyway.` : "";
  return [
    `MCP OAuth required for "${serverName}".`,
    "",
    "Open this URL in your local browser:",
    "",
    authorizationUrl,
    "",
    "After approving, copy the full redirected localhost URL from your browser address bar and send it back with:",
    `mcp({ action: "auth-complete", server: "${serverName}", args: { redirectUrl: "PASTE_REDIRECT_URL_HERE" } })`,
    "",
    'You can also pass just the `code` query parameter as `args: { code: "PASTE_CODE_HERE" }`. JSON-string args remain supported.',
    portNote.trimEnd()
  ].filter(Boolean).join("\n");
}
async function attemptAutoAuth(state, serverName, signal) {
  if (state.config.settings?.autoAuth !== true) {
    return { status: "skipped" };
  }
  const definition = state.config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition) || !supportsOAuth(definition)) {
    return { status: "skipped" };
  }
  let serverUrl;
  try {
    serverUrl = resolveServerUrl(definition);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", message: getAuthFailedMessage(state, serverName, message) };
  }
  if (!serverUrl) {
    return { status: "skipped" };
  }
  const grantType = definition.oauth ? definition.oauth.grantType ?? "authorization_code" : "authorization_code";
  if (!state.ui && grantType !== "client_credentials") {
    return {
      status: "failed",
      message: getAuthRequiredMessage(
        state,
        serverName,
        `Server "${serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`
      )
    };
  }
  try {
    if (state.authStorageOptions) {
      await authenticate(
        serverName,
        serverUrl,
        definition,
        signal ? { authStorageOptions: state.authStorageOptions, signal, runtime: state.oauthRuntime } : { authStorageOptions: state.authStorageOptions, runtime: state.oauthRuntime }
      );
    } else {
      if (signal) {
        await authenticate(serverName, serverUrl, definition, { signal, runtime: state.oauthRuntime });
      } else {
        await authenticate(serverName, serverUrl, definition, { runtime: state.oauthRuntime });
      }
    }
    return { status: "success" };
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: getAuthFailedMessage(state, serverName, message)
    };
  }
}

// src/tools/proxy/catalog.ts
var require2 = createRequire(import.meta.url);
var MAX_REGEX_SEARCH_QUERY_LENGTH = 256;
var INSTRUCTIONS_PREVIEW_LENGTH = 300;
var REGEX_SAFETY_CHECK_PARAMS = {
  attackTimeout: 50,
  incubationTimeout: 50,
  timeout: 250
};
function executeDescribe(state, toolName) {
  const exactMatches = getEnabledToolMatches(state, toolName, true).filter((match) => !isServerInActiveFailureBackoff(state, match.server));
  if (exactMatches.length > 1) return ambiguousToolResult("describe", toolName);
  if (exactMatches.length === 0 && getEnabledToolMatches(state, toolName, false).filter((match) => !isServerInActiveFailureBackoff(state, match.server)).length > 1) {
    return ambiguousToolResult("describe", toolName);
  }
  let serverName = exactMatches[0]?.server;
  let toolMeta = exactMatches[0]?.tool;
  let disabledMatch;
  let failedMatch;
  if (!toolMeta) {
    for (const [server, metadata] of state.toolMetadata.entries()) {
      const found = findToolByName(metadata, toolName);
      if (!found) continue;
      if (isServerDisabled(state.config.mcpServers[server])) {
        disabledMatch ??= server;
        continue;
      }
      if (isServerInActiveFailureBackoff(state, server)) {
        failedMatch ??= server;
        continue;
      }
      serverName = server;
      toolMeta = found;
      break;
    }
  }
  if (!serverName || !toolMeta) {
    if (disabledMatch) return disabledResult("describe", disabledMatch);
    if (failedMatch) return serverBackoffResult(state, "describe", failedMatch);
    const suggestions = rankSuggestions(state, toolName, 5);
    const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}` : "";
    return {
      content: [{ type: "text", text: `Tool "${toolName}" not found. Use mcp({ search: "..." }) to search.${suggestionText}` }],
      details: { mode: "describe", error: "tool_not_found", requestedTool: toolName, suggestions }
    };
  }
  const approvalMarker = isToolCallApprovalRequired(state.config, serverName, toolMeta, state.toolMetadata) ? " (requires approval)" : "";
  let text = `${toolMeta.name}${approvalMarker}
`;
  text += `Server: ${serverName}
`;
  if (toolMeta.resourceUri) {
    text += `Type: Resource (reads from ${toolMeta.resourceUri})
`;
  }
  text += `
${toolMeta.description || "(no description)"}
`;
  if (toolMeta.inputSchema && !toolMeta.resourceUri) {
    const shape = renderTsShape(toolMeta.inputSchema);
    text += shape === null ? `
Parameters:
${formatSchema(toolMeta.inputSchema)}` : `
Shape:
${shape}`;
  } else if (toolMeta.resourceUri) {
    text += `
No parameters required (resource tool).`;
  } else {
    text += `
No parameters defined.`;
  }
  return {
    content: [{ type: "text", text: text.trim() }],
    details: { mode: "describe", tool: toolMeta, server: serverName }
  };
}
function executeSearch(state, query, regex, server, includeSchemas, limit = 12, offset = 0) {
  const showSchemas = includeSchemas !== false;
  if (server && isServerDisabled(state.config.mcpServers[server])) return disabledResult("search", server);
  if (server && isServerInActiveFailureBackoff(state, server)) return serverBackoffResult(state, "search", server);
  let matches;
  if (regex) {
    let pattern;
    try {
      if (query.length > MAX_REGEX_SEARCH_QUERY_LENGTH) {
        return {
          content: [{ type: "text", text: `Regex query is too long; maximum length is ${MAX_REGEX_SEARCH_QUERY_LENGTH} characters.` }],
          details: { mode: "search", error: "query_too_long", query, maxLength: MAX_REGEX_SEARCH_QUERY_LENGTH }
        };
      }
      pattern = new RegExp(query, "i");
      let safety;
      try {
        const { checkSync } = require2("recheck");
        safety = checkSync(query, "i", REGEX_SAFETY_CHECK_PARAMS);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: "Regex query rejected because safety analysis failed." }],
          details: { mode: "search", error: "unsafe_pattern", query, reason }
        };
      }
      if (safety.status !== "safe") {
        return {
          content: [{ type: "text", text: `Regex query rejected as unsafe (${safety.status}).` }],
          details: { mode: "search", error: "unsafe_pattern", query, safetyStatus: safety.status }
        };
      }
    } catch {
      return {
        content: [{ type: "text", text: `Invalid regex: ${query}` }],
        details: { mode: "search", error: "invalid_pattern", query }
      };
    }
    matches = [];
    const globalPrefix = state.config.settings?.toolPrefix ?? "server";
    for (const [serverName, metadata] of state.toolMetadata.entries()) {
      const definition = state.config.mcpServers[serverName];
      if (isServerDisabled(definition)) continue;
      if (isServerInActiveFailureBackoff(state, serverName)) continue;
      if (server && serverName !== server) continue;
      for (const tool of metadata) {
        const matched = pattern.test(tool.name) || pattern.test(tool.description) || resolveSearchKeywords(definition, tool.originalName, serverName, globalPrefix).some((keyword) => pattern.test(keyword));
        if (matched) matches.push({ server: serverName, tool, score: 0 });
      }
    }
  } else if (query.trim().length === 0) {
    if (!server) {
      return {
        content: [{ type: "text", text: "Search query cannot be empty" }],
        details: { mode: "search", error: "empty_query" }
      };
    }
    matches = (state.toolMetadata.get(server) ?? []).map((tool) => ({ server, tool, score: 0 })).sort((a, b) => a.tool.name.localeCompare(b.tool.name));
  } else {
    matches = rankToolMatches(state, query, server);
  }
  const page = paginate(matches, offset, limit);
  if (page.total === 0) {
    const connectingServers = server ? state.config.mcpServers[server] && state.manager.isConnecting(server) ? [server] : [] : Object.keys(state.config.mcpServers).filter((name) => !isServerDisabled(state.config.mcpServers[name]) && state.manager.isConnecting(name)).sort((a, b) => a.localeCompare(b));
    const msg = server ? `No tools matching "${query}" in "${server}"` : `No tools matching "${query}"`;
    const connectingMessage = connectingServers.length === 1 ? ` Server "${connectingServers[0]}" is still connecting; retry in a moment.` : connectingServers.length > 1 ? ` Servers ${connectingServers.map((name) => `"${name}"`).join(", ")} are still connecting; retry in a moment.` : "";
    return {
      content: [{ type: "text", text: `${msg}${connectingMessage}` }],
      details: {
        mode: "search",
        matches: [],
        count: 0,
        hasMore: false,
        nextOffset: null,
        query,
        ...connectingServers.length > 0 ? { connectingServers } : {}
      }
    };
  }
  let text = `Found ${page.total} tool${page.total === 1 ? "" : "s"} matching "${query}":

`;
  for (const match of page.items) {
    const approvalMarker = isToolCallApprovalRequired(state.config, match.server, match.tool, state.toolMetadata) ? " (requires approval)" : "";
    if (showSchemas) {
      text += `${match.tool.name}${approvalMarker}
`;
      text += `  ${match.tool.description || "(no description)"}
`;
      if (match.tool.inputSchema && !match.tool.resourceUri) {
        const shape = renderTsShape(match.tool.inputSchema);
        text += shape === null ? `
  Parameters:
${formatSchema(match.tool.inputSchema, "    ")}
` : `
  Shape:
${shape.split("\n").map((line) => `    ${line}`).join("\n")}
`;
      } else if (match.tool.resourceUri) {
        text += "  No parameters (resource tool).\n";
      }
      text += "\n";
    } else {
      text += `- ${match.tool.name}${approvalMarker}`;
      if (match.tool.description) text += ` - ${truncateAtWord(match.tool.description, 50)}`;
      text += "\n";
    }
  }
  if (page.hasMore) text += `
${page.items.length} of ${page.total} \u2014 offset: ${page.nextOffset} for more
`;
  return {
    content: [{ type: "text", text: text.trim() }],
    details: {
      mode: "search",
      matches: page.items.map((match) => ({ server: match.server, tool: match.tool.name, score: match.score })),
      count: page.total,
      hasMore: page.hasMore,
      nextOffset: page.nextOffset,
      query
    }
  };
}
function executeList(state, server) {
  const definition = state.config.mcpServers[server];
  if (!definition) {
    return {
      content: [{ type: "text", text: `Server "${server}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "list", server, tools: [], count: 0, error: "not_found" }
    };
  }
  if (isServerDisabled(definition)) return disabledResult("list", server);
  const metadata = state.toolMetadata.get(server);
  const toolNames = metadata?.map((m) => m.name) ?? [];
  const connection = state.manager.getConnection(server);
  if (isServerInActiveFailureBackoff(state, server)) {
    return {
      ...serverBackoffResult(state, "list", server),
      details: { mode: "list", server, tools: [], count: 0, error: "server_backoff" }
    };
  }
  const instructions = state.serverInstructions.get(server);
  let instructionsText = "";
  if (instructions) {
    const preview = truncateAtWord(instructions, INSTRUCTIONS_PREVIEW_LENGTH);
    instructionsText = `

Server instructions:
${preview}`;
    if (preview !== instructions) {
      instructionsText += `
Use mcp({ instructions: "${server}" }) for the full text.`;
    }
  }
  if (toolNames.length === 0) {
    if (connection?.status === "connected") {
      return {
        content: [{ type: "text", text: `Server "${server}" has no tools.${instructionsText}` }],
        details: { mode: "list", server, tools: [], count: 0, hasInstructions: Boolean(instructions) }
      };
    }
    if (metadata !== void 0) {
      return {
        content: [{ type: "text", text: `Server "${server}" has no cached tools (not connected).${instructionsText}` }],
        details: { mode: "list", server, tools: [], count: 0, cached: true, hasInstructions: Boolean(instructions) }
      };
    }
    return {
      content: [{ type: "text", text: `Server "${server}" is configured but not connected. Use mcp({ connect: "${server}" }) or /mcp reconnect ${server} to retry.${instructionsText}` }],
      details: { mode: "list", server, tools: [], count: 0, error: "not_connected", hasInstructions: Boolean(instructions) }
    };
  }
  const cachedNote = connection?.status === "connected" ? "" : " (not connected, cached)";
  let text = `${server} (${toolNames.length} tools${cachedNote}):

`;
  const descMap = /* @__PURE__ */ new Map();
  if (metadata) {
    for (const m of metadata) {
      descMap.set(m.name, m.description);
    }
  }
  for (const tool of toolNames) {
    const desc = descMap.get(tool) ?? "";
    const truncated = truncateAtWord(desc, 50);
    text += `- ${tool}`;
    if (truncated) text += ` - ${truncated}`;
    text += "\n";
  }
  text += instructionsText;
  return {
    content: [{ type: "text", text: text.trim() }],
    details: { mode: "list", server, tools: toolNames, count: toolNames.length, hasInstructions: Boolean(instructions) }
  };
}
function executeInstructions(state, server) {
  const definition = state.config.mcpServers[server];
  if (!definition) {
    return {
      content: [{ type: "text", text: `Server "${server}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "instructions", server, error: "not_found" }
    };
  }
  if (isServerDisabled(definition)) return disabledResult("instructions", server);
  if (isServerInActiveFailureBackoff(state, server)) return serverBackoffResult(state, "instructions", server);
  const instructions = state.serverInstructions.get(server);
  if (instructions) {
    return {
      content: [{ type: "text", text: `${server} instructions:

${instructions}` }],
      details: { mode: "instructions", server, length: instructions.length }
    };
  }
  const connection = state.manager.getConnection(server);
  if (connection?.status === "connected") {
    return {
      content: [{ type: "text", text: `Server "${server}" does not provide instructions.` }],
      details: { mode: "instructions", server, error: "no_instructions" }
    };
  }
  return {
    content: [{ type: "text", text: `No instructions cached for "${server}". Use mcp({ connect: "${server}" }) to connect and refresh.` }],
    details: { mode: "instructions", server, error: "not_connected" }
  };
}

// src/tools/proxy/call.ts
async function executeConnect(state, serverName, signal) {
  const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
  throwIfAborted(ownedSignal);
  const definition = state.config.mcpServers[serverName];
  if (!definition) {
    return {
      content: [{ type: "text", text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "connect", error: "not_found", server: serverName }
    };
  }
  if (isServerDisabled(definition)) return disabledResult("connect", serverName);
  try {
    if (state.ui) {
      state.ui.setStatus("mcp", formatMcpStatus(state.config, `connecting to ${serverName}...`));
    }
    const currentConnection = state.manager.getConnection(serverName);
    let connection = currentConnection?.status === "connected" ? await state.manager.reconnect(serverName, definition, currentConnection, ownedSignal) : await state.manager.connect(serverName, definition, ownedSignal);
    if (connection.status === "needs-auth") {
      const autoAuth = await attemptAutoAuth(state, serverName, ownedSignal);
      if (autoAuth.status === "failed") {
        return {
          content: [{ type: "text", text: autoAuth.message }],
          details: { mode: "connect", error: "auth_required", server: serverName, message: autoAuth.message }
        };
      }
      if (autoAuth.status === "success") {
        await state.manager.close(serverName);
        throwIfAborted(ownedSignal);
        connection = ownedSignal ? await state.manager.connect(serverName, definition, ownedSignal) : await state.manager.connect(serverName, definition);
      }
      if (connection.status === "needs-auth") {
        const message = getAuthRequiredMessage(state, serverName);
        return {
          content: [{ type: "text", text: message }],
          details: { mode: "connect", error: "auth_required", server: serverName, message }
        };
      }
    }
    const prefix = state.config.settings?.toolPrefix ?? "server";
    const { metadata } = buildToolMetadata(connection.tools, connection.resources, definition, serverName, prefix, state.config.mcpServers, state.toolMetadata);
    state.toolMetadata.set(serverName, metadata);
    if (!connection.promptDiscoveryFailed) {
      state.promptMetadata?.set(serverName, reconstructPromptMetadata(serverName, connection.prompts ?? [], prefix, definition));
      state.promptMetadataLive?.add(serverName);
    }
    if (connection.instructions) {
      state.serverInstructions.set(serverName, connection.instructions);
    } else {
      state.serverInstructions.delete(serverName);
    }
    updateMetadataCache(state, serverName);
    const restored = clearFailure(state, serverName, "proxy-connect");
    if (!restored) notifyToolMetadataUpdated(state, serverName, "proxy-connect");
    markKeepAliveAfterConnect(state, serverName);
    updateStatusBar(state);
    return executeList(state, serverName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isAbortError(error, ownedSignal)) recordFailure(state, serverName, message);
    updateStatusBar(state);
    return {
      content: [{ type: "text", text: `Failed to connect to "${serverName}": ${message}` }],
      details: { mode: "connect", error: isAbortError(error, ownedSignal) ? "aborted" : "connect_failed", server: serverName, message }
    };
  }
}
async function executeCall(state, toolName, args, serverOverride, getPiTools, signal, origin) {
  const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
  throwIfAborted(ownedSignal);
  let serverName = serverOverride;
  let toolMeta;
  let autoAuthAttempted = false;
  const prefixMode = state.config.settings?.toolPrefix ?? "server";
  const disabledCallResult = (disabledServer, metadata) => {
    if (!metadata) {
      const message2 = `Server "${disabledServer}" is disabled. Run /mcp enable ${disabledServer} and /reload to enable it.`;
      return {
        content: [{ type: "text", text: message2 }],
        details: { mode: "call", error: "server_disabled", server: disabledServer, requestedTool: toolName, message: message2 }
      };
    }
    const message = `Server "${disabledServer}" is disabled. Run /mcp enable ${disabledServer} and /reload to enable it.`;
    const identity = metadata.resourceUri ? { server: disabledServer, resourceUri: metadata.resourceUri } : { server: disabledServer, tool: metadata.originalName };
    return {
      content: [{ type: "text", text: message }],
      details: { mode: "call", error: "server_disabled", ...identity, message }
    };
  };
  if (serverName && !state.config.mcpServers[serverName]) {
    return {
      content: [{ type: "text", text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "call", error: "server_not_found", server: serverName, requestedTool: toolName }
    };
  }
  if (serverName) {
    const match = getSingleToolMatch(state.toolMetadata.get(serverName), toolName);
    if (match === "ambiguous") return ambiguousToolResult("call", toolName);
    toolMeta = match;
    if (isServerDisabled(state.config.mcpServers[serverName])) {
      return disabledCallResult(serverName, toolMeta);
    }
  } else {
    const exactMatches = getEnabledToolMatches(state, toolName, true);
    if (exactMatches.length > 1) return ambiguousToolResult("call", toolName);
    if (exactMatches.length === 0 && getEnabledToolMatches(state, toolName, false).length > 1) {
      return ambiguousToolResult("call", toolName);
    }
    let disabledMatch;
    for (const [server, metadata] of state.toolMetadata.entries()) {
      const found = metadata.find((tool) => tool.name === toolName);
      if (!found) continue;
      if (isServerDisabled(state.config.mcpServers[server])) {
        disabledMatch ??= { serverName: server, toolMeta: found };
        continue;
      }
      serverName = server;
      toolMeta = found;
      break;
    }
    if (!toolMeta && !disabledMatch) {
      for (const [server, metadata] of state.toolMetadata.entries()) {
        const found = findToolByName(metadata, toolName);
        if (!found) continue;
        if (isServerDisabled(state.config.mcpServers[server])) {
          disabledMatch ??= { serverName: server, toolMeta: found };
          continue;
        }
        serverName = server;
        toolMeta = found;
        break;
      }
    }
    if (!toolMeta && disabledMatch) return disabledCallResult(disabledMatch.serverName, disabledMatch.toolMeta);
  }
  if (serverName && !toolMeta) {
    const connected = await lazyConnect(state, serverName, ownedSignal);
    if (connected) {
      const match = getSingleToolMatch(state.toolMetadata.get(serverName), toolName);
      if (match === "ambiguous") return ambiguousToolResult("call", toolName);
      toolMeta = match;
    } else {
      const needsAuthConnection = state.manager.getConnection(serverName);
      if (needsAuthConnection?.status === "needs-auth") {
        if (!autoAuthAttempted) {
          autoAuthAttempted = true;
          const autoAuth = await attemptAutoAuth(state, serverName, ownedSignal);
          if (autoAuth.status === "failed") {
            return {
              content: [{ type: "text", text: autoAuth.message }],
              details: { mode: "call", error: "auth_required", server: serverName, requestedTool: toolName, message: autoAuth.message }
            };
          }
          if (autoAuth.status === "success") {
            await state.manager.close(serverName);
            clearFailure(state, serverName);
            const connectedAfterAuth = await lazyConnect(state, serverName, ownedSignal);
            if (connectedAfterAuth) {
              const match = getSingleToolMatch(state.toolMetadata.get(serverName), toolName);
              if (match === "ambiguous") return ambiguousToolResult("call", toolName);
              toolMeta = match;
              if (!toolMeta) {
                const suggestions = rankSuggestions(state, toolName, 5);
                const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}` : "";
                return {
                  content: [{ type: "text", text: `Tool "${toolName}" not found on "${serverName}" after reconnect.${suggestionText}` }],
                  details: { mode: "call", error: "tool_not_found_after_reconnect", server: serverName, requestedTool: toolName, suggestions }
                };
              }
            }
          }
        }
        if (!toolMeta && state.manager.getConnection(serverName)?.status === "needs-auth") {
          const message = getAuthRequiredMessage(state, serverName);
          return {
            content: [{ type: "text", text: message }],
            details: { mode: "call", error: "auth_required", server: serverName, requestedTool: toolName, message }
          };
        }
      }
      if (!toolMeta) {
        const failedAgo = getFailureAgeSeconds(state, serverName);
        if (failedAgo !== null) {
          return {
            content: [{ type: "text", text: `Server "${serverName}" not available (last failed ${failedAgo}s ago)` }],
            details: { mode: "call", error: "server_backoff", server: serverName, requestedTool: toolName }
          };
        }
      }
    }
  }
  let prefixMatchedServer;
  if (!serverName && !toolMeta && prefixMode !== "none") {
    const lazyExactMatches = [];
    const lazyFallbackMatches = [];
    const candidates = Object.keys(state.config.mcpServers).filter((name) => !isServerDisabled(state.config.mcpServers[name])).map((name) => ({ name, prefix: getServerPrefix(name, prefixMode) })).filter((c) => c.prefix && toolName.startsWith(c.prefix + "_")).sort((a, b) => b.prefix.length - a.prefix.length);
    for (const { name: configuredServer } of candidates) {
      const existingConnection = state.manager.getConnection(configuredServer);
      const failedAgo = getFailureAgeSeconds(state, configuredServer);
      if (failedAgo !== null && existingConnection?.status !== "needs-auth") continue;
      let connected = await lazyConnect(state, configuredServer, ownedSignal);
      if (!connected && state.manager.getConnection(configuredServer)?.status === "needs-auth" && !autoAuthAttempted) {
        autoAuthAttempted = true;
        const autoAuth = await attemptAutoAuth(state, configuredServer, ownedSignal);
        if (autoAuth.status === "failed") {
          return {
            content: [{ type: "text", text: autoAuth.message }],
            details: { mode: "call", error: "auth_required", server: configuredServer, requestedTool: toolName, message: autoAuth.message }
          };
        }
        if (autoAuth.status === "success") {
          await state.manager.close(configuredServer);
          clearFailure(state, configuredServer);
          connected = await lazyConnect(state, configuredServer, ownedSignal);
        }
      }
      if (!connected) continue;
      if (!prefixMatchedServer) prefixMatchedServer = configuredServer;
      const metadata = state.toolMetadata.get(configuredServer);
      const exactMatches = getToolMatches(metadata, toolName, true);
      if (exactMatches.length > 1) return ambiguousToolResult("call", toolName);
      if (exactMatches.length === 1) {
        lazyExactMatches.push({ serverName: configuredServer, toolMeta: exactMatches[0] });
        continue;
      }
      const fallbackMatches = getToolMatches(metadata, toolName, false);
      if (fallbackMatches.length > 1) return ambiguousToolResult("call", toolName);
      if (fallbackMatches.length === 1) lazyFallbackMatches.push({ serverName: configuredServer, toolMeta: fallbackMatches[0] });
    }
    const lazyMatches = lazyExactMatches.length > 0 ? lazyExactMatches : lazyFallbackMatches;
    if (lazyMatches.length > 1) return ambiguousToolResult("call", toolName);
    if (lazyMatches.length === 1) {
      serverName = lazyMatches[0].serverName;
      toolMeta = lazyMatches[0].toolMeta;
    }
  }
  if (!serverName || !toolMeta) {
    const nativeTool = !serverOverride ? getPiTools?.().find((tool) => tool.name === toolName && tool.name !== "mcp") : void 0;
    if (nativeTool) {
      return {
        content: [{ type: "text", text: `"${toolName}" is a native Pi tool. Call ${toolName} directly instead of using mcp({ tool: "${toolName}" }).` }],
        details: { mode: "call", error: "native_tool", requestedTool: toolName }
      };
    }
    const hintServer = serverName ?? prefixMatchedServer;
    const available = hintServer ? getToolNames(state, hintServer) : [];
    let msg = `Tool "${toolName}" not found.`;
    if (available.length > 0) {
      msg += ` Server "${hintServer}" has: ${available.join(", ")}`;
    } else {
      msg += ` Use mcp({ search: "..." }) to search.`;
    }
    const suggestions = rankSuggestions(state, toolName, 5);
    if (suggestions.length > 0) msg += ` Did you mean: ${suggestions.join(", ")}`;
    return {
      content: [{ type: "text", text: msg }],
      details: { mode: "call", error: "tool_not_found", requestedTool: toolName, hintServer, suggestions }
    };
  }
  const callIdentity = toolMeta.resourceUri ? { server: serverName, resourceUri: toolMeta.resourceUri } : { server: serverName, tool: toolMeta.originalName };
  let connection = state.manager.getConnection(serverName);
  if (connection?.status === "needs-auth") {
    if (!autoAuthAttempted) {
      autoAuthAttempted = true;
      const autoAuth = await attemptAutoAuth(state, serverName, ownedSignal);
      if (autoAuth.status === "failed") {
        return {
          content: [{ type: "text", text: autoAuth.message }],
          details: { mode: "call", error: "auth_required", ...callIdentity, message: autoAuth.message }
        };
      }
      if (autoAuth.status === "success") {
        await state.manager.close(serverName);
        clearFailure(state, serverName);
        connection = state.manager.getConnection(serverName);
      }
    }
    if (connection?.status === "needs-auth") {
      const message = getAuthRequiredMessage(state, serverName);
      return {
        content: [{ type: "text", text: message }],
        details: { mode: "call", error: "auth_required", ...callIdentity, message }
      };
    }
  }
  if (!connection || connection.status !== "connected") {
    const failedAgo = getFailureAgeSeconds(state, serverName);
    if (failedAgo !== null) {
      return {
        content: [{ type: "text", text: `Server "${serverName}" not available (last failed ${failedAgo}s ago)` }],
        details: { mode: "call", error: "server_backoff", ...callIdentity }
      };
    }
    const definition = state.config.mcpServers[serverName];
    if (!definition) {
      return {
        content: [{ type: "text", text: `Server "${serverName}" not connected` }],
        details: { mode: "call", error: "server_not_connected", ...callIdentity }
      };
    }
    try {
      if (state.ui) {
        state.ui.setStatus("mcp", formatMcpStatus(state.config, `connecting to ${serverName}...`));
      }
      connection = await state.manager.connect(serverName, definition, ownedSignal);
      if (connection.status === "needs-auth") {
        if (!autoAuthAttempted) {
          autoAuthAttempted = true;
          const autoAuth = await attemptAutoAuth(state, serverName, ownedSignal);
          if (autoAuth.status === "failed") {
            return {
              content: [{ type: "text", text: autoAuth.message }],
              details: { mode: "call", error: "auth_required", ...callIdentity, message: autoAuth.message }
            };
          }
          if (autoAuth.status === "success") {
            await state.manager.close(serverName);
            connection = await state.manager.connect(serverName, definition, ownedSignal);
          }
        }
        if (connection.status === "needs-auth") {
          const message = getAuthRequiredMessage(state, serverName);
          return {
            content: [{ type: "text", text: message }],
            details: { mode: "call", error: "auth_required", ...callIdentity, message }
          };
        }
      }
      updateServerMetadata(state, serverName);
      updateMetadataCache(state, serverName);
      const restored = clearFailure(state, serverName, "proxy-call-reconnect");
      if (!restored) notifyToolMetadataUpdated(state, serverName, "proxy-call-reconnect");
      markKeepAliveAfterConnect(state, serverName);
      updateStatusBar(state);
      const match = getSingleToolMatch(state.toolMetadata.get(serverName), toolName);
      if (match === "ambiguous") return ambiguousToolResult("call", toolName);
      toolMeta = match;
      if (!toolMeta) {
        const available = getToolNames(state, serverName);
        const hint = available.length > 0 ? `Available tools on "${serverName}": ${available.join(", ")}` : `Server "${serverName}" has no tools.`;
        const suggestions = rankSuggestions(state, toolName, 5);
        const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}` : "";
        return {
          content: [{ type: "text", text: `Tool "${toolName}" not found on "${serverName}" after reconnect. ${hint}${suggestionText}` }],
          details: { mode: "call", error: "tool_not_found_after_reconnect", server: serverName, requestedTool: toolName, suggestions }
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isAbortError(error, ownedSignal)) recordFailure(state, serverName, message);
      updateStatusBar(state);
      return {
        content: [{ type: "text", text: `Failed to connect to "${serverName}": ${message}` }],
        details: { mode: "call", error: isAbortError(error, ownedSignal) ? "aborted" : "connect_failed", ...callIdentity, message }
      };
    }
  }
  if (isServerDisabled(state.config.mcpServers[serverName])) {
    return disabledCallResult(serverName, toolMeta);
  }
  const normalizedArgs = toolMeta.resourceUri ? args ?? {} : normalizeToolArguments(args);
  const approval = await ensureToolCallApproved(
    state,
    serverName,
    toolMeta,
    normalizedArgs,
    ownedSignal,
    origin ?? (toolMeta.resourceUri ? "resource" : "proxy")
  );
  if (approval.ok === false) {
    const denied = approval.reason === "denied";
    const message = denied ? `The user declined approval to run MCP tool "${toolMeta.originalName}" on server "${serverName}".` : `MCP tool "${toolMeta.originalName}" on server "${serverName}" is approval-gated and requires an interactive session.`;
    return {
      content: [{ type: "text", text: message }],
      details: {
        mode: "call",
        error: denied ? "approval_denied" : "approval_required",
        server: serverName,
        tool: toolMeta.originalName
      }
    };
  }
  let uiSession = null;
  const requestOptions = state.manager.getRequestOptions?.(serverName, ownedSignal) ?? (ownedSignal ? { signal: ownedSignal } : void 0);
  const outputGuardOptions = resolveMcpOutputGuardOptions(state.config.settings);
  const recoverAuthConnection = async () => {
    const current = state.manager.getConnection(serverName);
    if (current?.status === "connected") return current;
    if (!autoAuthAttempted) {
      autoAuthAttempted = true;
      const autoAuth = await attemptAutoAuth(state, serverName, ownedSignal);
      if (autoAuth.status === "failed") {
        throw new SessionRecoveryAuthRequiredError(serverName, autoAuth.message);
      }
      if (autoAuth.status === "success") {
        const definition = state.config.mcpServers[serverName];
        if (!definition) return void 0;
        const afterAuth = state.manager.getConnection(serverName);
        if (afterAuth?.status === "connected") return afterAuth;
        if (afterAuth?.status === "needs-auth") {
          await state.manager.close(serverName);
        }
        clearFailure(state, serverName);
        connection = await state.manager.connect(serverName, definition, ownedSignal);
        return connection;
      }
    }
    return state.manager.getConnection(serverName);
  };
  try {
    state.manager.touch(serverName);
    state.manager.incrementInFlight(serverName);
    if (toolMeta.resourceUri) {
      const result2 = await withSessionRecovery(
        {
          manager: state.manager,
          config: state.config,
          ...ownedSignal ? { signal: ownedSignal } : {},
          onNeedsAuth: recoverAuthConnection
        },
        serverName,
        (conn) => conn.client.readResource({ uri: toolMeta.resourceUri }, requestOptions)
      );
      const content2 = transformMcpResourceContents(result2.contents ?? [], state.owner?.signal);
      const guarded2 = await guardMcpOutput(content2.length > 0 ? content2 : [{ type: "text", text: "(empty resource)" }], outputGuardOptions);
      return {
        content: guarded2.content,
        details: { mode: "call", ...callIdentity, ...guardedMcpDetails(guarded2) }
      };
    }
    uiSession = toolMeta.uiResourceUri ? await maybeStartUiSession(state, {
      serverName,
      toolName: toolMeta.originalName,
      toolArgs: normalizedArgs,
      uiResourceUri: toolMeta.uiResourceUri,
      ...toolMeta.uiStreamMode !== void 0 ? { streamMode: toolMeta.uiStreamMode } : {},
      ...signal ? { signal } : {},
      onNeedsAuth: recoverAuthConnection
    }) : null;
    const result = await withSessionRecovery(
      {
        manager: state.manager,
        config: state.config,
        ...ownedSignal ? { signal: ownedSignal } : {},
        onNeedsAuth: recoverAuthConnection
      },
      serverName,
      (conn) => abortable(conn.client.callTool({
        name: toolMeta.originalName,
        arguments: normalizedArgs,
        _meta: uiSession?.requestMeta
      }, requestOptions), ownedSignal)
    );
    if (toolMeta.uiResourceUri) {
      uiSession?.sendToolResult(result);
      if (result.isError) {
        const mcpContent = result.content ?? [];
        const content3 = transformMcpContent(mcpContent, state.owner?.signal);
        const outputContent3 = content3.length > 0 ? content3 : [{ type: "text", text: "(empty result)" }];
        const schemaText = toolMeta.inputSchema ? `

Expected parameters:
${formatSchema(toolMeta.inputSchema)}` : "";
        const guarded3 = await guardMcpOutput(outputContent3, { ...outputGuardOptions, prefix: "Error: ", suffix: schemaText, emptyTextFallback: "Tool execution failed", rawMcpResult: result });
        return {
          content: guarded3.content,
          details: { mode: "call", error: "tool_error", ...callIdentity, ...guardedMcpDetails(guarded3) }
        };
      }
      const content2 = resolveMcpResultContent(result, state.owner?.signal);
      const outputContent2 = content2.length > 0 ? content2 : [{ type: "text", text: "(empty result)" }];
      const uiSummary = summarizeUiSessionResult(uiSession);
      const guarded2 = await guardMcpOutput(outputContent2, { ...outputGuardOptions, suffix: `

${uiSummary.message}`, rawMcpResult: result });
      return {
        content: guarded2.content,
        details: {
          mode: "call",
          ...guardedMcpDetails(guarded2),
          ...callIdentity,
          uiOpen: uiSummary.uiOpen,
          uiViewer: uiSummary.uiViewer,
          uiUrl: uiSummary.uiUrl
        }
      };
    }
    if (result.isError) {
      const mcpContent = result.content ?? [];
      const content2 = transformMcpContent(mcpContent, state.owner?.signal);
      const outputContent2 = content2.length > 0 ? content2 : [{ type: "text", text: "(empty result)" }];
      const schemaText = toolMeta.inputSchema ? `

Expected parameters:
${formatSchema(toolMeta.inputSchema)}` : "";
      const guarded2 = await guardMcpOutput(outputContent2, { ...outputGuardOptions, prefix: "Error: ", suffix: schemaText, emptyTextFallback: "Tool execution failed", rawMcpResult: result });
      return {
        content: guarded2.content,
        details: { mode: "call", error: "tool_error", ...callIdentity, ...guardedMcpDetails(guarded2) }
      };
    }
    const content = resolveMcpResultContent(result, state.owner?.signal);
    const outputContent = content.length > 0 ? content : [{ type: "text", text: "(empty result)" }];
    const guarded = await guardMcpOutput(outputContent, { ...outputGuardOptions, rawMcpResult: result });
    return {
      content: guarded.content,
      details: { mode: "call", ...guardedMcpDetails(guarded), ...callIdentity }
    };
  } catch (error) {
    if (error instanceof SessionRecoveryAuthRequiredError) {
      const message2 = error.authMessage ?? getAuthRequiredMessage(state, serverName);
      uiSession?.sendToolCancelled(message2);
      return {
        content: [{ type: "text", text: message2 }],
        details: { mode: "call", error: "auth_required", ...callIdentity, message: message2, autoAuthAttempted }
      };
    }
    if (error instanceof UrlElicitationRequiredError) {
      const action = await state.manager.handleUrlElicitationRequired(serverName, error);
      const message2 = action === "accept" ? "The original MCP tool did not run. Complete the opened browser interaction, then retry the tool." : `The URL interaction was ${action === "decline" ? "declined" : "cancelled"}.`;
      uiSession?.sendToolCancelled(message2);
      return {
        content: [{ type: "text", text: message2 }],
        details: { mode: "call", error: "url_elicitation_required", ...callIdentity, action }
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    uiSession?.sendToolCancelled(message);
    const schemaText = toolMeta.inputSchema ? `

Expected parameters:
${formatSchema(toolMeta.inputSchema)}` : "";
    const guarded = await guardMcpOutput([{ type: "text", text: message }], { ...outputGuardOptions, prefix: "Failed to call tool: ", suffix: schemaText });
    return {
      content: guarded.content,
      details: { mode: "call", error: isAbortError(error, ownedSignal) ? "aborted" : "call_failed", ...callIdentity, message: guarded.outputGuard ? "output truncated; see outputGuard.fullOutputPath" : message, ...guardedMcpDetails(guarded) }
    };
  } finally {
    if (uiSession?.reused) {
      uiSession.close();
    }
    state.manager.decrementInFlight(serverName);
    state.manager.touch(serverName);
  }
}

export {
  rankToolMatches,
  paginate,
  rankSuggestions,
  renderTsShape,
  disabledResult,
  formatManualAuthInstructions,
  executeDescribe,
  executeSearch,
  executeList,
  executeInstructions,
  executeConnect,
  executeCall
};
