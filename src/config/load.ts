// Startup configuration loading and source snapshots.
import { loadPackageMcpConfigs } from "./package-mcp-loader.ts";
import { loadAgentPluginConfigs } from "./agent-plugin-loader.ts";
import { getConfigSources, isExclusiveConfigMode } from "./paths.js";
import { mergeConfigs } from "./merge.js";
import { readValidatedConfig } from "./read.js";
import type { ConfigSourceSpec } from "./contracts.js";
import type { McpConfig, McpSettings } from "../contracts/core.js";

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

export function cloneMcpConfig(config: McpConfig): McpConfig {
  return structuredClone(config);
}

export function loadMcpConfig(overridePath?: string, cwd = process.cwd()): McpConfig {
  const loadedSources = loadConfigSources(overridePath, cwd);
  let config: McpConfig = { mcpServers: {} };

  for (const { config: loaded } of loadedSources) {
    if (!loaded) continue;
    config = mergeConfigs(config, loaded);
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
