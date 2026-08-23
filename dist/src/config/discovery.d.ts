import type { DiscoveredImportConfig, McpDiscoverySummary, McpStandardConfigSummary } from "./contracts.js";
export declare function findAvailableImportConfigs(cwd?: string): DiscoveredImportConfig[];
export declare function getMcpStandardConfigSummary(overridePath?: string, cwd?: string): McpStandardConfigSummary;
export declare function getMcpDiscoverySummary(overridePath?: string, cwd?: string, options?: {
    includeHostConfigs?: boolean;
}): McpDiscoverySummary;
