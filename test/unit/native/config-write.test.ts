import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { writeNativeMcpConfigPatch } from "../../../src/native/config-write.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("native MCP config writer", () => {
  it("persists explicit false and arrays while preserving unrelated config", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-write-"));
    roots.push(root);
    const path = join(root, "mcp.json");
    await writeFile(path, `${JSON.stringify({
      settings: { idleTimeout: 7 },
      mcpServers: {
        docs: { command: "docs-server", args: ["--safe"], toolExposure: { hidden: "hidden" } },
        other: { url: "https://example.test/mcp" },
      },
    }, null, 2)}\n`);

    writeNativeMcpConfigPatch(path, "docs", { directTools: false }, false);
    let config = JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
    expect(config.mcpServers.docs.directTools).toBe(false);
    expect(config.mcpServers.docs).toMatchObject({
      command: "docs-server",
      args: ["--safe"],
      toolExposure: { hidden: "hidden" },
    });
    expect(config.mcpServers.other.url).toBe("https://example.test/mcp");
    expect(config.settings.idleTimeout).toBe(7);

    writeNativeMcpConfigPatch(path, "docs", { directTools: ["search", "read_file"] }, false);
    config = JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
    expect(config.mcpServers.docs.directTools).toEqual(["search", "read_file"]);
  });

  it("rejects malformed selections and preserves the original file", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-invalid-write-"));
    roots.push(root);
    const path = join(root, "mcp.json");
    const original = `${JSON.stringify({ mcpServers: { docs: { command: "docs-server" } } }, null, 2)}\n`;
    await writeFile(path, original);

    expect(() => writeNativeMcpConfigPatch(path, "docs", { directTools: ["bad\u0000name"] }, false)).toThrow(
      "The MCP direct-tool selection is invalid.",
    );
    expect(() => writeNativeMcpConfigPatch(path, "docs", { directTools: new Array<string>(1) }, false)).toThrow(
      "The MCP direct-tool selection is invalid.",
    );
    expect(() => writeNativeMcpConfigPatch(
      path,
      "docs",
      { directTools: Array.from({ length: 257 }, (_, index) => `tool-${index}`) },
      false,
    )).toThrow("The MCP direct-tool selection is invalid.");
    expect(() => writeNativeMcpConfigPatch(path, "missing", { directTools: false }, false)).toThrow(
      "The MCP config source no longer contains this server.",
    );
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("returns a safe write failure when the target cannot be replaced", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-native-write-failure-"));
    roots.push(root);
    const blocker = join(root, "not-a-directory");
    await writeFile(blocker, "fixture");
    const target = join(blocker, "mcp.json");
    await mkdir(dirname(target), { recursive: false }).catch(() => undefined);

    expect(() => writeNativeMcpConfigPatch(target, "docs", { directTools: false }, true)).toThrow(
      "The MCP config change could not be written safely.",
    );
  });
});
