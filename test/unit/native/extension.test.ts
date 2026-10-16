import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, McpManagementHandle, McpManagementSnapshot } from "@earendil-works/pi-coding-agent";
import { createMcpPanel } from "../../../src/ui/mcp-panel.ts";

const nativeApi = vi.hoisted(() => ({
  assembly: undefined as unknown,
  installAssembly: vi.fn(),
  capabilities: [
    "server.snapshot",
    "server.subscribe",
    "server.enable",
    "server.disable",
    "server.reconnect",
    "server.set-exposure",
    "tool.set-exposure",
    "catalog.refresh",
    "catalog.resources",
    "catalog.prompts",
    "resource.read",
    "resource.read-app",
    "prompt.get",
    "app.call-tool",
    "oauth.sign-in",
    "oauth.sign-out",
    "server.set-direct-tools",
    "execution.set-policy",
  ],
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  MCP_MANAGEMENT_PROTOCOL_ID: "pi.mcp-management",
  MCP_MANAGEMENT_PROTOCOL_VERSION: 1,
  MCP_MANAGEMENT_DISCOVERY_EVENT: "pi:mcp-management:discover",
  MCP_MANAGEMENT_AVAILABLE_EVENT: "pi:mcp-management:available",
  MCP_MANAGEMENT_RESPONSE_EVENT_PREFIX: "pi:mcp-management:response:",
  MCP_MANAGEMENT_CAPABILITIES: nativeApi.capabilities,
  installMcpOwnerAssembly: nativeApi.installAssembly,
}));

const { createMcpAdapter, registerMcpServer } = await import("../../../src/native/extension.ts");

class FakeEventBus {
  private readonly handlers = new Map<string, Set<(value: unknown) => void>>();

  on(event: string, handler: (value: unknown) => void): () => void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler);
  }

  emit(event: string, value: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(value);
  }
}

function makeHandle() {
  let snapshot = { protocolVersion: 1, sessionId: "session-1", revision: 1, servers: [] } as unknown as McpManagementSnapshot;
  const listeners = new Set<(value: McpManagementSnapshot) => void>();
  const handle: McpManagementHandle = {
    protocolVersion: 1,
    capabilities: nativeApi.capabilities,
    snapshot: () => ({ ok: true, value: snapshot }),
    subscribe: (listener) => {
      listeners.add(listener);
      listener(snapshot);
      return { ok: true, value: () => { listeners.delete(listener); } };
    },
    setServerEnabled: async () => ({ ok: true, value: snapshot }),
    reconnectServer: async () => ({ ok: true, value: snapshot }),
    setServerExposure: async () => ({ ok: true, value: snapshot }),
    setToolExposure: async () => ({ ok: true, value: snapshot }),
    setDirectTools: vi.fn(async () => ({ ok: true, value: snapshot })),
    setExecutionPolicy: vi.fn(async () => ({ ok: true, value: undefined })),
    refreshCatalog: async () => ({ ok: true, value: snapshot }),
    readResource: async () => ({ ok: true, value: { contents: [] } }),
    readAppResource: async () => ({ ok: true, value: { contents: [] } }),
    getPrompt: async () => ({ ok: true, value: { messages: [] } }),
    callAppTool: async () => ({ ok: true, value: { content: [] } }),
    signIn: async () => ({ ok: true, value: snapshot }),
    signOut: async () => ({ ok: true, value: snapshot }),
  } as unknown as McpManagementHandle;
  return {
    handle,
    updateServers(servers: unknown[]) {
      snapshot = { ...snapshot, revision: snapshot.revision + 1, servers } as McpManagementSnapshot;
      for (const listener of listeners) listener(snapshot);
    },
  };
}

function makePi() {
  const events = new FakeEventBus();
  const lifecycle = new Map<string, (event: unknown, context: unknown) => void>();
  const commands = new Map<string, { handler: (args: string, context: unknown) => Promise<void> | void }>();
  const registered = new Map<string, { name: string; config: unknown }>();
  const native = makeHandle();
  events.on("pi:mcp-management:discover", (value) => {
    const request = value as Record<string, unknown>;
    events.emit(`pi:mcp-management:response:${request.requestId}`, {
      protocol: "pi.mcp-management",
      version: 1,
      requestId: request.requestId,
      capabilities: nativeApi.capabilities,
      result: { ok: true, value: native.handle },
    });
  });
  const pi = {
    events,
    on: vi.fn((event: string, handler: (event: unknown, context: unknown) => void) => lifecycle.set(event, handler)),
    registerCommand: vi.fn((name: string, command: { handler: (args: string, context: unknown) => Promise<void> | void }) => commands.set(name, command)),
    getMcpServers: vi.fn(() => [...registered.values()]),
    registerMcpServer: vi.fn((name: string, config: unknown) => {
      registered.set(name, { name, config });
      native.updateServers([
        ...((native.handle.snapshot() as { value: McpManagementSnapshot }).value.servers),
        {
          name,
          enabled: true,
          scope: "extension",
          exposure: "codemode",
          connectionStatus: "disconnected",
          catalog: {
            freshness: "missing",
            tools: [],
            resources: { available: false, freshness: "missing", items: [], templates: [] },
            prompts: { available: false, freshness: "missing", items: [] },
          },
        },
      ]);
    }),
    unregisterMcpServer: vi.fn((name: string) => {
      registered.delete(name);
      native.updateServers(((native.handle.snapshot() as { value: McpManagementSnapshot }).value.servers as unknown[]).filter((server) => (server as { name: string }).name !== name));
    }),
  };
  return { pi: pi as unknown as ExtensionAPI, events, lifecycle, commands, registered, native };
}

describe("native extension entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeApi.assembly = undefined;
    nativeApi.installAssembly.mockImplementation((assembly: unknown) => {
      nativeApi.assembly = assembly;
      return { ok: true, value: vi.fn() };
    });
  });

  it("installs the native assembly once and preserves factory config, registration and async disposal", async () => {
    const { pi, registered, native } = makePi();
    const factory = createMcpAdapter({ config: { mcpServers: { configured: { command: "fixture-server" } } } });
    factory(pi);
    factory(pi);

    expect(nativeApi.installAssembly).toHaveBeenCalledTimes(1);
    expect((nativeApi.assembly as { loadConfig: (context: unknown) => { servers: unknown[] } }).loadConfig({
      cwd: process.cwd(),
      isProjectTrusted: () => false,
    })).toMatchObject({
      servers: [expect.objectContaining({
        name: "configured",
        config: expect.objectContaining({ type: "stdio", command: "fixture-server" }),
        source: "pi-mcp-adapter:programmatic-config",
        scope: "extension",
      })],
    });

    await vi.waitFor(() => expect(native.handle.snapshot()).toMatchObject({ ok: true }));
    const registration = registerMcpServer({
      pi,
      name: "runtime",
      definition: { command: "fixture-server", args: ["--stdio"] },
    });
    expect(registered.has("runtime")).toBe(true);
    await vi.waitFor(() => expect(native.handle.setExecutionPolicy).toHaveBeenCalledWith("runtime", expect.any(Object)));

    await Promise.all([registration.dispose(), registration.dispose()]);
    expect(pi.unregisterMcpServer).toHaveBeenCalledTimes(1);
    expect(registered.has("runtime")).toBe(false);
  });

  it("publishes the existing status-v1 event and routes /mcp-adapter to the native panel", async () => {
    const { pi, events, commands } = makePi();
    const statuses: unknown[] = [];
    events.on("pi-mcp-adapter/status/v1", (status) => statuses.push(status));
    createMcpAdapter()(pi);
    await vi.waitFor(() => expect(statuses.length).toBeGreaterThan(0));

    let component: ReturnType<typeof createMcpPanel> | undefined;
    const keybindings = { matches: () => false };
    const custom = (factory: (
      tui: { requestRender(): void },
      theme: unknown,
      keys: typeof keybindings,
      done: (value?: unknown) => void,
    ) => unknown) => {
      component = factory({ requestRender() {} }, {}, keybindings, () => {}) as ReturnType<typeof createMcpPanel>;
    };
    const context = {
      hasUI: true,
      mode: "tui",
      cwd: process.cwd(),
      signal: new AbortController().signal,
      isProjectTrusted: () => true,
      ui: { custom, notify: vi.fn(), setStatus: vi.fn(), input: vi.fn() },
    } as unknown as ExtensionContext;
    const panelOpen = commands.get("mcp-adapter")!.handler("", context);
    await vi.waitFor(() => expect(component).toBeDefined());
    component!.handleInput("\x1b");
    await panelOpen;

    expect(statuses.at(-1)).toMatchObject({
      version: 1,
      servers: [],
      totalTools: 0,
      totalResources: 0,
      connectedCount: 0,
      disabledCount: 0,
    });
  });

  it("fails explicitly when runtime registration is requested before adapter installation", () => {
    const { pi } = makePi();
    expect(() => registerMcpServer({ pi, name: "runtime", definition: { command: "fixture-server" } }))
      .toThrow("pi-mcp-adapter is not installed for this Pi instance");
  });
});
