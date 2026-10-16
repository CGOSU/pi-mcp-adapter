import {
  getAuthEntry,
  invalidateAuthEntryCache,
  removeAuthEntry,
  saveAuthEntry,
  type AuthEntry,
  type AuthJsonValue,
  type StoredClientInfo,
  type StoredTokens,
} from "../auth/mcp-auth.ts";
import { getBearerTokenForUrl } from "../auth/mcp-bearer-store.ts";

/** Structural mirror of the native MCP OAuth state persisted by Pi's MCP owner. */
export interface NativeMcpOAuthTokens {
  access_token: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
  refresh_token?: string;
  id_token?: string;
  issuer?: string;
}

export interface NativeMcpOAuthClientInformation {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  application_type?: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  scope?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  jwks?: unknown;
  software_id?: string;
  software_version?: string;
  software_statement?: string;
  issuer?: string;
}

export interface NativeMcpOAuthAuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  response_types_supported: string[];
  [key: string]: unknown;
}

export interface NativeMcpOAuthResourceMetadata {
  resource: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
  [key: string]: unknown;
}

export interface NativeMcpOAuthDiscoveryState {
  authorizationServerUrl: string;
  authorizationServerMetadata?: NativeMcpOAuthAuthorizationServerMetadata;
  resourceMetadata?: NativeMcpOAuthResourceMetadata;
  resourceMetadataUrl?: string;
}

export interface NativeMcpOAuthState {
  serverUrl: string;
  clientInformation?: NativeMcpOAuthClientInformation;
  tokens?: NativeMcpOAuthTokens;
  tokensExpireAt?: number;
  codeVerifier?: string;
  oauthState?: string;
  discovery?: NativeMcpOAuthDiscoveryState;
}

export interface NativeMcpOAuthStateStore {
  load(): NativeMcpOAuthState | undefined;
  save(state: NativeMcpOAuthState): void;
}

export interface NativeMcpOAuthCredentialBackend {
  handlesServer(name: string, serverUrl: string): boolean;
  forServer(name: string, serverUrl: string): NativeMcpOAuthStateStore;
  tokens(name: string, serverUrl: string): NativeMcpOAuthTokens | undefined;
  remove(name: string, serverUrl: string): boolean;
  /** Reads the separate adapter bearer-token record; never aliases it to OAuth state. */
  bearerToken(name: string, serverUrl: string): string | undefined;
}

function normalizeUrl(serverUrl: string): string {
  try {
    return new URL(serverUrl).href;
  } catch {
    throw new Error("Invalid MCP OAuth server URL.");
  }
}

function toAuthJsonValue(value: unknown, ancestors = new Set<object>()): AuthJsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object" || ancestors.has(value)) return undefined;
  ancestors.add(value);
  let result: AuthJsonValue | undefined;
  if (Array.isArray(value)) {
    const items = value.map((item) => toAuthJsonValue(item, ancestors));
    if (!items.some((item) => item === undefined)) result = items as AuthJsonValue[];
  } else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
    const object = Object.create(null) as Record<string, AuthJsonValue>;
    let valid = true;
    for (const [key, item] of Object.entries(value)) {
      const parsed = toAuthJsonValue(item, ancestors);
      if (parsed === undefined) {
        valid = false;
        break;
      }
      object[key] = parsed;
    }
    if (valid) result = object;
  }
  ancestors.delete(value);
  return result;
}

function toAuthJsonObject(value: unknown): Record<string, AuthJsonValue> | undefined {
  const parsed = toAuthJsonValue(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : undefined;
}

function isRecord(value: AuthJsonValue | undefined): value is Record<string, AuthJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: AuthJsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function toNativeDiscoveryState(value: Record<string, AuthJsonValue>): NativeMcpOAuthDiscoveryState | undefined {
  const authorizationServerUrl = value.authorizationServerUrl;
  if (typeof authorizationServerUrl !== "string") return undefined;
  const serverMetadata = value.authorizationServerMetadata;
  if (serverMetadata !== undefined) {
    if (
      !isRecord(serverMetadata) ||
      typeof serverMetadata.issuer !== "string" ||
      typeof serverMetadata.authorization_endpoint !== "string" ||
      typeof serverMetadata.token_endpoint !== "string" ||
      !isStringArray(serverMetadata.response_types_supported)
    ) return undefined;
  }
  const resourceMetadata = value.resourceMetadata;
  if (resourceMetadata !== undefined) {
    if (!isRecord(resourceMetadata) || typeof resourceMetadata.resource !== "string") return undefined;
    if (
      resourceMetadata.authorization_servers !== undefined &&
      !isStringArray(resourceMetadata.authorization_servers)
    ) return undefined;
    if (resourceMetadata.scopes_supported !== undefined && !isStringArray(resourceMetadata.scopes_supported)) {
      return undefined;
    }
  }
  const resourceMetadataUrl = value.resourceMetadataUrl;
  if (resourceMetadataUrl !== undefined && typeof resourceMetadataUrl !== "string") return undefined;
  return {
    authorizationServerUrl,
    ...(serverMetadata === undefined
      ? {}
      : { authorizationServerMetadata: serverMetadata as NativeMcpOAuthAuthorizationServerMetadata }),
    ...(resourceMetadata === undefined
      ? {}
      : { resourceMetadata: resourceMetadata as NativeMcpOAuthResourceMetadata }),
    ...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }),
  };
}

function readFreshAuthEntry(serverName: string): AuthEntry | undefined {
  invalidateAuthEntryCache(serverName);
  return getAuthEntry(serverName);
}

function toNativeClientInformation(clientInfo: StoredClientInfo | undefined): NativeMcpOAuthClientInformation | undefined {
  if (
    !clientInfo ||
    clientInfo.configPreRegistered ||
    (clientInfo.clientSecret === undefined &&
      clientInfo.clientIdIssuedAt === undefined &&
      clientInfo.clientSecretExpiresAt === undefined &&
      clientInfo.redirectUris === undefined)
  ) return undefined;
  const jwks = clientInfo.jwks === undefined ? undefined : toAuthJsonValue(clientInfo.jwks);
  if (clientInfo.jwks !== undefined && jwks === undefined) {
    throw new Error("Stored native MCP OAuth client metadata is invalid.");
  }
  return {
    client_id: clientInfo.clientId,
    ...(clientInfo.clientSecret === undefined ? {} : { client_secret: clientInfo.clientSecret }),
    ...(clientInfo.clientIdIssuedAt === undefined ? {} : { client_id_issued_at: clientInfo.clientIdIssuedAt }),
    ...(clientInfo.clientSecretExpiresAt === undefined
      ? {}
      : { client_secret_expires_at: clientInfo.clientSecretExpiresAt }),
    ...(clientInfo.redirectUris === undefined ? {} : { redirect_uris: [...clientInfo.redirectUris] }),
    ...(clientInfo.tokenEndpointAuthMethod === undefined
      ? {}
      : { token_endpoint_auth_method: clientInfo.tokenEndpointAuthMethod }),
    ...(clientInfo.grantTypes === undefined ? {} : { grant_types: [...clientInfo.grantTypes] }),
    ...(clientInfo.responseTypes === undefined ? {} : { response_types: [...clientInfo.responseTypes] }),
    ...(clientInfo.applicationType === undefined ? {} : { application_type: clientInfo.applicationType }),
    ...(clientInfo.clientName === undefined ? {} : { client_name: clientInfo.clientName }),
    ...(clientInfo.clientUri === undefined ? {} : { client_uri: clientInfo.clientUri }),
    ...(clientInfo.logoUri === undefined ? {} : { logo_uri: clientInfo.logoUri }),
    ...(clientInfo.scope === undefined ? {} : { scope: clientInfo.scope }),
    ...(clientInfo.contacts === undefined ? {} : { contacts: [...clientInfo.contacts] }),
    ...(clientInfo.tosUri === undefined ? {} : { tos_uri: clientInfo.tosUri }),
    ...(clientInfo.policyUri === undefined ? {} : { policy_uri: clientInfo.policyUri }),
    ...(clientInfo.jwksUri === undefined ? {} : { jwks_uri: clientInfo.jwksUri }),
    ...(jwks === undefined ? {} : { jwks }),
    ...(clientInfo.softwareId === undefined ? {} : { software_id: clientInfo.softwareId }),
    ...(clientInfo.softwareVersion === undefined ? {} : { software_version: clientInfo.softwareVersion }),
    ...(clientInfo.softwareStatement === undefined ? {} : { software_statement: clientInfo.softwareStatement }),
    ...(clientInfo.issuer === undefined ? {} : { issuer: clientInfo.issuer }),
  };
}

function toStoredClientInformation(
  clientInfo: NativeMcpOAuthClientInformation | undefined,
  issuer: string | undefined,
): StoredClientInfo | undefined {
  if (!clientInfo) return undefined;
  const boundIssuer = clientInfo.issuer ?? issuer;
  const jwks = clientInfo.jwks === undefined ? undefined : toAuthJsonValue(clientInfo.jwks);
  if (clientInfo.jwks !== undefined && jwks === undefined) {
    throw new Error("MCP OAuth client metadata contains a non-JSON value.");
  }
  return {
    clientId: clientInfo.client_id,
    ...(clientInfo.client_secret === undefined ? {} : { clientSecret: clientInfo.client_secret }),
    ...(clientInfo.client_id_issued_at === undefined ? {} : { clientIdIssuedAt: clientInfo.client_id_issued_at }),
    ...(clientInfo.client_secret_expires_at === undefined
      ? {}
      : { clientSecretExpiresAt: clientInfo.client_secret_expires_at }),
    ...(clientInfo.redirect_uris === undefined ? {} : { redirectUris: [...clientInfo.redirect_uris] }),
    ...(clientInfo.token_endpoint_auth_method === undefined
      ? {}
      : { tokenEndpointAuthMethod: clientInfo.token_endpoint_auth_method }),
    ...(clientInfo.grant_types === undefined ? {} : { grantTypes: [...clientInfo.grant_types] }),
    ...(clientInfo.response_types === undefined ? {} : { responseTypes: [...clientInfo.response_types] }),
    ...(clientInfo.application_type === undefined ? {} : { applicationType: clientInfo.application_type }),
    ...(clientInfo.client_name === undefined ? {} : { clientName: clientInfo.client_name }),
    ...(clientInfo.client_uri === undefined ? {} : { clientUri: clientInfo.client_uri }),
    ...(clientInfo.logo_uri === undefined ? {} : { logoUri: clientInfo.logo_uri }),
    ...(clientInfo.scope === undefined ? {} : { scope: clientInfo.scope }),
    ...(clientInfo.contacts === undefined ? {} : { contacts: [...clientInfo.contacts] }),
    ...(clientInfo.tos_uri === undefined ? {} : { tosUri: clientInfo.tos_uri }),
    ...(clientInfo.policy_uri === undefined ? {} : { policyUri: clientInfo.policy_uri }),
    ...(clientInfo.jwks_uri === undefined ? {} : { jwksUri: clientInfo.jwks_uri }),
    ...(jwks === undefined ? {} : { jwks }),
    ...(clientInfo.software_id === undefined ? {} : { softwareId: clientInfo.software_id }),
    ...(clientInfo.software_version === undefined ? {} : { softwareVersion: clientInfo.software_version }),
    ...(clientInfo.software_statement === undefined ? {} : { softwareStatement: clientInfo.software_statement }),
    ...(boundIssuer === undefined ? {} : { issuer: boundIssuer }),
  };
}

function toNativeTokens(entry: AuthEntry): NativeMcpOAuthTokens | undefined {
  if (!entry.tokens) return undefined;
  return {
    access_token: entry.tokens.accessToken,
    token_type: entry.nativeOAuth?.tokenType ?? "Bearer",
    ...(entry.tokens.refreshToken === undefined ? {} : { refresh_token: entry.tokens.refreshToken }),
    ...(entry.tokens.scope === undefined ? {} : { scope: entry.tokens.scope }),
    ...(entry.nativeOAuth?.idToken === undefined ? {} : { id_token: entry.nativeOAuth.idToken }),
    ...(entry.tokens.issuer === undefined ? {} : { issuer: entry.tokens.issuer }),
  };
}

function toStoredTokens(
  tokens: NativeMcpOAuthTokens | undefined,
  tokensExpireAt: number | undefined,
  issuer: string | undefined,
): StoredTokens | undefined {
  if (!tokens) return undefined;
  const expiresAt = tokensExpireAt === undefined
    ? tokens.expires_in === undefined ? undefined : Date.now() / 1000 + tokens.expires_in
    : tokensExpireAt / 1000;
  const boundIssuer = tokens.issuer ?? issuer;
  return {
    accessToken: tokens.access_token,
    ...(tokens.refresh_token === undefined ? {} : { refreshToken: tokens.refresh_token }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(tokens.scope === undefined ? {} : { scope: tokens.scope }),
    ...(boundIssuer === undefined ? {} : { issuer: boundIssuer }),
  };
}

function toNativeState(entry: AuthEntry, serverUrl: string): NativeMcpOAuthState {
  const discovery = entry.nativeOAuth?.discovery === undefined
    ? undefined
    : toNativeDiscoveryState(entry.nativeOAuth.discovery);
  if (entry.nativeOAuth?.discovery !== undefined && !discovery) {
    throw new Error("Stored native MCP OAuth discovery state is invalid.");
  }
  const clientInformation = toNativeClientInformation(entry.clientInfo);
  const tokens = toNativeTokens(entry);
  return {
    serverUrl: normalizeUrl(serverUrl),
    ...(clientInformation === undefined ? {} : { clientInformation }),
    ...(tokens === undefined ? {} : { tokens }),
    ...(entry.tokens?.expiresAt === undefined ? {} : { tokensExpireAt: entry.tokens.expiresAt * 1000 }),
    ...(entry.codeVerifier === undefined ? {} : { codeVerifier: entry.codeVerifier }),
    ...(entry.oauthState === undefined ? {} : { oauthState: entry.oauthState }),
    ...(discovery === undefined ? {} : { discovery: structuredClone(discovery) }),
  };
}

function toAuthEntry(state: NativeMcpOAuthState, previous: AuthEntry | undefined, serverUrl: string): AuthEntry {
  const normalizedServerUrl = normalizeUrl(serverUrl);
  if (normalizeUrl(state.serverUrl) !== normalizedServerUrl) {
    throw new Error("MCP OAuth state belongs to a different server URL.");
  }
  const issuer = state.discovery?.authorizationServerMetadata?.issuer;
  const discovery = state.discovery === undefined ? undefined : toAuthJsonObject(state.discovery);
  if (state.discovery !== undefined && !discovery) {
    throw new Error("MCP OAuth discovery metadata contains a non-JSON value.");
  }
  const tokens = toStoredTokens(state.tokens, state.tokensExpireAt, issuer);
  const clientInfo = toStoredClientInformation(state.clientInformation, issuer);
  const nativeOAuth = {
    ...(state.tokens?.token_type === undefined ? {} : { tokenType: state.tokens.token_type }),
    ...(state.tokens?.id_token === undefined ? {} : { idToken: state.tokens.id_token }),
    ...(discovery === undefined ? {} : { discovery }),
  };
  const entry: AuthEntry = {
    ...(previous?.serverUrl === serverUrl ? previous : {}),
    serverUrl,
  };
  if (tokens === undefined) delete entry.tokens;
  else entry.tokens = tokens;
  if (clientInfo === undefined) delete entry.clientInfo;
  else entry.clientInfo = clientInfo;
  if (state.codeVerifier === undefined) delete entry.codeVerifier;
  else entry.codeVerifier = state.codeVerifier;
  if (state.oauthState === undefined) delete entry.oauthState;
  else entry.oauthState = state.oauthState;
  if (Object.keys(nativeOAuth).length === 0) delete entry.nativeOAuth;
  else entry.nativeOAuth = nativeOAuth;
  return entry;
}

export function createNativeMcpOAuthCredentialBackend(
  managedServerNames: readonly string[] | (() => readonly string[]),
): NativeMcpOAuthCredentialBackend {
  const handlesServer = (name: string): boolean => {
    const names = typeof managedServerNames === "function" ? managedServerNames() : managedServerNames;
    return names.includes(name);
  };
  const readState = (name: string, serverUrl: string): NativeMcpOAuthState | undefined => {
    const entry = readFreshAuthEntry(name);
    if (!entry || entry.serverUrl !== serverUrl) return undefined;
    return toNativeState(entry, serverUrl);
  };

  const forServer = (name: string, serverUrl: string): NativeMcpOAuthStateStore => ({
    load: () => readState(name, serverUrl),
    save: (state) => {
      const previous = readFreshAuthEntry(name);
      const entry = toAuthEntry(state, previous, serverUrl);
      saveAuthEntry(name, entry, serverUrl);
    },
  });

  return {
    handlesServer,
    forServer,
    tokens: (name, serverUrl) => readState(name, serverUrl)?.tokens,
    bearerToken: (name, serverUrl) => getBearerTokenForUrl(name, normalizeUrl(serverUrl)),
    remove: (name, serverUrl) => {
      const entry = readFreshAuthEntry(name);
      if (!entry || entry.serverUrl !== serverUrl) return false;
      removeAuthEntry(name);
      return true;
    },
  };
}
