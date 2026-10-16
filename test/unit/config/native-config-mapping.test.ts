import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { validateMcpConfig } from "../../../src/config/validation.ts";
import {
  MCP_SETTINGS_FIELD_MAPPING,
  SERVER_ENTRY_FIELD_MAPPING,
  mapLoadedConfigSourcesToNative,
} from "../../../src/native/config-mapping.ts";

const roots: string[] = [];
const originalHome = process.env.HOME;
const originalCwd = process.cwd();

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  process.chdir(originalCwd);
  vi.resetModules();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("native MCP config normalization", () => {
  it("keeps the winning project provenance and clears credentials on a URL override", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-config-"));
    roots.push(root);
    const home = join(root, "home");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    vi.stubEnv("HOME", home);
    process.chdir(project);

    await writeJson(join(home, ".config", "mcp", "mcp.json"), {
      mcpServers: {
        docs: {
          url: "https://trusted.example/mcp",
          headers: { Authorization: "Bearer source-secret" },
          bearerTokenEnv: "DOCS_TOKEN",
          oauth: { clientId: "source-client", clientSecret: "source-secret" },
        },
      },
    });
    await writeJson(join(project, ".mcp.json"), {
      settings: { agentPluginPaths: ["./plugins"] },
      mcpServers: { docs: { url: "https://project.example/mcp", disabled: true, lifecycle: "lazy" } },
    });

    vi.resetModules();
    const { loadConfigSources } = await import("../../../src/config/load.ts");
    const loaded = loadConfigSources(undefined, project);
    const mapped = mapLoadedConfigSourcesToNative(loaded);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error("Expected a valid native config mapping");
    expect(mapped.value.nativeEntrySwitchAllowed).toBe(true);
    expect(mapped.value.entrySwitchBlockers).toEqual([]);
    expect(mapped.value.deferredSources).toEqual([]);

    const server = mapped.value.servers.find(({ name }) => name === "docs");
    expect(server).toMatchObject({
      connectable: true,
      config: {
        url: "https://project.example/mcp",
        lifecycle: "lazy",
        enabled: false,
      },
      provenance: {
        sourceId: "shared-project",
        scope: "project",
        sourcePath: join(project, ".mcp.json"),
        writePath: join(project, ".mcp.json"),
      },
    });
    expect(server?.config).not.toHaveProperty("headers");
    expect(server?.config).not.toHaveProperty("oauth");
    expect(server?.config).not.toHaveProperty("bearerTokenEnv");
    expect(JSON.stringify(server)).not.toContain("source-secret");
    expect(JSON.stringify(server)).not.toContain("DOCS_TOKEN");
    expect(server?.provenance).not.toHaveProperty("trusted");
    expect(mapped.value.settings.deferredFields).not.toContain("agentPluginPaths");
    expect(mapped.value.settings.provenance.agentPluginPaths).toMatchObject({ scope: "project", sourceId: "shared-project" });
  });

  it("retains exclusive-mode source precedence and its Pi-owned write target", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-exclusive-"));
    roots.push(root);
    const home = join(root, "home");
    const project = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(project, { recursive: true });
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("PI_MCP_CONFIG_MODE", "exclusive");
    process.chdir(project);

    await writeJson(join(home, ".config", "mcp", "mcp.json"), {
      mcpServers: { ignoredShared: { command: "shared" } },
    });
    await writeJson(join(project, ".mcp.json"), {
      mcpServers: { ignoredProject: { command: "project" } },
    });
    await writeJson(join(agentDir, "mcp.json"), {
      mcpServers: { selected: { command: "native", disabled: false } },
    });

    vi.resetModules();
    const { loadConfigSources } = await import("../../../src/config/load.ts");
    const mapped = mapLoadedConfigSourcesToNative(loadConfigSources(undefined, project));
    expect(mapped).toMatchObject({
      ok: true,
      value: {
        servers: [{
          name: "selected",
          config: { command: "native", enabled: true },
          provenance: { sourceId: "pi-global", scope: "global", writePath: join(agentDir, "mcp.json") },
        }],
      },
    });
  });

  it("preserves configured directTools while letting MCP_DIRECT_TOOLS override session policy", () => {
    vi.stubEnv("MCP_DIRECT_TOOLS", "docs/search");
    const source = {
      id: "pi-global",
      label: "isolated test config",
      readPath: "/tmp/isolated-mcp.json",
      writePath: "/tmp/isolated-mcp.json",
      kind: "user",
      shared: false,
      scope: "global",
    } as const;
    const mapped = mapLoadedConfigSourcesToNative([{
      source,
      config: { mcpServers: { docs: { command: "docs-server", directTools: false } } },
    }]);

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error("Expected direct-tool configuration to map");
    expect(mapped.value.servers[0]).toMatchObject({
      config: { command: "docs-server", directTools: false },
      executionPolicy: { directTools: ["search"] },
    });
  });

  it("rejects malformed persisted directTools selections at config validation", () => {
    const invalidSelections: unknown[] = [
      [""],
      ["x".repeat(257)],
      Array.from({ length: 257 }, (_, index) => `tool-${index}`),
      [`bad${String.fromCharCode(0x7f)}name`],
      new Array<string>(1),
    ];

    for (const directTools of invalidSelections) {
      const result = validateMcpConfig({ mcpServers: { docs: { command: "docs-server", directTools } } });
      expect(result).toMatchObject({ ok: true, value: { mcpServers: {} } });
      if (!result.ok) throw new Error("Expected partial config validation to preserve its result shape");
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: "invalid-server-field",
        path: "mcpServers.<entry>.directTools",
      }));
    }
    expect(validateMcpConfig({ mcpServers: { docs: { command: "docs-server", directTools: [] } } }).ok).toBe(true);
  });

  it("maps explicit SSE transport selection to the native transport", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-deferred-transport-"));
    roots.push(root);
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    vi.stubEnv("HOME", join(root, "home"));
    await writeJson(join(project, ".mcp.json"), {
      mcpServers: { remote: { url: "https://example.test/mcp", httpTransport: "sse" } },
    });

    vi.resetModules();
    const { loadConfigSources } = await import("../../../src/config/load.ts");
    const mapped = mapLoadedConfigSourcesToNative(loadConfigSources(undefined, project));
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error("Expected a validated deferred mapping");
    expect(mapped.value.servers[0]).toMatchObject({
      name: "remote",
      connectable: true,
      config: { url: "https://example.test/mcp", httpTransport: "sse" },
      deferredFields: [],
      blockingIssues: [],
    });
  });

  it("keeps unsupported per-server observability fields visible and disconnected", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-observability-"));
    roots.push(root);
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    vi.stubEnv("HOME", join(root, "home"));
    await writeJson(join(project, ".mcp.json"), {
      mcpServers: {
        debugServer: { command: "debug-server", debug: true },
        traceServer: { url: "https://trace.example/mcp", trace: true },
      },
    });

    vi.resetModules();
    const { loadConfigSources } = await import("../../../src/config/load.ts");
    const mapped = mapLoadedConfigSourcesToNative(loadConfigSources(undefined, project));
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error("Expected unsupported observability to remain explicit");
    expect(mapped.value.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "debugServer", connectable: false, config: {}, deferredFields: ["debug"] }),
      expect.objectContaining({ name: "traceServer", connectable: false, config: {}, deferredFields: ["trace"] }),
    ]));
  });

  it("maps stdio, socket, dynamic auth, OAuth parameters, and effective request timeouts", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-transport-map-"));
    roots.push(root);
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    vi.stubEnv("HOME", join(root, "home"));
    await writeJson(join(project, ".mcp.json"), {
      settings: { requestTimeoutMs: 2_400 },
      mcpServers: {
        stdio: {
          command: "node",
          args: ["${PLUGIN_ARG}"],
          env: { literal: "${DO_NOT_EXPAND}" },
          literalEnv: true,
          pluginDataDir: "~/plugin-data",
          requestTimeoutMs: 1_250,
        },
        socket: { socket: "./run/mcp.sock" },
        signed: {
          url: "https://signed.example/mcp",
          httpTransport: "sse",
          requestHeadersCommand: { command: "sign", args: ["--target", "${SIGNING_TARGET}"], timeoutMs: 750 },
          auth: "bearer",
          bearerToken: "!read-token",
          bearerTokenEnv: "SIGNED_TOKEN",
          bearerTokenStore: true,
        },
        oauth: {
          url: "https://oauth.example/mcp",
          requestTimeoutMs: 1_500,
          oauth: {
            grantType: "authorization_code",
            clientId: "configured-client",
            clientSecret: "!read-secret",
            scope: "read write",
            authorizationParams: { audience: "${OAUTH_AUDIENCE}" },
            redirectUri: "http://127.0.0.1:7777/oauth/callback",
            clientName: "Adapter client",
            clientUri: "https://adapter.example",
            logoUri: "https://adapter.example/logo.png",
            skipIssuerMetadataValidation: true,
          },
        },
        modern: { url: "https://modern.example/mcp", protocolVersion: "auto" },
      },
    });

    vi.resetModules();
    const { loadConfigSources } = await import("../../../src/config/load.ts");
    const mapped = mapLoadedConfigSourcesToNative(loadConfigSources(undefined, project));
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error("Expected supported transport fields to map");

    const server = (name: string) => mapped.value.servers.find((entry) => entry.name === name);
    expect(server("stdio")).toMatchObject({
      connectable: true,
      config: {
        command: "node",
        args: ["${PLUGIN_ARG}"],
        env: { literal: "${DO_NOT_EXPAND}" },
        literalEnv: true,
        pluginDataDir: "~/plugin-data",
        requestTimeoutMs: 1_250,
      },
    });
    expect(server("socket")).toMatchObject({ connectable: true, config: { socket: "./run/mcp.sock" } });
    expect(server("signed")).toMatchObject({
      connectable: true,
      config: {
        url: "https://signed.example/mcp",
        httpTransport: "sse",
        requestHeadersCommand: { command: "sign", args: ["--target", "${SIGNING_TARGET}"], timeoutMs: 750 },
        auth: "bearer",
        bearerToken: "!read-token",
        bearerTokenEnv: "SIGNED_TOKEN",
        bearerTokenStore: true,
        requestTimeoutMs: 2_400,
      },
    });
    expect(server("oauth")).toMatchObject({
      connectable: true,
      config: {
        url: "https://oauth.example/mcp",
        requestTimeoutMs: 1_500,
        oauth: {
          grantType: "authorization_code",
          clientId: "configured-client",
          clientSecret: "!read-secret",
          scope: "read write",
          authorizationParams: { audience: "${OAUTH_AUDIENCE}" },
          callbackUrl: "http://127.0.0.1:7777/oauth/callback",
          clientName: "Adapter client",
          clientUri: "https://adapter.example",
          logoUri: "https://adapter.example/logo.png",
          skipIssuerMetadataValidation: true,
        },
      },
    });
    expect(server("modern")).toMatchObject({
      connectable: false,
      config: {},
      blockingIssues: [{ code: "unsupported-protocol-version", field: "protocolVersion" }],
    });
  });

  it("routes project .agents and .pi sources with ordered provenance and project scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-project-agents-"));
    roots.push(root);
    const home = join(root, "home");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    vi.stubEnv("HOME", home);
    await writeJson(join(project, ".mcp.json"), {
      mcpServers: { shared: { command: "shared-project" }, sharedOnly: { command: "shared-only" } },
    });
    await writeJson(join(project, ".agents", "mcp.json"), {
      mcpServers: { shared: { command: "agents-flat" }, flatOnly: { command: "flat" } },
    });
    await writeJson(join(project, ".agents", "mcp", "mcp.json"), {
      mcpServers: { shared: { command: "agents-nested" }, nestedOnly: { command: "nested" } },
    });
    await writeJson(join(project, ".pi", "mcp.json"), {
      mcpServers: { shared: { command: "project-pi" }, piOnly: { command: "pi" } },
    });

    vi.resetModules();
    const { loadConfigSources } = await import("../../../src/config/load.ts");
    const loaded = loadConfigSources(undefined, project);
    const mapped = mapLoadedConfigSourcesToNative(loaded);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error("Expected project source provenance to map");
    expect(loaded.map(({ source }) => source.id)).toEqual([
      "shared-global", "agents-global", "agents-nested-global", "pi-global",
      "shared-project", "agents-project", "agents-nested-project", "pi-project",
    ]);
    expect(mapped.value.servers.find(({ name }) => name === "shared")).toMatchObject({
      config: { command: "project-pi" },
      provenance: {
        sourceId: "pi-project",
        scope: "project",
        sourcePath: join(project, ".pi", "mcp.json"),
        writePath: join(project, ".pi", "mcp.json"),
      },
    });
    expect(mapped.value.servers.find(({ name }) => name === "flatOnly")?.provenance).toMatchObject({
      sourceId: "agents-project", scope: "project", writePath: join(project, ".agents", "mcp.json"),
    });
    expect(mapped.value.servers.find(({ name }) => name === "nestedOnly")?.provenance).toMatchObject({
      sourceId: "agents-nested-project", scope: "project", writePath: join(project, ".agents", "mcp", "mcp.json"),
    });
  });

  it("blocks native mapping when a source contains invalid server fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-invalid-source-"));
    roots.push(root);
    const home = join(root, "home");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    vi.stubEnv("HOME", home);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeJson(join(project, ".mcp.json"), {
      mcpServers: { invalid: { command: 42 } },
    });

    vi.resetModules();
    const { loadConfigSources } = await import("../../../src/config/load.ts");
    const mapped = mapLoadedConfigSourcesToNative(loadConfigSources(undefined, project));
    expect(mapped).toMatchObject({
      ok: false,
      error: { code: "invalid-source", sourceId: "shared-project" },
    });
  });

  it("reports specific schema codes and paths without including invalid values", () => {
    const result = validateMcpConfig({
      mcpServers: {
        invalid: { url: "file:///private/secret", args: [1], unexpectedCredential: "do-not-print" },
      },
      settings: { requestTimeoutMs: "slow", outputGuard: { maxBytes: 0 } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected malformed configuration to fail");
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-server-field", path: "mcpServers.<entry>.url" }),
      expect.objectContaining({ code: "invalid-server-field", path: "mcpServers.<entry>.args" }),
      expect.objectContaining({ code: "unknown-server-field", path: "mcpServers.<entry>.unexpectedCredential" }),
      expect.objectContaining({ code: "invalid-setting", path: "settings.requestTimeoutMs" }),
      expect.objectContaining({ code: "invalid-nested-field", path: "settings.outputGuard.maxBytes" }),
    ]));
    expect(JSON.stringify(result)).not.toContain("private/secret");
    expect(JSON.stringify(result)).not.toContain("do-not-print");
  });

  it("rejects request timeouts outside the native timer range", () => {
    const result = validateMcpConfig({
      mcpServers: { remote: { url: "https://example.test/mcp", requestTimeoutMs: 2_147_483_648 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected invalid server entries to remain partial-load diagnostics");
    expect(result.value.mcpServers.remote).toBeUndefined();
    expect(result.issues ?? []).toContainEqual(expect.objectContaining({
      code: "invalid-server-field",
      path: "mcpServers.<entry>.requestTimeoutMs",
    }));
  });

  it("keeps every public config field assigned to an explicit owner", () => {
    expect(Object.keys(SERVER_ENTRY_FIELD_MAPPING)).toHaveLength(33);
    expect(Object.keys(MCP_SETTINGS_FIELD_MAPPING)).toHaveLength(25);
    expect(SERVER_ENTRY_FIELD_MAPPING.disabled.status).toBe("mapped");
    expect(SERVER_ENTRY_FIELD_MAPPING.enabled.owner).toBe("native-config");
    expect(SERVER_ENTRY_FIELD_MAPPING.exposure.owner).toBe("native-config");
    expect(SERVER_ENTRY_FIELD_MAPPING.toolExposure.owner).toBe("native-config");
    expect(SERVER_ENTRY_FIELD_MAPPING.oauth.owner).toBe("native-credentials");
    expect(MCP_SETTINGS_FIELD_MAPPING.mcpFooterStatus.owner).toBe("adapter-presentation");
    expect(MCP_SETTINGS_FIELD_MAPPING.scriptMode.status).toBe("deferred");
  });
});
