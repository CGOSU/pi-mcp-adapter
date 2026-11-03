import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  packageVersion,
  makeTemporaryRoot,
} from "./managed-pi-update-fixtures.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

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
