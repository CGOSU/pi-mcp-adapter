import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "./state.ts";
import type { McpAdapterOptions, McpConfig, PromptMetadata, ServerEntry } from "../contracts/core.ts";
import { Type } from "typebox";
import type { TSchema } from "typebox";
import { cloneMcpConfig, loadMcpConfig } from "../config/load.ts";
import { isServerInActiveFailureBackoff } from "./failure-backoff.ts";
import { getMissingConfiguredDirectToolServers } from "../tools/direct-tool-catalog.ts";

import { createMetadataCatalogSnapshot, loadMetadataCache, parseDirectToolSelectors, type MetadataCatalogSnapshot } from "../catalog/metadata-cache.ts";
import { createPromptCommand, resolveCachedPrompts } from "../tools/prompts.ts";
import { logger } from "../logger.ts";
import { formatTerminalError, getConfigPathFromArgv, truncateAtWord } from "../utils.ts";
import { createMcpProxyToolCallRenderer, createMcpScriptToolCallRenderer, createMcpToolResultRenderer, resolveMcpToolRenderOptions } from "../tools/tool-result-renderer.ts";
import { toolErrorOverride } from "../tools/error-signal.ts";
import { createMcpRuntimeOwner, createOwnedUi, isAbortError, type McpRuntimeOwner } from "./owner.ts";
import { publishMcpStatusShutdown } from "./status.ts";
import { createExtensionToolSurface } from "./tool-surface.ts";

export type { McpAdapterOptions, ServerEntry } from "../contracts/core.ts";
export {
  namespaceProxyName,
  parseMcpReference,
  resolveMcpToolReferences,
  type McpReferenceResolution,
  type ParsedMcpReference,
} from "../tools/mcp-references.ts";
export {
  MCP_STATUS_EVENT,
  MCP_STATUS_SNAPSHOT_VERSION,
  type McpServerRuntimeStatus,
  type McpServerStatusSnapshot,
  type McpStatusSnapshot,
} from "../contracts/status.ts";
export {
  MCP_TOOL_APPROVAL_REQUEST_EVENT,
  type McpToolApprovalDecision,
  type McpToolApprovalHandler,
  type McpToolApprovalOrigin,
  type McpToolApprovalRequest,
} from "../contracts/core.ts";

import {
  awaitWithTimeout,
  INIT_FAILURE_MESSAGE_MAX_CHARS,
  INIT_WAIT_TIMED_OUT,
  INIT_WAIT_TIMEOUT_MS,
  snapshotExtensionContext,
} from "./session.ts";

export interface McpServerRegistration {
  dispose(): Promise<void>;
}

// Routes runtime registrations to the adapter installed for a specific Pi
// instance, so a process with several adapters cannot cross-register.
const runtimeRegistrars = new WeakMap<ExtensionAPI, (name: string, definition: ServerEntry) => McpServerRegistration>();

type InitModule = typeof import("./initialization.ts");
type OAuthFlowModule = typeof import("../auth/mcp-auth-flow.ts");
type CommandsModule = typeof import("../commands/handlers.ts");
type ProxyModesModule = typeof import("../tools/proxy/dispatcher.ts");
type McpCodeModule = typeof import("../tools/mcp-code.ts");
type DirectToolsModule = typeof import("../tools/direct-tools.ts");
type ConfigWriteModule = typeof import("../config/write.ts");
type DirectToolExecute = (
  toolCallId: string,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<Record<string, unknown>> | undefined,
  ctx: ExtensionContext,
) => Promise<unknown>;

// TypeBox 1.x annotates raw objects passed to Type.Optional with an enumerable
// "~optional" key that survives serialization into provider tool schemas (Gemini
// rejects it with 400 INVALID_ARGUMENT). Prefer a real Type.Number schema; fall
// back to a plain raw schema for host TypeBox shims that omit Type.Number, since
// a property left out of `required` is optional by default.
function optionalNumber(options: { minimum?: number; description: string }): TSchema {
  const number = (Type as { Number?: (opts: typeof options) => TSchema }).Number;
  return typeof number === "function"
    ? Type.Optional(number(options))
    : ({ type: "number", ...options } as unknown as TSchema);
}

function parseEnvDirectToolOverride(raw: string | undefined): string[] | undefined {
  return raw?.split(",").map(s => s.trim()).filter(Boolean);
}

function resolveNamespaceEnvOverride(
  raw: string | undefined,
  selectors: string[] | undefined,
): ReturnType<typeof parseDirectToolSelectors> | null {
  if (raw === "__none__") return { servers: new Set<string>(), tools: new Map<string, Set<string>>() };
  return selectors ? parseDirectToolSelectors(selectors) : null;
}

function installMcpAdapter(pi: ExtensionAPI, options: McpAdapterOptions) {
  const sessionConfig = options.config !== undefined ? cloneMcpConfig(options.config) : undefined;
  const programmaticConfig = sessionConfig !== undefined;
  let state: McpExtensionState | null = null;
  let initPromise: Promise<McpExtensionState> | null = null;
  let currentOwner: McpRuntimeOwner | null = null;
  let currentInitializationContext: ExtensionContext | null = null;
  let lifecycleGeneration = 0;
  let retainedInitFailure: string | null = null;
  let initModulePromise: Promise<InitModule> | null = null;
  let oauthFlowModulePromise: Promise<OAuthFlowModule> | null = null;
  let commandsModulePromise: Promise<CommandsModule> | null = null;
  let proxyModesModulePromise: Promise<ProxyModesModule> | null = null;
  let mcpCodeModulePromise: Promise<McpCodeModule> | null = null;
  let directToolsModulePromise: Promise<DirectToolsModule> | null = null;
  let configWriteModulePromise: Promise<ConfigWriteModule> | null = null;

  const loadInitModule = (): Promise<InitModule> => initModulePromise ??= import("./initialization.ts");
  const loadOAuthFlowModule = (): Promise<OAuthFlowModule> => oauthFlowModulePromise ??= import("../auth/mcp-auth-flow.ts");
  const loadCommandsModule = (): Promise<CommandsModule> => commandsModulePromise ??= import("../commands/handlers.ts");
  const loadProxyModesModule = (): Promise<ProxyModesModule> => proxyModesModulePromise ??= import("../tools/proxy/dispatcher.ts");
  const loadMcpCodeModule = (): Promise<McpCodeModule> => mcpCodeModulePromise ??= import("../tools/mcp-code.ts");
  const loadDirectToolsModule = (): Promise<DirectToolsModule> => directToolsModulePromise ??= import("../tools/direct-tools.ts");
  const loadConfigWriteModule = (): Promise<ConfigWriteModule> => configWriteModulePromise ??= import("../config/write.ts");

  function retainInitFailure(error: unknown): string {
    const message = truncateAtWord(formatTerminalError(error), INIT_FAILURE_MESSAGE_MAX_CHARS);
    retainedInitFailure = message;
    return message;
  }

  function clearRetainedInitFailure(): void {
    retainedInitFailure = null;
  }

  function buildInitRetryInstruction(prefix: string, failure: string | null = retainedInitFailure): string {
    const retry = "Fix the MCP server configuration or startup failure, then call mcp(...) again to retry initialization.";
    return failure ? `${prefix}: ${failure}. ${retry}` : `${prefix}. ${retry}`;
  }

  function isOwnerAbortError(error: unknown, owner: McpRuntimeOwner): boolean {
    if (!owner.signal.aborted) return isAbortError(error);
    const reason = owner.signal.reason;
    if (reason instanceof Error && reason.message === "MCP initialization failed" && error !== reason) {
      return isAbortError(error);
    }
    return true;
  }

  function startGatewayRetryInitialization(ctx: ExtensionContext): void {
    const generation = ++lifecycleGeneration;
    const owner = createMcpRuntimeOwner();
    currentOwner = owner;
    currentInitializationContext = snapshotExtensionContext(ctx);
    state = null;
    startInitialization(ctx, owner, generation, "stale_gateway_retry_initialization");
  }

  async function shutdownState(currentState: McpExtensionState | null, reason: string): Promise<void> {
    if (!currentState) {
      publishMcpStatusShutdown(pi.events);
      return;
    }

    publishMcpStatusShutdown(currentState.statusEvents);

    if (currentState.uiServer) {
      currentState.uiServer.close(reason);
      currentState.uiServer = null;
    }

    let flushError: unknown;
    try {
      const { flushMetadataCache } = await loadInitModule();
      flushMetadataCache(currentState);
    } catch (error) {
      flushError = error;
    }

    try {
      if (currentState.owner) {
        await currentState.owner.stop(reason);
      } else {
        await currentState.lifecycle.gracefulShutdown();
      }
    } catch (error) {
      if (flushError) {
        console.error(`MCP: graceful shutdown failed after metadata flush error: ${formatTerminalError(error)}`);
      } else {
        throw error;
      }
    }

    if (flushError) {
      throw flushError;
    }
  }

  const earlyConfigPath = programmaticConfig
    ? undefined
    : options.configPath ?? getConfigPathFromArgv();
  const earlyConfig = programmaticConfig
    ? cloneMcpConfig(sessionConfig)
    : loadMcpConfig(earlyConfigPath);
  const earlyCatalogSnapshot = createMetadataCatalogSnapshot(earlyConfig, loadMetadataCache());
  const envRaw = process.env.MCP_DIRECT_TOOLS;
  const envDirectToolOverride = parseEnvDirectToolOverride(envRaw);
  const namespaceEnvOverride = resolveNamespaceEnvOverride(envRaw, envDirectToolOverride);
  const toolRenderOptions = resolveMcpToolRenderOptions(earlyConfig.settings);
  const toolRenderShell = toolRenderOptions.resultRendering === "compact" ? "self" : "default";
  const renderMcpToolResult = createMcpToolResultRenderer(toolRenderOptions);
  let directToolsFrozen = false;
  // Session/runtime scoped server registrations from other extensions. They
  // survive session restarts within this install and die with the process.
  const runtimeServers = new Map<string, ServerEntry>();

  // Mirrors init's per-server lifecycle registration so runtime servers get
  // idle cleanup and keep-alive health recovery like configured servers.
  function attachRuntimeServerLifecycle(targetState: McpExtensionState, name: string, definition: ServerEntry): void {
    const lifecycleMode = definition.lifecycle ?? "lazy";
    const persistsAfterFirstSpawn = lifecycleMode === "eager" || lifecycleMode === "lazy-keep-alive";
    const idleOverride = definition.idleTimeout ?? (persistsAfterFirstSpawn ? 0 : undefined);
    targetState.lifecycle.registerServer(name, definition, idleOverride !== undefined ? { idleTimeout: idleOverride } : undefined);
    if (lifecycleMode === "keep-alive") targetState.lifecycle.markKeepAlive(name, definition);
  }

  const toolSurface = createExtensionToolSurface({
    pi,
    earlyConfig,
    envRaw,
    envDirectToolOverride,
    namespaceEnvOverride,
    toolRenderOptions,
    toolRenderShell,
    renderMcpToolResult,
    getState: () => state,
    getInitPromise: () => initPromise,
    ensureMcpState: (signal) => ensureMcpState(signal),
    loadDirectToolsModule,
    activeFailureServers: () => {
      const currentState = state;
      if (!currentState) return new Set();
      return new Set(Object.keys(currentState.config.mcpServers).filter((serverName) => isServerInActiveFailureBackoff(currentState, serverName)));
    },
    registerProxyTool,
  });

  function applyDirectToolConfigChanges(changes: Map<string, true | string[] | false>): void {
    toolSurface.applyDirectToolConfigChanges(changes);
  }

  function syncToolSurface(ctx?: ExtensionContext): void {
    toolSurface.syncToolSurface(ctx);
  }

  const registeredPromptCommands = new Set<string>();

  function registerPromptCommands(specs: Iterable<PromptMetadata>): void {
    for (const spec of specs) {
      if (registeredPromptCommands.has(spec.commandName)) {
        logger.debug(`MCP: prompt "${spec.originalName}" on ${spec.serverName} skipped; /${spec.commandName} is already registered`);
        continue;
      }
      registeredPromptCommands.add(spec.commandName);
      pi.registerCommand(spec.commandName, createPromptCommand(pi, () => state, spec, (signal) => ensureMcpState(signal)));
    }
  }

  function syncPromptCommands(): void {
    registerPromptCommands([...(state?.promptMetadata?.values() ?? [])].flat());
  }

  registerPromptCommands(resolveCachedPrompts(earlyConfig, earlyCatalogSnapshot));

  runtimeRegistrars.set(pi, (name: string, definition: ServerEntry): McpServerRegistration => {
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error("MCP server name must be a non-empty string");
    }
    if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
      throw new Error(`MCP server definition for "${name}" must be an object`);
    }
    const effective = state?.config ?? earlyConfig;
    if (runtimeServers.has(name) || Object.hasOwn(effective.mcpServers, name)) {
      throw new Error(`MCP server "${name}" is already registered`);
    }
    // Runtime-registered servers are proxy-tool-only: direct tools are frozen
    // at startup and must not be rebuilt for late registrations.
    const entry: ServerEntry = { ...structuredClone(definition), directTools: false };
    runtimeServers.set(name, entry);
    const registeredState = state;
    if (registeredState) {
      registeredState.config.mcpServers[name] = entry;
      attachRuntimeServerLifecycle(registeredState, name, entry);
      syncToolSurface();
      void updateMcpStatus(registeredState).catch(error => {
        console.error(`MCP: failed to update status after runtime registration: ${formatTerminalError(error)}`);
      });
    }
    let disposed = false;
    return {
      dispose: async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        runtimeServers.delete(name);
        const currentState = state;
        if (!currentState || currentState.config.mcpServers[name] !== entry) return;
        delete currentState.config.mcpServers[name];
        currentState.lifecycle.unregisterServer(name);
        await currentState.manager.close(name);
        syncToolSurface();
        await updateMcpStatus(currentState);
      },
    };
  });

  const getPiTools = (): ToolInfo[] => pi.getAllTools();

  async function updateMcpStatus(targetState: McpExtensionState): Promise<void> {
    const { updateStatusBar } = await loadInitModule();
    updateStatusBar(targetState);
  }

  pi.registerFlag("mcp-config", {
    description: "Path to MCP config file",
    type: "string",
  });

  function startInitialization(ctx: ExtensionContext, owner: McpRuntimeOwner, generation: number, staleReason: string): Promise<void> {
    const initializationContext = snapshotExtensionContext(ctx);
    if (currentOwner === owner) currentInitializationContext = initializationContext;
    owner.addCleanup(async () => {
      const { cleanupMaterializedBinaryResources } = await import("../tools/tool-registrar.ts");
      cleanupMaterializedBinaryResources(owner.signal);
    });

    const promise = Promise.all([loadOAuthFlowModule(), loadInitModule()]).then(([oauthFlow, initModule]) => {
      const oauthRuntime = oauthFlow.createOAuthRuntime(owner.signal);
      owner.addCleanup(() => oauthFlow.shutdownOAuth(oauthRuntime));
      return initModule.initializeMcp(pi, initializationContext, owner, {
        ...(programmaticConfig || options.configPath !== undefined
          ? {
              ...(earlyConfigPath !== undefined ? { configPath: earlyConfigPath } : {}),
              ...(sessionConfig !== undefined ? { config: sessionConfig } : {}),
            }
          : {}),
        oauthRuntime,
      });
    });
    initPromise = promise;

    return promise.then(async (nextState) => {
      if (!owner.isActive() || generation !== lifecycleGeneration || initPromise !== promise) {
        try {
          await shutdownState(nextState, staleReason);
        } catch (error) {
          console.error(`MCP: failed to clean stale initialization state: ${formatTerminalError(error)}`);
        }
        return;
      }

      state = nextState;
      clearRetainedInitFailure();
      for (const [name, definition] of runtimeServers) {
        if (Object.hasOwn(nextState.config.mcpServers, name)) {
          console.error(`MCP: runtime-registered server "${name}" now collides with a configured server; keeping the configured server`);
          continue;
        }
        nextState.config.mcpServers[name] = definition;
        attachRuntimeServerLifecycle(nextState, name, definition);
      }
      nextState.onToolMetadataUpdated = (_serverName, _reason) => {
        if (state !== nextState || !owner.isActive()) return;
        syncPromptCommands();
        if (directToolsFrozen) {
          logger.debug(`MCP: metadata update for ${_serverName} (${_reason}) skipped — directTools frozen`);
          return;
        }
        syncToolSurface(initializationContext);
      };
      syncPromptCommands();
      syncToolSurface(initializationContext);
      // A connected snapshot is readiness-like external state. Publish it only
      // after Pi's model-facing direct-tool surface reflects live metadata.
      nextState.statusEvents = pi.events;
      await updateMcpStatus(nextState);
      initPromise = null;
      if (earlyConfig.settings?.freezeDirectTools === true) {
        directToolsFrozen = true;
        logger.info("MCP: direct tools frozen after initial sync — reconnects won't rebuild the system prompt; use mcp({ connect: \"server\" }) to rediscover");
      }
    }).catch(async err => {
      if (!owner.isActive() || generation !== lifecycleGeneration) {
        return;
      }
      if (initPromise !== promise && initPromise !== null) {
        return;
      }
      const message = retainInitFailure(err);
      console.error(`MCP initialization failed: ${message}`);
      initPromise = null;
      if (state) return;

      try {
        await owner.stop("MCP initialization failed");
      } catch (error) {
        console.error(`MCP: failed to clean rejected initialization: ${formatTerminalError(error)}`);
      }
    });
  }

  function ensureMcpState(signal?: AbortSignal, context?: ExtensionContext): Promise<McpExtensionState> {
    if (state) return Promise.resolve(state);
    if (initPromise) return initPromise;

    if (retainedInitFailure) {
      startGatewayRetryInitialization(snapshotExtensionContext(
        context ?? currentInitializationContext ?? undefined,
        signal,
      ));
      return initPromise!;
    }

    let owner = currentOwner;
    let generation = lifecycleGeneration;
    if (!owner?.isActive()) {
      owner = createMcpRuntimeOwner();
      currentOwner = owner;
      generation = ++lifecycleGeneration;
    }
    const initializationContext = snapshotExtensionContext(
      context ?? currentInitializationContext ?? undefined,
      signal,
    );
    currentInitializationContext = initializationContext;
    startInitialization(initializationContext, owner, generation, "stale_deferred_initialization");
    return initPromise!;
  }

  function hasValidMetadataCache(config: McpConfig, snapshot: MetadataCatalogSnapshot): boolean {
    if (!snapshot.cache) return false;
    return Object.entries(config.mcpServers).every(([serverName, definition]) => (
      definition.disabled === true || snapshot.validEntries.has(serverName)
    ));
  }

  function shouldInitializeOnSessionStart(): boolean {
    if (runtimeServers.size > 0) return true;
    const hasStartupServer = Object.values(earlyConfig.mcpServers).some((definition) => {
      if (definition.disabled === true) return false;
      return definition.lifecycle === "eager" || definition.lifecycle === "keep-alive";
    });
    if (hasStartupServer) return true;

    const snapshot = createMetadataCatalogSnapshot(earlyConfig, loadMetadataCache());
    if (!hasValidMetadataCache(earlyConfig, snapshot)) return true;
    if (envRaw !== undefined && envRaw !== "__none__") {
      return getMissingConfiguredDirectToolServers(earlyConfig, snapshot.cache, envDirectToolOverride, snapshot).length > 0;
    }
    return false;
  }

  function startLoadTimeInitialization(): void {
    const hasStartupServer = Object.values(earlyConfig.mcpServers).some((definition) => {
      if (definition.disabled === true) return false;
      return definition.lifecycle === "eager" || definition.lifecycle === "keep-alive";
    });
    if (!hasStartupServer) return;
    setImmediate(() => {
      if (lifecycleGeneration !== 0 || state || initPromise) return;
      const generation = ++lifecycleGeneration;
      const owner = createMcpRuntimeOwner();
      currentOwner = owner;
      const context = snapshotExtensionContext(undefined);
      currentInitializationContext = context;
      startInitialization(context, owner, generation, "stale_load_time_initialization");
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    const generation = ++lifecycleGeneration;
    const previousState = state;
    const previousOwner = currentOwner;
    const owner = createMcpRuntimeOwner();
    currentOwner = owner;
    currentInitializationContext = snapshotExtensionContext(ctx);
    state = null;
    initPromise = null;
    clearRetainedInitFailure();

    // Abort synchronously before awaiting cleanup so old callbacks and startup
    // work cannot resume into a stale ExtensionContext.
    const stopPrevious = previousOwner?.stop("MCP extension session restarted") ?? Promise.resolve();
    try {
      await Promise.all([
        stopPrevious,
        shutdownState(previousState, "session_restart"),
      ]);
    } catch (error) {
      console.error(`MCP: failed to shut down previous session state: ${formatTerminalError(error)}`);
    }

    if (generation !== lifecycleGeneration || !owner.isActive()) return;

    const initialization = shouldInitializeOnSessionStart()
      ? startInitialization(currentInitializationContext, owner, generation, "stale_session_start")
      : null;
    if (initialization && envRaw !== undefined && envRaw !== "__none__") {
      const missingEnvDirectTools = getMissingConfiguredDirectToolServers(
        earlyConfig,
        loadMetadataCache(),
        envDirectToolOverride,
      );
      if (missingEnvDirectTools.length > 0) {
        await initialization;
      }
    }
  });

  pi.on("input", async () => {
    const inputOwner = currentOwner;
    if (!inputOwner?.isActive()) return;

    if (!state && initPromise) {
      try {
        await awaitWithTimeout(initPromise, INIT_WAIT_TIMEOUT_MS);
      } catch {
        return;
      }
    }

    const inputState = state;
    if (!inputState || !inputOwner.isActive()) return;
    try {
      await inputState.lifecycle.ensureConverged(inputOwner.signal);
    } catch (error) {
      if (!isAbortError(error, inputOwner.signal)) {
        logger.debug(`MCP: keep-alive convergence failed before input: ${formatTerminalError(error)}`);
      }
    }
  });

  pi.on("session_shutdown", async () => {
    ++lifecycleGeneration;
    const currentState = state;
    const owner = currentOwner;
    currentOwner = null;
    currentInitializationContext = null;
    state = null;
    initPromise = null;
    clearRetainedInitFailure();

    // Abort before awaiting cleanup so delayed initialization cannot touch stale
    // Pi context after session shutdown.
    const stopOwner = owner?.stop("MCP extension session shutdown") ?? Promise.resolve();
    try {
      await Promise.all([
        stopOwner,
        shutdownState(currentState, "session_shutdown"),
      ]);
    } catch (error) {
      console.error(`MCP: session shutdown cleanup failed: ${formatTerminalError(error)}`);
    }
  });

  // Re-flag returned MCP tool failures so pi registers them as errors (see toolErrorOverride).
  pi.on("tool_result", (event) => toolErrorOverride(event.details));

  const registerMcpCommand = (commandName: string) => pi.registerCommand(commandName, {
    description: "Show MCP server status",
    getArgumentCompletions: (prefix: string) => {
      const normalized = prefix.trimStart();
      const argumentMatch = normalized.match(/^(\S+)\s+(.*)$/);
      if (!argumentMatch) {
        const subcommands = [
          { value: "reconnect", label: "reconnect — Reconnect servers" },
          { value: "tools", label: "tools — List all tools" },
          { value: "prompts", label: "prompts — List all MCP prompts" },
          { value: "setup", label: "setup — Configure MCP servers" },
          { value: "logout", label: "logout — Clear server credentials" },
          { value: "token", label: "token — Manage stored bearer tokens" },
          { value: "disable", label: "disable — Disable a server" },
          { value: "enable", label: "enable — Enable a server" },
          { value: "status", label: "status — Show server status" },
        ].filter(({ value }) => value.startsWith(normalized));
        return subcommands.length > 0 ? subcommands : null;
      }

      const [, subcommand, argumentPrefix] = argumentMatch;
      if (
        (subcommand !== "reconnect" && subcommand !== "logout" && subcommand !== "disable" && subcommand !== "enable" && subcommand !== "token")
        || argumentPrefix === undefined
        || !state
      ) return null;

      if (subcommand === "token") {
        const tokenMatch = argumentPrefix.trimStart().match(/^(set|remove|status)\s+(.*)$/);
        if (!tokenMatch) {
          const actions = ["set", "remove", "status"]
            .filter(action => action.startsWith(argumentPrefix.trimStart()))
            .map(action => ({ value: `token ${action} `, label: `${action} — Bearer token ${action}` }));
          return actions.length > 0 ? actions : null;
        }
        const action = tokenMatch[1] ?? "";
        const serverPrefix = tokenMatch[2] ?? "";
        const servers = Object.keys(state.config.mcpServers)
          .filter(serverName => serverName.startsWith(serverPrefix.trimStart()))
          .map(serverName => ({ value: `token ${action} ${serverName}`, label: serverName }));
        return servers.length > 0 ? servers : null;
      }

      const servers = Object.keys(state.config.mcpServers)
        .filter((serverName) => serverName.startsWith(argumentPrefix.trimStart()))
        .map((serverName) => ({ value: `${subcommand} ${serverName}`, label: serverName }));
      return servers.length > 0 ? servers : null;
    },
    handler: async (args, ctx) => {
      const commandOwner = currentOwner;
      const commandReload = typeof ctx.reload === "function" ? ctx.reload.bind(ctx) : async () => {};
      const commandHasUI = ctx.hasUI;
      const commandCtx = {
        hasUI: commandHasUI,
        ui: commandHasUI
          ? commandOwner ? createOwnedUi(ctx.ui, commandOwner) : ctx.ui
          : undefined,
        cwd: ctx.cwd,
        mode: ctx.mode,
        signal: commandOwner?.signal ?? ctx.signal,
      } as unknown as ExtensionContext;
      if (!state) {
        try {
          state = await ensureMcpState(commandCtx.signal, commandCtx);
          commandOwner?.throwIfInactive();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (commandCtx.hasUI) commandCtx.ui?.notify(`MCP initialization failed: ${message}`, "error");
          return;
        }
      }
      if (!state) {
        if (commandCtx.hasUI) commandCtx.ui?.notify("MCP not initialized", "error");
        return;
      }

      const {
        showStatus,
        showTools,
        showPrompts,
        reconnectServer,
        reconnectServers,
        authenticateServer,
        logoutServer,
        manageBearerToken,
        openMcpAuthPanel,
        openMcpPanel,
        openMcpSetup,
      } = await loadCommandsModule();
      const parts = args?.trim()?.split(/\s+/) ?? [];
      const subcommand = parts[0] ?? "";
      const targetServer = parts[1];
      const rest = parts.slice(1).join(" ");

      switch (subcommand) {
        case "reconnect":
          commandOwner?.throwIfInactive();
          await reconnectServers(state, commandCtx, targetServer);
          if (directToolsFrozen) syncToolSurface(commandCtx);
          break;
        case "tools":
          await showTools(state, commandCtx);
          break;
        case "prompts":
          await showPrompts(state, commandCtx);
          break;
        case "setup": {
          commandOwner?.throwIfInactive();
          if (programmaticConfig) {
            commandCtx.ui?.notify("MCP setup is unavailable when config is supplied by createMcpAdapter().", "info");
            break;
          }
          const result = await openMcpSetup(state, pi, commandCtx, earlyConfigPath, "setup");
          if (result?.configChanged) {
            commandOwner?.throwIfInactive();
            await commandReload();
            return;
          }
          break;
        }
        case "logout": {
          const serverName = rest;
          if (!serverName) {
            if (commandCtx.hasUI) commandCtx.ui?.notify("Usage: /mcp logout <server>", "error");
            return;
          }
          commandOwner?.throwIfInactive();
          await logoutServer(serverName, state, commandCtx);
          break;
        }
        case "token": {
          const action = parts[1];
          const serverName = parts.slice(2).join(" ");
          if (action !== "set" && action !== "remove" && action !== "status") {
            if (commandCtx.hasUI) commandCtx.ui?.notify("Usage: /mcp token set|remove|status <server>", "error");
            return;
          }
          if (!serverName) {
            if (commandCtx.hasUI) commandCtx.ui?.notify("Usage: /mcp token set|remove|status <server>", "error");
            return;
          }
          commandOwner?.throwIfInactive();
          await manageBearerToken(action, serverName, state, commandCtx);
          break;
        }
        case "disable":
        case "enable": {
          const serverName = rest;
          if (programmaticConfig) {
            commandCtx.ui?.notify(`/mcp ${subcommand} is unavailable when config is supplied by createMcpAdapter().`, "info");
            break;
          }
          if (!serverName) {
            commandCtx.ui?.notify(`Usage: /mcp ${subcommand} <server>`, "error");
            break;
          }
          if (!state.config.mcpServers[serverName]) {
            commandCtx.ui?.notify(`Server "${serverName}" not found in effective config`, "error");
            break;
          }
          commandOwner?.throwIfInactive();
          const { writeProjectServerDisabledOverride } = await loadConfigWriteModule();
          const result = writeProjectServerDisabledOverride(earlyConfigPath, commandCtx.cwd, serverName, subcommand === "disable");
          if (result.changed) {
            commandCtx.ui?.notify(`${subcommand === "disable" ? "Disabled" : "Enabled"} server "${serverName}" in ${result.path} — run /reload to apply`, "info");
          } else {
            commandCtx.ui?.notify(`Server "${serverName}" is already ${subcommand === "disable" ? "disabled" : "enabled"}`, "info");
          }
          break;
        }
        case "status":
        case "":
        default:
          if (commandCtx.hasUI) {
            commandOwner?.throwIfInactive();
            if (programmaticConfig) {
              commandCtx.ui?.notify("MCP status is shown from the in-memory SDK config; configuration discovery is unavailable.", "info");
              await showStatus(state, commandCtx);
              break;
            }
            const result = await openMcpPanel(state, pi, commandCtx, earlyConfigPath, (changes) => {
              applyDirectToolConfigChanges(changes);
              syncToolSurface(commandCtx);
            });
            if (result?.configChanged) {
              commandOwner?.throwIfInactive();
              await commandReload();
              return;
            }
          } else {
            await showStatus(state, commandCtx);
          }
          break;
      }
    },
  });
  registerMcpCommand("mcp");
  registerMcpCommand("pi-mcp");

  pi.registerCommand("mcp-auth", {
    description: "Authenticate with an MCP server (OAuth)",
    handler: async (args, ctx) => {
      const commandOwner = currentOwner;
      const commandHasUI = ctx.hasUI;
      const commandCtx = {
        hasUI: commandHasUI,
        ui: commandHasUI
          ? commandOwner ? createOwnedUi(ctx.ui, commandOwner) : ctx.ui
          : undefined,
        cwd: ctx.cwd,
        mode: ctx.mode,
        signal: commandOwner?.signal ?? ctx.signal,
      } as unknown as ExtensionContext;
      const serverName = args?.trim();
      if (!serverName && !commandCtx.hasUI) {
        return;
      }

      if (!state) {
        try {
          state = await ensureMcpState(commandCtx.signal, commandCtx);
          commandOwner?.throwIfInactive();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (commandCtx.hasUI) commandCtx.ui?.notify(`MCP initialization failed: ${message}`, "error");
          return;
        }
      }
      if (!state) {
        if (commandCtx.hasUI) commandCtx.ui?.notify("MCP not initialized", "error");
        return;
      }

      const { authenticateServer, reconnectServer, openMcpAuthPanel } = await loadCommandsModule();
      if (!serverName) {
        if (programmaticConfig) {
          commandCtx.ui?.notify("Use /mcp-auth <server> to authenticate a server from the in-memory SDK config.", "info");
          return;
        }
        await openMcpAuthPanel(state, pi, commandCtx, earlyConfigPath);
        return;
      }

      const result = await authenticateServer(serverName, state.config, commandCtx, commandCtx.signal, state.oauthRuntime);
      if (result.ok) {
        commandOwner?.throwIfInactive();
        await reconnectServer(state, commandCtx, serverName);
      }
    },
  });

  if (earlyConfig.settings?.scriptMode !== false) {
    (pi.registerTool as (tool: unknown) => unknown)({
      name: "mcpScript",
      label: "MCP Script",
      description: "Run trusted JavaScript that makes multiple MCP tool calls in one request — loop, filter, chain, or fan out between calls. For a single MCP call, search, describe, status check, or auth action, use the mcp tool instead. Discover with await tools.search({ query }) — resolves to { items: [{ path, name, server, description? }], total, hasMore, nextOffset }, not an { ok, data } envelope. Inspect with await tools.describe({ path }) — resolves to the tool descriptor with inputTypeScript, or { path, error: { code, message, suggestions } }. Then call tools.call(path, args) — resolves to { ok: true, data } or { ok: false, error: { code, message } } — or use direct flat calls when the name is already known; use emit(value) for user-visible output. Load the mcp-scripting skill for the full workflow guide.",
      promptSnippet: "Batch multiple MCP tool calls in one JavaScript request (loop, filter, chain)",
      parameters: Type.Object({
        code: Type.String({ description: "Trusted JavaScript MCP script. Use tools.<prefixedToolName>(args) and emit(value)." }),
        timeoutMs: optionalNumber({ minimum: 1, description: "Execution timeout in milliseconds (default: 30000)" }),
      }),
      renderCall: createMcpScriptToolCallRenderer(toolRenderOptions),
      renderResult: renderMcpToolResult,
      async execute(_toolCallId: string, params: { code: string; timeoutMs?: number }, signal: AbortSignal | undefined) {
        const executeOwner = currentOwner;
        let initialization = initPromise;
        if (!state && !initialization) {
          try {
            initialization = ensureMcpState(signal);
          } catch (error) {
            if (executeOwner && isOwnerAbortError(error, executeOwner)) throw error;
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text" as const, text: `MCP initialization failed: ${message}` }],
              details: { mode: "script", error: "init_failed", message },
            };
          }
        }
        if (!state && initialization) {
          try {
            const initialized = await awaitWithTimeout(initialization, INIT_WAIT_TIMEOUT_MS);
            if (initialized === INIT_WAIT_TIMED_OUT) {
              return {
                content: [{ type: "text" as const, text: "MCP initialization is still in progress. Try again shortly." }],
                details: { mode: "script", error: "init_timeout", timeoutMs: INIT_WAIT_TIMEOUT_MS },
              };
            }
            executeOwner?.throwIfInactive();
            state = initialized;
          } catch (error) {
            if (executeOwner && isOwnerAbortError(error, executeOwner)) throw error;
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text" as const, text: `MCP initialization failed: ${message}` }],
              details: { mode: "script", error: "init_failed", message },
            };
          }
        }
        if (!state) {
          return {
            content: [{ type: "text" as const, text: retainedInitFailure
              ? buildInitRetryInstruction("MCP is not initialized after an earlier initialization failure")
              : "MCP not initialized" }],
            details: { mode: "script", error: "not_initialized", ...(retainedInitFailure ? { message: retainedInitFailure } : {}) },
          };
        }
        executeOwner?.throwIfInactive();
        const { runMcpScript } = await loadMcpCodeModule();
        return runMcpScript(state, params.code, params.timeoutMs, getPiTools, signal);
      },
    });
  }

  function registerProxyTool(description: string): void {
    (pi.registerTool as (tool: unknown) => unknown)({
      name: "mcp",
      label: "MCP",
      description,
      promptSnippet: "MCP gateway — status, search, describe, auth, and single MCP tool calls",
      renderShell: toolRenderShell,
      renderCall: createMcpProxyToolCallRenderer(toolRenderOptions),
      parameters: Type.Object({
        tool: Type.Optional(Type.String({ description: "Tool name to call (e.g., 'xcodebuild_list_sims')" })),
        args: Type.Optional(Type.Union([
          Type.String({ description: "Arguments as a JSON string (e.g., '{\"key\": \"value\"}')" }),
          Type.Object({}, {
            additionalProperties: true,
            description: 'Arguments as a JSON object (e.g., { "key": "value" })',
          }),
        ], { description: "Tool arguments as a JSON object, or as a JSON string encoding one" })),
        connect: Type.Optional(Type.String({ description: "Server name to connect (lazy connect + metadata refresh)" })),
        describe: Type.Optional(Type.String({ description: "Tool name to describe (shows parameters)" })),
        instructions: Type.Optional(Type.String({ description: "Server name to show that server's usage instructions" })),
        search: Type.Optional(Type.String({ description: "Search tools by name/description" })),
        regex: Type.Optional(Type.Boolean({ description: "Treat search as regex (default: substring match)" })),
        includeSchemas: Type.Optional(Type.Boolean({ description: "Include parameter schemas in search results (default: true)" })),
        limit: optionalNumber({ minimum: 1, description: "Maximum search results to return (default: 12)" }),
        offset: optionalNumber({ minimum: 0, description: "Search result offset (default: 0)" }),
        server: Type.Optional(Type.String({ description: "Filter to specific server (also disambiguates tool calls)" })),
        action: Type.Optional(Type.String({ description: "Action: 'ui-messages', 'auth-start', or 'auth-complete'" })),
      }),
      renderResult: renderMcpToolResult,
      async execute(_toolCallId: string, params: {
        tool?: string;
        args?: string | Record<string, unknown>;
        connect?: string;
        describe?: string;
        instructions?: string;
        search?: string;
        regex?: boolean;
        includeSchemas?: boolean;
        limit?: number;
        offset?: number;
        server?: string;
        action?: string;
      }, signal: AbortSignal | undefined, _onUpdate: AgentToolUpdateCallback<Record<string, unknown>> | undefined, _ctx: ExtensionContext) {
        let executeOwner = currentOwner;
        const parseArgs = (value: string | Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
          if (value === undefined || value === "") return undefined;
          let args: unknown;
          if (typeof value === "string") {
            try {
              args = JSON.parse(value);
            } catch (error) {
              if (error instanceof SyntaxError) {
                throw new Error(`Invalid args JSON: ${error.message}`, { cause: error });
              }
              throw error;
            }
          } else {
            args = value;
          }

          if (typeof args !== "object" || args === null || Array.isArray(args)) {
            const gotType = Array.isArray(args) ? "array" : args === null ? "null" : typeof args;
            throw new Error(`Invalid args: expected a JSON object, got ${gotType}`);
          }
          return args as Record<string, unknown>;
        };
        const parsedArgs = parseArgs(params.args);
        const hasGatewayMode = (value: typeof params): boolean =>
          value.tool !== undefined
          || value.connect !== undefined
          || value.describe !== undefined
          || value.instructions !== undefined
          || value.search !== undefined
          || value.server !== undefined
          || value.action !== undefined;
        if (!hasGatewayMode(params) && params.args !== undefined) {
          throw new Error("Gateway params were nested inside `args`; pass them top-level (for example, mcp({ search: \"...\" }) or mcp({ tool: \"...\", args: {} })).");
        }

        let initialization = initPromise;
        if (!state && !initialization) {
          try {
            initialization = ensureMcpState(signal, _ctx);
            executeOwner = currentOwner;
          } catch (error) {
            if (executeOwner && isOwnerAbortError(error, executeOwner)) throw error;
            const message = retainInitFailure(error);
            return {
              content: [{ type: "text" as const, text: buildInitRetryInstruction("MCP initialization failed", message) }],
              details: { error: "init_failed", message },
            };
          }
        }

        if (!state && initialization) {
          try {
            const initialized = await awaitWithTimeout(initialization, INIT_WAIT_TIMEOUT_MS);
            if (initialized === INIT_WAIT_TIMED_OUT) {
              return {
                content: [{ type: "text" as const, text: "MCP initialization is still in progress. Try again shortly." }],
                details: { error: "init_timeout", timeoutMs: INIT_WAIT_TIMEOUT_MS },
              };
            }
            executeOwner?.throwIfInactive();
            state = initialized;
          } catch (error) {
            if (executeOwner && isOwnerAbortError(error, executeOwner)) throw error;
            const message = retainInitFailure(error);
            return {
              content: [{ type: "text" as const, text: buildInitRetryInstruction("MCP initialization failed", message) }],
              details: { error: "init_failed", message },
            };
          }
        }
        if (!state) {
          return {
            content: [{ type: "text" as const, text: retainedInitFailure
              ? buildInitRetryInstruction("MCP is not initialized after an earlier initialization failure")
              : "MCP not initialized" }],
            details: { error: "not_initialized", ...(retainedInitFailure ? { message: retainedInitFailure } : {}) },
          };
        }
        executeOwner?.throwIfInactive();
        const {
          executeAuthComplete,
          executeAuthStart,
          executeCall,
          executeConnect,
          executeDescribe,
          executeInstructions,
          executeList,
          executeSearch,
          executeStatus,
          executeUiMessages,
        } = await loadProxyModesModule();

        if (params.action === "ui-messages") {
          return executeUiMessages(state);
        }
        if (params.action === "auth-start") {
          if (!params.server) {
            return {
              content: [{ type: "text" as const, text: "auth-start requires `server`. Example: mcp({ action: \"auth-start\", server: \"linear-server\" })" }],
              details: { mode: "auth-start", error: "missing_server" },
            };
          }
          return signal
            ? executeAuthStart(state, params.server, signal)
            : executeAuthStart(state, params.server);
        }
        if (params.action === "auth-complete") {
          if (!params.server) {
            return {
              content: [{ type: "text" as const, text: "auth-complete requires `server`." }],
              details: { mode: "auth-complete", error: "missing_server" },
            };
          }
          const input = parsedArgs?.redirectUrl ?? parsedArgs?.code ?? parsedArgs?.input;
          if (typeof input !== "string" || input.trim().length === 0) {
            return {
              content: [{ type: "text" as const, text: "auth-complete requires args with `redirectUrl`, `code`, or `input`." }],
              details: { mode: "auth-complete", error: "missing_input" },
            };
          }
          return signal
            ? executeAuthComplete(state, params.server, input, signal)
            : executeAuthComplete(state, params.server, input);
        }
        if (params.tool) {
          return executeCall(state, params.tool, parsedArgs, params.server, getPiTools, signal);
        }
        if (params.connect) {
          const result = await executeConnect(state, params.connect, signal);
          syncToolSurface(_ctx as ExtensionContext);
          return result;
        }
        if (params.describe) {
          return executeDescribe(state, params.describe);
        }
        if (params.instructions) {
          return executeInstructions(state, params.instructions);
        }
        if (params.search !== undefined) {
          return executeSearch(state, params.search, params.regex, params.server, params.includeSchemas, params.limit, params.offset);
        }
        if (params.server) {
          return executeList(state, params.server);
        }
        return executeStatus(state);
      },
    });
  }

  const initialDirectResult = toolSurface.syncDirectTools(earlyConfig, earlyCatalogSnapshot);
  toolSurface.syncProxyTool(earlyConfig, earlyCatalogSnapshot, initialDirectResult.specs);
  // Register namespace-proxy tools eagerly so tool-groups/slow-mode can validate
  // `mcp:<server>` references on the first session_start turn. Without this
  // eager call, the tool-groups expansion runs before MCP initialization
  // completes and emits false `[unknown-tool] mcp__<server>` diagnostics.
  toolSurface.syncNamespaceTools(earlyConfig, earlyCatalogSnapshot, initialDirectResult.reservedDirectNames, initialDirectResult.activeDirectNames);
  startLoadTimeInitialization();
}

export function createMcpAdapter(options: McpAdapterOptions = {}) {
  const factoryConfig = options.config !== undefined ? cloneMcpConfig(options.config) : undefined;
  return function mcpAdapter(pi: ExtensionAPI) {
    installMcpAdapter(pi, {
      ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
      ...(factoryConfig !== undefined ? { config: cloneMcpConfig(factoryConfig) } : {}),
    });
  };
}

/**
 * Register an MCP server with the adapter installed for this Pi instance.
 * Registrations are session/runtime scoped and never persisted. Duplicate
 * names fail closed. Registered servers are proxy-tool-only; their tools
 * become visible at the next tool sync. To change a definition, dispose the
 * registration and register again.
 */
export function registerMcpServer(options: { pi: ExtensionAPI; name: string; definition: ServerEntry }): McpServerRegistration {
  const { pi, name, definition } = options;
  const register = runtimeRegistrars.get(pi);
  if (!register) {
    throw new Error("pi-mcp-adapter is not installed for this Pi instance");
  }
  return register(name, definition);
}

export default createMcpAdapter();
