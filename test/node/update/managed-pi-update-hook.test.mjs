import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  isSelfUpdatingPiCommand,
  main as runUpdateHook,
  reconcileManagedPiPatch,
} from "../../../scripts/managed-pi-update-hook.mjs";
import {
  installManagedUpdateHook,
  removeManagedUpdateHook,
} from "../../../scripts/install-managed-pi-update-hook.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const packageName = "@earendil-works/pi-coding-agent";
const packageVersion = "1.3.0";
const baseCommit = "71023aec1546d6d677a65669c5665c0927ce0dd0";
const patchSha256 = "1".repeat(64);
const releaseAlias = "native-mcp-1.3.0-1111111111";
const protocolId = "pi.mcp-management";
const capabilities = ["server.snapshot", "server.subscribe", "server.enable"];
const ownerEvents = [
  "pi:mcp-management:owner-assembly:request",
  "pi:mcp-management:owner-assembly:install",
  "pi:mcp-management:owner-assembly:release",
];

async function makeTemporaryRoot() {
  return await mkdtemp(join(tmpdir(), "pi-managed-update-hook-"));
}

async function writeRelease(root, version, { patched = false } = {}) {
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

async function makeManagedInstall(root, currentVersion = packageVersion, releaseOptions = {}) {
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

async function makeRegistry(root) {
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

function fakeInstallPackage(artifact) {
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

const quietLogger = { info() {}, warn() {} };

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

test("post-update launcher preserves core updater status and invokes reconciliation only after success", async () => {
  const root = await makeTemporaryRoot();
  try {
    const agentDir = join(root, ".pi", "agent");
    const binDir = join(agentDir, "bin");
    const managedRoot = join(agentDir, "install");
    const hookRoot = join(managedRoot, "native-mcp-update");
    await mkdir(join(managedRoot, "releases", packageVersion), { recursive: true });
    await mkdir(hookRoot, { recursive: true });
    await mkdir(binDir, { recursive: true });
    const updateArgsPath = join(root, "update-args.txt");
    const hookArgsPath = join(root, "hook-args.txt");
    await writeFile(join(managedRoot, "current-version"), `${packageVersion}\n`);
    await writeFile(join(binDir, "pi.native-mcp-original"), `#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$UPDATE_ARGS_PATH\"\nexit \"\${ORIGINAL_EXIT_CODE:-0}\"\n`, { mode: 0o755 });
    await chmod(join(binDir, "pi.native-mcp-original"), 0o755);
    await writeFile(join(hookRoot, "managed-pi-update-hook.mjs"), `import { writeFileSync } from "node:fs"; writeFileSync(process.env.HOOK_ARGS_PATH, process.argv.slice(2).join("\\n")); if (process.env.HOOK_EXIT_CODE) process.exit(Number(process.env.HOOK_EXIT_CODE));\n`);
    const wrapper = await readFile(join(repositoryRoot, "scripts", "managed-pi-update-launcher.sh"), "utf8");
    const wrapperPath = join(binDir, "pi");
    await writeFile(wrapperPath, wrapper, { mode: 0o755 });
    await chmod(wrapperPath, 0o755);
    const localBin = join(root, ".local", "bin");
    await mkdir(localBin, { recursive: true });
    const commandPath = join(localBin, "pi");
    await symlink(wrapperPath, commandPath);

    const env = {
      ...process.env,
      HOME: root,
      UPDATE_ARGS_PATH: updateArgsPath,
      HOOK_ARGS_PATH: hookArgsPath,
      PATH: process.env.PATH,
      ORIGINAL_EXIT_CODE: "0",
    };
    const updateRun = spawnSync(commandPath, ["update", "--all"], { env, encoding: "utf8" });
    assert.equal(updateRun.status, 0, updateRun.stderr);
    assert.match(await readFile(updateArgsPath, "utf8"), /--all/u);
    assert.match(await readFile(hookArgsPath, "utf8"), /--after-update/u);
    assert.match(await readFile(hookArgsPath, "utf8"), /--all/u);

    await rm(hookArgsPath, { force: true });
    env.HOOK_EXIT_CODE = "19";
    const hookFailure = spawnSync(commandPath, ["update", "--all"], { env, encoding: "utf8" });
    assert.equal(hookFailure.status, 0, hookFailure.stderr);
    assert.match(hookFailure.stderr, /completed Pi core update was kept/u);
    await rm(hookArgsPath, { force: true });
    env.HOOK_EXIT_CODE = "";
    env.ORIGINAL_EXIT_CODE = "19";
    const failedCoreUpdate = spawnSync(commandPath, ["update", "--all"], { env, encoding: "utf8" });
    assert.equal(failedCoreUpdate.status, 19);
    assert.equal(await readFile(hookArgsPath, "utf8").catch(() => ""), "");

    env.ORIGINAL_EXIT_CODE = "0";
    const nonUpdate = spawnSync(commandPath, ["--version"], { env, encoding: "utf8" });
    assert.equal(nonUpdate.status, 0);
    assert.equal(await readFile(hookArgsPath, "utf8").catch(() => ""), "");
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
