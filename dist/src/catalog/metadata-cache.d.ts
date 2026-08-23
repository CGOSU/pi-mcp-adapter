import type { CachedPrompt, CachedResource, CachedTool, McpConfig, McpTool, McpResource, McpPrompt, MetadataCache, ServerCacheEntry, ServerEntry, ToolMetadata, PromptMetadata } from "../contracts/core.ts";
import { type ToolSelectorCandidateIndex } from "./tool-selectors.ts";
import type { ToolPrefix } from "../contracts/core.ts";
export type { CachedPrompt, CachedResource, CachedTool, MetadataCache, ServerCacheEntry } from "../contracts/core.ts";
export interface MetadataCatalogSnapshot {
    readonly cache: MetadataCache | null;
    readonly validEntries: ReadonlyMap<string, ServerCacheEntry>;
    readonly configHashes: ReadonlyMap<string, string>;
    readonly capturedAt: number;
}
export declare function createMetadataCatalogSnapshot(config: McpConfig, cache?: MetadataCache | null, environment?: NodeJS.ProcessEnv, maxAgeMs?: number): MetadataCatalogSnapshot;
export declare function getMetadataCachePath(): string;
export declare function loadMetadataCache(): MetadataCache | null;
export declare function saveMetadataCache(cache: MetadataCache): void;
export declare function computeServerHash(definition: ServerEntry, environment?: NodeJS.ProcessEnv): string;
export declare function isServerCacheValid(entry: ServerCacheEntry, definition: ServerEntry, maxAgeMs?: number, environment?: NodeJS.ProcessEnv): boolean;
export declare function parseDirectToolSelectors(selectors: string[]): {
    servers: Set<string>;
    tools: Map<string, Set<string>>;
};
export declare function getMissingConfiguredDirectToolServers(config: McpConfig, cache: MetadataCache | null, envOverride?: string[], snapshot?: MetadataCatalogSnapshot): string[];
export declare function reconstructToolMetadata(serverName: string, entry: ServerCacheEntry, prefix: ToolPrefix, definition: Pick<ServerEntry, "exposeResources" | "includeTools" | "excludeTools" | "toolPrefix">, configuredServers?: Record<string, ServerEntry>, cache?: MetadataCache, sharedSelectorCandidateIndex?: ToolSelectorCandidateIndex, snapshot?: MetadataCatalogSnapshot): ToolMetadata[];
export declare function createCachedToolSelectorCandidateIndex(configuredServers: Record<string, ServerEntry>, cache: MetadataCache, prefix: ToolPrefix, snapshot?: MetadataCatalogSnapshot): ToolSelectorCandidateIndex;
export declare function serializeTools(tools: McpTool[]): CachedTool[];
export declare function serializeResources(resources: McpResource[]): CachedResource[];
export declare function serializePrompts(prompts: McpPrompt[]): CachedPrompt[];
export declare function reconstructPromptMetadata(serverName: string, prompts: ReadonlyArray<McpPrompt | CachedPrompt>, prefix: ToolPrefix, definition?: Pick<ServerEntry, "toolPrefix">): PromptMetadata[];
