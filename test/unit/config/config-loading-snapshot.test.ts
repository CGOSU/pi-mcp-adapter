import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const roots: string[] = [];

afterEach(async () => {
  vi.doUnmock("../../../src/config/read.ts");
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("configuration source snapshots", () => {
  it("reads an exclusive source once while resolving its settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-config-snapshot-"));
    roots.push(root);
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "mcp.json"), JSON.stringify({
      settings: { hostConfigDiscovery: "on" },
      mcpServers: { exact: { command: "node" } },
    }));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("PI_MCP_CONFIG_MODE", "exclusive");

    const readValidatedConfig = vi.fn();
    vi.doMock("../../../src/config/read.ts", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../../src/config/read.ts")>();
      return {
        ...actual,
        readValidatedConfig: vi.fn((...args: Parameters<typeof actual.readValidatedConfig>) => {
          readValidatedConfig();
          return actual.readValidatedConfig(...args);
        }),
      };
    });

    const { loadMcpConfig } = await import("../../../config.ts");
    expect(loadMcpConfig(undefined, root).mcpServers).toEqual({ exact: { command: "node" } });
    expect(readValidatedConfig).toHaveBeenCalledTimes(1);
  });
});
