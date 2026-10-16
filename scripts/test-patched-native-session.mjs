import { accessSync, constants, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parsePiSourceArgument, verifyPatchedPiSource } from "./patched-pi-source.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed in ${cwd} with exit code ${result.status}.`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function requireFile(path, purpose) {
  try {
    accessSync(path, constants.R_OK);
  } catch {
    throw new Error(`${purpose} is missing or unreadable: ${path}`);
  }
}

function installPublishedPiAiDependency(packageRoot) {
  const scopeRoot = join(packageRoot, "node_modules", "@earendil-works");
  const packageLink = join(scopeRoot, "pi-ai");
  let createdScope = false;
  try {
    lstatSync(scopeRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    mkdirSync(scopeRoot, { recursive: true });
    createdScope = true;
  }
  try {
    lstatSync(packageLink);
    throw new Error(`Refusing to replace an existing Pi AI dependency link: ${packageLink}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const publishedPackage = realpathSync(join(adapterRoot, "node_modules", "@earendil-works", "pi-ai"));
  symlinkSync(publishedPackage, packageLink, process.platform === "win32" ? "junction" : "dir");
  return () => {
    rmSync(packageLink, { force: true });
    if (createdScope) rmdirSync(scopeRoot);
  };
}

function verifyNativeSessionRuntime(sourceRoot) {
  const piAiPackageRoot = join(adapterRoot, "node_modules", "@earendil-works", "pi-ai");
  const piAiPackage = readJson(join(piAiPackageRoot, "package.json"));
  const adapterPackage = readJson(join(adapterRoot, "package.json"));
  const expectedPiAiVersion = adapterPackage.devDependencies?.["@earendil-works/pi-ai"];
  if (piAiPackage.name !== "@earendil-works/pi-ai" || piAiPackage.version !== expectedPiAiVersion) {
    throw new Error(`Expected the adapter's pinned Pi AI test dependency ${expectedPiAiVersion} at ${piAiPackageRoot}.`);
  }
  const publicRuntimeFiles = [
    join(sourceRoot, "node_modules", "vitest", "vitest.mjs"),
    join(piAiPackageRoot, "dist", "compat.js"),
    join(piAiPackageRoot, "dist", "index.js"),
    join(piAiPackageRoot, "dist", "providers", "data", "amazon-bedrock.json"),
    join(sourceRoot, "packages", "agent", "dist", "index.js"),
    join(sourceRoot, "packages", "mcp", "dist", "index.js"),
  ];
  for (const path of publicRuntimeFiles) requireFile(path, "Installed Pi workspace dependency");
}

function isolatedEnvironment(sourceRoot, isolatedRoot) {
  const home = join(isolatedRoot, "home");
  const agentDir = join(isolatedRoot, "pi-agent");
  const configHome = join(home, ".config");
  const env = { ...process.env };

  for (const key of Object.keys(env)) {
    if (/(?:API_KEY|(^|_)(?:TOKEN|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)|^AWS_|^AZURE_|GOOGLE_APPLICATION_CREDENTIALS|OAUTH)/i.test(key)) {
      delete env[key];
    }
  }
  for (const key of ["PI_MCP_CONFIG_MODE", "MCP_DIRECT_TOOLS", "PI_MCP_DIRECT_TOOLS", "MCP_OAUTH_DIR"]) {
    delete env[key];
  }

  env.HOME = home;
  env.USERPROFILE = home;
  env.XDG_CONFIG_HOME = configHome;
  env.PI_CODING_AGENT_DIR = agentDir;
  env.PI_CODING_AGENT_SOURCE = sourceRoot;
  env.PI_MCP_ADAPTER_TEST_AUTH_STORE = "memory";
  env.PI_MCP_ADAPTER_DISABLE_AUTH_CACHE = "1";
  return { env, home, agentDir };
}

async function main() {
  const usage = "npm run test:patched-native-session -- --pi-source <fixed Pi source checkout>";
  const parsedSource = parsePiSourceArgument(process.argv.slice(2), usage);
  if (parsedSource === null) {
    console.log(`Usage: ${usage}`);
    return;
  }
  const { sourceRoot } = parsedSource;
  const { packageRoot, sourceHead, sourceVersion } = await verifyPatchedPiSource(sourceRoot, adapterRoot);
  verifyNativeSessionRuntime(sourceRoot);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "pi-mcp-patched-session-"));
  const { env } = isolatedEnvironment(sourceRoot, temporaryRoot);
  const vitestPath = join(adapterRoot, "node_modules", "vitest", "vitest.mjs");
  requireFile(vitestPath, "Adapter Vitest runner");

  let removePublishedPiAiDependency = () => {};
  try {
    removePublishedPiAiDependency = installPublishedPiAiDependency(packageRoot);
    console.log(`Running same-session native MCP regression against Pi ${sourceVersion} at ${sourceHead}.`);
    run(process.execPath, [
      vitestPath,
      "run",
      "--config",
      join(adapterRoot, "scripts", "vitest-patched-native.config.mjs"),
      join(adapterRoot, "test", "integration", "native", "patched-native-session.test.mjs"),
    ], adapterRoot, env);
    console.log(`Verified patched Pi source checkout: ${packageRoot}`);
  } finally {
    removePublishedPiAiDependency();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
