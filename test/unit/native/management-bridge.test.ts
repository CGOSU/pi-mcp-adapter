import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, McpManagementHandle, McpManagementSnapshot } from "@earendil-works/pi-coding-agent";

const capabilities = vi.hoisted(() => [
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
] as const);

vi.mock("@earendil-works/pi-coding-agent", () => ({
  MCP_MANAGEMENT_PROTOCOL_ID: "pi.mcp-management",
  MCP_MANAGEMENT_PROTOCOL_VERSION: 1,
  MCP_MANAGEMENT_DISCOVERY_EVENT: "pi:mcp-management:discover",
  MCP_MANAGEMENT_AVAILABLE_EVENT: "pi:mcp-management:available",
  MCP_MANAGEMENT_RESPONSE_EVENT_PREFIX: "pi:mcp-management:response:",
  MCP_MANAGEMENT_CAPABILITIES: capabilities,
  installMcpOwnerAssembly: vi.fn(() => ({ ok: true, value: vi.fn() })),
}));

const { NativeMcpManagementBridge } = await import("../../../src/native/management-bridge.ts");

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

function makeSnapshot(): McpManagementSnapshot {
  return {
    protocolVersion: 1,
    sessionId: "session-1",
    revision: 1,
    servers: [],
  } as McpManagementSnapshot;
}

function makeHandle(): McpManagementHandle {
  const snapshot = makeSnapshot();
  return {
    protocolVersion: 1,
    capabilities,
    snapshot: () => ({ ok: true, value: snapshot }),
    subscribe: (listener) => {
      listener(snapshot);
      return { ok: true, value: () => undefined };
    },
    setServerEnabled: async () => ({ ok: true, value: snapshot }),
    reconnectServer: async () => ({ ok: true, value: snapshot }),
    setServerExposure: async () => ({ ok: true, value: snapshot }),
    setToolExposure: async () => ({ ok: true, value: snapshot }),
    setDirectTools: async () => ({ ok: true, value: snapshot }),
    setExecutionPolicy: async () => ({ ok: true, value: snapshot }),
    refreshCatalog: async () => ({ ok: true, value: snapshot }),
    readResource: async () => ({ ok: true, value: { contents: [] } }),
    readAppResource: async () => ({ ok: true, value: { contents: [] } }),
    getPrompt: async () => ({ ok: true, value: { messages: [] } }),
    callAppTool: async () => ({ ok: true, value: { content: [] } }),
    signIn: async () => ({ ok: true, value: snapshot }),
    signOut: async () => ({ ok: true, value: snapshot }),
  } as unknown as McpManagementHandle;
}

function nativeResponse(request: Record<string, unknown>, handle: McpManagementHandle, overrides: Record<string, unknown> = {}) {
  return {
    protocol: "pi.mcp-management",
    version: 1,
    requestId: request.requestId,
    capabilities: [...capabilities, "catalog.future"],
    result: { ok: true, value: handle },
    ...overrides,
  };
}

function makePi(events: FakeEventBus): ExtensionAPI {
  return { events } as unknown as ExtensionAPI;
}

describe("NativeMcpManagementBridge", () => {
  beforeEach(() => vi.useRealTimers());

  it("discovers the native handle over the public event bus and negotiates the full capability set", async () => {
    const events = new FakeEventBus();
    const handle = makeHandle();
    const requested = vi.fn();
    events.on("pi:mcp-management:discover", (requestValue) => {
      const request = requestValue as Record<string, unknown>;
      requested(request);
      events.emit(`pi:mcp-management:response:${request.requestId}`, nativeResponse(request, handle));
    });
    const onHandle = vi.fn();
    const onSnapshot = vi.fn();
    const onUnavailable = vi.fn();
    const bridge = new NativeMcpManagementBridge(makePi(events), onHandle, onSnapshot, onUnavailable);

    bridge.startSession();
    await vi.waitFor(() => expect(onHandle).toHaveBeenCalledWith(handle));

    expect(requested).toHaveBeenCalledTimes(1);
    expect(requested.mock.calls[0]?.[0]).toMatchObject({
      protocol: "pi.mcp-management",
      version: 1,
      requiredCapabilities: expect.arrayContaining(capabilities),
    });
    expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1" }));
    expect(onUnavailable).not.toHaveBeenCalled();
    bridge.stopSession();
  });

  it("rejects a host response that omits a required capability", async () => {
    const events = new FakeEventBus();
    const handle = makeHandle();
    events.on("pi:mcp-management:discover", (requestValue) => {
      const request = requestValue as Record<string, unknown>;
      events.emit(`pi:mcp-management:response:${request.requestId}`, {
        ...nativeResponse(request, handle),
        capabilities: capabilities.filter((capability) => capability !== "app.call-tool"),
      });
    });
    const onUnavailable = vi.fn();
    const bridge = new NativeMcpManagementBridge(makePi(events), vi.fn(), vi.fn(), onUnavailable);

    bridge.startSession();
    await vi.waitFor(() => expect(onUnavailable).toHaveBeenCalledWith(expect.objectContaining({ code: "missing-capabilities" })));
    bridge.stopSession();
  });

  it("reports a protocol-version mismatch instead of enabling a fallback runtime", async () => {
    const events = new FakeEventBus();
    const handle = makeHandle();
    events.on("pi:mcp-management:discover", (requestValue) => {
      const request = requestValue as Record<string, unknown>;
      events.emit(`pi:mcp-management:response:${request.requestId}`, {
        ...nativeResponse(request, handle),
        version: 99,
      });
    });
    const onHandle = vi.fn();
    const onUnavailable = vi.fn();
    const bridge = new NativeMcpManagementBridge(makePi(events), onHandle, vi.fn(), onUnavailable);

    bridge.startSession();
    await vi.waitFor(() => expect(onUnavailable).toHaveBeenCalledWith(expect.objectContaining({ code: "unsupported-version" })));

    expect(onHandle).not.toHaveBeenCalled();
    bridge.stopSession();
  });
});
