// src/config/merge.ts
function mergeConfigs(base, next) {
  const settings = next.settings ? { ...base.settings, ...next.settings } : base.settings;
  return {
    mcpServers: mergeServerMaps(base.mcpServers, next.mcpServers),
    ...settings !== void 0 ? { settings } : {}
  };
}
var URL_BOUND_AUTH_FIELDS = ["headers", "bearerToken", "bearerTokenEnv", "bearerTokenStore", "requestHeadersCommand"];
function mergeServerMaps(base, next) {
  const merged = { ...base };
  for (const [name, definition] of Object.entries(next)) {
    const existing = merged[name];
    let baseEntry = existing ?? {};
    if (existing && typeof definition.command === "string") {
      baseEntry = { ...existing };
      for (const field of [
        "url",
        "headers",
        "requestHeadersCommand",
        "auth",
        "bearerToken",
        "bearerTokenEnv",
        "oauth",
        "httpTransport",
        "socket"
      ]) {
        delete baseEntry[field];
      }
    } else if (existing && typeof definition.url === "string") {
      baseEntry = { ...existing };
      for (const field of [
        "command",
        "args",
        "env",
        "cwd",
        "pluginDataDir",
        "literalEnv",
        "socket"
      ]) {
        delete baseEntry[field];
      }
    } else if (existing && typeof definition.socket === "string") {
      baseEntry = { ...existing };
      for (const field of [
        "command",
        "args",
        "env",
        "cwd",
        "pluginDataDir",
        "literalEnv",
        "url",
        "headers",
        "requestHeadersCommand",
        "auth",
        "bearerToken",
        "bearerTokenEnv",
        "oauth",
        "httpTransport"
      ]) {
        delete baseEntry[field];
      }
    }
    if (existing && typeof definition.url === "string" && definition.url !== existing.url) {
      if (baseEntry === existing) baseEntry = { ...existing };
      for (const field of URL_BOUND_AUTH_FIELDS) {
        delete baseEntry[field];
      }
      if (baseEntry.oauth !== false) {
        delete baseEntry.oauth;
      }
    }
    merged[name] = { ...baseEntry, ...definition };
  }
  return merged;
}

// src/config/read.ts
import { existsSync, readFileSync } from "node:fs";
import stripJsonComments from "strip-json-comments";
function parseJsonConfig(raw) {
  return JSON.parse(stripJsonComments(raw, { trailingCommas: true }));
}
function readValidatedConfig(path, label) {
  if (!existsSync(path)) return null;
  try {
    return validateConfig(parseJsonConfig(readFileSync(path, "utf-8")));
  } catch (error) {
    console.warn(`Failed to load ${label}:`, error);
    return null;
  }
}
function validateConfig(raw) {
  if (!isRecord(raw)) {
    return { mcpServers: {} };
  }
  return {
    mcpServers: toServerEntries(raw.mcpServers ?? raw["mcp-servers"]),
    ...raw.settings !== void 0 ? { settings: raw.settings } : {}
  };
}
function toServerEntries(servers) {
  if (!isRecord(servers)) return {};
  const entries = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (isServerEntry(entry)) entries[name] = entry;
  }
  return entries;
}
function isServerEntry(value) {
  return isRecord(value);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export {
  mergeConfigs,
  parseJsonConfig,
  readValidatedConfig
};
