// Configuration source diagnostics and RepoPrompt suggestions.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentPluginSummaries } from "./agent-plugin-loader.ts";
import { GENERIC_GLOBAL_CONFIG_PATH, PROJECT_CONFIG_NAME, REPOPROMPT_BINARY_CANDIDATES, isExclusiveConfigMode } from "./paths.js";
import { getMergedSettingsFromSources, loadConfigSources, type LoadedConfigSource } from "./load.js";
import type { ConfigDiscoverySource, McpConfigConflict, McpDiscoverySummary, McpStandardConfigSummary, RepoPromptDiscovery } from "./contracts.js";
import type { ServerEntry } from "../contracts/core.js";

function getConfigSourceSummaries(loadedSources: readonly LoadedConfigSource[]): ConfigDiscoverySource[] {
  return loadedSources.map(({ source, config }) => ({
    id: source.id,
    label: source.label,
    path: source.readPath,
    exists: existsSync(source.readPath),
    scope: source.scope,
    kind: source.shared ? "shared" : "pi",
    serverCount: config ? Object.keys(config.mcpServers).length : 0,
  } satisfies ConfigDiscoverySource));
}

export function getMcpStandardConfigSummary(overridePath?: string, cwd = process.cwd()): McpStandardConfigSummary {
  const sources = getConfigSourceSummaries(loadConfigSources(overridePath, cwd));
  return {
    sources,
    hasSharedServers: sources.some((source) => source.kind === "shared" && source.serverCount > 0),
    fingerprint: JSON.stringify({ sources: sources.map((source) => [source.id, source.exists, source.serverCount]) }),
  };
}

export function getMcpDiscoverySummary(overridePath?: string, cwd = process.cwd()): McpDiscoverySummary {
  const loadedSources = loadConfigSources(overridePath, cwd);
  const sources = getConfigSourceSummaries(loadedSources);
  const settings = getMergedSettingsFromSources(loadedSources);
  const agentPlugins = isExclusiveConfigMode()
    ? []
    : getAgentPluginSummaries(settings?.agentPluginPaths, cwd);
  const conflicts = getConfigConflicts(loadedSources);
  const totalServerCount = sources.reduce((sum, source) => sum + source.serverCount, 0)
    + agentPlugins.reduce((sum, plugin) => sum + plugin.serverCount, 0);
  const hasSharedServers = sources.some((source) => source.kind === "shared" && source.serverCount > 0)
    || agentPlugins.some((plugin) => plugin.serverCount > 0);
  const hasPiOwnedServers = sources.some((source) => source.kind === "pi" && source.serverCount > 0);
  const hasAnyDetectedPaths = sources.some((source) => source.exists) || agentPlugins.length > 0;
  const hasAnyConfig = totalServerCount > 0 || hasAnyDetectedPaths;

  const summaryWithoutRepoPrompt = {
    sources,
    agentPlugins,
    conflicts,
    hasAnyConfig,
    hasAnyDetectedPaths,
    hasSharedServers,
    hasPiOwnedServers,
    totalServerCount,
  };

  return {
    ...summaryWithoutRepoPrompt,
    fingerprint: JSON.stringify({
      sources: sources.map((source) => [source.id, source.exists, source.serverCount]),
      agentPlugins: agentPlugins.map((entry) => [entry.path, entry.name, entry.serverCount]),
      conflicts,
    }),
    repoPrompt: detectRepoPrompt(summaryWithoutRepoPrompt, cwd, loadedSources),
  };
}

function getConfigConflicts(loadedSources: readonly LoadedConfigSource[]): McpConfigConflict[] {
  const seen = new Map<string, Array<{ kind: "shared" | "pi"; path: string }>>();
  const record = (name: string, source: { kind: "shared" | "pi"; path: string }): void => {
    const entries = seen.get(name) ?? [];
    if (!entries.some((entry) => entry.kind === source.kind && entry.path === source.path)) entries.push(source);
    seen.set(name, entries);
  };

  for (const { source, config } of loadedSources) {
    if (!config) continue;
    for (const name of Object.keys(config.mcpServers)) {
      record(name, {
        kind: source.shared ? "shared" : "pi",
        path: source.readPath,
      });
    }
  }

  return [...seen.entries()]
    .filter(([, sources]) => sources.length > 1)
    .map(([serverName, sources]) => ({ serverName, sources, winner: sources[sources.length - 1]! }))
    .sort((left, right) => left.serverName.localeCompare(right.serverName));
}

function isRepoPromptServer(name: string, entry: ServerEntry): boolean {
  const normalizedName = name.toLowerCase();
  if (normalizedName.includes("repoprompt") || normalizedName === "rp") {
    return true;
  }

  const command = entry.command?.toLowerCase() ?? "";
  if (command.includes("repoprompt") || command.includes("rp-mcp") || command.endsWith("repoprompt_cli")) {
    return true;
  }

  return (entry.args ?? []).some((arg) => typeof arg === "string" && arg.toLowerCase().includes("repoprompt"));
}

function findProjectRoot(cwd = process.cwd()): string | null {
  let current = resolve(cwd);
  while (true) {
    if (
      existsSync(join(current, ".git"))
      || existsSync(join(current, "package.json"))
      || existsSync(join(current, PROJECT_CONFIG_NAME))
      || existsSync(join(current, ".pi"))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function buildRepoPromptEntry(executablePath: string): ServerEntry {
  return {
    command: executablePath,
    args: [],
    lifecycle: "lazy",
  };
}

function detectRepoPrompt(
  summary: Omit<McpDiscoverySummary, "fingerprint" | "repoPrompt">,
  cwd = process.cwd(),
  loadedSources: readonly LoadedConfigSource[] = [],
): RepoPromptDiscovery {
  for (const source of summary.sources) {
    if (source.kind !== "shared" || source.serverCount === 0) continue;
    const config = loadedSources.find(({ source: loadedSource }) => loadedSource.readPath === source.path)?.config;
    if (!config) continue;
    for (const [name, entry] of Object.entries(config.mcpServers)) {
      if (isRepoPromptServer(name, entry)) {
        return { configured: true, configuredPath: source.path };
      }
    }
  }

  const executablePath = REPOPROMPT_BINARY_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    return { configured: false };
  }

  const projectRoot = findProjectRoot(cwd);
  const targetPath = projectRoot ? join(projectRoot, PROJECT_CONFIG_NAME) : GENERIC_GLOBAL_CONFIG_PATH;
  return {
    configured: false,
    executablePath,
    targetPath,
    serverName: "repoprompt",
    entry: buildRepoPromptEntry(executablePath),
  };
}
