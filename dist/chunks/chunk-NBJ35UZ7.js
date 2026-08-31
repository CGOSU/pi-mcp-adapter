import {
  FAILURE_BACKOFF_MS,
  getFailureAgeSeconds,
  logger,
  publishMcpStatusSnapshot
} from "./chunk-3G7YTFA4.js";
import {
  McpOAuthProvider,
  abortable,
  createOAuthRuntime,
  extractOAuthConfig,
  getAuthStorageOptions,
  hasPendingAuth,
  invalidateAuthEntryCache,
  shutdownOAuth,
  supportsOAuth,
  throwIfAborted
} from "./chunk-XNQOPVY5.js";
import {
  combineAbortSignals,
  createMcpRuntimeOwner,
  createOwnedUi,
  isAbortError
} from "./chunk-CYSFURUK.js";
import {
  cloneMcpConfig,
  loadMcpConfig
} from "./chunk-AZSKIV4J.js";
import {
  RESOURCE_MIME_TYPE,
  computeServerHash,
  createCachedToolSelectorCandidateIndex,
  createLiveToolSelectorCandidateIndex,
  createMetadataCatalogSnapshot,
  createToolSelectorCandidateIndex,
  extractUiToolVisibility,
  formatToolName,
  getMetadataCachePath,
  getMissingConfiguredDirectToolServers,
  getToolNameCandidates,
  getToolUiResourceUri,
  isToolAllowed,
  isUiToolVisibleToModel,
  loadMetadataCache,
  reconstructPromptMetadata,
  reconstructToolMetadata,
  resolveToolPrefix,
  resourceNameToToolName,
  saveMetadataCache,
  serializePrompts,
  serializeResources,
  serializeTools
} from "./chunk-NBQZZ3IQ.js";
import {
  extractToolUiStreamMode,
  formatMcpStatus,
  formatTerminalError,
  interpolateEnvVars,
  isServerDisabled,
  openUrl,
  parallelLimit,
  resolveBearerToken,
  resolveCommandSecret,
  resolveCommandSecretsRecord,
  resolveConfigPath,
  resolveServerUrl,
  sanitizeTerminalText,
  truncateAtWord
} from "./chunk-Z3P2QPCB.js";
import {
  getAgentPath
} from "./chunk-ELOBWFRH.js";

// src/extension/initialization.ts
import { existsSync as existsSync2 } from "node:fs";

// src/errors.ts
var McpUiError = class extends Error {
  code;
  context;
  recoveryHint;
  cause;
  constructor(message, options) {
    super(message);
    this.name = "McpUiError";
    this.code = options.code;
    this.context = options.context ?? {};
    this.recoveryHint = options.recoveryHint;
    this.cause = options.cause;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      recoveryHint: this.recoveryHint,
      stack: this.stack
    };
  }
};
var ResourceFetchError = class extends McpUiError {
  constructor(uri, reason, options) {
    super(`Failed to fetch UI resource "${uri}": ${reason}`, {
      code: "RESOURCE_FETCH_ERROR",
      context: { uri, ...options?.server !== void 0 ? { server: options.server } : {} },
      recoveryHint: "Check that the MCP server is connected and the resource URI is valid.",
      ...options?.cause !== void 0 ? { cause: options.cause } : {}
    });
    this.name = "ResourceFetchError";
  }
};
var ResourceParseError = class extends McpUiError {
  constructor(uri, reason, options) {
    super(`Invalid UI resource "${uri}": ${reason}`, {
      code: "RESOURCE_PARSE_ERROR",
      context: {
        uri,
        ...options?.server !== void 0 ? { server: options.server } : {},
        ...options?.mimeType !== void 0 ? { mimeType: options.mimeType } : {}
      },
      recoveryHint: "Ensure the resource returns valid HTML with the correct MIME type."
    });
    this.name = "ResourceParseError";
  }
};
var ConsentError = class extends McpUiError {
  denied;
  constructor(server, options) {
    const message = options.denied ? `Tool calls for "${server}" were denied for this session` : `Tool call approval required for "${server}"`;
    super(message, {
      code: options.denied ? "CONSENT_DENIED" : "CONSENT_REQUIRED",
      context: { server },
      recoveryHint: options.denied ? "The user denied tool access. Start a new session to try again." : "Prompt the user for consent before calling tools."
    });
    this.name = "ConsentError";
    this.denied = options.denied ?? false;
  }
};
var ServerError = class extends McpUiError {
  constructor(reason, options) {
    super(`UI server error: ${reason}`, {
      code: "SERVER_ERROR",
      context: options?.port !== void 0 ? { port: options.port } : {},
      recoveryHint: "Check if the port is available. Another process may be using it.",
      ...options?.cause !== void 0 ? { cause: options.cause } : {}
    });
    this.name = "ServerError";
  }
};
function wrapError(error, context) {
  if (error instanceof McpUiError) {
    return new McpUiError(error.message, {
      code: error.code,
      context: { ...error.context, ...context },
      ...error.recoveryHint !== void 0 ? { recoveryHint: error.recoveryHint } : {},
      ...error.cause !== void 0 ? { cause: error.cause } : {}
    });
  }
  const cause = error instanceof Error ? error : void 0;
  const message = error instanceof Error ? error.message : String(error);
  return new McpUiError(message, {
    code: "UNKNOWN_ERROR",
    ...context !== void 0 ? { context } : {},
    ...cause !== void 0 ? { cause } : {}
  });
}

// src/ui/consent-manager.ts
var ConsentManager = class {
  constructor(mode = "once-per-server") {
    this.mode = mode;
    this.log.debug("Initialized", { mode });
  }
  mode;
  approvedServers = /* @__PURE__ */ new Set();
  deniedServers = /* @__PURE__ */ new Set();
  log = logger.child({ component: "ConsentManager" });
  requiresPrompt(serverName) {
    if (this.mode === "never") return false;
    if (this.deniedServers.has(serverName)) return true;
    if (this.mode === "always") return true;
    return !this.approvedServers.has(serverName);
  }
  shouldCacheConsent() {
    return this.mode !== "always";
  }
  registerDecision(serverName, approved) {
    this.deniedServers.delete(serverName);
    this.approvedServers.delete(serverName);
    if (approved) {
      this.approvedServers.add(serverName);
      this.log.debug("Consent granted", { server: serverName });
      return;
    }
    this.deniedServers.add(serverName);
    this.log.debug("Consent denied", { server: serverName });
  }
  ensureApproved(serverName) {
    if (this.mode === "never") return;
    if (this.deniedServers.has(serverName)) {
      throw new ConsentError(serverName, { denied: true });
    }
    if (!this.approvedServers.has(serverName)) {
      throw new ConsentError(serverName, { requiresApproval: true });
    }
    if (this.mode === "always") {
      this.approvedServers.delete(serverName);
    }
  }
  clear(serverName) {
    if (serverName) {
      this.approvedServers.delete(serverName);
      this.deniedServers.delete(serverName);
      this.log.debug("Cleared consent for server", { server: serverName });
      return;
    }
    this.approvedServers.clear();
    this.deniedServers.clear();
    this.log.debug("Cleared all consent records");
  }
};

// src/runtime/lifecycle.ts
import { SdkError as SdkError2, SdkErrorCode as SdkErrorCode2 } from "@modelcontextprotocol/client";

// src/runtime/server-manager.ts
import { mkdirSync as mkdirSync2 } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
  Client,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// src/runtime/unix-socket-transport.ts
import { createConnection } from "node:net";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/client";
var UnixSocketClientTransport = class {
  constructor(socketPath) {
    this.socketPath = socketPath;
  }
  socketPath;
  socket;
  readBuffer = new ReadBuffer();
  onclose;
  onerror;
  onmessage;
  async start() {
    if (this.socket) {
      throw new Error("UnixSocketClientTransport already started");
    }
    await new Promise((resolve3, reject) => {
      const socket = createConnection(this.socketPath);
      this.socket = socket;
      let connected = false;
      socket.once("connect", () => {
        connected = true;
        resolve3();
      });
      socket.on("data", (chunk) => {
        try {
          this.readBuffer.append(chunk);
          while (true) {
            const message = this.readBuffer.readMessage();
            if (message === null) break;
            this.onmessage?.(message);
          }
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));
          this.onerror?.(cause);
          void this.close();
        }
      });
      socket.on("error", (error) => {
        if (!connected) reject(error);
        this.onerror?.(error);
      });
      socket.on("close", () => {
        if (this.socket === socket) this.socket = void 0;
        this.readBuffer.clear();
        this.onclose?.();
      });
    });
  }
  async close() {
    const socket = this.socket;
    this.socket = void 0;
    this.readBuffer.clear();
    if (!socket || socket.destroyed) return;
    await new Promise((resolve3) => {
      const timeout = setTimeout(() => socket.destroy(), 2e3);
      timeout.unref();
      socket.once("close", () => {
        clearTimeout(timeout);
        resolve3();
      });
      socket.end();
    });
  }
  async send(message) {
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error("Unix socket is not connected");
    await new Promise((resolve3, reject) => {
      socket.write(serializeMessage(message), (error) => {
        if (error) reject(error);
        else resolve3();
      });
    });
  }
};

// src/runtime/mcp-probe.ts
var PROBE_TIMEOUT_MS = 5e3;
var MODERN_PROTOCOL_VERSION = "2026-07-28";
var LEGACY_PROTOCOL_VERSION = "2025-06-18";
var JSON_ACCEPT = "application/json, text/event-stream";
var SSE_ACCEPT = "text/event-stream";
var MODERN_FALLBACK_STATUSES = /* @__PURE__ */ new Set([400, 401, 404, 405, 406, 415]);
var POST_ENDPOINT_MISMATCH_STATUSES = /* @__PURE__ */ new Set([404, 405, 406, 415]);
var AMBIGUOUS_STATUSES = /* @__PURE__ */ new Set([202, 401, 503]);
var DISCOVER_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "server/discover",
  params: {}
};
var INITIALIZE_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: LEGACY_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "pi-mcp-probe", version: "2.1.2" }
  }
};
var MODERN_STRATEGY = {
  kind: "modern",
  request: {
    method: "POST",
    headers: {
      Accept: JSON_ACCEPT,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION,
      "Mcp-Method": "server/discover"
    },
    body: JSON.stringify(DISCOVER_REQUEST)
  },
  allowJson: true
};
var LEGACY_POST_STRATEGY = {
  kind: "legacy-post",
  request: {
    method: "POST",
    headers: {
      Accept: JSON_ACCEPT,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(INITIALIZE_REQUEST)
  },
  allowJson: true
};
var LEGACY_SSE_STRATEGY = {
  kind: "legacy-sse",
  request: { headers: { Accept: SSE_ACCEPT } },
  allowJson: false
};
function jsonRpcEnvelopeInfo(value) {
  if (typeof value !== "object" || value === null || value.jsonrpc !== "2.0") {
    return null;
  }
  if ("result" in value) {
    const result = value.result;
    return {
      kind: "result",
      protocolVersion: typeof result === "object" && result !== null ? result.protocolVersion : void 0
    };
  }
  if ("error" in value) return { kind: "error" };
  return null;
}
function isBearerChallenge(response) {
  return /(?:^|,)\s*Bearer\b/i.test(response.headers.get("www-authenticate") ?? "");
}
function responseKind(response) {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType === "text/html") return "HTML";
  if (contentType) return contentType;
  return "an untyped response";
}
async function getJsonRpcEnvelopeInfo(response) {
  try {
    return jsonRpcEnvelopeInfo(JSON.parse(await response.text()));
  } catch {
    return null;
  }
}
async function classifyResponse(response, strategy) {
  const isSse = response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream");
  if (response.ok && isSse) {
    return { kind: "mcp", result: { isMcp: true, classification: "endpoint responded with an MCP event stream" } };
  }
  const envelope = strategy.allowJson || response.status === 401 ? await getJsonRpcEnvelopeInfo(response) : null;
  if (response.ok && strategy.allowJson && envelope) {
    if (strategy.kind === "modern" && (envelope.kind === "error" || envelope.protocolVersion !== MODERN_PROTOCOL_VERSION)) {
      return { kind: "unsupported-modern" };
    }
    return {
      kind: "mcp",
      result: {
        isMcp: true,
        classification: strategy.kind === "modern" ? `endpoint supports stateless MCP ${MODERN_PROTOCOL_VERSION} server/discover` : "endpoint responded with a JSON-RPC 2.0 envelope"
      }
    };
  }
  if (response.status === 401 && isBearerChallenge(response) && envelope) {
    return {
      kind: "mcp",
      result: {
        isMcp: true,
        classification: strategy.kind === "modern" ? `endpoint requires Bearer authentication during MCP ${MODERN_PROTOCOL_VERSION} server/discover probing` : "endpoint requires Bearer authentication and responded with a JSON-RPC 2.0 error"
      }
    };
  }
  return { kind: "unrecognized" };
}
async function probe(url, strategy) {
  const response = await fetch(url, {
    ...strategy.request,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
  });
  return { response, outcome: await classifyResponse(response, strategy) };
}
function notMcp(response) {
  const responseDescription = `endpoint returned ${responseKind(response)} (${response.status})`;
  return {
    isMcp: false,
    classification: response.status === 503 ? `${responseDescription} \u2014 server is temporarily unavailable; MCP endpoint shape could not be determined` : response.status === 202 ? `${responseDescription} \u2014 MCP endpoint shape could not be determined` : response.status === 401 ? `${responseDescription} \u2014 authentication may be required; MCP endpoint shape could not be determined` : `${responseDescription} \u2014 this URL does not appear to speak MCP`
  };
}
function ambiguousNotMcp(response) {
  return AMBIGUOUS_STATUSES.has(response.status) ? notMcp(response) : void 0;
}
async function probeMcpEndpoint(url) {
  const { response: modernResponse, outcome: modernOutcome } = await probe(url, MODERN_STRATEGY);
  if (modernOutcome.kind === "mcp") return modernOutcome.result;
  let ambiguousResult = ambiguousNotMcp(modernResponse);
  if (modernOutcome.kind !== "unsupported-modern" && !MODERN_FALLBACK_STATUSES.has(modernResponse.status)) {
    return ambiguousResult ?? notMcp(modernResponse);
  }
  const { response: postResponse, outcome: postOutcome } = await probe(url, LEGACY_POST_STRATEGY);
  if (postOutcome.kind === "mcp") return postOutcome.result;
  ambiguousResult ??= ambiguousNotMcp(postResponse);
  if (!POST_ENDPOINT_MISMATCH_STATUSES.has(postResponse.status)) return ambiguousNotMcp(postResponse) ?? ambiguousResult ?? notMcp(postResponse);
  const { response: getResponse, outcome: getOutcome } = await probe(url, LEGACY_SSE_STRATEGY);
  return getOutcome.kind === "mcp" ? getOutcome.result : ambiguousNotMcp(getResponse) ?? ambiguousResult ?? notMcp(getResponse);
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
function getVisualizationStreamEnvelope(structuredContent) {
  if (!structuredContent || typeof structuredContent !== "object" || Array.isArray(structuredContent)) {
    return void 0;
  }
  const candidate = structuredContent[UI_STREAM_STRUCTURED_CONTENT_KEY];
  const parsed = visualizationStreamEnvelopeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : void 0;
}

// src/runtime/npx-resolver.ts
import { existsSync, readFileSync, realpathSync, readdirSync, statSync, writeFileSync, renameSync, mkdirSync, openSync, readSync, closeSync, unlinkSync } from "node:fs";
import { join, dirname, extname, resolve, sep } from "node:path";
import crossSpawn from "cross-spawn";
var CACHE_VERSION = 2;
var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var EXACT_PACKAGE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?(?:\+[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
async function resolveNpxBinary(command, args, signal) {
  throwIfAborted(signal);
  const parsed = command === "npx" ? parseNpxArgs(args) : command === "npm" ? parseNpmExecArgs(args) : null;
  if (!parsed) return null;
  const packageSpec = parsePackageSpec(parsed.packageSpec);
  const cacheKey = JSON.stringify([command, parsed.packageSpec, parsed.binName ?? ""]);
  const cache = loadCache();
  const cached = cache?.entries?.[cacheKey];
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS && existsSync(cached.resolvedBin) && (!packageSpec?.exactVersion || cached.packageVersion === packageSpec.exactVersion)) {
    return { binPath: cached.resolvedBin, extraArgs: parsed.extraArgs, isJs: cached.isJs };
  }
  const resolved = resolveFromNpmCache(parsed.packageSpec, parsed.binName);
  if (resolved) {
    saveCacheEntry(cacheKey, resolved);
    return { binPath: resolved.resolvedBin, extraArgs: parsed.extraArgs, isJs: resolved.isJs };
  }
  await forceNpxCache(parsed.packageSpec, signal);
  const resolvedAfterInstall = resolveFromNpmCache(parsed.packageSpec, parsed.binName);
  if (resolvedAfterInstall) {
    saveCacheEntry(cacheKey, resolvedAfterInstall);
    return { binPath: resolvedAfterInstall.resolvedBin, extraArgs: parsed.extraArgs, isJs: resolvedAfterInstall.isJs };
  }
  return null;
}
function parseNpxArgs(args) {
  const separatorIndex = args.indexOf("--");
  const before = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
  const after = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : [];
  const positionals = [];
  let packageSpec;
  let sawPackageFlag = false;
  let foundFirstPositional = false;
  for (let i = 0; i < before.length; i++) {
    const arg = before[i];
    if (arg === void 0) return null;
    if (foundFirstPositional) {
      positionals.push(arg);
      continue;
    }
    if (arg === "-y" || arg === "--yes") continue;
    if (arg === "-p" || arg === "--package") {
      const value = before[i + 1];
      if (!value || value.startsWith("-")) return null;
      if (!packageSpec) packageSpec = value;
      sawPackageFlag = true;
      i++;
      continue;
    }
    if (arg.startsWith("--package=")) {
      const value = arg.slice("--package=".length);
      if (!value) return null;
      if (!packageSpec) packageSpec = value;
      sawPackageFlag = true;
      continue;
    }
    if (arg.startsWith("-")) {
      return null;
    }
    positionals.push(arg);
    foundFirstPositional = true;
  }
  const separatedAfter = separatorIndex >= 0 && after.length > 0 ? ["--", ...after] : after;
  if (sawPackageFlag) {
    const binName = positionals[0];
    if (!packageSpec || !binName) return null;
    const extraArgs2 = positionals.slice(1).concat(separatedAfter);
    return { packageSpec, binName, extraArgs: extraArgs2 };
  }
  const packagePositional = positionals[0];
  if (!packagePositional) return null;
  const extraArgs = positionals.slice(1).concat(separatedAfter);
  return { packageSpec: packagePositional, extraArgs };
}
function parseNpmExecArgs(args) {
  if (args[0] !== "exec") return null;
  const execArgs = args.slice(1);
  const separatorIndex = execArgs.indexOf("--");
  if (separatorIndex < 0) return null;
  const before = execArgs.slice(0, separatorIndex);
  const after = execArgs.slice(separatorIndex + 1);
  let packageSpec;
  for (let i = 0; i < before.length; i++) {
    const arg = before[i];
    if (arg === void 0) return null;
    if (arg === "-y" || arg === "--yes") continue;
    if (arg === "--package") {
      const value = before[i + 1];
      if (!value || value.startsWith("-")) return null;
      if (!packageSpec) packageSpec = value;
      i++;
      continue;
    }
    if (arg.startsWith("--package=")) {
      const value = arg.slice("--package=".length);
      if (!value) return null;
      if (!packageSpec) packageSpec = value;
      continue;
    }
    if (arg.startsWith("-")) {
      return null;
    }
  }
  const binName = after[0];
  if (!packageSpec || !binName) return null;
  const extraArgs = after.slice(1);
  return { packageSpec, binName, extraArgs };
}
function resolveFromNpmCache(packageSpec, binName) {
  const cacheDir = getNpmCacheDir();
  if (!cacheDir) return null;
  const parsedSpec = parsePackageSpec(packageSpec);
  if (!parsedSpec) return null;
  const { packageName, exactVersion } = parsedSpec;
  const packageDir = findCachedPackageDir(cacheDir, packageName, exactVersion);
  if (!packageDir) return null;
  const packageJsonPath = join(packageDir, "package.json");
  if (!existsSync(packageJsonPath)) return null;
  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  } catch {
    return null;
  }
  const binField = pkg?.bin;
  if (!binField) return null;
  const candidates = buildBinCandidates(packageName, binName);
  let chosenBinName;
  let binRel;
  if (typeof binField === "string") {
    chosenBinName = defaultBinName(packageName);
    binRel = binField;
  } else {
    for (const candidate of candidates) {
      if (binField[candidate]) {
        chosenBinName = candidate;
        binRel = binField[candidate];
        break;
      }
    }
    if (!binRel) {
      const firstEntry = Object.entries(binField)[0];
      if (firstEntry) {
        chosenBinName = firstEntry[0];
        binRel = firstEntry[1];
      }
    }
  }
  if (!binRel) return null;
  const nodeModulesDir = findNodeModulesDir(packageDir);
  const binLink = chosenBinName ? join(nodeModulesDir, ".bin", chosenBinName) : null;
  let resolvedBin = binLink && existsSync(binLink) ? safeRealpath(binLink) : "";
  if (!resolvedBin) {
    resolvedBin = resolve(packageDir, binRel);
    if (!existsSync(resolvedBin)) return null;
  }
  const isJs = detectJsBinary(resolvedBin);
  return {
    resolvedBin,
    resolvedAt: Date.now(),
    ...pkg?.version !== void 0 ? { packageVersion: pkg.version } : {},
    isJs
  };
}
var FORCE_CACHE_TIMEOUT_MS = 3e4;
async function forceNpxCache(packageSpec, signal) {
  throwIfAborted(signal);
  try {
    await new Promise((resolve3, reject) => {
      const proc = crossSpawn(
        "npm",
        ["exec", "--yes", "--package", packageSpec, "--", "node", "-e", "1"],
        { stdio: "ignore" }
      );
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error("timeout"));
      }, FORCE_CACHE_TIMEOUT_MS);
      const abort = () => {
        proc.kill();
        reject(signal?.reason instanceof Error ? signal.reason : new Error("MCP request aborted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      timer.unref();
      proc.on("close", () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve3();
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(err);
      });
    });
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
  }
  throwIfAborted(signal);
}
function buildBinCandidates(packageName, explicitBin) {
  const candidates = [];
  if (explicitBin) candidates.push(explicitBin);
  if (packageName.startsWith("@")) {
    const namePart = packageName.split("/")[1] ?? "";
    const scopePart = packageName.split("/")[0]?.replace("@", "") ?? "";
    if (namePart) candidates.push(namePart);
    if (scopePart && namePart) candidates.push(`${scopePart}-${namePart}`);
  } else {
    candidates.push(packageName);
  }
  return [...new Set(candidates.filter(Boolean))];
}
function parsePackageSpec(spec) {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  let packageName;
  let requestedVersion;
  if (trimmed.startsWith("@")) {
    const slashIndex = trimmed.indexOf("/");
    if (slashIndex < 0) return null;
    const atIndex = trimmed.lastIndexOf("@");
    if (atIndex > slashIndex) {
      packageName = trimmed.slice(0, atIndex);
      requestedVersion = trimmed.slice(atIndex + 1);
    } else {
      packageName = trimmed;
    }
  } else {
    const atIndex = trimmed.indexOf("@");
    if (atIndex >= 0) {
      packageName = trimmed.slice(0, atIndex);
      requestedVersion = trimmed.slice(atIndex + 1);
    } else {
      packageName = trimmed;
    }
  }
  if (!packageName) return null;
  const normalizedVersion = requestedVersion?.replace(/^=/, "").replace(/^v/i, "");
  return {
    packageName,
    ...normalizedVersion && EXACT_PACKAGE_VERSION_RE.test(normalizedVersion) ? { exactVersion: normalizedVersion } : {}
  };
}
function defaultBinName(packageName) {
  if (packageName.startsWith("@")) {
    const parts = packageName.split("/");
    return parts[1] ?? packageName.replace("@", "").replace("/", "-");
  }
  return packageName;
}
function findCachedPackageDir(cacheDir, packageName, exactVersion) {
  const npxDir = join(cacheDir, "_npx");
  if (!existsSync(npxDir)) return null;
  const packagePathParts = packageName.startsWith("@") ? packageName.split("/") : [packageName];
  const candidates = readdirSync(npxDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const full = join(npxDir, entry.name);
    const mtime = safeStatMtime(full);
    return { name: entry.name, mtime };
  }).sort((a, b) => b.mtime - a.mtime);
  for (const entry of candidates) {
    const pkgDir = join(npxDir, entry.name, "node_modules", ...packagePathParts);
    const packageJsonPath = join(pkgDir, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    if (exactVersion) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        if (pkg.version !== exactVersion) continue;
      } catch {
        continue;
      }
    }
    return pkgDir;
  }
  return null;
}
function findNodeModulesDir(packageDir) {
  const parts = packageDir.split(sep);
  const idx = parts.lastIndexOf("node_modules");
  if (idx >= 0) {
    return parts.slice(0, idx + 1).join(sep);
  }
  return join(packageDir, "..");
}
function detectJsBinary(binPath) {
  const ext = extname(binPath).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return true;
  try {
    const fd = openSync(binPath, "r");
    try {
      const buf = Buffer.alloc(256);
      readSync(fd, buf, 0, 256, 0);
      const firstLine = buf.toString("utf-8").split("\n")[0] ?? "";
      return firstLine.startsWith("#!") && firstLine.includes("node");
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}
var npmCacheDirCached;
function getNpmCacheDir() {
  if (npmCacheDirCached !== void 0) return npmCacheDirCached;
  if (process.env.NPM_CONFIG_CACHE) {
    npmCacheDirCached = process.env.NPM_CONFIG_CACHE;
    return npmCacheDirCached;
  }
  try {
    const result = crossSpawn.sync("npm", ["config", "get", "cache"], { encoding: "utf-8" });
    if (result.status === 0) {
      const path = String(result.stdout).trim();
      npmCacheDirCached = path || null;
      return npmCacheDirCached;
    }
  } catch {
    npmCacheDirCached = null;
    return null;
  }
  npmCacheDirCached = null;
  return null;
}
function getNpxCachePath() {
  return getAgentPath("mcp-npx-cache.json");
}
function readNpxCachePayload(cachePath) {
  if (!existsSync(cachePath)) return null;
  try {
    return JSON.parse(readFileSync(cachePath, "utf-8"));
  } catch {
    return null;
  }
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function createCacheEntries() {
  return /* @__PURE__ */ Object.create(null);
}
function toNpxCacheEntry(value) {
  const raw = asRecord(value);
  if (!raw) return null;
  if (typeof raw.resolvedBin !== "string") return null;
  if (typeof raw.resolvedAt !== "number" || !Number.isFinite(raw.resolvedAt)) return null;
  if (typeof raw.isJs !== "boolean") return null;
  if (raw.packageVersion !== void 0 && typeof raw.packageVersion !== "string") return null;
  return {
    resolvedBin: raw.resolvedBin,
    resolvedAt: raw.resolvedAt,
    ...raw.packageVersion !== void 0 ? { packageVersion: raw.packageVersion } : {},
    isJs: raw.isJs
  };
}
function toNpxCache(value) {
  const raw = asRecord(value);
  if (!raw || raw.version !== CACHE_VERSION) return null;
  const rawEntries = asRecord(raw.entries);
  if (!rawEntries) return null;
  const entries = createCacheEntries();
  for (const [key, rawEntry] of Object.entries(rawEntries)) {
    const entry = toNpxCacheEntry(rawEntry);
    if (entry) entries[key] = entry;
  }
  return { version: CACHE_VERSION, entries };
}
function clearLegacyCache() {
  const cachePath = getNpxCachePath();
  const raw = asRecord(readNpxCachePayload(cachePath));
  if (raw?.version !== 1) return false;
  try {
    unlinkSync(cachePath);
  } catch {
    try {
      writeFileSync(cachePath, "", "utf-8");
    } catch {
    }
  }
  return true;
}
clearLegacyCache();
function loadCache() {
  if (clearLegacyCache()) return null;
  return toNpxCache(readNpxCachePayload(getNpxCachePath()));
}
function saveCacheEntry(key, entry) {
  try {
    const cachePath = getNpxCachePath();
    const dir = dirname(cachePath);
    mkdirSync(dir, { recursive: true });
    const existing = toNpxCache(readNpxCachePayload(cachePath));
    const entries = createCacheEntries();
    if (existing) Object.assign(entries, existing.entries);
    const merged = { version: CACHE_VERSION, entries };
    merged.entries[key] = entry;
    const tmpPath = `${cachePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(merged, null, 2), "utf-8");
    renameSync(tmpPath, cachePath);
  } catch {
  }
}
function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return "";
  }
}
function safeStatMtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

// src/tools/json-schema-validator.ts
import { Ajv } from "ajv";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
var addFormats = addFormatsImport;
var DRAFT_07_SCHEMA_URIS = /* @__PURE__ */ new Set([
  "http://json-schema.org/draft-07/schema",
  "https://json-schema.org/draft-07/schema"
]);
var DRAFT_2020_12_SCHEMA_URIS = /* @__PURE__ */ new Set([
  "https://json-schema.org/draft/2020-12/schema"
]);
function schemaDialect(schema) {
  if (!("$schema" in schema) || typeof schema.$schema !== "string") {
    return { status: "unstamped" };
  }
  return {
    status: "stamped",
    uri: schema.$schema.endsWith("#") ? schema.$schema.slice(0, -1) : schema.$schema
  };
}
function createJsonSchemaValidator() {
  let draft07Validator;
  let draft2020Validator;
  return {
    getValidator(schema) {
      const dialect = schemaDialect(schema);
      if (dialect.status === "unstamped" || DRAFT_2020_12_SCHEMA_URIS.has(dialect.uri)) {
        draft2020Validator ??= (() => {
          const Ajv2020 = Ajv2020Import;
          const ajv = new Ajv2020({ strict: false, allErrors: true });
          addFormats(ajv);
          return new AjvJsonSchemaValidator(ajv);
        })();
        return draft2020Validator.getValidator(schema);
      }
      if (!DRAFT_07_SCHEMA_URIS.has(dialect.uri)) {
        throw new Error(`Unsupported JSON Schema dialect: ${dialect.uri}`);
      }
      draft07Validator ??= (() => {
        const ajv = new Ajv({
          strict: false,
          validateFormats: true,
          validateSchema: false,
          allErrors: true
        });
        addFormats(ajv);
        return new AjvJsonSchemaValidator(ajv);
      })();
      return draft07Validator.getValidator(schema);
    }
  };
}

// src/auth/mcp-bearer-store.ts
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname as dirname2, join as join2 } from "node:path";
var require2 = createRequire(import.meta.url);
var BEARER_SECRET_SERVICE = "pi-mcp-adapter.bearer";
var TEST_AUTH_STORE_ENV = "PI_MCP_ADAPTER_TEST_AUTH_STORE";
var BEARER_SECRET_VALUE_LIMIT = 1280;
var KeyringEntryClass;
var memoryBearerEntries = /* @__PURE__ */ new Map();
var testBearerSecretStoreReadCount = 0;
var BearerCredentialStoreError = class extends Error {
  code = "BEARER_CREDENTIAL_STORE_UNAVAILABLE";
  operation;
  // No parameter properties: cli.js loads this module under plain Node
  // type stripping, which rejects non-erasable TypeScript syntax.
  constructor(message, operation, cause) {
    super(message, { cause });
    this.name = "BearerCredentialStoreError";
    this.operation = operation;
  }
};
var memoryBearerSecretStore = {
  read(account) {
    testBearerSecretStoreReadCount++;
    return memoryBearerEntries.get(account);
  },
  write(account, payload) {
    memoryBearerEntries.set(account, payload);
  },
  remove(account) {
    memoryBearerEntries.delete(account);
  }
};
var sizeLimitedBearerSecretStore = {
  read(account) {
    testBearerSecretStoreReadCount++;
    return memoryBearerEntries.get(account);
  },
  write(account, payload) {
    if (payload.length > BEARER_SECRET_VALUE_LIMIT) {
      throw new Error(`Value of 'password encoded as UTF-16' is longer than the platform limit of ${BEARER_SECRET_VALUE_LIMIT * 2} chars`);
    }
    memoryBearerEntries.set(account, payload);
  },
  remove(account) {
    memoryBearerEntries.delete(account);
  }
};
var unavailableBearerSecretStore = {
  read() {
    testBearerSecretStoreReadCount++;
    throw new Error("simulated secure credential store unavailable");
  },
  write() {
    throw new Error("simulated secure credential store unavailable");
  },
  remove() {
    throw new Error("simulated secure credential store unavailable");
  }
};
var keyringBearerSecretStore = {
  read(account) {
    return getKeyringEntry(account).getPassword() ?? void 0;
  },
  write(account, payload) {
    getKeyringEntry(account).setPassword(payload);
  },
  remove(account) {
    getKeyringEntry(account).deleteCredential();
  }
};
function getBearerSecretStore() {
  if (process.env[TEST_AUTH_STORE_ENV] === "memory") return memoryBearerSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV] === "sizelimited") return sizeLimitedBearerSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV] === "unavailable") return unavailableBearerSecretStore;
  return keyringBearerSecretStore;
}
function getKeyringEntry(account) {
  try {
    KeyringEntryClass ??= loadKeyringEntryClass();
    return new KeyringEntryClass(BEARER_SECRET_SERVICE, account);
  } catch (error) {
    throw new Error("Bearer token secure credential storage is unavailable. Configure the OS credential store and retry.", { cause: error });
  }
}
function loadKeyringEntryClass(keyringRequire = require2, platform = process.platform, arch = process.arch) {
  try {
    return keyringRequire("@napi-rs/keyring").Entry;
  } catch (loaderError) {
    try {
      return loadKeyringNativeBindingFallback(keyringRequire, platform, arch).Entry;
    } catch (fallbackError) {
      const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`Failed to load @napi-rs/keyring; absolute-path native binding fallback also failed: ${message}`, { cause: loaderError });
    }
  }
}
function loadKeyringNativeBindingFallback(keyringRequire, platform, arch) {
  const targets = getKeyringNativeBindingSuffixes(platform, arch).map((suffix) => ({
    packageName: `@napi-rs/keyring-${suffix}`,
    bindingFile: `keyring.${suffix}.node`
  }));
  let lastError;
  for (const target of targets) {
    try {
      const packageJsonPath = keyringRequire.resolve(`${target.packageName}/package.json`);
      return keyringRequire(join2(dirname2(packageJsonPath), target.bindingFile));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
function getKeyringNativeBindingSuffixes(platform, arch) {
  if (platform === "darwin") {
    if (arch === "arm64") return ["darwin-arm64"];
    if (arch === "x64") return ["darwin-x64"];
  }
  if (platform === "win32") {
    if (arch === "arm64") return ["win32-arm64-msvc"];
    if (arch === "x64") return ["win32-x64-msvc"];
    if (arch === "ia32") return ["win32-ia32-msvc"];
  }
  if (platform === "linux") {
    if (arch === "arm64") return ["linux-arm64-gnu", "linux-arm64-musl"];
    if (arch === "arm") return ["linux-arm-gnueabihf"];
    if (arch === "riscv64") return ["linux-riscv64-gnu"];
    if (arch === "x64") return ["linux-x64-gnu", "linux-x64-musl"];
  }
  if (platform === "freebsd" && arch === "x64") return ["freebsd-x64"];
  return [];
}
function getBearerAccount(serverName) {
  if (typeof serverName !== "string") {
    throw new Error(`Invalid MCP server name: ${JSON.stringify(serverName)}`);
  }
  return `sha256-${createHash("sha256").update(serverName, "utf8").digest("hex")}`;
}
function parseBearerPayload(serverName, payload) {
  const parsed = parseStoredBearerJson(serverName, payload);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Stored bearer token record for ${serverName} has invalid shape`);
  }
  const record = parsed;
  if (typeof record.token !== "string" || typeof record.serverUrl !== "string") {
    throw new Error(`Stored bearer token record for ${serverName} has invalid shape`);
  }
  return { token: record.token, serverUrl: record.serverUrl };
}
function parseStoredBearerJson(serverName, payload) {
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(`Failed to parse stored bearer token record for ${serverName}`);
  }
}
function isBearerChunkManifest(value) {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value;
  return manifest.__piMcpAdapterBearerChunked === 1 && typeof manifest.chunkCount === "number" && Number.isInteger(manifest.chunkCount) && manifest.chunkCount > 0 && typeof manifest.chunkDigest === "string" && /^[a-f0-9]{16}$/.test(manifest.chunkDigest);
}
function readManifest(serverName, payload) {
  const parsed = parseStoredBearerJson(serverName, payload);
  return isBearerChunkManifest(parsed) ? parsed : void 0;
}
function chunkAccount(account, manifest, index) {
  return `${account}.chunk.${manifest.chunkDigest}.${index}`;
}
function chunkAccounts(account, manifest) {
  return Array.from({ length: manifest.chunkCount }, (_, index) => chunkAccount(account, manifest, index));
}
function removeChunks(store, account, manifest) {
  if (!manifest) return;
  for (const accountName of chunkAccounts(account, manifest)) store.remove(accountName);
}
function readBearerRecordFromStore(store, serverName) {
  const account = getBearerAccount(serverName);
  let payload;
  try {
    payload = store.read(account);
  } catch (error) {
    throw new BearerCredentialStoreError(
      `Failed to read bearer token for ${serverName} from the OS secure credential store`,
      "read",
      error
    );
  }
  if (payload === void 0) return void 0;
  try {
    const manifest = readManifest(serverName, payload);
    const recordPayload = manifest ? chunkAccounts(account, manifest).map((chunkName) => {
      const chunk = store.read(chunkName);
      if (chunk === void 0) throw new Error(`Missing bearer token chunk for ${serverName}`);
      return chunk;
    }).join("") : payload;
    return parseBearerPayload(serverName, recordPayload);
  } catch (error) {
    throw new BearerCredentialStoreError(
      `Failed to read bearer token for ${serverName} from the OS secure credential store`,
      "read",
      error
    );
  }
}
function removeBearerRecordFromStore(store, serverName) {
  const account = getBearerAccount(serverName);
  try {
    const payload = store.read(account);
    const manifest = payload === void 0 ? void 0 : readManifest(serverName, payload);
    removeChunks(store, account, manifest);
    store.remove(account);
  } catch (error) {
    throw new BearerCredentialStoreError(
      `Failed to remove bearer token for ${serverName} from the OS secure credential store`,
      "remove",
      error
    );
  }
}
function getBearerTokenForUrl(serverName, serverUrl) {
  const record = readBearerRecordFromStore(getBearerSecretStore(), serverName);
  if (!record) return void 0;
  return record.serverUrl === serverUrl ? record.token : void 0;
}
function removeBearerToken(serverName) {
  removeBearerRecordFromStore(getBearerSecretStore(), serverName);
}
function inspectBearerTokenForUrl(serverName, serverUrl) {
  try {
    const record = readBearerRecordFromStore(getBearerSecretStore(), serverName);
    if (!record) return { status: "missing" };
    if (record.serverUrl !== serverUrl) return { status: "url-mismatch" };
    return { status: "present" };
  } catch (error) {
    if (!(error instanceof BearerCredentialStoreError)) throw error;
    return { status: "unavailable", message: "Bearer token secure credential store unavailable. Configure or unlock the OS credential store and retry." };
  }
}

// src/runtime/sampling-handler.ts
import { complete } from "@earendil-works/pi-ai/compat";
function registerSamplingHandler(client, options) {
  client.setRequestHandler("sampling/createMessage", (request) => {
    return handleSamplingRequest(options, request);
  });
}
async function handleSamplingRequest(options, request) {
  const params = request.params;
  const signal = options.getSignal();
  throwIfAborted(signal);
  if ("task" in params && params.task) {
    throw new Error("MCP sampling tasks are not supported");
  }
  if (params.includeContext && params.includeContext !== "none") {
    throw new Error("MCP sampling context inclusion is not supported");
  }
  if (params.tools?.length) {
    throw new Error("MCP sampling tool use is not supported");
  }
  if (params.toolChoice) {
    throw new Error("MCP sampling tool choice is not supported");
  }
  if (params.stopSequences?.length) {
    throw new Error("MCP sampling stop sequences are not supported");
  }
  const messages = params.messages.map(convertSamplingMessage);
  const { model, apiKey, headers } = await resolveSamplingModel(options, params.modelPreferences);
  throwIfAborted(signal);
  await confirmSampling(
    options,
    "Approve MCP sampling request",
    formatRequestApproval(options.serverName, `${model.provider}/${model.id}`, params.systemPrompt, messages)
  );
  throwIfAborted(signal);
  const result = await complete(
    model,
    {
      ...params.systemPrompt !== void 0 ? { systemPrompt: params.systemPrompt } : {},
      messages
    },
    {
      ...apiKey !== void 0 ? { apiKey } : {},
      ...headers !== void 0 ? { headers } : {},
      maxTokens: params.maxTokens,
      ...params.temperature !== void 0 ? { temperature: params.temperature } : {},
      ...params.metadata !== void 0 ? { metadata: params.metadata } : {},
      ...signal ? { signal } : {}
    }
  );
  const converted = convertAssistantResult(result);
  throwIfAborted(signal);
  await confirmSampling(
    options,
    "Return MCP sampling response",
    formatResponseApproval(options.serverName, converted)
  );
  return converted;
}
function formatRequestApproval(serverName, modelName, systemPrompt, messages) {
  const lines = [`${serverName} wants to sample ${messages.length} message${messages.length === 1 ? "" : "s"} with ${modelName}.`];
  if (systemPrompt) {
    lines.push(`System: ${truncateAtWord(systemPrompt, 400)}`);
  }
  for (const [index, message] of messages.entries()) {
    lines.push(`${index + 1}. ${message.role}: ${truncateAtWord(messageText(message), 400)}`);
  }
  return lines.join("\n\n");
}
function formatResponseApproval(serverName, response) {
  const text = response.content.type === "text" ? response.content.text : `[${response.content.type} content]`;
  return `${serverName} will receive this response from ${response.model}:

${truncateAtWord(text, 1e3)}`;
}
function messageText(message) {
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "image") return `[image: ${block.mimeType}]`;
    if (block.type === "thinking") return "[thinking]";
    if (block.type === "toolCall") return `[tool call: ${block.name}]`;
    return "[content]";
  }).join("\n");
}
async function resolveSamplingModel(options, modelPreferences) {
  const candidates = [];
  const availableModels = options.modelRegistry.getAvailable();
  for (const hint of modelPreferences?.hints ?? []) {
    const normalizedHint = hint.name?.trim().toLowerCase();
    if (!normalizedHint) continue;
    for (const model of availableModels) {
      const searchableNames = [`${model.provider}/${model.id}`, model.id, model.name];
      if (searchableNames.some((name) => name.toLowerCase().includes(normalizedHint))) {
        addSamplingCandidate(candidates, model);
      }
    }
  }
  const currentModel = options.getCurrentModel();
  if (currentModel) addSamplingCandidate(candidates, currentModel);
  for (const model of availableModels) {
    addSamplingCandidate(candidates, model);
  }
  const errors = [];
  const signal = options.getSignal();
  for (const model of candidates) {
    throwIfAborted(signal);
    const auth = await options.modelRegistry.getApiKeyAndHeaders(model);
    throwIfAborted(signal);
    if (auth.ok === false) {
      errors.push(`${model.provider}/${model.id}: ${auth.error}`);
      continue;
    }
    return {
      model,
      ...auth.apiKey !== void 0 ? { apiKey: auth.apiKey } : {},
      ...auth.headers !== void 0 ? { headers: auth.headers } : {}
    };
  }
  if (errors.length > 0) {
    throw new Error(`No configured auth for MCP sampling model. ${errors.join("; ")}`);
  }
  throw new Error("No Pi model is available for MCP sampling");
}
function addSamplingCandidate(candidates, model) {
  if (!candidates.some((candidate) => candidate.provider === model.provider && candidate.id === model.id)) {
    candidates.push(model);
  }
}
async function confirmSampling(options, title, message) {
  if (options.autoApprove) return;
  if (!options.ui) {
    throw new Error("MCP sampling requires interactive approval. Set settings.samplingAutoApprove to true to allow it without UI.");
  }
  const approved = await options.ui.confirm(title, message);
  if (!approved) {
    throw new Error("MCP sampling request was declined");
  }
}
function convertSamplingMessage(message) {
  const blocks = Array.isArray(message.content) ? message.content : [message.content];
  if (message.role === "user") {
    return {
      role: "user",
      content: blocks.map(convertUserContent),
      timestamp: Date.now()
    };
  }
  return {
    role: "assistant",
    content: blocks.map(convertAssistantContent),
    api: "mcp-sampling",
    provider: "mcp",
    model: "sampling-request",
    usage: zeroUsage(),
    stopReason: "stop",
    timestamp: Date.now()
  };
}
function convertUserContent(block) {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  throw new Error(`MCP sampling ${block.type} content is not supported`);
}
function convertAssistantContent(block) {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  throw new Error(`MCP sampling assistant ${block.type} content is not supported`);
}
function convertAssistantResult(message) {
  if (message.stopReason === "error") {
    throw new Error(message.errorMessage ?? "MCP sampling model call failed");
  }
  if (message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? "MCP sampling model call was aborted");
  }
  const text = message.content.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "thinking") return void 0;
    throw new Error(`MCP sampling result ${block.type} content is not supported`);
  }).filter((value) => value !== void 0).join("\n\n").trim();
  if (!text) {
    throw new Error("MCP sampling result did not contain text content");
  }
  return {
    role: "assistant",
    content: { type: "text", text },
    model: `${message.provider}/${message.model}`,
    stopReason: mapStopReason(message.stopReason)
  };
}
function mapStopReason(reason) {
  if (reason === "stop") return "endTurn";
  if (reason === "length") return "maxTokens";
  if (reason === "toolUse") return "toolUse";
  return reason;
}
function zeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0
    }
  };
}

// src/runtime/elicitation-handler.ts
import {
  ProtocolError,
  ProtocolErrorCode
} from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator as AjvJsonSchemaValidator2 } from "@modelcontextprotocol/client/validators/ajv";
import open from "open";
function registerElicitationHandler(client, options) {
  client.setRequestHandler("elicitation/create", (request) => handleElicitationRequest(options, request));
}
async function handleElicitationRequest(options, request) {
  return request.params.mode === "url" ? handleUrlElicitation(options, request.params) : handleFormElicitation(options, request.params);
}
async function handleFormElicitation(options, params) {
  const properties = Object.entries(params.requestedSchema.properties);
  const decision = await options.ui.select(
    `MCP Input Request
Server: ${options.serverName}

${params.message}`,
    ["Continue", "Decline"]
  );
  if (decision === void 0) return { action: "cancel" };
  if (decision === "Decline") return { action: "decline" };
  if (properties.length === 0) return { action: "accept", content: {} };
  const values = {};
  for (const [name, schema] of properties) {
    const value = await collectValidField(options.ui, params, name, schema);
    if (value.status === "cancelled") return { action: "cancel" };
    values[name] = value.value;
  }
  while (true) {
    const content = coerceAndValidateFormValues(params, values);
    const action = await options.ui.select(
      formatReview(options.serverName, properties, content),
      ["Submit", "Edit", "Decline"]
    );
    if (action === void 0) return { action: "cancel" };
    if (action === "Decline") return { action: "decline" };
    if (action === "Submit") return { action: "accept", content };
    const labels = properties.map(([name2, schema2]) => `${schema2.title ?? humanizeName(name2)} (${name2})`);
    const selected = await options.ui.select("Choose a field to edit", labels);
    if (selected === void 0) return { action: "cancel" };
    const property = properties[labels.indexOf(selected)];
    if (!property) continue;
    const [name, schema] = property;
    const value = await collectValidField(options.ui, params, name, schema, values[name]);
    if (value.status === "cancelled") return { action: "cancel" };
    values[name] = value.value;
  }
}
async function collectValidField(ui, params, name, schema, current) {
  const required = params.requestedSchema.required?.includes(name) === true;
  while (true) {
    const result = await collectField(ui, params, name, schema, current);
    if (result.status === "cancelled") return result;
    try {
      coerceAndValidateFormValues({
        ...params,
        requestedSchema: {
          type: "object",
          properties: { [name]: schema },
          ...required ? { required: [name] } : {}
        }
      }, { [name]: result.value });
      return result;
    } catch (error) {
      ui.notify(error instanceof Error ? error.message : String(error), "error");
      current = result.value;
    }
  }
}
async function collectField(ui, params, name, schema, current) {
  const required = params.requestedSchema.required?.includes(name) === true;
  const title = [schema.title ?? humanizeName(name), required ? "(required)" : "", schema.description].filter(Boolean).join(" ");
  if (schema.type === "string" && ("enum" in schema || "oneOf" in schema)) {
    const choices = "oneOf" in schema ? schema.oneOf.map((option) => ({ value: option.const, display: formatChoice(option.const, option.title) })) : schema.enum.map((value, index) => ({
      value,
      display: formatChoice(value, "enumNames" in schema ? schema.enumNames?.[index] : void 0)
    }));
    const displays = uniqueLabels(choices.map((choice) => choice.display));
    const actions2 = [...displays];
    const useDefault = schema.default === void 0 ? void 0 : uniqueAction("Use default", actions2);
    if (useDefault) actions2.push(useDefault);
    const omit = required ? void 0 : uniqueAction("Omit", actions2);
    if (omit) actions2.push(omit);
    const action2 = await ui.select(title, actions2);
    if (action2 === void 0) return { status: "cancelled" };
    if (action2 === useDefault) return { status: "collected", value: schema.default };
    if (action2 === omit) return { status: "collected", value: void 0 };
    return { status: "collected", value: choices[displays.indexOf(action2)]?.value };
  }
  if (schema.type === "boolean") {
    const actions2 = ["Yes", "No"];
    if (schema.default !== void 0) actions2.push("Use default");
    if (!required) actions2.push("Omit");
    const action2 = await ui.select(title, actions2);
    if (action2 === void 0) return { status: "cancelled" };
    if (action2 === "Use default") return { status: "collected", value: schema.default };
    if (action2 === "Omit") return { status: "collected", value: void 0 };
    return { status: "collected", value: action2 === "Yes" };
  }
  if (schema.type === "array") {
    const actions2 = ["Choose values"];
    if (schema.default !== void 0) actions2.push("Use default");
    if (!required) actions2.push("Omit");
    const action2 = await ui.select(title, actions2);
    if (action2 === void 0) return { status: "cancelled" };
    if (action2 === "Use default") return { status: "collected", value: schema.default };
    if (action2 === "Omit") return { status: "collected", value: void 0 };
    const choices = extractMultiSelectOptions(schema);
    const selected = new Set(Array.isArray(current) ? current : []);
    while (true) {
      const displays = uniqueLabels(choices.map((choice2) => selected.has(choice2.value) ? `\u2713 ${choice2.display}` : choice2.display));
      const done = uniqueAction("Done", displays);
      const picked = await ui.select(title, [...displays, done]);
      if (picked === void 0) return { status: "cancelled" };
      if (picked === done) return { status: "collected", value: [...selected] };
      const choice = choices[displays.indexOf(picked)];
      if (!choice) continue;
      if (selected.has(choice.value)) selected.delete(choice.value);
      else selected.add(choice.value);
    }
  }
  const actions = ["Enter value"];
  if (schema.default !== void 0) actions.push("Use default");
  if (!required) actions.push("Omit");
  const action = await ui.select(title, actions);
  if (action === void 0) return { status: "cancelled" };
  if (action === "Use default") return { status: "collected", value: schema.default };
  if (action === "Omit") return { status: "collected", value: void 0 };
  const entered = await ui.input(title, current === void 0 ? void 0 : String(current));
  return entered === void 0 ? { status: "cancelled" } : { status: "collected", value: entered };
}
function coerceAndValidateFormValues(params, values) {
  const output = {};
  const required = new Set(params.requestedSchema.required ?? []);
  for (const [name, schema] of Object.entries(params.requestedSchema.properties)) {
    const value = values[name];
    if (value === void 0) {
      if (required.has(name)) throw new Error(`Missing required elicitation field: ${name}`);
      continue;
    }
    if (schema.type === "string") {
      const stringValue = String(value);
      const limits = schema;
      if (limits.minLength !== void 0 && stringValue.length < limits.minLength) {
        throw new Error(`Elicitation field ${name} is shorter than minimum length ${limits.minLength}`);
      }
      if (limits.maxLength !== void 0 && stringValue.length > limits.maxLength) {
        throw new Error(`Elicitation field ${name} is longer than maximum length ${limits.maxLength}`);
      }
      if ("enum" in schema && !schema.enum.includes(stringValue)) {
        throw new Error(`Elicitation field ${name} is not an allowed value`);
      }
      if ("oneOf" in schema && !schema.oneOf.some((option) => option.const === stringValue)) {
        throw new Error(`Elicitation field ${name} is not an allowed value`);
      }
      output[name] = stringValue;
      continue;
    }
    if (schema.type === "number" || schema.type === "integer") {
      if (typeof value === "string" && value.trim() === "") {
        throw new Error(`Elicitation field ${name} must be a number`);
      }
      const numberValue = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(numberValue)) throw new Error(`Elicitation field ${name} must be a number`);
      if (schema.type === "integer" && !Number.isInteger(numberValue)) {
        throw new Error(`Elicitation field ${name} must be an integer`);
      }
      if (schema.minimum !== void 0 && numberValue < schema.minimum) {
        throw new Error(`Elicitation field ${name} is below minimum ${schema.minimum}`);
      }
      if (schema.maximum !== void 0 && numberValue > schema.maximum) {
        throw new Error(`Elicitation field ${name} is above maximum ${schema.maximum}`);
      }
      output[name] = numberValue;
      continue;
    }
    if (schema.type === "boolean") {
      output[name] = typeof value === "boolean" ? value : value === "true";
      continue;
    }
    if (schema.type === "array") {
      if (!Array.isArray(value)) throw new Error(`Elicitation field ${name} must be a list`);
      const allowed = new Set(extractMultiSelectOptions(schema).map((option) => option.value));
      const arrayValue = value.map(String);
      if (schema.minItems !== void 0 && arrayValue.length < schema.minItems) {
        throw new Error(`Elicitation field ${name} has fewer than ${schema.minItems} selections`);
      }
      if (schema.maxItems !== void 0 && arrayValue.length > schema.maxItems) {
        throw new Error(`Elicitation field ${name} has more than ${schema.maxItems} selections`);
      }
      if (arrayValue.some((item) => !allowed.has(item))) {
        throw new Error(`Elicitation field ${name} contains an invalid selection`);
      }
      output[name] = arrayValue;
    }
  }
  const validation = new AjvJsonSchemaValidator2().getValidator(params.requestedSchema)(output);
  if (!validation.valid) {
    throw new Error(`Invalid elicitation response: ${validation.errorMessage}`);
  }
  return output;
}
function formatChoice(value, title) {
  return title && title !== value ? `${title} (${value})` : value;
}
function uniqueLabels(labels) {
  const used = /* @__PURE__ */ new Set();
  return labels.map((label) => {
    let unique = label;
    while (used.has(unique)) unique += "\u2026";
    used.add(unique);
    return unique;
  });
}
function uniqueAction(label, choices) {
  let unique = label;
  while (choices.includes(unique)) unique += "\u2026";
  return unique;
}
function extractMultiSelectOptions(schema) {
  const items = schema.items;
  return items.anyOf ? items.anyOf.map((option) => ({ value: option.const, display: formatChoice(option.const, option.title) })) : (items.enum ?? []).map((value) => ({ value, display: value }));
}
function formatReview(serverName, properties, content) {
  const rows = properties.map(([name, schema]) => `${schema.title ?? humanizeName(name)}: ${content[name] === void 0 ? "(omitted)" : String(content[name])}`);
  return [`Review input for ${serverName}`, "", ...rows].join("\n");
}
async function handleUrlElicitation(options, params) {
  if (!options.allowUrl) throw new ProtocolError(ProtocolErrorCode.InvalidParams, "URL elicitation is not supported");
  let parsed;
  try {
    parsed = new URL(params.url);
  } catch {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, "URL elicitation supplied an invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, "URL elicitation only supports HTTP and HTTPS URLs");
  }
  const decision = await options.ui.select([
    "MCP Browser Request",
    `Server: ${options.serverName}`,
    "",
    params.message,
    "",
    `Host: ${parsed.host}`,
    `Full URL: ${params.url}`,
    "",
    "Open this URL in your browser?"
  ].join("\n"), ["Open", "Decline"]);
  if (decision === void 0) return { action: "cancel" };
  if (decision === "Decline") return { action: "decline" };
  try {
    await open(params.url);
  } catch (error) {
    options.ui.notify(`Could not open MCP elicitation URL: ${error instanceof Error ? error.message : String(error)}`, "error");
    return { action: "cancel" };
  }
  options.onUrlAccepted?.(params.elicitationId);
  options.ui.notify("Opened browser for MCP elicitation.", "info");
  return { action: "accept" };
}
function humanizeName(name) {
  return name.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
}

// src/runtime/mcp-trace.ts
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { Buffer as Buffer2 } from "node:buffer";
import { dirname as dirname3, isAbsolute, resolve as resolve2 } from "node:path";
var MCP_TRACE_SCHEMA_VERSION = 1;
var DEFAULT_MCP_TRACE_MAX_BYTES = 256 * 1024;
var DEFAULT_MCP_TRACE_MAX_EVENTS = 1e4;
function boundedPositiveInteger(value, fallback) {
  if (!Number.isFinite(value) || value === void 0 || value <= 0) return fallback;
  return Math.floor(value);
}
function redactTraceText(value, maxLength = 160) {
  if (/\b(?:token|secret|password|passwd|api[_-]?key|authorization|cookie)\b/i.test(value)) {
    return "[REDACTED]";
  }
  let redacted = value.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi, "[REDACTED_URL]").replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED_AUTH]").replace(/\b(?:token|secret|password|passwd|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  if (redacted.length > maxLength) redacted = `${redacted.slice(0, maxLength - 1)}\u2026`;
  return redacted;
}
function messageKind(message) {
  if ("method" in message) return "id" in message ? "request" : "notification";
  return "response";
}
function traceId(value) {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return "[REDACTED_ID]";
  return void 0;
}
function messageBytes(message) {
  try {
    return Buffer2.byteLength(JSON.stringify(message), "utf8");
  } catch {
    return void 0;
  }
}
function createMcpTraceEvent(direction, server, transport, message, status, options) {
  const kind = messageKind(message);
  const bytes = messageBytes(message);
  const event = {
    version: MCP_TRACE_SCHEMA_VERSION,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    direction,
    server: redactTraceText(server, 120),
    transport,
    kind,
    status,
    ...bytes !== void 0 ? { bytes } : {}
  };
  if ("method" in message) event.method = redactTraceText(message.method, 120);
  if ("id" in message) event.id = traceId(message.id) ?? null;
  const relatedRequestId = traceId(options?.relatedRequestId);
  if (relatedRequestId !== void 0 && relatedRequestId !== null) event.relatedRequestId = relatedRequestId;
  if ("error" in message && message.error && typeof message.error.code === "number") {
    event.errorCode = message.error.code;
  }
  if (options?.durationMs !== void 0 && Number.isFinite(options.durationMs)) {
    event.durationMs = Math.max(0, Math.round(options.durationMs * 100) / 100);
  }
  return event;
}
var McpTraceWriter = class {
  constructor(options) {
    this.options = options;
    this.maxBytes = boundedPositiveInteger(options.maxBytes, DEFAULT_MCP_TRACE_MAX_BYTES);
    this.maxEvents = boundedPositiveInteger(options.maxEvents, DEFAULT_MCP_TRACE_MAX_EVENTS);
    this.append = options.appendFile ?? (async (path, data, appendOptions) => {
      await appendFile(path, data, appendOptions);
    });
    this.resetFile = options.writeFile ?? (async (path, data, writeOptions) => {
      await writeFile(path, data, writeOptions);
    });
    this.makeDirectory = options.mkdir ?? (async (path) => {
      await mkdir(path, { recursive: true });
      return void 0;
    });
    this.fileReady = this.makeDirectory(dirname3(this.options.filePath), { recursive: true }).then(() => this.resetFile(this.options.filePath, "", { encoding: "utf8" })).catch(() => {
      this.initializationFailed = true;
      this.disabled = true;
    });
  }
  options;
  maxBytes;
  maxEvents;
  append;
  resetFile;
  makeDirectory;
  bytesWritten = 0;
  eventsWritten = 0;
  queue = Promise.resolve();
  disabled = false;
  initializationFailed = false;
  fileReady;
  get filePath() {
    return this.options.filePath;
  }
  get isDisabled() {
    return this.disabled;
  }
  get stats() {
    return { bytes: this.bytesWritten, events: this.eventsWritten };
  }
  write(event) {
    if (this.disabled || this.eventsWritten >= this.maxEvents) return;
    let line;
    try {
      line = `${JSON.stringify(event)}
`;
    } catch {
      this.disabled = true;
      return;
    }
    const bytes = Buffer2.byteLength(line, "utf8");
    if (bytes > this.maxBytes - this.bytesWritten) {
      this.disabled = true;
      return;
    }
    this.bytesWritten += bytes;
    this.eventsWritten += 1;
    this.queue = this.queue.then(async () => {
      await this.fileReady;
      if (this.initializationFailed) return;
      await this.append(this.options.filePath, line, { encoding: "utf8" });
    }).catch(() => {
      this.disabled = true;
    });
  }
  async flush() {
    await this.fileReady;
    await this.queue;
  }
};
function createMcpTraceWriter(sessionCwd, settings = {}, randomSuffix = Math.random().toString(36).slice(2, 10)) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const configuredPath = settings.file;
  const filePath = configuredPath ? isAbsolute(configuredPath) ? configuredPath : resolve2(sessionCwd ?? process.cwd(), configuredPath) : resolve2(sessionCwd ?? process.cwd(), ".pi", "mcp-traces", `mcp-${timestamp}-${randomSuffix}.jsonl`);
  return new McpTraceWriter({
    filePath,
    ...settings.maxBytes !== void 0 ? { maxBytes: settings.maxBytes } : {},
    ...settings.maxEvents !== void 0 ? { maxEvents: settings.maxEvents } : {}
  });
}
function isMcpTraceEnabled(definition, settings) {
  return definition.trace ?? settings?.enabled === true;
}
function wrapTransportWithMcpTrace(transport, server, transportKind, observer) {
  let messageHandler = transport.onmessage;
  let tracedMessageHandler;
  const originalSend = transport.send;
  const record = (event) => {
    try {
      observer.record(event);
    } catch {
    }
  };
  try {
    Object.defineProperty(transport, "onmessage", {
      configurable: true,
      enumerable: true,
      get() {
        return tracedMessageHandler;
      },
      set(handler) {
        messageHandler = handler;
        tracedMessageHandler = handler ? ((message, extra) => {
          record(createMcpTraceEvent("inbound", server, transportKind, message, "received"));
          handler(message, extra);
        }) : void 0;
      }
    });
    transport.onmessage = messageHandler;
  } catch {
  }
  transport.send = async (message, options) => {
    const started = performance.now();
    const messages = Array.isArray(message) ? message : [message];
    try {
      await originalSend.call(transport, message, options);
      for (const item of messages) {
        record(createMcpTraceEvent("outbound", server, transportKind, item, "sent", {
          durationMs: performance.now() - started
        }));
      }
    } catch (error) {
      for (const item of messages) {
        record(createMcpTraceEvent("outbound", server, transportKind, item, "error", {
          durationMs: performance.now() - started
        }));
      }
      throw error;
    }
  };
  return transport;
}
function traceTransportKind(definition, transport) {
  if (definition.command) return "stdio";
  if (definition.socket) return "unix-socket";
  const constructorName = transport.constructor?.name.toLowerCase() ?? "";
  if (constructorName.includes("sse")) return "sse";
  if (constructorName.includes("streamable")) return "streamable-http";
  return definition.url ? "streamable-http" : "unknown";
}

// src/runtime/request-headers-command.ts
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
var DEFAULT_TIMEOUT_MS = 1e4;
var MAX_OUTPUT_BYTES = 64 * 1024;
var USE_PROCESS_GROUP = process.platform !== "win32";
var CLEANUP_TOKEN_ENV = "PI_MCP_REQUEST_HEADERS_CLEANUP_TOKEN";
var PS_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
function isNoSuchProcessError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}
function runPosixPs(args) {
  if (process.env.PI_MCP_ADAPTER_TEST_FAIL_PS === "1") return { status: 1, signal: null, stdout: "" };
  const result = spawnSync("ps", args, { encoding: "utf8", maxBuffer: PS_MAX_BUFFER_BYTES });
  return { status: result.status, signal: result.signal, stdout: result.stdout };
}
function psFailureReason(result) {
  return result.status === null ? `ps was killed by signal ${result.signal ?? "unknown"}` : `ps exited with code ${result.status}`;
}
function collectPosixProcessPids(rootPid, cleanupToken) {
  const result = runPosixPs(["axeww", "-o", "pid=,ppid=,command="]);
  if (result.status !== 0) {
    throw new Error(`HTTP request headers command cleanup failed: ${psFailureReason(result)}`);
  }
  const childrenByParent = /* @__PURE__ */ new Map();
  const processPids = /* @__PURE__ */ new Set();
  const needle = cleanupToken ? `${CLEANUP_TOKEN_ENV}=${cleanupToken}` : void 0;
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)(?:\s+(.*))?$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    const children = childrenByParent.get(ppid);
    if (children) children.push(pid);
    else childrenByParent.set(ppid, [pid]);
    if (needle && pid !== process.pid && match[3]?.includes(needle)) processPids.add(pid);
  }
  const stack = [...childrenByParent.get(rootPid) ?? []];
  while (stack.length > 0) {
    const pid = stack.pop();
    processPids.add(pid);
    stack.push(...childrenByParent.get(pid) ?? []);
  }
  return [...processPids];
}
function assertPosixProcessDiscoveryAvailable() {
  const result = runPosixPs(["axeww", "-o", "pid=,ppid=,command="]);
  if (result.status !== 0) {
    throw new Error(`HTTP request headers command cleanup failed: ${psFailureReason(result)}`);
  }
}
function isTaskkillNoSuchProcess(result) {
  return `${result.stdout ?? ""}
${result.stderr ?? ""}`.toLowerCase().includes("not found");
}
function signalPid(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!isNoSuchProcessError(error)) throw error;
  }
}
function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!isNoSuchProcessError(error)) throw error;
  }
}
function killRequestHeadersCommand(child, trackedPosixDescendantPids = /* @__PURE__ */ new Set(), cleanupToken) {
  if (process.platform === "win32" && child.pid !== void 0) {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true
    });
    if (result.status === 0 || isTaskkillNoSuchProcess(result)) return;
    throw new Error(`HTTP request headers command cleanup failed: taskkill exited with code ${result.status ?? "unknown"}`);
  }
  if (USE_PROCESS_GROUP && child.pid !== void 0) {
    const frozenPids = /* @__PURE__ */ new Set();
    let cleanupError;
    try {
      signalProcessGroup(child.pid, "SIGSTOP");
      for (const pid of trackedPosixDescendantPids) {
        signalPid(pid, "SIGSTOP");
        frozenPids.add(pid);
      }
      let stablePasses = 0;
      for (let pass = 0; pass < 16; pass++) {
        const candidates = collectPosixProcessPids(child.pid, cleanupToken);
        const newPids = candidates.filter((pid) => !frozenPids.has(pid));
        if (newPids.length === 0) {
          stablePasses++;
          if (stablePasses >= 2) return;
          continue;
        }
        stablePasses = 0;
        for (const pid of newPids) {
          signalPid(pid, "SIGSTOP");
          frozenPids.add(pid);
        }
      }
      cleanupError = new Error("HTTP request headers command cleanup failed: descendant process tree did not stabilize");
    } catch (error) {
      cleanupError = error instanceof Error ? error : new Error(String(error));
    } finally {
      signalProcessGroup(child.pid, "SIGKILL");
      for (const pid of frozenPids) signalPid(pid, "SIGKILL");
    }
    if (cleanupError) throw cleanupError;
    return;
  }
  child.kill("SIGKILL");
}
function resolvedCommand(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("HTTP request headers command must be an object");
  }
  if (typeof config.command !== "string" || config.command.trim() === "") {
    throw new Error("HTTP request headers command requires a non-empty command");
  }
  if (config.args !== void 0 && (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== "string"))) {
    throw new Error("HTTP request headers command args must be strings");
  }
  if (config.env !== void 0 && (typeof config.env !== "object" || Array.isArray(config.env) || Object.values(config.env).some((value) => typeof value !== "string"))) {
    throw new Error("HTTP request headers command env values must be strings");
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 6e4) {
    throw new Error("HTTP request headers command timeoutMs must be an integer between 1 and 60000");
  }
  return {
    command: interpolateEnvVars(config.command),
    args: (config.args ?? []).map(interpolateEnvVars),
    env: {
      ...process.env,
      ...Object.fromEntries(
        Object.entries(config.env ?? {}).map(([key, value]) => [key, interpolateEnvVars(value)])
      )
    },
    timeoutMs
  };
}
async function invokeRequestHeadersCommand(config, envelope, signal) {
  const resolved = resolvedCommand(config);
  if (USE_PROCESS_GROUP) assertPosixProcessDiscoveryAvailable();
  return new Promise((resolve3, reject) => {
    let stdout = Buffer.alloc(0);
    let settled = false;
    const cleanupToken = randomUUID();
    const child = spawn(resolved.command, resolved.args, {
      env: { ...resolved.env, [CLEANUP_TOKEN_ENV]: cleanupToken },
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      detached: USE_PROCESS_GROUP
    });
    const trackedPosixDescendantPids = /* @__PURE__ */ new Set();
    let trackingError;
    const trackPosixDescendants = () => {
      if (!USE_PROCESS_GROUP || child.pid === void 0 || settled || trackingError) return;
      try {
        for (const pid of collectPosixProcessPids(child.pid, cleanupToken)) trackedPosixDescendantPids.add(pid);
      } catch (error) {
        trackingError = error instanceof Error ? error : new Error(String(error));
      }
    };
    const descendantTracker = USE_PROCESS_GROUP ? setInterval(trackPosixDescendants, 50) : void 0;
    descendantTracker?.unref();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (descendantTracker) clearInterval(descendantTracker);
      signal.removeEventListener("abort", abort);
      if (result.status === "error") reject(result.error);
      else resolve3(result.headers);
    };
    const finishAfterKill = (result) => {
      try {
        killRequestHeadersCommand(child, trackedPosixDescendantPids, cleanupToken);
        finish(result);
      } catch (cleanupError) {
        finish({ status: "error", error: cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)) });
      }
    };
    const failAfterKill = (message) => {
      finishAfterKill({ status: "error", error: trackingError ?? new Error(message) });
    };
    const abort = () => {
      failAfterKill("HTTP request headers command aborted");
    };
    const timer = setTimeout(() => {
      failAfterKill(`HTTP request headers command timed out after ${resolved.timeoutMs}ms`);
    }, resolved.timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    child.on("error", () => finish({ status: "error", error: new Error("HTTP request headers command failed to start") }));
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
      if (stdout.byteLength > MAX_OUTPUT_BYTES) {
        failAfterKill("HTTP request headers command output exceeded 64 KiB");
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      if (trackingError) {
        failAfterKill(trackingError.message);
        return;
      }
      if (code !== 0) {
        failAfterKill(`HTTP request headers command exited with code ${code ?? "unknown"}`);
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(stdout.toString("utf8"));
      } catch {
        finishAfterKill({ status: "error", error: new Error("HTTP request headers command returned invalid JSON") });
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        finishAfterKill({ status: "error", error: new Error("HTTP request headers command must return a JSON object") });
        return;
      }
      const entries = Object.entries(parsed);
      if (entries.some(([, value]) => typeof value !== "string")) {
        finishAfterKill({ status: "error", error: new Error("HTTP request headers command values must be strings") });
        return;
      }
      try {
        finishAfterKill({ status: "success", headers: new Headers(entries) });
      } catch {
        finishAfterKill({ status: "error", error: new Error("HTTP request headers command returned an invalid header") });
      }
    });
    child.stdin.on("error", () => {
    });
    child.stdin.end(JSON.stringify(envelope));
  });
}
function createRequestHeadersCommandFetch(config, delegate = globalThis.fetch) {
  resolvedCommand(config);
  return async (input, init) => {
    const request = new Request(input, init);
    const body = Buffer.from(await request.clone().arrayBuffer());
    const derived = await invokeRequestHeadersCommand(config, {
      version: 1,
      method: request.method.toUpperCase(),
      url: request.url,
      bodyBase64: body.toString("base64")
    }, request.signal);
    const headers = new Headers(request.headers);
    derived.forEach((value, name) => headers.set(name, value));
    return delegate(new URL(request.url), {
      method: request.method,
      headers,
      ...request.method === "GET" || request.method === "HEAD" ? {} : { body },
      signal: request.signal,
      cache: request.cache,
      credentials: request.credentials,
      integrity: request.integrity,
      keepalive: request.keepalive,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy
    });
  };
}

// src/runtime/server-manager.ts
var MAX_CAPTURED_STDERR_BYTES = 8 * 1024;
var MAX_CAPTURED_STDERR_LINES = 3;
var abortCleanupPromises = /* @__PURE__ */ new WeakMap();
function isUnauthorizedHttpError(error) {
  return error instanceof UnauthorizedError || error instanceof SdkHttpError && error.status === 401;
}
function shouldFallbackToSse(error, definition) {
  if (definition.protocolVersion === "2026-07-28") return false;
  return error instanceof SdkHttpError && [404, 405, 406, 415].includes(error.status);
}
function resolveVersionNegotiation(definition) {
  switch (definition.protocolVersion) {
    case void 0:
    case "legacy":
      return void 0;
    case "auto":
      return { mode: "auto" };
    case "2026-07-28":
      return { mode: { pin: "2026-07-28" } };
    default:
      throw new Error(`Invalid MCP protocolVersion: ${String(definition.protocolVersion)}`);
  }
}
function boundedStderrChunk(chunk) {
  if (Buffer.isBuffer(chunk)) {
    const start = Math.max(0, chunk.byteLength - MAX_CAPTURED_STDERR_BYTES);
    return Buffer.from(chunk.subarray(start));
  }
  const suffix = chunk.length > MAX_CAPTURED_STDERR_BYTES ? chunk.slice(-MAX_CAPTURED_STDERR_BYTES) : chunk;
  const bytes = Buffer.from(suffix, "utf8");
  return bytes.byteLength > MAX_CAPTURED_STDERR_BYTES ? Buffer.from(bytes.subarray(bytes.byteLength - MAX_CAPTURED_STDERR_BYTES)) : bytes;
}
function appendStderrTail(tail, chunk) {
  const bytes = boundedStderrChunk(chunk);
  if (bytes.length === 0) return tail;
  if (tail.length === 0) return bytes;
  const combined = Buffer.concat([tail, bytes]);
  return combined.length > MAX_CAPTURED_STDERR_BYTES ? Buffer.from(combined.subarray(combined.length - MAX_CAPTURED_STDERR_BYTES)) : combined;
}
var KEEP_ALIVE_REFRESH_TIMEOUT_MS = 5e3;
function isTransientHttpConnectError(error) {
  let current = error;
  while (current instanceof Error) {
    if (current instanceof SdkHttpError && current.status === 503) return true;
    current = current.cause;
  }
  return false;
}
var McpServerManager = class {
  /** Default cwd for stdio servers without an explicit config `cwd`. */
  constructor(defaultCwd) {
    this.defaultCwd = defaultCwd;
  }
  defaultCwd;
  connections = /* @__PURE__ */ new Map();
  connectPromises = /* @__PURE__ */ new Map();
  reconnectPromises = /* @__PURE__ */ new Map();
  uiStreamListeners = /* @__PURE__ */ new Map();
  samplingConfig;
  metadataListChangedListener;
  pendingMetadataPublications = /* @__PURE__ */ new Map();
  elicitationConfig;
  authStorageOptions = {};
  oauthRuntime;
  acceptedUrlElicitations = /* @__PURE__ */ new Map();
  defaultRequestTimeoutMs;
  runtimeSignal;
  closePromises = /* @__PURE__ */ new Map();
  closeGenerations = /* @__PURE__ */ new Map();
  connectAttempts = /* @__PURE__ */ new Map();
  traceSettings;
  traceWriter;
  stopped = false;
  setSamplingConfig(config) {
    this.samplingConfig = config;
  }
  setMetadataListChangedListener(listener) {
    this.metadataListChangedListener = listener;
  }
  publishMetadataChanged(name, expectedConnection, reason) {
    const current = this.connections.get(name);
    if (current !== expectedConnection || current.status !== "connected") return false;
    try {
      this.metadataListChangedListener?.(name, reason);
      this.pendingMetadataPublications.delete(name);
      return true;
    } catch (error) {
      this.pendingMetadataPublications.set(name, { connection: expectedConnection, reason });
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(`MCP: metadata publication failed for ${name}; queued for retry: ${message}`);
      return false;
    }
  }
  setElicitationConfig(config) {
    this.elicitationConfig = config;
  }
  setRuntimeSignal(signal) {
    this.runtimeSignal = signal;
  }
  setDefaultRequestTimeoutMs(timeoutMs) {
    this.defaultRequestTimeoutMs = normalizeRequestTimeoutMs(timeoutMs);
  }
  setTraceConfig(settings) {
    this.traceSettings = settings;
  }
  setAuthStorageOptions(options) {
    this.authStorageOptions = options;
  }
  setOAuthRuntime(runtime) {
    this.oauthRuntime = runtime;
  }
  getRequestOptions(name, signal) {
    const connection = this.connections.get(name);
    return this.buildRequestOptions(connection?.definition, signal);
  }
  getResolvedRequestTimeoutMs(definition) {
    if (definition?.requestTimeoutMs !== void 0) {
      return normalizeRequestTimeoutMs(definition.requestTimeoutMs);
    }
    return this.defaultRequestTimeoutMs;
  }
  buildRequestOptions(definition, signal) {
    const timeout = this.getResolvedRequestTimeoutMs(definition);
    const ownedSignal = combineAbortSignals(this.runtimeSignal, signal);
    if (!ownedSignal && timeout === void 0) {
      return void 0;
    }
    return {
      ...ownedSignal ? { signal: ownedSignal } : {},
      ...timeout !== void 0 ? { timeout } : {}
    };
  }
  async connect(name, definition, signal) {
    if (isServerDisabled(definition)) throw new Error(`MCP server "${name}" is disabled`);
    if (this.stopped) throw new Error("MCP server manager is closed");
    const ownedSignal = combineAbortSignals(this.runtimeSignal, signal);
    throwIfAborted(ownedSignal);
    const closing = this.closePromises.get(name);
    if (closing) await abortable(closing, ownedSignal);
    throwIfAborted(ownedSignal);
    if (this.connectPromises.has(name)) {
      return abortable(this.connectPromises.get(name), ownedSignal);
    }
    const existing = this.connections.get(name);
    if (existing?.status === "connected") {
      existing.lastUsedAt = Date.now();
      return existing;
    }
    const credentialsInvalidated = existing?.status === "needs-auth" && existing.credentialsInvalidated === true;
    const generation = this.closeGenerations.get(name) ?? 0;
    const attemptController = new AbortController();
    const attemptSignal = combineAbortSignals(ownedSignal, attemptController.signal);
    const connectionAttempt = this.createConnection(name, definition, attemptSignal, ownedSignal, credentialsInvalidated);
    const promise = definition.url ? connectionAttempt.catch(async (error) => {
      throw await this.enrichHttpConnectionError(definition, error);
    }) : connectionAttempt;
    this.connectPromises.set(name, promise);
    this.connectAttempts.set(name, attemptController);
    try {
      const connection = await promise;
      if (attemptController.signal.aborted || (this.closeGenerations.get(name) ?? 0) !== generation) {
        await this.disposeConnection(connection);
        throwIfAborted(attemptSignal);
        throw new Error(`MCP connection for ${name} was closed while connecting`);
      }
      this.connections.set(name, connection);
      return connection;
    } finally {
      if (this.connectPromises.get(name) === promise) this.connectPromises.delete(name);
      if (this.connectAttempts.get(name) === attemptController) this.connectAttempts.delete(name);
    }
  }
  /**
   * Reconnect a server whose connection was proven stale (e.g. by a 404
   * "session no longer exists" response). Single-flight per server name —
   * concurrent callers that raced to the same failure share one reconnect —
   * and identity-guarded: `staleConnection` is only torn down if it is
   * still the manager's current connection for `name`. If a concurrent
   * reconnect (or an unrelated connect()) already replaced it with a fresh
   * connection, that fresh connection is returned untouched.
   */
  async reconnect(name, definition, staleConnection, signal) {
    if (isServerDisabled(definition)) throw new Error(`MCP server "${name}" is disabled`);
    if (this.stopped) throw new Error("MCP server manager is closed");
    const ownedSignal = combineAbortSignals(this.runtimeSignal, signal);
    throwIfAborted(ownedSignal);
    const inFlight = this.reconnectPromises.get(name);
    if (inFlight) {
      return abortable(inFlight, ownedSignal);
    }
    const promise = this.doReconnect(name, definition, staleConnection, ownedSignal).finally(() => {
      if (this.reconnectPromises.get(name) === promise) {
        this.reconnectPromises.delete(name);
      }
    });
    this.reconnectPromises.set(name, promise);
    return abortable(promise, ownedSignal);
  }
  /**
   * Fetch the authoritative tool catalog for a connection that still appears
   * connected. The SDK response cache is explicitly bypassed so this request
   * also proves the remote Streamable HTTP session is usable. Results are
   * identity-guarded: a late response from a replaced connection is ignored.
   */
  async refreshTools(name, expectedConnection, signal) {
    if (this.stopped) throw new Error("MCP server manager is closed");
    const ownedSignal = combineAbortSignals(this.runtimeSignal, signal);
    throwIfAborted(ownedSignal);
    const current = this.connections.get(name);
    if (current !== expectedConnection || current.status !== "connected") {
      return "superseded";
    }
    const requestOptions = this.buildRequestOptions(expectedConnection.definition, signal);
    const timeout = Math.min(requestOptions?.timeout ?? KEEP_ALIVE_REFRESH_TIMEOUT_MS, KEEP_ALIVE_REFRESH_TIMEOUT_MS);
    const healthOptions = {
      ...requestOptions,
      timeout
    };
    if (!expectedConnection.client.getServerCapabilities?.()?.tools) {
      await expectedConnection.client.ping(healthOptions);
      throwIfAborted(ownedSignal);
      if (this.connections.get(name) !== expectedConnection || expectedConnection.status !== "connected") {
        return "superseded";
      }
      this.retryPendingMetadataPublication(name, expectedConnection);
      return "unchanged";
    }
    const toolsRevision = expectedConnection.toolsRevision ?? 0;
    const refreshSignal = combineAbortSignals(healthOptions.signal, AbortSignal.timeout(timeout));
    let tools;
    try {
      tools = await this.fetchAllTools(expectedConnection.client, {
        ...healthOptions,
        ...refreshSignal ? { signal: refreshSignal } : {},
        cacheMode: "refresh"
      });
    } catch (error) {
      throwIfAborted(ownedSignal);
      if (this.connections.get(name) !== expectedConnection || expectedConnection.status !== "connected") {
        return "superseded";
      }
      if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) {
        return "refresh-timeout";
      }
      throw error;
    }
    throwIfAborted(ownedSignal);
    if (this.connections.get(name) !== expectedConnection || expectedConnection.status !== "connected") {
      return "superseded";
    }
    if ((expectedConnection.toolsRevision ?? 0) !== toolsRevision) {
      return "superseded";
    }
    if (isDeepStrictEqual(expectedConnection.tools, tools)) {
      this.retryPendingMetadataPublication(name, expectedConnection);
      return "unchanged";
    }
    const previousTools = expectedConnection.tools;
    expectedConnection.tools = tools;
    expectedConnection.toolsRevision = toolsRevision + 1;
    try {
      await this.metadataListChangedListener?.(name, "keep-alive-refresh");
      this.pendingMetadataPublications.delete(name);
    } catch (error) {
      if (this.connections.get(name) === expectedConnection && expectedConnection.tools === tools) {
        expectedConnection.tools = previousTools;
        expectedConnection.toolsRevision = toolsRevision;
      }
      throw error;
    }
    return "updated";
  }
  retryPendingMetadataPublication(name, connection) {
    const pendingPublication = this.pendingMetadataPublications.get(name);
    if (pendingPublication?.connection !== connection) return;
    this.metadataListChangedListener?.(name, pendingPublication.reason);
    if (this.pendingMetadataPublications.get(name) === pendingPublication) {
      this.pendingMetadataPublications.delete(name);
    }
  }
  async doReconnect(name, definition, staleConnection, signal) {
    throwIfAborted(signal);
    const current = this.connections.get(name);
    if (current !== staleConnection) {
      return current ?? this.connect(name, definition, signal);
    }
    const staleInFlight = staleConnection.inFlight;
    await this.close(name);
    const fresh = await this.connect(name, definition, signal);
    fresh.inFlight = Math.max(fresh.inFlight, staleInFlight);
    return fresh;
  }
  async createConnection(name, definition, signal, requestSignal, credentialsInvalidated = false) {
    throwIfAborted(signal);
    const tracingEnabled = isMcpTraceEnabled(definition, this.traceSettings);
    const traceWriter = tracingEnabled ? this.traceWriter ??= createMcpTraceWriter(this.defaultCwd, this.traceSettings ?? {}) : void 0;
    const traceObserver = traceWriter ? { record: (event) => traceWriter.write(event) } : void 0;
    let client;
    let transport;
    let clientConnected = false;
    let invalidated = credentialsInvalidated;
    let transportAlreadyTraced = false;
    let stderrTail = Buffer.alloc(0);
    const configuredTransports = [definition.command, definition.url, definition.socket].filter((value) => typeof value === "string" && value.length > 0);
    if (configuredTransports.length !== 1) {
      throw new Error(`Server ${name} must configure exactly one of command, url, or socket`);
    }
    const requestOptions = this.buildRequestOptions(definition, requestSignal);
    if (definition.command) {
      client = this.createClient(name, definition);
      let command = definition.command;
      let args = (definition.args ?? []).map((argument) => interpolateEnvVars(argument));
      if (command === "npx" || command === "npm") {
        const resolved = await resolveNpxBinary(command, args, signal);
        if (resolved) {
          command = resolved.isJs ? "node" : resolved.binPath;
          args = resolved.isJs ? [resolved.binPath, ...resolved.extraArgs] : resolved.extraArgs;
          logger.debug(`${name} resolved to ${resolved.binPath} (skipping npm parent)`);
        }
      }
      throwIfAborted(signal);
      if (definition.pluginDataDir) mkdirSync2(definition.pluginDataDir, { recursive: true });
      const cwd = resolveConfigPath(definition.cwd) ?? this.defaultCwd;
      const stdioTransport = new StdioClientTransport({
        command,
        args,
        env: resolveEnv(definition.env, name, definition.literalEnv === true),
        ...cwd !== void 0 ? { cwd } : {},
        stderr: definition.debug ? "inherit" : "pipe"
      });
      if (stdioTransport.stderr) {
        stdioTransport.stderr.on("data", (chunk) => {
          stderrTail = appendStderrTail(stderrTail, chunk);
        });
      }
      transport = stdioTransport;
    } else if (definition.url) {
      const httpConnection = await this.connectHttpClient(
        definition,
        name,
        requestOptions,
        signal,
        traceObserver,
        invalidated
      );
      client = httpConnection.client;
      transport = httpConnection.transport;
      invalidated = httpConnection.credentialsInvalidated;
      if (httpConnection.status === "needs-auth") {
        return {
          client,
          transport,
          definition,
          tools: [],
          resources: [],
          prompts: [],
          lastUsedAt: Date.now(),
          inFlight: 0,
          status: "needs-auth",
          credentialsInvalidated: invalidated
        };
      }
      clientConnected = true;
      transportAlreadyTraced = traceObserver !== void 0;
    } else {
      client = this.createClient(name, definition);
      transport = new UnixSocketClientTransport(resolveConfigPath(definition.socket));
    }
    if (traceObserver && !transportAlreadyTraced) {
      const traceTransportKindValue = traceTransportKind(definition, transport);
      transport = wrapTransportWithMcpTrace(transport, name, traceTransportKindValue, traceObserver);
    }
    try {
      throwIfAborted(signal);
      if (!clientConnected) {
        await this.connectClientWithAbort(client, transport, requestOptions, signal);
      }
      this.attachAdapterNotificationHandlers(name, client);
      const instructions = client.getInstructions?.();
      const connection = {
        client,
        transport,
        definition,
        tools: [],
        toolsRevision: 0,
        resources: [],
        prompts: [],
        ...instructions !== void 0 ? { instructions } : {},
        lastUsedAt: Date.now(),
        inFlight: 0,
        status: "connected"
      };
      client.onclose = () => {
        if (this.connections.get(name) === connection) {
          connection.status = "closed";
        }
      };
      const [tools, resources, promptResult] = await Promise.all([
        this.fetchAllTools(client, requestOptions),
        this.fetchAllResources(client, requestOptions),
        this.fetchAllPrompts(client, requestOptions)
      ]);
      connection.tools = tools;
      connection.resources = resources;
      connection.prompts = promptResult.prompts;
      connection.promptDiscoveryFailed = promptResult.failed;
      return connection;
    } catch (error) {
      const abortCleanup = abortCleanupPromises.get(transport);
      const abortCleanupFailed = error instanceof AggregateError && error.message === "MCP connection abort cleanup failed";
      const cleanupResults = abortCleanupFailed ? [] : await Promise.allSettled([
        abortCleanup ?? Promise.resolve().then(() => client.close())
      ]);
      const cleanupFailures = cleanupResults.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      let reportedError = error;
      if (cleanupFailures.length > 0) {
        reportedError = new AggregateError([error, ...cleanupFailures], "MCP connection setup failed");
      }
      if (isUnauthorizedHttpError(error) && supportsOAuth(definition) && cleanupFailures.length === 0) {
        if (!invalidated) {
          invalidateAuthEntryCache(name);
          invalidated = true;
        }
        return {
          client,
          transport,
          definition,
          tools: [],
          resources: [],
          prompts: [],
          lastUsedAt: Date.now(),
          inFlight: 0,
          status: "needs-auth",
          credentialsInvalidated: invalidated
        };
      }
      if (stderrTail.length > 0) {
        const stderrText = stderrTail.toString("utf8").trim();
        const lines = stderrText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (lines.length > 0) {
          const baseMessage = reportedError instanceof Error ? reportedError.message : String(reportedError);
          const detail = lines.slice(-MAX_CAPTURED_STDERR_LINES).join(" \u2014 ");
          throw new Error(`${baseMessage} (${detail})`, { cause: reportedError });
        }
      }
      throw reportedError;
    }
  }
  async enrichHttpConnectionError(definition, error) {
    const originalMessage = error instanceof Error ? error.message : String(error);
    if (isTransientHttpConnectError(error)) {
      return new Error(`${originalMessage} \u2014 endpoint is temporarily unavailable (HTTP 503)`, { cause: error });
    }
    try {
      const probe2 = await probeMcpEndpoint(resolveServerUrl(definition));
      return new Error(`${originalMessage} \u2014 probe: ${probe2.classification}`, { cause: error });
    } catch {
      return error instanceof Error ? error : new Error(originalMessage);
    }
  }
  async connectClientWithAbort(client, transport, requestOptions, signal) {
    throwIfAborted(signal);
    let abortCleanup;
    const closeTransport = () => {
      abortCleanup = Promise.resolve().then(() => transport.close());
      abortCleanupPromises.set(transport, abortCleanup);
    };
    signal?.addEventListener("abort", closeTransport, { once: true });
    try {
      await abortable(client.connect(transport, requestOptions), signal);
      await abortCleanup;
    } catch (error) {
      if (abortCleanup) {
        try {
          await abortCleanup;
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "MCP connection abort cleanup failed");
        }
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", closeTransport);
    }
  }
  buildClientCapabilities() {
    return {
      ...this.samplingConfig ? { sampling: {} } : {},
      ...this.elicitationConfig ? {
        elicitation: {
          form: {},
          ...this.elicitationConfig.allowUrl ? { url: {} } : {}
        }
      } : {}
    };
  }
  createClient(serverName, definition) {
    const capabilities = this.buildClientCapabilities();
    const versionNegotiation = resolveVersionNegotiation(definition);
    let client;
    client = new Client(
      { name: `pi-mcp-${serverName}`, version: "1.0.0" },
      {
        jsonSchemaValidator: createJsonSchemaValidator(),
        ...versionNegotiation ? { versionNegotiation } : {},
        ...Object.keys(capabilities).length > 0 ? { capabilities } : {},
        listChanged: {
          tools: {
            onChanged: (error, tools) => {
              this.handleToolsListChanged(serverName, client, error, tools);
            }
          },
          resources: {
            onChanged: (error, resources) => {
              this.handleResourcesListChanged(serverName, client, error, resources);
            }
          },
          prompts: {
            onChanged: (error, prompts) => {
              this.handlePromptsListChanged(serverName, client, error, prompts);
            }
          }
        }
      }
    );
    if (this.samplingConfig) {
      registerSamplingHandler(client, { ...this.samplingConfig, serverName });
    }
    if (this.elicitationConfig) {
      registerElicitationHandler(client, {
        ...this.elicitationConfig,
        serverName,
        onUrlAccepted: (elicitationId) => this.rememberUrlElicitation(serverName, elicitationId)
      });
      if (this.elicitationConfig.allowUrl) {
        client.setNotificationHandler("notifications/elicitation/complete", (notification) => {
          if (this.runtimeSignal?.aborted) return;
          const accepted = this.acceptedUrlElicitations.get(serverName);
          if (!accepted?.delete(notification.params.elicitationId)) return;
          this.elicitationConfig?.ui.notify(
            `MCP browser interaction for ${serverName} completed. You can retry the tool now.`,
            "info"
          );
        });
      }
    }
    return client;
  }
  handleToolsListChanged(serverName, client, error, tools) {
    if (error) {
      logger.debug(`MCP: tools/list_changed refresh failed for ${serverName}: ${error.message}`);
      return;
    }
    if (!tools) return;
    const connection = this.connections.get(serverName);
    if (!connection || connection.client !== client || connection.status !== "connected") return;
    connection.tools = tools;
    connection.toolsRevision = (connection.toolsRevision ?? 0) + 1;
    this.metadataListChangedListener?.(serverName, "tools-list-changed");
    this.pendingMetadataPublications.delete(serverName);
  }
  handlePromptsListChanged(serverName, client, error, prompts) {
    if (error) {
      logger.debug(`MCP: prompts/list_changed refresh failed for ${serverName}: ${error.message}`);
      return;
    }
    if (!prompts) return;
    const connection = this.connections.get(serverName);
    if (!connection || connection.client !== client || connection.status !== "connected") return;
    connection.prompts = prompts;
    connection.promptDiscoveryFailed = false;
    this.metadataListChangedListener?.(serverName, "prompts-list-changed");
    this.pendingMetadataPublications.delete(serverName);
  }
  handleResourcesListChanged(serverName, client, error, resources) {
    if (error) {
      logger.debug(`MCP: resources/list_changed refresh failed for ${serverName}: ${error.message}`);
      return;
    }
    if (!resources) return;
    const connection = this.connections.get(serverName);
    if (!connection || connection.client !== client || connection.status !== "connected") return;
    connection.resources = resources;
    this.metadataListChangedListener?.(serverName, "resources-list-changed");
    this.pendingMetadataPublications.delete(serverName);
  }
  async handleUrlElicitationRequired(serverName, error) {
    if (this.runtimeSignal?.aborted || !this.elicitationConfig?.allowUrl) return "cancel";
    for (const params of error.elicitations) {
      const result = await handleUrlElicitation({
        ...this.elicitationConfig,
        serverName,
        onUrlAccepted: (elicitationId) => this.rememberUrlElicitation(serverName, elicitationId)
      }, params);
      if (result.action !== "accept") return result.action;
    }
    return "accept";
  }
  rememberUrlElicitation(serverName, elicitationId) {
    if (this.runtimeSignal?.aborted) return;
    let accepted = this.acceptedUrlElicitations.get(serverName);
    if (!accepted) {
      accepted = /* @__PURE__ */ new Set();
      this.acceptedUrlElicitations.set(serverName, accepted);
    }
    accepted.add(elicitationId);
  }
  async connectHttpClient(definition, serverName, requestOptions, signal, traceObserver, credentialsInvalidated = false) {
    throwIfAborted(signal);
    const serverUrl = resolveServerUrl(definition);
    const url = new URL(serverUrl);
    const hasCommandHeader = Object.values(definition.headers ?? {}).some((value) => value.startsWith("!") && !value.startsWith("!!"));
    const headers = resolveCommandSecretsRecord(
      definition.headers,
      (key) => `MCP server "${serverName}" HTTP header "${key}"`
    ) ?? {};
    const commandBearer = definition.bearerToken?.startsWith("!") && !definition.bearerToken.startsWith("!!") ? definition.bearerToken : void 0;
    if (definition.auth === "bearer") {
      const token = commandBearer ? resolveCommandSecret(commandBearer, `MCP server "${serverName}" HTTP bearer token`) : resolveBearerToken(definition) ?? (definition.bearerToken === void 0 && definition.bearerTokenEnv === void 0 && definition.bearerTokenStore === true ? getBearerTokenForUrl(serverName, serverUrl) : void 0);
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    if (hasCommandHeader || commandBearer) {
      try {
        new Headers(headers);
      } catch {
        throw new Error(`Failed to resolve MCP server "${serverName}" HTTP command secret: command returned an invalid header value`);
      }
    }
    const requestInit = Object.keys(headers).length > 0 ? { headers } : void 0;
    const requestFetch = definition.requestHeadersCommand ? createRequestHeadersCommandFetch(definition.requestHeadersCommand) : void 0;
    const createAuthProvider = () => new McpOAuthProvider(
      serverName,
      serverUrl,
      extractOAuthConfig(definition),
      { onRedirect: async () => {
      } },
      this.authStorageOptions,
      this.oauthRuntime?.signal
    );
    let authState = supportsOAuth(definition) ? definition.auth === void 0 ? { status: "implicit-deferred" } : { status: "explicit", provider: createAuthProvider() } : { status: "disabled" };
    const attempt = async (kind2) => {
      const authProvider = "provider" in authState ? authState.provider : void 0;
      const transportOptions = {
        ...requestInit !== void 0 ? { requestInit } : {},
        ...requestFetch !== void 0 ? { fetch: requestFetch } : {},
        ...authProvider !== void 0 ? { authProvider } : {},
        ...authProvider !== void 0 && definition.oauth !== false && definition.oauth?.skipIssuerMetadataValidation === true ? { skipIssuerMetadataValidation: true } : {}
      };
      const baseTransport = kind2 === "streamable-http" ? new StreamableHTTPClientTransport(url, transportOptions) : new SSEClientTransport(url, transportOptions);
      const transport = traceObserver ? wrapTransportWithMcpTrace(baseTransport, serverName, kind2, traceObserver) : baseTransport;
      const client = this.createClient(serverName, definition);
      try {
        await this.connectClientWithAbort(client, transport, requestOptions, signal);
        return { status: "connected", client, transport };
      } catch (error) {
        const abortCleanupFailed = error instanceof AggregateError && error.message === "MCP connection abort cleanup failed";
        if (!abortCleanupFailed) {
          try {
            await (abortCleanupPromises.get(transport) ?? client.close());
          } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], "MCP HTTP connection cleanup failed");
          }
        }
        return { status: "failed", client, transport, error };
      }
    };
    let kind = definition.httpTransport ?? "streamable-http";
    let invalidated = credentialsInvalidated;
    for (; ; ) {
      const result = await attempt(kind);
      if (result.status === "connected") return { ...result, credentialsInvalidated: invalidated };
      if (result.error instanceof AggregateError && result.error.message === "MCP connection abort cleanup failed") {
        throw result.error;
      }
      if (signal?.aborted) throwIfAborted(signal);
      if (authState.status === "implicit-deferred" && isUnauthorizedHttpError(result.error)) {
        authState = { status: "implicit-challenged", provider: createAuthProvider() };
        continue;
      }
      if (isUnauthorizedHttpError(result.error)) {
        if (supportsOAuth(definition)) {
          if (!invalidated) {
            invalidateAuthEntryCache(serverName);
            invalidated = true;
          }
          return {
            client: result.client,
            transport: result.transport,
            status: "needs-auth",
            credentialsInvalidated: invalidated
          };
        }
        throw result.error;
      }
      if (definition.httpTransport === void 0 && kind === "streamable-http" && shouldFallbackToSse(result.error, definition)) {
        kind = "sse";
        continue;
      }
      throw result.error;
    }
  }
  async fetchAllTools(client, requestOptions) {
    const allTools = [];
    let cursor;
    do {
      const result = await client.listTools(cursor ? { cursor } : void 0, requestOptions);
      allTools.push(...result.tools ?? []);
      cursor = result.nextCursor;
    } while (cursor);
    return allTools;
  }
  async fetchAllPrompts(client, requestOptions) {
    const capabilities = client.getServerCapabilities?.();
    if (!capabilities?.prompts) return { prompts: [], failed: false };
    try {
      const prompts = [];
      let cursor;
      do {
        const result = await client.listPrompts(cursor ? { cursor } : void 0, requestOptions);
        prompts.push(...result.prompts ?? []);
        cursor = result.nextCursor;
      } while (cursor);
      return { prompts, failed: false };
    } catch (error) {
      if (requestOptions?.signal?.aborted) throwIfAborted(requestOptions.signal);
      if (isUnauthorizedHttpError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(`MCP: prompts/list failed: ${message}`);
      return { prompts: [], failed: true };
    }
  }
  async fetchAllResources(client, requestOptions) {
    const capabilities = client.getServerCapabilities?.();
    if (!capabilities?.resources) return [];
    try {
      const allResources = [];
      let cursor;
      do {
        const result = await client.listResources(cursor ? { cursor } : void 0, requestOptions);
        allResources.push(...result.resources ?? []);
        cursor = result.nextCursor;
      } while (cursor);
      return allResources;
    } catch (error) {
      if (requestOptions?.signal?.aborted) {
        throwIfAborted(requestOptions.signal);
      }
      if (isUnauthorizedHttpError(error)) throw error;
      return [];
    }
  }
  attachAdapterNotificationHandlers(serverName, client) {
    client.setNotificationHandler(
      SERVER_STREAM_RESULT_PATCH_METHOD,
      { params: serverStreamResultPatchNotificationSchema.shape.params },
      (params) => {
        const listener = this.uiStreamListeners.get(params.streamToken);
        if (!listener) return;
        listener(serverName, params);
      }
    );
  }
  registerUiStreamListener(streamToken, listener) {
    this.uiStreamListeners.set(streamToken, listener);
  }
  removeUiStreamListener(streamToken) {
    this.uiStreamListeners.delete(streamToken);
  }
  async getPrompt(name, promptName, args, signal) {
    const connection = this.connections.get(name);
    if (!connection || connection.status !== "connected") {
      throw new Error(`Server "${name}" is not connected`);
    }
    try {
      this.touch(name);
      this.incrementInFlight(name);
      return await connection.client.getPrompt(
        { name: promptName, ...args ? { arguments: args } : {} },
        this.getRequestOptions(name, signal)
      );
    } finally {
      this.decrementInFlight(name);
      this.touch(name);
    }
  }
  async readResource(name, uri, signal) {
    if (isServerDisabled(this.connections.get(name)?.definition)) {
      throw new Error(`MCP server "${name}" is disabled`);
    }
    const connection = this.connections.get(name);
    if (!connection || connection.status !== "connected") {
      throw new Error(`Server "${name}" is not connected`);
    }
    try {
      this.touch(name);
      this.incrementInFlight(name);
      return await connection.client.readResource({ uri }, this.getRequestOptions(name, signal));
    } finally {
      this.decrementInFlight(name);
      this.touch(name);
    }
  }
  async close(name) {
    this.closeGenerations.set(name, (this.closeGenerations.get(name) ?? 0) + 1);
    this.connectAttempts.get(name)?.abort(new Error(`MCP connection ${name} was closed`));
    this.pendingMetadataPublications.delete(name);
    const connection = this.connections.get(name);
    if (!connection) {
      const pendingClose = this.closePromises.get(name);
      if (pendingClose) {
        await pendingClose;
        return;
      }
      const pendingConnect = this.connectPromises.get(name);
      if (pendingConnect) {
        try {
          await pendingConnect;
        } catch (error) {
          if (this.containsCleanupFailure(error)) throw error;
        }
      }
      return;
    }
    connection.status = "closed";
    this.connections.delete(name);
    this.acceptedUrlElicitations.delete(name);
    const closing = this.disposeConnection(connection).finally(() => {
      if (this.closePromises.get(name) === closing) this.closePromises.delete(name);
    });
    this.closePromises.set(name, closing);
    return closing;
  }
  async disposeConnection(connection) {
    const results = await Promise.allSettled([
      // Only client.close() is needed; the client owns the transport and will close it internally.
      Promise.resolve().then(() => connection.client.close()),
      this.traceWriter?.flush() ?? Promise.resolve()
    ]);
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length > 0) throw new AggregateError(failures, "MCP connection cleanup failed");
  }
  async closeAll() {
    this.stopped = true;
    const names = /* @__PURE__ */ new Set([...this.connections.keys(), ...this.connectPromises.keys()]);
    for (const name of names) {
      this.closeGenerations.set(name, (this.closeGenerations.get(name) ?? 0) + 1);
      this.connectAttempts.get(name)?.abort(new Error(`MCP connection ${name} was closed`));
    }
    const pendingConnects = [...this.connectPromises.values()];
    const currentNames = [...this.connections.keys()];
    const pendingResults = await Promise.allSettled(pendingConnects);
    const results = await Promise.allSettled(currentNames.map((name) => this.close(name)));
    const lateNames = [...this.connections.keys()];
    const lateResults = await Promise.allSettled(lateNames.map((name) => this.close(name)));
    const failures = [...pendingResults, ...results, ...lateResults].flatMap((result) => result.status === "rejected" ? [result.reason] : []).filter((error) => this.containsCleanupFailure(error));
    this.uiStreamListeners.clear();
    this.acceptedUrlElicitations.clear();
    this.pendingMetadataPublications.clear();
    this.samplingConfig = void 0;
    this.elicitationConfig = void 0;
    await this.traceWriter?.flush();
    if (failures.length > 0) throw new AggregateError(failures, "MCP manager cleanup failed");
  }
  containsCleanupFailure(error) {
    const pending = [error];
    const seen = /* @__PURE__ */ new Set();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!(current instanceof Error) || seen.has(current)) continue;
      seen.add(current);
      if (current instanceof AggregateError) {
        if (/cleanup failed|setup failed/.test(current.message)) return true;
        pending.push(...current.errors);
      }
      if (current.cause !== void 0) pending.push(current.cause);
    }
    return false;
  }
  isConnecting(name) {
    return this.connectPromises.has(name);
  }
  getConnection(name) {
    return this.connections.get(name);
  }
  getAllConnections() {
    return new Map(this.connections);
  }
  touch(name) {
    const connection = this.connections.get(name);
    if (connection) {
      connection.lastUsedAt = Date.now();
    }
  }
  incrementInFlight(name) {
    const connection = this.connections.get(name);
    if (connection) {
      connection.inFlight = (connection.inFlight ?? 0) + 1;
    }
  }
  decrementInFlight(name) {
    const connection = this.connections.get(name);
    if (connection && connection.inFlight) {
      connection.inFlight--;
    }
  }
  isIdle(name, timeoutMs) {
    const connection = this.connections.get(name);
    if (!connection || connection.status !== "connected") return false;
    if (connection.inFlight > 0) return false;
    return Date.now() - connection.lastUsedAt > timeoutMs;
  }
};
function resolveEnv(env, serverName, literalEnv = false) {
  const resolved = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== void 0) resolved[key] = value;
  }
  if (literalEnv) return env ? { ...resolved, ...env } : resolved;
  const overrides = resolveCommandSecretsRecord(
    env,
    (key) => `MCP server "${serverName}" stdio env "${key}"`
  );
  return overrides ? { ...resolved, ...overrides } : resolved;
}
function normalizeRequestTimeoutMs(timeoutMs) {
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : void 0;
}

// src/runtime/session-recovery.ts
import { ProtocolError as ProtocolError2, SdkHttpError as SdkHttpError2, UnauthorizedError as UnauthorizedError2 } from "@modelcontextprotocol/client";
var CONNECTION_CLOSED_PROTOCOL_CODE = -32e3;
var SERVER_NOT_INITIALIZED_MCP_MESSAGES = /* @__PURE__ */ new Set([
  "Server not initialized",
  "Bad Request: Server not initialized"
]);
function isTerminatedSession(err, hadSessionId) {
  if (!hadSessionId) return false;
  if (err instanceof SdkHttpError2) {
    return err.status === 404 || err.status === 400 && /"code"\s*:\s*-32000/.test(err.message) && /"message"\s*:\s*"Bad Request: Server not initialized"/.test(err.message);
  }
  return err instanceof ProtocolError2 && err.code === CONNECTION_CLOSED_PROTOCOL_CODE && SERVER_NOT_INITIALIZED_MCP_MESSAGES.has(err.message);
}
function hasSessionId(connection) {
  const transport = connection.transport;
  return transport?.sessionId != null;
}
var SessionRecoveryAuthRequiredError = class extends Error {
  constructor(serverName, authMessage) {
    super(authMessage ?? `MCP server "${serverName}" requires OAuth authentication after reconnect.`);
    this.serverName = serverName;
    this.authMessage = authMessage;
    this.name = "SessionRecoveryAuthRequiredError";
  }
  serverName;
  authMessage;
};
async function withSessionRecovery(deps, serverName, fn) {
  if (isServerDisabled(deps.config.mcpServers[serverName])) {
    throw new Error(`MCP server "${serverName}" is disabled`);
  }
  const connection = deps.manager.getConnection(serverName);
  if (!connection) {
    throw new Error(`Server "${serverName}" is not connected`);
  }
  const hadSessionId = hasSessionId(connection);
  try {
    return await fn(connection);
  } catch (err) {
    const definition = deps.config.mcpServers[serverName];
    if (definition && supportsOAuth(definition) && (err instanceof UnauthorizedError2 || err instanceof SdkHttpError2 && err.status === 401)) {
      invalidateAuthEntryCache(serverName);
    }
    if (!isTerminatedSession(err, hadSessionId)) {
      throw err;
    }
    if (!definition) {
      throw err;
    }
    throwIfAborted(deps.signal);
    logger.debug(`MCP session for "${serverName}" expired; reconnecting`, {
      server: serverName
    });
    let freshConnection = deps.signal ? await deps.manager.reconnect(serverName, definition, connection, deps.signal) : await deps.manager.reconnect(serverName, definition, connection);
    throwIfAborted(deps.signal);
    if (freshConnection.status === "needs-auth") {
      freshConnection = await deps.onNeedsAuth?.(serverName) ?? freshConnection;
      throwIfAborted(deps.signal);
    }
    if (freshConnection.status === "needs-auth") {
      throw new SessionRecoveryAuthRequiredError(serverName);
    }
    if (freshConnection.status !== "connected") {
      throw err;
    }
    try {
      deps.manager.publishMetadataChanged(serverName, freshConnection, "session-reconnect");
    } catch (publicationError) {
      const message = publicationError instanceof Error ? publicationError.message : String(publicationError);
      logger.debug(`MCP metadata publication after reconnect failed for "${serverName}": ${message}`);
    }
    throwIfAborted(deps.signal);
    return fn(freshConnection);
  }
}

// src/runtime/lifecycle.ts
var KEEP_ALIVE_RETRY_BASE_MS = 3e4;
var KEEP_ALIVE_RETRY_MAX_MS = 5 * 6e4;
var KEEP_ALIVE_CHECK_CONCURRENCY = 10;
var McpLifecycleManager = class {
  constructor(manager, hasPendingAuthForServer = hasPendingAuth) {
    this.manager = manager;
    this.hasPendingAuthForServer = hasPendingAuthForServer;
  }
  manager;
  hasPendingAuthForServer;
  keepAliveServers = /* @__PURE__ */ new Map();
  allServers = /* @__PURE__ */ new Map();
  serverSettings = /* @__PURE__ */ new Map();
  globalIdleTimeout = 10 * 60 * 1e3;
  healthCheckInterval;
  onReconnect;
  onReconnectFailure;
  onHealthRestored;
  onAuthRequired;
  onIdleShutdown;
  activeHealthCheck;
  activeConvergence;
  shutdownPromise;
  retryStates = /* @__PURE__ */ new Map();
  pendingMetadataPublications = /* @__PURE__ */ new Set();
  stopped = false;
  removeHealthAbortListener;
  setReconnectCallback(callback) {
    this.onReconnect = callback;
  }
  setReconnectFailureCallback(callback) {
    this.onReconnectFailure = callback;
  }
  setHealthRestoredCallback(callback) {
    this.onHealthRestored = callback;
  }
  setAuthRequiredCallback(callback) {
    this.onAuthRequired = callback;
  }
  markKeepAlive(name, definition) {
    if (isServerDisabled(definition)) return;
    this.keepAliveServers.set(name, definition);
  }
  registerServer(name, definition, settings) {
    if (isServerDisabled(definition)) return;
    this.allServers.set(name, definition);
    if (settings?.idleTimeout !== void 0) this.serverSettings.set(name, settings);
  }
  unregisterServer(name) {
    this.allServers.delete(name);
    this.keepAliveServers.delete(name);
    this.serverSettings.delete(name);
    this.retryStates.delete(name);
    this.pendingMetadataPublications.delete(name);
  }
  setGlobalIdleTimeout(minutes) {
    this.globalIdleTimeout = minutes * 60 * 1e3;
  }
  setIdleShutdownCallback(callback) {
    this.onIdleShutdown = callback;
  }
  startHealthChecks(signalOrInterval, maybeIntervalMs = 3e4) {
    const signal = typeof signalOrInterval === "number" ? void 0 : signalOrInterval;
    const intervalMs = typeof signalOrInterval === "number" ? signalOrInterval : maybeIntervalMs;
    this.stopped = false;
    if (signal?.aborted) {
      this.stopped = true;
      return;
    }
    const stop = () => {
      this.stopped = true;
      if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = void 0;
    };
    signal?.addEventListener("abort", stop, { once: true });
    this.removeHealthAbortListener = () => signal?.removeEventListener("abort", stop);
    this.healthCheckInterval = setInterval(() => {
      if (this.stopped || signal?.aborted || this.activeHealthCheck) return;
      const check = this.checkConnections(signal).catch((error) => {
        console.error(`MCP: Health check failed: ${formatTerminalError(error)}`);
      }).finally(() => {
        if (this.activeHealthCheck === check) this.activeHealthCheck = void 0;
      });
      this.activeHealthCheck = check;
    }, intervalMs);
    this.healthCheckInterval.unref();
  }
  async ensureConverged(signal) {
    if (this.stopped || signal?.aborted) return;
    if (this.activeConvergence) return this.activeConvergence;
    const check = this.checkKeepAliveConnections(signal);
    this.activeConvergence = check;
    try {
      await check;
    } finally {
      if (this.activeConvergence === check) this.activeConvergence = void 0;
    }
  }
  async checkConnections(signal) {
    if (this.stopped || signal?.aborted) return;
    await this.ensureConverged(signal);
    if (this.stopped || signal?.aborted) return;
    for (const [name] of this.allServers) {
      if (this.keepAliveServers.has(name)) continue;
      const timeout = this.getIdleTimeout(name);
      if (timeout > 0 && this.manager.isIdle(name, timeout)) {
        await this.manager.close(name);
        if (this.stopped || signal?.aborted) return;
        this.onIdleShutdown?.(name);
      }
    }
  }
  async checkKeepAliveConnections(signal) {
    if (this.stopped || signal?.aborted) return;
    await parallelLimit(
      [...this.keepAliveServers],
      KEEP_ALIVE_CHECK_CONCURRENCY,
      ([name, definition]) => this.checkKeepAliveConnection(name, definition, signal)
    );
  }
  async checkKeepAliveConnection(name, definition, signal, retrySuperseded = true) {
    if (isServerDisabled(definition) || this.stopped || signal?.aborted) return;
    if (this.keepAliveServers.get(name) !== definition) return;
    const connection = this.manager.getConnection(name);
    if (connection?.status === "needs-auth") {
      this.pendingMetadataPublications.delete(name);
      return;
    }
    if (!this.shouldAttemptConnection(name, connection)) return;
    if (!connection || connection.status !== "connected") {
      if (this.hasPendingAuthForServer(name)) {
        logger.debug(`Skipping reconnect for ${name} while OAuth authorization is pending`);
        return;
      }
      let freshConnection;
      try {
        freshConnection = await this.manager.connect(name, definition, signal);
      } catch (error) {
        if (this.stopped || signal?.aborted) return;
        this.reportConnectionFailure(name, definition, error, "reconnect", this.manager.getConnection(name));
        return;
      }
      if (this.stopped || signal?.aborted) return;
      if (freshConnection.status === "needs-auth") {
        await this.notifyAuthRequired(name, definition, freshConnection);
        return;
      }
      if (freshConnection.status !== "connected") {
        this.reportConnectionFailure(
          name,
          definition,
          new Error(`MCP server ${name} did not return a connected session`),
          "reconnect",
          freshConnection
        );
        return;
      }
      logger.debug(`Reconnected to ${name}`);
      await this.publishConnectedMetadata(name, definition, freshConnection);
      return;
    }
    if (this.pendingMetadataPublications.has(name)) {
      await this.publishConnectedMetadata(name, definition, connection);
      return;
    }
    if (!definition.url) return;
    const hadSessionId = connection.transport?.sessionId != null;
    let refreshResult;
    try {
      refreshResult = await this.manager.refreshTools(name, connection, signal);
    } catch (error) {
      if (this.stopped || signal?.aborted) return;
      const current = this.manager.getConnection(name);
      if (current !== connection || connection.status !== "connected") {
        await this.handleSupersededConnection(name, definition, connection, signal, retrySuperseded);
        return;
      }
      if (!shouldReconnectAfterRefresh(error, hadSessionId)) {
        this.reportConnectionFailure(name, definition, error, "refresh", connection);
        return;
      }
      if (this.hasPendingAuthForServer(name)) {
        logger.debug(`Skipping reconnect for ${name} while OAuth authorization is pending`);
        return;
      }
      let freshConnection;
      try {
        freshConnection = await this.manager.reconnect(name, definition, connection, signal);
      } catch (reconnectError) {
        if (this.stopped || signal?.aborted) return;
        this.reportConnectionFailure(name, definition, reconnectError, "reconnect", this.manager.getConnection(name));
        return;
      }
      if (this.stopped || signal?.aborted) return;
      if (freshConnection.status === "needs-auth") {
        await this.notifyAuthRequired(name, definition, freshConnection);
        return;
      }
      if (freshConnection.status !== "connected") {
        this.reportConnectionFailure(
          name,
          definition,
          new Error(`MCP server ${name} did not return a connected session`),
          "reconnect",
          freshConnection
        );
        return;
      }
      logger.debug(`Reconnected stale MCP session for ${name}`);
      await this.publishConnectedMetadata(name, definition, freshConnection);
      return;
    }
    if (refreshResult === "superseded") {
      await this.handleSupersededConnection(name, definition, connection, signal, retrySuperseded);
      return;
    }
    if (refreshResult === "refresh-timeout") {
      this.deferRefreshTimeout(name, definition, connection);
      return;
    }
    if (this.keepAliveServers.get(name) !== definition) return;
    if (this.retryStates.delete(name)) {
      await this.onHealthRestored?.(name);
    }
  }
  async handleSupersededConnection(name, definition, staleConnection, signal, retrySuperseded) {
    const current = this.manager.getConnection(name);
    if (this.keepAliveServers.get(name) !== definition) return;
    if (current === staleConnection && current.status === "connected") {
      if (this.retryStates.delete(name)) await this.onHealthRestored?.(name);
      return;
    }
    if (current?.status === "connected") {
      await this.publishConnectedMetadata(name, definition, current);
      return;
    }
    if (current?.status === "needs-auth") {
      await this.notifyAuthRequired(name, definition, current);
      return;
    }
    if (retrySuperseded) {
      await this.checkKeepAliveConnection(name, definition, signal, false);
    }
  }
  async publishConnectedMetadata(name, definition, connection) {
    if (this.keepAliveServers.get(name) !== definition) {
      if (this.manager.getConnection(name) === connection) await this.manager.close(name);
      return;
    }
    this.pendingMetadataPublications.add(name);
    try {
      await this.onReconnect?.(name);
      this.pendingMetadataPublications.delete(name);
      this.retryStates.delete(name);
    } catch (error) {
      if (this.stopped) return;
      this.reportConnectionFailure(name, definition, error, "publish", connection);
    }
  }
  async notifyAuthRequired(name, definition, connection) {
    if (this.keepAliveServers.get(name) !== definition) {
      if (this.manager.getConnection(name) === connection) await this.manager.close(name);
      return;
    }
    this.pendingMetadataPublications.delete(name);
    this.retryStates.delete(name);
    try {
      await this.onAuthRequired?.(name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(`MCP: auth-required callback failed for ${name}: ${sanitizeTerminalText(message)}`);
    }
  }
  shouldAttemptConnection(name, connection) {
    const retry = this.retryStates.get(name);
    if (!retry) return true;
    if (retry.connection !== connection || retry.status !== connection?.status) {
      this.retryStates.delete(name);
      return true;
    }
    return Date.now() >= retry.nextAttemptAt;
  }
  connectionFailureTarget(action, name) {
    if (action === "reconnect") return `reconnect to ${name}`;
    if (action === "publish") return `publish metadata for ${name}`;
    return `refresh ${name}`;
  }
  reportConnectionFailure(name, definition, error, action, connection) {
    if (!this.recordRetry(name, definition, connection)) return;
    this.onReconnectFailure?.(name, error);
    if (isTransientHttpConnectError(error)) return;
    const retry = this.retryStates.get(name);
    if (retry?.warningReported) return;
    if (retry) retry.warningReported = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`MCP: Failed to ${this.connectionFailureTarget(action, name)}: ${sanitizeTerminalText(message)}`);
  }
  deferRefreshTimeout(name, definition, connection) {
    if (!this.recordRetry(name, definition, connection)) return;
    logger.debug(`MCP: keep-alive tools/list refresh timed out for ${name}; retrying after backoff`);
  }
  recordRetry(name, definition, connection) {
    if (this.keepAliveServers.get(name) !== definition) return false;
    const previous = this.retryStates.get(name);
    const attempts = (previous?.attempts ?? 0) + 1;
    const delay = Math.min(
      KEEP_ALIVE_RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 10),
      KEEP_ALIVE_RETRY_MAX_MS
    );
    this.retryStates.set(name, {
      attempts,
      nextAttemptAt: Date.now() + delay,
      connection,
      status: connection?.status,
      warningReported: previous?.warningReported ?? false
    });
    return true;
  }
  getIdleTimeout(name) {
    const perServer = this.serverSettings.get(name)?.idleTimeout;
    if (perServer !== void 0) return perServer * 60 * 1e3;
    return this.globalIdleTimeout;
  }
  async gracefulShutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.shutdownOnce();
    return this.shutdownPromise;
  }
  async shutdownOnce() {
    this.stopped = true;
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    this.healthCheckInterval = void 0;
    this.removeHealthAbortListener?.();
    this.removeHealthAbortListener = void 0;
    await this.activeHealthCheck;
    this.activeHealthCheck = void 0;
    await this.activeConvergence;
    this.activeConvergence = void 0;
    this.onReconnect = void 0;
    this.onReconnectFailure = void 0;
    this.onHealthRestored = void 0;
    this.onAuthRequired = void 0;
    this.onIdleShutdown = void 0;
    this.retryStates.clear();
    this.pendingMetadataPublications.clear();
    if (typeof this.manager.closeAll === "function") {
      await this.manager.closeAll();
    }
  }
};
function shouldReconnectAfterRefresh(error, hadSessionId) {
  if (isTerminatedSession(error, hadSessionId)) return true;
  return error instanceof SdkError2 && (error.code === SdkErrorCode2.NotConnected || error.code === SdkErrorCode2.ConnectionClosed);
}

// src/tools/tool-metadata.ts
function buildToolMetadata(tools, resources, definition, serverName, prefix, configuredServers, knownMetadata, includeMissingConfiguredCandidates = false, sharedSelectorCandidateIndex) {
  const metadata = [];
  const failedTools = [];
  const seenNames = /* @__PURE__ */ new Set();
  const effectivePrefix = resolveToolPrefix(definition, prefix);
  const hasToolFilters = Array.isArray(definition.includeTools) && definition.includeTools.length > 0 || Array.isArray(definition.excludeTools) && definition.excludeTools.length > 0;
  const selectorCandidateIndex = hasToolFilters ? sharedSelectorCandidateIndex ?? (configuredServers ? (() => {
    const candidates = /* @__PURE__ */ new Set();
    const additionalCandidatesByToolName = /* @__PURE__ */ new Map();
    const evaluatedToolNames = /* @__PURE__ */ new Set();
    const addCandidates = (target, originalName, candidateServerName, candidatePrefix) => {
      for (const candidate of getToolNameCandidates(originalName, candidateServerName, candidatePrefix, false)) target.add(candidate);
    };
    for (const tool of tools) {
      if (!tool?.name) continue;
      evaluatedToolNames.add(tool.name);
      addCandidates(candidates, tool.name, serverName, effectivePrefix);
    }
    if (definition.exposeResources !== false) {
      for (const resource of resources) {
        const baseName = `read_${resourceNameToToolName(resource.name)}`;
        evaluatedToolNames.add(baseName);
        if (resource?.name && resource?.uri) addCandidates(candidates, baseName, serverName, effectivePrefix);
      }
    }
    for (const [otherServerName, otherDefinition] of Object.entries(configuredServers)) {
      if (otherServerName === serverName || isServerDisabled(otherDefinition)) continue;
      const otherPrefix = resolveToolPrefix(otherDefinition, prefix);
      const knownTools = knownMetadata?.get(otherServerName);
      if (knownTools) {
        for (const tool of knownTools) {
          candidates.add(tool.name);
          addCandidates(candidates, tool.originalName, otherServerName, otherPrefix);
        }
      } else if (!knownMetadata || includeMissingConfiguredCandidates) {
        for (const toolName of evaluatedToolNames) {
          let additionalCandidates = additionalCandidatesByToolName.get(toolName);
          if (!additionalCandidates) {
            additionalCandidates = /* @__PURE__ */ new Set();
            additionalCandidatesByToolName.set(toolName, additionalCandidates);
          }
          addCandidates(additionalCandidates, toolName, otherServerName, otherPrefix);
          if (includeMissingConfiguredCandidates) {
            for (const candidate of getToolNameCandidates(toolName, otherServerName, otherPrefix, false)) {
              additionalCandidates.add(candidate.replace(/-/g, "_"));
            }
          }
        }
      }
    }
    return createToolSelectorCandidateIndex(candidates, additionalCandidatesByToolName);
  })() : void 0) : void 0;
  for (const tool of tools) {
    if (!tool?.name) {
      failedTools.push("(unnamed)");
      continue;
    }
    if (!isToolAllowed(tool.name, serverName, effectivePrefix, definition.includeTools, definition.excludeTools, selectorCandidateIndex)) {
      continue;
    }
    const name = formatToolName(tool.name, serverName, effectivePrefix);
    if (seenNames.has(name)) {
      continue;
    }
    const uiVisibility = extractUiToolVisibility(tool._meta);
    if (!isUiToolVisibleToModel(uiVisibility)) {
      continue;
    }
    seenNames.add(name);
    let uiResourceUri;
    try {
      uiResourceUri = getToolUiResourceUri({ _meta: tool._meta });
    } catch {
      failedTools.push(tool.name);
    }
    const uiStreamMode = extractToolUiStreamMode(tool._meta);
    metadata.push({
      name,
      originalName: tool.name,
      description: tool.description ?? "",
      ...tool.inputSchema !== void 0 ? { inputSchema: tool.inputSchema } : {},
      ...uiResourceUri !== void 0 ? { uiResourceUri } : {},
      ...uiVisibility !== void 0 ? { uiVisibility } : {},
      ...uiStreamMode !== void 0 ? { uiStreamMode } : {}
    });
  }
  if (definition.exposeResources !== false) {
    for (const resource of resources) {
      const baseName = `read_${resourceNameToToolName(resource.name)}`;
      if (!isToolAllowed(baseName, serverName, effectivePrefix, definition.includeTools, definition.excludeTools, selectorCandidateIndex)) {
        continue;
      }
      const name = formatToolName(baseName, serverName, effectivePrefix);
      if (seenNames.has(name)) {
        continue;
      }
      seenNames.add(name);
      metadata.push({
        name,
        originalName: baseName,
        description: resource.description ?? `Read resource: ${resource.uri}`,
        resourceUri: resource.uri
      });
    }
  }
  return { metadata, failedTools };
}
function getToolNames(state, serverName) {
  return state.toolMetadata.get(serverName)?.map((m) => m.name) ?? [];
}
function totalToolCount(state) {
  let count = 0;
  for (const metadata of state.toolMetadata.values()) {
    count += metadata.length;
  }
  return count;
}
function findToolByName(metadata, toolName) {
  if (!metadata) return void 0;
  const exact = metadata.find((m) => m.name === toolName);
  if (exact) return exact;
  const normalized = toolName.replace(/-/g, "_");
  return metadata.find((m) => m.name.replace(/-/g, "_") === normalized);
}
function formatSchema(schema, indent = "  ") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return `${indent}(no schema)`;
  }
  const s = schema;
  if (s.type === "object" && s.properties && typeof s.properties === "object" && !Array.isArray(s.properties)) {
    const props = s.properties;
    const required = Array.isArray(s.required) ? s.required.filter((name) => typeof name === "string") : [];
    if (Object.keys(props).length === 0) {
      return `${indent}(no parameters)`;
    }
    const lines2 = [];
    for (const [name, propSchema] of Object.entries(props)) {
      lines2.push(...formatProperty(name, propSchema, required.includes(name), indent));
    }
    return lines2.join("\n");
  }
  const lines = formatNestedSchema(s, indent);
  if (lines.length > 0) {
    return lines.join("\n");
  }
  const typeStr = formatType(s);
  if (typeStr) {
    return `${indent}(${typeStr})`;
  }
  return `${indent}(complex schema)`;
}
function formatProperty(name, schema, required, indent) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return [`${indent}${name}${required ? " *required*" : ""}`];
  }
  const s = schema;
  const parts = [`${indent}${name}`];
  const typeStr = formatType(s);
  if (typeStr) parts.push(`(${typeStr})`);
  if (required) parts.push("*required*");
  appendSchemaAnnotations(parts, s);
  return [parts.join(" "), ...formatNestedSchema(s, `${indent}  `)];
}
function formatNestedSchema(schema, indent) {
  const lines = [];
  if (Array.isArray(schema.anyOf)) {
    lines.push(...formatVariants("anyOf", schema.anyOf, indent));
  }
  if (Array.isArray(schema.oneOf)) {
    lines.push(...formatVariants("oneOf", schema.oneOf, indent));
  }
  if (schema.items !== void 0) {
    lines.push(...formatProperty("items", schema.items, false, indent));
  }
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    const required = Array.isArray(schema.required) ? schema.required.filter((name) => typeof name === "string") : [];
    for (const [name, propSchema] of Object.entries(schema.properties)) {
      lines.push(...formatProperty(name, propSchema, required.includes(name), indent));
    }
  }
  return lines;
}
function formatVariants(keyword, variants, indent) {
  const lines = [`${indent}${keyword}:`];
  for (const variant of variants) {
    if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
      lines.push(`${indent}  - ${JSON.stringify(variant)}`);
      continue;
    }
    const s = variant;
    const typeStr = formatType(s) || "schema";
    const parts = [`${indent}  - ${typeStr}`];
    appendSchemaAnnotations(parts, s);
    lines.push(parts.join(" "));
    lines.push(...formatNestedSchema(s, `${indent}    `));
  }
  return lines;
}
function formatType(schema) {
  if (Object.hasOwn(schema, "const")) {
    return `const ${JSON.stringify(schema.const)}`;
  }
  if (Array.isArray(schema.enum)) {
    return `enum: ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`;
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => String(type)).join(" | ");
  }
  if (schema.type) {
    return String(schema.type);
  }
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    return "object";
  }
  if (schema.items !== void 0) {
    return "array";
  }
  return "";
}
function appendSchemaAnnotations(parts, schema) {
  if (schema.description && typeof schema.description === "string") {
    parts.push(`- ${schema.description}`);
  }
  for (const key of ["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "format", "pattern"]) {
    if (schema[key] !== void 0) {
      parts.push(`[${key}: ${JSON.stringify(schema[key])}]`);
    }
  }
  if (schema.default !== void 0) {
    parts.push(`[default: ${JSON.stringify(schema.default)}]`);
  }
}

// src/ui/resource-handler.ts
import { UrlElicitationRequiredError } from "@modelcontextprotocol/client";
var UiResourceHandler = class {
  constructor(manager, config = void 0) {
    this.manager = manager;
    this.config = config;
  }
  manager;
  config;
  log = logger.child({ component: "UiResourceHandler" });
  async readUiResource(serverName, uri, options = {}) {
    const log = this.log.child({ server: serverName, uri });
    if (!uri.startsWith("ui://")) {
      throw new ResourceParseError(uri, "URI must start with ui://", { server: serverName });
    }
    log.debug("Fetching UI resource");
    let result;
    try {
      const config = options.config ?? this.config;
      if (config && isServerDisabled(config.mcpServers[serverName])) {
        throw new Error(`MCP server "${serverName}" is disabled`);
      }
      if (config) {
        this.manager.touch(serverName);
        this.manager.incrementInFlight(serverName);
        try {
          result = await withSessionRecovery(
            {
              manager: this.manager,
              config,
              ...options.signal ? { signal: options.signal } : {},
              ...options.onNeedsAuth ? { onNeedsAuth: options.onNeedsAuth } : {}
            },
            serverName,
            (connection) => connection.client.readResource({ uri }, this.manager.getRequestOptions(serverName, options.signal))
          );
        } finally {
          this.manager.decrementInFlight(serverName);
          this.manager.touch(serverName);
        }
      } else {
        result = await this.manager.readResource(serverName, uri, options.signal);
      }
    } catch (error) {
      if (error instanceof UrlElicitationRequiredError || error instanceof SessionRecoveryAuthRequiredError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      log.error("Failed to read resource", error instanceof Error ? error : void 0);
      throw new ResourceFetchError(uri, message, {
        server: serverName,
        ...error instanceof Error ? { cause: error } : {}
      });
    }
    const content = selectContent(result, uri);
    const mimeType = content.mimeType;
    if (mimeType && !isHtmlMimeType(mimeType)) {
      log.warn("Unsupported MIME type", { mimeType });
      throw new ResourceParseError(
        uri,
        `unsupported MIME type "${mimeType}" (expected text/html or ${RESOURCE_MIME_TYPE})`,
        { server: serverName, mimeType }
      );
    }
    const html = toHtml(content);
    if (!html.trim()) {
      log.warn("Resource content is empty");
      throw new ResourceParseError(uri, "content is empty", { server: serverName });
    }
    const contentMeta = extractUiMeta(content._meta);
    const listMeta = extractUiMeta(this.getListResourceMeta(serverName, uri));
    log.debug("Resource loaded successfully", {
      contentLength: html.length,
      hasCsp: !!contentMeta.csp || !!listMeta.csp
    });
    return {
      uri: content.uri ?? uri,
      html,
      mimeType: mimeType ?? RESOURCE_MIME_TYPE,
      meta: {
        ...(contentMeta.csp ?? listMeta.csp) !== void 0 ? { csp: contentMeta.csp ?? listMeta.csp } : {},
        ...(contentMeta.permissions ?? listMeta.permissions) !== void 0 ? { permissions: contentMeta.permissions ?? listMeta.permissions } : {},
        ...(contentMeta.domain ?? listMeta.domain) !== void 0 ? { domain: contentMeta.domain ?? listMeta.domain } : {},
        ...(contentMeta.prefersBorder ?? listMeta.prefersBorder) !== void 0 ? { prefersBorder: contentMeta.prefersBorder ?? listMeta.prefersBorder } : {}
      }
    };
  }
  getListResourceMeta(serverName, uri) {
    const connection = this.manager.getConnection(serverName);
    if (!connection?.resources?.length) return void 0;
    const resource = connection.resources.find((entry) => entry.uri === uri);
    if (!resource || !resource._meta || typeof resource._meta !== "object") return void 0;
    return resource._meta;
  }
};
function selectContent(result, preferredUri) {
  const contents = result.contents ?? [];
  if (contents.length === 0) {
    throw new Error(`No contents returned for UI resource: ${preferredUri}`);
  }
  const byUri = contents.find((content) => content.uri === preferredUri);
  if (byUri) return byUri;
  const byHtmlMime = contents.find(
    (content) => content.mimeType && isHtmlMimeType(content.mimeType)
  );
  if (byHtmlMime) return byHtmlMime;
  const firstContent = contents[0];
  if (!firstContent) {
    throw new Error(`No contents returned for UI resource: ${preferredUri}`);
  }
  return firstContent;
}
function isHtmlMimeType(mimeType) {
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith("text/html") || normalized === RESOURCE_MIME_TYPE.toLowerCase();
}
function toHtml(content) {
  if (typeof content.text === "string") {
    return content.text;
  }
  if (typeof content.blob === "string") {
    return Buffer.from(content.blob, "base64").toString("utf-8");
  }
  throw new Error(`UI resource ${content.uri ?? "(unknown)"} did not include text or blob content`);
}
var OPENAI_CSP_FIELD_MAPPINGS = [
  ["resource_domains", "resourceDomains"],
  ["connect_domains", "connectDomains"],
  ["frame_domains", "frameDomains"]
];
var UI_CSP_DOMAIN_FIELDS = [
  "resourceDomains",
  "connectDomains",
  "frameDomains",
  "baseUriDomains"
];
function extractUiMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const ui = isRecord(meta.ui) ? meta.ui : void 0;
  const out = {};
  const openAiCsp = Object.hasOwn(meta, "openai/widgetCSP") ? normalizeOpenAiWidgetCsp(meta["openai/widgetCSP"]) : void 0;
  const hasStandardCsp = !!ui && Object.hasOwn(ui, "csp");
  const standardCspValue = hasStandardCsp ? ui.csp : void 0;
  if (hasStandardCsp && !isRecord(standardCspValue)) {
    out.csp = {};
  } else {
    const standardCsp = hasStandardCsp ? normalizeUiResourceCsp(standardCspValue) : void 0;
    if (openAiCsp || standardCsp) {
      out.csp = { ...openAiCsp, ...standardCsp };
      if (isRecord(standardCspValue)) {
        for (const [, standardField] of OPENAI_CSP_FIELD_MAPPINGS) {
          if (Object.hasOwn(standardCspValue, standardField) && !copyStringArray(standardCspValue[standardField])) {
            delete out.csp[standardField];
          }
        }
      }
    }
  }
  if (ui && isRecord(ui.permissions)) {
    out.permissions = ui.permissions;
  }
  if (ui && typeof ui.domain === "string") {
    out.domain = ui.domain;
  }
  if (ui && typeof ui.prefersBorder === "boolean") {
    out.prefersBorder = ui.prefersBorder;
  }
  return out;
}
function normalizeUiResourceCsp(value) {
  if (!isRecord(value)) return {};
  const csp = {};
  for (const field of UI_CSP_DOMAIN_FIELDS) {
    const domains = copyStringArray(value[field]);
    if (domains) csp[field] = domains;
  }
  return csp;
}
function normalizeOpenAiWidgetCsp(value) {
  if (!isRecord(value)) return {};
  const csp = {};
  for (const [sourceField, targetField] of OPENAI_CSP_FIELD_MAPPINGS) {
    const domains = copyStringArray(value[sourceField]);
    if (domains) csp[targetField] = domains;
  }
  return csp;
}
function copyStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : void 0;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/extension/initialization.ts
var MAX_FAILURE_MESSAGE_CHARS = 8 * 1024;
var failureExpiryTimers = /* @__PURE__ */ new WeakMap();
function getFailureExpiryTimers(state) {
  let timers = failureExpiryTimers.get(state);
  if (!timers) {
    timers = /* @__PURE__ */ new Map();
    failureExpiryTimers.set(state, timers);
  }
  return timers;
}
function clearFailure(state, serverName, restoredReason) {
  const wasActive = getFailureAgeSeconds(state, serverName) !== null;
  state.failureTracker.delete(serverName);
  state.failureMessages?.delete(serverName);
  const timers = failureExpiryTimers.get(state);
  const timer = timers?.get(serverName);
  if (timer) clearTimeout(timer);
  timers?.delete(serverName);
  if (restoredReason && wasActive) {
    notifyToolMetadataUpdated(state, serverName, restoredReason);
    publishMcpStatusSnapshot(state);
  }
  return wasActive;
}
function recordFailure(state, serverName, message) {
  clearFailure(state, serverName);
  const failedAt = Date.now();
  state.failureTracker.set(serverName, failedAt);
  state.failureMessages?.set(serverName, message.slice(0, MAX_FAILURE_MESSAGE_CHARS));
  const timer = setTimeout(() => {
    if (!state.owner.isActive()) {
      getFailureExpiryTimers(state).delete(serverName);
      return;
    }
    if (state.failureTracker.get(serverName) === failedAt) {
      state.failureTracker.delete(serverName);
      state.failureMessages?.delete(serverName);
      notifyToolMetadataUpdated(state, serverName, "failure-backoff-expired");
      publishMcpStatusSnapshot(state);
    }
    getFailureExpiryTimers(state).delete(serverName);
  }, FAILURE_BACKOFF_MS);
  timer.unref?.();
  getFailureExpiryTimers(state).set(serverName, timer);
  notifyToolMetadataUpdated(state, serverName, "failure-backoff-started");
  publishMcpStatusSnapshot(state);
}
function isTuiMode(ctx) {
  return ctx.hasUI && ctx.mode === "tui";
}
async function initializeMcp(pi, ctx, owner = createMcpRuntimeOwner(), options = {}) {
  const configPath = options.config !== void 0 ? void 0 : options.configPath ?? pi.getFlag("mcp-config");
  const cwd = ctx.cwd;
  const hasUI = ctx.hasUI;
  const mode = ctx.mode;
  const rawUi = hasUI ? ctx.ui : void 0;
  const modelRegistry = ctx.modelRegistry;
  const initialSignal = ctx.signal;
  const ui = rawUi ? createOwnedUi(rawUi, owner) : void 0;
  const runtimeSignal = combineAbortSignals(owner.signal, initialSignal);
  const config = options.config !== void 0 ? cloneMcpConfig(options.config) : loadMcpConfig(configPath, cwd);
  const authStorageOptions = getAuthStorageOptions(config.settings?.oauthDir, cwd);
  const ownsOAuthRuntime = options.oauthRuntime === void 0;
  const oauthRuntime = options.oauthRuntime ?? createOAuthRuntime(owner.signal);
  const manager = new McpServerManager(cwd);
  manager.setRuntimeSignal?.(owner.signal);
  manager.setOAuthRuntime?.(oauthRuntime);
  manager.setDefaultRequestTimeoutMs(config.settings?.requestTimeoutMs);
  manager.setTraceConfig?.(config.settings?.trace);
  manager.setAuthStorageOptions(authStorageOptions);
  const samplingAutoApprove = config.settings?.samplingAutoApprove === true;
  if (config.settings?.sampling !== false && (hasUI || samplingAutoApprove)) {
    manager.setSamplingConfig({
      autoApprove: samplingAutoApprove,
      ...ui !== void 0 ? { ui } : {},
      modelRegistry,
      getCurrentModel: () => owner.isActive() ? ctx.model : void 0,
      getSignal: () => owner.isActive() ? combineAbortSignals(owner.signal, ctx.signal) : owner.signal
    });
  }
  const elicitationEnabled = config.settings?.elicitation !== false && hasUI;
  if (elicitationEnabled && ui) {
    manager.setElicitationConfig({
      ui,
      allowUrl: mode === "tui"
    });
  }
  const lifecycle = new McpLifecycleManager(manager, (serverName) => hasPendingAuth(serverName, void 0, oauthRuntime));
  const toolMetadata = /* @__PURE__ */ new Map();
  const resourceCounts = /* @__PURE__ */ new Map();
  const promptMetadata = /* @__PURE__ */ new Map();
  const promptMetadataLive = /* @__PURE__ */ new Set();
  const serverInstructions = /* @__PURE__ */ new Map();
  const failureTracker = /* @__PURE__ */ new Map();
  const failureMessages = /* @__PURE__ */ new Map();
  const approvedToolCalls = /* @__PURE__ */ new Map();
  const uiResourceHandler = new UiResourceHandler(manager, config);
  const consentManager = new ConsentManager("once-per-server");
  const state = {
    owner,
    manager,
    lifecycle,
    toolMetadata,
    resourceCounts,
    promptMetadata,
    promptMetadataLive,
    serverInstructions,
    config,
    programmaticConfig: options.config !== void 0,
    oauthRuntime,
    authStorageOptions,
    failureTracker,
    failureMessages,
    approvedToolCalls,
    approvalEvents: pi.events,
    uiResourceHandler,
    consentManager,
    uiServer: null,
    completedUiSessions: [],
    openBrowser: async (url) => {
      owner.throwIfInactive();
      await openUrl(pi, url, process.env.BROWSER, owner.signal);
      owner.throwIfInactive();
    },
    ...ui !== void 0 ? { ui } : {},
    sendMessage: (message, options2) => {
      const deliver = () => {
        if (!owner.isActive()) return;
        pi.sendMessage(message, options2);
      };
      if (!options2?.triggerTurn) {
        deliver();
        return;
      }
      void lifecycle.ensureConverged(owner.signal).then(deliver, (error) => {
        if (!owner.isActive() || isAbortError(error, owner.signal)) return;
        const detail = error instanceof Error ? error.message : String(error);
        logger.debug(`MCP: pre-turn keep-alive convergence failed: ${sanitizeTerminalText(detail)}`);
        deliver();
      });
    },
    ...options.statusEvents !== void 0 ? { statusEvents: options.statusEvents } : {}
  };
  if (ownsOAuthRuntime) owner.addCleanup(() => shutdownOAuth(oauthRuntime));
  manager.setMetadataListChangedListener?.((serverName, reason) => {
    if (!owner.isActive()) return;
    updateServerMetadata(state, serverName);
    updateMetadataCache(state, serverName, { preserveEmptyResources: false });
    notifyToolMetadataUpdated(state, serverName, reason);
    updateStatusBar(state);
  });
  owner.addCleanup(() => lifecycle.gracefulShutdown());
  owner.addCleanup(() => {
    if (state.uiServer) {
      state.uiServer.close("runtime_owner_stopped");
      state.uiServer = null;
    }
  });
  const allServerEntries = Object.entries(config.mcpServers);
  const serverEntries = allServerEntries.filter(([, definition]) => !isServerDisabled(definition));
  if (serverEntries.length === 0) {
    if (allServerEntries.length > 0 && hasUI) {
      ui?.notify(`MCP: All ${allServerEntries.length} server(s) are disabled`, "info");
    }
    publishMcpStatusSnapshot(state);
    return state;
  }
  const idleSetting = typeof config.settings?.idleTimeout === "number" ? config.settings.idleTimeout : 10;
  lifecycle.setGlobalIdleTimeout(idleSetting);
  const cachePath = getMetadataCachePath();
  const cacheFileExists = existsSync2(cachePath);
  let cache = loadMetadataCache();
  let bootstrapAll = false;
  if (!cacheFileExists) {
    bootstrapAll = true;
    saveMetadataCache({ version: 1, servers: {} });
  } else if (!cache) {
    cache = { version: 1, servers: {} };
    saveMetadataCache(cache);
  }
  const catalogSnapshot = createMetadataCatalogSnapshot(config, cache);
  const prefix = config.settings?.toolPrefix ?? "server";
  let cachedSelectorCandidateIndex;
  for (const [name, definition] of serverEntries) {
    const lifecycleMode = definition.lifecycle ?? "lazy";
    const persistsAfterFirstSpawn = lifecycleMode === "eager" || lifecycleMode === "lazy-keep-alive";
    const idleOverride = definition.idleTimeout ?? (persistsAfterFirstSpawn ? 0 : void 0);
    lifecycle.registerServer(
      name,
      definition,
      idleOverride !== void 0 ? { idleTimeout: idleOverride } : void 0
    );
    if (lifecycleMode === "keep-alive") {
      lifecycle.markKeepAlive(name, definition);
    }
    const cachedEntry = catalogSnapshot.validEntries.get(name);
    if (cachedEntry) {
      const hasToolFilters = Array.isArray(definition.includeTools) && definition.includeTools.length > 0 || Array.isArray(definition.excludeTools) && definition.excludeTools.length > 0;
      if (hasToolFilters && !cachedSelectorCandidateIndex && catalogSnapshot.cache) {
        cachedSelectorCandidateIndex = createCachedToolSelectorCandidateIndex(config.mcpServers, catalogSnapshot.cache, prefix, catalogSnapshot);
      }
      const metadata = reconstructToolMetadata(name, cachedEntry, prefix, definition, config.mcpServers, catalogSnapshot.cache ?? void 0, cachedSelectorCandidateIndex, catalogSnapshot);
      toolMetadata.set(name, metadata);
      if (Array.isArray(cachedEntry.resources)) {
        resourceCounts.set(name, cachedEntry.resources.length);
      }
      if (cachedEntry.prompts?.length) {
        promptMetadata.set(name, reconstructPromptMetadata(name, cachedEntry.prompts ?? [], prefix, definition));
      }
      if (cachedEntry.instructions) {
        serverInstructions.set(name, cachedEntry.instructions);
      }
    }
  }
  const startupServers = bootstrapAll ? serverEntries : serverEntries.filter(([, definition]) => {
    const mode2 = definition.lifecycle ?? "lazy";
    return mode2 === "keep-alive" || mode2 === "eager";
  });
  if (ui && startupServers.length > 0) {
    const status = formatMcpStatus(state.config, `connecting to ${startupServers.length} servers...`);
    ui.setStatus("mcp", status);
  }
  const results = await parallelLimit(startupServers, 10, async ([name, definition]) => {
    try {
      const connection = await manager.connect(name, definition, runtimeSignal);
      if (connection.status === "needs-auth") {
        return { name, definition, connection: null, error: `OAuth authentication required. Run /mcp-auth ${name}.`, transient: false };
      }
      return { name, definition, connection, error: null, transient: false };
    } catch (error) {
      if (isAbortError(error, runtimeSignal)) {
        if (owner.signal.aborted) throw error;
        return { name, definition, connection: null, error: null, transient: false };
      }
      const transient = isTransientHttpConnectError(error);
      const message = error instanceof Error ? error.message : String(error);
      return { name, definition, connection: null, error: message, transient };
    }
  });
  if (initialSignal?.aborted) return state;
  owner.throwIfInactive();
  const startupKnownMetadata = /* @__PURE__ */ new Map();
  for (const { name, definition, connection } of results) {
    if (!connection) continue;
    const effectivePrefix = resolveToolPrefix(definition, prefix);
    const metadata = [
      ...connection.tools.filter((tool) => tool?.name && isUiToolVisibleToModel(extractUiToolVisibility(tool._meta))).map((tool) => ({
        name: formatToolName(tool.name, name, effectivePrefix),
        originalName: tool.name,
        description: tool.description ?? ""
      })),
      ...definition.exposeResources !== false ? connection.resources.filter((resource) => resource?.name && resource?.uri).map((resource) => {
        const originalName = `read_${resourceNameToToolName(resource.name)}`;
        return {
          name: formatToolName(originalName, name, effectivePrefix),
          originalName,
          description: resource.description ?? `Read resource: ${resource.uri}`,
          resourceUri: resource.uri
        };
      }) : []
    ];
    startupKnownMetadata.set(name, metadata);
  }
  const startupSelectorCandidateIndex = serverEntries.some(([, definition]) => Array.isArray(definition.includeTools) && definition.includeTools.length > 0 || Array.isArray(definition.excludeTools) && definition.excludeTools.length > 0) ? createLiveToolSelectorCandidateIndex(config.mcpServers, startupKnownMetadata, prefix, true) : void 0;
  for (const { name, definition, connection, error, transient } of results) {
    owner.throwIfInactive();
    if (error || !connection) {
      if (initialSignal?.aborted) continue;
      if (error) recordFailure(state, name, error);
      if (transient) {
        const notice = `MCP: ${name} temporarily unavailable (HTTP 503); retry later`;
        logger.debug(`MCP: startup connect hit transient upstream outage for ${name}; will retry`);
        if (ui) ui.notify(notice, "warning");
        else console.error(notice);
        continue;
      }
      const displayError = sanitizeTerminalText(error ?? "Unknown connection failure");
      if (ui) {
        ui.notify(`MCP: Failed to connect to ${name}: ${displayError}`, "error");
      }
      console.error(`MCP: Failed to connect to ${name}: ${displayError}`);
      continue;
    }
    const { metadata, failedTools } = buildToolMetadata(
      connection.tools,
      connection.resources,
      definition,
      name,
      prefix,
      config.mcpServers,
      startupKnownMetadata,
      true,
      startupSelectorCandidateIndex
    );
    toolMetadata.set(name, metadata);
    resourceCounts.set(name, connection.resources.length);
    if (!connection.promptDiscoveryFailed) {
      promptMetadata.set(name, reconstructPromptMetadata(name, connection.prompts ?? [], prefix, definition));
      promptMetadataLive.add(name);
    }
    if (connection.instructions) {
      serverInstructions.set(name, connection.instructions);
    } else {
      serverInstructions.delete(name);
    }
    updateMetadataCache(state, name);
    notifyToolMetadataUpdated(state, name, "startup");
    markKeepAliveAfterConnect(state, name);
    if (failedTools.length > 0 && ui) {
      ui.notify(
        `MCP: ${name} - ${failedTools.length} tools skipped`,
        "warning"
      );
    }
  }
  const connectedCount = results.filter((r) => r.connection).length;
  const failedCount = results.filter((r) => r.error).length;
  if (ui && connectedCount > 0 && config.settings?.notifyOnStartupConnect !== false) {
    const totalTools = totalToolCount(state);
    const msg = failedCount > 0 ? `MCP: ${connectedCount}/${startupServers.length} servers connected (${totalTools} tools)` : `MCP: ${connectedCount} servers connected (${totalTools} tools)`;
    ui.notify(msg, "info");
  }
  const envDirect = process.env.MCP_DIRECT_TOOLS;
  if (envDirect !== "__none__") {
    const currentCache = loadMetadataCache();
    const currentCatalogSnapshot = createMetadataCatalogSnapshot(config, currentCache);
    const envDirectToolOverride = envDirect?.split(",").map((selector) => selector.trim()).filter(Boolean);
    const missingCacheServers = getMissingConfiguredDirectToolServers(
      config,
      currentCatalogSnapshot.cache,
      envDirectToolOverride,
      currentCatalogSnapshot
    );
    if (missingCacheServers.length > 0) {
      const bootstrapResults = await parallelLimit(
        missingCacheServers.filter((name) => !results.some((r) => r.name === name && r.connection)),
        10,
        async (name) => {
          try {
            const definition = config.mcpServers[name];
            if (!definition) throw new Error(`MCP server "${name}" is not configured`);
            const connection = await manager.connect(name, definition, runtimeSignal);
            if (connection.status === "needs-auth") {
              return { name, ok: false };
            }
            updateServerMetadata(state, name);
            updateMetadataCache(state, name);
            const restored = clearFailure(state, name, "direct-tools-bootstrap");
            if (!restored) notifyToolMetadataUpdated(state, name, "direct-tools-bootstrap");
            markKeepAliveAfterConnect(state, name);
            return { name, ok: true };
          } catch (error) {
            if (isAbortError(error, runtimeSignal)) {
              if (owner.signal.aborted) throw error;
              return { name, ok: false };
            }
            const message = error instanceof Error ? error.message : String(error);
            recordFailure(state, name, message);
            logger.debug(`MCP: direct-tools bootstrap failed for ${name}: ${sanitizeTerminalText(message)}`);
            return { name, ok: false };
          }
        }
      );
      const bootstrapped = bootstrapResults.filter((r) => r.ok).map((r) => r.name);
      owner.throwIfInactive();
      if (bootstrapped.length > 0 && ui) {
        ui.notify(`MCP: direct tools for ${bootstrapped.join(", ")} will be available after restart`, "info");
      }
    }
  }
  lifecycle.setReconnectCallback((serverName) => {
    if (!owner.isActive()) return;
    updateServerMetadata(state, serverName);
    updateMetadataCache(state, serverName);
    const restored = clearFailure(state, serverName, "lifecycle-reconnect");
    if (!restored) notifyToolMetadataUpdated(state, serverName, "lifecycle-reconnect");
    updateStatusBar(state);
  });
  lifecycle.setReconnectFailureCallback((serverName, error) => {
    if (!owner.isActive()) return;
    const message = error instanceof Error ? error.message : String(error);
    recordFailure(state, serverName, message);
    updateStatusBar(state);
  });
  lifecycle.setHealthRestoredCallback((serverName) => {
    if (!owner.isActive()) return;
    clearFailure(state, serverName, "health-restored");
    updateStatusBar(state);
  });
  lifecycle.setAuthRequiredCallback((serverName) => {
    if (!owner.isActive()) return;
    clearFailure(state, serverName, "auth-required");
    updateStatusBar(state);
  });
  lifecycle.setIdleShutdownCallback((serverName) => {
    if (!owner.isActive()) return;
    const idleMinutes = getEffectiveIdleTimeoutMinutes(state, serverName);
    logger.debug(`${serverName} shut down (idle ${idleMinutes}m)`);
    updateStatusBar(state);
  });
  owner.throwIfInactive();
  lifecycle.startHealthChecks(runtimeSignal);
  if (config.settings?.mcpFooterStatus === "off") {
    ui?.setStatus("mcp", void 0);
  }
  publishMcpStatusSnapshot(state);
  return state;
}
function markKeepAliveAfterConnect(state, serverName) {
  const definition = state.config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition)) return;
  if ((definition.lifecycle ?? "lazy") === "lazy-keep-alive") {
    state.lifecycle.markKeepAlive(serverName, definition);
  }
}
function updateServerMetadata(state, serverName) {
  const connection = state.manager.getConnection(serverName);
  if (!connection || connection.status !== "connected") return;
  const definition = state.config.mcpServers[serverName];
  if (!definition) return;
  if (isServerDisabled(definition)) {
    state.toolMetadata.delete(serverName);
    state.resourceCounts?.delete(serverName);
    state.promptMetadata?.delete(serverName);
    state.promptMetadataLive?.delete(serverName);
    state.serverInstructions.delete(serverName);
    return;
  }
  const prefix = state.config.settings?.toolPrefix ?? "server";
  const { metadata } = buildToolMetadata(connection.tools, connection.resources, definition, serverName, prefix, state.config.mcpServers, state.toolMetadata);
  state.toolMetadata.set(serverName, metadata);
  state.resourceCounts?.set(serverName, connection.resources.length);
  if (!connection.promptDiscoveryFailed) {
    state.promptMetadata?.set(serverName, reconstructPromptMetadata(serverName, connection.prompts ?? [], prefix, definition));
    state.promptMetadataLive?.add(serverName);
  }
  if (connection.instructions) {
    state.serverInstructions?.set(serverName, connection.instructions);
  } else {
    state.serverInstructions?.delete(serverName);
  }
}
function updateMetadataCache(state, serverName, options = {}) {
  const connection = state.manager.getConnection(serverName);
  if (!connection || connection.status !== "connected") return;
  const definition = state.config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition)) return;
  const configHash = computeServerHash(definition);
  const existing = loadMetadataCache();
  const existingEntry = existing?.servers?.[serverName];
  const tools = serializeTools(connection.tools);
  let resources = definition.exposeResources === false ? [] : serializeResources(connection.resources);
  const prompts = connection.promptDiscoveryFailed ? existingEntry?.configHash === configHash ? existingEntry.prompts : void 0 : serializePrompts(connection.prompts ?? []);
  if (definition.exposeResources !== false && resources.length === 0 && existingEntry?.resources?.length && existingEntry.configHash === configHash && options.preserveEmptyResources !== false) {
    resources = existingEntry.resources;
  }
  const entry = {
    configHash,
    tools,
    resources,
    ...prompts !== void 0 ? { prompts } : {},
    ...connection.instructions !== void 0 ? { instructions: connection.instructions } : {},
    cachedAt: Date.now()
  };
  saveMetadataCache({ version: 1, servers: { [serverName]: entry } });
}
function notifyToolMetadataUpdated(state, serverName, reason) {
  try {
    const result = state.onToolMetadataUpdated?.(serverName, reason);
    if (result && typeof result.catch === "function") {
      result.catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug(`MCP: metadata update hook failed for ${serverName}: ${message}`);
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(`MCP: metadata update hook failed for ${serverName}: ${message}`);
  }
}
function flushMetadataCache(state) {
  for (const [name, connection] of state.manager.getAllConnections()) {
    if (connection.status === "connected") {
      updateMetadataCache(state, name);
    }
  }
}
function updateStatusBar(state) {
  publishMcpStatusSnapshot(state);
  const ui = state.ui;
  if (!ui) return;
  const entries = Object.entries(state.config.mcpServers);
  const disabledCount = entries.filter(([, definition]) => isServerDisabled(definition)).length;
  const enabledCount = entries.length - disabledCount;
  if (entries.length === 0) {
    ui.setStatus("mcp", void 0);
    return;
  }
  const connectedCount = [...state.manager.getAllConnections()].filter(([name, connection]) => {
    const definition = state.config.mcpServers[name];
    return connection.status === "connected" && definition !== void 0 && !isServerDisabled(definition);
  }).length;
  const footerStatus = state.config.settings?.mcpFooterStatus ?? "full";
  if (footerStatus === "off") {
    ui.setStatus("mcp", void 0);
    return;
  }
  let status = footerStatus === "compact" ? `MCP ${connectedCount}/${enabledCount}` : `${enabledCount} ${enabledCount === 1 ? "server" : "servers"} enabled`;
  if (footerStatus === "full") {
    if (connectedCount > 0) status += ` (${connectedCount} connected)`;
    if (disabledCount > 0) status += ` (${disabledCount} disabled)`;
  }
  const formattedStatus = footerStatus === "compact" ? status : formatMcpStatus(state.config, status);
  if (formattedStatus === void 0) {
    ui.setStatus("mcp", void 0);
    return;
  }
  ui.setStatus("mcp", ui.theme ? ui.theme.fg("accent", formattedStatus) : formattedStatus);
}
async function lazyConnect(state, serverName, signal) {
  const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
  throwIfAborted(ownedSignal);
  const connection = state.manager.getConnection(serverName);
  if (connection?.status === "needs-auth") {
    return false;
  }
  if (connection?.status === "connected") {
    updateServerMetadata(state, serverName);
    markKeepAliveAfterConnect(state, serverName);
    return true;
  }
  const failedAgo = getFailureAgeSeconds(state, serverName);
  if (failedAgo !== null) return false;
  const definition = state.config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition)) return false;
  try {
    if (state.ui) {
      const status = formatMcpStatus(state.config, `connecting to ${serverName}...`);
      state.ui.setStatus("mcp", status);
    }
    const newConnection = await state.manager.connect(serverName, definition, ownedSignal);
    if (newConnection.status === "needs-auth") {
      return false;
    }
    updateServerMetadata(state, serverName);
    updateMetadataCache(state, serverName);
    const restored = clearFailure(state, serverName, "lazy-connect");
    if (!restored) notifyToolMetadataUpdated(state, serverName, "lazy-connect");
    markKeepAliveAfterConnect(state, serverName);
    updateStatusBar(state);
    return true;
  } catch (error) {
    if (isAbortError(error, ownedSignal)) {
      throwIfAborted(ownedSignal);
    }
    const message = error instanceof Error ? error.message : String(error);
    recordFailure(state, serverName, message);
    logger.debug(`MCP: lazy connect failed for ${serverName}: ${sanitizeTerminalText(message)}`);
    updateStatusBar(state);
    return false;
  }
}
function getEffectiveIdleTimeoutMinutes(state, serverName) {
  const definition = state.config.mcpServers[serverName];
  if (!definition) {
    return typeof state.config.settings?.idleTimeout === "number" ? state.config.settings.idleTimeout : 10;
  }
  if (typeof definition.idleTimeout === "number") return definition.idleTimeout;
  const mode = definition.lifecycle ?? "lazy";
  if (mode === "eager" || mode === "lazy-keep-alive") return 0;
  return typeof state.config.settings?.idleTimeout === "number" ? state.config.settings.idleTimeout : 10;
}

export {
  ServerError,
  wrapError,
  UI_STREAM_HOST_CONTEXT_KEY,
  UI_STREAM_REQUEST_META_KEY,
  UI_STREAM_STRUCTURED_CONTENT_KEY,
  getVisualizationStreamEnvelope,
  removeBearerToken,
  inspectBearerTokenForUrl,
  SessionRecoveryAuthRequiredError,
  withSessionRecovery,
  buildToolMetadata,
  getToolNames,
  findToolByName,
  formatSchema,
  clearFailure,
  recordFailure,
  isTuiMode,
  initializeMcp,
  markKeepAliveAfterConnect,
  updateServerMetadata,
  updateMetadataCache,
  notifyToolMetadataUpdated,
  flushMetadataCache,
  updateStatusBar,
  lazyConnect
};
