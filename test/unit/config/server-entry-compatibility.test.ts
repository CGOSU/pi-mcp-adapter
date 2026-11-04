import { describe, expect, it } from "vitest";
import { mergeConfigs } from "../../../src/config/merge.ts";
import { validateMcpConfig, validateServerEntry } from "../../../src/config/validation.ts";

describe("native configuration input aliases", () => {
  it("normalizes explicit stdio without changing the input or execution policies", () => {
    const raw = {
      type: "stdio", command: "fixture", args: ["--stdio"], timeout: 1.5,
      description: "Local fixture", approveTools: true, includeTools: ["lookup"],
    };
    const result = validateServerEntry("local", raw);
    expect(result).toEqual({
      ok: true,
      value: {
        command: "fixture", args: ["--stdio"], requestTimeoutMs: 1500,
        description: "Local fixture", approveTools: true, includeTools: ["lookup"],
      },
    });
    expect(raw).toMatchObject({ type: "stdio", timeout: 1.5 });
  });

  it.each(["http", "streamable-http"])("keeps explicit %s selection from falling back to SSE", (type) => {
    expect(validateServerEntry("remote", { type, url: "https://example.test/mcp" })).toEqual({
      ok: true,
      value: { url: "https://example.test/mcp", httpTransport: "streamable-http" },
    });
  });

  it.each([
    { type: "sse", url: "https://example.test/mcp" },
    { type: "stdio", url: "https://example.test/mcp" },
    { type: "http", command: "fixture" },
    { type: "streamable-http", socket: "/fixture.sock" },
    { type: "http", url: "https://example.test/mcp", httpTransport: "sse" },
    { type: "stdio", command: "fixture", httpTransport: "streamable-http" },
    { command: "fixture", httpTransport: "sse" },
    { type: "http" },
    { type: "stdio" },
    { type: "http", command: "fixture", url: "https://example.test/mcp" },
  ])("rejects missing or contradictory transport declarations: %j", (raw) => {
    expect(validateServerEntry("invalid", raw).ok).toBe(false);
  });

  it("preserves explicit legacy SSE for a caller that can support it", () => {
    const entry = { url: "https://example.test/sse", httpTransport: "sse" };
    expect(validateServerEntry("legacy", entry)).toEqual({ ok: true, value: entry });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483.648, "30"])("rejects invalid seconds timeout %s", (timeout) => {
    expect(validateServerEntry("invalid", { command: "fixture", timeout })).toMatchObject({
      ok: false, error: { code: "invalid-server-field" },
    });
  });

  it("accepts equivalent units and rejects conflicting timeout declarations", () => {
    expect(validateServerEntry("same", { command: "fixture", timeout: 1.001, requestTimeoutMs: 1001 })).toEqual({
      ok: true, value: { command: "fixture", requestTimeoutMs: 1001 },
    });
    expect(validateServerEntry("different", { command: "fixture", timeout: 1, requestTimeoutMs: 2000 }).ok).toBe(false);
    expect(validateServerEntry("inherit", { command: "fixture", timeout: 1, requestTimeoutMs: 0 }).ok).toBe(false);
  });

  it("tolerates conversion rounding without accepting distinct sub-millisecond durations", () => {
    expect(validateServerEntry("same", { command: "fixture", timeout: 0.00003, requestTimeoutMs: 0.03 })).toEqual({
      ok: true, value: { command: "fixture", requestTimeoutMs: 0.03 },
    });
    expect(validateServerEntry("different", { command: "fixture", timeout: 0.00003, requestTimeoutMs: 0.03000001 }).ok).toBe(false);
  });

  it("removes rounding noise only next to an integer millisecond", () => {
    expect(validateServerEntry("integer", { command: "fixture", timeout: 1.001 })).toEqual({
      ok: true, value: { command: "fixture", requestTimeoutMs: 1001 },
    });
    expect(validateServerEntry("fraction", { command: "fixture", timeout: 0.001001 })).toEqual({
      ok: true, value: { command: "fixture", requestTimeoutMs: 1.001 },
    });
  });

  it("normalizes seconds before merging a higher-priority override", () => {
    const base = validateMcpConfig({ mcpServers: { docs: { command: "fixture", requestTimeoutMs: 2000 } } });
    const override = validateMcpConfig({ mcpServers: { docs: { timeout: 3 } } });
    if (!base.ok || !override.ok) throw new Error("Expected valid input sources");
    expect(mergeConfigs(base.value, override.value).mcpServers.docs).toEqual({ command: "fixture", requestTimeoutMs: 3000 });
  });

  it("does not relax unknown fields or malformed descriptions", () => {
    expect(validateServerEntry("unknown", { type: "stdio", command: "fixture", unsupportedPolicy: true })).toMatchObject({
      ok: false, error: { code: "unknown-server-field" },
    });
    for (const description of [42, "invalid\0summary"]) {
      expect(validateServerEntry("invalid", { command: "fixture", description }).ok).toBe(false);
    }
  });
});
