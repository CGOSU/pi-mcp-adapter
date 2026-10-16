import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, join, resolve, sep } from "node:path";

const codingAgentPackageName = "@earendil-works/pi-coding-agent";
const supportedTargets = new Map([
  ["1.2.0", {
    manifestFile: "pi-1.2.0-native-mcp-management.json",
    baseCommit: "06a466935536f8c9bcacb2d5efc0fc021be1bdff",
    patchPath: "pi-1.2.0-native-mcp-management.patch",
    patchSha256: "d499d6fba6728dbaced2876149b362780ce4b8ef2129ec3283587a456c46c654",
  }],
  ["1.3.0", {
    manifestFile: "pi-1.3.0-native-mcp-management.json",
    baseCommit: "71023aec1546d6d677a65669c5665c0927ce0dd0",
    patchPath: "pi-1.3.0-native-mcp-management.patch",
    patchSha256: "953d4911373cddaa133989515786e247369edb43aad438dfca5170d0a00d3d78",
  }],
]);

export function parsePiSourceArgument(args, usage) {
  let source;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return null;
    if (argument === "--pi-source") {
      if (source !== undefined || args[index + 1] === undefined) {
        throw new Error("Pass exactly one path after --pi-source.");
      }
      source = args[++index];
      continue;
    }
    if (argument.startsWith("--pi-source=")) {
      if (source !== undefined || argument.length === "--pi-source=".length) {
        throw new Error("Pass exactly one non-empty --pi-source path.");
      }
      source = argument.slice("--pi-source=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!source) {
    throw new Error(`Provide a Pi checkout explicitly with --pi-source. Usage: ${usage}`);
  }
  return { sourceRoot: resolve(source) };
}

export function manifestFileForVersion(version) {
  return supportedTargetForVersion(version).manifestFile;
}

export function assertFixedCommit(expectedCommit, actualCommit, sourceVersion) {
  if (actualCommit !== expectedCommit) {
    throw new Error(
      `Expected fixed Pi ${sourceVersion} baseline ${expectedCommit}; found ${actualCommit}.`,
    );
  }
}

export function patchPathsFromDiff(patchText) {
  const paths = [];
  for (const line of patchText.split(/\r?\n/)) {
    if (!line.startsWith("diff --git ")) continue;
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (!match || match[1] !== match[2]) {
      throw new Error(`Cannot safely read a changed path from patch header: ${line}`);
    }
    paths.push(match[1]);
  }
  if (paths.length === 0) throw new Error("The selected Pi patch contains no file changes.");
  if (new Set(paths).size !== paths.length) throw new Error("The selected Pi patch contains duplicate file paths.");
  return paths.sort();
}

export function assertExactPathSet(expectedPaths, actualPaths, description) {
  assertExactSet(expectedPaths, actualPaths, description, "path");
}

export function assertExactSet(expectedItems, actualItems, description, itemName = "item") {
  const expected = normalizeStringList(expectedItems, "Expected", itemName);
  const actual = normalizeStringList(actualItems, "Actual", itemName);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((item) => !actualSet.has(item));
  const unexpected = actual.filter((item) => !expectedSet.has(item));
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
      unexpected.length > 0 ? `unexpected: ${unexpected.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`${description} ${itemName} set does not match (${details}).`);
  }
}

export function assertManagementApi(manifest, { publicEntry, management, owner, assembly }, sourceVersion) {
  const publicApi = manifest.publicApi;
  const protocolId = management.match(/export\s+const\s+MCP_MANAGEMENT_PROTOCOL_ID\s*=\s*["']([^"']+)["']/)?.[1];
  const protocolVersion = Number(
    management.match(/export\s+const\s+MCP_MANAGEMENT_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1],
  );
  const capabilityDeclaration = management.match(
    /export\s+const\s+MCP_MANAGEMENT_CAPABILITIES\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\s+as const\)/,
  )?.[1];
  if (!publicApi || protocolId !== publicApi.protocolId || protocolVersion !== publicApi.protocolVersion) {
    throw new Error(`Pi ${sourceVersion} MCP management protocol does not match its manifest.`);
  }
  if (!capabilityDeclaration) {
    throw new Error(`Pi ${sourceVersion} MCP management capabilities are missing or unrecognized.`);
  }

  const actualCapabilities = [...capabilityDeclaration.matchAll(/["']([^"']+)["']/g)].map(([, capability]) => capability);
  const expectedCapabilities = publicApi.capabilities;
  if (!Array.isArray(expectedCapabilities)) {
    throw new Error(`Pi ${sourceVersion} manifest does not list MCP management capabilities.`);
  }
  assertExactSet(
    expectedCapabilities,
    actualCapabilities,
    `Pi ${sourceVersion} MCP management`,
    "capability",
  );

  const directTools = publicApi.directToolsPersistence;
  if (
    directTools?.capability !== "server.set-direct-tools" ||
    !expectedCapabilities.includes(directTools.capability) ||
    directTools.handleMethod !== "McpManagementHandle.setDirectTools" ||
    directTools.configField !== "directTools" ||
    typeof directTools.executionPolicy !== "string" ||
    !directTools.executionPolicy.includes("session-only") ||
    !management.includes("setDirectTools")
  ) {
    throw new Error(`Pi ${sourceVersion} directTools persistence contract is incomplete or inconsistent.`);
  }
  if (
    typeof publicApi.assemblyExport !== "string" ||
    !publicEntry.includes(publicApi.assemblyExport) ||
    !assembly.includes(publicApi.assemblyExport)
  ) {
    throw new Error(`Pi ${sourceVersion} public MCP owner assembly export is missing.`);
  }
  if (!owner.includes("createMcpExtensionInstance({}, true)")) {
    throw new Error(`Pi ${sourceVersion} built-in native MCP owner factory is missing.`);
  }
}

export async function verifyPatchedPiSource(sourceRoot, adapterRoot) {
  const canonicalSourceRoot = await realpath(sourceRoot).catch(() => {
    throw new Error(`The explicit Pi source checkout is missing or inaccessible: ${sourceRoot}`);
  });
  const packageRoot = join(canonicalSourceRoot, "packages", "coding-agent");
  const packageJson = await readJson(join(packageRoot, "package.json"), "Pi coding-agent package");
  if (!packageJson || typeof packageJson !== "object" || packageJson.name !== codingAgentPackageName) {
    throw new Error(`Expected ${codingAgentPackageName} at ${packageRoot}.`);
  }

  const sourceVersion = packageJson.version;
  const manifestFile = manifestFileForVersion(sourceVersion);
  const manifestPath = join(adapterRoot, "patches", manifestFile);
  const manifest = await readJson(manifestPath, `Pi ${sourceVersion} patch manifest`);
  verifyManifestTarget(manifest, sourceVersion);

  const sourceHead = runGit(["rev-parse", "HEAD"], canonicalSourceRoot).trim();
  assertFixedCommit(manifest.target.baseCommit, sourceHead, sourceVersion);

  const patchPath = resolve(adapterRoot, "patches", manifest.patch.path);
  const patchesRoot = resolve(adapterRoot, "patches") + sep;
  if (!patchPath.startsWith(patchesRoot) || basename(patchPath) !== manifest.patch.path) {
    throw new Error(`Pi ${sourceVersion} manifest has an unsafe patch path.`);
  }
  const patchBuffer = await readFile(patchPath);
  const actualHash = createHash("sha256").update(patchBuffer).digest("hex");
  if (actualHash !== manifest.patch.sha256) {
    throw new Error(`Pi ${sourceVersion} patch SHA-256 does not match its manifest.`);
  }
  if (patchBuffer.length !== manifest.patch.sizeBytes) {
    throw new Error(`Pi ${sourceVersion} patch size does not match its manifest.`);
  }

  const patchPaths = patchPathsFromDiff(patchBuffer.toString("utf8"));
  if (patchPaths.length !== manifest.patch.fileCount) {
    throw new Error(`Pi ${sourceVersion} patch file count does not match its manifest.`);
  }
  if (manifest.patch.paths !== undefined) {
    assertExactPathSet(manifest.patch.paths, patchPaths, `Pi ${sourceVersion} manifest`);
  } else if (sourceVersion !== "1.2.0") {
    throw new Error(`Pi ${sourceVersion} manifest must explicitly list changed paths.`);
  }

  const changedPaths = [
    ...splitLines(runGit(["diff", "--name-only", "--no-renames", "HEAD", "--"], canonicalSourceRoot)),
    ...splitLines(runGit(["ls-files", "--others", "--exclude-standard"], canonicalSourceRoot)),
  ];
  assertExactPathSet(patchPaths, changedPaths, `Pi ${sourceVersion} source checkout`);
  const reverseCheck = spawnSync("git", ["apply", "--reverse", "--check", patchPath], {
    cwd: canonicalSourceRoot,
    encoding: "utf8",
    windowsHide: true,
    stdio: "pipe",
  });
  if (reverseCheck.error) throw reverseCheck.error;
  if (reverseCheck.status !== 0) {
    throw new Error(`The Pi ${sourceVersion} management patch is not fully applied to ${canonicalSourceRoot}.`);
  }

  const [publicEntry, management, owner, assembly] = await Promise.all([
    readFile(join(packageRoot, "src", "index.ts"), "utf8"),
    readFile(join(packageRoot, "src", "core", "mcp-management.ts"), "utf8"),
    readFile(join(packageRoot, "src", "extensions", "mcp", "index.ts"), "utf8"),
    readFile(join(packageRoot, "src", "extensions", "mcp", "assembly.ts"), "utf8"),
  ]);
  assertManagementApi(manifest, { publicEntry, management, owner, assembly }, sourceVersion);
  return { packageRoot, sourceHead, sourceVersion, manifest };
}

function normalizeStringList(values, label, itemName) {
  const plural = itemName === "capability" ? "capabilities" : `${itemName}s`;
  if (!Array.isArray(values) || !values.every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error(`${label} ${plural} must be a list of non-empty strings.`);
  }
  if (new Set(values).size !== values.length) throw new Error(`${label} ${plural} contain duplicates.`);
  return [...values].sort();
}

function verifyManifestTarget(manifest, sourceVersion) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Pi ${sourceVersion} patch manifest must be a JSON object.`);
  }
  const expectedTarget = supportedTargetForVersion(sourceVersion);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.target?.package !== codingAgentPackageName ||
    manifest.target?.version !== sourceVersion ||
    manifest.target?.baseCommit !== expectedTarget.baseCommit ||
    manifest.target?.baseCommit !== manifest.verification?.baseline?.commit ||
    manifest.verification?.baseline?.packageVersion !== sourceVersion ||
    manifest.patch?.path !== expectedTarget.patchPath ||
    manifest.patch?.sha256 !== expectedTarget.patchSha256 ||
    typeof manifest.target?.baseCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(manifest.target.baseCommit) ||
    typeof manifest.patch?.path !== "string" ||
    typeof manifest.patch?.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(manifest.patch.sha256) ||
    !Number.isSafeInteger(manifest.patch?.sizeBytes) ||
    !Number.isSafeInteger(manifest.patch?.fileCount)
  ) {
    throw new Error(`Pi ${sourceVersion} patch manifest has an invalid target or patch record.`);
  }
}

function supportedTargetForVersion(version) {
  const target = supportedTargets.get(version);
  if (!target) {
    throw new Error(
      `Unsupported Pi source version ${JSON.stringify(version)}. Supported fixed targets: ${[...supportedTargets.keys()].join(", ")}.`,
    );
  }
  return target;
}

async function readJson(path, purpose) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`${purpose} is missing or unreadable at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${purpose} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: "pipe" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`git ${args.join(" ")} failed in ${cwd}${details ? `: ${details}` : ""}`);
  }
  return result.stdout;
}

function splitLines(value) {
  return value.split(/\r?\n/).filter(Boolean);
}
