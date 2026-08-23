import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const authTests = [
  "oauth-public-api.test.ts",
  "mcp-auth.test.ts",
  "mcp-auth-flow.test.ts",
  "mcp-callback-server.test.ts",
  "mcp-oauth-provider.test.ts",
];
const providerOnly = process.argv.includes("--provider-only");
const selectedTests = providerOnly ? ["mcp-oauth-provider.test.ts"] : authTests;
const testPaths = selectedTests.map((name) => fileURLToPath(new URL(`./auth/${name}`, import.meta.url)));
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "--test-concurrency=1", ...testPaths],
  {
    env: {
      ...process.env,
      PI_MCP_ADAPTER_TEST_AUTH_STORE: "memory",
      PI_MCP_ADAPTER_DISABLE_AUTH_CACHE: "1",
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
