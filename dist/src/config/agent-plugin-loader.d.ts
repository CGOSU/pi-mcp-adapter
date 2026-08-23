import type { McpConfig } from "../contracts/core.ts";
export interface AgentPluginSummary {
    path: string;
    name?: string;
    serverCount: number;
}
export declare function loadAgentPluginConfigs(paths: unknown, cwd?: string): McpConfig;
export declare function getAgentPluginSummaries(paths: unknown, cwd?: string): AgentPluginSummary[];
