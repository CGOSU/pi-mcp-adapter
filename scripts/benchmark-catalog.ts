import { performance } from "node:perf_hooks";
import { computeServerHash, type MetadataCache } from "../src/catalog/metadata-cache.ts";
import { resolveDirectTools } from "../direct-tool-catalog.ts";
import { buildToolMetadata } from "../tool-metadata.ts";
import { createLiveToolSelectorCandidateIndex } from "../src/catalog/tool-selectors.ts";
import type { McpConfig, ToolMetadata } from "../src/contracts/core.ts";

const DEFAULT_RUNS = 5;
const SIZES = [
  { servers: 5, tools: 100 },
  { servers: 20, tools: 100 },
  { servers: 50, tools: 100 },
] as const;

function parseRuns(argv: string[]): number {
  const index = argv.indexOf("--runs");
  if (index === -1) return DEFAULT_RUNS;
  const runs = Number(argv[index + 1]);
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error("--runs must be a positive integer");
  }
  return runs;
}

function createFixture(serverCount: number, toolCount: number): { config: McpConfig; cache: MetadataCache } {
  const config: McpConfig = {
    settings: {
      warnOnLargeDirectTools: false,
    },
    mcpServers: {},
  };
  const cache: MetadataCache = { version: 1, servers: {} };

  for (let serverIndex = 0; serverIndex < serverCount; serverIndex += 1) {
    const serverName = `server-${serverIndex}`;
    const definition = {
      command: serverName,
      directTools: true as const,
      includeTools: ["*"] as string[],
    };
    config.mcpServers[serverName] = definition;
    cache.servers[serverName] = {
      configHash: computeServerHash(definition),
      cachedAt: Date.now(),
      tools: Array.from({ length: toolCount }, (_, toolIndex) => ({
        name: `tool-${toolIndex}`,
        description: `Tool ${toolIndex}`,
      })),
      resources: [],
    };
  }

  return { config, cache };
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measureDirect(config: McpConfig, cache: MetadataCache, runs: number): number {
  resolveDirectTools(config, cache, "server");
  const samples: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    resolveDirectTools(config, cache, "server");
    samples.push(performance.now() - started);
  }
  return median(samples);
}

function createLiveMetadata(cache: MetadataCache): Map<string, ToolMetadata[]> {
  return new Map(Object.entries(cache.servers).map(([serverName, entry]) => [
    serverName,
    entry.tools.map((tool) => ({
      name: `${serverName}_${tool.name}`,
      originalName: tool.name,
      description: tool.description ?? "",
    })),
  ]));
}

function measureLive(
  config: McpConfig,
  cache: MetadataCache,
  runs: number,
  shareSelectorIndex: boolean,
): number {
  const knownMetadata = createLiveMetadata(cache);
  const build = () => {
    const selectorIndex = shareSelectorIndex
      ? createLiveToolSelectorCandidateIndex(config.mcpServers, knownMetadata, "server", true)
      : undefined;
    for (const [serverName, entry] of Object.entries(cache.servers)) {
      buildToolMetadata(
        entry.tools,
        [],
        config.mcpServers[serverName]!,
        serverName,
        "server",
        config.mcpServers,
        knownMetadata,
        true,
        selectorIndex,
      );
    }
  };

  build();
  const samples: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    build();
    samples.push(performance.now() - started);
  }
  return median(samples);
}

const runs = parseRuns(process.argv.slice(2));
console.log(`Catalog benchmark (${runs} measured run${runs === 1 ? "" : "s"}, includeTools=["*"])`);
for (const { servers, tools } of SIZES) {
  const { config, cache } = createFixture(servers, tools);
  const directMilliseconds = measureDirect(config, cache, runs);
  const livePerServerMilliseconds = measureLive(config, cache, runs, false);
  const liveSharedMilliseconds = measureLive(config, cache, runs, true);
  console.log(`  ${servers} servers × ${tools} tools:`);
  console.log(`    direct shared index: ${directMilliseconds.toFixed(2)}ms median`);
  console.log(`    live per-server index: ${livePerServerMilliseconds.toFixed(2)}ms median`);
  console.log(`    live shared index: ${liveSharedMilliseconds.toFixed(2)}ms median`);
}
