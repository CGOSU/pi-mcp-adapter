import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    return extname(entry.name) === ".ts" ? [normalizeRelativePath(entryPath)] : [];
  });
}

const sourceFiles = new Set([
  ...readdirSync(repoRoot)
    .filter((entry) => extname(entry) === ".ts")
    .filter((entry) => !entry.endsWith(".test.ts"))
    .filter((entry) => entry !== "vitest.config.ts")
    .map((entry) => normalizeRelativePath(join(repoRoot, entry))),
  ...collectSourceFiles(join(repoRoot, "src")),
]);

const forbiddenStartupModules = new Set([
  "init.ts",
  "src/extension/initialization.ts",
  "commands.ts",
  "src/commands/handlers.ts",
  "src/commands/onboarding-state.ts",
  "proxy-modes.ts",
  "mcp-auth-flow.ts",
  "src/auth/mcp-auth-flow.ts",
  "src/auth/mcp-auth.ts",
  "src/auth/mcp-bearer-store.ts",
  "src/auth/mcp-oauth-provider.ts",
  "src/auth/mcp-callback-server.ts",
  "src/auth/oauth-handler.ts",
  "mcp-code.ts",
  "src/tools/mcp-code.ts",
  "direct-tools.ts",
  "src/tools/direct-tools.ts",
  "src/tools/proxy/dispatcher.ts",
  "src/tools/proxy/shared.ts",
  "src/tools/proxy/ui-messages.ts",
  "src/tools/proxy/status.ts",
  "src/tools/proxy/auth.ts",
  "src/tools/proxy/catalog.ts",
  "src/tools/proxy/call.ts",
  "src/tools/tool-registrar.ts",
  "src/tools/mcp-output-guard.ts",
  "src/tools/json-schema-validator.ts",
  "server-manager.ts",
  "lifecycle.ts",
  "session-recovery.ts",
  "npx-resolver.ts",
  "request-headers-command.ts",
  "mcp-probe.ts",
  "mcp-trace.ts",
  "sampling-handler.ts",
  "elicitation-handler.ts",
  "unix-socket-transport.ts",
  "abort.ts",
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
  "ui-server.ts",
  "src/ui/server.ts",
  "src/ui/session.ts",
  "src/ui/resource-handler.ts",
  "src/ui/stream-types.ts",
  "src/ui/host-html-template.ts",
  "src/ui/glimpse.ts",
  "src/ui/consent-manager.ts",
  "src/ui/mcp-panel.ts",
  "src/ui/mcp-setup-panel.ts",
  "json-schema-validator.ts",
  "ui-stream-types.ts",
  "src/contracts/ui.ts",
  "src/config/discovery.ts",
  "src/config/write.ts",
]);

function normalizeRelativePath(filePath: string): string {
  return relative(repoRoot, filePath).split(sep).join("/");
}

function resolveLocalImport(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;

  const fromPath = join(repoRoot, fromFile);
  const requestedPath = resolve(dirname(fromPath), specifier);
  const candidates = [
    requestedPath,
    requestedPath.endsWith(".js") ? requestedPath.slice(0, -3) + ".ts" : undefined,
    requestedPath.endsWith(".mjs") ? requestedPath.slice(0, -4) + ".ts" : undefined,
    `${requestedPath}.ts`,
  ].filter((candidate): candidate is string => candidate !== undefined);

  for (const candidate of candidates) {
    const normalized = normalizeRelativePath(candidate);
    if (sourceFiles.has(normalized)) return normalized;
  }
  return undefined;
}

function hasRuntimeImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (!clause.namedBindings) return false;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function hasRuntimeExport(statement: ts.ExportDeclaration): boolean {
  if (statement.isTypeOnly || !statement.moduleSpecifier) return false;
  if (!statement.exportClause) return true;
  if (ts.isNamespaceExport(statement.exportClause)) return true;
  return statement.exportClause.elements.some((element) => !element.isTypeOnly);
}

function collectRuntimeDependencies(fileName: string): Set<string> {
  const source = ts.createSourceFile(
    fileName,
    readFileSync(join(repoRoot, fileName), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const dependencies = new Set<string>();

  for (const statement of source.statements) {
    let specifier: string | undefined;
    let runtime = false;
    if (ts.isImportDeclaration(statement)) {
      runtime = hasRuntimeImport(statement);
      specifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
    } else if (ts.isExportDeclaration(statement)) {
      runtime = hasRuntimeExport(statement);
      specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
    }
    if (!runtime || !specifier) continue;
    const dependency = resolveLocalImport(fileName, specifier);
    if (dependency) dependencies.add(dependency);
  }

  return dependencies;
}

function buildRuntimeGraph(): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const fileName of sourceFiles) graph.set(fileName, collectRuntimeDependencies(fileName));
  return graph;
}

function getRuntimeClosure(graph: Map<string, Set<string>>, root: string): Set<string> {
  const closure = new Set<string>();
  const pending = [root];
  while (pending.length > 0) {
    const fileName = pending.pop();
    if (!fileName || closure.has(fileName)) continue;
    closure.add(fileName);
    for (const dependency of graph.get(fileName) ?? []) pending.push(dependency);
  }
  return closure;
}

describe("startup runtime import graph", () => {
  it("keeps the extension startup closure free of deferred runtime modules", () => {
    const graph = buildRuntimeGraph();
    const closure = getRuntimeClosure(graph, "index.ts");
    const forbidden = [...closure].filter((fileName) => forbiddenStartupModules.has(fileName));

    expect(forbidden).toEqual([]);
  });

  it("keeps internal runtime imports off the public types facade", () => {
    const graph = buildRuntimeGraph();
    const facadeConsumers = [...graph.entries()]
      .filter(([fileName, dependencies]) => fileName !== "types.ts" && dependencies.has("types.ts"))
      .map(([fileName]) => fileName);

    expect(facadeConsumers).toEqual([]);
  });
});
