import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceFiles = new Set(
  readdirSync(repoRoot)
    .filter((entry) => extname(entry) === ".ts")
    .filter((entry) => !entry.endsWith(".test.ts"))
    .filter((entry) => entry !== "vitest.config.ts"),
);

const forbiddenStartupModules = new Set([
  "init.ts",
  "commands.ts",
  "proxy-modes.ts",
  "mcp-auth-flow.ts",
  "mcp-code.ts",
  "direct-tools.ts",
  "server-manager.ts",
  "ui-server.ts",
  "json-schema-validator.ts",
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
});
