import type {
  ExtensionAPI,
  ExtensionContext,
  McpManagementExecutionPolicy,
  McpManagementHandle,
  McpManagementSnapshot,
  McpServerConfig,
} from "@earendil-works/pi-coding-agent";
import type { McpAdapterOptions, ServerEntry } from "../contracts/core.js";
import { openNativeMcpPanel, type NativeMcpPanelView } from "./panel.ts";
import { clearNativeStatusBar, createNativeStatusSnapshot, publishNativeStatusShutdown, publishNativeStatusSnapshot, updateNativeStatusBar } from "./status.ts";
import { cloneMcpConfig } from "../config/load.ts";
import { validateServerEntry } from "../config/validation.ts";
import type { LoadedConfigSource } from "../config/load.ts";
import { mapLoadedConfigSourcesToNative } from "./config-mapping.ts";
import { createNativeConfigAssembly, type NativeConfigAssemblyState } from "./config-assembly.ts";
import {
  installNativeMcpOwnerAssembly,
  NativeMcpManagementBridge,
  type NativeManagementFailure,
} from "./management-bridge.ts";

const PROGRAMMATIC_SOURCE = "pi-mcp-adapter:programmatic-config";
const DISPOSE_TIMEOUT_MS = 5_000;

export interface McpServerRegistration {
  dispose(): Promise<void>;
}

interface RuntimeServerRegistration {
  readonly executionPolicy: McpManagementExecutionPolicy;
  readonly appliedHandles: WeakSet<McpManagementHandle>;
}

interface NativeAdapterState {
  readonly pi: ExtensionAPI;
  readonly configAssembly: NativeConfigAssemblyState;
  readonly bridge: NativeMcpManagementBridge;
  readonly registrations: Map<string, RuntimeServerRegistration>;
  readonly assemblyInstallError?: NativeManagementFailure;
  handle: McpManagementHandle | undefined;
  snapshot: McpManagementSnapshot | undefined;
  panelView: NativeMcpPanelView | undefined;
  context: ExtensionContext | undefined;
}

const adapters = new WeakMap<ExtensionAPI, NativeAdapterState>();

function mapRuntimeServer(name: string, definition: ServerEntry): {
  readonly config: McpServerConfig;
  readonly executionPolicy: RuntimeServerRegistration["executionPolicy"];
} {
  const validated = validateServerEntry(name, definition, { requireTransport: true });
  if (!validated.ok) {
    throw new Error(`MCP server definition is invalid (${validated.error.code}): ${validated.error.message}`);
  }
  const source: LoadedConfigSource = {
    source: {
      id: "adapter-config",
      label: "Pi MCP adapter runtime registration",
      readPath: PROGRAMMATIC_SOURCE,
      writePath: PROGRAMMATIC_SOURCE,
      kind: "extension",
      shared: false,
      scope: "extension",
    },
    config: { mcpServers: { [name]: validated.value } },
  };
  const mapped = mapLoadedConfigSourcesToNative([source]);
  if (!mapped.ok) throw new Error(`MCP server definition could not be mapped (${mapped.error.code}).`);
  const server = mapped.value.servers.find((entry) => entry.name === name);
  if (!server?.connectable || !("command" in server.config || "url" in server.config || "socket" in server.config)) {
    const fields = server?.deferredFields ?? [];
    const issues = server?.blockingIssues.map((issue) => issue.message) ?? [];
    const details = [...(fields.length ? [`unsupported fields: ${fields.join(", ")}`] : []), ...issues].join(" ");
    throw new Error(details || "MCP server definition has no native transport.");
  }
  return { config: server.config, executionPolicy: server.executionPolicy };
}

function notify(state: NativeAdapterState, message: string, level: "info" | "warning" | "error" = "info"): void {
  if (state.context?.hasUI) state.context.ui.notify(message, level);
  else if (level === "error") console.error(`MCP adapter: ${message}`);
}

function runtimePolicies(state: NativeAdapterState): ReadonlyMap<string, McpManagementExecutionPolicy> {
  return new Map([...state.registrations].map(([name, registration]) => [name, registration.executionPolicy]));
}

function publishSnapshot(state: NativeAdapterState, snapshot: McpManagementSnapshot): void {
  const previousHandle = state.handle;
  const handle = state.bridge.currentHandle;
  if (handle && previousHandle && previousHandle !== handle && state.panelView?.handle === previousHandle) {
    state.panelView.markUnavailable("The native MCP session changed; reopen the panel to edit the current session.");
  }
  if (handle) state.handle = handle;
  state.snapshot = snapshot;
  applyRuntimePolicies(state, snapshot);
  const status = publishNativeStatusSnapshot(
    state.pi,
    snapshot,
    state.configAssembly.getPanelConfiguration(state.context?.isProjectTrusted() === true),
    runtimePolicies(state),
  );
  if (state.context) updateNativeStatusBar(state.context, status);
  if (state.panelView && state.panelView.handle === handle) {
    state.panelView.update(snapshot, state.context?.isProjectTrusted());
  }
}

function formatSnapshot(state: NativeAdapterState, snapshot: McpManagementSnapshot): string {
  if (snapshot.servers.length === 0) return "No native MCP servers are visible in this session.";
  const status = createNativeStatusSnapshot(
    snapshot,
    state.configAssembly.getPanelConfiguration(state.context?.isProjectTrusted() === true),
    runtimePolicies(state),
  );
  return snapshot.servers.map((server) => {
    const counts = status.servers.find((entry) => entry.name === server.name);
    const toolCount = counts?.toolCount ?? 0;
    const resourceCount = counts?.resourceCount;
    return `${server.name}: ${server.connectionStatus}; catalog ${server.catalog.freshness} (${toolCount} tools); resources ${server.catalog.resources.freshness}${resourceCount === undefined ? "" : ` (${resourceCount})`}`;
  }).join("\n");
}

function applyRuntimePolicies(state: NativeAdapterState, snapshot: McpManagementSnapshot): void {
  const handle = state.handle;
  if (!handle) return;
  for (const [name, registration] of state.registrations) {
    if (registration.appliedHandles.has(handle) || !snapshot.servers.some((server) => server.name === name)) continue;
    registration.appliedHandles.add(handle);
    void handle.setExecutionPolicy(name, registration.executionPolicy).then((result) => {
      if (result.ok || state.handle !== handle || state.registrations.get(name) !== registration) return;
      notify(state, `Native MCP policy for "${name}" was not applied: ${result.error.message}`, "error");
    });
  }
}

function installAdapter(pi: ExtensionAPI, options: McpAdapterOptions): NativeAdapterState {
  const previous = adapters.get(pi);
  if (previous) return previous;

  const configAssembly = createNativeConfigAssembly(options);
  const assemblyResult = installNativeMcpOwnerAssembly(configAssembly.assembly, pi.events);
  let releaseAssembly = assemblyResult.ok ? assemblyResult.value : undefined;
  let currentState: NativeAdapterState | undefined;
  const bridge = new NativeMcpManagementBridge(
    pi,
    (handle) => {
      const state = currentState;
      if (!state) return;
      state.handle = handle;
      const snapshot = handle.snapshot();
      if (snapshot.ok) {
        publishSnapshot(state, snapshot.value);
      } else {
        notify(state, snapshot.error.message, "error");
      }
    },
    (snapshot) => {
      const state = currentState;
      if (!state) return;
      publishSnapshot(state, snapshot);
    },
    (error) => {
      const state = currentState;
      if (!state) return;
      if (error.code === "session-ended") {
        const panelView = state.panelView;
        if (panelView && panelView.handle === state.handle) panelView.markUnavailable(error.message);
        state.handle = undefined;
        state.snapshot = undefined;
      }
      if (error.code !== "discovery-timeout") notify(state, error.message, "error");
    },
  );
  const state: NativeAdapterState = {
    pi,
    configAssembly,
    bridge,
    registrations: new Map(),
    handle: undefined,
    snapshot: undefined,
    panelView: undefined,
    context: undefined,
    ...(assemblyResult.ok ? {} : { assemblyInstallError: assemblyResult.error }),
  };
  currentState = state;
  adapters.set(pi, state);

  pi.on("session_start", (_event, context) => {
    const panelView = state.panelView;
    if (panelView && panelView.handle === state.handle) {
      panelView.markUnavailable("The native MCP session changed; reopen the panel to edit the current session.");
    }
    state.handle = undefined;
    state.snapshot = undefined;
    publishNativeStatusShutdown(pi);
    clearNativeStatusBar(context);
    state.context = context;
    if (state.assemblyInstallError) {
      notify(state, state.assemblyInstallError.message, "error");
      return;
    }
    state.bridge.startSession();
  });
  pi.on("session_shutdown", () => {
    const panelView = state.panelView;
    if (panelView && panelView.handle === state.handle) {
      panelView.markUnavailable("The native MCP session has ended; panel changes are no longer saved.");
    }
    state.bridge.stopSession();
    releaseAssembly?.();
    releaseAssembly = undefined;
    adapters.delete(pi);
    state.handle = undefined;
    state.snapshot = undefined;
    publishNativeStatusShutdown(pi);
    if (state.context) clearNativeStatusBar(state.context);
    state.context = undefined;
  });

  pi.registerCommand("mcp-adapter", {
    description: "Show native MCP status managed by pi-mcp-adapter",
    handler: async (_args, context) => {
      state.context = context;
      if (state.assemblyInstallError) {
        notify(state, state.assemblyInstallError.message, "error");
        return;
      }
      const discovered = await state.bridge.discoverCurrent();
      if (!discovered.ok) {
        notify(state, discovered.error.message, "error");
        return;
      }
      const snapshot = discovered.value.snapshot();
      if (!snapshot.ok) {
        notify(state, snapshot.error.message, "error");
        return;
      }
      state.handle = discovered.value;
      publishSnapshot(state, snapshot.value);
      if (context.mode !== "tui") {
        const trustNotice = context.isProjectTrusted()
          ? undefined
          : "Project MCP sources are omitted until Pi project trust is granted.";
        notify(state, [trustNotice, formatSnapshot(state, snapshot.value)].filter(Boolean).join("\n"));
        return;
      }
      await openNativeMcpPanel({
        pi,
        context,
        handle: discovered.value,
        getCurrentHandle: () => state.handle,
        getCurrentSnapshot: () => state.snapshot,
        getProjectTrust: () => context.isProjectTrusted(),
        configAssembly: state.configAssembly,
        getRuntimePolicies: () => runtimePolicies(state),
        setPanelView: (view) => {
          if (view !== undefined || state.panelView?.handle === discovered.value) state.panelView = view;
        },
      });
    },
  });

  if (!state.assemblyInstallError) state.bridge.startSession();
  else notify(state, state.assemblyInstallError.message, "error");
  return state;
}

export function createMcpAdapter(options: McpAdapterOptions = {}): (pi: ExtensionAPI) => void {
  const factoryOptions: McpAdapterOptions = {
    ...(options.config === undefined ? {} : { config: cloneMcpConfig(options.config) }),
    ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
  };
  return (pi: ExtensionAPI) => {
    installAdapter(pi, factoryOptions);
  };
}

function waitForServerRemoval(handle: McpManagementHandle, name: string): Promise<void> {
  const current = handle.snapshot();
  if (!current.ok || !current.value.servers.some((server) => server.name === name)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let finished = false;
    let unsubscribe: (() => void) | undefined;
    const timer = setTimeout(() => finish(new Error(`Native MCP owner did not retract server "${name}" before timeout.`)), DISPOSE_TIMEOUT_MS);
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      unsubscribe?.();
      if (error) reject(error);
      else resolve();
    };
    const subscription = handle.subscribe((snapshot) => {
      if (!snapshot.servers.some((server) => server.name === name)) finish();
    });
    if (!subscription.ok) {
      finish(new Error(subscription.error.message));
      return;
    }
    unsubscribe = subscription.value;
    if (finished) unsubscribe();
  });
}

export function registerMcpServer(options: {
  pi: ExtensionAPI;
  name: string;
  definition: ServerEntry;
}): McpServerRegistration {
  const { pi, name, definition } = options;
  const state = adapters.get(pi);
  if (!state) throw new Error("pi-mcp-adapter is not installed for this Pi instance");
  if (state.assemblyInstallError) throw new Error(state.assemblyInstallError.message);
  if (typeof name !== "string" || name.trim() === "") throw new Error("MCP server name must be a non-empty string");
  if (state.registrations.has(name) || state.configAssembly.managedServerNames.has(name)) {
    throw new Error(`MCP server "${name}" is already registered`);
  }
  if (pi.getMcpServers().some((server) => server.name === name)) {
    throw new Error(`MCP server "${name}" is already registered`);
  }

  const mapped = mapRuntimeServer(name, definition);
  const registration: RuntimeServerRegistration = {
    executionPolicy: mapped.executionPolicy,
    appliedHandles: new WeakSet(),
  };
  pi.registerMcpServer(name, mapped.config);
  state.registrations.set(name, registration);
  if (state.snapshot) applyRuntimePolicies(state, state.snapshot);

  let disposal: Promise<void> | undefined;
  return {
    dispose: () => {
      if (disposal) return disposal;
      disposal = (async () => {
        const handle = state.handle;
        const removal = handle ? waitForServerRemoval(handle, name) : Promise.resolve();
        try {
          pi.unregisterMcpServer(name);
        } catch (error) {
          void removal.catch(() => undefined);
          throw error;
        }
        state.registrations.delete(name);
        await removal;
      })();
      return disposal;
    },
  };
}

export default createMcpAdapter();
