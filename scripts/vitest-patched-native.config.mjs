import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceValue = process.env.PI_CODING_AGENT_SOURCE;
if (!sourceValue) throw new Error("PI_CODING_AGENT_SOURCE must be set by the explicit patched-native session runner.");

const piRoot = realpathSync(resolve(sourceValue));
const codingAgentRoot = join(piRoot, "packages", "coding-agent");

// The host and the adapter must share the host's own pi-ai. Aliasing the adapter's pinned pi-ai here
// would mix two pi-ai versions in one session: Pi 1.4.0 imports APIs its own pi-ai provides (such as
// `formatUserAgent`) and its agent loop expects matching message shapes.
const piAiPackageRoot = join(piRoot, "packages", "ai", "dist");
const hostPiAiVersion = JSON.parse(readFileSync(join(piRoot, "packages", "ai", "package.json"), "utf8")).version;
const hostExpectedPiAiVersion = JSON.parse(readFileSync(join(codingAgentRoot, "package.json"), "utf8"))
  .dependencies?.["@earendil-works/pi-ai"];
if (hostPiAiVersion !== hostExpectedPiAiVersion) {
  throw new Error(
    `The host workspace must build its own pi-ai ${hostExpectedPiAiVersion}; found ${hostPiAiVersion}.`,
  );
}

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
        find: "@pi-upstream-oauth-server",
        replacement: join(codingAgentRoot, "test", "suite", "mcp-oauth-server.ts"),
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
