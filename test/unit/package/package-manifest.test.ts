import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  files?: string[];
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  scripts?: Record<string, string>;
  exports?: Record<string, unknown>;
  types?: string;
};

const hostPeerPackages = {
  "@earendil-works/pi-ai": { peer: "^0.84.1", dev: "0.84.1" },
  "@earendil-works/pi-tui": { peer: "*", dev: "0.84.1" },
  "typebox": { peer: "*", dev: "1.3.3" },
};

describe("package.json files", () => {
  it("does not compile during dependency installation", () => {
    expect(packageJson.scripts?.prepare).toBeUndefined();
    expect(packageJson.scripts?.prepack).toBe("npm run build:public");
  });

  it("includes built files for public exports", () => {
    const publishedFiles = new Set(packageJson.files ?? []);

    expect(publishedFiles.has("dist")).toBe(true);
    expect(publishedFiles.has("src")).toBe(true);
    for (const file of ["dist/types.js", "dist/config.js", "dist/metadata-cache.js", "dist/src/config/load.js", "dist/src/catalog/metadata-cache.js", "dist/src/config/agent-dir.js", "dist/src/config/agent-plugin-loader.js", "dist/src/config/package-mcp-loader.js", "dist/src/utils.js", "src/runtime/server-manager.ts", "src/auth/mcp-auth.ts", "src/auth/mcp-keyring-helper.cjs", "src/tools/mcp-code.ts", "src/tools/mcp-script-worker.mjs", "src/tools/proxy/dispatcher.ts", "src/tools/proxy/call.ts", "src/commands/handlers.ts", "src/commands/onboarding-state.ts", "src/ui/server.ts", "src/ui/session.ts", "src/ui/resource-handler.ts", "src/ui/stream-types.ts", "src/ui/app-bridge.bundle.js", "src/extension/install.ts", "src/extension/initialization.ts", "src/extension/session.ts", "src/extension/tool-surface.ts", "src/extension/state.ts", "src/extension/owner.ts", "src/extension/status.ts", "src/extension/failure-backoff.ts", "src/catalog/metadata-cache.ts", "src/config/agent-dir.ts", "src/config/agent-plugin-loader.ts", "src/config/package-mcp-loader.ts", "src/tools/prompts.ts", "src/errors.ts", "src/logger.ts", "src/utils.ts", "oauth.ts"]) {
      expect(existsSync(join(repoRoot, file))).toBe(true);
    }
  });

  it("exports source entry points and plain Node host helpers", () => {
    expect(packageJson.types).toBe("./index.ts");
    expect(packageJson.exports).toMatchObject({
      ".": {
        types: "./index.ts",
        import: "./index.ts",
        default: "./index.ts",
      },
      "./types": {
        types: "./dist/types.d.ts",
        import: "./dist/types.js",
        default: "./dist/types.js",
      },
      "./config": {
        types: "./dist/config.d.ts",
        import: "./dist/config.js",
        default: "./dist/config.js",
      },
      "./metadata-cache": {
        types: "./dist/metadata-cache.d.ts",
        import: "./dist/metadata-cache.js",
        default: "./dist/metadata-cache.js",
      },
    });
  });

  it("publishes public facades and source domains without enumerating internals", () => {
    const publishedFiles = new Set(packageJson.files ?? []);
    for (const facade of ["index.ts", "config.ts", "metadata-cache.ts", "types.ts", "oauth.ts", "cli.js"]) {
      expect(publishedFiles.has(facade)).toBe(true);
    }
    expect(publishedFiles.has("src")).toBe(true);
    expect([...publishedFiles].some((entry) => entry.endsWith(".test.ts"))).toBe(false);
    expect(publishedFiles.has("agent-dir.ts")).toBe(false);
    expect(publishedFiles.has("prompts.ts")).toBe(false);
  });

  it("does not import the peer-dependent MCP app bridge from runtime modules", () => {
    const runtimeModules = readdirSync(repoRoot)
      .filter((entry) => entry.endsWith(".ts"))
      .filter((entry) => !entry.endsWith(".test.ts"))
      .filter((entry) => entry !== "vitest.config.ts");

    const offenders = runtimeModules.filter((entry) =>
      readFileSync(join(repoRoot, entry), "utf-8").includes("@modelcontextprotocol/ext-apps/app-bridge")
    );

    expect(offenders).toEqual([]);
  });

  it("keeps tests and fixtures outside the package root", () => {
    const rootTests = readdirSync(repoRoot).filter((entry) => /\.test\.(?:ts|mjs)$/.test(entry));
    expect(rootTests).toEqual([]);
    for (const directory of ["test/unit", "test/integration", "test/node", "test/fixtures"]) {
      expect(existsSync(join(repoRoot, directory))).toBe(true);
    }
  });
});

describe("package.json dependency policy", () => {
  it("treats Pi host packages as optional peers with exact dev pins", () => {
    const entries = Object.entries(hostPeerPackages);

    for (const [name, versions] of entries) {
      expect(packageJson.peerDependencies?.[name]).toBe(versions.peer);
      expect(packageJson.peerDependenciesMeta?.[name]?.optional).toBe(true);
      expect(packageJson.dependencies?.[name]).toBeUndefined();
      expect(packageJson.devDependencies?.[name]).toBe(versions.dev);
    }
  });

  it("uses the stable modular SDK v2 client/core packages without the legacy monolithic SDK", () => {
    expect(packageJson.dependencies?.["@modelcontextprotocol/ext-apps"]).toBeDefined();
    expect(packageJson.dependencies?.["@modelcontextprotocol/sdk"]).toBeUndefined();
    expect(packageJson.dependencies?.["@modelcontextprotocol/client"]).toBe("2.0.0");
    expect(packageJson.dependencies?.["@modelcontextprotocol/core"]).toBe("2.0.0");
    expect(packageJson.devDependencies?.["@modelcontextprotocol/server"]).toBeUndefined();
  });
});
