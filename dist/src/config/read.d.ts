import type { ImportKind, McpConfig, ServerEntry } from "../contracts/core.js";
export declare function resolveImportCandidates(importKind: ImportKind, cwd: string): string[];
export declare function parseJsonConfig(raw: string): unknown;
export declare function readImportedConfig(path: string): unknown;
export declare function loadImportedConfig(importKind: ImportKind, cwd: string, warningPrefix: string): {
    path: string;
    value: unknown;
} | null;
export declare function resolveImportPath(importKind: ImportKind, cwd?: string): string | null;
export declare function readValidatedConfig(path: string, label: string): McpConfig | null;
export declare function validateConfig(raw: unknown): McpConfig;
export declare function extractServers(config: unknown, kind: ImportKind): Record<string, ServerEntry>;
