import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readdir, realpath, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
test("public metadata, config, and type helpers load in plain Node from node_modules", async () => {
  const fixtureRoot = await mkdtemp(path.join(process.cwd(), ".tmp-public-exports-"));
  try {
    const packageRoot = path.join(fixtureRoot, "node_modules", "pi-mcp-adapter");
    const piScopeRoot = path.join(fixtureRoot, "node_modules", "@earendil-works");
    await mkdir(path.dirname(packageRoot), { recursive: true });
    await mkdir(piScopeRoot, { recursive: true });
    await symlink(
      await realpath(path.join(process.cwd(), "node_modules", "@earendil-works", "pi-coding-agent")),
      path.join(piScopeRoot, "pi-coding-agent"),
      process.platform === "win32" ? "junction" : "dir",
    );
    for (const entry of await readdir(process.cwd())) {
      if (entry === "node_modules" || entry === ".git" || entry.startsWith(".tmp-public-exports-")) {
        continue;
      }
      await cp(path.join(process.cwd(), entry), path.join(packageRoot, entry), { recursive: true });
    }
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      [
        'const adapter = await import("pi-mcp-adapter");',
        'const metadata = await import("pi-mcp-adapter/metadata-cache");',
        'const config = await import("pi-mcp-adapter/config");',
        'const oauth = await import("pi-mcp-adapter/oauth");',
        'const types = await import("pi-mcp-adapter/types");',
        'if (typeof adapter.default !== "function") process.exit(2);',
        'if (typeof metadata.isServerCacheValid !== "function") process.exit(3);',
        'if (typeof types.formatToolName !== "function") process.exit(4);',
        'if (typeof config.loadMcpConfig !== "function") process.exit(5);',
        'if (typeof oauth.getMcpOAuthTokensForUrl !== "function") process.exit(6);'
      ].join("\n")
    ], {
      cwd: fixtureRoot,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
