import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const packageName = "@earendil-works/pi-coding-agent";
export const packageVersion = "1.3.0";
export const baseCommit = "71023aec1546d6d677a65669c5665c0927ce0dd0";
export const patchSha256 = "1".repeat(64);
export const releaseAlias = "native-mcp-1.3.0-1111111111";
export const protocolId = "pi.mcp-management";
export const capabilities = Object.freeze(["server.snapshot", "server.subscribe", "server.enable"]);
export const ownerEvents = Object.freeze([
  "pi:mcp-management:owner-assembly:request",
  "pi:mcp-management:owner-assembly:install",
  "pi:mcp-management:owner-assembly:release",
]);

export async function makeTemporaryRoot() {
  return await mkdtemp(join(tmpdir(), "pi-managed-update-hook-"));
}

export async function writeRelease(root, version, { patched = false } = {}) {
  const releaseDir = join(root, "install", "releases", version);
  const packageRoot = join(releaseDir, "node_modules", ...packageName.split("/"));
  await mkdir(join(packageRoot, "dist", "bundle", "chunks"), { recursive: true });
  await mkdir(join(releaseDir, "node_modules", ".bin"), { recursive: true });
  await writeFile(join(releaseDir, "node_modules", ".bin", "pi"), `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o755 });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: packageName, version, type: "module" }));
  if (patched) {
    await writeFile(join(packageRoot, "dist", "index.js"), nativePublicEntry());
    await writeFile(join(packageRoot, "dist", "bundle", "chunks", "owner.js"), ownerEvents.join("\n"));
  } else {
    await writeFile(join(packageRoot, "dist", "index.js"), "export const stockHost = true;\n");
    await writeFile(join(packageRoot, "dist", "bundle", "chunks", "owner.js"), "export const stockOwner = true;\n");
  }
  return { releaseDir, packageRoot };
}

function nativePublicEntry() {
  return `export const MCP_MANAGEMENT_PROTOCOL_ID = ${JSON.stringify(protocolId)};
export const MCP_MANAGEMENT_PROTOCOL_VERSION = 1;
export const MCP_MANAGEMENT_CAPABILITIES = Object.freeze(${JSON.stringify(capabilities)});
export function installMcpOwnerAssembly() {}
`;
}

export async function makeManagedInstall(root, currentVersion = packageVersion, releaseOptions = {}) {
  const managedRoot = join(root, "install");
  await mkdir(join(managedRoot, "releases"), { recursive: true });
  await writeFile(join(managedRoot, "managed-install.json"), JSON.stringify({
    kind: "pi-managed-install",
    schemaVersion: 1,
    layout: "releases-v1",
  }));
  await writeFile(join(managedRoot, "current-version"), `${currentVersion}\n`);
  const release = await writeRelease(root, currentVersion, releaseOptions);
  return { managedRoot, ...release };
}

export async function makeRegistry(root) {
  const artifactBytes = Buffer.from("verified test package bytes");
  const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
  const artifact = {
    packageVersion,
    releaseAlias,
    baseCommit,
    patchPath: "pi-1.3.0-native-mcp-management.patch",
    patchSha256,
    artifactFile: "pi-coding-agent-1.3.0.tgz",
    artifactSha256,
    protocolId,
    protocolVersion: 1,
    capabilities,
    ownerEvents,
  };
  const hookRoot = join(root, "install", "native-mcp-update");
  await mkdir(join(hookRoot, "artifacts"), { recursive: true });
  await writeFile(join(hookRoot, "artifacts.json"), JSON.stringify({ schemaVersion: 1, packageName, artifacts: [artifact] }));
  await writeFile(join(hookRoot, "artifacts", artifact.artifactFile), artifactBytes);
  return { hookRoot, artifact };
}

export function fakeInstallPackage(artifact) {
  return async ({ stageDir }) => {
    const packageRoot = join(stageDir, "node_modules", ...packageName.split("/"));
    const binaryRoot = join(stageDir, "node_modules", ".bin");
    await mkdir(join(packageRoot, "dist", "bundle", "chunks"), { recursive: true });
    await mkdir(binaryRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: packageName, version: artifact.packageVersion, type: "module" }));
    await writeFile(join(packageRoot, "dist", "index.js"), nativePublicEntry());
    await writeFile(join(packageRoot, "dist", "bundle", "chunks", "owner.js"), artifact.ownerEvents.join("\n"));
    const piBin = join(binaryRoot, "pi");
    await writeFile(piBin, `#!/bin/sh\nprintf '%s\\n' '${artifact.packageVersion}'\n`, { mode: 0o755 });
    await chmod(piBin, 0o755);
    return { ok: true, action: "installed" };
  };
}

export const quietLogger = Object.freeze({ info() {}, warn() {} });
