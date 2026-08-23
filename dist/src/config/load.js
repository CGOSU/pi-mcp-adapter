// Startup configuration loading and source snapshots.
import { loadPackageMcpConfigs } from "./package-mcp-loader.js";
import { loadAgentPluginConfigs } from "./agent-plugin-loader.js";
import { IMPORT_PATHS, getConfigSources, isExclusiveConfigMode } from "./paths.js";
import { expandImports, mergeConfigs } from "./merge.js";
import { extractServers, loadImportedConfig, readValidatedConfig } from "./read.js";
export function loadConfigSources(overridePath, cwd = process.cwd()) {
    return getConfigSources(overridePath, cwd).map((source) => ({
        source,
        config: readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`),
    }));
}
export function getMergedSettingsFromSources(sources) {
    let settings;
    for (const { config } of sources) {
        if (config?.settings)
            settings = { ...settings, ...config.settings };
    }
    return settings;
}
export function getConfiguredHostConfigDiscoveryFromSources(sources) {
    const value = getMergedSettingsFromSources(sources)?.hostConfigDiscovery;
    return value === "off" || value === "prompt" || value === "on" ? value : "off";
}
export function cloneMcpConfig(config) {
    return structuredClone(config);
}
export function loadMcpConfig(overridePath, cwd = process.cwd()) {
    const loadedSources = loadConfigSources(overridePath, cwd);
    const hostConfigDiscovery = getConfiguredHostConfigDiscoveryFromSources(loadedSources);
    // Host files are a lower-precedence fallback. This ordering means an opt-in
    // discovery cannot override a shared or Pi-owned definition, and all normal
    // URL-bound credential stripping remains in mergeServerMaps.
    let config = !isExclusiveConfigMode() && hostConfigDiscovery === "on"
        ? loadDiscoveredHostConfigs(cwd)
        : { mcpServers: {} };
    for (const { config: loaded } of loadedSources) {
        if (!loaded)
            continue;
        config = mergeConfigs(config, expandImports(loaded, cwd));
    }
    if (isExclusiveConfigMode())
        return config;
    const packageConfig = loadPackageMcpConfigs(cwd);
    const pluginConfig = loadAgentPluginConfigs(config.settings?.agentPluginPaths, cwd);
    const packageServers = Object.fromEntries(Object.entries(packageConfig.mcpServers).filter(([name]) => !Object.hasOwn(pluginConfig.mcpServers, name)));
    return mergeConfigs({ mcpServers: packageServers }, mergeConfigs(pluginConfig, config));
}
export function getMergedSettings(overridePath, cwd = process.cwd()) {
    return getMergedSettingsFromSources(loadConfigSources(overridePath, cwd));
}
export function getConfiguredHostConfigDiscovery(overridePath, cwd = process.cwd()) {
    return getConfiguredHostConfigDiscoveryFromSources(loadConfigSources(overridePath, cwd));
}
export function loadDiscoveredHostConfigs(cwd) {
    let config = { mcpServers: {} };
    for (const importKind of Object.keys(IMPORT_PATHS)) {
        const imported = loadImportedConfig(importKind, cwd, `Failed to discover imported MCP config from ${importKind}:`);
        if (!imported)
            continue;
        config = mergeConfigs(config, {
            mcpServers: extractServers(imported.value, importKind),
        });
    }
    return config;
}
//# sourceMappingURL=load.js.map