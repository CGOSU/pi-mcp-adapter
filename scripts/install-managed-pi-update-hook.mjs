import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reconcileManagedPiPatch, validateArtifactManifest } from "./managed-pi-update-hook.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(scriptDirectory);
const packageName = "@earendil-works/pi-coding-agent";
const managedMarkerName = "managed-install.json";
const hookDirectoryName = "native-mcp-update";
const originalLauncherName = "pi.native-mcp-original";
const wrapperMarker = "PI_NATIVE_MCP_UPDATE_HOOK";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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

export function parseInstallerArguments(args) {
  const options = { agentDir: join(homedir(), ".pi", "agent"), remove: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return null;
    if (argument === "--remove") {
      options.remove = true;
      continue;
    }
    if (argument === "--agent-dir" || argument === "--artifact") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
      options[argument === "--agent-dir" ? "agentDir" : "artifactPath"] = resolve(value);
      continue;
    }
    throw new Error(`Unknown install-hook argument: ${argument}`);
  }
  options.agentDir = resolve(options.agentDir);
  if (!options.remove && !options.artifactPath) throw new Error("Install requires --artifact <verified Pi tarball>.");
  if (options.remove && options.artifactPath) throw new Error("--remove cannot be combined with --artifact.");
  return options;
}

async function readManagedInstall(agentDir) {
  const managedRoot = join(agentDir, "install");
  let marker;
  try {
    marker = JSON.parse(await readFile(join(managedRoot, managedMarkerName), "utf8"));
  } catch {
    return failure("not-managed-install", `No valid managed Pi install was found at ${managedRoot}.`);
  }
  if (
    !isRecord(marker) ||
    marker.kind !== "pi-managed-install" ||
    marker.schemaVersion !== 1 ||
    marker.layout !== "releases-v1"
  ) {
    return failure("not-managed-install", `The managed Pi install marker at ${managedRoot} is not supported.`);
  }
  return success("managed-install", { managedRoot });
}

async function readArtifactRegistration({ sourceRoot = repositoryRoot, manifestOverride } = {}) {
  let manifest = manifestOverride;
  if (!manifest) {
    const manifestPath = join(sourceRoot, "scripts", "managed-pi-update-artifacts.json");
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      return failure("invalid-artifact-manifest", "The repository's managed-update artifact manifest is unavailable.");
    }
  }
  const validation = validateArtifactManifest(manifest);
  if (!validation.ok || validation.manifest.packageName !== packageName) {
    return failure("invalid-artifact-manifest", "The repository's managed-update artifact manifest is invalid.");
  }

  for (const artifact of validation.manifest.artifacts) {
    const patchPath = join(sourceRoot, "patches", artifact.patchPath);
    const patchBytes = await readFile(patchPath).catch(() => undefined);
    if (!patchBytes || sha256(patchBytes) !== artifact.patchSha256) {
      return failure("patch-hash-mismatch", `The registered Pi ${artifact.packageVersion} source patch failed its SHA-256 check.`);
    }
  }
  return success("artifact-manifest", { manifest: validation.manifest });
}

async function writeAtomic(path, bytes, mode) {
  const temporary = `${path}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(temporary, bytes, { mode });
    await chmod(temporary, mode);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function installHookAssets({ managedRoot, artifactPath, manifest }) {
  const hookRoot = join(managedRoot, hookDirectoryName);
  const artifactDirectory = join(hookRoot, "artifacts");

  const sourceArtifact = await readFile(artifactPath).catch(() => undefined);
  if (!sourceArtifact) return failure("artifact-required", "The supplied Pi tarball is missing or unreadable.");
  const sourceArtifactHash = sha256(sourceArtifact);
  const artifact = manifest.artifacts.find((entry) => entry.artifactSha256 === sourceArtifactHash);
  if (!artifact) {
    return failure("artifact-hash-mismatch", "The supplied Pi tarball does not match any verified SHA-256 registration.");
  }

  const existingHookRoot = await stat(hookRoot).then(() => true).catch(() => false);
  if (existingHookRoot) {
    const ownership = await readFile(join(hookRoot, "install-manifest.json"), "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => undefined);
    if (!isRecord(ownership) || ownership.schemaVersion !== 1 || ownership.owner !== "pi-mcp-adapter-managed-update-hook") {
      return failure("hook-cache-conflict", `An unrecognized directory already exists at ${hookRoot}.`);
    }
  }
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  const storedArtifactPath = join(artifactDirectory, artifact.artifactFile);
  const existingArtifact = await readFile(storedArtifactPath).catch(() => undefined);
  if (existingArtifact && sha256(existingArtifact) !== artifact.artifactSha256) {
    return failure("artifact-cache-conflict", "A different file already occupies the registered Pi artifact cache path.");
  }
  if (!existingArtifact) await writeAtomic(storedArtifactPath, sourceArtifact, 0o600);

  const hookSource = await readFile(join(scriptDirectory, "managed-pi-update-hook.mjs"));
  const registry = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeAtomic(join(hookRoot, "managed-pi-update-hook.mjs"), hookSource, 0o600);
  await writeAtomic(join(hookRoot, "artifacts.json"), registry, 0o600);
  const installerManifest = {
    schemaVersion: 1,
    owner: "pi-mcp-adapter-managed-update-hook",
    artifactManifestSha256: sha256(Buffer.from(registry)),
    launcherBackup: originalLauncherName,
  };
  await writeAtomic(join(hookRoot, "install-manifest.json"), `${JSON.stringify(installerManifest, null, 2)}\n`, 0o600);
  return success("assets-installed", { hookRoot, storedArtifactPath });
}

async function installLauncher(agentDir) {
  const binDirectory = join(agentDir, "bin");
  const launcherPath = join(binDirectory, "pi");
  const backupPath = join(binDirectory, originalLauncherName);
  const templatePath = join(scriptDirectory, "managed-pi-update-launcher.sh");
  const launcherInfo = await lstat(launcherPath).catch(() => undefined);
  if (!launcherInfo?.isFile() || launcherInfo.isSymbolicLink()) {
    return failure("launcher-unrecognized", `Managed Pi launcher must be a regular file at ${launcherPath}.`);
  }
  const launcherContent = await readFile(launcherPath, "utf8").catch(() => undefined);
  if (!launcherContent) return failure("launcher-missing", `Managed Pi launcher is missing at ${launcherPath}.`);

  if (launcherContent.includes(wrapperMarker)) {
    const backup = await readFile(backupPath, "utf8").catch(() => undefined);
    if (!backup || !backup.includes("exec \"$pi_release_bin\" \"$@\"")) {
      return failure("launcher-backup-missing", "The update hook is present but its original Pi launcher backup is missing.");
    }
    return success("launcher-already-installed", { launcherPath, backupPath });
  }

  if (
    !launcherContent.startsWith("#!/bin/sh") ||
    !launcherContent.includes("PI_MANAGED_INSTALL_ROOT") ||
    !launcherContent.includes("exec \"$pi_release_bin\" \"$@\"")
  ) {
    return failure("launcher-unrecognized", "The existing Pi launcher does not match the managed launcher template; it was left untouched.");
  }

  let backupContent;
  try {
    backupContent = await readFile(backupPath, "utf8");
  } catch {
    backupContent = undefined;
  }
  if (backupContent !== undefined && backupContent !== launcherContent) {
    return failure("launcher-backup-conflict", `An unrelated launcher backup already exists at ${backupPath}.`);
  }
  if (backupContent === undefined) {
    const info = await lstat(launcherPath);
    await writeFile(backupPath, launcherContent, { mode: info.mode & 0o777, flag: "wx" });
    await chmod(backupPath, info.mode & 0o777);
  }

  const wrapper = await readFile(templatePath, "utf8");
  const info = await lstat(launcherPath);
  await writeAtomic(launcherPath, wrapper, info.mode & 0o777);
  return success("launcher-installed", { launcherPath, backupPath });
}

export async function removeManagedUpdateHook({ agentDir = join(homedir(), ".pi", "agent") } = {}) {
  const install = await readManagedInstall(resolve(agentDir));
  if (!install.ok) return install;
  const managedRoot = install.managedRoot;
  const launcherPath = join(agentDir, "bin", "pi");
  const backupPath = join(agentDir, "bin", originalLauncherName);
  const hookRoot = join(managedRoot, hookDirectoryName);
  const launcher = await readFile(launcherPath, "utf8").catch(() => undefined);
  const backup = await readFile(backupPath, "utf8").catch(() => undefined);
  const expectedWrapper = await readFile(join(scriptDirectory, "managed-pi-update-launcher.sh"), "utf8");
  if (launcher !== expectedWrapper || !backup) {
    return failure("launcher-hook-not-installed", "The managed Pi launcher changed after hook installation; it was left untouched.");
  }

  const state = await readFile(join(hookRoot, "state.json"), "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => undefined);
  const currentPath = join(managedRoot, "current-version");
  const currentVersion = (await readFile(currentPath, "utf8")).trim();
  if (isRecord(state) && currentVersion === state.patchedVersion && typeof state.previousVersion === "string") {
    const previousRelease = join(managedRoot, "releases", state.previousVersion);
    if (await stat(previousRelease).then(() => true).catch(() => false)) {
      const currentStats = await stat(currentPath);
      await writeAtomic(currentPath, `${state.previousVersion}\n`, currentStats.mode & 0o777);
    }
  }

  const launcherMode = (await stat(launcherPath)).mode & 0o777;
  await writeAtomic(launcherPath, backup, launcherMode);
  return success("launcher-restored", {
    launcherPath,
    preservedHookData: hookRoot,
    preservedPatchedReleases: true,
  });
}

export async function installManagedUpdateHook({
  agentDir = join(homedir(), ".pi", "agent"),
  artifactPath,
  logger = console,
  reconcile = reconcileManagedPiPatch,
  sourceRoot = repositoryRoot,
  artifactManifest,
} = {}) {
  if (!artifactPath) return failure("artifact-required", "Provide the previously verified Pi tarball path.");
  agentDir = resolve(agentDir);
  const install = await readManagedInstall(agentDir);
  if (!install.ok) return install;
  const manifestResult = await readArtifactRegistration({ sourceRoot, manifestOverride: artifactManifest });
  if (!manifestResult.ok) return manifestResult;
  const assets = await installHookAssets({
    managedRoot: install.managedRoot,
    artifactPath: resolve(artifactPath),
    manifest: manifestResult.manifest,
  });
  if (!assets.ok) return assets;

  const launcher = await installLauncher(agentDir);
  if (!launcher.ok) return launcher;

  const activation = await reconcile({
    managedRoot: install.managedRoot,
    hookRoot: assets.hookRoot,
    force: true,
    logger,
  });
  if (!activation.ok) {
    logger.error?.(`${activation.message} The managed update hook is installed; future core updates remain non-blocking.`);
  }
  return success("managed-update-hook-installed", {
    launcherPath: launcher.launcherPath,
    backupPath: launcher.backupPath,
    hookRoot: assets.hookRoot,
    activation,
  });
}

function parseArguments(args) {
  const options = { agentDir: join(homedir(), ".pi", "agent") };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return null;
    if (argument === "--remove") {
      options.remove = true;
      continue;
    }
    if (argument === "--agent-dir" || argument === "--artifact") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
      options[argument === "--agent-dir" ? "agentDir" : "artifactPath"] = resolve(value);
      continue;
    }
    throw new Error(`Unknown installer argument: ${argument}`);
  }
  if (options.remove && options.artifactPath) throw new Error("--remove cannot be combined with --artifact.");
  if (!options.remove && !options.artifactPath) throw new Error("Install requires --artifact <verified Pi tarball>.");
  return options;
}

export async function main(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid managed update hook arguments.");
    return 2;
  }
  if (!options) {
    console.log("Usage: node scripts/install-managed-pi-update-hook.mjs --artifact <verified-pi.tgz> [--agent-dir <dir>]");
    console.log("       node scripts/install-managed-pi-update-hook.mjs --remove [--agent-dir <dir>]");
    return 0;
  }

  const result = options.remove
    ? await removeManagedUpdateHook({ agentDir: options.agentDir })
    : await installManagedUpdateHook({ agentDir: options.agentDir, artifactPath: options.artifactPath });
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  if (options.remove) {
    console.log(`Restored the original Pi launcher at ${result.launcherPath}.`);
    console.log(`Patched release and artifact cache were preserved at ${result.preservedHookData}.`);
    return 0;
  }

  console.log(`Installed non-blocking Pi MCP post-update hook at ${result.launcherPath}.`);
  if (result.activation?.ok && result.activation.action === "patched") {
    console.log(`Activated verified Pi ${result.activation.packageVersion} patched release ${result.activation.currentVersion}.`);
  } else if (result.activation?.ok && result.activation.action === "already-patched") {
    console.log(`The active Pi release already exposes native MCP management.`);
  } else {
    console.error("The Pi core update remains available; this version was not changed by the hook.");
  }
  console.log("Future unknown or failed patch applications will not change the Pi update exit status.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
