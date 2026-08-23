import { getToolNameCandidates, resolveToolPrefix } from "./tool-names.js";
import { isServerDisabled } from "../contracts/core.js";
function globToRegExp(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`);
}
export function createToolSelectorCandidateIndex(allCurrentCandidates, additionalCurrentCandidatesByToolName) {
    return {
        allCurrentCandidates,
        matchingCountByPattern: new Map(),
        matcherByPattern: new Map(),
        ...(additionalCurrentCandidatesByToolName ? { additionalCurrentCandidatesByToolName } : {}),
    };
}
export function createLiveToolSelectorCandidateIndex(configuredServers, knownMetadata, prefix, includeMissingConfiguredCandidates = false) {
    const candidates = new Set();
    const additionalCandidatesByToolName = new Map();
    const evaluatedToolNames = new Set();
    const knownServerNames = new Set();
    const addCandidates = (target, originalName, serverName, serverPrefix) => {
        for (const candidate of getToolNameCandidates(originalName, serverName, serverPrefix, false))
            target.add(candidate);
    };
    for (const [serverName, metadata] of knownMetadata) {
        const definition = configuredServers[serverName];
        if (!definition || isServerDisabled(definition))
            continue;
        knownServerNames.add(serverName);
        const effectivePrefix = resolveToolPrefix(definition, prefix);
        for (const tool of metadata) {
            if (!tool?.originalName || (tool.uiVisibility !== undefined && !tool.uiVisibility.includes("model")))
                continue;
            evaluatedToolNames.add(tool.originalName);
            candidates.add(tool.name);
            addCandidates(candidates, tool.originalName, serverName, effectivePrefix);
        }
    }
    if (includeMissingConfiguredCandidates) {
        for (const [serverName, definition] of Object.entries(configuredServers)) {
            if (knownServerNames.has(serverName) || isServerDisabled(definition))
                continue;
            const effectivePrefix = resolveToolPrefix(definition, prefix);
            for (const toolName of evaluatedToolNames) {
                let additionalCandidates = additionalCandidatesByToolName.get(toolName);
                if (!additionalCandidates) {
                    additionalCandidates = new Set();
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
export function matchesToolPattern(candidates, patterns) {
    if (!Array.isArray(patterns) || patterns.length === 0)
        return false;
    for (const pattern of patterns) {
        if (typeof pattern !== "string")
            continue;
        if (!pattern.includes("*") && !pattern.includes("?") && candidates.has(pattern)) {
            return true;
        }
        if ((pattern.includes("*") || pattern.includes("?")) && [...candidates].some(candidate => globToRegExp(pattern).test(candidate))) {
            return true;
        }
    }
    return false;
}
function indexHasOtherCurrentMatch(index, toolName, currentCandidates, pattern) {
    const additionalCandidates = index.additionalCurrentCandidatesByToolName?.get(toolName);
    const hasCandidate = (candidate) => index.allCurrentCandidates.has(candidate) || additionalCandidates?.has(candidate) === true;
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
            if (matcher.test(candidate))
                matchingCount++;
        }
        index.matchingCountByPattern.set(pattern, matchingCount);
    }
    let totalMatchingCount = matchingCount;
    if (additionalCandidates) {
        for (const candidate of additionalCandidates) {
            if (!index.allCurrentCandidates.has(candidate) && matcher.test(candidate))
                totalMatchingCount++;
        }
    }
    if (totalMatchingCount === 0)
        return false;
    let currentMatchingCount = 0;
    for (const candidate of currentCandidates) {
        if (hasCandidate(candidate) && matcher.test(candidate))
            currentMatchingCount++;
    }
    return totalMatchingCount > currentMatchingCount;
}
function matchesToolSelector(toolName, serverName, prefix, patterns, otherCurrentCandidates) {
    if (!Array.isArray(patterns) || patterns.length === 0)
        return false;
    const currentCandidates = getToolNameCandidates(toolName, serverName, prefix, false);
    if (matchesToolPattern(currentCandidates, patterns))
        return true;
    if (!otherCurrentCandidates)
        return matchesToolPattern(getToolNameCandidates(toolName, serverName, prefix), patterns);
    const legacyCandidates = getToolNameCandidates(toolName, serverName, prefix);
    for (const candidate of currentCandidates)
        legacyCandidates.delete(candidate);
    return patterns.some(pattern => {
        if (typeof pattern !== "string" || !matchesToolPattern(legacyCandidates, [pattern]))
            return false;
        const hasCollision = otherCurrentCandidates instanceof Set
            ? matchesToolPattern(otherCurrentCandidates, [pattern])
            : indexHasOtherCurrentMatch(otherCurrentCandidates, toolName, currentCandidates, pattern);
        return !hasCollision;
    });
}
export function isToolIncluded(toolName, serverName, prefix, includeTools, otherCurrentCandidates) {
    if (!Array.isArray(includeTools) || includeTools.length === 0)
        return true;
    return matchesToolSelector(toolName, serverName, prefix, includeTools, otherCurrentCandidates);
}
export function isToolExcluded(toolName, serverName, prefix, excludeTools, otherCurrentCandidates) {
    return matchesToolSelector(toolName, serverName, prefix, excludeTools, otherCurrentCandidates);
}
export function isToolAllowed(toolName, serverName, prefix, includeTools, excludeTools, otherCurrentCandidates) {
    return isToolIncluded(toolName, serverName, prefix, includeTools, otherCurrentCandidates)
        && !isToolExcluded(toolName, serverName, prefix, excludeTools, otherCurrentCandidates);
}
//# sourceMappingURL=tool-selectors.js.map