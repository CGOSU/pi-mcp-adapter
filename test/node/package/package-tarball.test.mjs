import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function parsePackReport(output) {
  const starts = [output.indexOf("["), output.indexOf("{")].filter(index => index >= 0);
  const start = Math.min(...starts);
  assert.ok(Number.isFinite(start), output);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < output.length; index++) {
    const character = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[" || character === "{") depth++;
    else if (character === "]" || character === "}") {
      depth--;
      if (depth === 0) return JSON.parse(output.slice(start, index + 1));
    }
  }
  throw new Error("npm pack did not return a complete JSON array.");
}

function runNpmPack() {
  if (process.platform !== "win32") {
    return spawnSync(npm, ["pack", "--dry-run", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    });
  }
  return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm.cmd pack --dry-run --json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
}
const removedRootFacades = new Set([
  "abort.ts",
  "agent-dir.ts",
  "agent-plugin-loader.ts",
  "commands.ts",
  "consent-manager.ts",
  "direct-tool-catalog.ts",
  "direct-tools.ts",
  "elicitation-handler.ts",
  "errors.ts",
  "error-signal.ts",
  "failure-backoff.ts",
  "glimpse-ui.ts",
  "host-html-template.ts",
  "init.ts",
  "json-schema-validator.ts",
  "lifecycle.ts",
  "logger.ts",
  "mcp-code.ts",
  "mcp-output-guard.ts",
  "mcp-panel.ts",
  "mcp-probe.ts",
  "mcp-references.ts",
  "mcp-setup-panel.ts",
  "mcp-status.ts",
  "mcp-trace.ts",
  "namespace-tools.ts",
  "npx-resolver.ts",
  "onboarding-state.ts",
  "package-mcp-loader.ts",
  "panel-keys.ts",
  "prompts.ts",
  "proxy-modes.ts",
  "request-headers-command.ts",
  "resource-tools.ts",
  "runtime-owner.ts",
  "sampling-handler.ts",
  "search-ranking.ts",
  "server-manager.ts",
  "session-recovery.ts",
  "state.ts",
  "tool-approval.ts",
  "tool-metadata.ts",
  "tool-registrar.ts",
  "tool-result-renderer.ts",
  "ts-shape.ts",
  "ui-app-bridge-helpers.ts",
  "ui-resource-handler.ts",
  "ui-server.ts",
  "ui-session.ts",
  "ui-stream-types.ts",
  "ui-tool-visibility.ts",
  "unix-socket-transport.ts",
  "utils.ts",
]);

test("npm pack publishes a small built-only package", () => {
  const result = runNpmPack();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`);
  const report = parsePackReport(result.stdout);
  const metadata = Array.isArray(report) ? report[0] : Object.values(report)[0];
  const files = metadata?.files?.map(file => file.path) ?? [];

  assert.ok(files.length <= 60, `published ${files.length} files`);
  assert.equal(files.some(file => file.startsWith("src/") || file.startsWith("test/")), false);
  assert.equal(files.some(file => file.endsWith(".map")), false);
  assert.equal(files.some(file => removedRootFacades.has(file)), false);
  for (const file of [
    "extensions/index.js",
    "docs/native-mcp-patch.md",
    "docs/native-mcp-protocol.md",
    "patches/pi-1.2.0-native-mcp-management.json",
    "patches/pi-1.2.0-native-mcp-management.patch",
    "patches/pi-1.3.0-native-mcp-management.json",
    "patches/pi-1.3.0-native-mcp-management.patch",
    "dist/index.js",
    "dist/config.js",
    "dist/metadata-cache.js",
    "dist/types.js",
    "dist/oauth.js",
    "dist/cli.js",
    "dist/mcp-keyring-helper.cjs",
  ]) {
    assert.ok(files.includes(file), `missing ${file}`);
  }
});
