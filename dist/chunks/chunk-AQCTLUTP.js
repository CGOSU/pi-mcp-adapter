import {
  ServerError,
  SessionRecoveryAuthRequiredError,
  UI_STREAM_HOST_CONTEXT_KEY,
  UI_STREAM_REQUEST_META_KEY,
  UI_STREAM_STRUCTURED_CONTENT_KEY,
  getVisualizationStreamEnvelope,
  withSessionRecovery,
  wrapError
} from "./chunk-ZKXUDEBO.js";
import {
  logger
} from "./chunk-KLTV33HH.js";
import {
  abortable,
  throwIfAborted
} from "./chunk-LETXAJ4X.js";
import {
  combineAbortSignals,
  isAbortError
} from "./chunk-YFB6HSH2.js";
import {
  buildAllowAttribute,
  extractUiToolVisibility,
  getToolNameCandidates,
  isUiToolCallableByApp,
  isUiToolVisibleToModel,
  matchesToolPattern,
  resolveToolPrefix,
  resourceNameToToolName
} from "./chunk-PXMBC3S7.js";
import {
  formatAuthRequiredMessage,
  normalizeToolArguments,
  sanitizeTerminalText
} from "./chunk-IOFHQSPP.js";
import {
  MCP_TOOL_APPROVAL_REQUEST_EVENT,
  isServerDisabled
} from "./chunk-LVZ7J2NB.js";

// src/tools/mcp-output-guard.ts
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
var DEFAULT_MCP_OUTPUT_MAX_BYTES = 50 * 1024;
var DEFAULT_MCP_OUTPUT_MAX_LINES = 2e3;
var DEFAULT_MCP_DETAILS_MAX_BYTES = 16 * 1024;
var CONTENT_SUMMARY_LIMIT = 20;
var KEY_PREVIEW_LIMIT = 20;
var KEY_MAX_BYTES = 120;
var STRUCTURED_CONTENT_PRESERVE_MAX_BYTES = 4 * 1024;
var STRUCTURED_CONTENT_FIELD_PRESERVE_MAX_BYTES = 512;
function resolveMcpOutputGuardOptions(settings) {
  const configured = settings?.outputGuard;
  const tuning = typeof configured === "object" && configured !== null ? configured : void 0;
  return {
    enabled: envKillSwitch("MCP_OUTPUT_GUARD") ?? configured !== false,
    maxBytes: positiveInt(tuning?.maxBytes) ?? DEFAULT_MCP_OUTPUT_MAX_BYTES,
    maxLines: positiveInt(tuning?.maxLines) ?? DEFAULT_MCP_OUTPUT_MAX_LINES,
    detailsMaxBytes: positiveInt(tuning?.detailsMaxBytes) ?? DEFAULT_MCP_DETAILS_MAX_BYTES
  };
}
function guardedMcpDetails(guarded) {
  return {
    ...guarded.mcpResult !== void 0 ? { mcpResult: guarded.mcpResult } : {},
    ...guarded.outputGuard ? { outputGuard: guarded.outputGuard } : {}
  };
}
async function guardMcpOutput(content, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MCP_OUTPUT_MAX_BYTES;
  const maxLines = options.maxLines ?? DEFAULT_MCP_OUTPUT_MAX_LINES;
  const detailsMaxBytes = options.detailsMaxBytes ?? DEFAULT_MCP_DETAILS_MAX_BYTES;
  const prefix = options.prefix ?? "";
  const suffix = options.suffix ?? "";
  const normalizedContent = withEmptyTextFallback(
    content.length > 0 ? sanitizeContent(content) : [{ type: "text", text: options.emptyTextFallback ?? "(empty result)" }],
    options.emptyTextFallback
  );
  if (options.enabled === false) {
    return {
      content: addAffixes(normalizedContent, prefix, suffix),
      ...options.rawMcpResult !== void 0 ? { mcpResult: options.rawMcpResult } : {}
    };
  }
  const imageBlocks = normalizedContent.filter((block) => block.type === "image");
  const textOutput = normalizedContent.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  const composedOutput = `${prefix}${textOutput}${suffix}`;
  const stats = textStats(composedOutput);
  let guardedContent = addAffixes(normalizedContent, prefix, suffix);
  let outputGuard;
  if (stats.bytes > maxBytes || stats.lines > maxLines) {
    const { path: fullOutputPath, error: writeError } = await saveArtifact("output", composedOutput);
    const notice = formatTruncationNotice(stats, fullOutputPath, writeError);
    const previewBudget = reserveBudget(maxBytes, maxLines, notice);
    const preview = truncateHead(composedOutput, previewBudget.maxBytes, previewBudget.maxLines);
    const finalText = `${preview.content}

${notice}`;
    const finalStats = textStats(finalText);
    guardedContent = [{ type: "text", text: finalText }, ...imageBlocks];
    outputGuard = {
      truncated: true,
      originalBytes: stats.bytes,
      returnedBytes: finalStats.bytes,
      originalLines: stats.lines,
      returnedLines: finalStats.lines,
      ...imageBlocks.length > 0 ? { imageBlocksPassedThrough: imageBlocks.length } : {},
      ...fullOutputPath !== void 0 ? { fullOutputPath } : {},
      ...writeError !== void 0 ? { writeError } : {}
    };
  }
  const mcpResult = options.rawMcpResult === void 0 ? void 0 : await boundMcpResult(options.rawMcpResult, detailsMaxBytes);
  return {
    content: guardedContent,
    ...outputGuard ? { outputGuard } : {},
    ...mcpResult !== void 0 ? { mcpResult } : {}
  };
}
function sanitizeContent(content) {
  return content.map((block) => {
    if (block.type !== "image") return block;
    const mimeType = typeof block.mimeType === "string" && block.mimeType.trim() ? block.mimeType.trim().slice(0, 100) : "image/png";
    return { ...block, mimeType };
  });
}
function withEmptyTextFallback(content, fallback) {
  if (!fallback) return content;
  const textOutput = content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  if (textOutput) return content;
  return [{ type: "text", text: fallback }, ...content.filter((block) => block.type === "image")];
}
function addAffixes(content, prefix, suffix) {
  if (!prefix && !suffix) return content;
  const next = [...content];
  if (prefix) {
    const index = next.findIndex((block2) => block2.type === "text");
    const block = next[index];
    if (block?.type === "text") {
      next[index] = { ...block, text: `${prefix}${block.text}` };
    } else {
      next.unshift({ type: "text", text: prefix });
    }
  }
  if (suffix) {
    let index = -1;
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i]?.type === "text") {
        index = i;
        break;
      }
    }
    const block = next[index];
    if (block?.type === "text") {
      next[index] = { ...block, text: `${block.text}${suffix}` };
    } else {
      next.push({ type: "text", text: suffix });
    }
  }
  return next;
}
function reserveBudget(maxBytes, maxLines, notice) {
  const noticeStats = textStats(`

${notice}`);
  return {
    maxBytes: Math.max(0, maxBytes - noticeStats.bytes),
    maxLines: Math.max(0, maxLines - noticeStats.lines)
  };
}
function truncateHead(text, maxBytes, maxLines) {
  const lines = text.split("\n");
  const output = [];
  let bytes = 0;
  for (const line of lines) {
    if (output.length >= maxLines) break;
    const separatorBytes = output.length > 0 ? 1 : 0;
    const lineBytes = byteLength(line);
    if (bytes + separatorBytes + lineBytes > maxBytes) {
      const remaining = maxBytes - bytes - separatorBytes;
      if (remaining > 0) {
        output.push(truncateStringToBytes(line, remaining));
      }
      break;
    }
    output.push(line);
    bytes += separatorBytes + lineBytes;
  }
  const content = output.join("\n");
  const stats = textStats(content);
  return { content, bytes: stats.bytes, lines: stats.lines };
}
function truncateStringToBytes(value, maxBytes) {
  if (byteLength(value) <= maxBytes) return value;
  const buffer = Buffer.from(value, "utf8");
  let end = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 0;
  while (end > 0 && (buffer.readUInt8(end) & 192) === 128) end--;
  return buffer.subarray(0, end).toString("utf8");
}
function formatTruncationNotice(stats, fullOutputPath, writeError) {
  const base = `[MCP text output truncated: original ${stats.lines.toLocaleString()} lines / ${formatSize(stats.bytes)}.`;
  if (fullOutputPath) {
    return `${base} Full text saved to: ${fullOutputPath} \u2014 use read with offset/limit or grep to inspect.]`;
  }
  return `${base} Full output could not be saved: ${writeError ?? "unknown error"}]`;
}
async function boundMcpResult(result, detailsMaxBytes) {
  const raw = safeStringify(result);
  const rawBytes = byteLength(raw);
  if (rawBytes <= detailsMaxBytes) return result;
  const marker = { omitted: true };
  if (byteLength(safeStringify(marker)) > detailsMaxBytes) return void 0;
  const summary = await summarizeMcpResult(result, raw, rawBytes);
  if (byteLength(safeStringify(summary)) <= detailsMaxBytes) return summary;
  return compactMcpResultOmission(summary, marker, detailsMaxBytes);
}
async function compactMcpResultOmission(summary, marker, maxBytes) {
  if (summary.fullResultPath) {
    const withPathAndSize = {
      ...marker,
      rawResultBytes: summary.rawResultBytes,
      fullResultPath: summary.fullResultPath
    };
    if (byteLength(safeStringify(withPathAndSize)) <= maxBytes) return withPathAndSize;
    const withPath = { ...marker, fullResultPath: summary.fullResultPath };
    if (byteLength(safeStringify(withPath)) <= maxBytes) return withPath;
    await discardArtifact(summary.fullResultPath);
  }
  const withSize = { ...marker, rawResultBytes: summary.rawResultBytes };
  return byteLength(safeStringify(withSize)) <= maxBytes ? withSize : marker;
}
async function summarizeMcpResult(result, raw, rawBytes) {
  const { path: fullResultPath, error: resultWriteError } = await saveArtifact("mcp-result", raw);
  const record = asRecord(result);
  const content = Array.isArray(record?.content) ? record.content : [];
  const summary = {
    omitted: true,
    reason: "Raw MCP result exceeded the details size limit and was replaced with this summary to keep session context bounded.",
    isError: record?.isError === true,
    contentBlocks: content.length,
    contentSummary: summarizeContent(content),
    rawResultBytes: rawBytes,
    ...fullResultPath !== void 0 ? { fullResultPath } : {},
    ...resultWriteError !== void 0 ? { resultWriteError } : {}
  };
  if (record && "structuredContent" in record) {
    summary.structuredContent = summarizeStructuredContent(record.structuredContent);
  }
  if (record && "_meta" in record) {
    summary.meta = summarizeValue(record._meta);
  }
  if (record) {
    const standard = /* @__PURE__ */ new Set(["content", "isError", "structuredContent", "_meta"]);
    const extraFields = Object.keys(record).filter((key) => !standard.has(key)).slice(0, KEY_PREVIEW_LIMIT).map((key) => ({ key: truncateKey(key), type: typeof record[key], estimatedBytes: estimateValueBytes(record[key]), omitted: true }));
    if (extraFields.length > 0) summary.extraFields = extraFields;
  }
  return summary;
}
function summarizeContent(content) {
  const summaries = content.slice(0, CONTENT_SUMMARY_LIMIT).map((block) => {
    const record = asRecord(block);
    if (!record) return { type: typeof block, omitted: true };
    if (record.type === "text") {
      const text = typeof record.text === "string" ? record.text : "";
      return { type: "text", bytes: byteLength(text), lines: textStats(text).lines, textOmitted: true };
    }
    if (record.type === "image") {
      const data = typeof record.data === "string" ? record.data : "";
      return { type: "image", mimeType: typeof record.mimeType === "string" ? record.mimeType : void 0, dataBytes: byteLength(data), dataOmitted: true };
    }
    return { type: typeof record.type === "string" ? record.type : "unknown", estimatedBytes: estimateValueBytes(record), omitted: true };
  });
  if (content.length > CONTENT_SUMMARY_LIMIT) {
    summaries.push({ type: "omitted", count: content.length - CONTENT_SUMMARY_LIMIT });
  }
  return summaries;
}
function summarizeValue(value) {
  const record = asRecord(value);
  if (!record) {
    return { type: value === null ? "null" : typeof value, estimatedBytes: estimateValueBytes(value), omitted: true };
  }
  const keys = Object.keys(record);
  return {
    type: Array.isArray(value) ? "array" : "object",
    estimatedBytes: estimateValueBytes(value),
    keyCount: keys.length,
    keysPreview: uniqueBoundedKeys(keys.slice(0, KEY_PREVIEW_LIMIT)),
    omitted: true
  };
}
function summarizeStructuredContent(value) {
  const record = asRecord(value);
  if (!record || Array.isArray(value)) return summarizeValue(value);
  const keys = Object.keys(record);
  const entries = Object.entries(record).slice(0, KEY_PREVIEW_LIMIT);
  const previewKeys = uniqueBoundedKeys(entries.map(([key]) => key));
  const fields = {};
  let preservedBytes = byteLength("{}");
  for (const [key, field] of entries) {
    const fieldBytes = byteLength(safeStringify(field));
    const candidate = fieldBytes <= STRUCTURED_CONTENT_FIELD_PRESERVE_MAX_BYTES ? field : summarizeValue(field);
    const entryBytes = serializedObjectEntryBytes(key, candidate, Object.keys(fields).length > 0);
    if (preservedBytes + entryBytes > STRUCTURED_CONTENT_PRESERVE_MAX_BYTES) continue;
    fields[key] = candidate;
    preservedBytes += entryBytes;
  }
  return {
    preservedFields: fields,
    summary: {
      type: "object",
      estimatedBytes: estimateValueBytes(value),
      keyCount: keys.length,
      keysPreview: previewKeys,
      omitted: true
    }
  };
}
function estimateValueBytes(value, depth = 0) {
  if (value === null || value === void 0) return 0;
  if (typeof value === "string") return byteLength(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return byteLength(String(value));
  const record = asRecord(value);
  if (!record || depth >= 2) return 0;
  const values = Array.isArray(value) ? value.slice(0, KEY_PREVIEW_LIMIT) : Object.values(record).slice(0, KEY_PREVIEW_LIMIT);
  return values.reduce((total, item) => total + estimateValueBytes(item, depth + 1), 0);
}
function truncateKey(key) {
  if (byteLength(key) <= KEY_MAX_BYTES) return key;
  const suffix = "\u2026";
  return `${truncateStringToBytes(key, KEY_MAX_BYTES - byteLength(suffix))}${suffix}`;
}
function uniqueBoundedKeys(keys) {
  const used = /* @__PURE__ */ new Set();
  return keys.map((key) => {
    let candidate = truncateKey(key);
    let ordinal = 2;
    while (used.has(candidate)) {
      const suffix = `~${ordinal}`;
      candidate = `${truncateStringToBytes(key, KEY_MAX_BYTES - byteLength(suffix))}${suffix}`;
      ordinal += 1;
    }
    used.add(candidate);
    return candidate;
  });
}
function serializedObjectEntryBytes(key, value, hasPrevious) {
  const serialized = safeStringify({ [key]: value });
  return Math.max(0, byteLength(serialized) - byteLength("{}")) + (hasPrevious ? 1 : 0);
}
async function saveArtifact(kind, text) {
  try {
    const dir = await mkdtemp(join(tmpdir(), "pi-mcp-output-"));
    const path2 = join(dir, `${kind}-${randomBytes(4).toString("hex")}.txt`);
    await writeFile(path2, text, { encoding: "utf8", mode: 384 });
    return { path: path2 };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
async function discardArtifact(path2) {
  try {
    await rm(dirname(path2), { recursive: true, force: true });
  } catch {
  }
}
function asRecord(value) {
  return typeof value === "object" && value !== null ? value : void 0;
}
function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function textStats(text) {
  return { bytes: byteLength(text), lines: text.length === 0 ? 0 : text.split("\n").length };
}
function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}
function positiveInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
  const integer = Math.floor(value);
  return integer > 0 ? integer : void 0;
}
function envKillSwitch(name) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return void 0;
  if (["0", "false", "no", "off"].includes(value)) return false;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  return void 0;
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

// src/tools/tool-approval.ts
import { createHash, randomUUID } from "node:crypto";
function stableStringify(value) {
  if (value === null || value === void 0 || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    return serialized === void 0 ? "undefined" : serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const object = value;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}
function isToolCallApprovalRequired(config, serverName, toolMeta, toolMetadata) {
  const definition = config.mcpServers[serverName];
  const serverApproval = definition?.approveTools;
  const approval = serverApproval !== void 0 ? serverApproval : config.settings?.approveTools;
  if (approval === true) return true;
  if (!Array.isArray(approval) || approval.length === 0) return false;
  const prefix = resolveToolPrefix(definition, config.settings?.toolPrefix);
  const currentCandidates = getToolNameCandidates(toolMeta.originalName, serverName, prefix, false);
  if (serverApproval !== void 0) {
    if (matchesToolPattern(currentCandidates, approval)) return true;
    if (!toolMetadata) return matchesToolPattern(getToolNameCandidates(toolMeta.originalName, serverName, prefix), approval);
    const legacyCandidates2 = getToolNameCandidates(toolMeta.originalName, serverName, prefix);
    const legacyEmittedName2 = [...currentCandidates].find((candidate) => candidate !== toolMeta.originalName)?.replace(/-/g, "_");
    if (legacyEmittedName2) legacyCandidates2.add(legacyEmittedName2);
    for (const candidate of currentCandidates) legacyCandidates2.delete(candidate);
    const otherCurrentCandidates2 = /* @__PURE__ */ new Set();
    for (const tool of toolMetadata.get(serverName) ?? []) {
      for (const candidate of getToolNameCandidates(tool.originalName, serverName, prefix, false)) {
        otherCurrentCandidates2.add(candidate);
      }
    }
    for (const candidate of currentCandidates) otherCurrentCandidates2.delete(candidate);
    return approval.some(
      (pattern) => matchesToolPattern(legacyCandidates2, [pattern]) && !matchesToolPattern(otherCurrentCandidates2, [pattern])
    );
  }
  if (matchesToolPattern(currentCandidates, approval)) return true;
  if (!toolMetadata) return false;
  const legacyCandidates = getToolNameCandidates(toolMeta.originalName, serverName, prefix);
  const legacyEmittedName = [...currentCandidates].find((candidate) => candidate !== toolMeta.originalName)?.replace(/-/g, "_");
  if (legacyEmittedName) legacyCandidates.add(legacyEmittedName);
  for (const candidate of currentCandidates) legacyCandidates.delete(candidate);
  const otherCurrentCandidates = /* @__PURE__ */ new Set();
  for (const [name, metadata] of toolMetadata) {
    const otherPrefix = resolveToolPrefix(config.mcpServers[name], config.settings?.toolPrefix);
    for (const tool of metadata) {
      for (const candidate of getToolNameCandidates(tool.originalName, name, otherPrefix, false)) {
        otherCurrentCandidates.add(candidate);
      }
    }
  }
  for (const candidate of currentCandidates) otherCurrentCandidates.delete(candidate);
  return approval.some(
    (pattern) => matchesToolPattern(legacyCandidates, [pattern]) && !matchesToolPattern(otherCurrentCandidates, [pattern])
  );
}
function isMcpToolApprovalDecision(value) {
  return value === "allow_once" || value === "allow_for_session" || value === "deny" || value === "abstain";
}
async function requestBrokerApproval(state, serverName, toolMeta, args, origin, signal) {
  if (!state.approvalEvents) return "abstain";
  let acceptingClaim = true;
  let handler;
  const request = {
    requestId: randomUUID(),
    serverName,
    originalToolName: toolMeta.originalName,
    prefixedToolName: toolMeta.name,
    args: args ?? {},
    origin,
    ...signal !== void 0 ? { signal } : {},
    claim(candidate) {
      if (!acceptingClaim || handler) return false;
      handler = candidate;
      return true;
    }
  };
  state.approvalEvents.emit(MCP_TOOL_APPROVAL_REQUEST_EVENT, request);
  acceptingClaim = false;
  if (!handler) return "abstain";
  try {
    const decision = await abortable(Promise.resolve().then(handler), signal);
    return isMcpToolApprovalDecision(decision) ? decision : "deny";
  } catch (error) {
    if (signal?.aborted) throw error;
    return "deny";
  }
}
async function ensureToolCallApproved(state, serverName, toolMeta, args, signal, origin = toolMeta.resourceUri ? "resource" : "proxy", approvalMetadata) {
  const argsHash = createHash("sha256").update(stableStringify(args ?? {})).digest("hex");
  const cacheKey = `${serverName}\0${toolMeta.originalName}\0${argsHash}`;
  const approvedToolCalls = state.approvedToolCalls ??= /* @__PURE__ */ new Map();
  if (approvedToolCalls.has(cacheKey)) {
    return { ok: true };
  }
  const brokerDecision = await requestBrokerApproval(state, serverName, toolMeta, args, origin, signal);
  if (brokerDecision === "allow_once") return { ok: true };
  if (brokerDecision === "allow_for_session") {
    approvedToolCalls.set(cacheKey, true);
    return { ok: true };
  }
  if (brokerDecision === "deny") return { ok: false, reason: "denied" };
  if (!isToolCallApprovalRequired(state.config, serverName, toolMeta, approvalMetadata ?? state.toolMetadata)) {
    return { ok: true };
  }
  if (!state.ui) {
    return { ok: false, reason: "approval_required_headless" };
  }
  const json = JSON.stringify(args ?? {}, null, 2);
  const sanitized = sanitizeTerminalText(json);
  const preview = sanitized.length > 500 ? `${sanitized.slice(0, 500)}...` : sanitized;
  const title = `MCP: ${sanitizeTerminalText(serverName)} wants to run ${sanitizeTerminalText(toolMeta.originalName)}`;
  const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
  const decision = await abortable(
    state.ui.select(
      `${title}

Arguments:
${preview}`,
      ["Allow once", "Allow for session", "Deny"]
    ),
    ownedSignal
  );
  if (decision === "Allow once") {
    return { ok: true };
  }
  if (decision === "Allow for session") {
    approvedToolCalls.set(cacheKey, true);
    return { ok: true };
  }
  return { ok: false, reason: "denied" };
}

// src/ui/session.ts
import { execFile } from "node:child_process";
import { randomUUID as randomUUID3 } from "node:crypto";
import net from "node:net";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/client";

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

// src/ui/server.ts
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
import { ContentBlockSchema } from "@modelcontextprotocol/core";

// src/ui/host-html-template.ts
var DEFAULT_APP_BRIDGE_MODULE_URL = "/app-bridge.bundle.js";
var APP_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups allow-downloads";
function buildHostHtmlTemplate(input) {
  const hostContext = input.hostContext ?? {};
  const sessionToken = safeInlineJSON(input.sessionToken);
  const uiResourceToken = safeInlineJSON(input.uiResourceToken);
  const toolArgs = safeInlineJSON(input.toolArgs);
  const serverName = safeInlineJSON(input.serverName);
  const toolName = safeInlineJSON(input.toolName);
  const hostContextJson = safeInlineJSON(hostContext);
  const allowAttribute = safeInlineJSON(input.allowAttribute);
  const requireToolConsent = safeInlineJSON(input.requireToolConsent);
  const cacheToolConsent = safeInlineJSON(input.cacheToolConsent);
  const moduleUrl = safeInlineJSON(input.appBridgeModuleUrl ?? DEFAULT_APP_BRIDGE_MODULE_URL);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MCP UI - ${escapeHtml(input.serverName)} / ${escapeHtml(input.toolName)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0f1115;
      --surface: #181c22;
      --text: #ecf0f5;
      --muted: #a9b2bf;
      --accent: #43c0ff;
      --border: rgba(255, 255, 255, 0.12);
      --good: #34d399;
      --warn: #fbbf24;
      --bad: #f87171;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f6f7fb;
        --surface: #ffffff;
        --text: #1d2939;
        --muted: #667085;
        --accent: #0ea5e9;
        --border: rgba(15, 23, 42, 0.14);
        --good: #059669;
        --warn: #b45309;
        --bad: #b91c1c;
      }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    body { display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; }
    header { background: var(--surface); border-bottom: 1px solid var(--border); padding: calc(10px + env(safe-area-inset-top, 0px)) calc(14px + env(safe-area-inset-right, 0px)) 10px calc(14px + env(safe-area-inset-left, 0px)); display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .title { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
    .server { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; }
    .tool { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; font-size: 11px; color: var(--muted); white-space: nowrap; }
    .controls { display: flex; gap: 8px; align-items: center; }
    .status { font-size: 12px; color: var(--muted); white-space: nowrap; }
    button { border: 1px solid var(--border); background: transparent; color: var(--text); border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
    button.primary { border-color: color-mix(in srgb, var(--good) 40%, var(--border) 60%); color: var(--good); }
    button.danger { border-color: color-mix(in srgb, var(--bad) 40%, var(--border) 60%); color: var(--bad); }
    button:hover { background: color-mix(in srgb, var(--surface) 75%, var(--accent) 25%); }
    main { flex: 1; min-height: 0; padding: 10px; padding-inline: calc(10px + env(safe-area-inset-left, 0px)) calc(10px + env(safe-area-inset-right, 0px)); padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); display: flex; }
    iframe { width: 100%; height: 100%; border: 1px solid var(--border); border-radius: 10px; background: white; }
    .overlay { position: fixed; inset: 0; background: color-mix(in srgb, var(--bg) 90%, black 10%); display: none; align-items: center; justify-content: center; z-index: 2; padding: 16px; }
    .overlay.visible { display: flex; }
    .panel { width: min(680px, calc(100vw - 40px)); background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
    .panel h2 { margin: 0 0 8px; font-size: 16px; }
    .panel p { margin: 0; color: var(--muted); line-height: 1.4; font-size: 14px; white-space: pre-wrap; }
    @media (max-width: 640px) {
      header { align-items: stretch; flex-direction: column; gap: 8px; }
      .title { flex-wrap: wrap; row-gap: 4px; }
      .server { flex-basis: 100%; }
      .controls { width: 100%; }
      .status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      button { min-height: 44px; padding: 10px 14px; }
      main { padding: 6px; padding-inline: calc(6px + env(safe-area-inset-left, 0px)) calc(6px + env(safe-area-inset-right, 0px)); padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px)); }
      iframe { border-radius: 6px; }
      .panel { width: 100%; }
    }
  </style>
</head>
<body>
  <header>
    <div class="title">
      <span class="server">MCP \xB7 <span id="server-name"></span></span>
      <span class="tool" id="tool-name"></span>
      <span class="badge">Sandboxed</span>
    </div>
    <div class="controls">
      <span class="status" id="status">Loading UI...</span>
      <button class="primary" id="done-btn" title="Cmd/Ctrl+Enter">Done</button>
      <button class="danger" id="cancel-btn" title="Escape">Cancel</button>
    </div>
  </header>
  <main>
    <iframe id="mcp-app" sandbox="${APP_SANDBOX}" referrerpolicy="no-referrer"></iframe>
  </main>
  <div class="overlay" id="error-overlay">
    <div class="panel">
      <h2>UI Error</h2>
      <p id="error-message"></p>
    </div>
  </div>
  <div class="overlay" id="completion-overlay">
    <div class="panel">
      <h2>Done</h2>
      <p>MCP UI session finished. You can close this page and return to Pi.</p>
    </div>
  </div>
  <script type="module">
    import { AppBridge, PostMessageTransport } from ${moduleUrl};

    const SESSION_TOKEN = ${sessionToken};
    const UI_RESOURCE_TOKEN = ${uiResourceToken};
    const SERVER_NAME = ${serverName};
    const TOOL_NAME = ${toolName};
    const TOOL_ARGS = ${toolArgs};
    const HOST_CONTEXT = ${hostContextJson};
    const ALLOW_ATTRIBUTE = ${allowAttribute};
    const REQUIRE_TOOL_CONSENT = ${requireToolConsent};
    const CACHE_TOOL_CONSENT = ${cacheToolConsent};
    const STREAM_CONTEXT_KEY = "pi-mcp-adapter/stream";
    const STREAM_PATCH_METHOD = "notifications/pi-mcp-adapter/ui-result-patch";

    const iframe = document.getElementById("mcp-app");
    const statusNode = document.getElementById("status");
    const doneBtn = document.getElementById("done-btn");
    const cancelBtn = document.getElementById("cancel-btn");
    const errorOverlay = document.getElementById("error-overlay");
    const completionOverlay = document.getElementById("completion-overlay");
    const errorMessage = document.getElementById("error-message");

    document.getElementById("server-name").textContent = SERVER_NAME;
    document.getElementById("tool-name").textContent = TOOL_NAME;

    const setStatus = (text, isError = false) => {
      statusNode.textContent = text;
      statusNode.style.color = isError ? "var(--bad)" : "var(--muted)";
    };

    const showError = (message) => {
      errorMessage.textContent = message;
      errorOverlay.classList.add("visible");
      setStatus("Error", true);
    };

    let completionPending = false;
    const showCompletion = () => {
      completionOverlay.classList.add("visible");
      setStatus("Complete");
    };
    const closeOrShowDone = () => {
      completionPending = true;
      window.close();
      setTimeout(() => {
        if (!document.hidden) {
          showCompletion();
        }
      }, 1000);
    };
    document.addEventListener("visibilitychange", () => {
      if (completionPending && !document.hidden) {
        showCompletion();
      }
    });

    const post = async (endpoint, params) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: SESSION_TOKEN, params }),
      });

      const body = await response.json().catch(() => ({ ok: false, error: "Invalid JSON response" }));
      if (!response.ok || !body.ok) {
        const message = body.error || ("HTTP " + response.status);
        throw new Error(message);
      }
      return body.result ?? {};
    };

    let consentGranted = !REQUIRE_TOOL_CONSENT;
    const initialStreamContext = HOST_CONTEXT?.[STREAM_CONTEXT_KEY];
    const streamMode = initialStreamContext?.mode === "stream-first" ? "stream-first" : "eager";

    const bridge = new AppBridge(
      null,
      { name: "pi", version: "1.0.0" },
      { serverTools: {}, openLinks: {}, logging: {}, updateModelContext: {}, message: {} },
      { hostContext: HOST_CONTEXT }
    );

    bridge.oncalltool = async (params) => {
      if (!consentGranted) {
        const accepted = window.confirm("Allow this UI to call server tools for this session?");
        if (!accepted) {
          await post("/proxy/ui/consent", { approved: false }).catch(() => {});
          return {
            isError: true,
            content: [{ type: "text", text: "Tool call denied by user." }],
          };
        }
        await post("/proxy/ui/consent", { approved: true });
        if (CACHE_TOOL_CONSENT) {
          consentGranted = true;
        }
      }
      const result = await post("/proxy/tools/call", params);
      // Notify agent about the tool call
      await post("/proxy/ui/generated-tool-call-intent", {
        tool: params.name,
        arguments: params.arguments,
        isError: result.isError
      }).catch(() => {});
      return result;
    };

    bridge.onmessage = async (params) => post("/proxy/ui/message", params);
    bridge.onupdatemodelcontext = async (params) => post("/proxy/ui/context", params);

    // Also listen for raw postMessage events with custom types (notify, prompt, intent, etc.)
    // These bypass the AppBridge protocol but are used by some MCP UI implementations
    window.addEventListener("message", async (event) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      // Skip AppBridge protocol messages (handled by bridge)
      if (data.jsonrpc || (typeof data.method === "string" && (data.method.startsWith("app/") || data.method.startsWith("host/")))) return;

      // Handle raw UI action messages
      const msgType = data.type;
      if (typeof msgType !== "string") return;

      if (msgType === "notify" || msgType === "prompt" || msgType === "intent" || msgType === "message") {
        // Standard MCP-UI types - preserve their semantics
        // Support both { type, payload: {...} } and { type, field: value } formats
        const { type: _, payload, ...directFields } = data;
        await post("/proxy/ui/message", { type: msgType, ...directFields, ...(payload || {}) }).catch(() => {});
      } else if (!msgType.startsWith("ui-lifecycle-") && !msgType.startsWith("ui-message-")) {
        // Any other custom type - forward as intent with type as intent name
        // (Skip internal lifecycle/ack messages)
        const payload = data.payload || {};
        await post("/proxy/ui/message", {
          type: "intent",
          intent: msgType,
          params: payload,
        }).catch(() => {});
      }
    });
    bridge.ondownloadfile = async (params) => post("/proxy/ui/download-file", params);
    bridge.onrequestdisplaymode = async (params) => post("/proxy/ui/request-display-mode", params);
    bridge.onopenlink = async (params) => {
      const result = await post("/proxy/ui/open-link", params);
      if (!result.isError) {
        window.open(params.url, "_blank", "noopener,noreferrer");
        // Notify agent about the link open
        await post("/proxy/ui/message", {
          type: "intent",
          intent: "open_link",
          params: { url: params.url }
        }).catch(() => {});
      }
      return result;
    };

    bridge.oninitialized = () => {
      if (streamMode !== "stream-first") {
        bridge.sendToolInput({ arguments: TOOL_ARGS });
      }
      setStatus(streamMode === "stream-first" ? "Streaming\u2026" : "Connected");
    };

    bridge.onsizechange = ({ width, height }) => {
      if (typeof width === "number" && width > 0) {
        iframe.style.minWidth = Math.min(width, window.innerWidth - 24) + "px";
      }
      if (typeof height === "number" && height > 0) {
        iframe.style.height = Math.max(height, 320) + "px";
      }
    };

    if (ALLOW_ATTRIBUTE) {
      iframe.setAttribute("allow", ALLOW_ATTRIBUTE);
    }

    // Connect bridge BEFORE loading iframe to ensure we're listening when the app sends ui/initialize
    try {
      const transport = new PostMessageTransport(iframe.contentWindow, iframe.contentWindow);
      await bridge.connect(transport);
    } catch (error) {
      console.error("[host] Bridge connection failed:", error);
      showError("Failed to initialize AppBridge: " + String(error));
    }

    const iframeLoaded = new Promise((resolve) => {
      iframe.onload = resolve;
    });
    iframe.src = "/ui-app?resource=" + encodeURIComponent(UI_RESOURCE_TOKEN);
    await iframeLoaded;

    const eventSource = new EventSource("/events?session=" + encodeURIComponent(SESSION_TOKEN));
    eventSource.addEventListener("tool-input", (event) => {
      try {
        bridge.sendToolInput(JSON.parse(event.data));
      } catch (error) {
        showError("Failed to forward tool input: " + String(error));
      }
    });
    eventSource.addEventListener("tool-result", (event) => {
      try {
        bridge.sendToolResult(JSON.parse(event.data));
      } catch (error) {
        showError("Failed to forward tool result: " + String(error));
      }
    });
    eventSource.addEventListener("tool-cancelled", (event) => {
      try {
        bridge.sendToolCancelled(JSON.parse(event.data));
      } catch (error) {
        showError("Failed to forward cancellation: " + String(error));
      }
    });
    eventSource.addEventListener("result-patch", async (event) => {
      try {
        await bridge.notification({
          method: STREAM_PATCH_METHOD,
          params: JSON.parse(event.data),
        });
      } catch (error) {
        showError("Failed to forward stream patch: " + String(error));
      }
    });
    eventSource.addEventListener("host-context", (event) => {
      try {
        bridge.setHostContext(JSON.parse(event.data));
      } catch {}
    });
    eventSource.addEventListener("session-complete", async () => {
      await bridge.teardownResource({}).catch(() => {});
      eventSource.close();
      closeOrShowDone();
    });
    eventSource.onerror = () => {
      setStatus("Connection lost", true);
    };

    const heartbeat = setInterval(() => {
      post("/proxy/ui/heartbeat", {}).catch(() => {});
    }, 10000);

    const complete = async (reason) => {
      try {
        await post("/proxy/ui/complete", { reason });
      } catch {}
      try {
        await bridge.teardownResource({});
      } catch {}
      clearInterval(heartbeat);
      eventSource.close();
      closeOrShowDone();
    };

    doneBtn.addEventListener("click", () => complete("done"));
    cancelBtn.addEventListener("click", () => complete("cancel"));
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        complete("cancel");
      } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        complete("done");
      }
    });
  </script>
</body>
</html>`;
}
function buildCspMetaContent(csp) {
  const resourceDomains = sanitizeCspDomains(csp?.resourceDomains);
  const connectDomains = sanitizeCspDomains(csp?.connectDomains);
  const frameDomains = sanitizeCspDomains(csp?.frameDomains);
  const baseUriDomains = sanitizeCspDomains(csp?.baseUriDomains);
  return [
    "default-src 'none'",
    `sandbox ${APP_SANDBOX}`,
    toDirective("script-src", ["'self'", "'unsafe-inline'"], resourceDomains),
    toDirective("style-src", ["'self'", "'unsafe-inline'"], resourceDomains),
    toDirective("font-src", ["'self'"], resourceDomains),
    toDirective("img-src", ["'self'", "data:"], resourceDomains),
    toDirective("media-src", ["'self'", "data:"], resourceDomains),
    connectDomains.length > 0 ? `connect-src ${connectDomains.join(" ")}` : "connect-src 'none'",
    frameDomains.length > 0 ? `frame-src ${frameDomains.join(" ")}` : "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    baseUriDomains.length > 0 ? `base-uri ${baseUriDomains.join(" ")}` : "base-uri 'self'"
  ].join("; ");
}
function toDirective(name, trustedSources, domains) {
  return `${name} ${[.../* @__PURE__ */ new Set([...trustedSources, ...domains])].join(" ")}`;
}
function sanitizeCspDomains(domains) {
  if (!Array.isArray(domains)) return [];
  return [...new Set(domains.filter(
    (domain) => typeof domain === "string" && domain.length > 0 && // HTTP headers must be printable ASCII; rejecting all other code points also
    // excludes every C0/C1 control character before Node serializes the policy.
    /^[\x21-\x7E]+$/.test(domain) && !/[;'"]/.test(domain)
  ))];
}
function safeInlineJSON(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// src/ui/server.ts
var MAX_BODY_SIZE = 2 * 1024 * 1024;
var ABANDONED_GRACE_MS = 6e4;
var WATCHDOG_INTERVAL_MS = 5e3;
var MAX_EVENT_LOG = 128;
var MAX_CONTEXT_UPDATES = 20;
var MOSHI_DISCOVERY_PORT_START = 8377;
var MOSHI_DISCOVERY_PORT_END = 8396;
var nextMoshiDiscoveryPort = MOSHI_DISCOVERY_PORT_START;
async function startUiServer(options) {
  const sessionToken = options.sessionToken ?? randomUUID2();
  const uiResourceToken = randomUUID2();
  const log = logger.child({
    component: "UiServer",
    server: options.serverName,
    tool: options.toolName,
    session: sessionToken.slice(0, 8)
  });
  log.debug("Starting UI server");
  const sseClients = /* @__PURE__ */ new Set();
  let completed = false;
  let lastHeartbeatAt = Date.now();
  let watchdog = null;
  let currentDisplayMode = options.hostContext?.displayMode ?? "inline";
  let nextEventId = 1;
  const eventLog = [];
  let latestCheckpointEventId;
  let streamSummary;
  const sessionMessages = {
    prompts: [],
    notifications: [],
    intents: [],
    contexts: []
  };
  const hostContext = {
    displayMode: currentDisplayMode,
    availableDisplayModes: ["inline", "fullscreen", "pip"],
    platform: "desktop",
    ...options.hostContext
    // Only include toolInfo if caller provides full tool definition with inputSchema
    // The App validates toolInfo.tool.inputSchema as required object
  };
  const initialStreamContext = hostContext["pi-mcp-adapter/stream"];
  if (initialStreamContext && typeof initialStreamContext === "object") {
    const streamId = initialStreamContext.streamId;
    const mode = initialStreamContext.mode;
    if (typeof streamId === "string" && (mode === "eager" || mode === "stream-first")) {
      streamSummary = {
        streamId,
        mode,
        frames: 0,
        phases: []
      };
    }
  }
  const isAppOnlyTool = (toolName) => {
    const toolDefinition = options.manager.getConnection(options.serverName)?.tools?.find((tool) => tool.name === toolName);
    if (!toolDefinition) return false;
    const visibility = extractUiToolVisibility(toolDefinition._meta);
    return isUiToolCallableByApp(visibility) && !isUiToolVisibleToModel(visibility);
  };
  const recordUiMessage = async (msgParams) => {
    const promptText = extractUiPromptText(msgParams);
    if (promptText) {
      sessionMessages.prompts.push(promptText);
      log.debug("UI prompt received", { prompt: promptText.slice(0, 100) });
    } else if (msgParams.type === "intent" || msgParams.intent) {
      const intentName = msgParams.intent ?? "";
      if (intentName) {
        sessionMessages.intents.push({
          intent: intentName,
          ...msgParams.params !== void 0 ? { params: msgParams.params } : {}
        });
        log.debug("UI intent received", { intent: intentName });
      }
    } else if (msgParams.type === "notify" || msgParams.message) {
      const notifyText = msgParams.message ?? "";
      if (notifyText) {
        sessionMessages.notifications.push(notifyText);
        log.debug("UI notification", { message: notifyText.slice(0, 100) });
      }
    }
    await options.onMessage?.(msgParams);
  };
  const touchHeartbeat = () => {
    lastHeartbeatAt = Date.now();
  };
  const updateStreamSummary = (eventId, payload) => {
    const envelope = getVisualizationStreamEnvelope(payload?.structuredContent);
    if (!envelope) return;
    if (envelope.frameType === "checkpoint" || envelope.frameType === "final") {
      latestCheckpointEventId = eventId;
    }
    if (!streamSummary) {
      streamSummary = {
        streamId: envelope.streamId,
        mode: "eager",
        frames: 0,
        phases: []
      };
    }
    streamSummary.frames += 1;
    if (!streamSummary.phases.includes(envelope.phase)) {
      streamSummary.phases.push(envelope.phase);
    }
    streamSummary.finalStatus = envelope.status;
    if (envelope.message !== void 0) streamSummary.lastMessage = envelope.message;
    else delete streamSummary.lastMessage;
  };
  const serializeEvent = (eventId, name, payload) => {
    return `id: ${eventId}
event: ${name}
data: ${JSON.stringify(payload)}

`;
  };
  const getLatestCheckpointIndex = () => {
    const firstEventId = eventLog[0]?.id;
    if (latestCheckpointEventId === void 0 || firstEventId === void 0 || latestCheckpointEventId < firstEventId) return -1;
    return latestCheckpointEventId - firstEventId;
  };
  const pruneEventLog = () => {
    if (eventLog.length <= MAX_EVENT_LOG) return;
    const latestCheckpointIndex = getLatestCheckpointIndex();
    if (latestCheckpointIndex > 0) {
      eventLog.splice(0, latestCheckpointIndex);
    }
    if (eventLog.length > MAX_EVENT_LOG) {
      eventLog.splice(0, eventLog.length - MAX_EVENT_LOG);
    }
  };
  const pushEvent = (name, payload) => {
    if (completed) return;
    const eventId = nextEventId++;
    eventLog.push({ id: eventId, name, payload });
    updateStreamSummary(eventId, payload);
    pruneEventLog();
    const chunk = serializeEvent(eventId, name, payload);
    for (const client of sseClients) {
      try {
        client.write(chunk);
      } catch {
        sseClients.delete(client);
      }
    }
  };
  const replayEvents = (res, lastEventIdHeader) => {
    const parsedLastId = lastEventIdHeader ? Number(lastEventIdHeader) : Number.NaN;
    const eventsToReplay = Number.isFinite(parsedLastId) ? eventLog.filter((entry) => entry.id > parsedLastId) : (() => {
      const latestCheckpointIndex = getLatestCheckpointIndex();
      return latestCheckpointIndex >= 0 ? eventLog.slice(latestCheckpointIndex) : eventLog;
    })();
    for (const entry of eventsToReplay) {
      try {
        res.write(serializeEvent(entry.id, entry.name, entry.payload));
      } catch {
        sseClients.delete(res);
        return;
      }
    }
  };
  const closeSse = () => {
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
      }
    }
    sseClients.clear();
  };
  const stopWatchdog = () => {
    if (!watchdog) return;
    clearInterval(watchdog);
    watchdog = null;
  };
  const markCompleted = (reason) => {
    if (completed) return;
    log.debug("Session completed", { reason });
    pushEvent("session-complete", { reason });
    completed = true;
    stopWatchdog();
    options.onComplete?.(reason);
  };
  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method || "GET";
      const hostHeader = req.headers.host;
      const url = new URL(req.url || "/", `http://${hostHeader || "127.0.0.1"}`);
      if (hostHeader !== void 0 && !isAllowedHost(url.hostname)) {
        sendText(res, 403, "Invalid host");
        return;
      }
      if (method === "HEAD" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end();
        return;
      }
      if (method === "GET" && url.pathname === "/") {
        if (!url.searchParams.has("session")) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          res.end(
            '<!doctype html><html><head><meta charset="utf-8"><title>MCP UI</title></head><body><p>Open the authenticated MCP UI URL shown by Pi.</p></body></html>'
          );
          return;
        }
        if (!validateTokenQuery(url, sessionToken, res)) return;
        touchHeartbeat();
        const html = buildHostHtmlTemplate({
          sessionToken,
          uiResourceToken,
          serverName: options.serverName,
          toolName: options.toolName,
          toolArgs: options.toolArgs,
          resource: options.resource,
          allowAttribute: buildAllowAttribute(options.resource.meta.permissions),
          requireToolConsent: options.consentManager.requiresPrompt(options.serverName),
          cacheToolConsent: options.consentManager.shouldCacheConsent(),
          hostContext
        });
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        });
        res.end(html);
        return;
      }
      if (method === "GET" && url.pathname === "/events") {
        if (!validateTokenQuery(url, sessionToken, res)) return;
        touchHeartbeat();
        log.debug("SSE client connected", { clientCount: sseClients.size + 1 });
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });
        res.write(": connected\n\n");
        sseClients.add(res);
        replayEvents(res, req.headers["last-event-id"] ? String(req.headers["last-event-id"]) : null);
        req.on("close", () => {
          sseClients.delete(res);
        });
        return;
      }
      if (method === "GET" && url.pathname === "/health") {
        if (!validateTokenQuery(url, sessionToken, res)) return;
        sendJson(res, 200, { ok: true, result: { healthy: true } });
        return;
      }
      if (method === "GET" && url.pathname === "/ui-app") {
        if (!validateTokenQuery(url, uiResourceToken, res, "resource")) return;
        touchHeartbeat();
        const cspContent = buildCspMetaContent(options.resource.meta.csp);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": cspContent
        });
        res.end(options.resource.html);
        return;
      }
      if (method === "GET" && url.pathname === "/app-bridge.bundle.js") {
        const bundlePath = path.join(import.meta.dirname, "app-bridge.bundle.js");
        try {
          const content = await fs.readFile(bundlePath, "utf-8");
          res.writeHead(200, {
            "Content-Type": "application/javascript",
            "Cache-Control": "public, max-age=31536000"
          });
          res.end(content);
        } catch {
          sendJson(res, 500, { ok: false, error: "Bundle not found" });
        }
        return;
      }
      if (method !== "POST") {
        sendJson(res, 404, { ok: false, error: "Not found" });
        return;
      }
      const body = await parseBody(req, res);
      if (!body) return;
      if (!validateTokenBody(body, sessionToken, res)) return;
      const params = body.params ?? {};
      touchHeartbeat();
      if (url.pathname === "/proxy/tools/call") {
        options.consentManager.ensureApproved(options.serverName);
        const callParams = params;
        if (!callParams || typeof callParams.name !== "string" || !callParams.name.trim()) {
          sendJson(res, 400, { ok: false, error: "Invalid tools/call params" });
          return;
        }
        const connection = options.manager.getConnection(options.serverName);
        if (!connection || connection.status !== "connected") {
          sendJson(res, 503, { ok: false, error: `Server "${options.serverName}" is not connected` });
          return;
        }
        if (isServerDisabled(options.config?.mcpServers[options.serverName]) || isServerDisabled(connection.definition)) {
          sendJson(res, 503, { ok: false, error: `Server "${options.serverName}" is disabled` });
          return;
        }
        const toolDefinitions = Array.isArray(connection.tools) ? connection.tools : [];
        const toolDefinition = toolDefinitions.find((tool) => tool.name === callParams.name);
        if (!toolDefinition) {
          sendJson(res, 403, { ok: false, error: `MCP tool "${callParams.name}" is not callable by apps` });
          return;
        }
        const uiVisibility = extractUiToolVisibility(toolDefinition._meta);
        if (!isUiToolCallableByApp(uiVisibility)) {
          sendJson(res, 403, { ok: false, error: `MCP tool "${callParams.name}" is not callable by apps` });
          return;
        }
        let normalizedArguments;
        try {
          normalizedArguments = normalizeToolArguments(callParams.arguments, `tool "${callParams.name}" arguments`);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
          return;
        }
        const callArgs = {
          name: callParams.name,
          arguments: normalizedArguments
        };
        const toolMeta = {
          name: callParams.name,
          originalName: callParams.name,
          description: toolDefinition?.description ?? "",
          ...toolDefinition?.inputSchema !== void 0 ? { inputSchema: toolDefinition.inputSchema } : {},
          ...uiVisibility !== void 0 ? { uiVisibility } : {}
        };
        const approvalMetadata = new Map(options.state?.toolMetadata);
        const definition = options.config?.mcpServers[options.serverName] ?? options.state?.config.mcpServers[options.serverName];
        approvalMetadata.set(options.serverName, [
          ...connection.tools.map((tool) => ({
            name: tool.name,
            originalName: tool.name,
            description: tool.description ?? ""
          })),
          ...definition?.exposeResources !== false ? (connection.resources ?? []).map((resource) => {
            const originalName = `read_${resourceNameToToolName(resource.name)}`;
            return {
              name: originalName,
              originalName,
              description: resource.description ?? `Read resource: ${resource.uri}`
            };
          }) : []
        ]);
        const approval = options.state ? await ensureToolCallApproved(
          options.state,
          options.serverName,
          toolMeta,
          callArgs.arguments,
          options.state.owner?.signal,
          "iframe",
          approvalMetadata
        ) : options.config && isToolCallApprovalRequired(options.config, options.serverName, toolMeta, approvalMetadata) ? { ok: false, reason: "approval_required_headless" } : { ok: true };
        if (approval.ok === false) {
          const denied = approval.reason === "denied";
          const message = denied ? `The user declined approval to run MCP tool "${callParams.name}" on server "${options.serverName}".` : `MCP tool "${callParams.name}" on server "${options.serverName}" is approval-gated and requires an interactive session.`;
          sendJson(res, 200, {
            ok: true,
            result: {
              content: [{ type: "text", text: message }],
              details: {
                error: denied ? "approval_denied" : "approval_required",
                server: options.serverName,
                tool: callParams.name
              }
            }
          });
          return;
        }
        try {
          options.manager.touch(options.serverName);
          options.manager.incrementInFlight(options.serverName);
          const result = options.config ? await withSessionRecovery(
            {
              manager: options.manager,
              config: options.config,
              ...options.onNeedsAuth ? { onNeedsAuth: options.onNeedsAuth } : {}
            },
            options.serverName,
            (conn) => conn.client.callTool(callArgs, options.manager.getRequestOptions?.(options.serverName))
          ) : await connection.client.callTool(callArgs, options.manager.getRequestOptions?.(options.serverName));
          sendJson(res, 200, { ok: true, result });
        } finally {
          options.manager.decrementInFlight(options.serverName);
          options.manager.touch(options.serverName);
        }
        return;
      }
      if (url.pathname === "/proxy/ui/consent") {
        const approved = !!params.approved;
        options.consentManager.registerDecision(options.serverName, approved);
        sendJson(res, 200, { ok: true, result: { approved } });
        return;
      }
      if (url.pathname === "/proxy/ui/generated-tool-call-intent") {
        const tool = typeof params.tool === "string" ? params.tool : void 0;
        if (tool && isAppOnlyTool(tool)) {
          log.debug("Ignored generated app-only tool call intent", { tool });
        } else {
          await recordUiMessage({
            type: "intent",
            intent: "call_tool",
            params: {
              ...tool !== void 0 ? { tool } : {},
              ...params.arguments !== void 0 ? { arguments: params.arguments } : {},
              ...params.isError !== void 0 ? { isError: params.isError } : {}
            }
          });
        }
        sendJson(res, 200, { ok: true, result: {} });
        return;
      }
      if (url.pathname === "/proxy/ui/message") {
        await recordUiMessage(params);
        sendJson(res, 200, { ok: true, result: {} });
        return;
      }
      if (url.pathname === "/proxy/ui/context") {
        const content = params.content;
        const structuredContent = params.structuredContent;
        if (content !== void 0 && (!Array.isArray(content) || content.some((block) => !ContentBlockSchema.safeParse(block).success)) || structuredContent !== void 0 && (!structuredContent || typeof structuredContent !== "object" || Array.isArray(structuredContent))) {
          sendJson(res, 400, { ok: false, error: "Invalid update-model-context params" });
          return;
        }
        const ctxParams = {
          ...content !== void 0 ? { content } : {},
          ...structuredContent !== void 0 ? { structuredContent } : {}
        };
        const update = createUiModelContextUpdate(ctxParams);
        if (update) {
          sessionMessages.contexts.push(update);
          while (sessionMessages.contexts.length > MAX_CONTEXT_UPDATES) {
            sessionMessages.contexts.shift();
          }
        }
        log.debug("UI context update", { hasContent: !!ctxParams.content, hasUpdate: !!update });
        await options.onContextUpdate?.(ctxParams);
        sendJson(res, 200, { ok: true, result: {} });
        return;
      }
      if (url.pathname === "/proxy/ui/open-link") {
        const openParams = params;
        if (!openParams?.url || typeof openParams.url !== "string") {
          sendJson(res, 400, { ok: false, error: "Invalid open-link params" });
          return;
        }
        let result = {};
        try {
          new URL(openParams.url);
        } catch {
          result = { isError: true };
        }
        sendJson(res, 200, { ok: true, result });
        return;
      }
      if (url.pathname === "/proxy/ui/download-file") {
        sendJson(res, 200, { ok: true, result: { isError: true } });
        return;
      }
      if (url.pathname === "/proxy/ui/request-display-mode") {
        const displayParams = params;
        const requested = displayParams?.mode;
        const available = hostContext.availableDisplayModes ?? ["inline"];
        if (requested && available.includes(requested)) {
          currentDisplayMode = requested;
        }
        hostContext.displayMode = currentDisplayMode;
        pushEvent("host-context", { displayMode: currentDisplayMode });
        const result = { mode: currentDisplayMode };
        sendJson(res, 200, { ok: true, result });
        return;
      }
      if (url.pathname === "/proxy/ui/heartbeat") {
        sendJson(res, 200, { ok: true, result: {} });
        return;
      }
      if (url.pathname === "/proxy/ui/complete") {
        const reason = typeof params.reason === "string" ? params.reason : "done";
        markCompleted(reason);
        sendJson(res, 200, { ok: true, result: {} });
        setTimeout(() => {
          try {
            server.close();
          } catch {
          }
          closeSse();
        }, 20).unref();
        return;
      }
      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      if (error instanceof SessionRecoveryAuthRequiredError) {
        const fallback = `Server "${options.serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${options.serverName}" }) to get a browser URL, or /mcp-auth ${options.serverName} in an interactive local session.`;
        const message = error.authMessage ?? (options.config ? formatAuthRequiredMessage(options.config, options.serverName, fallback) : fallback);
        sendJson(res, 401, { ok: false, error: message });
        return;
      }
      const wrapped = wrapError(error, { server: options.serverName, tool: options.toolName });
      const status = /approval required|denied/i.test(wrapped.message) ? 403 : 500;
      if (status === 500) {
        log.error("Request handler error", error instanceof Error ? error : void 0);
      }
      sendJson(res, status, { ok: false, error: wrapped.message });
    }
  });
  if (options.initialResultPromise) {
    options.initialResultPromise.then(
      (result) => pushEvent("tool-result", result),
      (error) => {
        const reason = error instanceof Error ? error.message : String(error);
        pushEvent("tool-cancelled", { reason });
      }
    );
  }
  watchdog = setInterval(() => {
    if (completed) return;
    if (Date.now() - lastHeartbeatAt <= ABANDONED_GRACE_MS) return;
    markCompleted("stale");
    try {
      server.close();
    } catch {
    }
    closeSse();
  }, WATCHDOG_INTERVAL_MS);
  watchdog.unref();
  return new Promise((resolve, reject) => {
    const candidates = resolvePortCandidates(options.port);
    let candidateIndex = 0;
    const listen = () => {
      server.once("error", onError);
      server.listen(candidates[candidateIndex], "127.0.0.1", onListening);
    };
    const onError = (error) => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE" && candidateIndex < candidates.length - 1) {
        candidateIndex += 1;
        listen();
        return;
      }
      log.error("Failed to start server", error);
      const port = candidates[candidateIndex];
      reject(new ServerError(error.message, {
        ...port !== void 0 ? { port } : {},
        cause: error
      }));
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        const err = new ServerError("invalid address");
        log.error("Invalid server address", err);
        reject(err);
        return;
      }
      log.debug("Server started", { port: address.port });
      rememberMoshiDiscoveryPort(address.port);
      const handle = {
        url: `http://localhost:${address.port}/?session=${sessionToken}`,
        port: address.port,
        sessionToken,
        serverName: options.serverName,
        toolName: options.toolName,
        close: (reason) => {
          markCompleted(reason ?? "closed");
          try {
            server.close();
          } catch {
          }
          closeSse();
        },
        sendToolInput: (args) => {
          pushEvent("tool-input", { arguments: args });
        },
        sendToolResult: (result) => {
          pushEvent("tool-result", result);
        },
        sendResultPatch: (result) => {
          pushEvent("result-patch", result);
        },
        sendToolCancelled: (reason) => {
          pushEvent("tool-cancelled", { reason });
        },
        sendHostContext: (context) => {
          Object.assign(hostContext, context);
          pushEvent("host-context", context);
        },
        getSessionMessages: () => ({ ...sessionMessages }),
        getStreamSummary: () => streamSummary ? { ...streamSummary, phases: [...streamSummary.phases] } : void 0
      };
      resolve(handle);
    };
    listen();
  });
}
async function parseBody(req, res) {
  try {
    const body = await readBody(req);
    if (!body || typeof body !== "object") {
      sendJson(res, 400, { ok: false, error: "Invalid request body" });
      return null;
    }
    return body;
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid body" });
    return null;
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
function resolvePortCandidates(port) {
  if (port !== void 0) return [port];
  const candidates = [];
  const count = MOSHI_DISCOVERY_PORT_END - MOSHI_DISCOVERY_PORT_START + 1;
  for (let offset = 0; offset < count; offset += 1) {
    const candidate = MOSHI_DISCOVERY_PORT_START + (nextMoshiDiscoveryPort - MOSHI_DISCOVERY_PORT_START + offset) % count;
    candidates.push(candidate);
  }
  candidates.push(0);
  return candidates;
}
function rememberMoshiDiscoveryPort(port) {
  if (port < MOSHI_DISCOVERY_PORT_START || port > MOSHI_DISCOVERY_PORT_END) return;
  nextMoshiDiscoveryPort = port >= MOSHI_DISCOVERY_PORT_END ? MOSHI_DISCOVERY_PORT_START : port + 1;
}
function isAllowedHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
function validateTokenQuery(url, expected, res, parameter = "session") {
  const token = url.searchParams.get(parameter);
  if (token !== expected) {
    sendJson(res, 403, { ok: false, error: "Invalid session" });
    return false;
  }
  return true;
}
function validateTokenBody(body, expected, res) {
  if (body.token !== expected) {
    sendJson(res, 403, { ok: false, error: "Invalid session" });
    return false;
  }
  return true;
}
function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}
function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

// src/ui/glimpse.ts
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join as join2, dirname as dirname2 } from "node:path";
import { platform } from "node:os";
import { createRequire } from "node:module";
var glimpseAvailable = null;
var resolvedBinaryPath = null;
function isGlimpseAvailable() {
  if (glimpseAvailable !== null) return glimpseAvailable;
  if (platform() !== "darwin") {
    glimpseAvailable = false;
    return false;
  }
  resolvedBinaryPath = getGlimpseBinaryPath();
  glimpseAvailable = resolvedBinaryPath !== null;
  return glimpseAvailable;
}
function getGlimpseBinaryPath() {
  if (process.env.GLIMPSE_BINARY && existsSync(process.env.GLIMPSE_BINARY)) {
    return process.env.GLIMPSE_BINARY;
  }
  try {
    const require2 = createRequire(import.meta.url);
    const glimpseuiPath = require2.resolve("glimpseui");
    const binaryPath = join2(dirname2(glimpseuiPath), "glimpse");
    if (existsSync(binaryPath)) return binaryPath;
  } catch {
  }
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim();
    const binaryPath = join2(globalRoot, "glimpseui", "src", "glimpse");
    if (existsSync(binaryPath)) return binaryPath;
  } catch {
  }
  return null;
}
async function openGlimpseWindow(html, options) {
  const modulePath = resolvedBinaryPath ? join2(dirname2(resolvedBinaryPath), "glimpse.mjs") : "glimpseui";
  const glimpse = await import(modulePath);
  let active = true;
  const win = glimpse.open(html, {
    width: options.width ?? 900,
    height: options.height ?? 700,
    title: options.title
  });
  win.on("closed", () => {
    if (!active) return;
    active = false;
    options.onClosed();
  });
  return {
    close: () => {
      if (!active) return;
      active = false;
      win.close();
    }
  };
}

// src/ui/session.ts
var activeGlimpseWindow = null;
function summarizeUiSessionResult(uiSession) {
  if (!uiSession) {
    return {
      message: "Interactive UI was unavailable; returning the tool result inline.",
      uiOpen: false
    };
  }
  if (!uiSession.windowOpen) {
    const action = uiSession.reused ? "Updated the suppressed MCP UI session." : "MCP UI window was suppressed.";
    return {
      message: `${action} Open manually: ${uiSession.url}`,
      uiOpen: false,
      uiViewer: uiSession.viewer,
      uiUrl: uiSession.url
    };
  }
  return {
    message: uiSession.reused ? "Updated the open UI." : "Interactive UI is open. I'll respond to your prompts and intents as you interact with it.",
    uiOpen: true,
    uiViewer: uiSession.viewer,
    uiUrl: uiSession.url
  };
}
var MAX_COMPLETED_SESSIONS = 10;
function withStreamEnvelope(result, streamId, sequence) {
  if (!streamId) {
    return result;
  }
  const structuredContent = result.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent) ? { ...result.structuredContent } : {};
  const rawEnvelope = structuredContent[UI_STREAM_STRUCTURED_CONTENT_KEY];
  const envelope = rawEnvelope && typeof rawEnvelope === "object" && !Array.isArray(rawEnvelope) ? { ...rawEnvelope } : {
    frameType: "final",
    phase: "settled",
    status: result.isError ? "error" : "ok"
  };
  structuredContent[UI_STREAM_STRUCTURED_CONTENT_KEY] = {
    ...envelope,
    streamId,
    sequence
  };
  return {
    ...result,
    structuredContent
  };
}
async function openInBrowser(state, url, signal) {
  throwIfAborted(signal);
  try {
    await state.openBrowser(url);
    throwIfAborted(signal);
    return null;
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (state.owner?.isActive() === false) return null;
    state.ui?.notify(`MCP UI browser open failed: ${message}`, "warning");
    return message;
  }
}
function isRemoteSession() {
  return Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY);
}
function hasActiveRemoteLogin() {
  return new Promise((resolve) => {
    execFile("who", { encoding: "utf8", timeout: 2e3 }, (error, out) => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(/\(.+\)\s*$/m.test(out));
    });
  });
}
function probeMoshiGateway() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: 24543 });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}
function remoteAccessHint(opts) {
  const lines = [
    opts.openError !== null ? "Couldn't open MCP UI here. Open it from your own device:" : opts.openedOnHost ? "MCP UI opened on this host. If you're controlling this session remotely, open it from your own device:" : "This looks like a remote session - if no MCP UI appeared, open it from your own device:",
    `  ${opts.url}`
  ];
  if (opts.openError !== null) {
    lines.push(`Browser launch failed: ${opts.openError}`);
  }
  if (opts.moshi) {
    lines.push("Moshi: tap the preview button in the terminal title bar and pick this MCP UI server.");
  }
  lines.push(
    `SSH: run \`ssh -L ${opts.port}:127.0.0.1:${opts.port} <this-host>\` on your local machine, then open the URL above.`,
    "mosh can't forward ports - run that ssh command in a separate terminal."
  );
  return lines.join("\n");
}
async function maybeStartUiSession(state, request) {
  const log = logger.child({
    component: "UiSession",
    server: request.serverName,
    tool: request.toolName
  });
  const runtimeSignal = combineAbortSignals(state.owner?.signal, request.signal) ?? new AbortController().signal;
  try {
    throwIfAborted(runtimeSignal);
    if (state.uiServer && state.uiServer.serverName === request.serverName && state.uiServer.toolName === request.toolName) {
      const existingHandle = state.uiServer;
      const streamMode2 = request.streamMode;
      const streamId2 = streamMode2 ? randomUUID3() : void 0;
      const streamToken2 = streamMode2 ? randomUUID3() : void 0;
      let active2 = true;
      let nextStreamSequence2 = 0;
      const cleanupStreamListener2 = () => {
        if (streamToken2) {
          state.manager.removeUiStreamListener(streamToken2);
        }
      };
      existingHandle.sendToolInput(request.toolArgs);
      if (streamToken2) {
        state.manager.registerUiStreamListener(streamToken2, (serverName, notification) => {
          if (!active2 || state.uiServer !== existingHandle) return;
          if (serverName !== request.serverName) return;
          nextStreamSequence2 += 1;
          existingHandle.sendResultPatch(
            withStreamEnvelope(notification.result, streamId2, nextStreamSequence2)
          );
        });
      }
      return {
        serverName: request.serverName,
        toolName: request.toolName,
        reused: true,
        ...streamId2 !== void 0 ? { streamId: streamId2 } : {},
        ...streamToken2 !== void 0 ? { streamToken: streamToken2 } : {},
        ...streamMode2 !== void 0 ? { streamMode: streamMode2 } : {},
        ...streamToken2 ? { requestMeta: { [UI_STREAM_REQUEST_META_KEY]: streamToken2 } } : {},
        url: existingHandle.url,
        viewer: existingHandle.viewer ?? "browser",
        windowOpen: existingHandle.windowOpen ?? true,
        isActive: () => active2 && state.uiServer === existingHandle,
        sendToolResult: (result) => {
          if (!active2 || state.uiServer !== existingHandle) return;
          nextStreamSequence2 += 1;
          existingHandle.sendToolResult(withStreamEnvelope(result, streamId2, nextStreamSequence2));
        },
        sendResultPatch: (result) => {
          if (!active2 || state.uiServer !== existingHandle) return;
          nextStreamSequence2 += 1;
          existingHandle.sendResultPatch(withStreamEnvelope(result, streamId2, nextStreamSequence2));
        },
        sendToolCancelled: (reason) => {
          if (!active2 || state.uiServer !== existingHandle) return;
          nextStreamSequence2 += 1;
          existingHandle.sendToolResult(
            withStreamEnvelope(
              {
                isError: true,
                content: [{ type: "text", text: reason }]
              },
              streamId2,
              nextStreamSequence2
            )
          );
        },
        close: () => {
          active2 = false;
          cleanupStreamListener2();
        }
      };
    }
    const resource = await state.uiResourceHandler.readUiResource(request.serverName, request.uiResourceUri, {
      config: state.config,
      signal: runtimeSignal,
      onNeedsAuth: request.onNeedsAuth
    });
    throwIfAborted(runtimeSignal);
    if (state.uiServer) {
      state.uiServer.close("replaced");
      state.uiServer = null;
    }
    if (activeGlimpseWindow) {
      activeGlimpseWindow.close();
      activeGlimpseWindow = null;
    }
    const streamMode = request.streamMode;
    const streamId = streamMode ? randomUUID3() : void 0;
    const streamToken = streamMode ? randomUUID3() : void 0;
    const hostContext = streamMode && streamId ? {
      [UI_STREAM_HOST_CONTEXT_KEY]: {
        mode: streamMode,
        streamId,
        intermediateResultPatches: streamMode === "stream-first",
        partialInput: false
      }
    } : void 0;
    let active = true;
    let nextStreamSequence = 0;
    let handle;
    const cleanupStreamListener = () => {
      if (streamToken) {
        state.manager.removeUiStreamListener(streamToken);
      }
    };
    handle = await startUiServer({
      serverName: request.serverName,
      toolName: request.toolName,
      toolArgs: streamMode === "stream-first" ? {} : request.toolArgs,
      resource,
      manager: state.manager,
      config: state.config,
      state,
      ...request.onNeedsAuth ? { onNeedsAuth: request.onNeedsAuth } : {},
      consentManager: state.consentManager,
      ...hostContext !== void 0 ? { hostContext } : {},
      onMessage: (params) => {
        const prompt = extractUiPromptText(params);
        if (prompt) {
          if (state.sendMessage) {
            state.sendMessage(
              {
                customType: "mcp-ui-prompt",
                content: [{ type: "text", text: `User sent prompt from ${request.serverName} UI: "${prompt}"` }],
                display: `\u{1F4AC} UI Prompt: ${prompt}`,
                details: { server: request.serverName, tool: request.toolName, prompt }
              },
              { triggerTurn: true }
            );
            log.debug("Triggered agent turn for UI prompt", { prompt: prompt.slice(0, 50) });
          }
        } else if (params.type === "intent" || params.intent) {
          const intent = params.intent ?? "";
          const intentParams = params.params;
          if (intent && state.sendMessage) {
            const paramsStr = intentParams ? ` ${JSON.stringify(intentParams)}` : "";
            state.sendMessage(
              {
                customType: "mcp-ui-intent",
                content: [{ type: "text", text: `User triggered intent from ${request.serverName} UI: ${intent}${paramsStr}` }],
                display: `\u{1F3AF} UI Intent: ${intent}`,
                details: { server: request.serverName, tool: request.toolName, intent, params: intentParams }
              },
              { triggerTurn: true }
            );
            log.debug("Triggered agent turn for UI intent", { intent });
          }
        } else if (params.type === "notify" || params.message) {
          const text = params.message ?? "";
          if (text && state.ui) {
            state.ui.notify(`[${request.serverName}] ${text}`, "info");
          }
        }
      },
      onContextUpdate: (params) => {
        const update = createUiModelContextUpdate(params);
        log.debug("Model context update from UI", {
          hasContent: !!params.content,
          hasStructured: !!params.structuredContent,
          hasUpdate: !!update
        });
        if (update && state.sendMessage) {
          state.sendMessage(
            {
              customType: "mcp-ui-context",
              content: [{ type: "text", text: `User submitted model context from ${request.serverName} UI:
${update.summary}` }],
              display: "UI Context submitted",
              details: { server: request.serverName, tool: request.toolName, context: update }
            },
            { triggerTurn: true }
          );
        }
      },
      onComplete: (reason) => {
        active = false;
        cleanupStreamListener();
        if (state.uiServer === handle) {
          const messages = handle.getSessionMessages();
          const stream = handle.getStreamSummary();
          const hasContent = messages.prompts.length > 0 || messages.intents.length > 0 || messages.notifications.length > 0 || messages.contexts.length > 0 || !!stream;
          if (hasContent) {
            state.completedUiSessions.push({
              serverName: handle.serverName,
              toolName: handle.toolName,
              completedAt: /* @__PURE__ */ new Date(),
              reason,
              messages,
              ...stream !== void 0 ? { stream } : {}
            });
            while (state.completedUiSessions.length > MAX_COMPLETED_SESSIONS) {
              state.completedUiSessions.shift();
            }
            log.debug("Session completed", {
              reason,
              prompts: messages.prompts.length,
              intents: messages.intents.length,
              notifications: messages.notifications.length,
              contexts: messages.contexts.length,
              streamFrames: stream?.frames ?? 0
            });
          }
          state.uiServer = null;
          if (activeGlimpseWindow) {
            activeGlimpseWindow.close();
            activeGlimpseWindow = null;
          }
        }
      }
    });
    if (state.owner?.isActive() === false || runtimeSignal.aborted) {
      handle.close("runtime_owner_stopped");
      throwIfAborted(runtimeSignal);
      throw new Error("MCP UI session became stale before registration");
    }
    if (streamToken) {
      state.manager.registerUiStreamListener(streamToken, (serverName, notification) => {
        if (!active || state.uiServer !== handle) return;
        if (serverName !== request.serverName) return;
        nextStreamSequence += 1;
        handle.sendResultPatch(withStreamEnvelope(notification.result, streamId, nextStreamSequence));
      });
    }
    state.uiServer = handle;
    const viewerPref = process.env.MCP_UI_VIEWER?.toLowerCase();
    const uiSuppressed = viewerPref === "none" || viewerPref === "off" || viewerPref === "disabled";
    let viewer = "browser";
    let windowOpen = true;
    const remoteByEnv = isRemoteSession();
    if (uiSuppressed) {
      viewer = "suppressed";
      windowOpen = false;
      state.ui?.notify(`MCP UI window suppressed (MCP_UI_VIEWER=${viewerPref}). Open manually: ${handle.url}`, "info");
      log.info("Suppressing MCP UI window (MCP_UI_VIEWER=" + viewerPref + ")", { url: handle.url });
    } else {
      const remoteLikely = remoteByEnv || await hasActiveRemoteLogin();
      const emitRemoteHint = async (openError, openedOnHost = false) => {
        state.ui?.notify(remoteAccessHint({
          url: handle.url,
          port: handle.port,
          moshi: await probeMoshiGateway(),
          openError,
          openedOnHost
        }), openError === null ? "info" : "warning");
      };
      const glimpseDetected = !remoteByEnv && isGlimpseAvailable();
      const useGlimpse = !remoteByEnv && (viewerPref === "glimpse" || viewerPref !== "browser" && glimpseDetected);
      if (useGlimpse) {
        try {
          const glimpseHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden}iframe{width:100%;height:100%;border:none}</style></head><body><iframe src="${handle.url}"></iframe></body></html>`;
          const glimpseWindow = await openGlimpseWindow(glimpseHtml, {
            title: `MCP \xB7 ${request.serverName} \xB7 ${request.toolName}`,
            width: 1e3,
            height: 800,
            onClosed: () => {
              if (active) handle.close("glimpse-closed");
            }
          });
          if (state.owner?.isActive() === false || runtimeSignal.aborted) {
            glimpseWindow.close();
            throwIfAborted(runtimeSignal);
            throw new Error("MCP Glimpse window became stale before registration");
          }
          activeGlimpseWindow = glimpseWindow;
          viewer = "glimpse";
          if (remoteLikely) {
            await emitRemoteHint(null, true);
          }
        } catch (error) {
          log.debug("Glimpse unavailable, using browser", {
            error: error instanceof Error ? error.message : String(error)
          });
          const openError = await openInBrowser(state, handle.url, runtimeSignal);
          if (openError !== null || remoteLikely) {
            await emitRemoteHint(openError);
          }
          viewer = "browser";
        }
      } else {
        const openError = await openInBrowser(state, handle.url, runtimeSignal);
        if (openError !== null || remoteLikely) {
          await emitRemoteHint(openError);
        }
      }
    }
    throwIfAborted(runtimeSignal);
    handle.viewer = viewer;
    handle.windowOpen = windowOpen;
    return {
      serverName: request.serverName,
      toolName: request.toolName,
      reused: false,
      ...streamId !== void 0 ? { streamId } : {},
      ...streamToken !== void 0 ? { streamToken } : {},
      ...streamMode !== void 0 ? { streamMode } : {},
      ...streamToken ? { requestMeta: { [UI_STREAM_REQUEST_META_KEY]: streamToken } } : {},
      url: handle.url,
      viewer,
      windowOpen,
      isActive: () => active && state.uiServer === handle,
      sendToolResult: (result) => {
        if (!active || state.uiServer !== handle) return;
        nextStreamSequence += 1;
        handle.sendToolResult(withStreamEnvelope(result, streamId, nextStreamSequence));
      },
      sendResultPatch: (result) => {
        if (!active || state.uiServer !== handle) return;
        nextStreamSequence += 1;
        handle.sendResultPatch(withStreamEnvelope(result, streamId, nextStreamSequence));
      },
      sendToolCancelled: (reason) => {
        if (!active || state.uiServer !== handle) return;
        handle.sendToolCancelled(reason);
      },
      close: (reason) => {
        active = false;
        cleanupStreamListener();
        handle.close(reason);
      }
    };
  } catch (error) {
    if (error instanceof UrlElicitationRequiredError || isAbortError(error, runtimeSignal)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    log.error("Failed to start UI session", error instanceof Error ? error : void 0);
    state.ui?.notify(
      `MCP UI unavailable for ${request.toolName} (${request.serverName}): ${message}`,
      "warning"
    );
    return null;
  }
}

export {
  resolveMcpOutputGuardOptions,
  guardedMcpDetails,
  guardMcpOutput,
  parseUiPromptHandoff,
  isToolCallApprovalRequired,
  ensureToolCallApproved,
  summarizeUiSessionResult,
  maybeStartUiSession
};
