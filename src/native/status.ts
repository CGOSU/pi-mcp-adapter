import type { ExtensionAPI, McpManagementSnapshot } from "@earendil-works/pi-coding-agent";
import {
  MCP_STATUS_EVENT,
  MCP_STATUS_SNAPSHOT_VERSION,
  type McpServerStatusSnapshot,
  type McpStatusSnapshot,
} from "../contracts/status.ts";
import type { NativePanelConfiguration } from "./config-assembly.ts";
import { createNativeMcpPanelData } from "./panel-data.ts";
import type { McpManagementExecutionPolicy } from "@earendil-works/pi-coding-agent";

export function createNativeStatusSnapshot(
  snapshot: McpManagementSnapshot,
  configuration: NativePanelConfiguration,
  runtimePolicies: ReadonlyMap<string, McpManagementExecutionPolicy> = new Map(),
): McpStatusSnapshot {
  const panelData = createNativeMcpPanelData(snapshot, configuration, runtimePolicies);
  const servers: McpServerStatusSnapshot[] = [];
  let totalTools = 0;
  let totalResources = 0;
  let connectedCount = 0;
  let disabledCount = 0;

  for (const server of snapshot.servers) {
    const disabled = !server.enabled || server.connectionStatus === "disabled";
    let status: McpServerStatusSnapshot["status"];
    if (disabled) {
      status = "disabled";
      disabledCount++;
    } else if (server.connectionStatus === "failed") {
      status = "failed";
    } else if (server.connectionStatus === "needs-auth") {
      status = "needs-auth";
    } else if (server.connectionStatus === "connected") {
      status = "connected";
      connectedCount++;
    } else if (server.catalog.freshness === "cached") {
      status = "cached";
    } else {
      status = "not-connected";
    }

    const unavailableCatalog = disabled || status === "failed";
    const toolCount = unavailableCatalog ? 0 : panelData.visibleToolCountByServer.get(server.name) ?? 0;
    const resourceCount = unavailableCatalog || server.catalog.resources.freshness === "missing"
      ? undefined
      : panelData.visibleResourceCountByServer.get(server.name) ?? 0;
    totalTools += disabled ? 0 : toolCount;
    if (!disabled && resourceCount !== undefined) totalResources += resourceCount;
    servers.push({
      name: server.name,
      status,
      toolCount,
      ...(resourceCount === undefined ? {} : { resourceCount }),
      disabled,
    });
  }

  return {
    version: MCP_STATUS_SNAPSHOT_VERSION,
    servers,
    totalTools,
    totalResources,
    connectedCount,
    disabledCount,
  };
}

export function publishNativeStatusSnapshot(
  pi: ExtensionAPI,
  snapshot: McpManagementSnapshot,
  configuration: NativePanelConfiguration,
  runtimePolicies: ReadonlyMap<string, McpManagementExecutionPolicy> = new Map(),
): McpStatusSnapshot {
  const status = createNativeStatusSnapshot(snapshot, configuration, runtimePolicies);
  try {
    pi.events.emit(MCP_STATUS_EVENT, status);
  } catch {
    // A read-only status consumer must not interrupt the native MCP owner.
  }
  return status;
}

export function updateNativeStatusBar(pi: ExtensionContextApi, status: McpStatusSnapshot): void {
  if (!pi.hasUI) return;
  const failedCount = status.servers.filter((server) => server.status === "failed").length;
  const authCount = status.servers.filter((server) => server.status === "needs-auth").length;
  const cachedCount = status.servers.filter((server) => server.status === "cached").length;
  const disconnectedCount = status.servers.filter((server) => server.status === "not-connected").length;
  const message = [
    `${status.connectedCount} connected`,
    ...(disconnectedCount ? [`${disconnectedCount} disconnected`] : []),
    ...(cachedCount ? [`${cachedCount} cached`] : []),
    ...(status.disabledCount ? [`${status.disabledCount} disabled`] : []),
    ...(authCount ? [`${authCount} need auth`] : []),
    ...(failedCount ? [`${failedCount} failed`] : []),
  ].join(" · ");
  try {
    pi.ui.setStatus("mcp-adapter", status.servers.length > 0 ? `MCP: ${message}` : undefined);
  } catch {
    // Status-bar consumers are optional and must not interrupt native MCP updates.
  }
}

type ExtensionContextApi = Pick<import("@earendil-works/pi-coding-agent").ExtensionContext, "hasUI" | "ui">;

export function clearNativeStatusBar(context: ExtensionContextApi): void {
  updateNativeStatusBar(context, {
    version: MCP_STATUS_SNAPSHOT_VERSION,
    servers: [],
    totalTools: 0,
    totalResources: 0,
    connectedCount: 0,
    disabledCount: 0,
  });
}

export function publishNativeStatusShutdown(pi: ExtensionAPI): void {
  try {
    pi.events.emit(MCP_STATUS_EVENT, {
      version: MCP_STATUS_SNAPSHOT_VERSION,
      servers: [],
      totalTools: 0,
      totalResources: 0,
      connectedCount: 0,
      disabledCount: 0,
    } satisfies McpStatusSnapshot);
  } catch {
    // Shutdown reporting is best effort and does not perform MCP work.
  }
}
