import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAuthEntry,
  getAuthForUrl,
  resetTestAuthSecretStore,
  updateClientInfo,
  updateCodeVerifier,
  updateOAuthState,
} from "../../../src/auth/mcp-auth.ts";
import { createNativeMcpOAuthCredentialBackend } from "../../../src/native/oauth-credential-backend.ts";
import { saveBearerTokenForUrl } from "../../../src/auth/mcp-bearer-store.ts";
import {
  getMcpOAuthTokensForUrl,
  inspectMcpOAuthTokensForUrl,
  updateMcpOAuthTokensForUrl,
} from "../../../oauth.ts";

const SERVER_URL = "https://mcp.example.test/api";
const OTHER_SERVER_URL = "https://other.example.test/api";

const originalStore = process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE;
const originalCache = process.env.PI_MCP_ADAPTER_DISABLE_AUTH_CACHE;
const originalOAuthDir = process.env.MCP_OAUTH_DIR;

beforeEach(() => {
  process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = "memory";
  process.env.PI_MCP_ADAPTER_DISABLE_AUTH_CACHE = "1";
  delete process.env.MCP_OAUTH_DIR;
  resetTestAuthSecretStore();
});

afterEach(() => {
  resetTestAuthSecretStore();
  for (const [key, value] of [
    ["PI_MCP_ADAPTER_TEST_AUTH_STORE", originalStore],
    ["PI_MCP_ADAPTER_DISABLE_AUTH_CACHE", originalCache],
    ["MCP_OAUTH_DIR", originalOAuthDir],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("native MCP OAuth credential backend", () => {
  it("loads an existing adapter keyring login without moving its URL-bound credentials", () => {
    updateMcpOAuthTokensForUrl("existing-login", SERVER_URL, {
      accessToken: "existing-access-token",
      refreshToken: "existing-refresh-token",
      expiresAt: Date.now() / 1000 + 3600,
      scope: "read write",
      issuer: "https://identity.example.test",
    });
    updateClientInfo(
      "existing-login",
      {
        clientId: "registered-client",
        clientSecret: "registered-secret",
        clientIdIssuedAt: 1_700_000_000,
        clientSecretExpiresAt: 1_800_000_000,
        redirectUris: ["http://localhost/callback"],
        tokenEndpointAuthMethod: "client_secret_post",
        grantTypes: ["authorization_code", "refresh_token"],
        clientName: "Existing adapter client",
        issuer: "https://identity.example.test",
      },
      SERVER_URL,
    );
    updateCodeVerifier("existing-login", "pending-verifier", SERVER_URL);
    updateOAuthState("existing-login", "pending-state", SERVER_URL);

    const nativeStore = createNativeMcpOAuthCredentialBackend(["existing-login"]).forServer("existing-login", SERVER_URL);
    const state = nativeStore.load();

    expect(state).toMatchObject({
      serverUrl: SERVER_URL,
      clientInformation: {
        client_id: "registered-client",
        client_secret: "registered-secret",
        redirect_uris: ["http://localhost/callback"],
        token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code", "refresh_token"],
        client_name: "Existing adapter client",
        issuer: "https://identity.example.test",
      },
      tokens: {
        access_token: "existing-access-token",
        refresh_token: "existing-refresh-token",
        token_type: "Bearer",
        scope: "read write",
        issuer: "https://identity.example.test",
      },
      codeVerifier: "pending-verifier",
      oauthState: "pending-state",
    });
    expect(state?.tokensExpireAt).toBe(getAuthEntry("existing-login")?.tokens?.expiresAt! * 1000);
    expect(getAuthEntry("existing-login")?.serverUrl).toBe(SERVER_URL);
  });

  it("does not expose static-client stubs as native dynamic registration", () => {
    updateClientInfo(
      "configured-client",
      { clientId: "static-client", issuer: "https://identity.example.test", configPreRegistered: true },
      SERVER_URL,
    );
    updateClientInfo("legacy-client-stub", { clientId: "legacy-client", issuer: "https://identity.example.test" }, SERVER_URL);
    const backend = createNativeMcpOAuthCredentialBackend(["configured-client", "legacy-client-stub"]);

    expect(backend.forServer("configured-client", SERVER_URL).load()?.clientInformation).toBeUndefined();
    expect(backend.forServer("legacy-client-stub", SERVER_URL).load()?.clientInformation).toBeUndefined();
  });

  it("shares native sign-in updates and sign-out with the published OAuth token API", async () => {
    const backend = createNativeMcpOAuthCredentialBackend(["shared-login"]);
    expect(backend.handlesServer("shared-login", SERVER_URL)).toBe(true);
    expect(backend.handlesServer("stock-native", SERVER_URL)).toBe(false);
    const nativeStore = backend.forServer("shared-login", SERVER_URL);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    nativeStore.save({
      serverUrl: SERVER_URL,
      clientInformation: {
        client_id: "native-client",
        client_secret: "native-client-secret",
        redirect_uris: ["http://localhost/callback"],
        token_endpoint_auth_method: "client_secret_post",
        client_name: "Native MCP OAuth",
      },
      tokens: {
        access_token: "native-access-token",
        refresh_token: "native-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "read",
        id_token: "native-id-token",
        issuer: "https://identity.example.test",
      },
      tokensExpireAt: expiresAt * 1000,
      codeVerifier: "native-verifier",
      oauthState: "native-state",
      discovery: {
        authorizationServerUrl: "https://identity.example.test",
        authorizationServerMetadata: {
          issuer: "https://identity.example.test",
          authorization_endpoint: "https://identity.example.test/authorize",
          token_endpoint: "https://identity.example.test/token",
          response_types_supported: ["code"],
        },
      },
    });

    expect(await getMcpOAuthTokensForUrl("shared-login", SERVER_URL)).toMatchObject({
      accessToken: "native-access-token",
      refreshToken: "native-refresh-token",
      expiresAt,
      scope: "read",
      issuer: "https://identity.example.test",
    });
    expect(inspectMcpOAuthTokensForUrl("shared-login", SERVER_URL).status).toBe("present");
    expect(nativeStore.load()).toMatchObject({
      clientInformation: { client_id: "native-client", client_name: "Native MCP OAuth" },
      tokens: { access_token: "native-access-token", id_token: "native-id-token" },
      discovery: { authorizationServerUrl: "https://identity.example.test" },
    });

    updateMcpOAuthTokensForUrl("shared-login", SERVER_URL, { accessToken: "updated-through-public-api" });
    expect(backend.tokens("shared-login", SERVER_URL)?.access_token).toBe("updated-through-public-api");

    expect(backend.remove("shared-login", OTHER_SERVER_URL)).toBe(false);
    expect(inspectMcpOAuthTokensForUrl("shared-login", SERVER_URL).status).toBe("present");
    expect(backend.remove("shared-login", SERVER_URL)).toBe(true);
    expect(nativeStore.load()).toBeUndefined();
    expect(inspectMcpOAuthTokensForUrl("shared-login", SERVER_URL)).toEqual({ status: "absent" });
  });

  it("reads bearer credentials only through the selected secure backend and matching URL", () => {
    saveBearerTokenForUrl("secure-bearer", "memory-only-secret", SERVER_URL);
    const backend = createNativeMcpOAuthCredentialBackend(["secure-bearer"]);

    expect(backend.bearerToken("secure-bearer", SERVER_URL)).toBe("memory-only-secret");
    expect(backend.bearerToken("secure-bearer", OTHER_SERVER_URL)).toBeUndefined();

    process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = "unavailable";
    resetTestAuthSecretStore();
    expect(() => backend.bearerToken("secure-bearer", SERVER_URL)).toThrow(/OS secure credential store/);
    expect(() => backend.bearerToken("unselected", SERVER_URL)).toThrow(/OS secure credential store/);
  });

  it("clears URL-bound credentials when a native server is replaced", () => {
    updateMcpOAuthTokensForUrl("replaced-server", SERVER_URL, {
      accessToken: "old-server-access",
      refreshToken: "old-server-refresh",
      expiresAt: Date.now() / 1000 + 3600,
    });
    updateClientInfo("replaced-server", { clientId: "old-server-client" }, SERVER_URL);
    const backend = createNativeMcpOAuthCredentialBackend(["replaced-server"]);

    expect(backend.forServer("replaced-server", SERVER_URL).load()?.tokens?.access_token).toBe("old-server-access");
    expect(backend.forServer("replaced-server", OTHER_SERVER_URL).load()).toBeUndefined();
    backend.forServer("replaced-server", OTHER_SERVER_URL).save({
      serverUrl: OTHER_SERVER_URL,
      tokens: { access_token: "new-server-access", token_type: "Bearer" },
    });

    expect(getAuthForUrl("replaced-server", SERVER_URL)).toBeUndefined();
    expect(inspectMcpOAuthTokensForUrl("replaced-server", SERVER_URL)).toEqual({ status: "absent" });
    expect(getAuthForUrl("replaced-server", OTHER_SERVER_URL)).toMatchObject({
      serverUrl: OTHER_SERVER_URL,
      tokens: { accessToken: "new-server-access" },
    });
    expect(getAuthEntry("replaced-server")?.clientInfo).toBeUndefined();
  });

  it("preserves absent, expired-token, and unavailable-store distinctions without exposing secrets", async () => {
    expect(inspectMcpOAuthTokensForUrl("auth-status", SERVER_URL)).toEqual({ status: "absent" });
    updateMcpOAuthTokensForUrl("auth-status", SERVER_URL, {
      accessToken: "expired-access-secret",
      refreshToken: "refresh-secret",
      expiresAt: Date.now() / 1000 - 3600,
    });
    const backend = createNativeMcpOAuthCredentialBackend(["auth-status"]);
    expect(backend.tokens("auth-status", SERVER_URL)?.access_token).toBe("expired-access-secret");
    await expect(getMcpOAuthTokensForUrl("auth-status", SERVER_URL)).resolves.toBeUndefined();
    const expired = inspectMcpOAuthTokensForUrl("auth-status", SERVER_URL);
    expect(expired.status).toBe("present");
    if (expired.status === "present") expect(expired.tokens.expiresAt).toBeLessThan(Date.now() / 1000);
    expect(backend.forServer("auth-status", SERVER_URL).load()?.tokensExpireAt).toBeLessThan(Date.now());

    process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = "unavailable";
    resetTestAuthSecretStore();
    const store = backend.forServer("auth-status", SERVER_URL);
    expect(() => store.load()).toThrow(/OS secure credential store/);
    expect(inspectMcpOAuthTokensForUrl("auth-status", SERVER_URL)).toMatchObject({ status: "unavailable" });
    await expect(getMcpOAuthTokensForUrl("auth-status", SERVER_URL)).rejects.toThrow(/OS secure credential store/);
    expect(() => store.save({ serverUrl: SERVER_URL, tokens: { access_token: "not-written", token_type: "Bearer" } }))
      .toThrow(/OS secure credential store/);
    expect(JSON.stringify(inspectMcpOAuthTokensForUrl("auth-status", SERVER_URL))).not.toContain("expired-access-secret");
    process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = "memory";
    resetTestAuthSecretStore();
    expect(getAuthForUrl("auth-status", SERVER_URL)).toBeUndefined();
  });
});
