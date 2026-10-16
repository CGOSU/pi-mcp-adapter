import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createNativeConfigAssembly } from "../../../src/native/config-assembly.ts";

const roots: string[] = [];
const originalCwd = process.cwd();
const originalHome = process.env.HOME;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalConfigMode = process.env.PI_MCP_CONFIG_MODE;

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(async () => {
  vi.unstubAllEnvs();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalConfigMode === undefined) delete process.env.PI_MCP_CONFIG_MODE;
  else process.env.PI_MCP_CONFIG_MODE = originalConfigMode;
  process.chdir(originalCwd);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("native config assembly direct-tool persistence", () => {
  it("writes explicit false and array selections through the winning config provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-persist-"));
    roots.push(root);
    const agentDir = join(root, "agent");
    const project = join(root, "project");
    const configPath = join(agentDir, "mcp.json");
    await mkdir(project, { recursive: true });
    vi.stubEnv("HOME", join(root, "home"));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("PI_MCP_CONFIG_MODE", "exclusive");
    process.chdir(project);
    await writeJson(configPath, { mcpServers: { docs: { command: "docs-server" } } });

    const context = { cwd: project, isProjectTrusted: () => true } as ExtensionContext;
    const state = createNativeConfigAssembly({ configPath });
    let loaded = state.assembly.loadConfig(context);
    let server = loaded.servers.find((entry) => entry.name === "docs");
    expect(server).toMatchObject({ source: configPath, scope: "global" });
    if (!server) throw new Error("Expected the configured MCP server");

    state.assembly.updateConfig(server, { directTools: false });
    let config = JSON.parse(await readFile(configPath, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(config.mcpServers.docs).toMatchObject({ command: "docs-server", directTools: false });

    loaded = state.assembly.loadConfig(context);
    server = loaded.servers.find((entry) => entry.name === "docs");
    expect(server?.config.directTools).toBe(false);
    if (!server) throw new Error("Expected the reloaded MCP server");

    state.assembly.updateConfig(server, { directTools: ["search", "read_file"] });
    config = JSON.parse(await readFile(configPath, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(config.mcpServers.docs).toMatchObject({
      command: "docs-server",
      directTools: ["search", "read_file"],
    });
    expect(state.assembly.loadConfig(context).servers.find((entry) => entry.name === "docs")?.config.directTools).toEqual([
      "search",
      "read_file",
    ]);
  });

  it("writes to the project source that wins over global configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-project-persist-"));
    roots.push(root);
    const home = join(root, "home");
    const agentDir = join(root, "agent");
    const project = join(root, "project");
    const globalPath = join(home, ".config", "mcp", "mcp.json");
    const piGlobalPath = join(agentDir, "mcp.json");
    const projectPath = join(project, ".mcp.json");
    await mkdir(project, { recursive: true });
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("PI_MCP_CONFIG_MODE", "merged");
    process.chdir(project);
    await writeJson(globalPath, { mcpServers: { docs: { command: "shared-global" } } });
    await writeJson(piGlobalPath, { mcpServers: { docs: { command: "pi-global" } } });
    await writeJson(projectPath, { mcpServers: { docs: { command: "project-winner" } } });
    vi.resetModules();
    const { createNativeConfigAssembly: createIsolatedAssembly } = await import("../../../src/native/config-assembly.ts");

    const context = { cwd: project, isProjectTrusted: () => true } as ExtensionContext;
    const state = createIsolatedAssembly({ configPath: piGlobalPath });
    const loaded = state.assembly.loadConfig(context);
    const server = loaded.servers.find((entry) => entry.name === "docs");
    expect(server).toMatchObject({
      source: projectPath,
      scope: "project",
      config: { command: "project-winner" },
    });
    if (!server) throw new Error("Expected the project-winning MCP server");

    state.assembly.updateConfig(server, { directTools: false });
    const projectConfig = JSON.parse(await readFile(projectPath, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    const globalConfig = JSON.parse(await readFile(globalPath, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    const piGlobalConfig = JSON.parse(await readFile(piGlobalPath, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(projectConfig.mcpServers.docs).toMatchObject({ command: "project-winner", directTools: false });
    expect(globalConfig.mcpServers.docs).not.toHaveProperty("directTools");
    expect(piGlobalConfig.mcpServers.docs).not.toHaveProperty("directTools");
  });
});
