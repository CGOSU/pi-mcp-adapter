// Configuration precedence and credential-safe merging.
import { loadImportedConfig, extractServers } from "./read.js";
export function mergeConfigs(base, next) {
    const imports = mergeImports(base.imports, next.imports);
    const settings = next.settings ? { ...base.settings, ...next.settings } : base.settings;
    return {
        mcpServers: mergeServerMaps(base.mcpServers, next.mcpServers),
        ...(imports !== undefined ? { imports } : {}),
        ...(settings !== undefined ? { settings } : {}),
    };
}
// Credential-bearing fields whose value is bound to a specific server `url`.
// When a higher-precedence config source repoints an existing server at a
// different url, these MUST NOT be inherited from the lower-precedence entry —
// otherwise the original endpoint's credentials would be shipped to the new
// url. See the SECURITY note in mergeServerMaps.
const URL_BOUND_AUTH_FIELDS = ["headers", "bearerToken", "bearerTokenEnv", "bearerTokenStore", "requestHeadersCommand"];
function mergeServerMaps(base, next) {
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
        let baseEntry = existing ?? {};
        if (existing && typeof definition.command === "string") {
            baseEntry = { ...existing };
            for (const field of [
                "url", "headers", "requestHeadersCommand", "auth", "bearerToken",
                "bearerTokenEnv", "oauth", "httpTransport", "socket",
            ]) {
                delete baseEntry[field];
            }
        }
        else if (existing && typeof definition.url === "string") {
            baseEntry = { ...existing };
            for (const field of [
                "command", "args", "env", "cwd", "pluginDataDir", "literalEnv", "socket",
            ]) {
                delete baseEntry[field];
            }
        }
        else if (existing && typeof definition.socket === "string") {
            baseEntry = { ...existing };
            for (const field of [
                "command", "args", "env", "cwd", "pluginDataDir", "literalEnv", "url",
                "headers", "requestHeadersCommand", "auth", "bearerToken", "bearerTokenEnv",
                "oauth", "httpTransport",
            ]) {
                delete baseEntry[field];
            }
        }
        if (existing && typeof definition.url === "string" && definition.url !== existing.url) {
            if (baseEntry === existing)
                baseEntry = { ...existing };
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
function mergeImports(left, right) {
    const merged = [...(left ?? []), ...(right ?? [])];
    if (merged.length === 0)
        return undefined;
    return [...new Set(merged)];
}
export function expandImports(config, cwd = process.cwd()) {
    if (!config.imports?.length)
        return config;
    const importedServers = {};
    for (const importKind of config.imports) {
        const imported = loadImportedConfig(importKind, cwd, `Failed to import MCP config from ${importKind}:`);
        if (!imported)
            continue;
        const servers = extractServers(imported.value, importKind);
        for (const [name, definition] of Object.entries(servers)) {
            if (!importedServers[name]) {
                importedServers[name] = definition;
            }
        }
    }
    return {
        imports: config.imports,
        ...(config.settings !== undefined ? { settings: config.settings } : {}),
        mcpServers: mergeServerMaps(importedServers, config.mcpServers),
    };
}
//# sourceMappingURL=merge.js.map