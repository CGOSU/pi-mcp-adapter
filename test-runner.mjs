import { spawnSync } from "node:child_process";

const npmExecPath = process.env.npm_execpath;
const npm = npmExecPath ?? (process.platform === "win32" ? "npm.cmd" : "npm");
const args = process.argv.slice(2);

function run(script, scriptArgs = []) {
  const commandArgs = ["run", script];
  if (scriptArgs.length > 0) commandArgs.push("--", ...scriptArgs);
  const spawnArgs = npmExecPath ? [npmExecPath, ...commandArgs] : commandArgs;
  const result = spawnSync(npmExecPath ? process.execPath : npm, spawnArgs, {
    stdio: "inherit",
    shell: !npmExecPath && process.platform === "win32",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  return process.exitCode === 0;
}

if (args.length > 0) {
  run("test:vitest", args);
} else if (run("test:vitest")) {
  run("test:public-exports");
}
