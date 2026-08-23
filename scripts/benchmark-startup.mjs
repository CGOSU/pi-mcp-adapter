import { mkdtempSync, rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(repoRoot, "index.ts");
const piCommand = process.env.PI_BIN?.trim() || (process.platform === "win32" ? "pi.cmd" : "pi");
const rpcRequest = '{"id":"commands","type":"get_commands"}\n';

function parseArgs(argv) {
  const options = { runs: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--runs") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) throw new Error("--runs must be a positive integer");
      options.runs = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: npm run benchmark:startup -- [--runs N]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function createIsolatedEnvironment(root) {
  const env = { ...process.env };
  env.HOME = root;
  env.USERPROFILE = root;
  env.HOMEDRIVE = root.slice(0, 2);
  env.HOMEPATH = root.slice(2) || "\\";
  env.PI_CODING_AGENT_DIR = join(root, "pi-agent");
  env.PI_MCP_CONFIG_MODE = "exclusive";
  env.PI_OFFLINE = "1";
  env.PI_TIMING = "1";
  return env;
}

function runPi({ env, extension = false }) {
  const args = [
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
  ];
  if (extension) args.push("-e", extensionPath);
  args.push("--mode", "rpc");

  const started = performance.now();
  const result = spawnPi(args, {
    cwd: repoRoot,
    env,
    input: rpcRequest,
    encoding: "utf8",
    windowsHide: true,
  });
  const wallMs = Math.round(performance.now() - started);

  if (result.error) throw new Error(`Unable to start ${piCommand}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error([
      `${piCommand} exited with code ${result.status ?? "unknown"}`,
      result.stderr?.trim(),
      result.stdout?.trim(),
    ].filter(Boolean).join("\n"));
  }

  const stderr = result.stderr ?? "";
  const moduleImport = matchTiming(stderr, /module import:\s+(\d+)ms/);
  const mainTotal = matchSectionTotal(stderr, "main");
  return { moduleImport, mainTotal, wallMs };
}

function spawnPi(args, options) {
  if (process.platform !== "win32") return spawnSync(piCommand, args, options);

  const commandLine = [piCommand, ...args]
    .map((arg) => quoteWindowsCommandArgument(arg))
    .join(" ");
  return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
    ...options,
    windowsVerbatimArguments: true,
  });
}

function quoteWindowsCommandArgument(argument) {
  return /^[A-Za-z0-9_./\\\\:=+-]+$/.test(argument)
    ? argument
    : `"${argument.replaceAll('"', '\\\\"')}"`;
}

function matchTiming(output, pattern) {
  const match = output.match(pattern);
  return match ? Number(match[1]) : undefined;
}

function matchSectionTotal(output, section) {
  const marker = `Startup Timings: ${section}`;
  const start = output.indexOf(marker);
  if (start < 0) return undefined;
  const sectionOutput = output.slice(start, output.indexOf("----------------", start + marker.length));
  return matchTiming(sectionOutput, /TOTAL:\s+(\d+)ms/);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function summarize(samples) {
  return {
    moduleImport: summarizeMetric(samples.map((sample) => sample.moduleImport)),
    mainTotal: summarizeMetric(samples.map((sample) => sample.mainTotal)),
    wallMs: summarizeMetric(samples.map((sample) => sample.wallMs)),
  };
}

function summarizeMetric(values) {
  const present = values.filter((value) => value !== undefined);
  return present.length === 0 ? "n/a" : `${median(present)}ms`;
}

function printSamples(label, samples) {
  const summary = summarize(samples);
  console.log(`${label}:`);
  console.log(`  module import median: ${summary.moduleImport}`);
  console.log(`  main TOTAL median:    ${summary.mainTotal}`);
  console.log(`  wall median:          ${summary.wallMs}`);
  for (const [index, sample] of samples.entries()) {
    console.log(`  run ${index + 1}: module=${formatMetric(sample.moduleImport)}, main=${formatMetric(sample.mainTotal)}, wall=${sample.wallMs}ms`);
  }
}

function formatMetric(value) {
  return value === undefined ? "n/a" : `${value}ms`;
}

const { runs } = parseArgs(process.argv.slice(2));
const isolatedHome = mkdtempSync(join(tmpdir(), "pi-mcp-startup-benchmark-"));
try {
  const baseEnv = createIsolatedEnvironment(isolatedHome);
  const baseline = Array.from({ length: runs }, () => runPi({ env: baseEnv }));
  const coldEnv = { ...baseEnv, JITI_FS_CACHE: "0" };
  const coldExtension = Array.from({ length: runs }, () => runPi({ env: coldEnv, extension: true }));
  const warmEnv = { ...baseEnv };
  delete warmEnv.JITI_FS_CACHE;
  const warmExtension = Array.from({ length: runs }, () => runPi({ env: warmEnv, extension: true }));

  console.log(`Pi startup benchmark (${runs} fresh RPC run${runs === 1 ? "" : "s"})`);
  console.log(`binary: ${piCommand}`);
  console.log(`extension: ${extensionPath}`);
  printSamples("baseline", baseline);
  printSamples("extension (JITI_FS_CACHE=0)", coldExtension);
  printSamples("extension (Jiti cache)", warmExtension);
} finally {
  rmSync(isolatedHome, { recursive: true, force: true });
}
