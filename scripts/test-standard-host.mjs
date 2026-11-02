import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const adapterRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const piRoot = process.argv[2] && resolve(process.argv[2]);
if (!piRoot) throw new Error("Usage: node scripts/test-standard-host.mjs <stock-pi-package-root>");
const work = await mkdtemp(join(adapterRoot, ".standard-host-test-"));
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
const oldPackageDir = process.env.PI_PACKAGE_DIR;
try {
  process.env.PI_CODING_AGENT_DIR = join(work, "agent");
  process.env.PI_PACKAGE_DIR = piRoot;
  const hostEntry = join(piRoot, "dist/index.js");
  const host = await import(pathToFileURL(hostEntry).href);
  assert.equal(host.MCP_MANAGEMENT_PROTOCOL_ID, undefined, "This smoke test requires stock Pi, not a patched host");
  const output = join(work, "adapter.mjs");
  await build({
    entryPoints: [join(adapterRoot, "index.ts")], outfile: output,
    bundle: true, platform: "node", format: "esm", packages: "external",
    plugins: [{ name: "real-stock-pi", setup(builder) {
      builder.onResolve({ filter: /^@earendil-works\/pi-coding-agent$/ }, () => ({ path: hostEntry, external: true }));
    } }],
    logLevel: "silent",
  });
  const adapter = await import(pathToFileURL(output).href);
  const loader = await import(pathToFileURL(join(piRoot, "dist/core/extensions/loader.js")).href);
  const runtime = loader.createExtensionRuntime();
  let api;
  const extension = await loader.loadExtensionFromFactory((pi) => {
    api = pi;
    adapter.createMcpAdapter({ config: { mcpServers: { fixture: { command: "fixture-not-executed", directTools: true, requestTimeoutMs: 1500 } } } })(pi);
  }, work, host.createEventBus(), runtime);
  const messages = [];
  const context = { cwd: work, hasUI: true, isProjectTrusted: () => false, ui: { notify: (message) => messages.push(message) } };
  for (const handler of extension.handlers.get("session_start") ?? []) await handler({ type: "session_start" }, context);
  assert.equal(runtime.mcpServers.list().length, 1);
  assert.deepEqual(runtime.mcpServers.list()[0].config, {
    command: "fixture-not-executed", enabled: true, exposure: "direct", timeout: 1.5,
  });
  const registration = adapter.registerMcpServer({ pi: api, name: "remote", definition: { url: "https://example.invalid/mcp" } });
  assert.equal(runtime.mcpServers.list().length, 2);
  await registration.dispose();
  await registration.dispose();
  assert.equal(runtime.mcpServers.list().length, 1);
  assert.throws(() => adapter.registerMcpServer({ pi: api, name: "blocked", definition: { command: "fixture", approveTools: true } }), /unsupported/);
  for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown" }, context);
  assert.equal(runtime.mcpServers.list().length, 0);
  assert.ok(messages.some((message) => message.includes("Standard Pi MCP")));
  console.log("PASS: real stock Pi extension loader, config validation, registration and disposal. No server processes or network connections started.");
} finally {
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  if (oldPackageDir === undefined) delete process.env.PI_PACKAGE_DIR;
  else process.env.PI_PACKAGE_DIR = oldPackageDir;
  await rm(work, { recursive: true, force: true });
}
