import type {
  ExtensionAPI,
  ExtensionContext,
  McpManagementExecutionPolicy,
  McpManagementHandle,
  McpManagementResult,
  McpManagementSnapshot,
} from "@earendil-works/pi-coding-agent";
import type { OverlayHandle } from "@earendil-works/pi-tui";
import type { McpAuthResult, McpPanelCallbacks, McpPanelResult } from "../contracts/core.ts";
import { openUrl } from "../utils.ts";
import type { NativeConfigAssemblyState } from "./config-assembly.ts";
import { createNativeMcpPanelData } from "./panel-data.ts";

export interface NativeMcpPanelView {
  readonly handle: McpManagementHandle;
  update(snapshot: McpManagementSnapshot, projectTrusted?: boolean): void;
  markUnavailable(message: string): void;
}

export interface OpenNativeMcpPanelOptions {
  readonly pi: ExtensionAPI;
  readonly context: ExtensionContext;
  readonly handle: McpManagementHandle;
  readonly getCurrentHandle: () => McpManagementHandle | undefined;
  readonly getCurrentSnapshot: () => McpManagementSnapshot | undefined;
  readonly getProjectTrust: () => boolean | undefined;
  readonly configAssembly: NativeConfigAssemblyState;
  readonly getRuntimePolicies: () => ReadonlyMap<string, McpManagementExecutionPolicy>;
  readonly setPanelView: (view: NativeMcpPanelView | undefined) => void;
}

export interface NativeDirectToolsSaveReport {
  readonly saved: readonly string[];
  readonly failed: readonly { readonly name: string; readonly message: string }[];
  readonly unknown: readonly string[];
  readonly notAttempted: readonly string[];
}

export async function saveNativeDirectToolsChanges(
  handle: McpManagementHandle,
  changes: ReadonlyMap<string, boolean | readonly string[]>,
  isCurrentHandle: () => boolean,
): Promise<NativeDirectToolsSaveReport> {
  const saved: string[] = [];
  const failed: { name: string; message: string }[] = [];
  const unknown: string[] = [];
  const notAttempted: string[] = [];
  const entries = [...changes.entries()];

  for (let index = 0; index < entries.length; index++) {
    const [name, selection] = entries[index]!;
    if (!isCurrentHandle()) {
      notAttempted.push(...entries.slice(index).map(([pendingName]) => pendingName));
      break;
    }

    try {
      const result = await handle.setDirectTools(name, Array.isArray(selection) ? [...selection] : selection);
      if (result.ok) {
        saved.push(name);
        continue;
      }
      failed.push({ name, message: result.error.message });
      if (result.error.code === "session-ended") {
        notAttempted.push(...entries.slice(index + 1).map(([pendingName]) => pendingName));
        break;
      }
    } catch {
      unknown.push(name);
      notAttempted.push(...entries.slice(index + 1).map(([pendingName]) => pendingName));
      break;
    }
  }

  return { saved, failed, unknown, notAttempted };
}

function serverIn(snapshot: McpManagementSnapshot | undefined, name: string) {
  return snapshot?.servers.find((server) => server.name === name);
}

function panelCallbacks(
  options: OpenNativeMcpPanelOptions,
  getSnapshot: () => McpManagementSnapshot,
  getOverlayHandle: () => OverlayHandle | undefined,
): McpPanelCallbacks {
  const { context, handle, pi } = options;
  const isCurrent = () => options.getCurrentHandle() === handle;
  const currentSnapshot = () => (options.getCurrentSnapshot() ?? getSnapshot());

  return {
    canAuthenticate: (name) => {
      const server = serverIn(currentSnapshot(), name);
      return isCurrent() && server !== undefined && server.enabled;
    },
    authenticate: async (name): Promise<McpAuthResult> => {
      if (!isCurrent()) return { ok: false, message: "The native MCP session has ended." };
      if (!context.hasUI) return { ok: false, message: "OAuth authentication requires an interactive session." };
      const overlay = getOverlayHandle();
      overlay?.setHidden(true);
      try {
        const result = await handle.signIn(name, {
          showAuthorizationUrl: (url) => {
            context.ui.notify(`Sign in to MCP server "${name}" in your browser:\n${url.href}`, "info");
            void openUrl(pi, url.href, process.env.BROWSER, context.signal).catch(() => {
              context.ui.notify("The authorization page could not be opened automatically. Use the displayed link.", "warning");
            });
          },
          promptForRedirectUrl: async (signal) => context.ui.input(
            `Finish sign-in to MCP server "${name}". If the browser cannot reach this machine, paste its callback URL below.`,
            undefined,
            { signal },
          ),
        }, context.signal);
        return result.ok
          ? { ok: true }
          : { ok: false, message: `Native MCP sign-in failed (${result.error.code}).` };
      } catch {
        return { ok: false, message: "Native MCP authentication could not be completed." };
      } finally {
        overlay?.setHidden(false);
        overlay?.focus();
      }
    },
    reconnect: async (name) => {
      if (!isCurrent()) return false;
      try {
        const result = await handle.reconnectServer(name);
        if (!result.ok) {
          context.ui.notify(`Native MCP reconnect failed for "${name}" (${result.error.code}).`, "error");
          return false;
        }
        const latest = handle.snapshot();
        return latest.ok && serverIn(latest.value, name)?.connectionStatus === "connected";
      } catch {
        context.ui.notify(`Native MCP reconnect failed for "${name}".`, "error");
        return false;
      }
    },
    getConnectionStatus: (name) => {
      const server = serverIn(currentSnapshot(), name);
      if (!server || !server.enabled || server.connectionStatus === "disabled") return "disabled";
      if (server.connectionStatus === "failed") return "failed";
      if (server.connectionStatus === "needs-auth") return "needs-auth";
      if (server.connectionStatus === "connecting" || server.connectionStatus === "starting") return "connecting";
      if (server.connectionStatus === "connected") return "connected";
      return "idle";
    },
    getFailureMessage: () => null,
    refreshCacheAfterReconnect: (name) => {
      let latest: ReturnType<McpManagementHandle["snapshot"]>;
      try {
        latest = handle.snapshot();
      } catch {
        return null;
      }
      if (!latest.ok) return null;
      const server = serverIn(latest.value, name);
      if (!server || server.catalog.freshness !== "live") return null;
      const data = createNativeMcpPanelData(
        latest.value,
        options.configAssembly.getPanelConfiguration(options.getProjectTrust() === true),
        options.getRuntimePolicies(),
      );
      return data.cache?.servers[name] ?? null;
    },
  };
}

function saveSummary(report: NativeDirectToolsSaveReport): { message: string; level: "info" | "error" } | undefined {
  const lines: string[] = [];
  if (report.saved.length > 0) lines.push(`Saved directTools for: ${report.saved.join(", ")}.`);
  for (const failure of report.failed) {
    lines.push(`Could not fully save/apply directTools for "${failure.name}": ${failure.message}`);
  }
  for (const name of report.unknown) {
    lines.push(`The directTools operation for "${name}" has an unknown outcome; it was not retried.`);
  }
  if (report.notAttempted.length > 0) {
    lines.push(`Not attempted after the native session changed: ${report.notAttempted.join(", ")}.`);
  }
  if (lines.length === 0) return undefined;
  return { message: lines.join("\n"), level: report.failed.length || report.unknown.length || report.notAttempted.length ? "error" : "info" };
}

function panelUnavailableResult(result: McpManagementResult<McpManagementSnapshot>): string | undefined {
  return result.ok ? undefined : result.error.message;
}

export async function openNativeMcpPanel(options: OpenNativeMcpPanelOptions): Promise<void> {
  const { context, handle } = options;
  if (!context.hasUI) return;
  if (context.mode !== "tui") {
    const snapshot = handle.snapshot();
    if (!snapshot.ok) {
      context.ui.notify(snapshot.error.message, "error");
      return;
    }
    const lines = snapshot.value.servers.length === 0
      ? ["No native MCP servers are visible in this session."]
      : snapshot.value.servers.map((server) =>
          `${server.name}: ${server.connectionStatus}; tools ${server.catalog.freshness}; resources ${server.catalog.resources.freshness}`,
        );
    context.ui.notify(lines.join("\n"), "info");
    return;
  }
  if (options.getCurrentHandle() !== handle) {
    context.ui.notify("The native MCP session changed before the panel opened.", "error");
    return;
  }

  let initialSnapshot: ReturnType<McpManagementHandle["snapshot"]>;
  try {
    initialSnapshot = handle.snapshot();
  } catch {
    context.ui.notify("The native MCP session snapshot could not be read.", "error");
    return;
  }
  const unavailable = panelUnavailableResult(initialSnapshot);
  if (unavailable) {
    context.ui.notify(unavailable, "error");
    return;
  }
  if (!initialSnapshot.ok) return;

  const { createMcpPanel } = await import("../ui/mcp-panel.ts");
  const configuration = options.configAssembly.getPanelConfiguration(options.getProjectTrust() === true);
  let overlayHandle: OverlayHandle | undefined;
  let activeView: NativeMcpPanelView | undefined;
  let finished = false;

  await new Promise<void>((resolve) => {
    context.ui.custom(
      (tui, _theme, keybindings, done) => {
        let currentSnapshot = options.getCurrentSnapshot() ?? initialSnapshot.value;
        let data = createNativeMcpPanelData(currentSnapshot, configuration, options.getRuntimePolicies());
        const projectTrusted = options.getProjectTrust();
        const callbacks = panelCallbacks(options, () => currentSnapshot, () => overlayHandle);
        const component = createMcpPanel(
          data.config,
          data.cache,
          new Map(),
          callbacks,
          tui,
          (result: McpPanelResult) => {
            if (finished) return;
            finished = true;
            options.setPanelView(undefined);
            void (async () => {
              if (!result.cancelled && result.changes.size > 0 && options.getCurrentHandle() === handle) {
                const report = await saveNativeDirectToolsChanges(handle, result.changes, () => options.getCurrentHandle() === handle);
                const summary = saveSummary(report);
                if (summary) context.ui.notify(summary.message, summary.level);
              } else if (!result.cancelled && result.changes.size > 0) {
                context.ui.notify("The native MCP session changed; directTools changes were not started.", "error");
              }
              done(undefined);
              resolve();
            })().catch(() => {
              context.ui.notify("The native directTools operation could not be confirmed. It was not retried.", "error");
              done(undefined);
              resolve();
            });
          },
          {
            keybindings,
            noticeLines: [
              "Direct-tool selection is saved through the native configuration owner.",
              "The saved selection is separate from this session's effective tool exposure.",
            ],
            nativeDetails: data.details,
            showTokenEstimate: false,
            ...(projectTrusted === undefined ? {} : { projectTrusted }),
          },
        );
        activeView = {
          handle,
          update: (snapshot, projectTrusted) => {
            if (finished || options.getCurrentHandle() !== handle) return;
            currentSnapshot = snapshot;
            component.updateProjectTrust(projectTrusted);
            data = createNativeMcpPanelData(
              snapshot,
              options.configAssembly.getPanelConfiguration(options.getProjectTrust() === true),
              options.getRuntimePolicies(),
            );
            component.updateNativeData(data.config, data.cache, data.details);
          },
          markUnavailable: (message) => component.markNativeUnavailable(message),
        };
        options.setPanelView(activeView);
        return component;
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: 92 },
        onHandle: (overlay) => { overlayHandle = overlay; },
      },
    );
  });

  if (activeView && options.getCurrentHandle() === handle) options.setPanelView(undefined);
}
