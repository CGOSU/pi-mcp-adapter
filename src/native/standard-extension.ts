import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { McpAdapterOptions, McpConfig, ServerEntry } from "../contracts/core.js";
import type { McpServerRegistration } from "./extension.ts";
import { getPiGlobalConfigPath, getProjectPiConfigPath } from "../config/paths.js";
import { mergeConfigs } from "../config/merge.js";
import { loadNativeConfigSources } from "./config-assembly.ts";
import { getStandardPresentationSettings, mapStandardServer, readStandardNativeConfiguration } from "./standard-config.ts";

const MODE_NOTICE = "Standard Pi MCP compatibility mode: Pi owns connections, tool names, output handling and OAuth. Use /mcp for live status and management. Adapter enhanced panel, credential backend and execution policies are unavailable; credentials are not migrated.";

interface StandardAdapterState {
  readonly owned: Map<string, { readonly configured: boolean }>;
  readonly reserved: Set<string>;
  context: ExtensionContext | undefined;
  active: boolean;
  nativeConfigurationAvailable: boolean;
}

const adapters = new WeakMap<ExtensionAPI, StandardAdapterState>();

export function supportsStandardMcp(pi: ExtensionAPI): boolean {
  return typeof pi.registerMcpServer === "function" && typeof pi.unregisterMcpServer === "function" && typeof pi.getMcpServers === "function";
}

export function hasStandardAdapter(pi: ExtensionAPI): boolean {
  return adapters.has(pi);
}

function report(state: StandardAdapterState, message: string, level: "info" | "warning" | "error" = "info"): void {
  if (state.context?.hasUI) state.context.ui.notify(message, level);
  else if (level === "error") console.error(`MCP adapter: ${message}`);
  else if (level === "warning") console.warn(`MCP adapter: ${message}`);
  else console.info(`MCP adapter: ${message}`);
}

function register(pi: ExtensionAPI, state: StandardAdapterState, name: string, config: McpServerConfig, configured: boolean): void {
  if (!state.active) throw new Error("The standard MCP adapter session has ended.");
  if (!state.nativeConfigurationAvailable) throw new Error("Native Pi MCP configuration could not be verified; registration is blocked.");
  if (state.reserved.has(name) || state.owned.has(name) || pi.getMcpServers().some((server) => server.name === name)) {
    throw new Error(`MCP server "${name}" is already registered or owned by native Pi configuration.`);
  }
  pi.registerMcpServer(name, config);
  state.owned.set(name, { configured });
}

function release(pi: ExtensionAPI, state: StandardAdapterState, name: string): void {
  if (!state.owned.has(name)) return;
  pi.unregisterMcpServer(name);
  state.owned.delete(name);
}

function loadConfiguration(pi: ExtensionAPI, state: StandardAdapterState, options: McpAdapterOptions, context: ExtensionContext): void {
  // Pi reads these files itself. Never import a lower-precedence copy of the same name.
  const nativePaths = new Set([getPiGlobalConfigPath(), getProjectPiConfigPath(context.cwd)].map((path) => resolve(path)));
  const native = readStandardNativeConfiguration(new Set([...nativePaths].filter((path) => context.isProjectTrusted() || path !== resolve(getProjectPiConfigPath(context.cwd)))));
  state.nativeConfigurationAvailable = native.ok;
  if (!native.ok) {
    report(state, `${native.error.code}: ${native.error.message}`, "error");
    return;
  }
  state.reserved.clear();
  for (const name of native.value.names) {
    state.reserved.add(name);
    if (state.owned.has(name)) {
      release(pi, state, name);
      report(state, `Adapter registration "${name}" was removed because native Pi configuration owns this name.`, "error");
    }
  }
  const nativeSettings = native.value.settings;
  let config: McpConfig = { mcpServers: {}, ...(options.config === undefined && nativeSettings !== undefined ? { settings: nativeSettings } : {}) };
  for (const source of loadNativeConfigSources(options, context.cwd)) {
    if (source.source.scope === "project" && !context.isProjectTrusted()) continue;
    if (nativePaths.has(resolve(source.source.readPath))) {
      if (source.config?.settings) config = mergeConfigs(config, { mcpServers: {}, settings: source.config.settings });
      continue;
    }
    if (source.error || source.validationIssues?.length) {
      report(state, `Adapter MCP source could not be imported safely (${source.error?.code ?? source.validationIssues?.[0]?.code}).`, "error");
      return;
    }
    if (source.config) config = mergeConfigs(config, source.config);
  }
  const presentationSettings = getStandardPresentationSettings(config.settings);
  if (presentationSettings.length) {
    report(state, `Standard Pi MCP mode: presentation settings are ignored because Pi controls the interface: ${presentationSettings.join(", ")}. Server configuration and execution policies are checked separately.`, "warning");
  }
  for (const [name, entry] of Object.entries(config.mcpServers)) {
    if (state.reserved.has(name)) continue;
    const mapped = mapStandardServer(name, entry, config.settings);
    if (!mapped.ok) {
      report(state, mapped.error.message, "error");
      continue;
    }
    try {
      register(pi, state, name, mapped.value, true);
    } catch {
      // Host errors may contain configuration values; do not copy them into notifications.
      report(state, `MCP server "${name}" could not be registered: ${state.owned.has(name) || pi.getMcpServers().some((server) => server.name === name) ? "already registered" : "the Pi host rejected registration"}.`, "error");
    }
  }
}

export function installStandardAdapter(pi: ExtensionAPI, options: McpAdapterOptions): void {
  if (adapters.has(pi)) return;
  const state: StandardAdapterState = { owned: new Map(), reserved: new Set(), context: undefined, active: true, nativeConfigurationAvailable: true };
  const native = readStandardNativeConfiguration(new Set([resolve(getPiGlobalConfigPath())]));
  if (!native.ok) throw new Error(`${native.error.code}: ${native.error.message}`);
  for (const name of native.value.names) state.reserved.add(name);
  adapters.set(pi, state);
  pi.on("session_start", (_event, context) => {
    state.context = context;
    for (const [name, registration] of state.owned) {
      if (registration.configured) release(pi, state, name);
    }
    report(state, MODE_NOTICE);
    try {
      loadConfiguration(pi, state, options, context);
    } catch {
      report(state, "Adapter MCP configuration could not be loaded safely; no additional sources will be imported.", "error");
    }
  });
  pi.on("session_shutdown", () => {
    state.active = false;
    for (const name of state.owned.keys()) {
      try {
        release(pi, state, name);
      } catch {
        report(state, `The Pi host rejected removal of MCP server "${name}" during shutdown.`, "error");
      }
    }
    state.context = undefined;
  });
  pi.registerCommand("mcp-adapter", {
    description: "Show Pi MCP compatibility mode and registered server names",
    handler: async (_args, context) => {
      state.context = context;
      report(state, `${MODE_NOTICE}\nAdapter registrations: ${[...state.owned.keys()].join(", ") || "none"}.`);
    },
  });
}

export function registerStandardMcpServer(pi: ExtensionAPI, name: string, definition: ServerEntry): McpServerRegistration {
  const state = adapters.get(pi);
  if (!state) throw new Error("pi-mcp-adapter is not installed for this Pi instance");
  const mapped = mapStandardServer(name, definition);
  if (!mapped.ok) throw new Error(`${mapped.error.code}: ${mapped.error.message}`);
  register(pi, state, name, mapped.value, false);
  const registration = state.owned.get(name);
  return {
    dispose: async () => {
      // A stale disposer must not remove a subsequent registration with the same name.
      if (state.owned.get(name) === registration) release(pi, state, name);
    },
  };
}
