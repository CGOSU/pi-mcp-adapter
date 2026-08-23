import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { McpExtensionState } from "./state.ts";
import type { DirectToolSpec, McpConfig } from "../contracts/core.ts";
import { buildProxyDescription, getMissingConfiguredDirectToolServers, prepareDirectToolArguments, resolveDirectTools } from "../tools/direct-tool-catalog.ts";
import { isServerInActiveFailureBackoff } from "./failure-backoff.ts";
import { createMetadataCatalogSnapshot, loadMetadataCache, parseDirectToolSelectors, type MetadataCatalogSnapshot } from "../catalog/metadata-cache.ts";
import { normalizeDirectToolInputSchema, truncateAtWord } from "../utils.ts";
import {
  createMcpDirectToolCallRenderer,
  type McpToolRenderOptions,
} from "../tools/tool-result-renderer.ts";
import { syncNamespaceProxyTools } from "../tools/namespace-tools.ts";

type DirectToolsModule = typeof import("../tools/direct-tools.ts");
type DirectToolExecute = (
  toolCallId: string,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<Record<string, unknown>> | undefined,
  ctx: ExtensionContext,
) => Promise<unknown>;
type RenderMcpToolResult = typeof import("../tools/tool-result-renderer.ts")["renderMcpToolResult"];
type NamespaceEnvOverride = ReturnType<typeof parseDirectToolSelectors> | null;

export interface ExtensionToolSurfaceDependencies {
  pi: ExtensionAPI;
  earlyConfig: McpConfig;
  envRaw: string | undefined;
  envDirectToolOverride: string[] | undefined;
  namespaceEnvOverride: NamespaceEnvOverride;
  toolRenderOptions: McpToolRenderOptions;
  toolRenderShell: "default" | "self";
  renderMcpToolResult: RenderMcpToolResult;
  getState: () => McpExtensionState | null;
  getInitPromise: () => Promise<McpExtensionState> | null;
  ensureMcpState: (signal?: AbortSignal) => Promise<McpExtensionState>;
  loadDirectToolsModule: () => Promise<DirectToolsModule>;
  activeFailureServers: () => Set<string>;
  registerProxyTool: (description: string) => void;
}

export interface DirectToolSurfaceSyncResult {
  specs: DirectToolSpec[];
  reservedDirectNames: Set<string>;
  activeDirectNames: Set<string>;
  added: string[];
  updated: string[];
  deactivated: string[];
}

export interface ExtensionToolSurface {
  applyDirectToolConfigChanges(changes: Map<string, true | string[] | false>): void;
  syncDirectTools(config: McpConfig, snapshot: MetadataCatalogSnapshot): DirectToolSurfaceSyncResult;
  syncNamespaceTools(
    config: McpConfig,
    snapshot: MetadataCatalogSnapshot,
    reservedDirectNames?: Set<string>,
    activeDirectNames?: Set<string>,
  ): void;
  syncProxyTool(config: McpConfig, snapshot: MetadataCatalogSnapshot, directSpecs: DirectToolSpec[]): void;
  syncToolSurface(ctx?: ExtensionContext): void;
}

export function createExtensionToolSurface(
  dependencies: ExtensionToolSurfaceDependencies,
): ExtensionToolSurface {
  const {
    pi,
    earlyConfig,
    envRaw,
    envDirectToolOverride,
    namespaceEnvOverride,
    toolRenderOptions,
    toolRenderShell,
    renderMcpToolResult,
    getState,
    getInitPromise,
    ensureMcpState,
    loadDirectToolsModule,
    activeFailureServers,
    registerProxyTool,
  } = dependencies;
  const registeredDirectTools = new Map<string, string>();
  const registeredNamespaceProxyTools = new Set<string>();
  const fallbackDeactivatedTools = new Set<string>();
  let proxyToolRegistered = false;
  let proxyToolDescription: string | null = null;

  const toToolParameters = (schema: Record<string, unknown>) =>
    typeof (Type as { Unsafe?: (value: never) => unknown }).Unsafe === "function"
      ? (Type as { Unsafe: (value: never) => unknown }).Unsafe(schema as never)
      : schema;

  function directToolFingerprint(spec: DirectToolSpec): string {
    return JSON.stringify({
      serverName: spec.serverName,
      originalName: spec.originalName,
      prefixedName: spec.prefixedName,
      description: spec.description,
      inputSchema: spec.inputSchema,
      resourceUri: spec.resourceUri,
      uiResourceUri: spec.uiResourceUri,
      uiStreamMode: spec.uiStreamMode,
    });
  }

  function createLazyDirectToolExecutor(spec: DirectToolSpec): DirectToolExecute {
    let executor: DirectToolExecute | null = null;
    let loading: Promise<DirectToolExecute> | null = null;
    return (...args: Parameters<DirectToolExecute>) => {
      if (executor) return executor(...args);
      loading ??= loadDirectToolsModule().then(({ createDirectToolExecutor }) => {
        const nextExecutor = createDirectToolExecutor(
          getState,
          getInitPromise,
          spec,
          (signal) => ensureMcpState(signal),
        );
        executor = nextExecutor;
        return nextExecutor;
      }).catch(error => {
        loading = null;
        throw error;
      });
      return loading.then(nextExecutor => nextExecutor(...args));
    };
  }

  function registerDirectTool(spec: DirectToolSpec, config: McpConfig): void {
    (pi.registerTool as (tool: unknown) => unknown)({
      name: spec.prefixedName,
      label: `MCP: ${spec.originalName}`,
      description: spec.description || "(no description)",
      promptSnippet: truncateAtWord(spec.description, 100) || `MCP tool from ${spec.serverName}`,
      parameters: toToolParameters(normalizeDirectToolInputSchema(spec.inputSchema)),
      ...(config.settings?.strictDirectToolArguments === true
        ? { prepareArguments: (args: unknown) => prepareDirectToolArguments(spec.inputSchema, args) }
        : {}),
      execute: createLazyDirectToolExecutor(spec),
      renderShell: toolRenderShell,
      renderCall: createMcpDirectToolCallRenderer(spec.prefixedName, toolRenderOptions),
      renderResult: renderMcpToolResult,
    });
  }

  function getActiveToolsIfReady(): string[] | undefined {
    try {
      return pi.getActiveTools?.();
    } catch (error) {
      if (error instanceof Error
        && error.message.includes("Action methods cannot be called during extension loading")) return undefined;
      throw error;
    }
  }

  function deactivateTools(toolNames: string[]): string[] {
    if (toolNames.length === 0) return [];
    const unregisterTool = (pi as ExtensionAPI & { unregisterTool?: (name: string) => boolean }).unregisterTool;
    const unregistered = toolNames.filter((toolName) => unregisterTool?.(toolName) === true);
    const fallbackNames = toolNames.filter((toolName) => !unregistered.includes(toolName));
    const remove = new Set(toolNames);
    const activeTools = getActiveToolsIfReady();
    if (!activeTools || activeTools.length === 0) {
      for (const toolName of fallbackNames) fallbackDeactivatedTools.add(toolName);
      return unregistered;
    }
    const nextActiveTools = activeTools.filter((name) => !remove.has(name));
    if (nextActiveTools.length !== activeTools.length) {
      for (const toolName of fallbackNames) fallbackDeactivatedTools.add(toolName);
      pi.setActiveTools(nextActiveTools);
    }
    return unregistered;
  }

  function syncDirectTools(config: McpConfig, snapshot: MetadataCatalogSnapshot): DirectToolSurfaceSyncResult {
    const reservedDirectNames = new Set<string>();
    const prefix = config.settings?.toolPrefix ?? "server";
    const specs = envRaw === "__none__"
      ? []
      : resolveDirectTools(config, snapshot.cache, prefix, envDirectToolOverride, activeFailureServers(), reservedDirectNames, snapshot);
    const nextNames = new Set(specs.map((spec) => spec.prefixedName));
    const added: string[] = [];
    const updated: string[] = [];
    const deactivated: string[] = [];

    for (const spec of specs) {
      const fingerprint = directToolFingerprint(spec);
      const previous = registeredDirectTools.get(spec.prefixedName);
      if (previous !== fingerprint) {
        registerDirectTool(spec, config);
        registeredDirectTools.set(spec.prefixedName, fingerprint);
        if (fallbackDeactivatedTools.delete(spec.prefixedName)) {
          const activeTools = getActiveToolsIfReady();
          if (activeTools && !activeTools.includes(spec.prefixedName)) {
            pi.setActiveTools([...activeTools, spec.prefixedName]);
          }
        }
        (previous ? updated : added).push(spec.prefixedName);
      }
    }

    for (const toolName of [...registeredDirectTools.keys()]) {
      if (nextNames.has(toolName)) continue;
      registeredDirectTools.delete(toolName);
      deactivated.push(toolName);
    }

    deactivateTools(deactivated);
    return { specs, reservedDirectNames, activeDirectNames: nextNames, added, updated, deactivated };
  }

  function syncNamespaceTools(
    config: McpConfig,
    snapshot: MetadataCatalogSnapshot,
    reservedDirectNames: Set<string> = new Set(registeredDirectTools.keys()),
    activeDirectNames: Set<string> = new Set(registeredDirectTools.keys()),
  ): void {
    const result = syncNamespaceProxyTools({
      config,
      cache: snapshot.cache,
      catalogSnapshot: snapshot,
      envOverride: namespaceEnvOverride,
      existingDirectNames: reservedDirectNames,
      activeDirectNames,
      existingNamespaceNames: registeredNamespaceProxyTools,
      unavailableServers: activeFailureServers(),
      pi,
      getState,
      ensureState: (signal) => ensureMcpState(signal),
      getInitPromise,
      getPiTools: () => pi.getAllTools(),
      renderOptions: toolRenderOptions,
      renderShell: toolRenderShell,
      renderResult: renderMcpToolResult,
    });
    for (const name of result.added) registeredNamespaceProxyTools.add(name);
    for (const name of result.deactivated) registeredNamespaceProxyTools.delete(name);
  }

  function applyDirectToolConfigChanges(changes: Map<string, true | string[] | false>): void {
    const state = getState();
    if (!state) return;
    for (const [serverName, value] of changes) {
      const definition = state.config.mcpServers[serverName];
      if (!definition) continue;
      state.config.mcpServers[serverName] = { ...definition, directTools: value };
    }
  }

  function syncProxyTool(config: McpConfig, snapshot: MetadataCatalogSnapshot, directSpecs: DirectToolSpec[]): void {
    const missingConfiguredDirectToolServers = getMissingConfiguredDirectToolServers(
      config,
      snapshot.cache,
      envRaw === undefined || envRaw === "__none__" ? undefined : envDirectToolOverride,
      snapshot,
    );
    const shouldRegisterProxyTool =
      config.settings?.disableProxyTool !== true
      || directSpecs.length === 0
      || missingConfiguredDirectToolServers.length > 0;

    if (shouldRegisterProxyTool) {
      const description = buildProxyDescription(config);
      if (!proxyToolRegistered || proxyToolDescription !== description) {
        registerProxyTool(description);
        proxyToolRegistered = true;
        proxyToolDescription = description;
        return;
      }
      const activeTools = getActiveToolsIfReady();
      if (activeTools && !activeTools.includes("mcp")) {
        pi.setActiveTools([...activeTools, "mcp"]);
      }
      return;
    }

    if (proxyToolRegistered) {
      const unregistered = deactivateTools(["mcp"]);
      if (unregistered.includes("mcp")) {
        proxyToolRegistered = false;
        proxyToolDescription = null;
      }
    }
  }

  function syncToolSurface(ctx?: ExtensionContext): void {
    const config = getState()?.config ?? earlyConfig;
    const snapshot = createMetadataCatalogSnapshot(config, loadMetadataCache());
    const result = syncDirectTools(config, snapshot);
    syncProxyTool(config, snapshot, result.specs);
    syncNamespaceTools(config, snapshot, result.reservedDirectNames, result.activeDirectNames);
    const changed = result.added.length + result.updated.length + result.deactivated.length;
    if (changed > 0 && ctx?.hasUI) {
      ctx.ui.notify(
        `MCP: direct tools refreshed (+${result.added.length}, ~${result.updated.length}, -${result.deactivated.length})`,
        "info",
      );
    }
  }

  return {
    applyDirectToolConfigChanges,
    syncDirectTools,
    syncNamespaceTools,
    syncProxyTool,
    syncToolSurface,
  };
}
