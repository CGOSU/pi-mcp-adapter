// Config file parsing and imported-host adapters.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import stripJsonComments from "strip-json-comments";
import { toStringRecord } from "../utils.js";
import { IMPORT_PATHS } from "./paths.js";
export function resolveImportCandidates(importKind, cwd) {
    return (IMPORT_PATHS[importKind] ?? []).map((candidate) => {
        if (importKind === "opencode" && candidate === "./opencode.json") {
            const start = resolve(cwd);
            let gitRoot;
            let current = start;
            while (true) {
                if (existsSync(join(current, ".git"))) {
                    gitRoot = current;
                    break;
                }
                const parent = dirname(current);
                if (parent === current)
                    break;
                current = parent;
            }
            if (!gitRoot)
                return join(start, "opencode.json");
            current = start;
            while (true) {
                const projectConfig = join(current, "opencode.json");
                if (existsSync(projectConfig) || current === gitRoot)
                    return projectConfig;
                current = dirname(current);
            }
        }
        return candidate.startsWith(".") ? resolve(cwd, candidate) : candidate;
    });
}
export function parseJsonConfig(raw) {
    return JSON.parse(stripJsonComments(raw, { trailingCommas: true }));
}
export function readImportedConfig(path) {
    const raw = readFileSync(path, "utf-8");
    return path.endsWith(".toml") ? parseToml(raw) : parseJsonConfig(raw);
}
export function loadImportedConfig(importKind, cwd, warningPrefix) {
    if (importKind === "opencode") {
        let merged = {};
        let highestPrecedencePath;
        for (const path of resolveImportCandidates(importKind, cwd)) {
            if (!existsSync(path))
                continue;
            try {
                const value = readImportedConfig(path);
                if (value && typeof value === "object" && !Array.isArray(value)) {
                    merged = mergeOpenCodeConfigs(merged, value);
                    highestPrecedencePath = path;
                }
            }
            catch (error) {
                console.warn(warningPrefix, error);
            }
        }
        return highestPrecedencePath ? { path: highestPrecedencePath, value: merged } : null;
    }
    for (const path of resolveImportCandidates(importKind, cwd)) {
        if (!existsSync(path))
            continue;
        try {
            return { path, value: readImportedConfig(path) };
        }
        catch (error) {
            console.warn(warningPrefix, error);
        }
    }
    return null;
}
export function resolveImportPath(importKind, cwd = process.cwd()) {
    return loadImportedConfig(importKind, cwd, `Failed to discover imported MCP config from ${importKind}:`)?.path ?? null;
}
export function readValidatedConfig(path, label) {
    if (!existsSync(path))
        return null;
    try {
        return validateConfig(parseJsonConfig(readFileSync(path, "utf-8")));
    }
    catch (error) {
        console.warn(`Failed to load ${label}:`, error);
        return null;
    }
}
export function validateConfig(raw) {
    if (!isRecord(raw)) {
        return { mcpServers: {} };
    }
    return {
        mcpServers: toServerEntries(raw.mcpServers ?? raw["mcp-servers"]),
        ...(Array.isArray(raw.imports) ? { imports: raw.imports } : {}),
        ...(raw.settings !== undefined ? { settings: raw.settings } : {}),
    };
}
function toServerEntries(servers) {
    if (!isRecord(servers))
        return {};
    const entries = {};
    for (const [name, entry] of Object.entries(servers)) {
        if (isServerEntry(entry))
            entries[name] = entry;
    }
    return entries;
}
function isServerEntry(value) {
    return isRecord(value);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function mergeOpenCodeConfigs(base, next) {
    const baseMcp = base.mcp;
    const nextMcp = next.mcp;
    const mergedMcp = {
        ...(baseMcp && typeof baseMcp === "object" && !Array.isArray(baseMcp) ? baseMcp : {}),
    };
    if (nextMcp && typeof nextMcp === "object" && !Array.isArray(nextMcp)) {
        for (const [name, nextEntry] of Object.entries(nextMcp)) {
            const baseEntry = mergedMcp[name];
            if (baseEntry && typeof baseEntry === "object" && !Array.isArray(baseEntry)
                && nextEntry && typeof nextEntry === "object" && !Array.isArray(nextEntry)) {
                const safeBase = { ...baseEntry };
                const override = nextEntry;
                if (typeof override.type === "string" && override.type !== safeBase.type) {
                    for (const field of ["command", "environment", "cwd", "url", "headers", "oauth"])
                        delete safeBase[field];
                }
                if (typeof override.url === "string" && override.url !== safeBase.url) {
                    delete safeBase.headers;
                    delete safeBase.oauth;
                }
                if (Array.isArray(override.command)) {
                    const baseCommand = safeBase.command;
                    const commandChanged = !Array.isArray(baseCommand)
                        || override.command.length !== baseCommand.length
                        || override.command.some((value, index) => value !== baseCommand[index]);
                    if (commandChanged) {
                        delete safeBase.environment;
                        delete safeBase.cwd;
                    }
                }
                const mergedEntry = { ...safeBase, ...override };
                for (const field of ["environment", "headers", "oauth"]) {
                    const baseField = safeBase[field];
                    const nextField = override[field];
                    if (baseField && typeof baseField === "object" && !Array.isArray(baseField)
                        && nextField && typeof nextField === "object" && !Array.isArray(nextField)) {
                        mergedEntry[field] = { ...baseField, ...nextField };
                    }
                }
                mergedMcp[name] = mergedEntry;
            }
            else {
                mergedMcp[name] = nextEntry;
            }
        }
    }
    return { ...base, ...next, mcp: mergedMcp };
}
export function extractServers(config, kind) {
    if (!config || typeof config !== "object")
        return {};
    const obj = config;
    let servers;
    switch (kind) {
        case "claude-desktop":
        case "claude-code":
            servers = obj.mcpServers;
            break;
        case "codex":
            servers = obj.mcp_servers ?? obj.mcpServers;
            break;
        case "cursor":
        case "windsurf":
        case "vscode":
            servers = obj.mcpServers ?? obj["mcp-servers"];
            break;
        case "opencode":
            servers = obj.mcp;
            break;
        default:
            return {};
    }
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
        return {};
    }
    const mappedServers = {};
    for (const [name, entry] of Object.entries(servers)) {
        if (kind === "opencode") {
            if (!entry || typeof entry !== "object" || Array.isArray(entry))
                continue;
            const raw = entry;
            if (raw.enabled === false)
                continue;
            if (raw.type === "local" && Array.isArray(raw.command) && raw.command.length > 0 && raw.command.every((value) => typeof value === "string")) {
                const env = toStringRecord(raw.environment);
                const command = raw.command[0];
                if (command === undefined)
                    continue;
                const mapped = {
                    command,
                    args: raw.command.slice(1),
                    ...(env ? { env } : {}),
                    ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
                };
                mappedServers[name] = mapped;
                continue;
            }
            if (raw.type === "remote" && typeof raw.url === "string") {
                const headers = toStringRecord(raw.headers);
                const mapped = {
                    url: raw.url,
                    ...(headers ? { headers } : {}),
                };
                if (raw.oauth === false) {
                    mapped.oauth = false;
                }
                else if (raw.oauth && typeof raw.oauth === "object" && !Array.isArray(raw.oauth)) {
                    const oauth = raw.oauth;
                    mapped.auth = "oauth";
                    mapped.oauth = {
                        ...(typeof oauth.clientId === "string" ? { clientId: oauth.clientId } : {}),
                        ...(typeof oauth.clientSecret === "string" ? { clientSecret: oauth.clientSecret } : {}),
                        ...(typeof oauth.scope === "string" ? { scope: oauth.scope } : {}),
                        ...(typeof oauth.skipIssuerMetadataValidation === "boolean"
                            ? { skipIssuerMetadataValidation: oauth.skipIssuerMetadataValidation }
                            : {}),
                    };
                }
                mappedServers[name] = mapped;
            }
            continue;
        }
        if (!isRecord(entry))
            continue;
        if (kind !== "codex") {
            mappedServers[name] = entry;
            continue;
        }
        const mapped = { ...entry };
        const bearerTokenEnv = mapped.bearer_token_env_var;
        const httpHeaders = mapped.http_headers;
        const envHttpHeaders = mapped.env_http_headers;
        if (typeof bearerTokenEnv === "string") {
            mapped.bearerTokenEnv = bearerTokenEnv;
            if (mapped.auth === undefined)
                mapped.auth = "bearer";
        }
        if (httpHeaders && typeof httpHeaders === "object" && !Array.isArray(httpHeaders)) {
            mapped.headers = { ...mapped.headers, ...httpHeaders };
        }
        if (envHttpHeaders && typeof envHttpHeaders === "object" && !Array.isArray(envHttpHeaders)) {
            const headers = { ...mapped.headers };
            for (const [header, envVar] of Object.entries(envHttpHeaders)) {
                if (typeof envVar === "string" && headers[header] === undefined)
                    headers[header] = `$env:${envVar}`;
            }
            mapped.headers = headers;
        }
        delete mapped.bearer_token_env_var;
        delete mapped.http_headers;
        delete mapped.env_http_headers;
        mappedServers[name] = mapped;
    }
    return mappedServers;
}
//# sourceMappingURL=read.js.map