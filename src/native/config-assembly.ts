import type {
  ExtensionContext,
  LoadedMcpConfig,
  McpManagementExecutionPolicy,
  McpOwnerAssembly,
  McpServerConfigPatch,
  McpServerEntry,
} from "@earendil-works/pi-coding-agent";
import {
  getMergedSettingsFromSources,
  loadConfigSources,
  cloneMcpConfig,
  type LoadedConfigSource,
} from "../config/load.ts";
import { getConfigPathFromArgv, isExclusiveConfigMode } from "../config/paths.js";
import { loadAgentPluginConfigSources } from "../config/agent-plugin-loader.ts";
import { loadPackageMcpConfigSources } from "../config/package-mcp-loader.ts";
import { getProjectPiConfigPath } from "../config/paths.js";
import type { McpAdapterOptions, McpConfig } from "../contracts/core.js";
import { validateMcpConfig } from "../config/validation.ts";
import { createNativeMcpOAuthCredentialBackend } from "./oauth-credential-backend.ts";
import {
  mapLoadedConfigSourcesToNative,
  type NativeConfigMappingPlan,
  type NativeConfigProvenance,
  type NativeConfigServerPlan,
  type NativeServerConfigSubset,
} from "./config-mapping.ts";
import { writeNativeMcpConfigPatch } from "./config-write.ts";

const PROGRAMMATIC_SOURCE = "pi-mcp-adapter:programmatic-config";

function programmaticSource(config: McpConfig): LoadedConfigSource[] {
  const source = {
    id: "adapter-config" as const,
    label: "Pi MCP adapter programmatic config",
    readPath: PROGRAMMATIC_SOURCE,
    writePath: PROGRAMMATIC_SOURCE,
    kind: "extension" as const,
    shared: false,
    scope: "extension" as const,
  };
  const validated = validateMcpConfig(config);
  if (!validated.ok) return [{ source, config: null, error: validated.error }];
  return [{
    source,
    config: cloneMcpConfig(validated.value),
    ...(validated.issues === undefined ? {} : { validationIssues: validated.issues }),
  }];
}

function nativeConfigSources(options: McpAdapterOptions, cwd: string): LoadedConfigSource[] {
  if (options.config !== undefined) return programmaticSource(options.config);

  const baseSources = loadConfigSources(options.configPath ?? getConfigPathFromArgv(), cwd);
  if (isExclusiveConfigMode()) return baseSources;

  const basePlan = mapLoadedConfigSourcesToNative(baseSources);
  if (!basePlan.ok) return baseSources;
  const settings = getMergedSettingsFromSources(baseSources);
  const pluginSettingsScope = basePlan.value.settings.provenance.agentPluginPaths?.scope;
  const pluginSources = settings?.agentPluginPaths?.length && pluginSettingsScope && pluginSettingsScope !== "extension"
    ? loadAgentPluginConfigSources(settings.agentPluginPaths, cwd, { scope: pluginSettingsScope })
    : [];
  const packageSources = loadPackageMcpConfigSources(cwd);

  return [
    ...packageSources,
    ...pluginSources,
    ...baseSources,
  ];
}

function describeServerIssue(server: NativeConfigServerPlan): string | undefined {
  if (server.deferredFields.length > 0) {
    return `An MCP server entry could not be imported because these fields are not supported by the native owner: ${server.deferredFields.join(", ")}.`;
  }
  if (server.blockingIssues.length > 0) {
    return server.blockingIssues.map((issue) => issue.message).join(" ");
  }
  return undefined;
}

function settingsWarnings(fields: readonly string[]): string[] {
  return fields.length === 0
    ? []
    : [`These adapter settings are retained in configuration but are not activated by the native MCP owner: ${fields.join(", ")}.`];
}

function mapNativeServer(server: NativeConfigServerPlan): McpServerEntry | undefined {
  if (!server.connectable || !("command" in server.config || "url" in server.config || "socket" in server.config)) {
    return undefined;
  }
  return {
    name: server.name,
    config: server.config,
    executionPolicy: server.executionPolicy,
    source: server.provenance.sourcePath,
    scope: server.provenance.scope,
  };
}

export interface NativePanelServerConfiguration {
  readonly directTools?: boolean | readonly string[];
  readonly includeTools: readonly string[];
  readonly excludeTools: readonly string[];
  readonly exposeResources: boolean;
  readonly toolPrefix?: McpManagementExecutionPolicy["toolPrefix"];
  readonly scope: NativeConfigProvenance["scope"];
}

export interface NativePanelConfiguration {
  readonly directTools?: boolean;
  readonly directToolsScope?: NativeConfigProvenance["scope"];
  readonly toolPrefix?: McpManagementExecutionPolicy["toolPrefix"];
  readonly toolPrefixScope?: NativeConfigProvenance["scope"];
  readonly servers: ReadonlyMap<string, NativePanelServerConfiguration>;
}

export interface NativeConfigAssemblyState {
  readonly provenanceByServer: Map<string, NativeConfigProvenance>;
  readonly managedServerNames: Set<string>;
  readonly assembly: McpOwnerAssembly;
  getPanelConfiguration(projectTrusted?: boolean): NativePanelConfiguration;
}

export function createNativeConfigAssembly(options: McpAdapterOptions): NativeConfigAssemblyState {
  const provenanceByServer = new Map<string, NativeConfigProvenance>();
  const managedServerNames = new Set<string>();
  let activeCwd = process.cwd();
  let panelConfiguration: NativePanelConfiguration = { servers: new Map() };

  const updatePanelConfiguration = (plan: NativeConfigMappingPlan): void => {
    const servers = new Map<string, NativePanelServerConfiguration>();
    for (const server of plan.servers) {
      const config = server.config as Partial<NativeServerConfigSubset>;
      servers.set(server.name, {
        ...(config.directTools === undefined
          ? {}
          : { directTools: Array.isArray(config.directTools) ? [...config.directTools] : config.directTools }),
        includeTools: [...(server.executionPolicy.includeTools ?? [])],
        excludeTools: [...(server.executionPolicy.excludeTools ?? [])],
        exposeResources: server.executionPolicy.exposeResources !== false,
        ...(server.executionPolicy.toolPrefix === undefined ? {} : { toolPrefix: server.executionPolicy.toolPrefix }),
        scope: server.provenance.scope,
      });
    }
    const directToolsScope = plan.settings.provenance.directTools?.scope;
    const toolPrefixScope = plan.settings.provenance.toolPrefix?.scope;
    panelConfiguration = {
      ...(plan.settings.directTools === undefined ? {} : { directTools: plan.settings.directTools }),
      ...(directToolsScope === undefined ? {} : { directToolsScope }),
      ...(plan.settings.toolPrefix === undefined ? {} : { toolPrefix: plan.settings.toolPrefix }),
      ...(toolPrefixScope === undefined ? {} : { toolPrefixScope }),
      servers,
    };
  };

  const assembly: McpOwnerAssembly = {
    loadConfig: (context: ExtensionContext): LoadedMcpConfig => {
      activeCwd = context.cwd;
      let mapped: ReturnType<typeof mapLoadedConfigSourcesToNative>;
      try {
        mapped = mapLoadedConfigSourcesToNative(nativeConfigSources(options, context.cwd));
      } catch {
        provenanceByServer.clear();
        managedServerNames.clear();
        panelConfiguration = { servers: new Map() };
        return { servers: [], errors: ["Adapter MCP configuration could not be loaded safely."] };
      }
      if (!mapped.ok) {
        provenanceByServer.clear();
        managedServerNames.clear();
        panelConfiguration = { servers: new Map() };
        return { servers: [], errors: [mapped.error.message] };
      }

      const plan = mapped.value;
      updatePanelConfiguration(plan);
      provenanceByServer.clear();
      managedServerNames.clear();
      const servers: McpServerEntry[] = [];
      const errors = settingsWarnings(plan.settings.deferredFields);

      for (const serverPlan of plan.servers) {
        provenanceByServer.set(serverPlan.name, serverPlan.provenance);
        managedServerNames.add(serverPlan.name);
        const issue = describeServerIssue(serverPlan);
        if (issue) errors.push(issue);
        const server = mapNativeServer(serverPlan);
        if (server) servers.push(server);
      }

      const projectConfig = context.isProjectTrusted() ? getProjectPiConfigPath(context.cwd) : undefined;
      return {
        servers,
        errors,
        ...(plan.settings.idleTimeout === undefined ? {} : { idleTimeout: plan.settings.idleTimeout }),
        ...(projectConfig === undefined ? {} : { projectConfig }),
      };
    },
    updateConfig: (entry: McpServerEntry, patch: McpServerConfigPatch): void => {
      const provenance = provenanceByServer.get(entry.name);
      if (!provenance || entry.scope === "extension" || entry.source !== provenance.sourcePath) {
        throw new Error("The MCP server's configuration provenance is no longer available.");
      }
      const projectOverridePath = getProjectPiConfigPath(activeCwd);
      const path = entry.override ?? provenance.writePath;
      if (entry.override !== undefined && path !== projectOverridePath) {
        throw new Error("The MCP server's project override target is not authorized by its configuration provenance.");
      }
      const allowCreateOverride = path !== provenance.sourcePath;
      writeNativeMcpConfigPatch(path, entry.name, patch, allowCreateOverride);
    },
    credentialsBackend: createNativeMcpOAuthCredentialBackend(() => [...managedServerNames]),
  };

  return {
    provenanceByServer,
    managedServerNames,
    assembly,
    getPanelConfiguration: (projectTrusted?: boolean) => {
      const includeProjectConfiguration = projectTrusted === true;
      const directTools = panelConfiguration.directToolsScope === "project" && !includeProjectConfiguration
        ? undefined
        : panelConfiguration.directTools;
      const toolPrefix = panelConfiguration.toolPrefixScope === "project" && !includeProjectConfiguration
        ? undefined
        : panelConfiguration.toolPrefix;
      return {
        ...(directTools === undefined ? {} : { directTools }),
        ...(directTools === undefined || panelConfiguration.directToolsScope === undefined
          ? {}
          : { directToolsScope: panelConfiguration.directToolsScope }),
        ...(toolPrefix === undefined ? {} : { toolPrefix }),
        ...(toolPrefix === undefined || panelConfiguration.toolPrefixScope === undefined
          ? {}
          : { toolPrefixScope: panelConfiguration.toolPrefixScope }),
        servers: new Map([...panelConfiguration.servers]
          .filter(([, server]) => includeProjectConfiguration || server.scope !== "project")
          .map(([name, server]) => [name, {
            ...server,
            ...(server.directTools === undefined
              ? {}
              : { directTools: Array.isArray(server.directTools) ? [...server.directTools] : server.directTools }),
            includeTools: [...server.includeTools],
            excludeTools: [...server.excludeTools],
          }])),
      };
    },
  };
}
