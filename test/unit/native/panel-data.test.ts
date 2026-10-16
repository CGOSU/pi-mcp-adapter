import { describe, expect, it } from "vitest";
import type { McpManagementServerSnapshot, McpManagementSnapshot } from "@earendil-works/pi-coding-agent";
import type { NativePanelConfiguration } from "../../../src/native/config-assembly.ts";
import { createNativeMcpPanelData } from "../../../src/native/panel-data.ts";
import { createNativeStatusSnapshot } from "../../../src/native/status.ts";

function makeServer(
  name: string,
  overrides: Partial<McpManagementServerSnapshot> & { catalog?: Record<string, unknown> } = {},
): McpManagementServerSnapshot {
  const { catalog: catalogOverrides, ...serverOverrides } = overrides;
  const catalog = {
    freshness: "live",
    tools: [{ name: "search", description: "Search", exposure: "direct" }],
    resources: {
      available: true,
      freshness: "live",
      items: [{ id: `${name}-resource`, name: "manual", title: "Manual", kind: "resource" }],
      templates: [],
    },
    prompts: { available: false, freshness: "missing", items: [] },
    ...catalogOverrides,
  };
  return {
    name,
    enabled: true,
    scope: "project",
    exposure: "codemode",
    connectionStatus: "connected",
    ...serverOverrides,
    catalog,
  } as unknown as McpManagementServerSnapshot;
}

function makeConfiguration(): NativePanelConfiguration {
  const server = (scope: "project" | "global" = "project") => ({
    includeTools: [],
    excludeTools: [],
    exposeResources: true,
    scope,
  });
  return {
    directTools: false,
    servers: new Map([
      ["docs", { ...server(), directTools: ["other"] }],
      ["cached", server("global")],
      ["failed", server()],
      ["missing", server()],
      ["untrusted-only", server()],
    ]),
  };
}

function makeSnapshot(): McpManagementSnapshot {
  const docs = makeServer("docs", {
    directTools: ["search", "secret"],
    catalog: {
      tools: [
        { name: "search", description: "Search", exposure: "direct" },
        { name: "secret", description: "Hidden", exposure: "hidden" },
        { name: "app-only", exposure: "direct", uiVisibility: ["app"] },
      ],
    },
  });
  const cached = makeServer("cached", {
    connectionStatus: "disconnected",
    catalog: {
      freshness: "cached",
      resources: {
        available: true,
        freshness: "cached",
        items: [{ id: "cached-resource", name: "manual", kind: "resource" }],
        templates: [],
      },
    },
  });
  const failed = makeServer("failed", {
    connectionStatus: "failed",
    catalog: { freshness: "cached" },
  });
  const missing = makeServer("missing", {
    connectionStatus: "disconnected",
    catalog: {
      freshness: "missing",
      tools: [],
      resources: { available: false, freshness: "missing", items: [], templates: [] },
    },
  });
  return { protocolVersion: 1, servers: [docs, cached, failed, missing] } as McpManagementSnapshot;
}

describe("native MCP panel data projection", () => {
  it("projects only native-session servers and keeps saved selectors, exposure, and catalog freshness distinct", () => {
    const snapshot = makeSnapshot();
    const configuration = makeConfiguration();
    const data = createNativeMcpPanelData(snapshot, configuration);

    expect(Object.keys(data.config.mcpServers)).toEqual(["docs", "cached", "failed", "missing"]);
    expect(data.config.mcpServers.docs?.directTools).toEqual(["search", "secret"]);
    expect(data.config.settings?.directTools).toBe(false);
    expect(data.cache?.servers.docs?.tools?.map((tool) => tool.name)).toEqual(["search", "secret", "app-only"]);
    expect(data.details.get("docs")).toMatchObject({
      scope: "project",
      catalogFreshness: "live",
      resourceFreshness: "live",
      resources: [{ name: "manual", title: "Manual", kind: "resource" }],
    });
    expect(data.details.get("docs")?.toolExposures.get("secret")).toBe("hidden");
    expect(data.visibleToolCountByServer.get("docs")).toBe(1);
    expect(data.visibleResourceCountByServer.get("docs")).toBe(1);
    expect(data.cache?.servers.missing).toBeUndefined();
  });

  it("preserves cached, disconnected, failed, and missing states in the public v1 status projection", () => {
    const status = createNativeStatusSnapshot(makeSnapshot(), makeConfiguration());
    const byName = new Map(status.servers.map((server) => [server.name, server]));

    expect(byName.get("docs")).toMatchObject({ status: "connected", toolCount: 1, resourceCount: 1 });
    expect(byName.get("cached")).toMatchObject({ status: "cached", toolCount: 1, resourceCount: 1 });
    expect(byName.get("failed")).toMatchObject({ status: "failed", toolCount: 0 });
    expect(byName.get("missing")).toMatchObject({ status: "not-connected", toolCount: 0 });
    expect(byName.get("missing")).not.toHaveProperty("resourceCount");
    expect(byName.has("untrusted-only")).toBe(false);
    expect(status).toMatchObject({ version: 1, connectedCount: 1, totalTools: 2, totalResources: 2 });
  });
});
