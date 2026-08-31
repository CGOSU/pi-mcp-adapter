import { describe, expect, it } from "vitest";
import { resolveDirectTools } from "../../../src/tools/direct-tool-catalog.ts";
import { computeServerHash, type MetadataCache } from "../../../src/catalog/metadata-cache.ts";
import { buildToolMetadata } from "../../../src/tools/tool-metadata.ts";
import { createLiveToolSelectorCandidateIndex, type McpConfig, type ToolMetadata } from "../../../types.ts";

function cacheEntry(definition: McpConfig["mcpServers"][string], tools: Array<{ name: string }>) {
  return {
    configHash: computeServerHash(definition),
    cachedAt: Date.now(),
    tools,
    resources: [],
  };
}

describe("shared tool selector candidate indexes", () => {
  it("keeps direct-tool filtering stable across multiple filtered servers", () => {
    const mcpServers = {
      first: { command: "first", directTools: true, includeTools: ["*"] },
      second: { command: "second", directTools: true, includeTools: ["*"] },
    };
    const config: McpConfig = {
      settings: { warnOnLargeDirectTools: false },
      mcpServers,
    };
    const cache: MetadataCache = {
      version: 1,
      servers: {
        first: cacheEntry(mcpServers.first, [{ name: "search" }, { name: "read" }]),
        second: cacheEntry(mcpServers.second, [{ name: "search" }, { name: "read" }]),
      },
    };

    expect(resolveDirectTools(config, cache, "server").map((tool) => tool.prefixedName)).toEqual([
      "first_search",
      "first_read",
      "second_search",
      "second_read",
    ]);
  });

  it("shares live candidates while preserving known-server collision rules", () => {
    const configuredServers = {
      "my-server": { command: "current", excludeTools: ["my_2d_server_*"] },
      my_2d_server: { command: "known" },
      missing: { command: "missing" },
    };
    const knownMetadata = new Map<string, ToolMetadata[]>([
      ["my-server", [{ name: "my-server_search-records", originalName: "search-records", description: "Current" }]],
      ["my_2d_server", [{ name: "my_2d_server_search_records", originalName: "search_records", description: "Known" }]],
    ]);
    const selectorIndex = createLiveToolSelectorCandidateIndex(configuredServers, knownMetadata, "server", true);

    const result = buildToolMetadata(
      [{ name: "search-records", description: "Current" }],
      [],
      configuredServers["my-server"],
      "my-server",
      "server",
      configuredServers,
      knownMetadata,
      true,
      selectorIndex,
    );

    expect(result.metadata.map((tool) => tool.name)).toEqual(["my-server_search-records"]);
    expect(selectorIndex.matchingCountByPattern.has("my_2d_server_*")).toBe(true);
  });

  it("excludes model-hidden live candidates from collisions", () => {
    const configuredServers = {
      "hidden-server": { command: "current", excludeTools: ["hidden_2d_server_do_thing"] },
      hidden_2d_server: { command: "hidden" },
    };
    const knownMetadata = new Map<string, ToolMetadata[]>([
      ["hidden-server", [{ name: "hidden-server_do_thing", originalName: "do_thing", description: "Current" }]],
      ["hidden_2d_server", [{ name: "hidden_2d_server_do_thing", originalName: "do_thing", description: "App only", uiVisibility: ["app"] }]],
    ]);
    const selectorIndex = createLiveToolSelectorCandidateIndex(configuredServers, knownMetadata, "server", true);

    const result = buildToolMetadata(
      [{ name: "do_thing", description: "Current" }],
      [],
      configuredServers["hidden-server"],
      "hidden-server",
      "server",
      configuredServers,
      knownMetadata,
      true,
      selectorIndex,
    );

    expect(result.metadata).toEqual([]);
  });

  it("does not synthesize candidates for disabled live servers", () => {
    const configuredServers = {
      "my-2d-server": { command: "current", excludeTools: ["my_2d_server_do_thing"] },
      my_2d_server: { command: "disabled", disabled: true },
    };
    const knownMetadata = new Map<string, ToolMetadata[]>([
      ["my-2d-server", [{ name: "my-2d-server_do_thing", originalName: "do_thing", description: "Current" }]],
    ]);
    const selectorIndex = createLiveToolSelectorCandidateIndex(configuredServers, knownMetadata, "server", true);

    const result = buildToolMetadata(
      [{ name: "do_thing", description: "Current" }],
      [],
      configuredServers["my-2d-server"],
      "my-2d-server",
      "server",
      configuredServers,
      knownMetadata,
      true,
      selectorIndex,
    );

    expect(result.metadata).toEqual([]);
  });
});
