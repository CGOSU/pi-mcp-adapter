// Tool selector matching and candidate indexes.
import type { ServerEntry, ToolPrefix } from "../contracts/core.js";
import type { UiToolVisibility } from "../ui/tool-visibility.js";
import { getToolNameCandidates, resolveToolPrefix } from "./tool-names.js";
import { isServerDisabled } from "../contracts/core.js";

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

export interface ToolSelectorCandidateIndex {
  readonly allCurrentCandidates: ReadonlySet<string>;
  readonly matchingCountByPattern: Map<string, number>;
  readonly matcherByPattern: Map<string, RegExp>;
  readonly additionalCurrentCandidatesByToolName?: ReadonlyMap<string, ReadonlySet<string>>;
}

export function createToolSelectorCandidateIndex(
  allCurrentCandidates: Set<string>,
  additionalCurrentCandidatesByToolName?: ReadonlyMap<string, ReadonlySet<string>>,
): ToolSelectorCandidateIndex {
  return {
    allCurrentCandidates,
    matchingCountByPattern: new Map<string, number>(),
    matcherByPattern: new Map<string, RegExp>(),
    ...(additionalCurrentCandidatesByToolName ? { additionalCurrentCandidatesByToolName } : {}),
  };
}

export interface ToolSelectorCandidateSource {
  readonly name: string;
  readonly originalName: string;
  readonly uiVisibility?: readonly UiToolVisibility[];
}

export function createLiveToolSelectorCandidateIndex(
  configuredServers: Record<string, ServerEntry>,
  knownMetadata: ReadonlyMap<string, readonly ToolSelectorCandidateSource[]>,
  prefix: ToolPrefix,
  includeMissingConfiguredCandidates = false,
): ToolSelectorCandidateIndex {
  const candidates = new Set<string>();
  const additionalCandidatesByToolName = new Map<string, Set<string>>();
  const evaluatedToolNames = new Set<string>();
  const knownServerNames = new Set<string>();
  const addCandidates = (
    target: Set<string>,
    originalName: string,
    serverName: string,
    serverPrefix: ToolPrefix,
  ) => {
    for (const candidate of getToolNameCandidates(originalName, serverName, serverPrefix, false)) target.add(candidate);
  };

  for (const [serverName, metadata] of knownMetadata) {
    const definition = configuredServers[serverName];
    if (!definition || isServerDisabled(definition)) continue;
    knownServerNames.add(serverName);
    const effectivePrefix = resolveToolPrefix(definition, prefix);
    for (const tool of metadata) {
      if (!tool?.originalName || (tool.uiVisibility !== undefined && !tool.uiVisibility.includes("model"))) continue;
      evaluatedToolNames.add(tool.originalName);
      candidates.add(tool.name);
      addCandidates(candidates, tool.originalName, serverName, effectivePrefix);
    }
  }

  if (includeMissingConfiguredCandidates) {
    for (const [serverName, definition] of Object.entries(configuredServers)) {
      if (knownServerNames.has(serverName) || isServerDisabled(definition)) continue;
      const effectivePrefix = resolveToolPrefix(definition, prefix);
      for (const toolName of evaluatedToolNames) {
        let additionalCandidates = additionalCandidatesByToolName.get(toolName);
        if (!additionalCandidates) {
          additionalCandidates = new Set<string>();
          additionalCandidatesByToolName.set(toolName, additionalCandidates);
        }
        addCandidates(additionalCandidates, toolName, serverName, effectivePrefix);
        for (const candidate of getToolNameCandidates(toolName, serverName, effectivePrefix, false)) {
          additionalCandidates.add(candidate.replace(/-/g, "_"));
        }
      }
    }
  }

  return createToolSelectorCandidateIndex(candidates, additionalCandidatesByToolName);
}

export function matchesToolPattern(candidates: Set<string>, patterns?: unknown): boolean {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;

  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    if (!pattern.includes("*") && !pattern.includes("?") && candidates.has(pattern)) {
      return true;
    }
    if ((pattern.includes("*") || pattern.includes("?")) && [...candidates].some(candidate => globToRegExp(pattern).test(candidate))) {
      return true;
    }
  }

  return false;
}

export type ToolSelectorCandidateContext = Set<string> | ToolSelectorCandidateIndex;

function indexHasOtherCurrentMatch(
  index: ToolSelectorCandidateIndex,
  toolName: string,
  currentCandidates: Set<string>,
  pattern: string,
): boolean {
  const additionalCandidates = index.additionalCurrentCandidatesByToolName?.get(toolName);
  const hasCandidate = (candidate: string): boolean =>
    index.allCurrentCandidates.has(candidate) || additionalCandidates?.has(candidate) === true;
  const isGlob = pattern.includes("*") || pattern.includes("?");
  if (!isGlob) {
    return hasCandidate(pattern) && !currentCandidates.has(pattern);
  }

  let matcher = index.matcherByPattern.get(pattern);
  if (!matcher) {
    matcher = globToRegExp(pattern);
    index.matcherByPattern.set(pattern, matcher);
  }
  let matchingCount = index.matchingCountByPattern.get(pattern);
  if (matchingCount === undefined) {
    matchingCount = 0;
    for (const candidate of index.allCurrentCandidates) {
      if (matcher.test(candidate)) matchingCount++;
    }
    index.matchingCountByPattern.set(pattern, matchingCount);
  }

  let totalMatchingCount = matchingCount;
  if (additionalCandidates) {
    for (const candidate of additionalCandidates) {
      if (!index.allCurrentCandidates.has(candidate) && matcher.test(candidate)) totalMatchingCount++;
    }
  }
  if (totalMatchingCount === 0) return false;

  let currentMatchingCount = 0;
  for (const candidate of currentCandidates) {
    if (hasCandidate(candidate) && matcher.test(candidate)) currentMatchingCount++;
  }
  return totalMatchingCount > currentMatchingCount;
}

function matchesToolSelector(
  toolName: string,
  serverName: string,
  prefix: ToolPrefix,
  patterns: unknown,
  otherCurrentCandidates?: ToolSelectorCandidateContext,
): boolean {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const currentCandidates = getToolNameCandidates(toolName, serverName, prefix, false);
  if (matchesToolPattern(currentCandidates, patterns)) return true;
  if (!otherCurrentCandidates) return matchesToolPattern(getToolNameCandidates(toolName, serverName, prefix), patterns);
  const legacyCandidates = getToolNameCandidates(toolName, serverName, prefix);
  for (const candidate of currentCandidates) legacyCandidates.delete(candidate);
  return patterns.some(pattern => {
    if (typeof pattern !== "string" || !matchesToolPattern(legacyCandidates, [pattern])) return false;
    const hasCollision = otherCurrentCandidates instanceof Set
      ? matchesToolPattern(otherCurrentCandidates, [pattern])
      : indexHasOtherCurrentMatch(otherCurrentCandidates, toolName, currentCandidates, pattern);
    return !hasCollision;
  });
}

export function isToolIncluded(
  toolName: string,
  serverName: string,
  prefix: ToolPrefix,
  includeTools?: unknown,
  otherCurrentCandidates?: ToolSelectorCandidateContext,
): boolean {
  if (!Array.isArray(includeTools) || includeTools.length === 0) return true;
  return matchesToolSelector(toolName, serverName, prefix, includeTools, otherCurrentCandidates);
}

export function isToolExcluded(
  toolName: string,
  serverName: string,
  prefix: ToolPrefix,
  excludeTools?: unknown,
  otherCurrentCandidates?: ToolSelectorCandidateContext,
): boolean {
  return matchesToolSelector(toolName, serverName, prefix, excludeTools, otherCurrentCandidates);
}

export function isToolAllowed(
  toolName: string,
  serverName: string,
  prefix: ToolPrefix,
  includeTools?: unknown,
  excludeTools?: unknown,
  otherCurrentCandidates?: ToolSelectorCandidateContext,
): boolean {
  return isToolIncluded(toolName, serverName, prefix, includeTools, otherCurrentCandidates)
    && !isToolExcluded(toolName, serverName, prefix, excludeTools, otherCurrentCandidates);
}
