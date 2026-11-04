import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedConfigSource } from "../../../src/config/load.ts";

const sourceFixture = vi.hoisted(() => ({ sources: [] as LoadedConfigSource[] }));
vi.mock("../../../src/native/config-assembly.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/native/config-assembly.ts")>();
  return { ...actual, loadNativeConfigSources: (options: { config?: unknown }, cwd: string) => options.config === undefined ? sourceFixture.sources : actual.loadNativeConfigSources(options, cwd) };
});
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  MCP_MANAGEMENT_PROTOCOL_ID: undefined,
  MCP_MANAGEMENT_PROTOCOL_VERSION: undefined,
  MCP_MANAGEMENT_DISCOVERY_EVENT: undefined,
  MCP_MANAGEMENT_AVAILABLE_EVENT: undefined,
  MCP_MANAGEMENT_RESPONSE_EVENT_PREFIX: undefined,
  MCP_MANAGEMENT_CAPABILITIES: undefined,
  installMcpOwnerAssembly: undefined,
}));
const { createMcpAdapter, registerMcpServer } = await import("../../../src/native/extension.ts");

function host() {
  const servers = new Map<string, { name: string; config: unknown }>();
  const handlers = new Map<string, (event: unknown, context: ExtensionContext) => void>();
  const commands = new Map<string, { handler: (args: string, context: ExtensionContext) => Promise<void> }>();
  const pi = {
    on: (event: string, handler: (event: unknown, context: ExtensionContext) => void) => handlers.set(event, handler),
    registerCommand: (name: string, command: { handler: (args: string, context: ExtensionContext) => Promise<void> }) => commands.set(name, command),
    registerMcpServer: (name: string, config: unknown) => servers.set(name, { name, config }),
    unregisterMcpServer: (name: string) => servers.delete(name),
    getMcpServers: () => [...servers.values()],
  } as unknown as ExtensionAPI;
  const notifications: string[] = [];
  const context = {
    cwd: process.cwd(), hasUI: true, isProjectTrusted: () => false,
    ui: { notify: (message: string) => notifications.push(message) },
  } as unknown as ExtensionContext;
  return { pi, servers, handlers, commands, context, notifications };
}

let agentDir: string;
beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "standard-mcp-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("PI_PACKAGE_DIR", "");
  sourceFixture.sources = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

describe("standard Pi extension compatibility", () => {
  it("keeps an actionable failure for hosts missing both management and standard registration APIs", () => {
    const h = host();
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.pi.unregisterMcpServer = undefined as unknown as ExtensionAPI["unregisterMcpServer"];
    createMcpAdapter({ config: { mcpServers: {} } })(h.pi);
    expect(() => registerMcpServer({ pi: h.pi, name: "demo", definition: { command: "demo" } })).toThrow(/standard registerMcpServer/);
    expect(h.servers.size).toBe(0);
  });

  it("registers factory configuration using the host owner and releases it on shutdown", () => {
    const h = host();
    const factory = createMcpAdapter({ config: { mcpServers: { demo: { command: "demo", args: ["--stdio"] } } } });
    factory(h.pi);
    factory(h.pi);
    h.handlers.get("session_start")!({}, h.context);
    expect(h.servers.get("demo")?.config).toMatchObject({ command: "demo", args: ["--stdio"] });
    h.handlers.get("session_start")!({}, h.context);
    expect([...h.servers.keys()]).toEqual(["demo"]);
    h.handlers.get("session_shutdown")!({}, h.context);
    expect(h.servers.size).toBe(0);
  });

  it("supports programmatic registration and idempotent disposal without management discovery", async () => {
    const h = host();
    createMcpAdapter({ config: { mcpServers: {} } })(h.pi);
    const registration = registerMcpServer({ pi: h.pi, name: "remote", definition: { url: "https://example.com/mcp", headers: { Authorization: "Bearer fixture" } } });
    expect(h.servers.get("remote")?.config).toMatchObject({ url: "https://example.com/mcp" });
    await registration.dispose();
    await registration.dispose();
    expect(h.servers.has("remote")).toBe(false);
  });

  it("imports Pi 1.5 server fields without blocking other valid servers", () => {
    const h = host();
    createMcpAdapter({ config: { mcpServers: {
      plain: { command: "plain" },
      typed: { type: "stdio", command: "typed", timeout: 1.5, description: "Fixture tools" },
    } } })(h.pi);
    h.handlers.get("session_start")!({}, h.context);
    expect([...h.servers.keys()]).toEqual(["plain", "typed"]);
    expect(h.servers.get("typed")?.config).toEqual({
      command: "typed", enabled: true, exposure: "codemode", timeout: 1.5, description: "Fixture tools",
    });
  });

  it.each(["http", "streamable-http"] as const)("normalizes %s and native timeout fields for programmatic registration", async (type) => {
    const h = host();
    createMcpAdapter({ config: { mcpServers: {} } })(h.pi);
    const registration = registerMcpServer({ pi: h.pi, name: "remote", definition: {
      type, url: "https://example.invalid/mcp", timeout: 2, requestTimeoutMs: 2000, description: "Remote fixture",
    } });
    expect(h.servers.get("remote")?.config).toEqual({
      url: "https://example.invalid/mcp", enabled: true, exposure: "codemode", timeout: 2, description: "Remote fixture",
    });
    await registration.dispose();
  });

  it("does not replace another extension's registration", () => {
    const h = host();
    h.pi.registerMcpServer("demo", { command: "other" });
    createMcpAdapter({ config: { mcpServers: { demo: { command: "ours" } } } })(h.pi);
    h.handlers.get("session_start")!({}, h.context);
    expect(h.servers.get("demo")?.config).toMatchObject({ command: "other" });
    expect(h.notifications.some((message) => message.includes("already registered"))).toBe(true);
    h.handlers.get("session_shutdown")!({}, h.context);
    expect(h.servers.has("demo")).toBe(true);
  });

  it.each([
    { command: "demo", approveTools: true },
    { command: "demo", includeTools: ["read"] },
    { command: "demo", exposeResources: false },
    { url: "https://example.com", oauth: { clientId: "fixture" } },
    { url: "https://example.com", bearerTokenStore: true },
    { url: "https://example.com", httpTransport: "sse" },
  ])("rejects policies or authentication that cannot be safely preserved: %j", (definition) => {
    const h = host();
    createMcpAdapter({ config: { mcpServers: {} } })(h.pi);
    expect(() => registerMcpServer({ pi: h.pi, name: "unsafe", definition })).toThrow(/unsupported/i);
    expect(h.servers.has("unsafe")).toBe(false);
  });

  it("does not register servers when an explicit global security policy is unsupported", () => {
    const h = host();
    createMcpAdapter({ config: { mcpServers: { demo: { command: "demo" } }, settings: { outputGuard: { maxBytes: 100 } } } })(h.pi);
    h.handlers.get("session_start")!({}, h.context);
    expect(h.servers.size).toBe(0);
    expect(h.notifications.some((message) => message.includes("outputGuard"))).toBe(true);
  });

  it("imports healthy servers with presentation settings and reports one warning without forwarding them", () => {
    const h = host();
    createMcpAdapter({ config: {
      mcpServers: { first: { command: "first" }, second: { command: "second" } },
      settings: {
        showStatusIcon: true, mcpFooterStatus: "compact", notifyOnStartupConnect: false,
        warnOnLargeDirectTools: false, toolResultRendering: "boxed", collapsedResultLines: 2,
        authRequiredMessage: "private fixture text",
      },
    } })(h.pi);
    h.handlers.get("session_start")!({}, h.context);
    expect([...h.servers.keys()]).toEqual(["first", "second"]);
    expect(h.servers.get("first")?.config).toEqual({ command: "first", enabled: true, exposure: "codemode" });
    const warnings = h.notifications.filter((message) => message.includes("settings.showStatusIcon"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("ignored");
    expect(warnings[0]).toContain("settings.authRequiredMessage");
    expect(warnings[0]).not.toContain("private fixture text");
  });

  it("still blocks an unsupported security policy alongside presentation settings", () => {
    const h = host();
    createMcpAdapter({ config: {
      mcpServers: { demo: { command: "must-not-run" } },
      settings: { showStatusIcon: true, outputGuard: { maxBytes: 100 } },
    } })(h.pi);
    h.handlers.get("session_start")!({}, h.context);
    expect(h.servers.size).toBe(0);
    expect(h.notifications.some((message) => message.includes("unsupported fields") && message.includes("outputGuard"))).toBe(true);
  });

  it("imports shared servers when the native file only contains presentation preferences", () => {
    const h = host();
    writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: {}, settings: { showStatusIcon: false } }));
    sourceFixture.sources = [{
      source: { id: "shared", label: "fixture", readPath: "/fixture/shared.json", writePath: "/fixture/shared.json", kind: "shared", scope: "global", shared: true },
      config: { mcpServers: { extra: { command: "extra" } } },
    }];
    createMcpAdapter()(h.pi);
    h.handlers.get("session_start")!({}, h.context);
    expect(h.servers.has("extra")).toBe(true);
    expect(h.notifications.some((message) => message.includes("settings.showStatusIcon") && message.includes("ignored"))).toBe(true);
  });

  it("propagates host registration failures without recording a successful registration", () => {
    const h = host();
    h.pi.registerMcpServer = () => { throw new Error("host denied registration"); };
    createMcpAdapter({ config: { mcpServers: {} } })(h.pi);
    expect(() => registerMcpServer({ pi: h.pi, name: "demo", definition: { command: "demo" } })).toThrow("host denied registration");
    expect(h.servers.size).toBe(0);
  });

  it("omits untrusted project sources and imports them only in a trusted session", () => {
    const h = host();
    sourceFixture.sources = [{
      source: { id: "project", label: "fixture", readPath: "/fixture/.mcp.json", writePath: "/fixture/.mcp.json", kind: "project", scope: "project", shared: true },
      config: { mcpServers: { project: { command: "project-command" } } },
    }];
    createMcpAdapter()(h.pi);
    h.handlers.get("session_start")!({}, h.context);
    expect(h.servers.size).toBe(0);
    h.context.isProjectTrusted = () => true;
    h.handlers.get("session_start")!({}, h.context);
    expect(h.servers.has("project")).toBe(true);
    h.context.isProjectTrusted = () => false;
    h.handlers.get("session_start")!({}, h.context);
    expect(h.servers.size).toBe(0);
  });

  it("reserves native file entries including native-only authentication without importing them", () => {
    const h = host();
    writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { demo: { url: "https://example.com", auth: { provider: "fixture" } } } }));
    createMcpAdapter({ config: { mcpServers: { demo: { command: "must-not-run" } } } })(h.pi);
    h.handlers.get("session_start")!({}, h.context);
    expect(h.servers.size).toBe(0);
    expect(() => registerMcpServer({ pi: h.pi, name: "demo", definition: { command: "must-not-run" } })).toThrow(/owned by native/);
  });

  it("retracts an early registration if a native file takes ownership before session start", async () => {
    const h = host();
    createMcpAdapter({ config: { mcpServers: {} } })(h.pi);
    const registration = registerMcpServer({ pi: h.pi, name: "demo", definition: { command: "must-not-run" } });
    writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { demo: { command: "native" } } }));
    h.handlers.get("session_start")!({}, h.context);
    expect(h.servers.size).toBe(0);
    await registration.dispose();
    expect(h.servers.size).toBe(0);
  });

  it("blocks new registrations if native configuration becomes unreadable or malformed", () => {
    const h = host();
    createMcpAdapter({ config: { mcpServers: {} } })(h.pi);
    writeFileSync(join(agentDir, "mcp.json"), "{");
    h.handlers.get("session_start")!({}, h.context);
    expect(() => registerMcpServer({ pi: h.pi, name: "demo", definition: { command: "must-not-run" } })).toThrow(/registration is blocked/);
    expect(h.notifications.some((message) => message.includes("invalid-json"))).toBe(true);
    expect(h.servers.size).toBe(0);
  });

  it("preserves native-file adapter policies when deciding whether extra sources can be imported", () => {
    const h = host();
    writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({
      mcpServers: { native: { url: "https://example.com", auth: { provider: "fixture" } } },
      settings: { outputGuard: { maxBytes: 100 } },
    }));
    sourceFixture.sources = [{
      source: { id: "shared", label: "fixture", readPath: "/fixture/shared.json", writePath: "/fixture/shared.json", kind: "shared", scope: "global", shared: true },
      config: { mcpServers: { extra: { command: "must-not-run" } } },
    }];
    createMcpAdapter()(h.pi);
    h.handlers.get("session_start")!({}, h.context);
    expect(h.servers.size).toBe(0);
    expect(h.notifications.some((message) => message.includes("outputGuard"))).toBe(true);
  });

  it("does not resurrect a lower-precedence configuration when an overriding source is invalid", () => {
    const h = host();
    const source = { id: "shared", label: "fixture", readPath: "/fixture/shared.json", writePath: "/fixture/shared.json", kind: "shared" as const, scope: "global" as const, shared: true };
    sourceFixture.sources = [
      { source, config: { mcpServers: { demo: { command: "must-not-run" } } } },
      { source: { ...source, id: "override" }, config: null, error: { code: "invalid-json", message: "invalid", issues: [] } },
    ];
    createMcpAdapter()(h.pi);
    h.handlers.get("session_start")!({}, h.context);
    expect(h.servers.size).toBe(0);
    expect(h.notifications.some((message) => message.includes("invalid-json"))).toBe(true);
  });

  it("allows disposal to be retried after a genuine removal failure", async () => {
    const h = host();
    createMcpAdapter({ config: { mcpServers: {} } })(h.pi);
    const registration = registerMcpServer({ pi: h.pi, name: "demo", definition: { command: "demo" } });
    const unregister = h.pi.unregisterMcpServer;
    h.pi.unregisterMcpServer = () => { throw new Error("removal denied"); };
    await expect(registration.dispose()).rejects.toThrow("removal denied");
    expect(h.servers.has("demo")).toBe(true);
    h.pi.unregisterMcpServer = unregister;
    await registration.dispose();
    expect(h.servers.size).toBe(0);
  });

  it("reports registered configuration rather than invented connection status", async () => {
    const h = host();
    createMcpAdapter({ config: { mcpServers: { demo: { command: "demo" } } } })(h.pi);
    h.handlers.get("session_start")!({}, h.context);
    await h.commands.get("mcp-adapter")!.handler("", h.context);
    expect(h.notifications.at(-1)).toContain("/mcp");
    expect(h.notifications.at(-1)).not.toContain("connected");
  });
});
