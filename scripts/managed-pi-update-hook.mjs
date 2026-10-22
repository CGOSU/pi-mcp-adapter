import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { basename, join, relative, sep, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const codingAgentPackageName = "@earendil-works/pi-coding-agent";
const adapterPackageName = "pi-mcp-adapter";
const managedInstallMarker = "managed-install.json";
const adapterRegistryRelativePath = ["scripts", "managed-pi-update-artifacts.json"];
const adapterArtifactsRelativeDir = ["scripts", "managed-pi-update-artifacts"];
const managedReleaseNamePattern = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u;
const semverReleasePattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const defaultLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.error(message),
};

export function isSelfUpdatingPiCommand(args) {
  if (!Array.isArray(args) || args[0] !== "update") return false;
  const options = args.slice(1);
  if (options.includes("--all") || options.includes("--self")) return true;
  if (options.includes("--models") || options.includes("--extensions") || options.includes("--extension")) return false;
  const target = options.find((argument) => !argument.startsWith("-"));
  return target === undefined || target === "self" || target === "pi";
}

function failure(code, message) {
  return { ok: false, code, message };
}

function success(action, fields = {}) {
  return { ok: true, action, ...fields };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateArtifactManifest(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.packageName !== codingAgentPackageName) {
    return failure("invalid-artifact-manifest", "The local Pi patch manifest is invalid.");
  }
  if (!Array.isArray(value.artifacts)) {
    return failure("invalid-artifact-manifest", "The local Pi patch manifest has no artifact list.");
  }

  const versions = new Set();
  for (const artifact of value.artifacts) {
    if (
      !isRecord(artifact) ||
      typeof artifact.packageVersion !== "string" ||
      !/^\d+\.\d+\.\d+$/u.test(artifact.packageVersion) ||
      typeof artifact.releaseAlias !== "string" ||
      !managedReleaseNamePattern.test(artifact.releaseAlias) ||
      semverReleasePattern.test(artifact.releaseAlias) ||
      !artifact.releaseAlias.startsWith(`native-mcp-${artifact.packageVersion}-`) ||
      typeof artifact.baseCommit !== "string" ||
      !/^[0-9a-f]{40}$/u.test(artifact.baseCommit) ||
      typeof artifact.patchPath !== "string" ||
      !/^pi-\d+\.\d+\.\d+-native-mcp-management\.patch$/u.test(artifact.patchPath) ||
      typeof artifact.patchSha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(artifact.patchSha256) ||
      typeof artifact.artifactFile !== "string" ||
      basename(artifact.artifactFile) !== artifact.artifactFile ||
      !artifact.artifactFile.endsWith(".tgz") ||
      typeof artifact.artifactSha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(artifact.artifactSha256) ||
      artifact.protocolId !== "pi.mcp-management" ||
      artifact.protocolVersion !== 1 ||
      !Array.isArray(artifact.capabilities) ||
      !artifact.capabilities.every((item) => typeof item === "string" && item.length > 0) ||
      !Array.isArray(artifact.ownerEvents) ||
      !artifact.ownerEvents.every((item) => typeof item === "string" && item.length > 0)
    ) {
      return failure("invalid-artifact-manifest", "A local Pi patch artifact record is invalid.");
    }
    if (versions.has(artifact.packageVersion)) {
      return failure("invalid-artifact-manifest", "The local Pi patch manifest repeats a package version.");
    }
    versions.add(artifact.packageVersion);
  }
  return success("validated", { manifest: value });
}

async function readManagedInstall(managedRoot) {
  const canonicalRoot = await realpath(managedRoot).catch(() => undefined);
  if (!canonicalRoot) return failure("invalid-managed-install", "The managed Pi installation directory is unavailable.");

  let marker;
  try {
    marker = JSON.parse(await readFile(join(canonicalRoot, managedInstallMarker), "utf8"));
  } catch {
    return failure("invalid-managed-install", "The managed Pi installation marker is missing or invalid.");
  }
  if (
    !isRecord(marker) ||
    marker.kind !== "pi-managed-install" ||
    marker.schemaVersion !== 1 ||
    marker.layout !== "releases-v1"
  ) {
    return failure("invalid-managed-install", "The managed Pi installation marker is not a supported layout.");
  }

  let currentVersion;
  try {
    currentVersion = (await readFile(join(canonicalRoot, "current-version"), "utf8")).trim();
  } catch {
    return failure("invalid-current-version", "The managed Pi current-version pointer cannot be read.");
  }
  if (!managedReleaseNamePattern.test(currentVersion)) {
    return failure("invalid-current-version", "The managed Pi current-version pointer is invalid.");
  }

  const releasesRoot = await realpath(join(canonicalRoot, "releases")).catch(() => undefined);
  if (!releasesRoot) return failure("invalid-managed-release", "The managed Pi releases directory is unavailable.");
  const releaseDir = join(releasesRoot, currentVersion);
  const canonicalRelease = await realpath(releaseDir).catch(() => undefined);
  const relativeRelease = canonicalRelease ? relative(releasesRoot, canonicalRelease) : "..";
  if (!canonicalRelease || relativeRelease === ".." || relativeRelease.startsWith(`..${sep}`)) {
    return failure("invalid-managed-release", "The active managed Pi release is unavailable or outside releases/.");
  }

  return success("managed-install", { managedRoot: canonicalRoot, currentVersion, releaseDir: canonicalRelease });
}

async function packageMetadata(releaseDir) {
  const packageRoot = join(releaseDir, "node_modules", ...codingAgentPackageName.split("/"));
  let metadata;
  try {
    metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  } catch {
    return failure("missing-pi-package", "The active release does not contain a readable Pi coding-agent package.");
  }
  if (metadata.name !== codingAgentPackageName || typeof metadata.version !== "string") {
    return failure("invalid-pi-package", "The active release contains an unexpected Pi package.");
  }
  return success("package", { packageRoot, packageVersion: metadata.version });
}

async function javascriptFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

async function hasNativeManagementApi(packageRoot, artifact) {
  let publicApi;
  try {
    publicApi = await import(pathToFileURL(join(packageRoot, "dist", "index.js")).href);
  } catch {
    return false;
  }
  if (
    publicApi.MCP_MANAGEMENT_PROTOCOL_ID !== "pi.mcp-management" ||
    publicApi.MCP_MANAGEMENT_PROTOCOL_VERSION !== 1 ||
    typeof publicApi.installMcpOwnerAssembly !== "function" ||
    !Array.isArray(publicApi.MCP_MANAGEMENT_CAPABILITIES)
  ) {
    return false;
  }
  if (
    artifact &&
    (artifact.protocolId !== publicApi.MCP_MANAGEMENT_PROTOCOL_ID ||
      artifact.protocolVersion !== publicApi.MCP_MANAGEMENT_PROTOCOL_VERSION ||
      !artifact.capabilities.every((capability) => publicApi.MCP_MANAGEMENT_CAPABILITIES.includes(capability)))
  ) {
    return false;
  }

  if (!artifact) return true;
  const bundleFiles = await javascriptFiles(join(packageRoot, "dist", "bundle"));
  const bundleContents = await Promise.all(bundleFiles.map((file) => readFile(file, "utf8").catch(() => "")));
  const bundleText = bundleContents.join("\n");
  return artifact.ownerEvents.every((eventName) => bundleText.includes(eventName));
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
    env: options.env ?? process.env,
  });
  return result;
}

async function readArtifactRegistry(hookRoot, adapterRoot) {
  // Plan A: prefer the registry shipped by the installed adapter package so a normal extension update
  // makes newly supported Pi versions available to the hook. Fall back to the frozen install copy when
  // the adapter package cannot be located, keeping the previous explicit-trust behavior working.
  const adapterRegistryPath = adapterRoot === undefined
    ? undefined
    : join(adapterRoot, ...adapterRegistryRelativePath);
  if (adapterRegistryPath !== undefined) {
    let adapterValue;
    try {
      adapterValue = JSON.parse(await readFile(adapterRegistryPath, "utf8"));
    } catch {
      adapterValue = undefined;
    }
    if (adapterValue !== undefined) {
      const validation = validateArtifactManifest(adapterValue);
      if (!validation.ok) return validation;
      return success("validated", { manifest: validation.manifest, source: "adapter-package", registryPath: adapterRegistryPath });
    }
  }

  let value;
  try {
    value = JSON.parse(await readFile(join(hookRoot, "artifacts.json"), "utf8"));
  } catch {
    return failure("missing-artifact-manifest", "The persistent Pi patch artifact manifest is unavailable.");
  }
  const validation = validateArtifactManifest(value);
  if (!validation.ok) return validation;
  return success("validated", { manifest: validation.manifest, source: "hook-cache", registryPath: join(hookRoot, "artifacts.json") });
}

// Artifacts are never published inside the adapter package, so a newly registered version is satisfied
// from a caller-supplied artifact directory before falling back to the hook's own persistent cache.
async function resolveArtifactPath(artifact, hookRoot, artifactSourceRoot) {
  const candidates = [];
  if (artifactSourceRoot !== undefined) candidates.push(join(artifactSourceRoot, artifact.artifactFile));
  candidates.push(join(hookRoot, "artifacts", artifact.artifactFile));
  let sawPresentButInvalid = false;
  for (const candidate of candidates) {
    const bytes = await readFile(candidate).catch(() => undefined);
    if (bytes === undefined) continue;
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.artifactSha256) {
      sawPresentButInvalid = true;
      continue;
    }
    return success("artifact-resolved", { artifactPath: candidate });
  }
  if (sawPresentButInvalid) {
    return failure(
      "patch-artifact-hash-mismatch",
      `The registered patched Pi ${artifact.packageVersion} artifact does not match its recorded SHA-256.`,
    );
  }
  return failure(
    "patch-artifact-missing",
    `The registered patched Pi ${artifact.packageVersion} artifact is unavailable.`,
  );
}

async function acquireManagedUpdateLock(managedRoot, releaseDir) {
  try {
    const packageRoot = join(releaseDir, "node_modules", ...codingAgentPackageName.split("/"));
    const requireFromPi = createRequire(join(packageRoot, "package.json"));
    const lockfile = requireFromPi("proper-lockfile");
    const release = await lockfile.lock(join(managedRoot, "update"), { realpath: false });
    return success("locked", { releaseLock: release });
  } catch {
    return failure("managed-update-busy", "Could not acquire Pi's managed-update lock; leaving the core release unchanged.");
  }
}

function runPiVersion(releaseDir) {
  const binName = process.platform === "win32" ? "pi.cmd" : "pi";
  const piBin = join(releaseDir, "node_modules", ".bin", binName);
  const result = execute(piBin, ["--version"], { cwd: releaseDir });
  if (result.error || result.status !== 0) {
    return failure("patched-release-probe-failed", "The patched Pi release failed its --version smoke check.");
  }
  return success("version-probe", { version: result.stdout.trim() });
}

function installEnvironment(stageDir) {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return {
    PATH: process.env.PATH ?? "",
    HOME: home,
    USERPROFILE: process.env.USERPROFILE ?? home,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "",
    npm_config_cache: process.env.PI_MCP_UPDATE_NPM_CACHE ?? join(home, ".npm"),
    npm_config_userconfig: join(stageDir, ".npmrc.user"),
    npm_config_globalconfig: join(stageDir, ".npmrc.global"),
    npm_config_offline: "true",
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_loglevel: "error",
  };
}

async function installArtifact(stageDir, artifactPath, artifact, options) {
  await writeFile(join(stageDir, ".npmrc.user"), "", { mode: 0o600 });
  await writeFile(join(stageDir, ".npmrc.global"), "", { mode: 0o600 });
  await writeFile(
    join(stageDir, "package.json"),
    `${JSON.stringify({ name: "pi-managed-native-mcp-release", private: true, version: "1.0.0" }, null, 2)}\n`,
    { mode: 0o600 },
  );

  const installResult = await options.installPackage({
    stageDir,
    artifactPath,
    artifact,
    execute: options.execute,
  });
  if (!installResult.ok) return installResult;

  await rm(join(stageDir, ".npmrc.user"), { force: true });
  await rm(join(stageDir, ".npmrc.global"), { force: true });
  const releaseMetadata = await packageMetadata(stageDir);
  if (!releaseMetadata.ok || releaseMetadata.packageVersion !== artifact.packageVersion) {
    return failure("patched-release-version-mismatch", "The patched Pi package version did not match its artifact record.");
  }
  if (!await hasNativeManagementApi(releaseMetadata.packageRoot, artifact)) {
    return failure("patched-release-api-missing", "The patched Pi package did not expose the required MCP management API.");
  }
  const cliVersion = runPiVersion(stageDir);
  if (!cliVersion.ok || cliVersion.version !== artifact.packageVersion) {
    return failure("patched-release-probe-failed", "The patched Pi release version did not match its package version.");
  }
  return success("patched-release-verified", { packageRoot: releaseMetadata.packageRoot });
}

async function defaultInstallPackage({ stageDir, artifactPath, execute: executeCommand }) {
  const result = executeCommand(
    "npm",
    ["install", "--offline", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", artifactPath],
    { cwd: stageDir, env: installEnvironment(stageDir) },
  );
  if (result.error || result.status !== 0) {
    return failure("offline-package-install-failed", "Cached dependencies were insufficient to install the verified Pi artifact offline.");
  }
  return success("package-installed");
}

async function atomicWrite(path, contents, mode = 0o600) {
  const temporary = `${path}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(temporary, contents, { mode });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function switchCurrentVersion(managedRoot, expectedVersion, releaseAlias) {
  const currentPath = join(managedRoot, "current-version");
  const currentVersion = (await readFile(currentPath, "utf8")).trim();
  if (currentVersion !== expectedVersion) {
    return failure("current-release-changed", "The active Pi release changed during patch installation; no pointer switch was made.");
  }
  const currentStats = await stat(currentPath);
  await atomicWrite(currentPath, `${releaseAlias}\n`, currentStats.mode & 0o777);
  const activatedVersion = (await readFile(currentPath, "utf8")).trim();
  if (activatedVersion !== releaseAlias) {
    return failure("current-pointer-verification-failed", "The patched Pi release pointer could not be verified.");
  }
  return success("activated", { previousVersion: expectedVersion, currentVersion: releaseAlias });
}

async function persistActivationState(hookRoot, state) {
  const statePath = join(hookRoot, "state.json");
  let previousState;
  try {
    previousState = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    previousState = { schemaVersion: 1 };
  }
  const nextState = {
    ...previousState,
    schemaVersion: 1,
    previousVersion: state.previousVersion,
    patchedVersion: state.patchedVersion,
    packageVersion: state.packageVersion,
    patchSha256: state.patchSha256,
    artifactSha256: state.artifactSha256,
  };
  await atomicWrite(statePath, `${JSON.stringify(nextState, null, 2)}\n`);
}

export async function reconcileManagedPiPatch(options) {
  const logger = options.logger ?? defaultLogger;
  const executeCommand = options.execute ?? execute;
  if (!options.force && !isSelfUpdatingPiCommand(options.updateArgs ?? [])) {
    return success("not-self-update");
  }

  const install = await readManagedInstall(options.managedRoot);
  if (!install.ok) return install;
  const registryResult = await readArtifactRegistry(options.hookRoot, options.adapterRoot);
  if (!registryResult.ok) return registryResult;

  let releaseDir = install.releaseDir;
  let currentVersion = install.currentVersion;
  let activePackage = await packageMetadata(releaseDir);
  if (!activePackage.ok) return activePackage;

  const artifact = registryResult.manifest.artifacts.find((candidate) => candidate.packageVersion === activePackage.packageVersion);
  if (!artifact) {
    const message = `Pi ${activePackage.packageVersion} update completed; no verified native MCP patch is registered. Keeping the core release; the adapter may report missing management APIs.`;
    logger.warn(message);
    return failure("unsupported-pi-version", message);
  }
  if (await hasNativeManagementApi(activePackage.packageRoot, artifact)) {
    return success("already-patched", { currentVersion, packageVersion: activePackage.packageVersion });
  }

  const lockResult = await (options.acquireLock ?? acquireManagedUpdateLock)(install.managedRoot, releaseDir);
  if (!lockResult.ok) return lockResult;
  let releaseLock = lockResult.releaseLock;
  let stageDir;
  try {
    const currentAgain = (await readFile(join(install.managedRoot, "current-version"), "utf8")).trim();
    if (currentAgain !== currentVersion) {
      return failure("current-release-changed", "The active Pi release changed before patch installation; leaving the new core release untouched.");
    }

    releaseDir = join(install.managedRoot, "releases", currentVersion);
    activePackage = await packageMetadata(releaseDir);
    if (!activePackage.ok) return activePackage;
    if (await hasNativeManagementApi(activePackage.packageRoot, artifact)) {
      return success("already-patched", { currentVersion, packageVersion: activePackage.packageVersion });
    }
    if (activePackage.packageVersion !== artifact.packageVersion) {
      return failure("current-release-changed", "The active Pi package changed while resolving its patch artifact.");
    }

    const resolvedArtifact = await resolveArtifactPath(artifact, options.hookRoot, options.artifactSourceRoot);
    if (!resolvedArtifact.ok) return resolvedArtifact;
    const artifactPath = resolvedArtifact.artifactPath;

    const stagingRoot = join(install.managedRoot, "staging");
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    stageDir = await mkdtemp(join(stagingRoot, "mcp-patch-"));
    const stageResult = await installArtifact(stageDir, artifactPath, artifact, {
      execute: executeCommand,
      installPackage: options.installPackage ?? defaultInstallPackage,
    });
    if (!stageResult.ok) return stageResult;

    const releasesRoot = join(install.managedRoot, "releases");
    const patchedReleaseDir = join(releasesRoot, artifact.releaseAlias);
    const existingPatchedRelease = await realpath(patchedReleaseDir).catch(() => undefined);
    if (existingPatchedRelease) {
      const existingMetadata = await packageMetadata(existingPatchedRelease);
      const existingIsValid = existingMetadata.ok &&
        existingMetadata.packageVersion === artifact.packageVersion &&
        await hasNativeManagementApi(existingMetadata.packageRoot, artifact);
      if (!existingIsValid) {
        return failure("patched-release-collision", "A conflicting release already uses the reserved MCP patch release name.");
      }
      await rm(stageDir, { recursive: true, force: true });
      stageDir = undefined;
    } else {
      await rename(stageDir, patchedReleaseDir);
      stageDir = undefined;
    }

    await persistActivationState(options.hookRoot, {
      previousVersion: currentVersion,
      patchedVersion: artifact.releaseAlias,
      packageVersion: artifact.packageVersion,
      patchSha256: artifact.patchSha256,
      artifactSha256: artifact.artifactSha256,
    });
    const switched = await switchCurrentVersion(install.managedRoot, currentVersion, artifact.releaseAlias);
    if (!switched.ok) return switched;
    logger.info(`Installed verified Pi ${artifact.packageVersion} native MCP support in managed release ${artifact.releaseAlias}.`);
    return success("patched", {
      previousVersion: currentVersion,
      currentVersion: artifact.releaseAlias,
      packageVersion: artifact.packageVersion,
    });
  } catch {
    return failure("patch-reconciliation-failed", "The MCP patch could not be activated; the completed Pi core update was kept.");
  } finally {
    if (stageDir) await rm(stageDir, { recursive: true, force: true }).catch(() => {});
    if (typeof releaseLock === "function") await releaseLock().catch(() => {});
  }
}

function parseHookArguments(args) {
  const options = { updateArgs: [] };
  let separatorSeen = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--after-update") options.afterUpdate = true;
    else if (argument === "--apply-current") options.force = true;
    else if (argument === "--managed-root" || argument === "--hook-root" || argument === "--adapter-root" || argument === "--artifact-source") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
      const key = {
        "--managed-root": "managedRoot",
        "--hook-root": "hookRoot",
        "--adapter-root": "adapterRoot",
        "--artifact-source": "artifactSourceRoot",
      }[argument];
      options[key] = resolve(value);
    } else if (argument === "--") {
      separatorSeen = true;
      options.updateArgs = args.slice(index + 1);
      break;
    } else {
      throw new Error(`Unknown managed Pi update hook argument: ${argument}`);
    }
  }
  if (!options.managedRoot || !options.hookRoot) {
    throw new Error("Pass both --managed-root and --hook-root.");
  }
  if (!options.afterUpdate && !options.force) {
    throw new Error("Pass --after-update or --apply-current.");
  }
  if (options.afterUpdate && !separatorSeen) {
    throw new Error("Pass the original Pi update arguments after --.");
  }
  return options;
}

export async function main(args = process.argv.slice(2), logger = defaultLogger) {
  let options;
  try {
    options = parseHookArguments(args);
  } catch (error) {
    logger.warn(error instanceof Error ? error.message : "Invalid managed Pi update hook arguments.");
    return 0;
  }

  const result = await reconcileManagedPiPatch({
    managedRoot: options.managedRoot,
    hookRoot: options.hookRoot,
    ...(options.adapterRoot === undefined ? {} : { adapterRoot: options.adapterRoot }),
    ...(options.artifactSourceRoot === undefined ? {} : { artifactSourceRoot: options.artifactSourceRoot }),
    updateArgs: options.updateArgs,
    force: options.force,
    logger,
  });
  if (!result.ok && result.code !== "unsupported-pi-version") {
    logger.warn(`${result.message} The completed Pi core update was kept.`);
  }
  return 0;
}

// Compare real paths: a launcher may invoke this file through a symlinked path (for example
// /tmp -> /private/tmp on macOS), which never equals import.meta.url. A direct string compare would
// skip main() entirely and still exit 0, silently disabling the post-update hook.
function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  process.exitCode = await main();
}
