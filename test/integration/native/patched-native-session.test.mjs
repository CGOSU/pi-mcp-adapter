import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createMcpAdapter, registerMcpServer } from "../../../index.ts";
import { createNativeMcpOAuthCredentialBackend } from "../../../src/native/oauth-credential-backend.ts";
import { NativeMcpManagementBridge } from "../../../src/native/management-bridge.ts";
import { resetTestAuthSecretStore } from "../../../src/auth/mcp-auth.ts";
import {
  getMcpOAuthTokensForUrl,
  inspectMcpOAuthTokensForUrl,
  updateMcpOAuthTokensForUrl,
} from "../../../oauth.ts";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { createHarness, createTestUiContext, getMessageText, getToolResult } from "@pi-upstream-test-harness";
import { startOAuthMcpServer } from "@pi-upstream-oauth-server";
import nativeMcpExtension from "@pi-patched-native-mcp-extension";

const fixturePath = fileURLToPath(new URL("../../fixtures/patched-native-session-mcp-server.mjs", import.meta.url));
const MCP_SERVER_NAME = "global-fixture";

function fixtureLog(path) {
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean) : [];
}

function getSnapshot(handle) {
  const result = handle.snapshot();
  if (!result.ok) throw new Error(`Native MCP snapshot failed: ${result.error.code}`);
  return result.value;
}

function getServer(handle, name) {
  return getSnapshot(handle).servers.find((server) => server.name === name);
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function writeConfig(path, config) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("patched Pi native MCP and adapter in one real session", () => {
  it("keeps the native owner and adapter aligned and rejects stale OAuth writes", async () => {
    const agentDir = process.env.PI_CODING_AGENT_DIR;
    if (!agentDir) throw new Error("The explicit regression runner must provide an isolated PI_CODING_AGENT_DIR.");
    if (process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE !== "memory") {
      throw new Error("The regression runner must use the isolated in-memory OAuth test store.");
    }

    const globalConfigPath = join(agentDir, "mcp.json");
    const logPath = join(agentDir, "native-session-fixture.log");

    const statusEvents = [];
    const notifications = [];
    let adapterApi;
    let externalBridge;
    let runtimeRegistration;
    let harness;
    let handle;
    let oauthServer;
    let projectConfigFile;
    const statusConsumer = (pi) => {
      pi.events.on("pi-mcp-adapter/status/v1", (status) => statusEvents.push(status));
    };
    const adapterFactory = (pi) => {
      adapterApi = pi;
      createMcpAdapter({ configPath: globalConfigPath })(pi);
    };

    resetTestAuthSecretStore();
    try {
      oauthServer = await startOAuthMcpServer();
      writeConfig(globalConfigPath, {
        mcpServers: {
          [MCP_SERVER_NAME]: {
            command: process.execPath,
            args: [fixturePath, logPath, "global"],
            directTools: true,
          },
          "oauth-stale": {
            url: oauthServer.url,
            auth: "oauth",
            oauth: {},
          },
        },
      });
      harness = await createHarness({
        extensionFactories: [statusConsumer, adapterFactory, nativeMcpExtension],
        withConfiguredAuth: true,
      });

      projectConfigFile = join(harness.tempDir, ".pi", "mcp.json");
      writeConfig(projectConfigFile, {
        mcpServers: {
          "untrusted-project": {
            command: process.execPath,
            args: [fixturePath, logPath, "project"],
            directTools: true,
          },
        },
      });
      harness.settingsManager.setProjectTrusted(false);
      await harness.session.bindExtensions({
        uiContext: createTestUiContext({ notify: (message) => notifications.push(message) }),
      });

      expect(adapterApi).toBeDefined();
      expect(typeof createMcpAdapter).toBe("function");
      expect(typeof registerMcpServer).toBe("function");

      externalBridge = new NativeMcpManagementBridge(adapterApi, () => {}, () => {}, (error) => {
        throw new Error(`Native MCP discovery failed: ${error.code}`);
      });
      const discovery = await externalBridge.discoverCurrent();
      expect(discovery.ok).toBe(true);
      if (!discovery.ok) throw new Error(`Native MCP discovery failed: ${discovery.error.code}`);
      handle = discovery.value;

      await vi.waitFor(() => {
        expect(getServer(handle, MCP_SERVER_NAME)).toMatchObject({
          connectionStatus: "connected",
          catalog: {
            freshness: "live",
            tools: expect.arrayContaining([
              expect.objectContaining({ name: "lookup" }),
              expect.objectContaining({ name: "fail" }),
              expect.objectContaining({ name: "slow" }),
            ]),
            resources: { available: true },
            prompts: { available: true },
          },
        });
      }, { timeout: 20_000 });
      await vi.waitFor(() => expect(getServer(handle, "oauth-stale")?.connectionStatus).toBe("needs-auth"), {
        timeout: 20_000,
      });

      expect(fixtureLog(logPath).filter((line) => line === "start:global")).toHaveLength(1);
      expect(await handle.refreshCatalog(MCP_SERVER_NAME)).toEqual({ ok: true, value: undefined });
      await vi.waitFor(() => {
        expect(getServer(handle, MCP_SERVER_NAME)).toMatchObject({
          catalog: {
            resources: {
              freshness: "live",
              items: expect.arrayContaining([expect.objectContaining({ name: "guide" })]),
              templates: expect.arrayContaining([expect.objectContaining({ name: "topic-guide" })]),
            },
            prompts: {
              freshness: "live",
              items: expect.arrayContaining([expect.objectContaining({ name: "fixture-prompt" })]),
            },
          },
        });
      }, { timeout: 10_000 });

      expect(getSnapshot(handle).servers.some((server) => server.name === "untrusted-project")).toBe(false);
      expect(fixtureLog(logPath)).toContain("start:global");
      expect(fixtureLog(logPath)).not.toContain("start:project");
      expect(adapterApi.getMcpServers().map((server) => server.name)).not.toContain(MCP_SERVER_NAME);

      const projectContentsBefore = readFileSync(projectConfigFile, "utf8");
      const deniedProjectWrite = await handle.setDirectTools("untrusted-project", ["lookup"]);
      expect(deniedProjectWrite).toMatchObject({
        ok: false,
        error: { code: "server-disabled", message: "Project trust is required." },
      });
      expect(readFileSync(projectConfigFile, "utf8")).toBe(projectContentsBefore);
      expect(fixtureLog(logPath)).not.toContain("start:project");

      const resourceId = getServer(handle, MCP_SERVER_NAME).catalog.resources.items
        .find((item) => item.name === "guide")?.id;
      expect(resourceId).toEqual(expect.any(String));
      const resource = await handle.readResource(MCP_SERVER_NAME, resourceId);
      expect(resource).toMatchObject({
        ok: true,
        value: { contents: [expect.objectContaining({ text: "local resource fixture://guide" })] },
      });
      const prompt = await handle.getPrompt(MCP_SERVER_NAME, "fixture-prompt", {});
      expect(prompt).toMatchObject({
        ok: true,
        value: { messages: [expect.objectContaining({ role: "user" })] },
      });

      await new Promise((resolve) => setTimeout(resolve, 900));
      await harness.session.sendUserMessage("/mcp-adapter", { expandPromptTemplates: true });
      await harness.session.sendUserMessage("/mcp", { expandPromptTemplates: true });
      expect(notifications.some((message) => message.includes(MCP_SERVER_NAME))).toBe(true);
      await vi.waitFor(() => {
        expect(statusEvents.at(-1)).toMatchObject({
          version: 1,
          connectedCount: 1,
          servers: expect.arrayContaining([
            expect.objectContaining({ name: MCP_SERVER_NAME, status: "connected", toolCount: 3 }),
          ]),
        });
      });
      expect(JSON.stringify(statusEvents.at(-1))).not.toContain(globalConfigPath);
      expect(JSON.stringify(statusEvents.at(-1))).not.toContain(logPath);

      const lookupToolName = `${MCP_SERVER_NAME}_lookup`;
      const failureToolName = `${MCP_SERVER_NAME}_fail`;
      const slowToolName = "runtime_slow";
      expect(harness.session.getAllTools().map((tool) => tool.name)).toEqual(
        expect.arrayContaining([lookupToolName, failureToolName]),
      );
      expect(harness.session.getActiveToolNames()).toEqual(expect.arrayContaining([lookupToolName, failureToolName]));

      harness.setResponses([
        fauxAssistantMessage([fauxToolCall(lookupToolName, { query: "pi" })], { stopReason: "toolUse" }),
        fauxAssistantMessage("local lookup finished"),
      ]);
      await harness.session.prompt("Use the local native MCP lookup tool.");
      const lookupResult = getToolResult(harness, lookupToolName);
      expect(lookupResult.isError).not.toBe(true);
      expect(getMessageText(lookupResult)).toContain("lookup result for pi");
      expect(fixtureLog(logPath)).toContain("call:global:lookup:pi:complete");

      harness.setResponses([
        fauxAssistantMessage([fauxToolCall(failureToolName, {})], { stopReason: "toolUse" }),
        fauxAssistantMessage("the native MCP failure was returned"),
      ]);
      await harness.session.prompt("Exercise the fixture's real MCP failure result.");
      const failureResult = getToolResult(harness, failureToolName);
      expect(failureResult.isError).toBe(true);
      expect(getMessageText(failureResult)).toContain("local fixture rejected the request");

      const savedSelection = await handle.setDirectTools(MCP_SERVER_NAME, ["lookup"]);
      expect(savedSelection).toEqual({ ok: true, value: undefined });
      expect(JSON.parse(readFileSync(globalConfigPath, "utf8")).mcpServers[MCP_SERVER_NAME].directTools)
        .toEqual(["lookup"]);
      expect(getServer(handle, MCP_SERVER_NAME)?.directTools).toEqual(["lookup"]);

      const sessionPolicy = await handle.setExecutionPolicy(MCP_SERVER_NAME, { directTools: false });
      expect(sessionPolicy.ok).toBe(true);
      expect(getServer(handle, MCP_SERVER_NAME).catalog.tools.find((tool) => tool.name === "lookup")?.exposure)
        .toBe("codemode");
      expect(JSON.parse(readFileSync(globalConfigPath, "utf8")).mcpServers[MCP_SERVER_NAME].directTools)
        .toEqual(["lookup"]);

      const configBeforeFailedWrite = readFileSync(globalConfigPath, "utf8");
      rmSync(globalConfigPath);
      mkdirSync(globalConfigPath);
      try {
        const failedWrite = await handle.setDirectTools(MCP_SERVER_NAME, false);
        expect(failedWrite).toMatchObject({ ok: false, error: { code: "config-update-failed" } });
      } finally {
        rmSync(globalConfigPath, { recursive: true, force: true });
        writeFileSync(globalConfigPath, configBeforeFailedWrite, "utf8");
      }
      expect(getServer(handle, MCP_SERVER_NAME)?.directTools).toEqual(["lookup"]);

      runtimeRegistration = registerMcpServer({
        pi: adapterApi,
        name: "runtime",
        definition: {
          command: process.execPath,
          args: [fixturePath, logPath, "runtime"],
          directTools: true,
        },
      });
      await vi.waitFor(() => {
        expect(getServer(handle, "runtime")).toMatchObject({
          scope: "extension",
          connectionStatus: "connected",
          catalog: { freshness: "live" },
        });
      }, { timeout: 20_000 });
      expect(adapterApi.getMcpServers().map((server) => server.name)).toContain("runtime");
      expect(await handle.setDirectTools("runtime", false)).toMatchObject({
        ok: false,
        error: { code: "config-update-failed" },
      });

      harness.setResponses([
        fauxAssistantMessage([fauxToolCall(slowToolName, {})], { stopReason: "toolUse" }),
        fauxAssistantMessage("the native attempt ended when its server was removed"),
      ]);
      const pendingToolCall = harness.session.prompt("Start one local operation before withdrawing its server.");
      await vi.waitFor(() => expect(fixtureLog(logPath)).toContain("call:runtime:slow::start"));
      await runtimeRegistration.dispose();
      runtimeRegistration = undefined;
      await withTimeout(pendingToolCall, 10_000, "The in-flight native tool call did not settle after server withdrawal.");
      expect(getSnapshot(handle).servers.some((server) => server.name === "runtime")).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 3_100));
      expect(fixtureLog(logPath).filter((line) => line === "call:runtime:slow::start")).toHaveLength(1);

      const processStarts = fixtureLog(logPath).filter((line) => line.startsWith("start:"));
      expect(processStarts.filter((line) => line === "start:runtime")).toHaveLength(1);
      expect(processStarts).not.toContain("start:project");
      expect(harness.session.getAllTools().map((tool) => tool.name)).not.toContain("mcp");
      expect(harness.session.getAllTools().some((tool) => /proxy|script/i.test(tool.name))).toBe(false);

      const oauthUrl = "https://oauth-fixture.invalid/mcp";
      updateMcpOAuthTokensForUrl("oauth-fixture", oauthUrl, {
        accessToken: "isolated-test-access-token",
        refreshToken: "isolated-test-refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3_600,
        scope: "read",
      });
      const oauthBackend = createNativeMcpOAuthCredentialBackend(["oauth-fixture"]);
      const nativeStore = oauthBackend.forServer("oauth-fixture", oauthUrl);
      expect(oauthBackend.handlesServer("oauth-fixture", oauthUrl)).toBe(true);
      expect(oauthBackend.handlesServer("stock-native", oauthUrl)).toBe(false);
      expect(nativeStore.load()).toMatchObject({
        serverUrl: oauthUrl,
        tokens: { access_token: "isolated-test-access-token", refresh_token: "isolated-test-refresh-token" },
      });
      expect(await getMcpOAuthTokensForUrl("oauth-fixture", oauthUrl)).toMatchObject({
        accessToken: "isolated-test-access-token",
        refreshToken: "isolated-test-refresh-token",
      });
      expect(inspectMcpOAuthTokensForUrl("oauth-fixture", oauthUrl).status).toBe("present");
      expect(oauthBackend.remove("oauth-fixture", oauthUrl)).toBe(true);
      expect(inspectMcpOAuthTokensForUrl("oauth-fixture", oauthUrl)).toEqual({ status: "absent" });

      const originalFetch = globalThis.fetch;
      const tokenRequestStarted = deferred();
      const releaseTokenResponse = deferred();
      globalThis.fetch = async (input, init) => {
        const requestUrl = input instanceof Request ? input.url : String(input);
        if (new URL(requestUrl).pathname === "/token") {
          tokenRequestStarted.resolve();
          await releaseTokenResponse.promise;
          return originalFetch(input, { ...init, signal: undefined });
        }
        return originalFetch(input, init);
      };
      let pendingSignIn;
      try {
        let authorizationRedirectReady;
        pendingSignIn = handle.signIn("oauth-stale", {
          showAuthorizationUrl: (url) => {
            authorizationRedirectReady = originalFetch(url, { redirect: "manual" }).then((response) => {
              const redirect = response.headers.get("location");
              if (!redirect) throw new Error("OAuth fixture did not return a redirect URL.");
              return redirect;
            });
          },
          promptForRedirectUrl: async () => {
            if (!authorizationRedirectReady) throw new Error("OAuth authorization URL was not opened.");
            return authorizationRedirectReady;
          },
        });
        await withTimeout(tokenRequestStarted.promise, 10_000, "The local OAuth token request did not start.");

        expect(await handle.setServerEnabled("oauth-stale", false)).toEqual({ ok: true, value: undefined });
        updateMcpOAuthTokensForUrl("oauth-stale", oauthServer.url, {
          accessToken: "replacement-access-token",
          refreshToken: "replacement-refresh-token",
          expiresAt: Math.floor(Date.now() / 1000) + 3_600,
        });
        releaseTokenResponse.resolve();

        expect(await withTimeout(pendingSignIn, 10_000, "The invalidated OAuth sign-in did not settle.")).toMatchObject({
          ok: false,
          error: { code: "server-disabled" },
        });
        expect(getServer(handle, "oauth-stale")?.connectionStatus).toBe("disabled");
        expect(await getMcpOAuthTokensForUrl("oauth-stale", oauthServer.url)).toMatchObject({
          accessToken: "replacement-access-token",
          refreshToken: "replacement-refresh-token",
        });
        expect(inspectMcpOAuthTokensForUrl("oauth-stale", oauthServer.url)).toMatchObject({ status: "present" });
      } finally {
        releaseTokenResponse.resolve();
        if (pendingSignIn) await pendingSignIn.catch(() => undefined);
        globalThis.fetch = originalFetch;
      }

      const savedConfigBeforeShutdown = readFileSync(globalConfigPath, "utf8");
      await harness.session.reload();
      const staleWrite = await handle.setDirectTools(MCP_SERVER_NAME, false);
      expect(staleWrite).toMatchObject({ ok: false, error: { code: "session-ended" } });
      expect(readFileSync(globalConfigPath, "utf8")).toBe(savedConfigBeforeShutdown);
      await vi.waitFor(() => {
        expect(statusEvents).toContainEqual(expect.objectContaining({ version: 1, servers: [], totalTools: 0 }));
      });
    } finally {
      externalBridge?.stopSession();
      if (runtimeRegistration) await runtimeRegistration.dispose().catch(() => undefined);
      if (harness) {
        try {
          await harness.session.dispose();
        } finally {
          harness.cleanup();
        }
      }
      resetTestAuthSecretStore();
      if (oauthServer) await oauthServer.close();
    }
  });
});
