import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  isSelfUpdatingPiCommand,
  main as runUpdateHook,
  reconcileManagedPiPatch,
} from "../../../scripts/managed-pi-update-hook.mjs";
import {
  packageName,
  packageVersion,
  baseCommit,
  patchSha256,
  releaseAlias,
  protocolId,
  capabilities,
  ownerEvents,
  makeTemporaryRoot,
  writeRelease,
  makeManagedInstall,
  makeRegistry,
  fakeInstallPackage,
  quietLogger,
} from "./managed-pi-update-fixtures.mjs";

test("selects only update commands that include Pi self-update", () => {
  assert.equal(isSelfUpdatingPiCommand(["update"]), true);
  assert.equal(isSelfUpdatingPiCommand(["update", "--all"]), true);
  assert.equal(isSelfUpdatingPiCommand(["update", "--self"]), true);
  assert.equal(isSelfUpdatingPiCommand(["update", "pi"]), true);
  assert.equal(isSelfUpdatingPiCommand(["update", "self"]), true);
  assert.equal(isSelfUpdatingPiCommand(["update", "--extensions"]), false);
  assert.equal(isSelfUpdatingPiCommand(["update", "--extension", "npm:tool"]), false);
  assert.equal(isSelfUpdatingPiCommand(["update", "--models"]), false);
  assert.equal(isSelfUpdatingPiCommand(["update", "npm:tool"]), false);
  assert.equal(isSelfUpdatingPiCommand(["--version"]), false);
});

test("keeps an unsupported core update and reports that its MCP patch is unavailable", async () => {
  const root = await makeTemporaryRoot();
  try {
    const { managedRoot } = await makeManagedInstall(root, "1.3.1");
    const { hookRoot } = await makeRegistry(root);
    const messages = [];
    const result = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      updateArgs: ["update", "--all"],
      logger: { info: (message) => messages.push(message), warn: (message) => messages.push(message) },
      acquireLock: async () => { throw new Error("unsupported version must skip before locking"); },
      installPackage: async () => { throw new Error("unsupported version must not install"); },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "unsupported-pi-version");
    assert.match(messages.join("\n"), /Keeping the core release/);
    messages.length = 0;
    const hookExitCode = await runUpdateHook(
      ["--after-update", "--managed-root", managedRoot, "--hook-root", hookRoot, "--", "update", "--all"],
      { info: (message) => messages.push(message), warn: (message) => messages.push(message) },
    );
    assert.equal(hookExitCode, 0);
    assert.match(messages.join("\n"), /Keeping the core release/);
    assert.equal((await readFile(join(managedRoot, "current-version"), "utf8")).trim(), "1.3.1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("leaves the active core release untouched when Pi's update lock is busy", async () => {
  const root = await makeTemporaryRoot();
  try {
    const { managedRoot } = await makeManagedInstall(root);
    const { hookRoot } = await makeRegistry(root);
    let installCount = 0;
    const result = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      updateArgs: ["update", "--all"],
      logger: quietLogger,
      acquireLock: async () => ({ ok: false, code: "managed-update-busy", message: "lock busy" }),
      installPackage: async () => { installCount++; throw new Error("must not install without Pi update lock"); },
    });

    assert.equal(result.code, "managed-update-busy");
    assert.equal((await readFile(join(managedRoot, "current-version"), "utf8")).trim(), packageVersion);
    assert.equal(installCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("activates a verified patched release without replacing the stock core release", async () => {
  const root = await makeTemporaryRoot();
  try {
    const { managedRoot, releaseDir } = await makeManagedInstall(root);
    const { hookRoot, artifact } = await makeRegistry(root);
    let released = false;
    const result = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      updateArgs: ["update", "--all"],
      logger: quietLogger,
      acquireLock: async () => ({ ok: true, releaseLock: async () => { released = true; } }),
      installPackage: fakeInstallPackage(artifact),
    });

    assert.deepEqual(result, {
      ok: true,
      action: "patched",
      previousVersion: packageVersion,
      currentVersion: releaseAlias,
      packageVersion,
    });
    assert.equal((await readFile(join(managedRoot, "current-version"), "utf8")).trim(), releaseAlias);
    await assert.rejects(readFile(join(managedRoot, "releases", releaseAlias, ".npmrc.user")), { code: "ENOENT" });
    await assert.rejects(readFile(join(managedRoot, "releases", releaseAlias, ".npmrc.global")), { code: "ENOENT" });
    assert.equal(await readFile(join(releaseDir, "node_modules", ...packageName.split("/"), "dist", "index.js"), "utf8"), "export const stockHost = true;\n");
    assert.equal(released, true);
    assert.deepEqual(JSON.parse(await readFile(join(hookRoot, "state.json"), "utf8")), {
      schemaVersion: 1,
      previousVersion: packageVersion,
      patchedVersion: releaseAlias,
      packageVersion,
      patchSha256,
      artifactSha256: artifact.artifactSha256,
    });

    const secondResult = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      updateArgs: ["update", "--all"],
      logger: quietLogger,
      acquireLock: async () => { throw new Error("already-patched release must skip locking"); },
      installPackage: async () => { throw new Error("already-patched release must not reinstall"); },
    });
    assert.deepEqual(secondResult, { ok: true, action: "already-patched", currentVersion: releaseAlias, packageVersion });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not replace a core release activated concurrently during staging", async () => {
  const root = await makeTemporaryRoot();
  try {
    const { managedRoot } = await makeManagedInstall(root);
    const { hookRoot, artifact } = await makeRegistry(root);
    const installPackage = fakeInstallPackage(artifact);
    const result = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      updateArgs: ["update", "--all"],
      logger: quietLogger,
      acquireLock: async () => ({ ok: true, releaseLock: async () => {} }),
      installPackage: async (options) => {
        await writeRelease(root, "1.3.1");
        await writeFile(join(managedRoot, "current-version"), "1.3.1\n");
        return installPackage(options);
      },
    });

    assert.equal(result.code, "current-release-changed");
    assert.equal((await readFile(join(managedRoot, "current-version"), "utf8")).trim(), "1.3.1");
    assert.equal(JSON.parse(await readFile(join(managedRoot, "releases", releaseAlias, "node_modules", ...packageName.split("/"), "package.json"), "utf8")).version, packageVersion);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps the newly updated core active when artifact validation or installation fails", async () => {
  const root = await makeTemporaryRoot();
  try {
    const { managedRoot } = await makeManagedInstall(root);
    const { hookRoot, artifact } = await makeRegistry(root);
    const artifactPath = join(hookRoot, "artifacts", artifact.artifactFile);
    await writeFile(artifactPath, "tampered package bytes");
    const hashFailure = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      updateArgs: ["update", "--self"],
      logger: quietLogger,
      acquireLock: async () => ({ ok: true, releaseLock: async () => {} }),
      installPackage: fakeInstallPackage(artifact),
    });
    assert.equal(hashFailure.code, "patch-artifact-hash-mismatch");
    assert.equal((await readFile(join(managedRoot, "current-version"), "utf8")).trim(), packageVersion);

    await writeFile(artifactPath, Buffer.from("verified test package bytes"));
    const installFailure = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      updateArgs: ["update", "--self"],
      logger: quietLogger,
      acquireLock: async () => ({ ok: true, releaseLock: async () => {} }),
      installPackage: async () => ({ ok: false, code: "offline-package-install-failed", message: "offline cache miss" }),
    });
    assert.equal(installFailure.code, "offline-package-install-failed");
    assert.equal((await readFile(join(managedRoot, "current-version"), "utf8")).trim(), packageVersion);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not patch the core for extension-only or model-only updates", async () => {
  const root = await makeTemporaryRoot();
  try {
    const { managedRoot } = await makeManagedInstall(root);
    const { hookRoot } = await makeRegistry(root);
    for (const updateArgs of [["update", "--extensions"], ["update", "--models"]]) {
      const result = await reconcileManagedPiPatch({
        managedRoot,
        hookRoot,
        updateArgs,
        logger: quietLogger,
        acquireLock: async () => { throw new Error("non-self update must not acquire the core lock"); },
        installPackage: async () => { throw new Error("non-self update must not install a Pi artifact"); },
      });
      assert.deepEqual(result, { ok: true, action: "not-self-update" });
    }
    assert.equal((await readFile(join(managedRoot, "current-version"), "utf8")).trim(), packageVersion);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("selects the registered Pi 1.4.0 artifact by its own hash and patch", async () => {
  const root = await makeTemporaryRoot();
  try {
    const version = "1.4.0";
    const alias = "native-mcp-1.4.0-2222222222";
    const base = "4a080252f06caf63a525d7873c5d94d3c23887e0";
    const patch = "2".repeat(64);
    const otherPatch = "3".repeat(64);
    const { managedRoot } = await makeManagedInstall(root, version);
    const hookRoot = join(root, "install", "native-mcp-update");
    await mkdir(join(hookRoot, "artifacts"), { recursive: true });
    const v13Bytes = Buffer.from("verified 1.3.0 test package bytes");
    const v14Bytes = Buffer.from("verified 1.4.0 test package bytes");
    const v13 = {
      packageVersion: "1.3.0",
      releaseAlias,
      baseCommit,
      patchPath: "pi-1.3.0-native-mcp-management.patch",
      patchSha256: otherPatch,
      artifactFile: "pi-coding-agent-1.3.0.tgz",
      artifactSha256: createHash("sha256").update(v13Bytes).digest("hex"),
      protocolId,
      protocolVersion: 1,
      capabilities,
      ownerEvents,
    };
    const v14 = {
      ...v13,
      packageVersion: version,
      releaseAlias: alias,
      baseCommit: base,
      patchPath: "pi-1.4.0-native-mcp-management.patch",
      patchSha256: patch,
      artifactFile: "pi-coding-agent-1.4.0.tgz",
      artifactSha256: createHash("sha256").update(v14Bytes).digest("hex"),
    };
    await writeFile(join(hookRoot, "artifacts.json"), JSON.stringify({ schemaVersion: 1, packageName, artifacts: [v13, v14] }));
    await writeFile(join(hookRoot, "artifacts", v14.artifactFile), v14Bytes);

    const result = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      updateArgs: ["update", "--all"],
      logger: quietLogger,
      acquireLock: async () => ({ ok: true, releaseLock: async () => {} }),
      installPackage: fakeInstallPackage(v14),
    });

    assert.deepEqual(result, {
      ok: true,
      action: "patched",
      previousVersion: version,
      currentVersion: alias,
      packageVersion: version,
    });
    assert.equal((await readFile(join(managedRoot, "current-version"), "utf8")).trim(), alias);
    const state = JSON.parse(await readFile(join(hookRoot, "state.json"), "utf8"));
    assert.equal(state.packageVersion, version);
    assert.equal(state.patchSha256, patch);
    assert.equal(state.artifactSha256, v14.artifactSha256);
    assert.equal(
      JSON.parse(await readFile(join(managedRoot, "releases", alias, "node_modules", ...packageName.split("/"), "package.json"), "utf8")).version,
      version,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps an unregistered Pi 1.4.1 core release active and never reuses another version's artifact", async () => {
  const root = await makeTemporaryRoot();
  try {
    const { managedRoot } = await makeManagedInstall(root, "1.4.1");
    const { hookRoot } = await makeRegistry(root);
    let installCount = 0;
    const result = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      updateArgs: ["update", "--all"],
      logger: quietLogger,
      acquireLock: async () => { throw new Error("unsupported version must skip before locking"); },
      installPackage: async () => { installCount++; throw new Error("unsupported version must not install"); },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "unsupported-pi-version");
    assert.equal(installCount, 0);
    assert.equal((await readFile(join(managedRoot, "current-version"), "utf8")).trim(), "1.4.1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prefers the adapter package registry so a normal extension update reaches the hook", async () => {
  const root = await makeTemporaryRoot();
  try {
    const adapterRoot = join(root, "adapter");
    const registryDir = join(adapterRoot, "scripts");
    await mkdir(registryDir, { recursive: true });
    const version = "1.5.0";
    const alias = "native-mcp-1.5.0-4444444444";
    const artifactBytes = Buffer.from("verified 1.5.0 adapter-shipped package bytes");
    const adapterArtifact = {
      packageVersion: version,
      releaseAlias: alias,
      baseCommit: "5".repeat(40),
      patchPath: `pi-${version}-native-mcp-management.patch`,
      patchSha256: "6".repeat(64),
      artifactFile: `pi-coding-agent-${version}.tgz`,
      artifactSha256: createHash("sha256").update(artifactBytes).digest("hex"),
      protocolId,
      protocolVersion: 1,
      capabilities,
      ownerEvents,
    };
    await writeFile(
      join(registryDir, "managed-pi-update-artifacts.json"),
      JSON.stringify({ schemaVersion: 1, packageName, artifacts: [adapterArtifact] }),
    );

    const { managedRoot } = await makeManagedInstall(root, version);
    // The frozen hook cache only knows the older artifact and must not win.
    const hookRoot = join(root, "install", "native-mcp-update");
    await mkdir(join(hookRoot, "artifacts"), { recursive: true });
    await writeFile(
      join(hookRoot, "artifacts.json"),
      JSON.stringify({ schemaVersion: 1, packageName, artifacts: [{ ...adapterArtifact, packageVersion: "1.3.0", releaseAlias }] }),
    );
    // Artifact lives beside the adapter package, not in the hook cache.
    await writeFile(join(adapterRoot, adapterArtifact.artifactFile), artifactBytes);

    const result = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      adapterRoot,
      artifactSourceRoot: adapterRoot,
      updateArgs: ["update", "--all"],
      logger: quietLogger,
      acquireLock: async () => ({ ok: true, releaseLock: async () => {} }),
      installPackage: fakeInstallPackage(adapterArtifact),
    });

    assert.deepEqual(result, {
      ok: true,
      action: "patched",
      previousVersion: version,
      currentVersion: alias,
      packageVersion: version,
    });
    assert.equal((await readFile(join(managedRoot, "current-version"), "utf8")).trim(), alias);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("falls back to the frozen hook registry when no adapter package is reachable", async () => {
  const root = await makeTemporaryRoot();
  try {
    const { managedRoot } = await makeManagedInstall(root);
    const { hookRoot, artifact } = await makeRegistry(root);
    const result = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      adapterRoot: join(root, "missing-adapter"),
      updateArgs: ["update", "--all"],
      logger: quietLogger,
      acquireLock: async () => ({ ok: true, releaseLock: async () => {} }),
      installPackage: fakeInstallPackage(artifact),
    });
    assert.equal(result.ok, true);
    assert.equal(result.action, "patched");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a tampered adapter-shipped artifact and keeps the core release", async () => {
  const root = await makeTemporaryRoot();
  try {
    const adapterRoot = join(root, "adapter");
    const registryDir = join(adapterRoot, "scripts");
    await mkdir(registryDir, { recursive: true });
    const version = "1.5.0";
    const artifactBytes = Buffer.from("the real adapter-shipped bytes");
    const artifact = {
      packageVersion: version,
      releaseAlias: "native-mcp-1.5.0-5555555555",
      baseCommit: "7".repeat(40),
      patchPath: `pi-${version}-native-mcp-management.patch`,
      patchSha256: "8".repeat(64),
      artifactFile: `pi-coding-agent-${version}.tgz`,
      artifactSha256: createHash("sha256").update(artifactBytes).digest("hex"),
      protocolId,
      protocolVersion: 1,
      capabilities,
      ownerEvents,
    };
    await writeFile(
      join(registryDir, "managed-pi-update-artifacts.json"),
      JSON.stringify({ schemaVersion: 1, packageName, artifacts: [artifact] }),
    );
    await writeFile(join(adapterRoot, artifact.artifactFile), "tampered bytes");

    const { managedRoot } = await makeManagedInstall(root, version);
    const hookRoot = join(root, "install", "native-mcp-update");
    await mkdir(hookRoot, { recursive: true });

    const result = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      adapterRoot,
      artifactSourceRoot: adapterRoot,
      updateArgs: ["update", "--all"],
      logger: quietLogger,
      acquireLock: async () => ({ ok: true, releaseLock: async () => {} }),
      installPackage: async () => { throw new Error("tampered artifact must never install"); },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "patch-artifact-hash-mismatch");
    assert.equal((await readFile(join(managedRoot, "current-version"), "utf8")).trim(), version);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ignores an invalid adapter registry instead of trusting it", async () => {
  const root = await makeTemporaryRoot();
  try {
    const adapterRoot = join(root, "adapter");
    const registryDir = join(adapterRoot, "scripts");
    await mkdir(registryDir, { recursive: true });
    await writeFile(
      join(registryDir, "managed-pi-update-artifacts.json"),
      JSON.stringify({ schemaVersion: 1, packageName, artifacts: [{ packageVersion: "1.5.0" }] }),
    );
    const { managedRoot } = await makeManagedInstall(root);
    const { hookRoot } = await makeRegistry(root);
    const result = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      adapterRoot,
      updateArgs: ["update", "--all"],
      logger: quietLogger,
      acquireLock: async () => ({ ok: true, releaseLock: async () => {} }),
      installPackage: async () => { throw new Error("an invalid adapter registry must not install"); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid-artifact-manifest");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports an actionable recovery command when a registered version has no local artifact", async () => {
  const root = await makeTemporaryRoot();
  try {
    const adapterRoot = join(root, "adapter");
    const registryDir = join(adapterRoot, "scripts");
    await mkdir(registryDir, { recursive: true });
    const version = "1.6.0";
    const artifact = {
      packageVersion: version,
      releaseAlias: "native-mcp-1.6.0-6666666666",
      baseCommit: "9".repeat(40),
      patchPath: `pi-${version}-native-mcp-management.patch`,
      patchSha256: "a".repeat(64),
      artifactFile: `pi-coding-agent-${version}.tgz`,
      artifactSha256: "b".repeat(64),
      protocolId,
      protocolVersion: 1,
      capabilities,
      ownerEvents,
    };
    await writeFile(
      join(registryDir, "managed-pi-update-artifacts.json"),
      JSON.stringify({ schemaVersion: 1, packageName, artifacts: [artifact] }),
    );
    const { managedRoot } = await makeManagedInstall(root, version);
    const hookRoot = join(root, "install", "native-mcp-update");
    await mkdir(join(hookRoot, "artifacts"), { recursive: true });

    const messages = [];
    const result = await reconcileManagedPiPatch({
      managedRoot,
      hookRoot,
      adapterRoot,
      updateArgs: ["update", "--all"],
      logger: { info() {}, warn: (message) => messages.push(message) },
      acquireLock: async () => ({ ok: true, releaseLock: async () => {} }),
      installPackage: async () => { throw new Error("a missing artifact must never install"); },
    });
    const output = result.message;

    assert.equal(result.ok, false);
    assert.equal(result.code, "patch-artifact-missing");
    assert.match(output, /is a supported native MCP target/u);
    assert.match(output, /Expected file\s+: .*pi-coding-agent-1\.6\.0\.tgz/u);
    assert.match(output, /Expected SHA-256: b{64}/u);
    assert.match(output, /install:managed-pi-update-hook -- --artifact/u);
    assert.equal((await readFile(join(managedRoot, "current-version"), "utf8")).trim(), version);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
