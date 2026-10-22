import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  assertExactPathSet,
  assertFixedCommit,
  assertManagementApi,
  manifestFileForVersion,
  parsePiSourceArgument,
  patchPathsFromDiff,
} from "../../../scripts/patched-pi-source.mjs";

const adapterRoot = path.resolve(import.meta.dirname, "../../..");
const usage = "npm run test:public-types -- --pi-source <fixed Pi source checkout>";

async function readManifest(filename) {
  return JSON.parse(await readFile(path.join(adapterRoot, "patches", filename), "utf8"));
}

function managementSources(manifest) {
  const capabilities = manifest.publicApi.capabilities.map((capability) => `  ${JSON.stringify(capability)}`).join(",\n");
  return {
    publicEntry: `export { ${manifest.publicApi.assemblyExport} } from "./assembly.ts";`,
    management: `export const MCP_MANAGEMENT_PROTOCOL_ID = ${JSON.stringify(manifest.publicApi.protocolId)} as const;
export const MCP_MANAGEMENT_PROTOCOL_VERSION = ${manifest.publicApi.protocolVersion} as const;
export const MCP_MANAGEMENT_CAPABILITIES = Object.freeze([
${capabilities}
] as const);
export interface McpManagementHandle { setDirectTools(name: string): void; }`,
    owner: "createMcpExtensionInstance({}, true)",
    assembly: `export function ${manifest.publicApi.assemblyExport}() {}`,
  };
}

function replaceCapabilities(management, capabilities) {
  const declaration = /export const MCP_MANAGEMENT_CAPABILITIES = Object\.freeze\(\[[\s\S]*?\] as const\);/;
  const values = capabilities.map((capability) => `  ${JSON.stringify(capability)}`).join(",\n");
  return management.replace(declaration, `export const MCP_MANAGEMENT_CAPABILITIES = Object.freeze([\n${values}\n] as const);`);
}

test("keeps the existing Pi 1.2 and 1.3 patches and manifests unchanged", async () => {
  const pi12Manifest = await readFile(path.join(adapterRoot, "patches", "pi-1.2.0-native-mcp-management.json"));
  const pi12Patch = await readFile(path.join(adapterRoot, "patches", "pi-1.2.0-native-mcp-management.patch"));
  const pi13Manifest = await readFile(path.join(adapterRoot, "patches", "pi-1.3.0-native-mcp-management.json"));
  const pi13Patch = await readFile(path.join(adapterRoot, "patches", "pi-1.3.0-native-mcp-management.patch"));

  assert.equal(createHash("sha256").update(pi12Manifest).digest("hex"), "d7507252bc0c98df8f04d33fb0bf10092a128e19ec40e2b5d31dd8f552e664c6");
  assert.equal(createHash("sha256").update(pi12Patch).digest("hex"), "d499d6fba6728dbaced2876149b362780ce4b8ef2129ec3283587a456c46c654");
  assert.equal(createHash("sha256").update(pi13Manifest).digest("hex"), "5768a010e8473a0d6d9dde557e733f5a513e42933bf15b8c61a3a4dd8339bd7e");
  assert.equal(createHash("sha256").update(pi13Patch).digest("hex"), "67df3bb7e8d51dd9f15e66253869d20e5c4c0957f7a331f1a4ba82e2b54eaf33");
});

test("selects only the three explicitly versioned Pi manifests", () => {
  assert.equal(manifestFileForVersion("1.2.0"), "pi-1.2.0-native-mcp-management.json");
  assert.equal(manifestFileForVersion("1.3.0"), "pi-1.3.0-native-mcp-management.json");
  assert.equal(manifestFileForVersion("1.4.0"), "pi-1.4.0-native-mcp-management.json");
  assert.throws(() => manifestFileForVersion("1.3.1"), /Unsupported Pi source version/);
  assert.throws(() => manifestFileForVersion("1.2"), /Supported fixed targets: 1\.2\.0, 1\.3\.0, 1\.4\.0/);
});

test("preserves explicit --pi-source parsing and rejects ambiguous inputs", () => {
  assert.deepEqual(parsePiSourceArgument(["--pi-source", "./pi"], usage), {
    sourceRoot: path.resolve("./pi"),
  });
  assert.deepEqual(parsePiSourceArgument(["--pi-source=./pi"], usage), {
    sourceRoot: path.resolve("./pi"),
  });
  assert.equal(parsePiSourceArgument(["--help"], usage), null);
  assert.throws(() => parsePiSourceArgument([], usage), /--pi-source/);
  assert.throws(() => parsePiSourceArgument(["--pi-source", ""], usage), /--pi-source/);
  assert.throws(() => parsePiSourceArgument(["--pi-source", "one", "--pi-source", "two"], usage), /exactly one/);
  assert.throws(() => parsePiSourceArgument(["--unknown"], usage), /Unknown argument/);
});

test("rejects cross-version fixed commits and incomplete or unrelated source trees", () => {
  const pi13Commit = "71023aec1546d6d677a65669c5665c0927ce0dd0";
  const pi14Commit = "4a080252f06caf63a525d7873c5d94d3c23887e0";
  assertFixedCommit(pi13Commit, pi13Commit, "1.3.0");
  assertFixedCommit(pi14Commit, pi14Commit, "1.4.0");
  assert.throws(
    () => assertFixedCommit(pi13Commit, "06a466935536f8c9bcacb2d5efc0fc021be1bdff", "1.3.0"),
    /Expected fixed Pi 1\.3\.0 baseline/,
  );
  assert.throws(() => assertFixedCommit(pi14Commit, pi13Commit, "1.4.0"), /Expected fixed Pi 1\.4\.0 baseline/);
  assert.throws(() => assertFixedCommit(pi13Commit, pi14Commit, "1.3.0"), /Expected fixed Pi 1\.3\.0 baseline/);
  assert.throws(() => assertExactPathSet(["a.ts", "b.ts"], [], "Pi 1.3.0 source checkout"), /missing: a\.ts, b\.ts/);
  assert.throws(() => assertExactPathSet(["a.ts"], ["a.ts", "unrelated.ts"], "Pi 1.3.0 source checkout"), /unexpected: unrelated\.ts/);
});

test("checks Pi 1.3 patch manifest hashes, paths, protocol, and capabilities", async () => {
  const manifest = await readManifest("pi-1.3.0-native-mcp-management.json");
  const patch = await readFile(path.join(adapterRoot, "patches", manifest.patch.path));
  const patchText = patch.toString("utf8");
  const patchPaths = patchPathsFromDiff(patchText);
  const sources = managementSources(manifest);

  assert.equal(manifest.target.version, "1.3.0");
  assert.equal(manifest.target.baseCommit, "71023aec1546d6d677a65669c5665c0927ce0dd0");
  assert.equal(createHash("sha256").update(patch).digest("hex"), manifest.patch.sha256);
  assert.equal(patch.length, manifest.patch.sizeBytes);
  assert.equal(patchPaths.length, manifest.patch.fileCount);
  assertExactPathSet(manifest.patch.paths, patchPaths, "Pi 1.3.0 manifest");
  assertManagementApi(manifest, sources, "1.3.0");

  const missingCapability = manifest.publicApi.capabilities.slice(0, -1);
  assert.throws(
    () => assertManagementApi(manifest, { ...sources, management: replaceCapabilities(sources.management, missingCapability) }, "1.3.0"),
    /capability set does not match/,
  );
  assert.throws(
    () => assertManagementApi(manifest, { ...sources, management: sources.management.replace("pi.mcp-management", "wrong.protocol") }, "1.3.0"),
    /protocol does not match/,
  );
});

test("checks the Pi 1.4 patch manifest and preserves the 18-capability contract", async () => {
  const manifest = await readManifest("pi-1.4.0-native-mcp-management.json");
  const pi13Manifest = await readManifest("pi-1.3.0-native-mcp-management.json");
  const patch = await readFile(path.join(adapterRoot, "patches", manifest.patch.path));
  const patchPaths = patchPathsFromDiff(patch.toString("utf8"));

  assert.equal(manifestFileForVersion(manifest.target.version), "pi-1.4.0-native-mcp-management.json");
  assert.equal(manifest.target.version, "1.4.0");
  assert.equal(manifest.target.baseCommit, "4a080252f06caf63a525d7873c5d94d3c23887e0");
  assert.notEqual(manifest.patch.path, pi13Manifest.patch.path);
  assert.notEqual(manifest.patch.sha256, pi13Manifest.patch.sha256);
  assert.equal(createHash("sha256").update(patch).digest("hex"), manifest.patch.sha256);
  assert.equal(patch.length, manifest.patch.sizeBytes);
  assert.equal(patchPaths.length, manifest.patch.fileCount);
  assertExactPathSet(manifest.patch.paths, patchPaths, "Pi 1.4.0 manifest");
  assert.equal(manifest.publicApi.capabilities.length, 18);
  assert.deepEqual(manifest.publicApi.capabilities, pi13Manifest.publicApi.capabilities);
  assertManagementApi(manifest, managementSources(manifest), "1.4.0");
});

test("extracts only unambiguous patch paths", () => {
  const patch = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\ndiff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n";
  assert.deepEqual(patchPathsFromDiff(patch), ["src/a.ts", "src/b.ts"]);
  assert.throws(() => patchPathsFromDiff("diff --git a/src/a.ts b/src/other.ts\n"), /changed path/);
});
