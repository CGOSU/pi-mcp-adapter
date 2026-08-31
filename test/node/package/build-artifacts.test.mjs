import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const distRoot = path.resolve(process.cwd(), "dist");
const publicEntries = ["index", "config", "metadata-cache", "types", "oauth"];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(filePath));
    else files.push(filePath);
  }
  return files;
}

function staticImports(source) {
  const imports = new Set();
  for (const match of source.matchAll(/^\s*import\s+[\s\S]*?\sfrom\s+["']([^"']+)["'];/gm)) {
    imports.add(match[1]);
  }
  for (const match of source.matchAll(/^\s*import\s+["']([^"']+)["'];/gm)) {
    imports.add(match[1]);
  }
  return imports;
}

function resolveImport(importer, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = path.resolve(path.dirname(importer), specifier);
  return resolved.endsWith(".js") ? resolved : `${resolved}.js`;
}

async function staticClosure(entry) {
  const closure = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const filePath = pending.pop();
    if (!filePath || closure.has(filePath)) continue;
    closure.add(filePath);
    const source = await readFile(filePath, "utf8");
    for (const specifier of staticImports(source)) {
      const dependency = resolveImport(filePath, specifier);
      if (dependency) pending.push(dependency);
    }
  }
  return closure;
}

test("public entries are split ESM files with bundled declarations", async () => {
  const files = await walk(distRoot);
  const relativeFiles = files.map(filePath => path.relative(distRoot, filePath).split(path.sep).join("/"));

  assert.equal(relativeFiles.some(file => file.endsWith(".map")), false);
  for (const entry of publicEntries) {
    assert.equal(await stat(path.join(distRoot, `${entry}.js`)).then(() => true), true);
    assert.equal(await stat(path.join(distRoot, `${entry}.d.ts`)).then(() => true), true);
  }

  const indexSource = await readFile(path.join(distRoot, "index.js"), "utf8");
  const dynamicImports = [...indexSource.matchAll(/import\(["'](\.\/chunks\/[^"']+)["']\)/g)].map(match => match[1]);
  assert.ok(dynamicImports.length > 0);
  for (const specifier of dynamicImports) {
    assert.equal(await stat(path.resolve(distRoot, specifier)).then(() => true), true, `missing ${specifier}`);
  }
  assert.ok(relativeFiles.some(file => file.startsWith("chunks/")));

  for (const entry of publicEntries) {
    const declaration = await readFile(path.join(distRoot, `${entry}.d.ts`), "utf8");
    assert.doesNotMatch(declaration, /(?:from|export) ["']\./);
  }
});

test("extension startup stays free of delayed runtime modules", async () => {
  const closure = await staticClosure(path.join(distRoot, "index.js"));
  const forbiddenMarkers = [
    "src/auth/mcp-auth-flow.ts",
    "src/auth/mcp-auth.ts",
    "src/auth/mcp-bearer-store.ts",
    "src/auth/mcp-oauth-provider.ts",
    "src/auth/mcp-callback-server.ts",
    "src/auth/oauth-handler.ts",
    "src/commands/handlers.ts",
    "src/commands/onboarding-state.ts",
    "src/runtime/server-manager.ts",
    "src/runtime/lifecycle.ts",
    "src/runtime/session-recovery.ts",
    "src/runtime/npx-resolver.ts",
    "src/runtime/request-headers-command.ts",
    "src/runtime/mcp-probe.ts",
    "src/runtime/mcp-trace.ts",
    "src/runtime/sampling-handler.ts",
    "src/runtime/elicitation-handler.ts",
    "src/runtime/unix-socket-transport.ts",
    "src/runtime/abort.ts",
    "src/ui/server.ts",
    "src/ui/session.ts",
    "src/ui/resource-handler.ts",
    "src/ui/stream-types.ts",
    "src/ui/host-html-template.ts",
    "src/ui/glimpse.ts",
    "src/ui/consent-manager.ts",
    "src/ui/mcp-panel.ts",
    "src/ui/mcp-setup-panel.ts",
    "src/contracts/ui.ts",
    "src/tools/mcp-code.ts",
    "src/tools/direct-tools.ts",
    "src/tools/proxy/",
    "src/tools/tool-registrar.ts",
    "src/tools/mcp-output-guard.ts",
    "src/tools/json-schema-validator.ts",
    "src/config/write.ts",
  ];
  const offenders = [];
  for (const filePath of closure) {
    const source = await readFile(filePath, "utf8");
    if (forbiddenMarkers.some(marker => source.includes(`// ${marker}`))) offenders.push(path.relative(distRoot, filePath));
  }
  assert.deepEqual(offenders, []);
});

test("runtime resources sit beside every built module that resolves them", async () => {
  const resources = [
    { marker: 'new Worker(new URL("./mcp-script-worker.mjs", import.meta.url)', name: "mcp-script-worker.mjs" },
    { marker: 'new URL("./mcp-keyring-helper.cjs", import.meta.url)', name: "mcp-keyring-helper.cjs" },
    { marker: 'path.join(import.meta.dirname, "app-bridge.bundle.js")', name: "app-bridge.bundle.js" },
  ];
  const generatedJavaScript = (await walk(distRoot)).filter(filePath => filePath.endsWith(".js"));

  for (const resource of resources) {
    const consumers = [];
    for (const filePath of generatedJavaScript) {
      if ((await readFile(filePath, "utf8")).includes(resource.marker)) consumers.push(filePath);
    }
    assert.ok(consumers.length > 0, `missing built reference for ${resource.name}`);
    for (const consumer of consumers) {
      assert.equal(await stat(path.join(path.dirname(consumer), resource.name)).then(() => true), true);
    }
  }
});
