import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceValue = process.env.PI_CODING_AGENT_SOURCE;
if (!sourceValue) throw new Error("PI_CODING_AGENT_SOURCE must be set by the explicit patched-native session runner.");

const piRoot = realpathSync(resolve(sourceValue));
const codingAgentRoot = join(piRoot, "packages", "coding-agent");
const piAiPackageRoot = join(adapterRoot, "node_modules", "@earendil-works", "pi-ai", "dist");

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@earendil-works\/pi-coding-agent$/,
        replacement: join(codingAgentRoot, "src", "index.ts"),
      },
      {
        find: "@pi-patched-native-mcp-extension",
        replacement: join(codingAgentRoot, "src", "extensions", "mcp", "index.ts"),
      },
      {
        find: "@pi-upstream-test-harness",
        replacement: join(codingAgentRoot, "test", "suite", "harness.ts"),
      },
      {
        find: /^@earendil-works\/pi-ai\/compat$/,
        replacement: join(piAiPackageRoot, "compat.js"),
      },
      {
        find: /^@earendil-works\/pi-ai$/,
        replacement: join(piAiPackageRoot, "index.js"),
      },
    ],
  },
  server: {
    fs: { allow: [adapterRoot, piRoot] },
  },
  test: {
    environment: "node",
    include: ["test/integration/native/patched-native-session.test.mjs"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
