// src/tools/tool-registrar.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
var MAX_BINARY_RESOURCE_BYTES = 10 * 1024 * 1024;
var MAX_SESSION_RESOURCE_BYTES = 100 * 1024 * 1024;
var MAX_SESSION_RESOURCE_FILES = 1e4;
var CLEANUP_RETRY_DELAY_MS = 3e4;
var MAX_CLEANUP_RETRY_ATTEMPTS = 3;
function createMaterializedResourceSession() {
  return {
    directory: void 0,
    bytes: 0,
    files: 0,
    sequence: 0
  };
}
var defaultMaterializedResourceSession = createMaterializedResourceSession();
var scopedMaterializedResourceSessions = /* @__PURE__ */ new WeakMap();
var pendingCleanupDirectories = /* @__PURE__ */ new Set();
var cleanupRetryAttempts = /* @__PURE__ */ new Map();
var pendingCleanupRetry;
function isAbortedScope(scope) {
  return !!scope && "aborted" in scope && scope.aborted === true;
}
function getMaterializedResourceSession(scope) {
  if (isAbortedScope(scope)) return void 0;
  if (!scope) return defaultMaterializedResourceSession;
  let session = scopedMaterializedResourceSessions.get(scope);
  if (!session) {
    session = createMaterializedResourceSession();
    scopedMaterializedResourceSessions.set(scope, session);
  }
  return session;
}
function hasRetryableCleanupDirectory() {
  for (const directory of pendingCleanupDirectories) {
    if ((cleanupRetryAttempts.get(directory) ?? 0) < MAX_CLEANUP_RETRY_ATTEMPTS) return true;
  }
  return false;
}
function schedulePendingCleanupRetry() {
  if (pendingCleanupRetry || !hasRetryableCleanupDirectory()) return;
  for (const directory of pendingCleanupDirectories) {
    const attempts = cleanupRetryAttempts.get(directory) ?? 0;
    if (attempts < MAX_CLEANUP_RETRY_ATTEMPTS) cleanupRetryAttempts.set(directory, attempts + 1);
  }
  pendingCleanupRetry = setTimeout(() => {
    pendingCleanupRetry = void 0;
    try {
      drainPendingCleanupDirectories();
    } catch {
    }
  }, CLEANUP_RETRY_DELAY_MS);
}
function drainPendingCleanupDirectories() {
  const failures = [];
  for (const directory of Array.from(pendingCleanupDirectories)) {
    try {
      rmSync(directory, { recursive: true, force: true });
      pendingCleanupDirectories.delete(directory);
      cleanupRetryAttempts.delete(directory);
    } catch (error) {
      failures.push(error);
    }
  }
  if (pendingCleanupDirectories.size === 0 && pendingCleanupRetry) {
    clearTimeout(pendingCleanupRetry);
    pendingCleanupRetry = void 0;
  }
  if (failures.length > 0) {
    schedulePendingCleanupRetry();
    throw new AggregateError(failures, "Failed to clean materialized MCP resources");
  }
}
function cleanupMaterializedBinaryResources(scope) {
  const session = scope ? scopedMaterializedResourceSessions.get(scope) : defaultMaterializedResourceSession;
  if (session?.directory) pendingCleanupDirectories.add(session.directory);
  if (session) {
    session.directory = void 0;
    session.bytes = 0;
    session.files = 0;
    session.sequence = 0;
    if (scope) scopedMaterializedResourceSessions.delete(scope);
  }
  drainPendingCleanupDirectories();
}
function replaceBlob(resource, text) {
  delete resource.blob;
  resource.text = text;
  return text;
}
function omitBinaryResource(resource, reason) {
  return replaceBlob(resource, [
    `[Resource: ${resource.uri ?? "(no URI)"}]`,
    `Binary content omitted: ${reason}`,
    `MIME type: ${resource.mimeType ?? "application/octet-stream"}`
  ].join("\n"));
}
function materializeBinaryResource(resource, scope) {
  const session = getMaterializedResourceSession(scope);
  if (!session) return omitBinaryResource(resource, "runtime stopped");
  const decodedBytes = Buffer.byteLength(resource.blob, "base64");
  if (decodedBytes > MAX_BINARY_RESOURCE_BYTES) {
    return omitBinaryResource(resource, "decoded size exceeds 10 MiB");
  }
  if (session.bytes + decodedBytes > MAX_SESSION_RESOURCE_BYTES || session.files >= MAX_SESSION_RESOURCE_FILES) {
    return omitBinaryResource(resource, "session resource limit reached");
  }
  try {
    session.directory ??= mkdtempSync(join(tmpdir(), "pi-mcp-resource-"));
  } catch {
    return omitBinaryResource(resource, "could not be saved");
  }
  const filePath = join(session.directory, `resource-${++session.sequence}.bin`);
  session.bytes += decodedBytes;
  session.files += 1;
  try {
    writeFileSync(filePath, Buffer.from(resource.blob, "base64"), { flag: "wx", mode: 384 });
  } catch {
    try {
      rmSync(filePath, { force: true });
      session.bytes -= decodedBytes;
      session.files -= 1;
    } catch {
    }
    return omitBinaryResource(resource, "could not be saved");
  }
  return replaceBlob(resource, [
    `[Resource: ${resource.uri ?? "(no URI)"}]`,
    `Binary content saved to ${filePath}`,
    `MIME type: ${resource.mimeType ?? "application/octet-stream"}`
  ].join("\n"));
}
function transformMcpResourceContents(contents, scope) {
  return contents.map((resource) => {
    if (typeof resource.text === "string") return { type: "text", text: resource.text };
    if (typeof resource.blob === "string") return { type: "text", text: materializeBinaryResource(resource, scope) };
    return { type: "text", text: JSON.stringify(resource) };
  });
}
function transformMcpContent(content, scope) {
  return content.map((c) => {
    if (c.type === "text") {
      return { type: "text", text: c.text ?? "" };
    }
    if (c.type === "image") {
      return {
        type: "image",
        data: c.data ?? "",
        mimeType: c.mimeType ?? "image/png"
      };
    }
    if (c.type === "resource") {
      const resourceUri = c.resource?.uri ?? "(no URI)";
      if (c.resource && "blob" in c.resource && typeof c.resource.blob === "string") {
        const binaryResource = c.resource;
        return {
          type: "text",
          text: materializeBinaryResource(binaryResource, scope)
        };
      }
      const resourceContent = c.resource?.text ?? (c.resource ? JSON.stringify(c.resource) : "(no content)");
      return {
        type: "text",
        text: `[Resource: ${resourceUri}]
${resourceContent}`
      };
    }
    if (c.type === "resource_link") {
      const linkName = c.name ?? c.uri ?? "unknown";
      const linkUri = c.uri ?? "(no URI)";
      return {
        type: "text",
        text: `[Resource Link: ${linkName}]
URI: ${linkUri}`
      };
    }
    if (c.type === "audio") {
      return {
        type: "text",
        text: `[Audio content: ${c.mimeType ?? "audio/*"}]`
      };
    }
    return { type: "text", text: JSON.stringify(c) };
  });
}
function resolveMcpResultContent(result, scope) {
  const blocks = transformMcpContent(Array.isArray(result.content) ? result.content : [], scope);
  if (blocks.length > 0) return blocks;
  if (result.structuredContent !== void 0 && result.structuredContent !== null) {
    return [{ type: "text", text: stringifyStructuredContent(result.structuredContent) }];
  }
  return [];
}
function stringifyStructuredContent(value) {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export {
  cleanupMaterializedBinaryResources,
  transformMcpResourceContents,
  transformMcpContent,
  resolveMcpResultContent
};
