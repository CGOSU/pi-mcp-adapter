import { build } from "esbuild";
import * as ts from "typescript";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = join(repoRoot, "dist");
const publicEntries = ["index.ts", "config.ts", "metadata-cache.ts", "types.ts", "oauth.ts"];
const runtimeResources = [
  {
    source: "src/auth/mcp-keyring-helper.cjs",
    marker: 'new URL("./mcp-keyring-helper.cjs", import.meta.url)',
  },
];

function sourcePath(entry) {
  return join(repoRoot, entry);
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(entryPath));
    else files.push(entryPath);
  }
  return files;
}

async function buildJavaScript() {
  await rm(distRoot, { recursive: true, force: true });
  await mkdir(distRoot, { recursive: true });

  const baseOptions = {
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node20",
    packages: "external",
    outdir: distRoot,
    entryNames: "[name]",
    chunkNames: "chunks/[name]-[hash]",
    sourcemap: false,
    logLevel: "silent",
  };

  // Build each public entry separately. Shared chunks between the extension and
  // oauth entry would otherwise be hoisted into index.js and defeat startup
  // lazy loading. Each build still splits all of its own dynamic imports.
  for (const entry of publicEntries) {
    await build({ ...baseOptions, entryPoints: [sourcePath(entry)] });
  }

  // The repository CLI intentionally remains a source-level test entry. The
  // published bin uses this bundled copy so production installs do not need
  // TypeScript sources or tsx.
  await build({
    ...baseOptions,
    entryPoints: [sourcePath("cli.js")],
    plugins: [{
      name: "resolve-cli-config-entry",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^\.\/dist\/config\.js$/ }, () => ({
          path: sourcePath("config.ts"),
        }));
      },
    }],
  });
}

function diagnosticText(diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) return message;
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1}: ${message}`;
}

async function emitDeclarations(directory) {
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
    esModuleInterop: true,
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    noEmit: false,
    noEmitOnError: true,
    outDir: directory,
    rootDir: repoRoot,
  };
  const program = ts.createProgram(publicEntries.map(sourcePath), compilerOptions);
  const emitResult = program.emit();
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
  const errors = diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    throw new Error(`Type declaration build failed:\n${errors.map(diagnosticText).join("\n")}`);
  }
}

function resolveDeclarationPath(importer, specifier) {
  let relativeSpecifier = specifier;
  if (/\.(?:[cm]?ts|tsx|jsx|js)$/.test(relativeSpecifier)) {
    relativeSpecifier = relativeSpecifier.replace(/\.(?:[cm]?ts|tsx|jsx|js)$/, ".d.ts");
  } else if (!relativeSpecifier.endsWith(".d.ts")) {
    relativeSpecifier += ".d.ts";
  }
  const candidate = resolve(dirname(importer), relativeSpecifier);
  return candidate.endsWith(".d.ts") ? candidate : `${candidate}.d.ts`;
}

function localSpecifiers(source) {
  const specifiers = new Set();
  for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) specifiers.add(match[1]);
  for (const match of source.matchAll(/\bimport\s*\(\s*["'](\.[^"']+)["']/g)) specifiers.add(match[1]);
  for (const match of source.matchAll(/^\s*import\s+["'](\.[^"']+)["']/gm)) specifiers.add(match[1]);
  return specifiers;
}

function stripLocalModuleDeclarations(source) {
  return source.replace(/^[ \t]*(?:import|export)\b[^\n]*["']\.[^"']+["'][^\n]*;[ \t]*$/gm, "");
}

async function bundleDeclaration(entry, declarationRoot, outputPath, cache) {
  const included = new Set();
  const pieces = [];

  async function include(filePath) {
    if (included.has(filePath)) return;
    included.add(filePath);
    const source = await readFile(filePath, "utf8");
    for (const specifier of localSpecifiers(source)) {
      const dependency = resolveDeclarationPath(filePath, specifier);
      if (dependency.startsWith(declarationRoot) && cache.has(dependency)) await include(dependency);
    }
    pieces.push(stripLocalModuleDeclarations(source).trim());
  }

  await include(entry);
  const content = `${pieces.filter(Boolean).join("\n\n")}\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
}

async function buildDeclarations() {
  const declarationRoot = await mkdtemp(join(tmpdir(), "pi-mcp-public-dts-"));
  try {
    await emitDeclarations(declarationRoot);
    const declarationFiles = new Set((await walkFiles(declarationRoot)).filter(file => extname(file) === ".ts" && file.endsWith(".d.ts")));
    for (const entry of publicEntries) {
      const sourceDeclaration = join(declarationRoot, entry.replace(/\.ts$/, ".d.ts"));
      const outputDeclaration = join(distRoot, entry.replace(/\.ts$/, ".d.ts"));
      await bundleDeclaration(sourceDeclaration, declarationRoot, outputDeclaration, declarationFiles);
    }
  } finally {
    await rm(declarationRoot, { recursive: true, force: true });
  }
}

async function copyRuntimeResources() {
  const generatedJavaScript = (await walkFiles(distRoot)).filter(file => extname(file) === ".js");
  for (const resource of runtimeResources) {
    const locations = new Set();
    for (const generatedFile of generatedJavaScript) {
      if ((await readFile(generatedFile, "utf8")).includes(resource.marker)) locations.add(dirname(generatedFile));
    }
    if (locations.size === 0) throw new Error(`Built output does not contain the runtime resource reference: ${resource.marker}`);
    for (const location of locations) {
      await copyFile(sourcePath(resource.source), join(location, resource.source.split("/").at(-1)));
    }
  }
}

await buildJavaScript();
await buildDeclarations();
await copyRuntimeResources();

const files = await walkFiles(distRoot);
const relativeFiles = files.map(file => relative(distRoot, file)).sort();
console.log(`Built ${relativeFiles.length} public files in dist/`);
for (const file of relativeFiles) console.log(`  ${file}`);
