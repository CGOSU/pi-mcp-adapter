import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

describe("cli command surface", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not advertise or dispatch the removed init commands", async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const { main } = await import("../../../cli.js");

    expect(await main(["--help"], (line) => logs.push(line), (line) => errors.push(line))).toBe(0);
    expect(logs.join("\n")).toContain("token set");
    expect(logs.join("\n")).not.toContain("pi-mcp-adapter init");
    expect(logs.join("\n")).not.toContain("discover-host-configs");

    expect(await main(["init"], () => {}, (line) => errors.push(line))).toBe(1);
    expect(await main(["--discover-host-configs"], () => {}, (line) => errors.push(line))).toBe(1);
    expect(errors.join("\n")).toContain("Unknown command");
  });

  it("explains that install now goes through `pi install`", async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const { main } = await import("../../../cli.js");
    const exitCode = await main(["install"], (line) => logs.push(line), (line) => errors.push(line));

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Use `pi install npm:pi-mcp-adapter` instead");
    expect(logs).toEqual([]);
  });
});

describe("cli token helper", () => {
  const originalHome = process.env.HOME;
  const originalAuthStore = process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE;
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.resetModules();
    process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = "memory";
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalAuthStore === undefined) {
      delete process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE;
    } else {
      process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = originalAuthStore;
    }
    process.chdir(originalCwd);
  });

  function setupProject(): void {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-cli-token-home-"));
    const project = mkdtempSync(join(tmpdir(), "pi-mcp-cli-token-project-"));
    process.env.HOME = home;
    process.chdir(project);
    writeJson(join(project, ".mcp.json"), {
      mcpServers: {
        remote: { url: "https://example.test/mcp", auth: "bearer", bearerTokenStore: true },
      },
    });
  }

  function tokenStdin(text: string): NodeJS.ReadStream {
    return Readable.from([text]) as unknown as NodeJS.ReadStream;
  }

  it("stores a bearer token from stdin bound to the configured URL", async () => {
    setupProject();
    const { main } = await import("../../../cli.js");
    const { getBearerTokenForUrl, resetTestBearerTokenStore } = await import("../../../src/auth/mcp-bearer-store.ts");
    resetTestBearerTokenStore();

    const logs: string[] = [];
    const errors: string[] = [];
    const exitCode = await main(["token", "set", "remote"], (line) => logs.push(line), (line) => errors.push(line), tokenStdin("secret-token\n"));

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(getBearerTokenForUrl("remote", "https://example.test/mcp")).toBe("secret-token");
    expect(getBearerTokenForUrl("remote", "https://other.test/mcp")).toBeUndefined();
    expect(logs.join("\n")).not.toContain("secret-token");
    expect(logs.join("\n")).not.toContain("https://example.test/mcp");
  });

  it("rejects a token passed as a command-line argument", async () => {
    setupProject();
    const { main } = await import("../../../cli.js");
    const { getTestBearerTokenStoreEntries, resetTestBearerTokenStore } = await import("../../../src/auth/mcp-bearer-store.ts");
    resetTestBearerTokenStore();

    const errors: string[] = [];
    const exitCode = await main(["token", "set", "remote", "secret-token"], () => {}, (line) => errors.push(line), tokenStdin(""));

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("must not be passed on the command line");
    expect(getTestBearerTokenStoreEntries()).toEqual([]);
  });

  it("rejects servers that are not configured for bearerTokenStore", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-cli-token-home-"));
    const project = mkdtempSync(join(tmpdir(), "pi-mcp-cli-token-project-"));
    process.env.HOME = home;
    process.chdir(project);
    writeJson(join(project, ".mcp.json"), {
      mcpServers: { plain: { url: "https://example.test/mcp" } },
    });
    const { main } = await import("../../../cli.js");

    const errors: string[] = [];
    const exitCode = await main(["token", "set", "plain"], () => {}, (line) => errors.push(line), tokenStdin("secret-token\n"));

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain('not configured for bearerTokenStore');
  });

  it("reports status and removes stored tokens without exposing them", async () => {
    setupProject();
    const { main } = await import("../../../cli.js");
    const { getBearerTokenForUrl, resetTestBearerTokenStore, saveBearerTokenForUrl } = await import("../../../src/auth/mcp-bearer-store.ts");
    resetTestBearerTokenStore();
    saveBearerTokenForUrl("remote", "secret-token", "https://example.test/mcp");

    const statusLogs: string[] = [];
    expect(await main(["token", "status", "remote"], (line) => statusLogs.push(line), () => {}, tokenStdin(""))).toBe(0);
    expect(statusLogs.join("\n")).toContain('Bearer token is stored for "remote".');
    expect(statusLogs.join("\n")).not.toContain("secret-token");

    const removeLogs: string[] = [];
    expect(await main(["token", "remove", "remote"], (line) => removeLogs.push(line), () => {}, tokenStdin(""))).toBe(0);
    expect(getBearerTokenForUrl("remote", "https://example.test/mcp")).toBeUndefined();

    const missingLogs: string[] = [];
    expect(await main(["token", "status", "remote"], (line) => missingLogs.push(line), () => {}, tokenStdin(""))).toBe(1);
    expect(missingLogs.join("\n")).toContain('No bearer token is stored for "remote".');
  });
});
