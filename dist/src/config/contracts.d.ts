import type { AgentPluginSummary } from "./agent-plugin-loader.ts";
import type { HostConfigDiscovery, ImportKind, ServerEntry } from "../contracts/core.js";
export interface KnownServerPreset {
    id: string;
    name: string;
    summary: string;
    entry: ServerEntry;
}
export declare const KNOWN_SERVER_PRESETS: readonly KnownServerPreset[];
export interface ConfigSourceSpec {
    id: "shared-global" | "agents-global" | "agents-nested-global" | "pi-global" | "shared-project" | "pi-project";
    label: string;
    readPath: string;
    writePath: string;
    kind: "user" | "project" | "import";
    importKind?: string;
    shared: boolean;
    scope: "global" | "project";
}
export interface ConfigDiscoveryPath {
    label: string;
    path: string;
    exists: boolean;
}
export interface DiscoveredImportConfig {
    kind: ImportKind;
    path: string;
}
export interface ConfigDiscoverySource extends ConfigDiscoveryPath {
    id: ConfigSourceSpec["id"];
    scope: ConfigSourceSpec["scope"];
    kind: "shared" | "pi";
    serverCount: number;
}
export interface ImportConfigSummary extends DiscoveredImportConfig {
    serverCount: number;
}
export interface HostConfigSummary extends ImportConfigSummary {
    active: boolean;
}
export interface McpConfigConflict {
    serverName: string;
    sources: Array<{
        kind: "shared" | "pi" | "host";
        path: string;
    }>;
    winner: {
        kind: "shared" | "pi" | "host";
        path: string;
    };
}
export interface RepoPromptDiscovery {
    configured: boolean;
    configuredPath?: string;
    executablePath?: string;
    targetPath?: string;
    serverName?: string;
    entry?: ServerEntry;
}
export interface McpDiscoverySummary {
    sources: ConfigDiscoverySource[];
    imports: ImportConfigSummary[];
    hostConfigs: HostConfigSummary[];
    hostConfigDiscovery: HostConfigDiscovery;
    agentPlugins: AgentPluginSummary[];
    conflicts: McpConfigConflict[];
    hasAnyConfig: boolean;
    hasAnyDetectedPaths: boolean;
    hasSharedServers: boolean;
    hasPiOwnedServers: boolean;
    totalServerCount: number;
    fingerprint: string;
    repoPrompt: RepoPromptDiscovery;
}
export interface McpStandardConfigSummary {
    sources: ConfigDiscoverySource[];
    hasSharedServers: boolean;
    fingerprint: string;
}
export interface ConfigWritePreview {
    path: string;
    existed: boolean;
    changed: boolean;
    beforeText: string;
    afterText: string;
    diffText: string;
}
