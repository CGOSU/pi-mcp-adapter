import type { McpConfig } from "../contracts/core.js";
export declare function mergeConfigs(base: McpConfig, next: McpConfig): McpConfig;
export declare function expandImports(config: McpConfig, cwd?: string): McpConfig;
