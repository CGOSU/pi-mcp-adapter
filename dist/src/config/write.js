// Configuration persistence and write previews.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isServerDisabled } from "../contracts/core.js";
import { getConfigSources, getPiGlobalConfigPath, getProjectConfigPath, getProjectPiConfigPath, IMPORT_PATHS } from "./paths.js";
import { expandImports, mergeConfigs } from "./merge.js";
import { extractServers, loadImportedConfig, parseJsonConfig, readValidatedConfig } from "./read.js";
import { getConfiguredHostConfigDiscovery } from "./load.js";
function serializeRawConfig(raw) {
    return `${JSON.stringify(raw, null, 2)}\n`;
}
function buildUnifiedDiff(beforeText, afterText) {
    if (beforeText === afterText)
        return "(no changes)";
    const before = beforeText.split("\n");
    const after = afterText.split("\n");
    const rows = before.length;
    const cols = after.length;
    const lcs = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));
    for (let i = rows - 1; i >= 0; i--) {
        for (let j = cols - 1; j >= 0; j--) {
            const row = lcs[i];
            const nextRow = lcs[i + 1];
            if (!row || !nextRow)
                continue;
            row[j] = before[i] === after[j]
                ? (nextRow[j + 1] ?? 0) + 1
                : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
        }
    }
    const lines = ["--- before", "+++ after"];
    let i = 0;
    let j = 0;
    while (i < rows || j < cols) {
        if (i < rows && j < cols && before[i] === after[j]) {
            lines.push(`  ${before[i]}`);
            i++;
            j++;
            continue;
        }
        if (j < cols && (i === rows || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))) {
            lines.push(`+ ${after[j]}`);
            j++;
            continue;
        }
        if (i < rows) {
            lines.push(`- ${before[i]}`);
            i++;
        }
    }
    return lines.join("\n");
}
function buildConfigWritePreview(filePath, nextRaw) {
    const existed = existsSync(filePath);
    const beforeRaw = readRawConfigObject(filePath);
    const beforeText = existed ? serializeRawConfig(beforeRaw) : "";
    const afterText = serializeRawConfig(nextRaw);
    return {
        path: filePath,
        existed,
        changed: beforeText !== afterText,
        beforeText,
        afterText,
        diffText: buildUnifiedDiff(beforeText, afterText),
    };
}
function readRawConfigObject(filePath) {
    if (!existsSync(filePath))
        return {};
    try {
        const raw = parseJsonConfig(readFileSync(filePath, "utf-8"));
        return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    }
    catch {
        return {};
    }
}
function writeRawConfigObject(filePath, raw) {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
    renameSync(tmpPath, filePath);
}
function getServersObject(raw) {
    const existing = raw.mcpServers ?? raw["mcp-servers"] ?? {};
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
        return {};
    }
    return existing;
}
function setServersObject(raw, servers) {
    delete raw["mcp-servers"];
    raw.mcpServers = servers;
}
/**
 * Persist only the disabled field in the project Pi layer. Enabling writes an
 * explicit false only when a lower-precedence source is itself disabled; this
 * writer never copies a server definition or its credentials into the file.
 */
export function writeProjectServerDisabledOverride(overridePath, cwd, serverName, disabled) {
    const filePath = getProjectPiConfigPath(cwd);
    let raw = {};
    if (existsSync(filePath)) {
        try {
            const parsed = parseJsonConfig(readFileSync(filePath, "utf-8"));
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("root value must be an object");
            }
            raw = parsed;
        }
        catch (error) {
            throw new Error(`Failed to read project MCP override at ${filePath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
    }
    const serverKey = raw.mcpServers !== undefined ? "mcpServers" : raw["mcp-servers"] !== undefined ? "mcp-servers" : "mcpServers";
    const rawServers = raw[serverKey];
    if (rawServers !== undefined && (!rawServers || typeof rawServers !== "object" || Array.isArray(rawServers))) {
        throw new Error(`Failed to update project MCP override at ${filePath}: ${serverKey} must be an object`);
    }
    const servers = (rawServers ?? {});
    const previous = servers[serverName];
    if (previous !== undefined && (!previous || typeof previous !== "object" || Array.isArray(previous))) {
        throw new Error(`Failed to update project MCP override at ${filePath}: server "${serverName}" must be an object`);
    }
    const existing = previous;
    let next;
    if (disabled) {
        next = { ...existing, disabled: true };
    }
    else {
        next = Object.fromEntries(Object.entries(existing ?? {}).filter(([key]) => key !== "disabled"));
        let lowerConfig = { mcpServers: {} };
        for (const source of getConfigSources(overridePath, cwd)) {
            if (source.readPath === filePath)
                continue;
            const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
            if (loaded)
                lowerConfig = mergeConfigs(lowerConfig, expandImports(loaded, cwd));
        }
        if (raw.imports !== undefined) {
            if (!Array.isArray(raw.imports) || raw.imports.some((kind) => typeof kind !== "string" || !Object.hasOwn(IMPORT_PATHS, kind))) {
                throw new Error(`Failed to update project MCP override at ${filePath}: imports contains an unsupported config kind`);
            }
            lowerConfig = mergeConfigs(lowerConfig, expandImports({ mcpServers: {}, imports: raw.imports }, cwd));
        }
        if (isServerDisabled(lowerConfig.mcpServers[serverName]))
            next.disabled = false;
    }
    if ((!existing && Object.keys(next).length === 0) || JSON.stringify(existing) === JSON.stringify(next)) {
        return { path: filePath, changed: false };
    }
    if (Object.keys(next).length === 0)
        delete servers[serverName];
    else
        servers[serverName] = next;
    raw[serverKey] = servers;
    writeRawConfigObject(filePath, raw);
    return { path: filePath, changed: true };
}
export function previewCompatibilityImports(importKinds, overridePath) {
    const targetPath = getPiGlobalConfigPath(overridePath);
    const raw = readRawConfigObject(targetPath);
    const currentImports = Array.isArray(raw.imports) ? raw.imports.filter((value) => typeof value === "string") : [];
    const merged = [...new Set([...currentImports, ...importKinds])];
    const nextRaw = { ...raw, imports: merged };
    setServersObject(nextRaw, getServersObject(nextRaw));
    return buildConfigWritePreview(targetPath, nextRaw);
}
export function ensureCompatibilityImports(importKinds, overridePath) {
    const targetPath = getPiGlobalConfigPath(overridePath);
    const raw = readRawConfigObject(targetPath);
    const currentImports = Array.isArray(raw.imports) ? raw.imports.filter((value) => typeof value === "string") : [];
    const merged = [...new Set([...currentImports, ...importKinds])];
    const added = merged.filter((kind) => !currentImports.includes(kind));
    if (added.length === 0) {
        return { path: targetPath, added: [] };
    }
    raw.imports = merged;
    const servers = getServersObject(raw);
    setServersObject(raw, servers);
    writeRawConfigObject(targetPath, raw);
    return { path: targetPath, added };
}
export function buildStarterProjectConfig() {
    return {
        mcpServers: {},
    };
}
export function previewStarterProjectConfig(cwd = process.cwd()) {
    const targetPath = getProjectConfigPath(cwd);
    const nextRaw = { mcpServers: buildStarterProjectConfig().mcpServers };
    return buildConfigWritePreview(targetPath, nextRaw);
}
export function writeStarterProjectConfig(cwd = process.cwd()) {
    const targetPath = getProjectConfigPath(cwd);
    const raw = { mcpServers: buildStarterProjectConfig().mcpServers };
    writeRawConfigObject(targetPath, raw);
    return targetPath;
}
export function previewSharedServerEntry(filePath, serverName, entry) {
    const raw = readRawConfigObject(filePath);
    const nextRaw = { ...raw };
    const servers = getServersObject(nextRaw);
    servers[serverName] = entry;
    setServersObject(nextRaw, servers);
    return buildConfigWritePreview(filePath, nextRaw);
}
export function writeSharedServerEntry(filePath, serverName, entry) {
    const raw = readRawConfigObject(filePath);
    const servers = getServersObject(raw);
    servers[serverName] = entry;
    setServersObject(raw, servers);
    writeRawConfigObject(filePath, raw);
    return filePath;
}
export function getServerProvenance(overridePath, cwd = process.cwd()) {
    const provenance = new Map();
    const userPath = getPiGlobalConfigPath(overridePath);
    if (getConfiguredHostConfigDiscovery(overridePath, cwd) === "on") {
        for (const importKind of Object.keys(IMPORT_PATHS)) {
            const imported = loadImportedConfig(importKind, cwd, `Failed to inspect imported MCP config from ${importKind}:`);
            if (!imported)
                continue;
            for (const name of Object.keys(extractServers(imported.value, importKind))) {
                // Keep writes inside Pi-owned storage even though the source is external.
                // Later import kinds win in the same deterministic order as loadDiscoveredHostConfigs.
                provenance.set(name, { path: userPath, kind: "import", importKind });
            }
        }
    }
    for (const source of getConfigSources(overridePath, cwd)) {
        const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
        if (!loaded)
            continue;
        if (loaded.imports?.length) {
            for (const importKind of loaded.imports) {
                const imported = loadImportedConfig(importKind, cwd, `Failed to inspect imported MCP config from ${importKind}:`);
                if (!imported)
                    continue;
                const servers = extractServers(imported.value, importKind);
                for (const name of Object.keys(servers)) {
                    if (!provenance.has(name)) {
                        provenance.set(name, { path: userPath, kind: "import", importKind });
                    }
                }
            }
        }
        for (const name of Object.keys(loaded.mcpServers)) {
            provenance.set(name, {
                path: source.writePath,
                kind: source.kind,
                ...(source.importKind !== undefined ? { importKind: source.importKind } : {}),
            });
        }
    }
    return provenance;
}
export function writeDirectToolsConfig(changes, provenance, fullConfig) {
    const byPath = new Map();
    for (const [serverName, value] of changes) {
        const prov = provenance.get(serverName);
        if (!prov)
            continue;
        const targetPath = prov.path;
        if (!byPath.has(targetPath))
            byPath.set(targetPath, []);
        byPath.get(targetPath).push({ name: serverName, value, prov });
    }
    for (const [filePath, entries] of byPath) {
        const raw = readRawConfigObject(filePath);
        const servers = getServersObject(raw);
        for (const { name, value, prov } of entries) {
            if (prov.kind === "import") {
                const fullDef = fullConfig.mcpServers[name];
                if (fullDef) {
                    servers[name] = { ...fullDef, directTools: value };
                }
            }
            else if (servers[name]) {
                servers[name] = { ...servers[name], directTools: value };
            }
        }
        setServersObject(raw, servers);
        writeRawConfigObject(filePath, raw);
    }
}
//# sourceMappingURL=write.js.map