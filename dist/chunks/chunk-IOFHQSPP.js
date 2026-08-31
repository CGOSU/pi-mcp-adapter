// src/utils.ts
import { spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { extname, isAbsolute, join } from "node:path";
async function execOpen(pi, target, browser, signal) {
  const os = platform();
  if (os === "darwin") {
    if (browser) {
      return isAbsolute(browser) && extname(browser).toLowerCase() !== ".app" ? pi.exec(browser, [target], signal ? { signal } : {}) : pi.exec("open", ["-a", browser, target], signal ? { signal } : {});
    }
    return pi.exec("open", [target], signal ? { signal } : {});
  }
  if (os === "win32") {
    return browser ? pi.exec("cmd", ["/c", "start", "", browser, target], signal ? { signal } : {}) : pi.exec("cmd", ["/c", "start", "", target], signal ? { signal } : {});
  }
  return browser ? pi.exec(browser, [target], signal ? { signal } : {}) : pi.exec("xdg-open", [target], signal ? { signal } : {});
}
async function openUrl(pi, url, browser, signal) {
  const result = await execOpen(pi, url, browser, signal);
  if (result.code !== 0) {
    throw new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);
  }
}
async function openPath(pi, targetPath) {
  const result = await execOpen(pi, targetPath);
  if (result.code !== 0) {
    throw new Error(result.stderr || `Failed to open path (exit code ${result.code})`);
  }
}
async function parallelLimit(items, limit, fn) {
  const results = [];
  const iterator = items.entries();
  async function worker() {
    while (true) {
      const next = iterator.next();
      if (next.done) return;
      const [index, item] = next.value;
      results[index] = await fn(item);
    }
  }
  const workers = Array(Math.min(limit, items.length)).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}
function getConfigPathFromArgv() {
  const idx = process.argv.indexOf("--mcp-config");
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return void 0;
}
function interpolateEnvVars(value, environment = process.env) {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => environment[name] ?? "").replace(/\$env:(\w+)/g, (_, name) => environment[name] ?? "").replace(/\{env:(\w+)\}/g, (_, name) => environment[name] ?? "");
}
function getMissingEnvVars(value, environment) {
  const missing = /* @__PURE__ */ new Set();
  for (const match of value.matchAll(/\$\{(\w+)\}|\$env:(\w+)|\{env:(\w+)\}/g)) {
    const name = match[1] ?? match[2] ?? match[3];
    if (name && environment[name] === void 0) {
      missing.add(name);
    }
  }
  return [...missing];
}
function interpolateSecretExpression(value, environment) {
  if (value.startsWith("!!")) return interpolateEnvVars(value.slice(1), environment);
  return value.startsWith("!") ? value : interpolateEnvVars(value, environment);
}
function interpolateEnvRecord(values, environment = process.env) {
  if (!values) return void 0;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    interpolateSecretExpression(value, environment)
  ]));
}
var COMMAND_SECRET_TIMEOUT_MS = 1e4;
var COMMAND_SECRET_MAX_OUTPUT_BYTES = 1024 * 1024;
function resolveCommandSecret(value, context) {
  if (value === void 0) return void 0;
  if (value.startsWith("!!")) return interpolateEnvVars(value.slice(1));
  if (!value.startsWith("!")) return interpolateEnvVars(value);
  const result = spawnSync(value.slice(1), {
    shell: true,
    encoding: "utf8",
    timeout: COMMAND_SECRET_TIMEOUT_MS,
    maxBuffer: COMMAND_SECRET_MAX_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true
  });
  if (result.error) {
    const code = result.error.code;
    const reason = code === "ETIMEDOUT" ? "command timed out after 10 seconds" : code === "ENOBUFS" ? "command output exceeded 1 MiB" : "command failed to start";
    throw new Error(`Failed to resolve ${context}: ${reason}`);
  }
  if (result.status !== 0) {
    throw new Error(`Failed to resolve ${context}: command exited with code ${result.status ?? "unknown"}`);
  }
  const resolved = result.stdout.trim();
  if (!resolved) throw new Error(`Failed to resolve ${context}: command returned empty output`);
  return resolved;
}
function resolveCommandSecretsRecord(values, context) {
  if (!values) return void 0;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    resolveCommandSecret(value, context(key))
  ]));
}
function resolveServerUrl(definition, environment = process.env) {
  if (definition.url == null) return void 0;
  if (typeof definition.url !== "string") {
    throw new Error("MCP server URL must be a string");
  }
  const missing = getMissingEnvVars(definition.url, environment);
  if (missing.length > 0) {
    throw new Error(`Missing environment variable${missing.length === 1 ? "" : "s"} in MCP server URL: ${missing.join(", ")}`);
  }
  const resolved = interpolateEnvVars(definition.url, environment);
  try {
    new URL(resolved);
  } catch (error) {
    throw new Error(`Invalid MCP server URL after environment interpolation: ${resolved}`, { cause: error });
  }
  return resolved;
}
function resolveConfigPath(value, environment = process.env) {
  if (value === void 0) return void 0;
  const resolved = interpolateEnvVars(value, environment);
  if (resolved === "~") return homedir();
  if (resolved.startsWith("~/") || resolved.startsWith("~\\")) {
    return join(homedir(), resolved.slice(2));
  }
  return resolved;
}
function resolveBearerToken(definition, environment = process.env) {
  if (definition.bearerToken !== void 0) {
    return interpolateSecretExpression(definition.bearerToken, environment);
  }
  return definition.bearerTokenEnv ? environment[definition.bearerTokenEnv] : void 0;
}
function stripOscSequences(text) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const isEscOsc = text.charCodeAt(index) === 27 && text[index + 1] === "]";
    const isC1Osc = text.charCodeAt(index) === 157;
    if (!isEscOsc && !isC1Osc) {
      result += text[index++];
      continue;
    }
    index += isEscOsc ? 2 : 1;
    while (index < text.length) {
      const code = text.charCodeAt(index++);
      if (code === 7 || code === 156) break;
      if (code === 27 && text[index] === "\\") {
        index++;
        break;
      }
    }
  }
  return result;
}
function sanitizeTerminalText(text) {
  return stripOscSequences(text).replace(/(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_])/g, "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
}
function formatTerminalError(error) {
  const messages = [];
  const seen = /* @__PURE__ */ new Set();
  const collect = (value) => {
    if (seen.has(value)) return;
    if (typeof value === "object" && value !== null || typeof value === "function") seen.add(value);
    if (value instanceof AggregateError) {
      const countBefore = messages.length;
      for (const nested of value.errors) collect(nested);
      if (value.cause !== void 0) collect(value.cause);
      if (messages.length === countBefore && value.message) messages.push(value.message);
      return;
    }
    if (value instanceof Error) {
      if (value.message) messages.push(value.message);
      if (value.cause !== void 0) collect(value.cause);
      return;
    }
    messages.push(String(value));
  };
  collect(error);
  return sanitizeTerminalText([...new Set(messages)].join(": "));
}
function truncateAtWord(text, target) {
  if (!text || text.length <= target) return text;
  const truncated = text.slice(0, target);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > target * 0.6) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}
function normalizeDirectToolInputSchema(schema) {
  const inputSchema = schema && typeof schema === "object" && !Array.isArray(schema) ? schema : { type: "object", properties: {} };
  const { $schema, additionalProperties, ...normalized } = inputSchema;
  return normalized;
}
function normalizeToolArguments(value, context = "tool arguments") {
  if (value === void 0 || value === null || value === "") return {};
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return {};
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `${context}: invalid args JSON (${error instanceof SyntaxError ? error.message : String(error)}); pass args as a JSON object, or as a valid JSON string encoding one`,
        { cause: error }
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(
        `${context}: expected a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`
      );
    }
    return parsed;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `${context}: expected a JSON object, got ${Array.isArray(value) ? "array" : typeof value}`
    );
  }
  assertJsonSerializable(value, context);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new Error(
      `${context}: value is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}
function assertJsonSerializable(value, context, path = "") {
  if (value === null) return;
  if (typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${context}: value at ${path || "root"} is not a finite number`);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertJsonSerializable(item, context, `${path}[${index}]`);
    return;
  }
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error(`${context}: value at ${path || "root"} is not a plain JSON object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`${context}: value at ${path || "root"} has symbol keys`);
    }
    for (const [key, item] of Object.entries(value)) {
      assertJsonSerializable(item, context, path ? `${path}.${key}` : key);
    }
    return;
  }
  throw new Error(`${context}: value at ${path || "root"} is not JSON-serializable`);
}
function formatAuthRequiredMessage(config, serverName, defaultMessage) {
  const template = config.settings?.authRequiredMessage;
  return template ? template.replaceAll("${server}", serverName) : defaultMessage;
}
function formatMcpStatus(config, message) {
  if (config.settings?.mcpFooterStatus === "off") return void 0;
  return `${config.settings?.showStatusIcon === false ? "MCP: " : "\u{1F50C} MCP: "}${message}`;
}
function extractToolUiStreamMode(toolMeta) {
  const uiMeta = toolMeta?.ui;
  if (!uiMeta || typeof uiMeta !== "object") return void 0;
  const streamMode = uiMeta["pi-mcp-adapter.streamMode"];
  if (streamMode === "eager" || streamMode === "stream-first") {
    return streamMode;
  }
  return void 0;
}

export {
  openUrl,
  openPath,
  parallelLimit,
  getConfigPathFromArgv,
  interpolateEnvVars,
  interpolateEnvRecord,
  resolveCommandSecret,
  resolveCommandSecretsRecord,
  resolveServerUrl,
  resolveConfigPath,
  resolveBearerToken,
  stripOscSequences,
  sanitizeTerminalText,
  formatTerminalError,
  truncateAtWord,
  normalizeDirectToolInputSchema,
  normalizeToolArguments,
  formatAuthRequiredMessage,
  formatMcpStatus,
  extractToolUiStreamMode
};
