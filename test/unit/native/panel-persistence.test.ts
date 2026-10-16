import { describe, expect, it, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
  McpManagementHandle,
  McpManagementResult,
  McpManagementSnapshot,
} from "@earendil-works/pi-coding-agent";
import type { NativeConfigAssemblyState, NativePanelConfiguration } from "../../../src/native/config-assembly.ts";
import { openNativeMcpPanel, saveNativeDirectToolsChanges, type NativeMcpPanelView } from "../../../src/native/panel.ts";
import { createMcpPanel } from "../../../src/ui/mcp-panel.ts";

describe("native MCP panel directTools persistence", () => {
  it("persists explicit false and bounded selections through the current native handle", async () => {
    const saved = new Map<string, boolean | readonly string[]>();
    const handle = {
      setDirectTools: async (name: string, selection: boolean | readonly string[]) => {
        saved.set(name, selection);
        return { ok: true, value: undefined };
      },
    } as unknown as McpManagementHandle;

    const report = await saveNativeDirectToolsChanges(
      handle,
      new Map([
        ["all-tools", false],
        ["selected-tools", ["lookup", "summarize"]],
      ]),
      () => true,
    );

    expect(saved.get("all-tools")).toBe(false);
    expect(saved.get("selected-tools")).toEqual(["lookup", "summarize"]);
    expect(report).toEqual({ saved: ["all-tools", "selected-tools"], failed: [], unknown: [], notAttempted: [] });
  });

  it("clears unrepresented selections when toggling every tool off", () => {
    let submitted: unknown;
    const panel = createMcpPanel(
      { mcpServers: { docs: { command: "node", directTools: ["app-only"] } } } as Parameters<typeof createMcpPanel>[0],
      null,
      new Map(),
      {
        reconnect: async () => false,
        canAuthenticate: () => false,
        authenticate: async () => ({ ok: true }),
        getConnectionStatus: () => "connected",
        refreshCacheAfterReconnect: () => null,
      },
      { requestRender: () => {} },
      (result) => { submitted = result; },
    );

    panel.handleInput(" ");
    panel.handleInput("\x13");

    expect(submitted).toMatchObject({ cancelled: false, changes: new Map([["docs", false]]) });
  });

  it("does not replay an unknown outcome or attempt later servers after a thrown operation", async () => {
    const writes: string[] = [];
    const handle = {
      setDirectTools: async (name: string) => {
        writes.push(name);
        throw new Error("response was lost");
      },
    } as unknown as McpManagementHandle;

    const report = await saveNativeDirectToolsChanges(
      handle,
      new Map([
        ["first", true],
        ["second", false],
      ]),
      () => true,
    );

    expect(writes).toEqual(["first"]);
    expect(report).toEqual({ saved: [], failed: [], unknown: ["first"], notAttempted: ["second"] });
  });

  it("leaves all changes unattempted when the native session has already changed", async () => {
    const writes: string[] = [];
    const handle = {
      setDirectTools: async (name: string) => {
        writes.push(name);
        return { ok: true, value: undefined };
      },
    } as unknown as McpManagementHandle;

    const report = await saveNativeDirectToolsChanges(
      handle,
      new Map([
        ["first", true],
        ["second", ["search"]],
      ]),
      () => false,
    );

    expect(writes).toEqual([]);
    expect(report).toEqual({ saved: [], failed: [], unknown: [], notAttempted: ["first", "second"] });
  });

  it("refreshes its catalog from the native snapshot and persists the selected tool", async () => {
    const snapshot = {
      protocolVersion: 1,
      servers: [{
        name: "docs",
        enabled: true,
        scope: "project",
        exposure: "codemode",
        directTools: false,
        connectionStatus: "connected",
        catalog: {
          freshness: "live",
          tools: [{ name: "old-tool", exposure: "direct" }],
          resources: { available: false, freshness: "missing", items: [], templates: [] },
          prompts: { available: false, freshness: "missing", items: [] },
        },
      }],
    } as unknown as McpManagementSnapshot;
    const saved: Array<[string, boolean | readonly string[]]> = [];
    const handle = {
      snapshot: () => ({ ok: true, value: snapshot }),
      setDirectTools: async (name: string, selection: boolean | readonly string[]) => {
        saved.push([name, selection]);
        return { ok: true, value: snapshot };
      },
    } as unknown as McpManagementHandle;
    const configuration: NativePanelConfiguration = {
      servers: new Map([[
        "docs",
        { directTools: false, includeTools: [], excludeTools: [], exposeResources: true, scope: "project" },
      ]]),
    };
    let component: ReturnType<typeof createMcpPanel> | undefined;
    const keybindings = {
      matches: (data: string, key: string) =>
        (key === "tui.select.up" && data === "\x1b[A") ||
        (key === "tui.select.down" && data === "\x1b[B") ||
        (key === "tui.select.confirm" && data === "\r"),
    };
    const custom = (factory: (tui: { requestRender(): void }, theme: unknown, keys: typeof keybindings, done: (value?: unknown) => void) => unknown) => {
      component = factory({ requestRender() {} }, {}, keybindings, () => {}) as ReturnType<typeof createMcpPanel>;
    };
    const context = {
      hasUI: true,
      mode: "tui",
      signal: new AbortController().signal,
      isProjectTrusted: () => true,
      ui: { custom, notify: () => {}, input: async () => undefined },
    } as unknown as ExtensionContext;
    let currentHandle: McpManagementHandle | undefined = handle;
    let currentSnapshot = snapshot;
    let panelView: NativeMcpPanelView | undefined;

    const opening = openNativeMcpPanel({
      pi: {} as ExtensionAPI,
      context,
      handle,
      getCurrentHandle: () => currentHandle,
      getCurrentSnapshot: () => currentSnapshot,
      getProjectTrust: () => true,
      configAssembly: { getPanelConfiguration: () => configuration } as NativeConfigAssemblyState,
      getRuntimePolicies: () => new Map(),
      setPanelView: (view) => { panelView = view; },
    });
    await vi.waitFor(() => expect(component).toBeDefined());
    await vi.waitFor(() => expect(panelView).toBeDefined());

    const freshSnapshot = {
      protocolVersion: 1,
      servers: [{
        ...snapshot.servers[0],
        catalog: {
          ...snapshot.servers[0]!.catalog,
          tools: [
            { name: "fresh-tool", exposure: "direct" },
            { name: "other-tool", exposure: "direct" },
          ],
        },
      }],
    } as unknown as McpManagementSnapshot;
    currentSnapshot = freshSnapshot;
    panelView!.update(freshSnapshot, true);

    component!.handleInput("\r");
    component!.handleInput("\x1b[B");
    component!.handleInput(" ");
    component!.handleInput("\x13");
    await opening;

    expect(saved).toEqual([["docs", ["fresh-tool"]]]);
    expect(panelView).toBeUndefined();
    currentHandle = undefined;
  });

  it("preserves a native error that can describe a post-save application failure", async () => {
    const handle = {
      setDirectTools: async () => ({
        ok: false,
        error: { code: "config-update-failed", message: "The selection was saved but not applied to this session." },
      } satisfies McpManagementResult<unknown>),
    } as unknown as McpManagementHandle;

    const report = await saveNativeDirectToolsChanges(handle, new Map([["docs", ["lookup"]]]), () => true);

    expect(report.failed).toEqual([{
      name: "docs",
      message: "The selection was saved but not applied to this session.",
    }]);
    expect(report.saved).toEqual([]);
  });
});
