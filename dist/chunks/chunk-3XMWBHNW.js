// src/config/paths.ts
import { existsSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2, resolve as resolve2 } from "node:path";

// src/config/agent-dir.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
function getConfigDirName() {
  const configDir = readPiConfig()?.configDir;
  return typeof configDir === "string" && configDir.trim() ? configDir.trim() : ".pi";
}
function getAgentDir() {
  const piConfig = readPiConfig();
  const name = piConfig?.name;
  const appName = typeof name === "string" && name.trim() ? name.trim() : "pi";
  const configured = process.env[`${appName.toUpperCase()}_CODING_AGENT_DIR`]?.trim();
  if (!configured) {
    return join(homedir(), getConfigDirName(), "agent");
  }
  if (configured === "~") {
    return homedir();
  }
  if (configured.startsWith("~/")) {
    return resolve(homedir(), configured.slice(2));
  }
  return resolve(configured);
}
function getAgentPath(...segments) {
  return join(getAgentDir(), ...segments);
}
function readPiConfig() {
  const dir = process.env.PI_PACKAGE_DIR?.trim();
  if (!dir) return void 0;
  try {
    const manifest = JSON.parse(readFileSync(join(resolve(dir), "package.json"), "utf8"));
    return manifest.piConfig;
  } catch {
    return void 0;
  }
}

// src/config/paths.ts
var GENERIC_GLOBAL_CONFIG_PATH = join2(homedir2(), ".config", "mcp", "mcp.json");
var AGENTS_GLOBAL_CONFIG_PATHS = [
  join2(homedir2(), ".agents", "mcp.json"),
  join2(homedir2(), ".agents", "mcp", "mcp.json")
];
var PROJECT_CONFIG_NAME = ".mcp.json";
var PROJECT_PI_CONFIG_NAME = "mcp.json";
var REPOPROMPT_BINARY_CANDIDATES = [
  join2(homedir2(), "RepoPrompt", "repoprompt_cli"),
  "/Applications/Repo Prompt.app/Contents/MacOS/repoprompt-mcp"
];
function getConfigPathFromArgv(argv = process.argv) {
  const index = argv.indexOf("--mcp-config");
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : void 0;
}
function getPiGlobalConfigPath(overridePath) {
  return overridePath ? resolve2(overridePath) : getAgentPath("mcp.json");
}
function getGenericGlobalConfigPath() {
  return GENERIC_GLOBAL_CONFIG_PATH;
}
function getProjectConfigPath(cwd = process.cwd()) {
  return resolve2(cwd, PROJECT_CONFIG_NAME);
}
function getProjectPiConfigPath(cwd = process.cwd()) {
  return resolve2(cwd, getConfigDirName(), PROJECT_PI_CONFIG_NAME);
}
function getConfigDiscoveryPaths(overridePath, cwd = process.cwd()) {
  return getConfigSources(overridePath, cwd).map((source) => ({
    label: source.label,
    path: source.readPath,
    exists: existsSync(source.readPath)
  }));
}
function getConfigSources(overridePath, cwd = process.cwd()) {
  const userPath = getEffectivePiGlobalConfigPath(overridePath);
  const projectPath = getProjectConfigPath(cwd);
  const projectPiPath = getProjectPiConfigPath(cwd);
  const projectAgentsPaths = [
    resolve2(cwd, ".agents", "mcp.json"),
    resolve2(cwd, ".agents", "mcp", "mcp.json")
  ];
  const sources = [];
  if (isExclusiveConfigMode()) {
    return [{
      id: "pi-global",
      label: "Pi exclusive config",
      readPath: userPath,
      writePath: userPath,
      kind: "user",
      shared: false,
      scope: "global"
    }];
  }
  if (GENERIC_GLOBAL_CONFIG_PATH !== userPath) {
    sources.push({
      id: "shared-global",
      label: "user-global standard MCP",
      readPath: GENERIC_GLOBAL_CONFIG_PATH,
      writePath: userPath,
      kind: "shared",
      shared: true,
      scope: "global"
    });
  }
  for (const [index, agentsPath] of AGENTS_GLOBAL_CONFIG_PATHS.entries()) {
    if (agentsPath === userPath || agentsPath === GENERIC_GLOBAL_CONFIG_PATH) continue;
    sources.push({
      id: index === 0 ? "agents-global" : "agents-nested-global",
      label: index === 0 ? "user-global .agents MCP" : "user-global .agents nested MCP",
      readPath: agentsPath,
      writePath: userPath,
      kind: "shared",
      shared: true,
      scope: "global"
    });
  }
  sources.push({
    id: "pi-global",
    label: "Pi global override",
    readPath: userPath,
    writePath: userPath,
    kind: "user",
    shared: false,
    scope: "global"
  });
  if (projectPath !== userPath) {
    sources.push({
      id: "shared-project",
      label: "project standard MCP",
      readPath: projectPath,
      writePath: projectPath,
      kind: "project",
      shared: true,
      scope: "project"
    });
  }
  for (const [index, agentsPath] of projectAgentsPaths.entries()) {
    if ([userPath, projectPath, projectPiPath, GENERIC_GLOBAL_CONFIG_PATH, ...AGENTS_GLOBAL_CONFIG_PATHS].includes(agentsPath)) continue;
    sources.push({
      id: index === 0 ? "agents-project" : "agents-nested-project",
      label: index === 0 ? "project .agents MCP" : "project .agents nested MCP",
      readPath: agentsPath,
      writePath: agentsPath,
      kind: "project",
      shared: true,
      scope: "project"
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
      scope: "project"
    });
  }
  return sources;
}
function isExclusiveConfigMode() {
  return process.env.PI_MCP_CONFIG_MODE?.trim().toLowerCase() === "exclusive";
}
function getEffectivePiGlobalConfigPath(overridePath) {
  return getPiGlobalConfigPath(isExclusiveConfigMode() ? void 0 : overridePath);
}
function resolveConfiguredOAuthDir(raw, cwd = process.cwd()) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "string") {
    throw new Error("settings.oauthDir must be a string");
  }
  const trimmed = raw.trim();
  if (!trimmed) return void 0;
  return resolve2(cwd, trimmed);
}

export {
  getConfigDirName,
  getAgentDir,
  getAgentPath,
  GENERIC_GLOBAL_CONFIG_PATH,
  AGENTS_GLOBAL_CONFIG_PATHS,
  PROJECT_CONFIG_NAME,
  PROJECT_PI_CONFIG_NAME,
  REPOPROMPT_BINARY_CANDIDATES,
  getConfigPathFromArgv,
  getPiGlobalConfigPath,
  getGenericGlobalConfigPath,
  getProjectConfigPath,
  getProjectPiConfigPath,
  getConfigDiscoveryPaths,
  getConfigSources,
  isExclusiveConfigMode,
  getEffectivePiGlobalConfigPath,
  resolveConfiguredOAuthDir
};
