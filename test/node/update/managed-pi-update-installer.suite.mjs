import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  installManagedUpdateHook,
  removeManagedUpdateHook,
} from "../../../scripts/install-managed-pi-update-hook.mjs";
import {
  packageName,
  packageVersion,
  baseCommit,
  releaseAlias,
  protocolId,
  capabilities,
  ownerEvents,
  makeTemporaryRoot,
  quietLogger,
} from "./managed-pi-update-fixtures.mjs";

test("installer backs up and restores only the recognized managed launcher", async () => {
  const root = await makeTemporaryRoot();
  try {
    const agentDir = join(root, "agent");
    const installRoot = join(agentDir, "install");
    const binDir = join(agentDir, "bin");
    const sourceRoot = join(root, "source");
    await mkdir(join(installRoot, "releases", packageVersion), { recursive: true });
    await mkdir(binDir, { recursive: true });
    await mkdir(join(sourceRoot, "patches"), { recursive: true });
    await writeFile(join(installRoot, "managed-install.json"), JSON.stringify({ kind: "pi-managed-install", schemaVersion: 1, layout: "releases-v1" }));
    await writeFile(join(installRoot, "current-version"), `${packageVersion}\n`);
    const originalLauncher = "#!/bin/sh\nPI_MANAGED_INSTALL_ROOT=1\nexec \"$pi_release_bin\" \"$@\"\n";
    await writeFile(join(binDir, "pi"), originalLauncher, { mode: 0o755 });
    await writeFile(join(sourceRoot, "patches", "pi-1.3.0-native-mcp-management.patch"), "synthetic source patch");
    const fakePatchHash = createHash("sha256").update("synthetic source patch").digest("hex");
    const fakeArtifact = Buffer.from("synthetic packed Pi tarball");
    const fakeArtifactHash = createHash("sha256").update(fakeArtifact).digest("hex");
    const artifactManifest = {
      schemaVersion: 1,
      packageName,
      artifacts: [{
        packageVersion,
        releaseAlias,
        baseCommit,
        patchPath: "pi-1.3.0-native-mcp-management.patch",
        patchSha256: fakePatchHash,
        artifactFile: "test-pi.tgz",
        artifactSha256: fakeArtifactHash,
        protocolId,
        protocolVersion: 1,
        capabilities,
        ownerEvents,
      }],
    };
    const artifactPath = join(root, "test-pi.tgz");
    await writeFile(artifactPath, fakeArtifact);
    const reconcile = async () => ({ ok: true, action: "patched", packageVersion, previousVersion: packageVersion, currentVersion: releaseAlias });

    const installed = await installManagedUpdateHook({
      agentDir,
      artifactPath,
      sourceRoot,
      artifactManifest,
      reconcile,
      logger: quietLogger,
    });
    assert.equal(installed.ok, true);
    assert.equal(await readFile(join(binDir, "pi.native-mcp-original"), "utf8"), originalLauncher);
    assert.match(await readFile(join(binDir, "pi"), "utf8"), /PI_NATIVE_MCP_UPDATE_HOOK/u);
    assert.equal(await readFile(join(installRoot, "native-mcp-update", "artifacts", "test-pi.tgz"), "utf8"), fakeArtifact.toString());

    const removed = await removeManagedUpdateHook({ agentDir });
    assert.equal(removed.ok, true);
    assert.equal(await readFile(join(binDir, "pi"), "utf8"), originalLauncher);
    assert.equal((await readFile(join(installRoot, "current-version"), "utf8")).trim(), packageVersion);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installer accepts the registered Pi 1.4.0 tarball and rejects an unregistered one", async () => {
  const root = await makeTemporaryRoot();
  try {
    const agentDir = join(root, "agent");
    const installRoot = join(agentDir, "install");
    const binDir = join(agentDir, "bin");
    const sourceRoot = join(root, "source");
    const version = "1.4.0";
    const alias = "native-mcp-1.4.0-3333333333";
    const base = "4a080252f06caf63a525d7873c5d94d3c23887e0";
    await mkdir(join(installRoot, "releases", version), { recursive: true });
    await mkdir(binDir, { recursive: true });
    await mkdir(join(sourceRoot, "patches"), { recursive: true });
    await writeFile(join(installRoot, "managed-install.json"), JSON.stringify({ kind: "pi-managed-install", schemaVersion: 1, layout: "releases-v1" }));
    await writeFile(join(installRoot, "current-version"), `${version}\n`);
    const originalLauncher = "#!/bin/sh\nPI_MANAGED_INSTALL_ROOT=1\nexec \"$pi_release_bin\" \"$@\"\n";
    await writeFile(join(binDir, "pi"), originalLauncher, { mode: 0o755 });
    const patchText = "synthetic Pi 1.4.0 source patch";
    await writeFile(join(sourceRoot, "patches", "pi-1.4.0-native-mcp-management.patch"), patchText);
    const artifactBytes = Buffer.from("synthetic packed Pi 1.4.0 tarball");
    const artifactManifest = {
      schemaVersion: 1,
      packageName,
      artifacts: [{
        packageVersion: version,
        releaseAlias: alias,
        baseCommit: base,
        patchPath: "pi-1.4.0-native-mcp-management.patch",
        patchSha256: createHash("sha256").update(patchText).digest("hex"),
        artifactFile: "pi-coding-agent-1.4.0.tgz",
        artifactSha256: createHash("sha256").update(artifactBytes).digest("hex"),
        protocolId,
        protocolVersion: 1,
        capabilities,
        ownerEvents,
      }],
    };
    const artifactPath = join(root, "pi-coding-agent-1.4.0.tgz");
    await writeFile(artifactPath, artifactBytes);
    const reconcile = async () => ({ ok: true, action: "patched", packageVersion: version, previousVersion: version, currentVersion: alias });

    const rejected = await installManagedUpdateHook({
      agentDir,
      artifactPath: join(root, "unregistered.tgz"),
      sourceRoot,
      artifactManifest,
      reconcile,
      logger: quietLogger,
    });
    assert.equal(rejected.code, "artifact-required");
    await writeFile(join(root, "unregistered.tgz"), "not a registered artifact");
    const mismatch = await installManagedUpdateHook({
      agentDir,
      artifactPath: join(root, "unregistered.tgz"),
      sourceRoot,
      artifactManifest,
      reconcile,
      logger: quietLogger,
    });
    assert.equal(mismatch.code, "artifact-hash-mismatch");
    assert.equal(await readFile(join(binDir, "pi"), "utf8"), originalLauncher);

    const installed = await installManagedUpdateHook({
      agentDir,
      artifactPath,
      sourceRoot,
      artifactManifest,
      reconcile,
      logger: quietLogger,
    });
    assert.equal(installed.ok, true);
    assert.equal(installed.activation.action, "patched");
    assert.equal(
      await readFile(join(installRoot, "native-mcp-update", "artifacts", "pi-coding-agent-1.4.0.tgz"), "utf8"),
      artifactBytes.toString(),
    );
    assert.match(await readFile(join(binDir, "pi"), "utf8"), /PI_NATIVE_MCP_UPDATE_HOOK/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
