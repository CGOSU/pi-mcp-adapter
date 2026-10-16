import { afterEach, describe, expect, it, vi } from "vitest";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createNativeConfigAssembly } from "../../../src/native/config-assembly.ts";

const roots: string[] = [];
const originalHome = process.env.HOME;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalCwd = process.cwd();

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  process.chdir(originalCwd);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("native config owner assembly", () => {
  it("omits project panel settings and servers until real Pi project trust is granted", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-panel-trust-"));
    roots.push(root);
    const home = join(root, "home");
    const agentDir = join(root, "agent");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    process.chdir(project);
    await writeJson(join(project, ".mcp.json"), {
      settings: { directTools: true, toolPrefix: "none" },
      mcpServers: { projectOnly: { command: "project-server" } },
    });

    const assemblyState = createNativeConfigAssembly({});
    assemblyState.assembly.loadConfig({ cwd: project, isProjectTrusted: () => false } as ExtensionContext);

    const untrusted = assemblyState.getPanelConfiguration(false);
    expect(untrusted.directTools).toBeUndefined();
    expect(untrusted.toolPrefix).toBeUndefined();
    expect(untrusted.servers.has("projectOnly")).toBe(false);
    expect(assemblyState.getPanelConfiguration(true)).toMatchObject({
      directTools: true,
      toolPrefix: "none",
    });
    expect(assemblyState.getPanelConfiguration(true).servers.has("projectOnly")).toBe(true);
  });

  it("preserves package and Agent Plugin provenance and direct-config precedence without trust assertions", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-assembly-"));
    roots.push(root);
    const home = join(root, "home");
    const agentDir = join(root, "agent");
    const project = join(root, "project");
    const pluginRoot = join(project, "plugins", "demo");
    const packageRoot = join(project, "plugins", "package");
    await mkdir(project, { recursive: true });
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    process.chdir(project);

    await writeJson(join(project, ".pi", "settings.json"), { packages: ["../plugins/package"] });
    await writeJson(join(packageRoot, "package.json"), { name: "@fixture/native-package", pi: { mcp: "mcp.json" } });
    await writeJson(join(packageRoot, "mcp.json"), {
      mcpServers: { docs: { url: "https://package.example/mcp", disabled: true } },
    });
    await writeJson(join(pluginRoot, "plugin.json"), {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "demo-plugin",
    });
    await writeJson(join(pluginRoot, "mcp.json"), {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { docs: { type: "stdio", command: "plugin-server" }, onlyPlugin: { type: "stdio", command: "plugin-only" } },
    });
    await writeJson(join(project, ".mcp.json"), {
      settings: { agentPluginPaths: ["./plugins/demo"] },
      mcpServers: { "demo-plugin__docs": { command: "direct-server", exposure: "hidden", toolExposure: { search: "direct" } } },
    });

    const assemblyState = createNativeConfigAssembly({});
    const context = {
      cwd: project,
      isProjectTrusted: () => false,
    } as ExtensionContext;
    const loaded = assemblyState.assembly.loadConfig(context);

    expect(loaded.projectConfig).toBeUndefined();
    expect(loaded.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "fixture_native-package__docs",
        scope: "project",
        source: realpathSync(join(packageRoot, "mcp.json")),
        config: expect.objectContaining({ url: "https://package.example/mcp", enabled: false }),
      }),
      expect.objectContaining({
        name: "demo-plugin__docs",
        scope: "project",
        source: join(project, ".mcp.json"),
        config: expect.objectContaining({ command: "direct-server", exposure: "hidden", toolExposure: { search: "direct" } }),
      }),
      expect.objectContaining({
        name: "demo-plugin__onlyPlugin",
        scope: "project",
        source: join(pluginRoot, "mcp.json"),
      }),
    ]));
    expect(JSON.stringify(loaded)).not.toContain("trusted");
    expect(assemblyState.provenanceByServer.get("demo-plugin__onlyPlugin")).toMatchObject({
      sourcePath: join(pluginRoot, "mcp.json"),
      writePath: join(project, ".pi", "mcp.json"),
      scope: "project",
    });
    const credentialsBackend = assemblyState.assembly.credentialsBackend;
    expect(credentialsBackend && "handlesServer" in credentialsBackend && credentialsBackend.handlesServer("demo-plugin__onlyPlugin", "http://127.0.0.1/mcp")).toBe(true);
  });
});
