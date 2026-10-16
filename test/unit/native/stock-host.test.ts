import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, McpOwnerAssembly } from "@earendil-works/pi-coding-agent";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  MCP_MANAGEMENT_PROTOCOL_ID: undefined,
  MCP_MANAGEMENT_PROTOCOL_VERSION: undefined,
  MCP_MANAGEMENT_DISCOVERY_EVENT: undefined,
  MCP_MANAGEMENT_AVAILABLE_EVENT: undefined,
  MCP_MANAGEMENT_RESPONSE_EVENT_PREFIX: undefined,
  MCP_MANAGEMENT_CAPABILITIES: undefined,
  installMcpOwnerAssembly: undefined,
}));

const { getNativeManagementRuntime, installNativeMcpOwnerAssembly, NativeMcpManagementBridge } = await import("../../../src/native/management-bridge.ts");

describe("stock Pi host compatibility gate", () => {
  it("fails explicitly and never emits a discovery request without the patched public API", () => {
    const events = { on: vi.fn(), emit: vi.fn() };
    const pi = { events } as unknown as ExtensionAPI;
    const assembly = { loadConfig: vi.fn() } as unknown as McpOwnerAssembly;

    expect(getNativeManagementRuntime()).toMatchObject({
      ok: false,
      error: { code: "missing-public-api", message: expect.stringContaining("fallback is disabled") },
    });
    expect(installNativeMcpOwnerAssembly(assembly)).toMatchObject({ ok: false, error: { code: "missing-public-api" } });

    const onUnavailable = vi.fn();
    const bridge = new NativeMcpManagementBridge(pi, vi.fn(), vi.fn(), onUnavailable);
    bridge.startSession();

    expect(onUnavailable).toHaveBeenCalledWith(expect.objectContaining({ code: "missing-public-api" }));
    expect(events.emit).not.toHaveBeenCalled();
    expect(events.on).not.toHaveBeenCalled();
  });
});
