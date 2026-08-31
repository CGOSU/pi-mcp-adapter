// src/auth/mcp-bearer-store.ts
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
var require2 = createRequire(import.meta.url);
var BEARER_SECRET_SERVICE = "pi-mcp-adapter.bearer";
var TEST_AUTH_STORE_ENV = "PI_MCP_ADAPTER_TEST_AUTH_STORE";
var BEARER_SECRET_CHUNK_SIZE = 1e3;
var BEARER_SECRET_VALUE_LIMIT = 1280;
var KeyringEntryClass;
var memoryBearerEntries = /* @__PURE__ */ new Map();
var testBearerSecretStoreReadCount = 0;
var BearerCredentialStoreError = class extends Error {
  code = "BEARER_CREDENTIAL_STORE_UNAVAILABLE";
  operation;
  // No parameter properties: cli.js loads this module under plain Node
  // type stripping, which rejects non-erasable TypeScript syntax.
  constructor(message, operation, cause) {
    super(message, { cause });
    this.name = "BearerCredentialStoreError";
    this.operation = operation;
  }
};
var memoryBearerSecretStore = {
  read(account) {
    testBearerSecretStoreReadCount++;
    return memoryBearerEntries.get(account);
  },
  write(account, payload) {
    memoryBearerEntries.set(account, payload);
  },
  remove(account) {
    memoryBearerEntries.delete(account);
  }
};
var sizeLimitedBearerSecretStore = {
  read(account) {
    testBearerSecretStoreReadCount++;
    return memoryBearerEntries.get(account);
  },
  write(account, payload) {
    if (payload.length > BEARER_SECRET_VALUE_LIMIT) {
      throw new Error(`Value of 'password encoded as UTF-16' is longer than the platform limit of ${BEARER_SECRET_VALUE_LIMIT * 2} chars`);
    }
    memoryBearerEntries.set(account, payload);
  },
  remove(account) {
    memoryBearerEntries.delete(account);
  }
};
var unavailableBearerSecretStore = {
  read() {
    testBearerSecretStoreReadCount++;
    throw new Error("simulated secure credential store unavailable");
  },
  write() {
    throw new Error("simulated secure credential store unavailable");
  },
  remove() {
    throw new Error("simulated secure credential store unavailable");
  }
};
var keyringBearerSecretStore = {
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
function getBearerSecretStore() {
  if (process.env[TEST_AUTH_STORE_ENV] === "memory") return memoryBearerSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV] === "sizelimited") return sizeLimitedBearerSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV] === "unavailable") return unavailableBearerSecretStore;
  return keyringBearerSecretStore;
}
function getKeyringEntry(account) {
  try {
    KeyringEntryClass ??= loadKeyringEntryClass();
    return new KeyringEntryClass(BEARER_SECRET_SERVICE, account);
  } catch (error) {
    throw new Error("Bearer token secure credential storage is unavailable. Configure the OS credential store and retry.", { cause: error });
  }
}
function loadKeyringEntryClass(keyringRequire = require2, platform = process.platform, arch = process.arch) {
  try {
    return keyringRequire("@napi-rs/keyring").Entry;
  } catch (loaderError) {
    try {
      return loadKeyringNativeBindingFallback(keyringRequire, platform, arch).Entry;
    } catch (fallbackError) {
      const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`Failed to load @napi-rs/keyring; absolute-path native binding fallback also failed: ${message}`, { cause: loaderError });
    }
  }
}
function loadKeyringNativeBindingFallback(keyringRequire, platform, arch) {
  const targets = getKeyringNativeBindingSuffixes(platform, arch).map((suffix) => ({
    packageName: `@napi-rs/keyring-${suffix}`,
    bindingFile: `keyring.${suffix}.node`
  }));
  let lastError;
  for (const target of targets) {
    try {
      const packageJsonPath = keyringRequire.resolve(`${target.packageName}/package.json`);
      return keyringRequire(join(dirname(packageJsonPath), target.bindingFile));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
function getBearerAccount(serverName) {
  if (typeof serverName !== "string") {
    throw new Error(`Invalid MCP server name: ${JSON.stringify(serverName)}`);
  }
  return `sha256-${createHash("sha256").update(serverName, "utf8").digest("hex")}`;
}
function parseBearerPayload(serverName, payload) {
  const parsed = parseStoredBearerJson(serverName, payload);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Stored bearer token record for ${serverName} has invalid shape`);
  }
  const record = parsed;
  if (typeof record.token !== "string" || typeof record.serverUrl !== "string") {
    throw new Error(`Stored bearer token record for ${serverName} has invalid shape`);
  }
  return { token: record.token, serverUrl: record.serverUrl };
}
function parseStoredBearerJson(serverName, payload) {
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(`Failed to parse stored bearer token record for ${serverName}`);
  }
}
function isBearerChunkManifest(value) {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value;
  return manifest.__piMcpAdapterBearerChunked === 1 && typeof manifest.chunkCount === "number" && Number.isInteger(manifest.chunkCount) && manifest.chunkCount > 0 && typeof manifest.chunkDigest === "string" && /^[a-f0-9]{16}$/.test(manifest.chunkDigest);
}
function readManifest(serverName, payload) {
  const parsed = parseStoredBearerJson(serverName, payload);
  return isBearerChunkManifest(parsed) ? parsed : void 0;
}
function chunkAccount(account, manifest, index) {
  return `${account}.chunk.${manifest.chunkDigest}.${index}`;
}
function chunkAccounts(account, manifest) {
  return Array.from({ length: manifest.chunkCount }, (_, index) => chunkAccount(account, manifest, index));
}
function createManifest(payload) {
  return {
    __piMcpAdapterBearerChunked: 1,
    chunkCount: Math.ceil(payload.length / BEARER_SECRET_CHUNK_SIZE),
    chunkDigest: createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16)
  };
}
function readExistingManifest(store, serverName, account) {
  try {
    const payload = store.read(account);
    return payload === void 0 ? void 0 : readManifest(serverName, payload);
  } catch {
    return void 0;
  }
}
function removeChunks(store, account, manifest) {
  if (!manifest) return;
  for (const accountName of chunkAccounts(account, manifest)) store.remove(accountName);
}
function tryRemoveChunks(store, account, manifest) {
  try {
    removeChunks(store, account, manifest);
  } catch {
  }
}
function readBearerRecordFromStore(store, serverName) {
  const account = getBearerAccount(serverName);
  let payload;
  try {
    payload = store.read(account);
  } catch (error) {
    throw new BearerCredentialStoreError(
      `Failed to read bearer token for ${serverName} from the OS secure credential store`,
      "read",
      error
    );
  }
  if (payload === void 0) return void 0;
  try {
    const manifest = readManifest(serverName, payload);
    const recordPayload = manifest ? chunkAccounts(account, manifest).map((chunkName) => {
      const chunk = store.read(chunkName);
      if (chunk === void 0) throw new Error(`Missing bearer token chunk for ${serverName}`);
      return chunk;
    }).join("") : payload;
    return parseBearerPayload(serverName, recordPayload);
  } catch (error) {
    throw new BearerCredentialStoreError(
      `Failed to read bearer token for ${serverName} from the OS secure credential store`,
      "read",
      error
    );
  }
}
function writeBearerRecordToStore(store, serverName, record) {
  const account = getBearerAccount(serverName);
  const payload = JSON.stringify(record);
  const previousManifest = readExistingManifest(store, serverName, account);
  const manifest = payload.length > BEARER_SECRET_CHUNK_SIZE ? createManifest(payload) : void 0;
  try {
    if (manifest) {
      for (let index = 0; index < manifest.chunkCount; index++) {
        store.write(chunkAccount(account, manifest, index), payload.slice(index * BEARER_SECRET_CHUNK_SIZE, (index + 1) * BEARER_SECRET_CHUNK_SIZE));
      }
      store.write(account, JSON.stringify(manifest));
    } else {
      store.write(account, payload);
    }
    if (previousManifest?.chunkDigest !== manifest?.chunkDigest) {
      tryRemoveChunks(store, account, previousManifest);
    }
  } catch (error) {
    if (previousManifest?.chunkDigest !== manifest?.chunkDigest) {
      tryRemoveChunks(store, account, manifest);
    }
    throw new BearerCredentialStoreError(
      `Failed to write bearer token for ${serverName} to the OS secure credential store`,
      "write",
      error
    );
  }
}
function removeBearerRecordFromStore(store, serverName) {
  const account = getBearerAccount(serverName);
  try {
    const payload = store.read(account);
    const manifest = payload === void 0 ? void 0 : readManifest(serverName, payload);
    removeChunks(store, account, manifest);
    store.remove(account);
  } catch (error) {
    throw new BearerCredentialStoreError(
      `Failed to remove bearer token for ${serverName} from the OS secure credential store`,
      "remove",
      error
    );
  }
}
function getBearerTokenForUrl(serverName, serverUrl) {
  const record = readBearerRecordFromStore(getBearerSecretStore(), serverName);
  if (!record) return void 0;
  return record.serverUrl === serverUrl ? record.token : void 0;
}
function saveBearerTokenForUrl(serverName, token, serverUrl) {
  writeBearerRecordToStore(getBearerSecretStore(), serverName, { token, serverUrl });
}
function removeBearerToken(serverName) {
  removeBearerRecordFromStore(getBearerSecretStore(), serverName);
}
function inspectBearerTokenForUrl(serverName, serverUrl) {
  try {
    const record = readBearerRecordFromStore(getBearerSecretStore(), serverName);
    if (!record) return { status: "missing" };
    if (record.serverUrl !== serverUrl) return { status: "url-mismatch" };
    return { status: "present" };
  } catch (error) {
    if (!(error instanceof BearerCredentialStoreError)) throw error;
    return { status: "unavailable", message: "Bearer token secure credential store unavailable. Configure or unlock the OS credential store and retry." };
  }
}
function resetTestBearerTokenStore() {
  memoryBearerEntries.clear();
  testBearerSecretStoreReadCount = 0;
}
function getTestBearerTokenStoreEntries() {
  return [...memoryBearerEntries.entries()];
}
function removeTestBearerTokenStoreEntry(account) {
  memoryBearerEntries.delete(account);
}
function setTestBearerTokenStoreEntry(account, payload) {
  memoryBearerEntries.set(account, payload);
}
function getTestBearerTokenStoreReadCount() {
  return testBearerSecretStoreReadCount;
}
export {
  BearerCredentialStoreError,
  getBearerTokenForUrl,
  getTestBearerTokenStoreEntries,
  getTestBearerTokenStoreReadCount,
  inspectBearerTokenForUrl,
  removeBearerToken,
  removeTestBearerTokenStoreEntry,
  resetTestBearerTokenStore,
  saveBearerTokenForUrl,
  setTestBearerTokenStoreEntry
};
