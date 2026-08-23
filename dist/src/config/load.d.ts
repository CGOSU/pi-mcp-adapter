import type { ConfigSourceSpec } from "./contracts.js";
import type { HostConfigDiscovery, McpConfig, McpSettings } from "../contracts/core.js";
export interface LoadedConfigSource {
    source: ConfigSourceSpec;
    config: McpConfig | null;
}
export declare function loadConfigSources(overridePath?: string, cwd?: string): LoadedConfigSource[];
export declare function getMergedSettingsFromSources(sources: readonly LoadedConfigSource[]): McpSettings | undefined;
export declare function getConfiguredHostConfigDiscoveryFromSources(sources: readonly LoadedConfigSource[]): HostConfigDiscovery;
export declare function cloneMcpConfig(config: McpConfig): McpConfig;
export declare function loadMcpConfig(overridePath?: string, cwd?: string): McpConfig;
export declare function getMergedSettings(overridePath?: string, cwd?: string): McpSettings | undefined;
export declare function getConfiguredHostConfigDiscovery(overridePath?: string, cwd?: string): HostConfigDiscovery;
export declare function loadDiscoveredHostConfigs(cwd: string): McpConfig;
