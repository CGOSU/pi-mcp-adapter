// Configuration paths and source ordering. This module is safe for startup loading.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getAgentPath, getConfigDirName } from "./agent-dir.js";
export const GENERIC_GLOBAL_CONFIG_PATH = join(homedir(), ".config", "mcp", "mcp.json");
export const AGENTS_GLOBAL_CONFIG_PATHS = [
    join(homedir(), ".agents", "mcp.json"),
    join(homedir(), ".agents", "mcp", "mcp.json"),
];
export const PROJECT_CONFIG_NAME = ".mcp.json";
export const PROJECT_PI_CONFIG_NAME = "mcp.json";
export const REPOPROMPT_BINARY_CANDIDATES = [
    join(homedir(), "RepoPrompt", "repoprompt_cli"),
    "/Applications/Repo Prompt.app/Contents/MacOS/repoprompt-mcp",
];
export const IMPORT_PATHS = {
    cursor: [join(homedir(), ".cursor", "mcp.json")],
    "claude-code": [
        join(homedir(), ".claude", "mcp.json"),
        join(homedir(), ".claude.json"),
        join(homedir(), ".claude", "claude_desktop_config.json"),
    ],
    "claude-desktop": [join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")],
    codex: [
        join(homedir(), ".codex", "config.toml"),
        join(homedir(), ".codex", "config.json"),
    ],
    opencode: [
        join(homedir(), ".config", "opencode", "opencode.json"),
        "./opencode.json",
    ],
    windsurf: [join(homedir(), ".windsurf", "mcp.json")],
    vscode: [".vscode/mcp.json"],
};
export function getPiGlobalConfigPath(overridePath) {
    return overridePath ? resolve(overridePath) : getAgentPath("mcp.json");
}
export function getGenericGlobalConfigPath() {
    return GENERIC_GLOBAL_CONFIG_PATH;
}
export function getProjectConfigPath(cwd = process.cwd()) {
    return resolve(cwd, PROJECT_CONFIG_NAME);
}
export function getProjectPiConfigPath(cwd = process.cwd()) {
    return resolve(cwd, getConfigDirName(), PROJECT_PI_CONFIG_NAME);
}
export function getConfigDiscoveryPaths(overridePath, cwd = process.cwd()) {
    return getConfigSources(overridePath, cwd).map((source) => ({
        label: source.label,
        path: source.readPath,
        exists: existsSync(source.readPath),
    }));
}
export function getConfigSources(overridePath, cwd = process.cwd()) {
    const userPath = getEffectivePiGlobalConfigPath(overridePath);
    const projectPath = getProjectConfigPath(cwd);
    const projectPiPath = getProjectPiConfigPath(cwd);
    const sources = [];
    if (isExclusiveConfigMode()) {
        return [{
                id: "pi-global",
                label: "Pi exclusive config",
                readPath: userPath,
                writePath: userPath,
                kind: "user",
                shared: false,
                scope: "global",
            }];
    }
    if (GENERIC_GLOBAL_CONFIG_PATH !== userPath) {
        sources.push({
            id: "shared-global",
            label: "user-global standard MCP",
            readPath: GENERIC_GLOBAL_CONFIG_PATH,
            writePath: userPath,
            kind: "import",
            importKind: "global MCP config",
            shared: true,
            scope: "global",
        });
    }
    for (const [index, agentsPath] of AGENTS_GLOBAL_CONFIG_PATHS.entries()) {
        if (agentsPath === userPath || agentsPath === GENERIC_GLOBAL_CONFIG_PATH)
            continue;
        sources.push({
            id: index === 0 ? "agents-global" : "agents-nested-global",
            label: index === 0 ? "user-global .agents MCP" : "user-global .agents nested MCP",
            readPath: agentsPath,
            writePath: userPath,
            kind: "import",
            importKind: index === 0 ? ".agents MCP config" : ".agents/mcp MCP config",
            shared: true,
            scope: "global",
        });
    }
    sources.push({
        id: "pi-global",
        label: "Pi global override",
        readPath: userPath,
        writePath: userPath,
        kind: "user",
        shared: false,
        scope: "global",
    });
    if (projectPath !== userPath) {
        sources.push({
            id: "shared-project",
            label: "project standard MCP",
            readPath: projectPath,
            writePath: projectPath,
            kind: "project",
            shared: true,
            scope: "project",
        });
    }
    if (projectPiPath !== userPath && projectPiPath !== projectPath) {
        sources.push({
            id: "pi-project",
            label: "project Pi override",
            readPath: projectPiPath,
            writePath: projectPiPath,
            kind: "project",
            shared: false,
            scope: "project",
        });
    }
    return sources;
}
export function isExclusiveConfigMode() {
    return process.env.PI_MCP_CONFIG_MODE?.trim().toLowerCase() === "exclusive";
}
export function getEffectivePiGlobalConfigPath(overridePath) {
    return getPiGlobalConfigPath(isExclusiveConfigMode() ? undefined : overridePath);
}
export function resolveConfiguredOAuthDir(raw, cwd = process.cwd()) {
    if (raw === undefined || raw === null)
        return undefined;
    if (typeof raw !== "string") {
        throw new Error("settings.oauthDir must be a string");
    }
    const trimmed = raw.trim();
    if (!trimmed)
        return undefined;
    return resolve(cwd, trimmed);
}
//# sourceMappingURL=paths.js.map