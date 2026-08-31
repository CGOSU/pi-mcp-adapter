import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  files?: string[];
  bin?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  scripts?: Record<string, string>;
  exports?: Record<string, unknown>;
  types?: string;
  pi?: { extensions?: string[] };
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

  it("includes only built public entries and runtime resources", () => {
    const publishedFiles = new Set(packageJson.files ?? []);

    expect(publishedFiles.has("dist")).toBe(true);
    expect(publishedFiles.has("src")).toBe(false);
    expect(publishedFiles.has("cli.js")).toBe(false);
    for (const file of [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/types.js",
      "dist/types.d.ts",
      "dist/config.js",
      "dist/config.d.ts",
      "dist/metadata-cache.js",
      "dist/metadata-cache.d.ts",
      "dist/oauth.js",
      "dist/oauth.d.ts",
      "dist/cli.js",
      "dist/mcp-keyring-helper.cjs",
    ]) {
      expect(existsSync(join(repoRoot, file))).toBe(true);
    }
  });

  it("exports built entry points and plain Node host helpers", () => {
    expect(packageJson.types).toBe("./dist/index.d.ts");
    expect(packageJson.pi?.extensions).toEqual(["./dist/index.js"]);
    expect(packageJson.bin).toEqual({ "pi-mcp-adapter": "dist/cli.js" });
    expect(packageJson.exports).toMatchObject({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js",
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
      "./oauth": {
        types: "./dist/oauth.d.ts",
        import: "./dist/oauth.js",
        default: "./dist/oauth.js",
      },
    });
  });

  it("publishes bundled entries without enumerating source internals", () => {
    const publishedFiles = new Set(packageJson.files ?? []);
    expect(publishedFiles.has("dist")).toBe(true);
    expect(publishedFiles.has("src")).toBe(false);
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
