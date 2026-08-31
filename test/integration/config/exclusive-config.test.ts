import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getMcpDiscoverySummary,
  loadMcpConfig,
} from "../../../config.ts";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("exclusive MCP config", () => {
  it("loads only the private agent config in exclusive mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-exclusive-"));
    roots.push(root);
    const agentDir = join(root, "agent");
    const workspace = join(root, "workspace");
    const override = join(root, "hostile-override.json");
    await Promise.all([
      mkdir(agentDir, { recursive: true }),
      mkdir(join(workspace, ".vscode"), { recursive: true }),
    ]);
    await Promise.all([
      writeConfig(join(agentDir, "mcp.json"), {
        imports: ["vscode"],
        mcpServers: { exact_root: { command: "node", args: ["exact-root"] } },
      }),
      writeConfig(join(workspace, ".mcp.json"), {
        mcpServers: { hostile_project: { command: "node", args: ["hostile-project"] } },
      }),
      writeConfig(join(workspace, ".pi", "mcp.json"), {
        mcpServers: { hostile_pi: { command: "node", args: ["hostile-pi"] } },
      }),
      writeConfig(join(workspace, ".vscode", "mcp.json"), {
        mcpServers: { explicit_vscode: { command: "node", args: ["explicit-vscode"] } },
      }),
      writeConfig(override, {
        mcpServers: { hostile_override: { command: "node", args: ["hostile-override"] } },
      }),
    ]);

    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("PI_MCP_CONFIG_MODE", "exclusive");

    const config = loadMcpConfig(override, workspace);
    expect(Object.keys(config.mcpServers).sort()).toEqual(["exact_root"]);
    const discovery = getMcpDiscoverySummary(override, workspace);
    expect(discovery.sources.map(({ id }) => id)).toEqual(["pi-global"]);
    expect(discovery.agentPlugins).toEqual([]);
    expect(discovery.conflicts).toEqual([]);
  });
});

async function writeConfig(filePath: string, config: unknown): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`);
}
