// src/auth/mcp-auth-flow.ts
import {
  auth as runSdkAuth,
  extractWWWAuthenticateParams,
  LATEST_PROTOCOL_VERSION,
  UnauthorizedError as UnauthorizedError2
} from "@modelcontextprotocol/client";
import open from "open";

// src/auth/mcp-oauth-provider.ts
import {
  UnauthorizedError
} from "@modelcontextprotocol/client";

// src/auth/mcp-auth.ts
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { createRequire } from "module";
import { readFileSync as readFileSync2, existsSync, rmSync } from "fs";
import { dirname, join as join3 } from "path";
import { fileURLToPath } from "url";

// src/config/agent-dir.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
function getConfigDirName() {
  const configDir = readPiConfig()?.configDir;
  return typeof configDir === "string" && configDir.trim() ? configDir.trim() : ".pi";
}
function getAgentDir() {
  const piConfig = readPiConfig();
  const name = piConfig?.name;
  const appName = typeof name === "string" && name.trim() ? name.trim() : "pi";
  const configured = process.env[`${appName.toUpperCase()}_CODING_AGENT_DIR`]?.trim();
  if (!configured) {
    return join(homedir(), getConfigDirName(), "agent");
  }
  if (configured === "~") {
    return homedir();
  }
  if (configured.startsWith("~/")) {
    return resolve(homedir(), configured.slice(2));
  }
  return resolve(configured);
}
function getAgentPath(...segments) {
  return join(getAgentDir(), ...segments);
}
function readPiConfig() {
  const dir = process.env.PI_PACKAGE_DIR?.trim();
  if (!dir) return void 0;
  try {
    const manifest = JSON.parse(readFileSync(join(resolve(dir), "package.json"), "utf8"));
    return manifest.piConfig;
  } catch {
    return void 0;
  }
}
function getAppName() {
  const name = readPiConfig()?.name;
  return typeof name === "string" && name.trim() ? name.trim() : "pi";
}
function getAppClientUri() {
  const uri = readPiConfig()?.clientUri;
  return typeof uri === "string" && uri.trim() ? uri.trim() : void 0;
}

// src/config/paths.ts
import { homedir as homedir2 } from "node:os";
import { join as join2, resolve as resolve2 } from "node:path";
var GENERIC_GLOBAL_CONFIG_PATH = join2(homedir2(), ".config", "mcp", "mcp.json");
var AGENTS_GLOBAL_CONFIG_PATHS = [
  join2(homedir2(), ".agents", "mcp.json"),
  join2(homedir2(), ".agents", "mcp", "mcp.json")
];
var REPOPROMPT_BINARY_CANDIDATES = [
  join2(homedir2(), "RepoPrompt", "repoprompt_cli"),
  "/Applications/Repo Prompt.app/Contents/MacOS/repoprompt-mcp"
];
var IMPORT_PATHS = {
  cursor: [join2(homedir2(), ".cursor", "mcp.json")],
  "claude-code": [
    join2(homedir2(), ".claude", "mcp.json"),
    join2(homedir2(), ".claude.json"),
    join2(homedir2(), ".claude", "claude_desktop_config.json")
  ],
  "claude-desktop": [join2(homedir2(), "Library", "Application Support", "Claude", "claude_desktop_config.json")],
  codex: [
    join2(homedir2(), ".codex", "config.toml"),
    join2(homedir2(), ".codex", "config.json")
  ],
  opencode: [
    join2(homedir2(), ".config", "opencode", "opencode.json"),
    "./opencode.json"
  ],
  windsurf: [join2(homedir2(), ".windsurf", "mcp.json")],
  vscode: [".vscode/mcp.json"]
};

// src/auth/mcp-auth.ts
var require2 = createRequire(import.meta.url);
var AUTH_SECRET_SERVICE = "pi-mcp-adapter.oauth";
var TEST_AUTH_STORE_ENV = "PI_MCP_ADAPTER_TEST_AUTH_STORE";
var AUTH_SECRET_CHUNK_SIZE = 1e3;
var AUTH_SECRET_VALUE_LIMIT = 1280;
var KEYRING_RECOVERY_DISABLED_ENV = "PI_MCP_ADAPTER_DISABLE_KEYRING_RECOVERY";
var KEYRING_RECOVERY_KEYCTL_ENV = "PI_MCP_ADAPTER_KEYRING_RECOVERY_KEYCTL";
var KEYRING_RECOVERY_NODE_ENV = "PI_MCP_ADAPTER_KEYRING_RECOVERY_NODE";
var KEYRING_RECOVERY_HELPER_ENV = "PI_MCP_ADAPTER_KEYRING_RECOVERY_HELPER";
var TEST_LINUX_KEYRING_RECOVERY_ENV = "PI_MCP_ADAPTER_TEST_LINUX_KEYRING_RECOVERY";
var AUTH_CACHE_DISABLED_ENV = "PI_MCP_ADAPTER_DISABLE_AUTH_CACHE";
var KEYRING_RECOVERY_TIMEOUT_MS = 1e4;
var AUTH_CHUNK_MANIFEST_KEY = "__piMcpAdapterOAuthChunked";
var OAuthCredentialStoreError = class extends Error {
  constructor(message, operation, cause) {
    super(message, { cause });
    this.operation = operation;
    this.name = "OAuthCredentialStoreError";
  }
  operation;
  code = "OAUTH_CREDENTIAL_STORE_UNAVAILABLE";
};
function causeChainContains(error, pattern) {
  const seen = /* @__PURE__ */ new Set();
  let current = error;
  while (typeof current === "object" && current !== null || typeof current === "function") {
    if (seen.has(current)) break;
    seen.add(current);
    const candidate = current;
    if ([candidate.name, candidate.message, candidate.code].some((value) => typeof value === "string" && pattern.test(value))) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
function formatOAuthCredentialStoreUnavailable(error) {
  if (process.platform === "linux" && causeChainContains(error, /key\s*(?:has been\s*)?revoked|keyrevoked/i)) {
    return "OAuth credential store unavailable: the Linux session keyring may be revoked. Start Pi from a fresh login/keyring session and retry.";
  }
  return "OAuth credential store unavailable. Configure or unlock the OS credential store and retry.";
}
var KeyringEntryClass;
var memoryAuthEntries = /* @__PURE__ */ new Map();
var testAuthSecretStoreReadCount = 0;
var authEntryCache = /* @__PURE__ */ new Map();
function isAuthEntryCacheEnabled() {
  return process.env[AUTH_CACHE_DISABLED_ENV] !== "1";
}
function cloneAuthEntry(entry) {
  return entry === void 0 ? void 0 : structuredClone(entry);
}
var memoryAuthSecretStore = {
  read(account) {
    testAuthSecretStoreReadCount++;
    return memoryAuthEntries.get(account);
  },
  write(account, payload) {
    memoryAuthEntries.set(account, payload);
  },
  remove(account) {
    memoryAuthEntries.delete(account);
  }
};
var keyringAuthSecretStore = {
  read(account) {
    return getKeyringEntry(account).getPassword() ?? void 0;
  },
  write(account, payload) {
    getKeyringEntry(account).setPassword(payload);
  },
  remove(account) {
    getKeyringEntry(account).deleteCredential();
  }
};
var sizeLimitedAuthSecretStore = {
  read(account) {
    testAuthSecretStoreReadCount++;
    return memoryAuthEntries.get(account);
  },
  write(account, payload) {
    if (payload.length > AUTH_SECRET_VALUE_LIMIT) {
      throw new Error(`Value of 'password encoded as UTF-16' is longer than the platform limit of ${AUTH_SECRET_VALUE_LIMIT * 2} chars`);
    }
    memoryAuthEntries.set(account, payload);
  },
  remove(account) {
    memoryAuthEntries.delete(account);
  }
};
var unavailableAuthSecretStore = {
  read() {
    testAuthSecretStoreReadCount++;
    throw new Error("simulated secure credential store unavailable");
  },
  write() {
    throw new Error("simulated secure credential store unavailable");
  },
  remove() {
    throw new Error("simulated secure credential store unavailable");
  }
};
function createKeyRevokedTestError() {
  return new Error("Couldn't access platform storage: KeyRevoked", { cause: new Error("KeyRevoked") });
}
var keyRevokedAuthSecretStore = {
  read() {
    testAuthSecretStoreReadCount++;
    throw createKeyRevokedTestError();
  },
  write() {
    throw createKeyRevokedTestError();
  },
  remove() {
    throw createKeyRevokedTestError();
  }
};
function getAuthSecretStore() {
  if (process.env[TEST_AUTH_STORE_ENV] === "memory") return memoryAuthSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV] === "sizelimited") return sizeLimitedAuthSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV] === "unavailable") return unavailableAuthSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV] === "keyrevoked") return keyRevokedAuthSecretStore;
  return keyringAuthSecretStore;
}
function getKeyringEntry(account) {
  try {
    KeyringEntryClass ??= loadKeyringEntryClass();
    return new KeyringEntryClass(AUTH_SECRET_SERVICE, account);
  } catch (error) {
    throw new Error("OAuth secure credential storage is unavailable. Configure the OS credential store and retry authentication.", { cause: error });
  }
}
function loadKeyringEntryClass(keyringRequire = require2, platform = process.platform, arch = process.arch) {
  try {
    return keyringRequire("@napi-rs/keyring").Entry;
  } catch (loaderError) {
    try {
      return loadKeyringNativeBindingFallback(keyringRequire, platform, arch).Entry;
    } catch (fallbackError) {
      throw new Error(`Failed to load @napi-rs/keyring; absolute-path native binding fallback also failed: ${formatErrorMessage(fallbackError)}`, {
        cause: loaderError
      });
    }
  }
}
function loadKeyringNativeBindingFallback(keyringRequire, platform, arch) {
  const targets = getKeyringNativeBindingTargets(platform, arch);
  if (targets.length === 0) {
    throw new Error(`Unsupported @napi-rs/keyring native binding target: ${platform}-${arch}`);
  }
  let lastError;
  for (const target of targets) {
    try {
      const packageJsonPath = keyringRequire.resolve(`${target.packageName}/package.json`);
      return keyringRequire(join3(dirname(packageJsonPath), target.bindingFile));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
function getKeyringNativeBindingTargets(platform, arch) {
  return getKeyringNativeBindingSuffixes(platform, arch).map((suffix) => ({
    packageName: `@napi-rs/keyring-${suffix}`,
    bindingFile: `keyring.${suffix}.node`
  }));
}
function getKeyringNativeBindingSuffixes(platform, arch) {
  if (platform === "darwin") {
    if (arch === "arm64") return ["darwin-arm64"];
    if (arch === "x64") return ["darwin-x64"];
  }
  if (platform === "win32") {
    if (arch === "arm64") return ["win32-arm64-msvc"];
    if (arch === "x64") return ["win32-x64-msvc"];
    if (arch === "ia32") return ["win32-ia32-msvc"];
  }
  if (platform === "linux") {
    if (arch === "arm64") return ["linux-arm64-gnu", "linux-arm64-musl"];
    if (arch === "arm") return ["linux-arm-gnueabihf"];
    if (arch === "riscv64") return ["linux-riscv64-gnu"];
    if (arch === "x64") return ["linux-x64-gnu", "linux-x64-musl"];
  }
  if (platform === "freebsd" && arch === "x64") return ["freebsd-x64"];
  return [];
}
function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function isLinuxKeyringRecoveryEnabled() {
  if (process.env[KEYRING_RECOVERY_DISABLED_ENV] === "1") return false;
  return process.platform === "linux" || process.env[TEST_LINUX_KEYRING_RECOVERY_ENV] === "1";
}
function shouldAttemptLinuxKeyringRecovery(error) {
  return isLinuxKeyringRecoveryEnabled() && causeChainContains(error, /key\s*(?:has been\s*)?revoked|keyrevoked/i);
}
function runLinuxKeyringRecoveryOperation(operation, account, payload) {
  const keyctl = process.env[KEYRING_RECOVERY_KEYCTL_ENV]?.trim() || "keyctl";
  const node = process.env[KEYRING_RECOVERY_NODE_ENV]?.trim() || "node";
  const helper = process.env[KEYRING_RECOVERY_HELPER_ENV]?.trim() || fileURLToPath(new URL("./mcp-keyring-helper.cjs", import.meta.url));
  const request = JSON.stringify({ operation, service: AUTH_SECRET_SERVICE, account, payload });
  const result = spawnSync(keyctl, ["session", "-", node, helper], {
    input: `${request}
`,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: KEYRING_RECOVERY_TIMEOUT_MS,
    windowsHide: true
  });
  if (result.error) {
    throw new Error(`Linux keyring recovery helper could not start: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`Linux keyring recovery helper failed with exit code ${result.status ?? "unknown"}`);
  }
  let response;
  try {
    response = JSON.parse(result.stdout.trim());
  } catch (error) {
    throw new Error("Linux keyring recovery helper returned invalid JSON", { cause: error });
  }
  if (typeof response !== "object" || response === null || typeof response.ok !== "boolean") {
    throw new Error("Linux keyring recovery helper returned an invalid response");
  }
  const typedResponse = response;
  if (typedResponse.ok === false) {
    throw new Error(typedResponse.error || "Linux keyring recovery helper failed");
  }
  if (operation === "read" && typedResponse.found === true && typeof typedResponse.value !== "string") {
    throw new Error("Linux keyring recovery helper returned an invalid read response");
  }
  return typedResponse;
}
var linuxKeyringRecoveryAuthSecretStore = {
  read(account) {
    const response = runLinuxKeyringRecoveryOperation("read", account);
    return response.ok && response.found === true ? response.value : void 0;
  },
  write(account, payload) {
    runLinuxKeyringRecoveryOperation("write", account, payload);
  },
  remove(account) {
    runLinuxKeyringRecoveryOperation("remove", account);
  }
};
function getAuthBaseDir(options = {}) {
  const override = process.env.MCP_OAUTH_DIR?.trim();
  if (override) return override;
  return options.baseDir ?? getAgentPath("mcp-oauth");
}
function getServerDir(serverName, options) {
  if (typeof serverName !== "string") {
    throw new Error(`Invalid MCP server name: ${JSON.stringify(serverName)}`);
  }
  const storageKey = getAuthEntryAccount(serverName);
  return join3(getAuthBaseDir(options), storageKey);
}
function getAuthEntryAccount(serverName) {
  if (typeof serverName !== "string") {
    throw new Error(`Invalid MCP server name: ${JSON.stringify(serverName)}`);
  }
  return `sha256-${createHash("sha256").update(serverName, "utf8").digest("hex")}`;
}
function getAuthEntryFilePath(serverName, options) {
  return join3(getServerDir(serverName, options), "tokens.json");
}
function parseJsonPayload(serverName, payload, source) {
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error(`Failed to parse OAuth credentials for ${serverName} from ${source}`, { cause: error });
  }
}
function parseAuthEntryPayload(serverName, payload, source) {
  const parsed = parseJsonPayload(serverName, payload, source);
  const entry = toAuthEntry(parsed);
  if (!entry) {
    throw new Error(`Failed to parse OAuth credentials for ${serverName} from ${source}: invalid credential shape`);
  }
  return entry;
}
function toAuthEntry(value) {
  const entry = toRecord(value);
  if (!entry) return void 0;
  const codeVerifier = optionalString(entry.codeVerifier);
  const oauthState = optionalString(entry.oauthState);
  const serverUrl = optionalString(entry.serverUrl);
  if (codeVerifier === null || oauthState === null || serverUrl === null) return void 0;
  const tokens = entry.tokens === void 0 ? void 0 : toStoredTokens(entry.tokens);
  const clientInfo = entry.clientInfo === void 0 ? void 0 : toStoredClientInfo(entry.clientInfo);
  if (entry.tokens !== void 0 && !tokens || entry.clientInfo !== void 0 && !clientInfo) return void 0;
  const authEntry = {};
  if (tokens) authEntry.tokens = tokens;
  if (clientInfo) authEntry.clientInfo = clientInfo;
  if (codeVerifier !== void 0) authEntry.codeVerifier = codeVerifier;
  if (oauthState !== void 0) authEntry.oauthState = oauthState;
  if (serverUrl !== void 0) authEntry.serverUrl = serverUrl;
  return authEntry;
}
function toStoredTokens(value) {
  const tokens = toRecord(value);
  if (!tokens || typeof tokens.accessToken !== "string") return void 0;
  const refreshToken = optionalString(tokens.refreshToken);
  const scope = optionalString(tokens.scope);
  const issuer = optionalString(tokens.issuer);
  const expiresAt = optionalNumber(tokens.expiresAt);
  if (refreshToken === null || scope === null || issuer === null || expiresAt === null) return void 0;
  const storedTokens = { accessToken: tokens.accessToken };
  if (refreshToken !== void 0) storedTokens.refreshToken = refreshToken;
  if (expiresAt !== void 0) storedTokens.expiresAt = expiresAt;
  if (scope !== void 0) storedTokens.scope = scope;
  if (issuer !== void 0) storedTokens.issuer = issuer;
  return storedTokens;
}
function toStoredClientInfo(value) {
  const clientInfo = toRecord(value);
  if (!clientInfo || typeof clientInfo.clientId !== "string") return void 0;
  const clientSecret = optionalString(clientInfo.clientSecret);
  const issuer = optionalString(clientInfo.issuer);
  const clientIdIssuedAt = optionalNumber(clientInfo.clientIdIssuedAt);
  const clientSecretExpiresAt = optionalNumber(clientInfo.clientSecretExpiresAt);
  const configPreRegistered = optionalBoolean(clientInfo.configPreRegistered);
  if (clientSecret === null || issuer === null || clientIdIssuedAt === null || clientSecretExpiresAt === null || configPreRegistered === null) return void 0;
  const storedClient = { clientId: clientInfo.clientId };
  const redirectUris = stringArray(clientInfo.redirectUris);
  if (clientSecret !== void 0) storedClient.clientSecret = clientSecret;
  if (clientIdIssuedAt !== void 0) storedClient.clientIdIssuedAt = clientIdIssuedAt;
  if (clientSecretExpiresAt !== void 0) storedClient.clientSecretExpiresAt = clientSecretExpiresAt;
  if (redirectUris !== void 0) storedClient.redirectUris = redirectUris;
  if (issuer !== void 0) storedClient.issuer = issuer;
  if (configPreRegistered !== void 0) storedClient.configPreRegistered = configPreRegistered;
  return storedClient;
}
function toRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function optionalString(value) {
  if (value === void 0) return void 0;
  return typeof value === "string" ? value : null;
}
function optionalNumber(value) {
  if (value === void 0) return void 0;
  return typeof value === "number" ? value : null;
}
function optionalBoolean(value) {
  if (value === void 0) return void 0;
  return typeof value === "boolean" ? value : null;
}
function stringArray(value) {
  return Array.isArray(value) && value.every((uri) => typeof uri === "string") ? value : void 0;
}
function isAuthEntryChunkManifest(value) {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value;
  return manifest[AUTH_CHUNK_MANIFEST_KEY] === 1 && typeof manifest.chunkCount === "number" && Number.isInteger(manifest.chunkCount) && manifest.chunkCount > 0 && typeof manifest.chunkDigest === "string" && /^[a-f0-9]{16}$/.test(manifest.chunkDigest);
}
function getAuthEntryChunkAccount(account, manifest, index) {
  return `${account}.chunk.${manifest.chunkDigest}.${index}`;
}
function getAuthEntryChunkAccounts(account, manifest) {
  return Array.from({ length: manifest.chunkCount }, (_, index) => getAuthEntryChunkAccount(account, manifest, index));
}
function readChunkManifestFromPayload(serverName, payload, source) {
  const parsed = parseJsonPayload(serverName, payload, source);
  return isAuthEntryChunkManifest(parsed) ? parsed : void 0;
}
function readExistingChunkManifest(store, serverName, account) {
  try {
    const payload = store.read(account);
    return payload === void 0 ? void 0 : readChunkManifestFromPayload(serverName, payload, "OS secure credential store");
  } catch {
    return void 0;
  }
}
function removeChunkPayloads(store, account, manifest) {
  for (const chunkAccount of getAuthEntryChunkAccounts(account, manifest)) {
    store.remove(chunkAccount);
  }
}
function tryRemoveChunkPayloads(store, account, manifest) {
  if (!manifest) return;
  try {
    removeChunkPayloads(store, account, manifest);
  } catch {
  }
}
function createChunkManifest(payload) {
  return {
    [AUTH_CHUNK_MANIFEST_KEY]: 1,
    chunkCount: Math.ceil(payload.length / AUTH_SECRET_CHUNK_SIZE),
    chunkDigest: createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16)
  };
}
function readChunkedAuthEntry(store, serverName, account, manifest) {
  const chunks = getAuthEntryChunkAccounts(account, manifest).map((chunkAccount) => {
    try {
      const chunk = store.read(chunkAccount);
      if (chunk === void 0) {
        throw new Error(`Missing OAuth credential chunk ${chunkAccount} for ${serverName}`);
      }
      return chunk;
    } catch (error) {
      throw new OAuthCredentialStoreError(
        `Failed to read OAuth credentials for ${serverName} from the OS secure credential store`,
        "read",
        error
      );
    }
  });
  return parseAuthEntryPayload(serverName, chunks.join(""), "OS secure credential store chunks");
}
function readLegacyAuthEntry(serverName, options) {
  const filePath = getAuthEntryFilePath(serverName, options);
  if (!existsSync(filePath)) return void 0;
  const data = readFileSync2(filePath, "utf-8");
  return parseAuthEntryPayload(serverName, data, filePath);
}
function removeLegacyAuthEntry(serverName, options) {
  const filePath = getAuthEntryFilePath(serverName, options);
  if (!existsSync(filePath)) return;
  try {
    rmSync(filePath, { force: true });
  } catch (error) {
    throw new Error(`Failed to remove legacy plaintext OAuth credentials for ${serverName} at ${filePath}`, { cause: error });
  }
  const dir = getServerDir(serverName, options);
  try {
    rmSync(dir, { recursive: true });
  } catch {
  }
}
function writeSecureAuthEntryToStore(store, serverName, entry) {
  const account = getAuthEntryAccount(serverName);
  const payload = JSON.stringify(entry);
  const previousManifest = readExistingChunkManifest(store, serverName, account);
  const manifest = payload.length > AUTH_SECRET_CHUNK_SIZE ? createChunkManifest(payload) : void 0;
  try {
    if (manifest) {
      for (let index = 0; index < manifest.chunkCount; index++) {
        const chunk = payload.slice(index * AUTH_SECRET_CHUNK_SIZE, (index + 1) * AUTH_SECRET_CHUNK_SIZE);
        store.write(getAuthEntryChunkAccount(account, manifest, index), chunk);
      }
      store.write(account, JSON.stringify(manifest));
    } else {
      store.write(account, payload);
    }
    if (previousManifest?.chunkDigest !== manifest?.chunkDigest) {
      tryRemoveChunkPayloads(store, account, previousManifest);
    }
  } catch (error) {
    tryRemoveChunkPayloads(store, account, manifest);
    throw new OAuthCredentialStoreError(
      `Failed to write OAuth credentials for ${serverName} to the OS secure credential store`,
      "write",
      error
    );
  }
  publishAuthEntryToCache(serverName, payload);
}
function publishAuthEntryToCache(serverName, payload) {
  if (!isAuthEntryCacheEnabled()) return;
  const normalized = toAuthEntry(JSON.parse(payload));
  if (!normalized) {
    authEntryCache.delete(serverName);
    return;
  }
  authEntryCache.set(serverName, cloneAuthEntry(normalized));
}
function writeSecureAuthEntry(serverName, entry) {
  try {
    writeSecureAuthEntryToStore(getAuthSecretStore(), serverName, entry);
  } catch (error) {
    if (!shouldAttemptLinuxKeyringRecovery(error)) throw error;
    writeSecureAuthEntryToStore(linuxKeyringRecoveryAuthSecretStore, serverName, entry);
  }
}
function readAuthEntryFromStore(store, serverName, options, behavior = {}) {
  const account = getAuthEntryAccount(serverName);
  let payload;
  try {
    payload = store.read(account);
  } catch (error) {
    throw new OAuthCredentialStoreError(
      `Failed to read OAuth credentials for ${serverName} from the OS secure credential store`,
      "read",
      error
    );
  }
  if (payload !== void 0) {
    const manifest = readChunkManifestFromPayload(serverName, payload, "OS secure credential store");
    const entry = manifest ? readChunkedAuthEntry(store, serverName, account, manifest) : parseAuthEntryPayload(serverName, payload, "OS secure credential store");
    removeLegacyAuthEntry(serverName, options);
    return entry;
  }
  const legacyEntry = readLegacyAuthEntry(serverName, options);
  if (!legacyEntry) return void 0;
  if (behavior.migrateLegacy === false) return legacyEntry;
  writeSecureAuthEntryToStore(store, serverName, legacyEntry);
  removeLegacyAuthEntry(serverName, options);
  return legacyEntry;
}
function readAuthEntry(serverName, options, behavior = {}) {
  const cacheable = behavior.migrateLegacy !== false && isAuthEntryCacheEnabled();
  if (cacheable && authEntryCache.has(serverName)) {
    return cloneAuthEntry(authEntryCache.get(serverName));
  }
  let entry;
  try {
    entry = readAuthEntryFromStore(getAuthSecretStore(), serverName, options, behavior);
  } catch (error) {
    if (!shouldAttemptLinuxKeyringRecovery(error)) throw error;
    entry = readAuthEntryFromStore(linuxKeyringRecoveryAuthSecretStore, serverName, options, behavior);
  }
  if (cacheable) authEntryCache.set(serverName, cloneAuthEntry(entry));
  return entry;
}
function getAuthEntry(serverName, options) {
  return readAuthEntry(serverName, options);
}
function getAuthForUrl(serverName, serverUrl, options) {
  const entry = getAuthEntry(serverName, options);
  if (!entry) return void 0;
  if (!entry.serverUrl) return void 0;
  if (entry.serverUrl !== serverUrl) return void 0;
  return entry;
}
function inspectAuthForUrl(serverName, serverUrl, options) {
  try {
    const entry = readAuthEntry(serverName, options, { migrateLegacy: false });
    if (!entry?.serverUrl || entry.serverUrl !== serverUrl) return { status: "absent" };
    return { status: "present", entry };
  } catch (error) {
    if (!(error instanceof OAuthCredentialStoreError)) throw error;
    return { status: "unavailable", message: formatOAuthCredentialStoreUnavailable(error) };
  }
}
function saveAuthEntry(serverName, entry, serverUrl, options) {
  if (serverUrl) {
    entry.serverUrl = serverUrl;
  }
  writeSecureAuthEntry(serverName, entry);
  removeLegacyAuthEntry(serverName, options);
}
function removeAuthEntryFromStore(store, serverName) {
  const account = getAuthEntryAccount(serverName);
  try {
    const payload = store.read(account);
    const manifest = payload === void 0 ? void 0 : readChunkManifestFromPayload(serverName, payload, "OS secure credential store");
    if (manifest) removeChunkPayloads(store, account, manifest);
    store.remove(account);
  } catch (error) {
    throw new OAuthCredentialStoreError(
      `Failed to remove OAuth credentials for ${serverName} from the OS secure credential store`,
      "remove",
      error
    );
  }
}
function removeAuthEntry(serverName, options) {
  try {
    removeAuthEntryFromStore(getAuthSecretStore(), serverName);
  } catch (error) {
    if (!shouldAttemptLinuxKeyringRecovery(error)) throw error;
    removeAuthEntryFromStore(linuxKeyringRecoveryAuthSecretStore, serverName);
  }
  authEntryCache.delete(serverName);
  removeLegacyAuthEntry(serverName, options);
}
function invalidateAuthEntryCache(serverName) {
  authEntryCache.delete(serverName);
}
function updateTokens(serverName, tokens, serverUrl, options) {
  const entry = getAuthEntry(serverName, options) ?? {};
  if (serverUrl && entry.serverUrl !== serverUrl) {
    delete entry.clientInfo;
    delete entry.codeVerifier;
    delete entry.oauthState;
  }
  entry.tokens = tokens;
  saveAuthEntry(serverName, entry, serverUrl, options);
}
function updateClientInfo(serverName, clientInfo, serverUrl, options) {
  const entry = getAuthEntry(serverName, options) ?? {};
  if (serverUrl && entry.serverUrl !== serverUrl) {
    delete entry.tokens;
    delete entry.codeVerifier;
    delete entry.oauthState;
  }
  entry.clientInfo = clientInfo;
  saveAuthEntry(serverName, entry, serverUrl, options);
}
function clearCodeVerifier(serverName, options) {
  const entry = getAuthEntry(serverName, options);
  if (entry) {
    delete entry.codeVerifier;
    saveAuthEntry(serverName, entry, void 0, options);
  }
}
function isTokenExpired(serverName, options) {
  const entry = getAuthEntry(serverName, options);
  if (!entry?.tokens) return null;
  if (!entry.tokens.expiresAt) return false;
  return entry.tokens.expiresAt < Date.now() / 1e3;
}
function clearAllCredentials(serverName, options) {
  removeAuthEntry(serverName, options);
}

// src/utils.ts
import { spawnSync as spawnSync2 } from "node:child_process";
function interpolateEnvVars(value, environment = process.env) {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => environment[name] ?? "").replace(/\$env:(\w+)/g, (_, name) => environment[name] ?? "").replace(/\{env:(\w+)\}/g, (_, name) => environment[name] ?? "");
}
function interpolateSecretExpression(value, environment) {
  if (value.startsWith("!!")) return interpolateEnvVars(value.slice(1), environment);
  return value.startsWith("!") ? value : interpolateEnvVars(value, environment);
}
function interpolateEnvRecord(values, environment = process.env) {
  if (!values) return void 0;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    interpolateSecretExpression(value, environment)
  ]));
}
var COMMAND_SECRET_TIMEOUT_MS = 1e4;
var COMMAND_SECRET_MAX_OUTPUT_BYTES = 1024 * 1024;
function resolveCommandSecret(value, context) {
  if (value === void 0) return void 0;
  if (value.startsWith("!!")) return interpolateEnvVars(value.slice(1));
  if (!value.startsWith("!")) return interpolateEnvVars(value);
  const result = spawnSync2(value.slice(1), {
    shell: true,
    encoding: "utf8",
    timeout: COMMAND_SECRET_TIMEOUT_MS,
    maxBuffer: COMMAND_SECRET_MAX_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true
  });
  if (result.error) {
    const code = result.error.code;
    const reason = code === "ETIMEDOUT" ? "command timed out after 10 seconds" : code === "ENOBUFS" ? "command output exceeded 1 MiB" : "command failed to start";
    throw new Error(`Failed to resolve ${context}: ${reason}`);
  }
  if (result.status !== 0) {
    throw new Error(`Failed to resolve ${context}: command exited with code ${result.status ?? "unknown"}`);
  }
  const resolved = result.stdout.trim();
  if (!resolved) throw new Error(`Failed to resolve ${context}: command returned empty output`);
  return resolved;
}

// src/auth/mcp-oauth-provider.ts
function defaultClientName() {
  const app = getAppName();
  return app === "pi" ? "Pi Coding Agent" : app;
}
function defaultClientUri() {
  const declared = getAppClientUri();
  if (declared) return declared;
  return getAppName() === "pi" ? "https://github.com/nicobailon/pi-mcp-adapter" : void 0;
}
function issuersMatch(first, second) {
  return first === second || first.endsWith("/") && first.slice(0, -1) === second || second.endsWith("/") && second.slice(0, -1) === first;
}
function toOAuthTokens(tokens) {
  const result = {
    access_token: tokens.accessToken,
    token_type: "Bearer"
  };
  if (tokens.refreshToken !== void 0) result.refresh_token = tokens.refreshToken;
  if (tokens.expiresAt !== void 0) result.expires_in = Math.max(0, Math.floor(tokens.expiresAt - Date.now() / 1e3));
  if (tokens.scope !== void 0) result.scope = tokens.scope;
  if (tokens.issuer !== void 0) result.issuer = tokens.issuer;
  return result;
}
var DEFAULT_OAUTH_CALLBACK_PORT = 19876;
var DEFAULT_OAUTH_CALLBACK_PATH = "/callback";
var configuredOAuthCallbackPort = DEFAULT_OAUTH_CALLBACK_PORT;
if (process.env.MCP_OAUTH_CALLBACK_PORT) {
  const parsedPort = Number.parseInt(process.env.MCP_OAUTH_CALLBACK_PORT, 10);
  if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
    configuredOAuthCallbackPort = parsedPort;
  }
}
var oauthCallbackPort = configuredOAuthCallbackPort;
var oauthCallbackPath = DEFAULT_OAUTH_CALLBACK_PATH;
function getOAuthCallbackPort() {
  return oauthCallbackPort;
}
function getOAuthCallbackPath() {
  return oauthCallbackPath;
}
var reservedAuthorizationParams = /* @__PURE__ */ new Set([
  "client_id",
  "code_challenge",
  "code_challenge_method",
  "redirect_uri",
  "resource",
  "response_type",
  "scope",
  "state"
]);
function addAuthorizationParams(authorizationUrl, params) {
  if (!params) return authorizationUrl;
  const nextUrl = new URL(authorizationUrl.toString());
  for (const [key, value] of Object.entries(params)) {
    if (reservedAuthorizationParams.has(key) || nextUrl.searchParams.has(key)) {
      throw new Error(`OAuth authorizationParams.${key} cannot override an authorization flow parameter`);
    }
    nextUrl.searchParams.set(key, value);
  }
  return nextUrl;
}
var McpOAuthProvider = class {
  constructor(serverName, serverUrl, config, callbacks, storageOptions = {}, runtimeSignal, initialState) {
    this.serverName = serverName;
    this.serverUrl = serverUrl;
    this.config = config;
    this.callbacks = callbacks;
    this.storageOptions = storageOptions;
    this.runtimeSignal = runtimeSignal;
    this.flowState = initialState;
    this.redirectUrlSnapshot = config.grantType === "client_credentials" ? void 0 : config.redirectUri ?? `http://localhost:${getOAuthCallbackPort()}${getOAuthCallbackPath()}`;
  }
  serverName;
  serverUrl;
  config;
  callbacks;
  storageOptions;
  runtimeSignal;
  redirectUrlSnapshot;
  active = true;
  flowClientInfo;
  flowCodeVerifier;
  flowDiscoveryState;
  flowIssuerMismatch = false;
  flowState;
  invalidatedAccessToken;
  invalidatedClientId;
  lastObservedClientId;
  lastSavedAccessToken;
  pendingAuthAccessToken;
  get usesClientCredentials() {
    return this.config.grantType === "client_credentials";
  }
  get discoveredIssuer() {
    return this.flowDiscoveryState?.authorizationServerMetadata?.issuer ?? this.flowDiscoveryState?.authorizationServerUrl;
  }
  deactivate() {
    this.active = false;
    this.invalidatedAccessToken = void 0;
    this.invalidatedClientId = void 0;
    this.lastObservedClientId = void 0;
    this.lastSavedAccessToken = void 0;
    this.pendingAuthAccessToken = void 0;
  }
  assertStoredIssuerBindings(entry, issuer) {
    if (this.flowIssuerMismatch) {
      throw new Error(
        `OAuth authorization server issuer changed for ${this.serverName}; clear credentials before authenticating again`
      );
    }
    if (!entry || !issuer) return;
    const storedIssuers = [entry.clientInfo?.issuer, entry.tokens?.issuer].filter((storedIssuer) => storedIssuer !== void 0);
    if (storedIssuers.some((storedIssuer) => !issuersMatch(storedIssuer, issuer))) {
      this.flowIssuerMismatch = true;
      throw new Error(
        `OAuth authorization server issuer changed for ${this.serverName}; clear credentials before authenticating again`
      );
    }
  }
  throwIfInactive() {
    if (!this.active) throw new Error("OAuth flow is no longer active");
    this.runtimeSignal?.throwIfAborted();
  }
  /**
   * The redirect URL for OAuth callbacks.
   * This must match the redirect_uri in client metadata.
   */
  get redirectUrl() {
    return this.redirectUrlSnapshot;
  }
  /** Configured homepage, else the historical default on stock pi, else nothing. */
  get clientUri() {
    return this.config.clientUri ?? defaultClientUri();
  }
  /**
   * Client metadata for dynamic registration.
   * Describes this client to the OAuth authorization server.
   */
  get clientMetadata() {
    if (this.usesClientCredentials) {
      return {
        client_name: this.config.clientName ?? defaultClientName(),
        ...this.clientUri !== void 0 ? { client_uri: this.clientUri } : {},
        ...this.config.logoUri !== void 0 ? { logo_uri: this.config.logoUri } : {},
        redirect_uris: [],
        grant_types: ["client_credentials"],
        token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none"
      };
    }
    const redirectUrl = this.redirectUrl;
    if (!redirectUrl) {
      throw new Error("redirectUrl is required for authorization_code flow");
    }
    return {
      redirect_uris: [redirectUrl],
      client_name: this.config.clientName ?? defaultClientName(),
      ...this.clientUri !== void 0 ? { client_uri: this.clientUri } : {},
      ...this.config.logoUri !== void 0 ? { logo_uri: this.config.logoUri } : {},
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
      ...this.config.scope !== void 0 ? { scope: this.config.scope } : {}
    };
  }
  /**
   * Get client information (for pre-registered or dynamically registered clients).
   * Returns undefined if no client info exists or if the server URL has changed.
   */
  async clientInformation() {
    if (this.invalidatedClientId !== void 0) {
      invalidateAuthEntryCache(this.serverName);
    }
    const issuer = this.discoveredIssuer;
    const stored = await getAuthForUrl(this.serverName, this.serverUrl, this.storageOptions);
    this.assertStoredIssuerBindings(stored, issuer);
    if (this.config.clientId) {
      const storedClient = stored?.clientInfo?.clientId === this.config.clientId ? stored.clientInfo : void 0;
      if (issuer && (storedClient?.issuer !== issuer || storedClient.configPreRegistered !== true)) {
        updateClientInfo(
          this.serverName,
          { clientId: this.config.clientId, issuer, configPreRegistered: true },
          this.serverUrl,
          this.storageOptions
        );
      }
      const clientSecret = this.config.clientSecret?.startsWith("!") ? resolveCommandSecret(
        this.config.clientSecret,
        `MCP server "${this.serverName}" OAuth clientSecret`
      ) : this.config.clientSecret;
      return {
        client_id: this.config.clientId,
        client_secret: clientSecret,
        ...issuer !== void 0 ? { issuer } : {}
      };
    }
    const clientInfo = this.flowClientInfo ?? stored?.clientInfo;
    if (clientInfo?.clientId === this.invalidatedClientId) return void 0;
    if (clientInfo) {
      this.invalidatedClientId = void 0;
      const isConfigStub = clientInfo.configPreRegistered === true || clientInfo.clientSecret === void 0 && clientInfo.clientIdIssuedAt === void 0 && clientInfo.clientSecretExpiresAt === void 0 && clientInfo.redirectUris === void 0;
      if (isConfigStub) {
        return void 0;
      }
      if (clientInfo.clientSecretExpiresAt && clientInfo.clientSecretExpiresAt < Date.now() / 1e3) {
        return void 0;
      }
      if (issuer && clientInfo.issuer && !issuersMatch(clientInfo.issuer, issuer)) {
        return void 0;
      }
      if (issuer && clientInfo.issuer === void 0) {
        clientInfo.issuer = issuer;
        this.flowClientInfo = clientInfo;
        updateClientInfo(this.serverName, clientInfo, this.serverUrl, this.storageOptions);
      }
      this.lastObservedClientId = clientInfo.clientId;
      return {
        client_id: clientInfo.clientId,
        client_secret: clientInfo.clientSecret,
        ...clientInfo.clientIdIssuedAt !== void 0 ? { client_id_issued_at: clientInfo.clientIdIssuedAt } : {},
        ...clientInfo.clientSecretExpiresAt !== void 0 ? { client_secret_expires_at: clientInfo.clientSecretExpiresAt } : {},
        ...clientInfo.redirectUris !== void 0 ? { redirect_uris: clientInfo.redirectUris } : {},
        ...clientInfo.issuer !== void 0 ? { issuer: clientInfo.issuer } : {}
      };
    }
    return void 0;
  }
  /**
   * Save client information from dynamic registration.
   */
  async saveClientInformation(info) {
    this.throwIfInactive();
    const issuer = this.discoveredIssuer ?? info.issuer;
    if (this.config.clientId && info.client_id === this.config.clientId) {
      updateClientInfo(
        this.serverName,
        {
          clientId: info.client_id,
          ...issuer !== void 0 ? { issuer } : {},
          configPreRegistered: true
        },
        this.serverUrl,
        this.storageOptions
      );
      return;
    }
    const redirectUris = ("redirect_uris" in info ? info.redirect_uris : void 0) ?? (this.redirectUrl ? [this.redirectUrl] : void 0);
    const clientInfo = {
      clientId: info.client_id,
      ...info.client_secret !== void 0 ? { clientSecret: info.client_secret } : {},
      ...info.client_id_issued_at !== void 0 ? { clientIdIssuedAt: info.client_id_issued_at } : {},
      ...info.client_secret_expires_at !== void 0 ? { clientSecretExpiresAt: info.client_secret_expires_at } : {},
      ...redirectUris !== void 0 ? { redirectUris } : {},
      ...issuer !== void 0 ? { issuer } : {}
    };
    this.flowClientInfo = clientInfo;
    this.invalidatedClientId = void 0;
    this.lastObservedClientId = clientInfo.clientId;
    updateClientInfo(this.serverName, clientInfo, this.serverUrl, this.storageOptions);
  }
  /**
   * Get stored OAuth tokens.
   * Returns undefined if no tokens exist or if the server URL has changed.
   */
  async tokens(ctx) {
    if (this.invalidatedAccessToken !== void 0) {
      invalidateAuthEntryCache(this.serverName);
    }
    const entry = await getAuthForUrl(this.serverName, this.serverUrl, this.storageOptions);
    if (!entry?.tokens || entry.tokens.accessToken === this.invalidatedAccessToken) return void 0;
    this.invalidatedAccessToken = void 0;
    const issuer = this.discoveredIssuer;
    this.assertStoredIssuerBindings(entry, issuer);
    if (issuer && entry.tokens.issuer === void 0) {
      entry.tokens.issuer = issuer;
      updateTokens(this.serverName, entry.tokens, this.serverUrl, this.storageOptions);
    }
    if (ctx !== void 0) {
      this.pendingAuthAccessToken = entry.tokens.accessToken;
    }
    return toOAuthTokens(entry.tokens);
  }
  /**
   * Save OAuth tokens.
   */
  async saveTokens(tokens) {
    const issuer = this.discoveredIssuer ?? tokens.issuer;
    const storedTokens = {
      accessToken: tokens.access_token,
      ...tokens.refresh_token !== void 0 ? { refreshToken: tokens.refresh_token } : {},
      // Preserve expiry even when expires_in is 0 (e.g. the SDK re-saving an
      // already-expired token) so expired tokens stay expired instead of
      // being persisted as never-expiring.
      ...tokens.expires_in !== void 0 ? { expiresAt: Date.now() / 1e3 + tokens.expires_in } : {},
      ...tokens.scope !== void 0 ? { scope: tokens.scope } : {},
      ...issuer !== void 0 ? { issuer } : {}
    };
    this.throwIfInactive();
    updateTokens(this.serverName, storedTokens, this.serverUrl, this.storageOptions);
    this.invalidatedAccessToken = void 0;
    this.lastSavedAccessToken = storedTokens.accessToken;
    this.flowDiscoveryState = void 0;
  }
  /**
   * Redirect the user to the authorization URL.
   * This opens the browser for the user to authenticate.
   *
   * Throws UnauthorizedError when called outside of a user-initiated flow
   * (no oauthState saved by startAuth). That path is reached when the SDK
   * falls through from a failed refresh into a fresh authorization_code
   * flow, which library hosts cannot complete in-process.
   */
  async redirectToAuthorization(authorizationUrl) {
    if (this.usesClientCredentials) {
      throw new Error("redirectToAuthorization is not used for client_credentials flow");
    }
    this.throwIfInactive();
    if (!this.flowState) {
      throw new UnauthorizedError(
        `Re-authentication required for MCP server: ${this.serverName}`
      );
    }
    await this.callbacks.onRedirect(addAuthorizationParams(authorizationUrl, this.config.authorizationParams));
  }
  /**
   * Save the PKCE code verifier.
   */
  async saveCodeVerifier(codeVerifier) {
    this.throwIfInactive();
    this.flowCodeVerifier = codeVerifier;
  }
  /**
   * Get the stored PKCE code verifier.
   * @throws Error if no code verifier is stored
   */
  async codeVerifier() {
    if (this.usesClientCredentials) {
      throw new Error("codeVerifier is not used for client_credentials flow");
    }
    this.throwIfInactive();
    if (!this.flowCodeVerifier) {
      throw new Error(`No code verifier saved for MCP server: ${this.serverName}`);
    }
    return this.flowCodeVerifier;
  }
  /**
   * Keep discovery with the in-flight PKCE verifier. The callback leg uses it
   * to validate the authorization response issuer before token exchange.
   */
  async saveDiscoveryState(state) {
    this.throwIfInactive();
    this.flowDiscoveryState = structuredClone(state);
  }
  async discoveryState() {
    this.throwIfInactive();
    return this.flowDiscoveryState ? structuredClone(this.flowDiscoveryState) : void 0;
  }
  /**
   * Save the OAuth state parameter for CSRF protection.
   */
  async saveState(state) {
    this.throwIfInactive();
    this.flowState = state;
  }
  /**
   * Get the stored OAuth state parameter.
   * @throws UnauthorizedError if no flow is in progress (see redirectToAuthorization)
   */
  async state() {
    if (this.usesClientCredentials) {
      throw new Error("state is not used for client_credentials flow");
    }
    this.throwIfInactive();
    if (!this.flowState) {
      throw new UnauthorizedError(
        `Re-authentication required for MCP server: ${this.serverName}`
      );
    }
    return this.flowState;
  }
  /**
   * Invalidate credentials when authentication fails.
   * Clears tokens, client info, or all credentials based on the type.
   */
  async invalidateCredentials(type) {
    this.throwIfInactive();
    switch (type) {
      case "all":
        this.flowClientInfo = void 0;
        this.flowCodeVerifier = void 0;
        this.flowDiscoveryState = void 0;
        this.flowIssuerMismatch = false;
        this.flowState = void 0;
        this.invalidatedAccessToken = void 0;
        this.invalidatedClientId = void 0;
        this.lastObservedClientId = void 0;
        this.lastSavedAccessToken = void 0;
        this.pendingAuthAccessToken = void 0;
        clearAllCredentials(this.serverName, this.storageOptions);
        break;
      case "client":
        this.invalidatedClientId = this.lastObservedClientId;
        this.lastObservedClientId = void 0;
        this.flowClientInfo = void 0;
        invalidateAuthEntryCache(this.serverName);
        break;
      case "tokens":
        this.invalidatedAccessToken = this.pendingAuthAccessToken ?? this.lastSavedAccessToken;
        this.lastSavedAccessToken = void 0;
        this.pendingAuthAccessToken = void 0;
        invalidateAuthEntryCache(this.serverName);
        break;
      case "verifier":
        clearCodeVerifier(this.serverName, this.storageOptions);
        break;
      case "discovery":
        this.flowDiscoveryState = void 0;
        break;
    }
  }
  /**
   * Adds configured authorization-code scope without replacing the SDK's
   * default token endpoint authentication behavior.
   */
  addClientAuthentication = async (headers, params, _url, metadata) => {
    this.throwIfInactive();
    if (params.get("grant_type") === "authorization_code" && !params.has("scope") && this.config.scope) {
      params.set("scope", this.config.scope);
    }
    const clientInfo = await this.clientInformation();
    this.throwIfInactive();
    if (!clientInfo) {
      return;
    }
    const supportedMethods = metadata?.token_endpoint_auth_methods_supported ?? [];
    const hasClientSecret = clientInfo.client_secret !== void 0;
    let authMethod;
    if (supportedMethods.length === 0) {
      authMethod = hasClientSecret ? "client_secret_post" : "none";
    } else if (hasClientSecret && supportedMethods.includes("client_secret_basic")) {
      authMethod = "client_secret_basic";
    } else if (hasClientSecret && supportedMethods.includes("client_secret_post")) {
      authMethod = "client_secret_post";
    } else if (supportedMethods.includes("none")) {
      authMethod = "none";
    } else {
      authMethod = hasClientSecret ? "client_secret_post" : "none";
    }
    if (authMethod === "client_secret_basic") {
      if (!clientInfo.client_secret) {
        throw new Error("client_secret_basic authentication requires a client_secret");
      }
      headers.set("Authorization", `Basic ${Buffer.from(`${clientInfo.client_id}:${clientInfo.client_secret}`).toString("base64")}`);
      return;
    }
    if (!params.has("client_id")) {
      params.set("client_id", clientInfo.client_id);
    }
    if (authMethod === "client_secret_post" && clientInfo.client_secret && !params.has("client_secret")) {
      params.set("client_secret", clientInfo.client_secret);
    }
  };
  prepareTokenRequest(scope) {
    if (!this.usesClientCredentials) {
      return void 0;
    }
    const params = new URLSearchParams({ grant_type: "client_credentials" });
    const requestedScope = scope ?? this.config.scope;
    if (requestedScope) {
      params.set("scope", requestedScope);
    }
    return params;
  }
};

// src/auth/mcp-callback-server.ts
var CALLBACK_TIMEOUT_MS = 5 * 60 * 1e3;

// src/runtime/abort.ts
function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? "MCP request aborted"));
}
async function abortable(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return await new Promise((resolve3, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? "MCP request aborted")));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve3(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }
    );
  });
}

// src/extension/owner.ts
function combineAbortSignals(...signals) {
  const active = signals.filter((signal) => signal !== void 0);
  if (active.length === 0) return void 0;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}
function isAbortError(error, signal) {
  if (signal?.aborted) return true;
  return error instanceof Error && (error.name === "AbortError" || error.message === "MCP extension runtime stopped");
}

// src/auth/mcp-auth-flow.ts
var runtimeStates = /* @__PURE__ */ new WeakMap();
var activeRuntimes = /* @__PURE__ */ new Set();
function createOAuthRuntime(signal) {
  const controller = new AbortController();
  const runtime = { signal: combineAbortSignals(signal, controller.signal) };
  runtimeStates.set(runtime, {
    controller,
    generation: 0,
    pendingAuths: /* @__PURE__ */ new Map(),
    pendingAuthStates: /* @__PURE__ */ new Map(),
    pendingAuthCleanupTimers: /* @__PURE__ */ new Map(),
    pendingAuthentications: /* @__PURE__ */ new Map()
  });
  activeRuntimes.add(runtime);
  return runtime;
}
var legacyRuntime = createOAuthRuntime();
activeRuntimes.delete(legacyRuntime);
function getRuntime(options) {
  if (options?.runtime) {
    options.runtime.signal.throwIfAborted();
    activeRuntimes.add(options.runtime);
    return options.runtime;
  }
  if (legacyRuntime.signal.aborted) legacyRuntime = createOAuthRuntime();
  activeRuntimes.add(legacyRuntime);
  return legacyRuntime;
}
var MANUAL_AUTH_TIMEOUT_MS = 5 * 60 * 1e3;
async function probeAuthDiscovery(serverUrl, definition, signal) {
  const discoveryHeaders = definition?.headers ? Object.fromEntries(Object.entries(definition.headers).filter(([, value]) => !value.startsWith("!") || value.startsWith("!!"))) : void 0;
  const headers = new Headers(interpolateEnvRecord(discoveryHeaders));
  headers.set("content-type", "application/json");
  const controller = new AbortController();
  const discoverySignal = combineAbortSignals(signal, controller.signal);
  const timer = setTimeout(() => controller.abort(), 5e3);
  try {
    headers.set("accept", "application/json, text/event-stream");
    const response = await fetch(new URL(serverUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "pi-mcp-adapter", version: "2.11.0" }
        }
      }),
      ...discoverySignal ? { signal: discoverySignal } : {}
    });
    const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response);
    await response.body?.cancel().catch(() => {
    });
    return { ...resourceMetadataUrl ? { resourceMetadataUrl } : {}, ...scope ? { scope } : {} };
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    return {};
  } finally {
    clearTimeout(timer);
  }
}
async function getValidToken(serverName, serverUrl, options = {}) {
  const runtime = getRuntime(options);
  const authStorageOptions = options.authStorageOptions ?? {};
  const signal = combineAbortSignals(runtime.signal, options.signal);
  throwIfAborted(signal);
  const entry = await getAuthForUrl(serverName, serverUrl, authStorageOptions);
  throwIfAborted(signal);
  if (!entry?.tokens) {
    return null;
  }
  const expired = await isTokenExpired(serverName, authStorageOptions);
  if (expired === false) {
    return entry.tokens;
  }
  if (expired === true && entry.tokens.refreshToken) {
    console.log(`MCP Auth: Token expired for ${serverName}, attempting refresh`);
    try {
      const authProvider = new McpOAuthProvider(serverName, serverUrl, {}, {
        onRedirect: async () => {
        }
      }, authStorageOptions, runtime.signal);
      try {
        const clientInfo = await authProvider.clientInformation();
        throwIfAborted(signal);
        if (!clientInfo) {
          console.log(`MCP Auth: No client info for refresh for ${serverName}`);
          return null;
        }
        const discovery = await probeAuthDiscovery(serverUrl, void 0, signal);
        throwIfAborted(signal);
        const result = await abortable(runSdkAuth(authProvider, {
          serverUrl,
          ...discovery,
          ...options.skipIssuerMetadataValidation === true ? { skipIssuerMetadataValidation: true } : {}
        }), signal);
        throwIfAborted(signal);
        if (result !== "AUTHORIZED") {
          return null;
        }
        const refreshed = await getAuthForUrl(serverName, serverUrl, authStorageOptions);
        throwIfAborted(signal);
        return refreshed?.tokens ?? null;
      } finally {
        authProvider.deactivate();
      }
    } catch (error) {
      if (isAbortError(error, signal) || error instanceof OAuthCredentialStoreError) throw error;
      console.error(`MCP Auth: Token refresh failed for ${serverName}`, { error });
      return null;
    }
  }
  return entry.tokens;
}

// oauth.ts
async function getMcpOAuthTokensForUrl(serverName, serverUrl, options = {}) {
  return await getValidToken(serverName, serverUrl, options) ?? void 0;
}
function inspectMcpOAuthTokensForUrl(serverName, serverUrl, options) {
  const status = inspectAuthForUrl(serverName, serverUrl, options);
  if (status.status !== "present") return status;
  return status.entry.tokens ? { status: "present", tokens: status.entry.tokens } : { status: "absent" };
}
function updateMcpOAuthTokensForUrl(serverName, serverUrl, tokens, options) {
  updateTokens(serverName, tokens, serverUrl, options);
}
export {
  getMcpOAuthTokensForUrl,
  inspectMcpOAuthTokensForUrl,
  updateMcpOAuthTokensForUrl
};
