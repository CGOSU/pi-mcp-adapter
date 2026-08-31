/**
 * Tests for the public OAuth token reuse API.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = "memory";

const {
  getMcpOAuthTokensForUrl,
  inspectMcpOAuthTokensForUrl,
  updateMcpOAuthTokensForUrl,
} = await import("pi-mcp-adapter/oauth");

describe("public OAuth token API", () => {

  it("reads and updates URL-bound tokens through the package export", async () => {
    const expiresAt = Date.now() / 1000 + 3600;
    updateMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt,
      scope: "read write",
    });

    assert.deepStrictEqual(await getMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp"), {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt,
      scope: "read write",
    });
    assert.deepStrictEqual(inspectMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp"), {
      status: "present",
      tokens: {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt,
        scope: "read write",
      },
    });
  });

  it("does not return tokens for a different URL", async () => {
    updateMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp", { accessToken: "access-1" });

    assert.strictEqual(await getMcpOAuthTokensForUrl("jira", "https://other.example.com/mcp"), undefined);
    assert.deepStrictEqual(inspectMcpOAuthTokensForUrl("jira", "https://other.example.com/mcp"), {
      status: "absent",
    });
  });

  it("only exposes URL-bound token fields", () => {
    updateMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp", { accessToken: "access-1" });

    const status = inspectMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp");
    assert.deepStrictEqual(status, { status: "present", tokens: { accessToken: "access-1" } });
    assert(!("entry" in status));
  });

  it("does not return refreshable expired tokens as valid when refresh cannot complete", async () => {
    const expiresAt = Date.now() / 1000 - 3600;
    updateMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp", {
      accessToken: "expired-token",
      refreshToken: "refresh-token",
      expiresAt,
    });

    assert.strictEqual(await getMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp"), undefined);
    assert.deepStrictEqual(inspectMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp"), {
      status: "present",
      tokens: {
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        expiresAt,
      },
    });
  });

  it("fails closed when the secure credential store is unavailable", async () => {
    const previous = process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE;
    process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = "unavailable";
    try {
      await assert.rejects(
        () => getMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp"),
        /Failed to read OAuth credentials.*OS secure credential store/,
      );
      const status = inspectMcpOAuthTokensForUrl("jira", "https://jira.example.com/mcp");
      assert.strictEqual(status.status, "unavailable");
    } finally {
      if (previous === undefined) {
        delete process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE;
      } else {
        process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = previous;
      }
    }
  });

  it("clears stale URL-bound state when tokens move to another URL", async () => {
    updateMcpOAuthTokensForUrl("jira", "https://old.example.com/mcp", { accessToken: "old-token" });

    updateMcpOAuthTokensForUrl("jira", "https://new.example.com/mcp", { accessToken: "new-token" });

    assert.strictEqual(await getMcpOAuthTokensForUrl("jira", "https://old.example.com/mcp"), undefined);
    assert.deepStrictEqual(await getMcpOAuthTokensForUrl("jira", "https://new.example.com/mcp"), {
      accessToken: "new-token",
    });
    assert.deepStrictEqual(inspectMcpOAuthTokensForUrl("jira", "https://new.example.com/mcp"), {
      status: "present",
      tokens: { accessToken: "new-token" },
    });
  });
});
