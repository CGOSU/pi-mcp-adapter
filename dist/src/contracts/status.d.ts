/** Versioned shared-event-bus channel for read-only MCP runtime snapshots. */
export declare const MCP_STATUS_EVENT = "pi-mcp-adapter/status/v1";
export declare const MCP_STATUS_SNAPSHOT_VERSION: 1;
export type McpServerRuntimeStatus = "connected" | "cached" | "failed" | "needs-auth" | "not-connected" | "disabled";
export interface McpServerStatusSnapshot {
    readonly name: string;
    readonly status: McpServerRuntimeStatus;
    readonly toolCount: number;
    readonly resourceCount?: number;
    readonly failedAgoSeconds?: number;
    readonly disabled: boolean;
}
export interface McpStatusSnapshot {
    readonly version: typeof MCP_STATUS_SNAPSHOT_VERSION;
    readonly servers: ReadonlyArray<McpServerStatusSnapshot>;
    readonly totalTools: number;
    readonly totalResources: number;
    readonly connectedCount: number;
    readonly disabledCount: number;
}
/**
 * Minimal event-bus surface the status publisher needs. Lives here (leaf
 * module) so `state.ts` can reference it without importing `src/extension/status.ts`,
 * which imports the state type back — an import cycle at type level.
 */
export interface McpStatusEventBus {
    emit(channel: string, data: unknown): void;
}
