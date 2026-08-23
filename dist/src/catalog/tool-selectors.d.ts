import type { ServerEntry, ToolPrefix } from "../contracts/core.js";
import type { UiToolVisibility } from "../ui/tool-visibility.js";
export interface ToolSelectorCandidateIndex {
    readonly allCurrentCandidates: ReadonlySet<string>;
    readonly matchingCountByPattern: Map<string, number>;
    readonly matcherByPattern: Map<string, RegExp>;
    readonly additionalCurrentCandidatesByToolName?: ReadonlyMap<string, ReadonlySet<string>>;
}
export declare function createToolSelectorCandidateIndex(allCurrentCandidates: Set<string>, additionalCurrentCandidatesByToolName?: ReadonlyMap<string, ReadonlySet<string>>): ToolSelectorCandidateIndex;
export interface ToolSelectorCandidateSource {
    readonly name: string;
    readonly originalName: string;
    readonly uiVisibility?: readonly UiToolVisibility[];
}
export declare function createLiveToolSelectorCandidateIndex(configuredServers: Record<string, ServerEntry>, knownMetadata: ReadonlyMap<string, readonly ToolSelectorCandidateSource[]>, prefix: ToolPrefix, includeMissingConfiguredCandidates?: boolean): ToolSelectorCandidateIndex;
export declare function matchesToolPattern(candidates: Set<string>, patterns?: unknown): boolean;
export type ToolSelectorCandidateContext = Set<string> | ToolSelectorCandidateIndex;
export declare function isToolIncluded(toolName: string, serverName: string, prefix: ToolPrefix, includeTools?: unknown, otherCurrentCandidates?: ToolSelectorCandidateContext): boolean;
export declare function isToolExcluded(toolName: string, serverName: string, prefix: ToolPrefix, excludeTools?: unknown, otherCurrentCandidates?: ToolSelectorCandidateContext): boolean;
export declare function isToolAllowed(toolName: string, serverName: string, prefix: ToolPrefix, includeTools?: unknown, excludeTools?: unknown, otherCurrentCandidates?: ToolSelectorCandidateContext): boolean;
