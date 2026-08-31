// Configuration precedence and credential-safe merging.
import type { McpConfig, ServerEntry } from "../contracts/core.js";

export function mergeConfigs(base: McpConfig, next: McpConfig): McpConfig {
  const settings = next.settings ? { ...base.settings, ...next.settings } : base.settings;
  return {
    mcpServers: mergeServerMaps(base.mcpServers, next.mcpServers),
    ...(settings !== undefined ? { settings } : {}),
  };
}

// Credential-bearing fields whose value is bound to a specific server `url`.
// When a higher-precedence config source repoints an existing server at a
// different url, these MUST NOT be inherited from the lower-precedence entry —
// otherwise the original endpoint's credentials would be shipped to the new
// url. See the SECURITY note in mergeServerMaps.
const URL_BOUND_AUTH_FIELDS = ["headers", "bearerToken", "bearerTokenEnv", "bearerTokenStore", "requestHeadersCommand"] as const;

function mergeServerMaps(
  base: Record<string, ServerEntry>,
  next: Record<string, ServerEntry>,
): Record<string, ServerEntry> {
  const merged = { ...base };
  for (const [name, definition] of Object.entries(next)) {
    const existing = merged[name];
    // SECURITY (credential/url binding): the merge is per-field, so a
    // higher-precedence source that supplies only a new `url` for an existing
    // server would otherwise retain the lower-precedence entry's auth material
    // (Authorization header, bearer token, OAuth config) and send it to the new
    // url — a credential-exfiltration vector when the higher-precedence source
    // is less trusted than the one that first defined the server. Bind auth to
    // the url that supplied it: when the url changes, drop inherited auth
    // material before merging. Auth explicitly re-supplied by `definition` still
    // applies (it is spread last). Behaviour is unchanged when the url is
    // identical or the override omits `url` (partial overrides still inherit).
    let baseEntry: ServerEntry = existing ?? {};
    if (existing && typeof definition.command === "string") {
      baseEntry = { ...existing };
      for (const field of [
        "url", "headers", "requestHeadersCommand", "auth", "bearerToken",
        "bearerTokenEnv", "oauth", "httpTransport", "socket",
      ] as const) {
        delete baseEntry[field];
      }
    } else if (existing && typeof definition.url === "string") {
      baseEntry = { ...existing };
      for (const field of [
        "command", "args", "env", "cwd", "pluginDataDir", "literalEnv", "socket",
      ] as const) {
        delete baseEntry[field];
      }
    } else if (existing && typeof definition.socket === "string") {
      baseEntry = { ...existing };
      for (const field of [
        "command", "args", "env", "cwd", "pluginDataDir", "literalEnv", "url",
        "headers", "requestHeadersCommand", "auth", "bearerToken", "bearerTokenEnv",
        "oauth", "httpTransport",
      ] as const) {
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
