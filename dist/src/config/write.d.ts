import type { ConfigWritePreview } from "./contracts.js";
import type { ImportKind, McpConfig, ServerEntry, ServerProvenance } from "../contracts/core.js";
export interface ServerDisabledOverrideResult {
    path: string;
    changed: boolean;
}
/**
 * Persist only the disabled field in the project Pi layer. Enabling writes an
 * explicit false only when a lower-precedence source is itself disabled; this
 * writer never copies a server definition or its credentials into the file.
 */
export declare function writeProjectServerDisabledOverride(overridePath: string | undefined, cwd: string, serverName: string, disabled: boolean): ServerDisabledOverrideResult;
export declare function previewCompatibilityImports(importKinds: ImportKind[], overridePath?: string): ConfigWritePreview;
export declare function ensureCompatibilityImports(importKinds: ImportKind[], overridePath?: string): {
    path: string;
    added: ImportKind[];
};
export declare function buildStarterProjectConfig(): McpConfig;
export declare function previewStarterProjectConfig(cwd?: string): ConfigWritePreview;
export declare function writeStarterProjectConfig(cwd?: string): string;
export declare function previewSharedServerEntry(filePath: string, serverName: string, entry: ServerEntry): ConfigWritePreview;
export declare function writeSharedServerEntry(filePath: string, serverName: string, entry: ServerEntry): string;
export declare function getServerProvenance(overridePath?: string, cwd?: string): Map<string, ServerProvenance>;
export declare function writeDirectToolsConfig(changes: Map<string, true | string[] | false>, provenance: Map<string, ServerProvenance>, fullConfig: McpConfig): void;
