import {
  executeCall,
  paginate,
  rankSuggestions,
  rankToolMatches,
  renderTsShape
} from "./chunk-ZSWU6NM7.js";
import {
  guardMcpOutput,
  guardedMcpDetails,
  resolveMcpOutputGuardOptions
} from "./chunk-AQCTLUTP.js";
import {
  findToolByName,
  formatSchema
} from "./chunk-ZKXUDEBO.js";
import {
  isServerInActiveFailureBackoff
} from "./chunk-KLTV33HH.js";
import "./chunk-LETXAJ4X.js";
import {
  combineAbortSignals
} from "./chunk-YFB6HSH2.js";
import "./chunk-QEVIMIQ3.js";
import "./chunk-YZ65OQRG.js";
import "./chunk-KNN6K7BJ.js";
import "./chunk-PXMBC3S7.js";
import "./chunk-IOFHQSPP.js";
import "./chunk-LVZ7J2NB.js";
import "./chunk-ELOBWFRH.js";

// src/tools/mcp-code.ts
import { formatWithOptions } from "node:util";
import { Worker } from "node:worker_threads";
var DEFAULT_MCP_SCRIPT_TIMEOUT_MS = 3e4;
var McpScriptTimeoutError = class extends Error {
  constructor(timeoutMs) {
    super(`mcpScript timed out after ${timeoutMs}ms`);
    this.name = "McpScriptTimeoutError";
  }
};
function needsInspectableFormatting(value, stack = /* @__PURE__ */ new WeakSet()) {
  if (value === void 0 || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") return true;
  if (typeof value !== "object" || value === null) return false;
  if (stack.has(value)) return true;
  if (value instanceof Map || value instanceof Set || value instanceof WeakMap || value instanceof WeakSet) return true;
  stack.add(value);
  try {
    return Object.values(value).some((entry) => needsInspectableFormatting(entry, stack));
  } finally {
    stack.delete(value);
  }
}
function formatValue(value) {
  if (typeof value === "string") return value;
  try {
    if (!needsInspectableFormatting(value)) {
      const json = JSON.stringify(value, null, 2);
      if (json !== void 0) return json;
    }
    return formatWithOptions({ colors: false, depth: 6 }, value);
  } catch {
    return "[unserializable value]";
  }
}
function toContentBlock(value) {
  if (typeof value === "object" && value !== null) {
    const block = value;
    if (block.type === "text" && typeof block.text === "string") {
      return { type: "text", text: block.text };
    }
    if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
      return { type: "image", data: block.data, mimeType: block.mimeType };
    }
  }
  return { type: "text", text: formatValue(value) };
}
function textFromContent(content) {
  return content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}
function abortReasonError(reason) {
  return reason instanceof Error ? reason : new Error(String(reason ?? "MCP request aborted"));
}
function parseWorkerMessage(value) {
  if (typeof value !== "object" || value === null) return null;
  const message = value;
  if (message.type === "emit" && "block" in message) return { type: "emit", block: message.block };
  if (message.type === "call" && typeof message.id === "number" && typeof message.path === "string") {
    return "args" in message ? { type: "call", id: message.id, path: message.path, args: message.args } : { type: "call", id: message.id, path: message.path };
  }
  if ((message.type === "search" || message.type === "describe") && typeof message.id === "number") {
    return "input" in message ? { type: message.type, id: message.id, input: message.input } : { type: message.type, id: message.id };
  }
  if (message.type === "done") {
    return "returnBlock" in message ? { type: "done", returnBlock: message.returnBlock } : { type: "done" };
  }
  if (message.type === "error" && typeof message.message === "string") {
    return { type: "error", message: message.message };
  }
  return null;
}
async function runMcpScript(state, code, timeoutMs = DEFAULT_MCP_SCRIPT_TIMEOUT_MS, getPiTools, signal) {
  const resolvedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : DEFAULT_MCP_SCRIPT_TIMEOUT_MS;
  const output = [];
  const externalSignal = combineAbortSignals(state.owner?.signal, signal);
  const timeoutController = new AbortController();
  const callSignal = combineAbortSignals(externalSignal, timeoutController.signal);
  const calls = [];
  const snapshotCalls = () => calls.map(({ startedAt, ...operation }) => ({
    ...operation,
    durationMs: "error" in operation && operation.error === "incomplete" ? Math.max(0, Date.now() - startedAt) : operation.durationMs
  }));
  let callsSnapshot;
  const callTool = async (path, args) => {
    const startedAt = Date.now();
    const index = calls.push({ operation: "call", path, ok: false, error: "incomplete", durationMs: 0, startedAt }) - 1;
    const result = await executeCall(state, path, args, void 0, getPiTools, callSignal, "script");
    const details = result.details;
    if (details.error !== void 0) {
      const errorCode2 = String(details.error);
      const suggestions = Array.isArray(details.suggestions) ? details.suggestions.filter((suggestion) => typeof suggestion === "string") : [];
      const message = errorCode2 === "tool_not_found" ? `Tool "${path}" not found. Use await tools.search({ query: "..." }) inside mcpScript.${suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}` : ""}` : typeof details.message === "string" ? details.message : textFromContent(result.content);
      calls[index] = { operation: "call", path, ok: false, error: errorCode2, durationMs: Date.now() - startedAt, startedAt };
      return {
        ok: false,
        error: { code: errorCode2, message }
      };
    }
    calls[index] = { operation: "call", path, ok: true, durationMs: Date.now() - startedAt, startedAt };
    return {
      ok: true,
      data: details.mcpResult !== void 0 ? details.mcpResult : textFromContent(result.content)
    };
  };
  const searchTools = (input) => {
    const startedAt = Date.now();
    const query = typeof input?.query === "string" ? input.query : "";
    let error;
    try {
      if (query.trim() === "") {
        return { items: [], total: 0, hasMore: false, nextOffset: null };
      }
      const server = typeof input?.server === "string" ? input.server : void 0;
      const limit = typeof input?.limit === "number" ? input.limit : 12;
      const offset = typeof input?.offset === "number" ? input.offset : 0;
      const page = paginate(rankToolMatches(state, query, server), offset, limit);
      return {
        ...page,
        items: page.items.map(({ server: matchServer, tool, score }) => ({
          path: tool.name,
          name: tool.originalName,
          server: matchServer,
          ...tool.description ? { description: tool.description } : {},
          score
        }))
      };
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      calls.push(error === void 0 ? { operation: "search", query, ok: true, durationMs: Date.now() - startedAt, startedAt } : { operation: "search", query, ok: false, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt, startedAt });
    }
  };
  const describeTool = (input) => {
    const startedAt = Date.now();
    const path = typeof input?.path === "string" ? input.path : "";
    let error;
    try {
      for (const [server, metadata] of state.toolMetadata) {
        if (isServerInActiveFailureBackoff(state, server)) continue;
        const tool = findToolByName(metadata, path);
        if (!tool) continue;
        const inputTypeScript = tool.inputSchema ? renderTsShape(tool.inputSchema) ?? formatSchema(tool.inputSchema) : null;
        return {
          path: tool.name,
          name: tool.originalName,
          server,
          ...tool.description ? { description: tool.description } : {},
          ...inputTypeScript ? { inputTypeScript } : {}
        };
      }
      const suggestions = path ? rankSuggestions(state, path, 5) : [];
      error = "tool_not_found";
      return {
        path,
        error: {
          code: "tool_not_found",
          message: `Tool not found: ${path}`,
          suggestions
        }
      };
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      calls.push(error === void 0 ? { operation: "describe", path, ok: true, durationMs: Date.now() - startedAt, startedAt } : { operation: "describe", path, ok: false, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt, startedAt });
    }
  };
  let worker;
  let timer;
  let removeAbortListener = () => {
  };
  let errorCode;
  let errorMessage;
  try {
    if (externalSignal?.aborted) {
      throw abortReasonError(externalSignal.reason);
    }
    worker = new Worker(new URL("./mcp-script-worker.mjs", import.meta.url), {
      workerData: { code },
      env: {},
      // The sandbox cannot open files, and the host always terminates this worker.
      // Disable Node's unmanaged FD bookkeeping, which emits false warnings when
      // short-lived workers are terminated on Node 24.
      trackUnmanagedFds: false
    });
    const activeWorker = worker;
    const execution = new Promise((resolve, reject) => {
      let completed = false;
      activeWorker.on("message", (value) => {
        const message = parseWorkerMessage(value);
        if (!message || completed) return;
        if (message.type === "emit") {
          output.push(toContentBlock(message.block));
          return;
        }
        if (message.type === "done") {
          completed = true;
          if ("returnBlock" in message) output.push(toContentBlock(message.returnBlock));
          resolve();
          return;
        }
        if (message.type === "error") {
          completed = true;
          reject(new Error(message.message));
          return;
        }
        void (async () => {
          let envelope;
          if (message.type === "call") {
            envelope = await callTool(message.path, message.args);
          } else if (message.type === "search") {
            envelope = searchTools(message.input);
          } else {
            envelope = describeTool(message.input);
          }
          const response = { type: "result", id: message.id, envelope };
          activeWorker.postMessage(response);
        })().catch(reject);
      });
      activeWorker.once("error", reject);
      activeWorker.once("exit", (code2) => {
        if (!completed && code2 !== 0) reject(new Error(`mcpScript worker exited with code ${code2}`));
      });
    });
    const timeoutError = new McpScriptTimeoutError(resolvedTimeoutMs);
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        callsSnapshot = snapshotCalls();
        timeoutController.abort(timeoutError);
        void activeWorker.terminate();
        reject(timeoutError);
      }, resolvedTimeoutMs);
    });
    const aborted = externalSignal ? new Promise((_resolve, reject) => {
      const onAbort = () => {
        callsSnapshot = snapshotCalls();
        void activeWorker.terminate();
        reject(abortReasonError(externalSignal.reason));
      };
      externalSignal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => externalSignal.removeEventListener("abort", onAbort);
    }) : new Promise(() => {
    });
    await Promise.race([execution, timeout, aborted]);
  } catch (error) {
    if (error instanceof McpScriptTimeoutError) {
      errorCode = "timeout";
      errorMessage = `mcpScript timed out after ${resolvedTimeoutMs}ms`;
    } else if (externalSignal?.aborted) {
      errorCode = "aborted";
      errorMessage = error instanceof Error ? error.message : String(error);
    } else {
      errorCode = "script_error";
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    output.push({ type: "text", text: errorMessage });
  } finally {
    clearTimeout(timer);
    removeAbortListener();
    callsSnapshot ??= snapshotCalls();
    timeoutController.abort(new Error("mcpScript finished"));
    await worker?.terminate();
  }
  const guarded = await guardMcpOutput(
    output.length > 0 ? [...output] : [{ type: "text", text: "(no output)" }],
    resolveMcpOutputGuardOptions(state.config.settings)
  );
  return {
    content: guarded.content,
    details: {
      mode: "script",
      ...errorCode ? { error: errorCode, message: errorMessage } : {},
      timeoutMs: resolvedTimeoutMs,
      ...callsSnapshot.length > 0 ? { calls: callsSnapshot } : {},
      ...guardedMcpDetails(guarded)
    }
  };
}
export {
  DEFAULT_MCP_SCRIPT_TIMEOUT_MS,
  runMcpScript
};
