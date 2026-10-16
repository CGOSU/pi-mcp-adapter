import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedPiCommit = "06a466935536f8c9bcacb2d5efc0fc021be1bdff";
const expectedPiVersion = "1.2.0";
const workspacePackages = ["chord", "tui", "telemetry", "codemode", "mcp", "ai", "agent", "coding-agent"];
const adapterBuildFiles = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "banner.png",
  "cli.js",
  "config.ts",
  "index.ts",
  "metadata-cache.ts",
  "oauth.ts",
  "package.json",
  "tsconfig.json",
  "types.ts",
];
const adapterBuildDirectories = ["extensions", "scripts/build-public.mjs", "skills", "src", "test/node/package"];

function parsePiSourceArgument(args) {
  let source;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      console.log("Usage: npm run test:public-types -- --pi-source <fixed Pi source checkout>");
      process.exit(0);
    }
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
    throw new Error("Provide a Pi checkout explicitly with --pi-source; no machine-local default is used.");
  }
  return resolve(source);
}

function run(command, args, cwd, { capture = false, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = capture ? [result.stdout, result.stderr].filter(Boolean).join("\n").trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed in ${cwd} with exit code ${result.status}.${details ? `\n${details}` : ""}`);
  }
  return capture ? result.stdout : "";
}

function requireFile(path) {
  return readFile(path, "utf8");
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function parsePackResult(output, packageName, destination) {
  const report = JSON.parse(output);
  const packed = Array.isArray(report) ? report[0] : Object.values(report)[0];
  if (!packed || typeof packed.filename !== "string" || !packed.filename.includes(`${packageName}-`)) {
    throw new Error(`npm pack did not produce ${packageName} in ${destination}.`);
  }
  return join(destination, packed.filename);
}

function packPackage(packageRoot, destination, packageName) {
  const output = run(npmCommand(), ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], packageRoot, { capture: true });
  return parsePackResult(output, packageName, destination);
}

async function extractPackage(tarball, destination) {
  await mkdir(destination, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", destination], dirname(tarball));
  return join(destination, "package");
}

function verifyPatchedPiSource(sourceRoot) {
  const packageRoot = join(sourceRoot, "packages", "coding-agent");
  return Promise.all([
    requireFile(join(packageRoot, "package.json")),
    requireFile(join(packageRoot, "src", "index.ts")),
    requireFile(join(packageRoot, "src", "core", "mcp-management.ts")),
  ]).then(async ([packageJsonText, publicEntry, management]) => {
    const packageJson = JSON.parse(packageJsonText);
    if (packageJson.name !== "@earendil-works/pi-coding-agent" || packageJson.version !== expectedPiVersion) {
      throw new Error(`Expected @earendil-works/pi-coding-agent ${expectedPiVersion} at ${packageRoot}.`);
    }
    const sourceHead = run("git", ["rev-parse", "HEAD"], sourceRoot, { capture: true }).trim();
    if (sourceHead !== expectedPiCommit) {
      throw new Error(`Expected fixed Pi baseline ${expectedPiCommit}; found ${sourceHead}.`);
    }
    for (const [content, marker, purpose] of [
      [publicEntry, "installMcpOwnerAssembly", "public owner assembly export"],
      [management, "MCP_MANAGEMENT_PROTOCOL_ID", "versioned public management protocol"],
      [management, "setDirectTools", "persisted directTools management API"],
    ]) {
      if (!content.includes(marker)) throw new Error(`The selected Pi source is missing its ${purpose}.`);
    }
    return { packageRoot, sourceHead };
  });
}

async function copyAdapterBuildInputs(stageRoot) {
  for (const entry of adapterBuildFiles) {
    await cp(join(adapterRoot, entry), join(stageRoot, entry), { recursive: true });
  }
  for (const entry of adapterBuildDirectories) {
    await cp(join(adapterRoot, entry), join(stageRoot, entry), { recursive: true });
  }
}

async function createNodeModulesLinks(sourceRoot, targetRoot, overrides = new Map()) {
  await mkdir(targetRoot, { recursive: true });
  const linked = new Set();

  async function addLink(name, sourcePath, targetPath) {
    await mkdir(dirname(targetPath), { recursive: true });
    const sourceRealPath = await realpath(sourcePath);
    const sourceStat = await lstat(sourceRealPath);
    const linkType = sourceStat.isDirectory() ? (process.platform === "win32" ? "junction" : "dir") : "file";
    await symlink(sourceRealPath, targetPath, linkType);
    linked.add(name);
  }

  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.name === ".package-lock.json") continue;
    const sourcePath = join(sourceRoot, entry.name);
    const targetPath = join(targetRoot, entry.name);
    if (!entry.name.startsWith("@")) {
      await addLink(entry.name, sourcePath, targetPath);
      continue;
    }

    await mkdir(targetPath, { recursive: true });
    for (const scopedPackage of await readdir(sourcePath, { withFileTypes: true })) {
      const packageName = `${entry.name}/${scopedPackage.name}`;
      const packagePath = join(sourcePath, scopedPackage.name);
      await addLink(packageName, overrides.get(packageName) ?? packagePath, join(targetPath, scopedPackage.name));
    }
  }

  for (const [packageName, packagePath] of overrides) {
    if (linked.has(packageName)) continue;
    const separator = packageName.indexOf("/");
    const targetPath = separator < 0
      ? join(targetRoot, packageName)
      : join(targetRoot, packageName.slice(0, separator), packageName.slice(separator + 1));
    await addLink(packageName, packagePath, targetPath);
  }
}

async function addMissingNodeModules(sourceRoot, targetRoot) {
  async function addLink(sourcePath, targetPath) {
    try {
      await lstat(targetPath);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const sourceRealPath = await realpath(sourcePath);
    const sourceStat = await lstat(sourceRealPath);
    const linkType = sourceStat.isDirectory() ? (process.platform === "win32" ? "junction" : "dir") : "file";
    await symlink(sourceRealPath, targetPath, linkType);
  }

  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.name === ".package-lock.json") continue;
    const sourcePath = join(sourceRoot, entry.name);
    const targetPath = join(targetRoot, entry.name);
    if (!entry.name.startsWith("@")) {
      await addLink(sourcePath, targetPath);
      continue;
    }

    await mkdir(targetPath, { recursive: true });
    for (const scopedPackage of await readdir(sourcePath, { withFileTypes: true })) {
      await addLink(join(sourcePath, scopedPackage.name), join(targetPath, scopedPackage.name));
    }
  }
}

async function writeConsumerSource(consumerRoot) {
  await writeFile(join(consumerRoot, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2));
  await writeFile(join(consumerRoot, "consumer.ts"), `import adapter, { createMcpAdapter, registerMcpServer, type McpServerRegistration } from "pi-mcp-adapter";
import { MCP_MANAGEMENT_PROTOCOL_ID, MCP_MANAGEMENT_PROTOCOL_VERSION, type ExtensionAPI, type McpManagementCapability, type McpManagementDirectTools, type McpManagementHandle, type McpManagementResult } from "@earendil-works/pi-coding-agent";
import "pi-mcp-adapter/config";
import "pi-mcp-adapter/metadata-cache";
import "pi-mcp-adapter/oauth";

declare const pi: ExtensionAPI;
const protocol: typeof MCP_MANAGEMENT_PROTOCOL_ID = "pi.mcp-management";
const protocolVersion: typeof MCP_MANAGEMENT_PROTOCOL_VERSION = 1;
const capability: McpManagementCapability = "server.snapshot";
const persistenceCapability: McpManagementCapability = "server.set-direct-tools";
const directTools: McpManagementDirectTools = ["search"];
declare const nativeHandle: McpManagementHandle | undefined;
const persistence: Promise<McpManagementResult<void>> | undefined = nativeHandle?.setDirectTools("fixture", directTools);
const extension: (api: ExtensionAPI) => void = createMcpAdapter({
  config: { mcpServers: { fixture: { command: "fixture-server", args: ["--stdio"] } } },
});
const registration: McpServerRegistration = registerMcpServer({
  pi,
  name: "runtime-fixture",
  definition: { command: "fixture-server", args: ["--stdio"] },
});
const disposed: Promise<void> = registration.dispose();
void [adapter, extension, disposed, protocol, protocolVersion, capability, persistenceCapability, persistence, nativeHandle];
`);
}

async function main() {
  const sourceRoot = parsePiSourceArgument(process.argv.slice(2));
  const { packageRoot, sourceHead } = await verifyPatchedPiSource(sourceRoot);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-mcp-public-types-"));
  const stagedAdapterRoot = join(temporaryRoot, "adapter-build");
  const piPackDirectory = join(temporaryRoot, "pi-package");
  const adapterPackDirectory = join(temporaryRoot, "adapter-package");
  const piExtractRoot = join(temporaryRoot, "pi-extracted");
  const adapterExtractRoot = join(temporaryRoot, "adapter-extracted");
  const consumerRoot = join(temporaryRoot, "consumer");

  try {
    await Promise.all([
      mkdir(piPackDirectory, { recursive: true }),
      mkdir(adapterPackDirectory, { recursive: true }),
      mkdir(stagedAdapterRoot, { recursive: true }),
      mkdir(consumerRoot, { recursive: true }),
    ]);

    const compiler = join(sourceRoot, "node_modules", "typescript", "bin", "tsc");
    for (const workspacePackage of workspacePackages) {
      const workspaceRoot = join(sourceRoot, "packages", workspacePackage);
      run(process.execPath, [compiler, "-p", "tsconfig.build.json", "--noCheck"], workspaceRoot);
    }

    const piTarball = packPackage(packageRoot, piPackDirectory, "pi-coding-agent");
    const packedPiRoot = await extractPackage(piTarball, piExtractRoot);

    await copyAdapterBuildInputs(stagedAdapterRoot);
    const stagedNodeModules = join(stagedAdapterRoot, "node_modules");
    await createNodeModulesLinks(
      join(adapterRoot, "node_modules"),
      stagedNodeModules,
      new Map([["@earendil-works/pi-coding-agent", packedPiRoot]]),
    );
    const piNodeModules = join(packedPiRoot, "node_modules");
    await createNodeModulesLinks(
      join(adapterRoot, "node_modules"),
      piNodeModules,
      new Map([
        ["@earendil-works/pi-coding-agent", packedPiRoot],
        ["@earendil-works/pi-mcp", join(sourceRoot, "packages", "mcp")],
      ]),
    );
    await addMissingNodeModules(join(sourceRoot, "node_modules"), piNodeModules);

    console.log(`Building and checking adapter public artifacts against patched Pi ${expectedPiVersion} at ${sourceHead}.`);
    run(npmCommand(), ["run", "typecheck"], stagedAdapterRoot);
    run(npmCommand(), ["run", "test:public-exports"], stagedAdapterRoot);

    const adapterTarball = packPackage(stagedAdapterRoot, adapterPackDirectory, "pi-mcp-adapter");
    const packedAdapterRoot = await extractPackage(adapterTarball, adapterExtractRoot);
    await writeConsumerSource(consumerRoot);
    await createNodeModulesLinks(
      join(adapterRoot, "node_modules"),
      join(consumerRoot, "node_modules"),
      new Map([
        ["@earendil-works/pi-coding-agent", packedPiRoot],
        ["pi-mcp-adapter", packedAdapterRoot],
      ]),
    );

    const tsc = join(adapterRoot, "node_modules", "typescript", "bin", "tsc");
    run(process.execPath, [
      tsc,
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target", "ES2022",
      "--module", "NodeNext",
      "--moduleResolution", "NodeNext",
      "consumer.ts",
    ], consumerRoot);

    await rm(join(adapterRoot, "dist"), { recursive: true, force: true });
    await cp(join(stagedAdapterRoot, "dist"), join(adapterRoot, "dist"), { recursive: true });
    const generatedFiles = [];
    async function collect(directory, prefix = "") {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await collect(join(directory, entry.name), relativePath);
        else generatedFiles.push(relativePath);
      }
    }
    await collect(join(adapterRoot, "dist"));
    generatedFiles.sort();
    console.log(`Patched Pi public type consumer passed; synchronized ${generatedFiles.length} generated dist files from the validated build.`);
    console.log(`Verified fixed Pi source: ${packageRoot}`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
