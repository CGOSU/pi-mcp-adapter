// Startup configuration loading and source snapshots.
import { loadPackageMcpConfigs } from "./package-mcp-loader.ts";
import { loadAgentPluginConfigs } from "./agent-plugin-loader.ts";
import { IMPORT_PATHS, getConfigSources, isExclusiveConfigMode } from "./paths.js";
import { expandImports, mergeConfigs } from "./merge.js";
import { extractServers, loadImportedConfig, readValidatedConfig } from "./read.js";
import type { ConfigSourceSpec } from "./contracts.js";
import type { HostConfigDiscovery, ImportKind, McpConfig, McpSettings } from "../contracts/core.js";

export interface LoadedConfigSource {
  source: ConfigSourceSpec;
  config: McpConfig | null;
}

export function loadConfigSources(overridePath?: string, cwd = process.cwd()): LoadedConfigSource[] {
  return getConfigSources(overridePath, cwd).map((source) => ({
    source,
    config: readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`),
  }));
}

export function getMergedSettingsFromSources(sources: readonly LoadedConfigSource[]): McpSettings | undefined {
  let settings: McpSettings | undefined;
  for (const { config } of sources) {
    if (config?.settings) settings = { ...settings, ...config.settings };
  }
  return settings;
}

export function getConfiguredHostConfigDiscoveryFromSources(sources: readonly LoadedConfigSource[]): HostConfigDiscovery {
  const value = getMergedSettingsFromSources(sources)?.hostConfigDiscovery;
  return value === "off" || value === "prompt" || value === "on" ? value : "off";
}

export function cloneMcpConfig(config: McpConfig): McpConfig {
  return structuredClone(config);
}

export function loadMcpConfig(overridePath?: string, cwd = process.cwd()): McpConfig {
  const loadedSources = loadConfigSources(overridePath, cwd);
  const hostConfigDiscovery = getConfiguredHostConfigDiscoveryFromSources(loadedSources);
  // Host files are a lower-precedence fallback. This ordering means an opt-in
  // discovery cannot override a shared or Pi-owned definition, and all normal
  // URL-bound credential stripping remains in mergeServerMaps.
  let config: McpConfig = !isExclusiveConfigMode() && hostConfigDiscovery === "on"
    ? loadDiscoveredHostConfigs(cwd)
    : { mcpServers: {} };

  for (const { config: loaded } of loadedSources) {
    if (!loaded) continue;
    config = mergeConfigs(config, expandImports(loaded, cwd));
  }

  if (isExclusiveConfigMode()) return config;

  const packageConfig = loadPackageMcpConfigs(cwd);
  const pluginConfig = loadAgentPluginConfigs(config.settings?.agentPluginPaths, cwd);
  const packageServers = Object.fromEntries(
    Object.entries(packageConfig.mcpServers).filter(([name]) => !Object.hasOwn(pluginConfig.mcpServers, name)),
  );
  return mergeConfigs({ mcpServers: packageServers }, mergeConfigs(pluginConfig, config));
}

export function getMergedSettings(overridePath?: string, cwd = process.cwd()): McpSettings | undefined {
  return getMergedSettingsFromSources(loadConfigSources(overridePath, cwd));
}

export function getConfiguredHostConfigDiscovery(overridePath?: string, cwd = process.cwd()): HostConfigDiscovery {
  return getConfiguredHostConfigDiscoveryFromSources(loadConfigSources(overridePath, cwd));
}

export function loadDiscoveredHostConfigs(cwd: string): McpConfig {
  let config: McpConfig = { mcpServers: {} };
  for (const importKind of Object.keys(IMPORT_PATHS) as ImportKind[]) {
    const imported = loadImportedConfig(importKind, cwd, `Failed to discover imported MCP config from ${importKind}:`);
    if (!imported) continue;
    config = mergeConfigs(config, {
      mcpServers: extractServers(imported.value, importKind),
    });
  }
  return config;
}
