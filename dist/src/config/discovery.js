// Optional host discovery, diagnostics, and RepoPrompt suggestions.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentPluginSummaries } from "./agent-plugin-loader.js";
import { GENERIC_GLOBAL_CONFIG_PATH, IMPORT_PATHS, PROJECT_CONFIG_NAME, REPOPROMPT_BINARY_CANDIDATES, isExclusiveConfigMode } from "./paths.js";
import { getConfiguredHostConfigDiscoveryFromSources, getMergedSettingsFromSources, loadConfigSources } from "./load.js";
import { extractServers, loadImportedConfig, resolveImportPath } from "./read.js";
export function findAvailableImportConfigs(cwd = process.cwd()) {
    if (isExclusiveConfigMode())
        return [];
    const discovered = [];
    for (const importKind of Object.keys(IMPORT_PATHS)) {
        const importPath = resolveImportPath(importKind, cwd);
        if (importPath) {
            discovered.push({ kind: importKind, path: importPath });
        }
    }
    return discovered;
}
function getConfigSourceSummaries(loadedSources) {
    return loadedSources.map(({ source, config }) => ({
        id: source.id,
        label: source.label,
        path: source.readPath,
        exists: existsSync(source.readPath),
        scope: source.scope,
        kind: source.shared ? "shared" : "pi",
        serverCount: config ? Object.keys(config.mcpServers).length : 0,
    }));
}
export function getMcpStandardConfigSummary(overridePath, cwd = process.cwd()) {
    const sources = getConfigSourceSummaries(loadConfigSources(overridePath, cwd));
    return {
        sources,
        hasSharedServers: sources.some((source) => source.kind === "shared" && source.serverCount > 0),
        fingerprint: JSON.stringify({ sources: sources.map((source) => [source.id, source.exists, source.serverCount]) }),
    };
}
export function getMcpDiscoverySummary(overridePath, cwd = process.cwd(), options = {}) {
    const loadedSources = loadConfigSources(overridePath, cwd);
    const sources = getConfigSourceSummaries(loadedSources);
    const includeHostConfigs = options.includeHostConfigs !== false;
    const importedConfigs = new Map();
    const getImportedConfig = (kind, warningPrefix) => {
        if (!importedConfigs.has(kind))
            importedConfigs.set(kind, loadImportedConfig(kind, cwd, warningPrefix));
        return importedConfigs.get(kind) ?? null;
    };
    const importKinds = isExclusiveConfigMode()
        ? (loadedSources[0]?.config?.imports ?? [])
        : Object.keys(IMPORT_PATHS);
    const imports = includeHostConfigs
        ? importKinds
            .map((kind) => {
            const imported = getImportedConfig(kind, `Failed to inspect imported MCP config from ${kind}:`);
            if (!imported)
                return null;
            return {
                kind,
                path: imported.path,
                serverCount: Object.keys(extractServers(imported.value, kind)).length,
            };
        })
            .filter((value) => value !== null)
        : [];
    const hostConfigDiscovery = isExclusiveConfigMode()
        ? "off"
        : getConfiguredHostConfigDiscoveryFromSources(loadedSources);
    const hostConfigs = imports.map((entry) => ({ ...entry, active: hostConfigDiscovery === "on" }));
    const settings = getMergedSettingsFromSources(loadedSources);
    const agentPlugins = isExclusiveConfigMode()
        ? []
        : getAgentPluginSummaries(settings?.agentPluginPaths, cwd);
    const totalServerCount = sources.reduce((sum, source) => sum + source.serverCount, 0) + agentPlugins.reduce((sum, plugin) => sum + plugin.serverCount, 0);
    const hasSharedServers = sources.some((source) => source.kind === "shared" && source.serverCount > 0) || agentPlugins.some(plugin => plugin.serverCount > 0);
    const hasPiOwnedServers = sources.some((source) => source.kind === "pi" && source.serverCount > 0);
    const hasAnyDetectedPaths = sources.some((source) => source.exists) || imports.length > 0 || agentPlugins.length > 0;
    const hasAnyConfig = totalServerCount > 0 || imports.some((entry) => entry.serverCount > 0) || hasAnyDetectedPaths;
    const summaryWithoutRepoPrompt = {
        sources,
        imports,
        hostConfigs,
        hostConfigDiscovery,
        agentPlugins,
        conflicts: getConfigConflicts(loadedSources, imports, cwd, getImportedConfig),
        hasAnyConfig,
        hasAnyDetectedPaths,
        hasSharedServers,
        hasPiOwnedServers,
        totalServerCount,
    };
    const fingerprint = JSON.stringify({
        sources: sources.map((source) => [source.id, source.exists, source.serverCount]),
        imports: imports.map((entry) => [entry.kind, entry.path, entry.serverCount]),
        agentPlugins: agentPlugins.map((entry) => [entry.path, entry.name, entry.serverCount]),
        hostConfigDiscovery,
        conflicts: summaryWithoutRepoPrompt.conflicts,
    });
    return {
        ...summaryWithoutRepoPrompt,
        fingerprint,
        repoPrompt: detectRepoPrompt(summaryWithoutRepoPrompt, cwd, loadedSources),
    };
}
function getConfigConflicts(loadedSources, imports, cwd, getImportedConfig) {
    const seen = new Map();
    const record = (name, source) => {
        const entries = seen.get(name) ?? [];
        if (!entries.some((entry) => entry.kind === source.kind && entry.path === source.path))
            entries.push(source);
        seen.set(name, entries);
    };
    // Host candidates are listed first because, when enabled, they are the
    // lowest-precedence fallback. The fixed IMPORT_PATHS order is deterministic.
    for (const entry of imports) {
        const imported = getImportedConfig(entry.kind, `Failed to inspect imported MCP config from ${entry.kind}:`);
        if (!imported)
            continue;
        for (const name of Object.keys(extractServers(imported.value, entry.kind))) {
            record(name, { kind: "host", path: imported.path });
        }
    }
    for (const { source, config: loaded } of loadedSources) {
        if (!loaded)
            continue;
        if (loaded.imports?.length) {
            for (const importKind of loaded.imports) {
                const imported = getImportedConfig(importKind, `Failed to inspect imported MCP config from ${importKind}:`);
                if (!imported)
                    continue;
                for (const name of Object.keys(extractServers(imported.value, importKind))) {
                    record(name, { kind: "host", path: imported.path });
                }
            }
        }
        for (const name of Object.keys(loaded.mcpServers)) {
            record(name, {
                kind: source.shared ? "shared" : "pi",
                path: source.readPath,
            });
        }
    }
    return [...seen.entries()]
        .filter(([, sources]) => sources.length > 1)
        .map(([serverName, sources]) => ({ serverName, sources, winner: sources[sources.length - 1] }))
        .sort((left, right) => left.serverName.localeCompare(right.serverName));
}
function isRepoPromptServer(name, entry) {
    const normalizedName = name.toLowerCase();
    if (normalizedName.includes("repoprompt") || normalizedName === "rp") {
        return true;
    }
    const command = entry.command?.toLowerCase() ?? "";
    if (command.includes("repoprompt") || command.includes("rp-mcp") || command.endsWith("repoprompt_cli")) {
        return true;
    }
    return (entry.args ?? []).some((arg) => typeof arg === "string" && arg.toLowerCase().includes("repoprompt"));
}
function findProjectRoot(cwd = process.cwd()) {
    let current = resolve(cwd);
    while (true) {
        if (existsSync(join(current, ".git"))
            || existsSync(join(current, "package.json"))
            || existsSync(join(current, PROJECT_CONFIG_NAME))
            || existsSync(join(current, ".pi"))) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current)
            return null;
        current = parent;
    }
}
function buildRepoPromptEntry(executablePath) {
    return {
        command: executablePath,
        args: [],
        lifecycle: "lazy",
    };
}
function detectRepoPrompt(summary, cwd = process.cwd(), loadedSources = []) {
    for (const source of summary.sources) {
        if (source.kind !== "shared" || source.serverCount === 0)
            continue;
        const config = loadedSources.find(({ source: loadedSource }) => loadedSource.readPath === source.path)?.config;
        if (!config)
            continue;
        for (const [name, entry] of Object.entries(config.mcpServers)) {
            if (isRepoPromptServer(name, entry)) {
                return { configured: true, configuredPath: source.path };
            }
        }
    }
    const executablePath = REPOPROMPT_BINARY_CANDIDATES.find((candidate) => existsSync(candidate));
    if (!executablePath) {
        return { configured: false };
    }
    const projectRoot = findProjectRoot(cwd);
    const targetPath = projectRoot ? join(projectRoot, PROJECT_CONFIG_NAME) : GENERIC_GLOBAL_CONFIG_PATH;
    return {
        configured: false,
        executablePath,
        targetPath,
        serverName: "repoprompt",
        entry: buildRepoPromptEntry(executablePath),
    };
}
//# sourceMappingURL=discovery.js.map