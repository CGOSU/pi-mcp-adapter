/**
 * MCP OAuth Callback Server
 *
 * HTTP server that handles OAuth callbacks from the authorization server.
 * Uses Node.js http module for compatibility.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http"
import { getAppName } from "../config/agent-dir.ts"
import { htmlError, htmlManualSuccess, htmlSuccess } from "./mcp-callback-pages.ts"
import {
  DEFAULT_OAUTH_CALLBACK_PATH,
  getConfiguredOAuthCallbackPort,
  getOAuthCallbackPath,
  getOAuthCallbackPort,
  setOAuthCallbackPath,
  setOAuthCallbackPort,
} from "./mcp-oauth-provider.ts"

// HTML templates for callback responses.
/** Result of a successful OAuth callback */
export interface OAuthCallbackResult {
  code: string
  /** RFC 9207 `iss` authorization response parameter, when provided */
  iss?: string
}

/** Pending authorization request */
interface PendingAuth {
  resolve: (result: OAuthCallbackResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

/** Server singleton state */
let server: Server | undefined
let bindingPromise: Promise<void> | undefined
let stoppingPromise: Promise<void> | undefined
let restartableStoppingPromise: Promise<void> | undefined
let callbackGeneration = 0
const pendingAuths = new Map<string, PendingAuth>()
const reservedAuthStates = new Set<string>()

/** Timeout for callback completion (5 minutes) */
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

interface EnsureCallbackServerOptions {
  strictPort?: boolean
  port?: number
  callbackHost?: string
  callbackPath?: string
  oauthState?: string
  reserveState?: boolean
}

const DEFAULT_OAUTH_CALLBACK_HOST = "localhost"
let callbackServerHost = DEFAULT_OAUTH_CALLBACK_HOST

/**
 * Handle incoming HTTP requests to the callback server.
 */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || "/", `http://${req.headers.host}`)

  // Only handle the callback path
  if (url.pathname !== getOAuthCallbackPath()) {
    res.writeHead(404, { "Content-Type": "text/plain" })
    res.end("Not found")
    return
  }

  const code = url.searchParams.get("code")
  const iss = url.searchParams.get("iss")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")
  const errorDescription = url.searchParams.get("error_description")

  // Enforce state parameter presence for CSRF protection
  if (!state) {
    const errorMsg = "Missing required state parameter - potential CSRF attack"
    res.writeHead(400, { "Content-Type": "text/html" })
    res.end(htmlError(getAppName(), errorMsg))
    return
  }

  const pending = pendingAuths.get(state)
  const isReserved = reservedAuthStates.has(state)

  // Handle OAuth errors only for a state that belongs to an active flow.
  if (error) {
    if (!pending && !isReserved) {
      const errorMsg = "Invalid or expired state parameter - potential CSRF attack"
      res.writeHead(400, { "Content-Type": "text/html" })
      res.end(htmlError(getAppName(), errorMsg))
      return
    }

    const errorMsg = errorDescription || error
    // Send HTTP response first before rejecting promise
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(htmlError(getAppName(), errorMsg))
    // Reject promise after response is sent (defer to allow test to attach handler)
    if (pending) {
      reservedAuthStates.delete(state)
      clearTimeout(pending.timeout)
      pendingAuths.delete(state)
      setTimeout(() => pending.reject(new Error(errorMsg)), 0)
    }
    return
  }

  // Validate state parameter
  if (!pending && !isReserved) {
    const errorMsg = "Invalid or expired state parameter - potential CSRF attack"
    res.writeHead(400, { "Content-Type": "text/html" })
    res.end(htmlError(getAppName(), errorMsg))
    return
  }

  // Require authorization code
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html" })
    res.end(htmlError(getAppName(), "No authorization code provided"))
    return
  }

  if (!pending) {
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(htmlManualSuccess(getAppName()))
    return
  }

  // Clear timeout and resolve the pending promise
  clearTimeout(pending.timeout)
  pendingAuths.delete(state)
  pending.resolve({ code, ...(iss !== null ? { iss } : {}) })

  res.writeHead(200, { "Content-Type": "text/html" })
  res.end(htmlSuccess(getAppName()))
}

/**
 * Ensure the callback server is running.
 * If strictPort is true, requires binding on the configured callback port.
 * If strictPort is false, asks the OS for an available local port.
 */
export async function ensureCallbackServer(options: EnsureCallbackServerOptions = {}): Promise<void> {
  const generation = callbackGeneration
  if (stoppingPromise) {
    if (!restartableStoppingPromise) {
      throw new Error("OAuth callback server stopped")
    }
    await restartableStoppingPromise
    if (generation !== callbackGeneration) {
      throw new Error("OAuth callback server stopped")
    }
  }
  while (bindingPromise) {
    await bindingPromise
    if (generation !== callbackGeneration) {
      throw new Error("OAuth callback server stopped")
    }
  }
  if (generation !== callbackGeneration) {
    throw new Error("OAuth callback server stopped")
  }

  const operation = ensureCallbackServerLocked(options)
  bindingPromise = operation
  try {
    await operation
  } finally {
    if (bindingPromise === operation) {
      bindingPromise = undefined
    }
  }
}

async function ensureCallbackServerLocked(options: EnsureCallbackServerOptions = {}): Promise<void> {
  const requiredPort = options.port ?? getConfiguredOAuthCallbackPort()
  const strictPort = options.strictPort === true
  const requestedHost = options.callbackHost ?? DEFAULT_OAUTH_CALLBACK_HOST
  const rawRequestedPath = options.callbackPath ?? DEFAULT_OAUTH_CALLBACK_PATH
  const requestedPath = rawRequestedPath.startsWith("/") ? rawRequestedPath : `/${rawRequestedPath}`
  if (options.reserveState && !options.oauthState) {
    throw new Error("OAuth callback reservation requires an oauthState")
  }
  let reservedState: string | undefined

  const previousServer = server
  const needsStrictRebind = Boolean(previousServer && strictPort && getOAuthCallbackPort() !== requiredPort)
  const needsHostSwitch = Boolean(previousServer && callbackServerHost !== requestedHost)
  const needsPathSwitch = Boolean(previousServer && getOAuthCallbackPath() !== requestedPath)

  if (previousServer) {
    if (!needsStrictRebind && !needsHostSwitch) {
      if (needsPathSwitch) {
        if (pendingAuths.size > 0 || reservedAuthStates.size > 0) {
          throw new Error(
            `OAuth callback server is using path ${getOAuthCallbackPath()}, but callback path ${requestedPath} is required and cannot be switched while authorizations are pending`
          )
        }
        setOAuthCallbackPath(requestedPath)
      }
      if (options.reserveState && options.oauthState) {
        reservedAuthStates.add(options.oauthState)
        reservedState = options.oauthState
      }
      return
    }

    if (pendingAuths.size > 0 || reservedAuthStates.size > 0) {
      throw new Error(
        `OAuth callback server is running on ${callbackServerHost}:${getOAuthCallbackPort()}, but strict callback endpoint ${requestedHost}:${requiredPort} is required and cannot be switched while authorizations are pending`
      )
    }
  }

  const candidateServer = createServer(handleRequest)
  const listenPort = strictPort ? requiredPort : 0

  try {
    await new Promise<void>((resolve, reject) => {
      candidateServer.once("error", (err) => {
        reject(err)
      })

      candidateServer.listen(listenPort, requestedHost, () => {
        resolve()
      })
    })

    if (strictPort) {
      setOAuthCallbackPort(requiredPort)
    } else {
      const address = candidateServer.address()
      if (!address || typeof address === "string" || typeof address.port !== "number") {
        throw new Error("OAuth callback server did not report an assigned port")
      }
      setOAuthCallbackPort(address.port)
    }

    if (previousServer && (needsStrictRebind || needsHostSwitch)) {
      await new Promise<void>((resolve) => {
        previousServer.close(() => resolve())
      })
    }

    callbackServerHost = requestedHost
    setOAuthCallbackPath(requestedPath)
    server = candidateServer
    if (options.reserveState && options.oauthState) {
      reservedAuthStates.add(options.oauthState)
      reservedState = options.oauthState
    }
    server.unref()
  } catch (error) {
    if (reservedState) {
      reservedAuthStates.delete(reservedState)
    }
    const nodeError = error as NodeJS.ErrnoException
    await new Promise<void>((resolve) => {
      candidateServer.close(() => resolve())
    })

    if (strictPort && nodeError.code === "EADDRINUSE") {
      throw new Error(
        `OAuth callback port ${requiredPort} is already in use. Pre-registered OAuth clients require an exact redirect URI; set MCP_OAUTH_CALLBACK_PORT to your registered port or free port ${requiredPort}`,
        { cause: error }
      )
    }

    throw error
  }
}

export function reserveCallbackServer(oauthState: string): void {
  reservedAuthStates.add(oauthState)
}

export function releaseCallbackServer(oauthState: string): void {
  reservedAuthStates.delete(oauthState)
}

/**
 * Wait for a callback with the given OAuth state.
 * Returns a promise that resolves with the authorization code and, when the
 * authorization server sends one, the RFC 9207 `iss` parameter.
 */
export function waitForCallback(oauthState: string): Promise<OAuthCallbackResult> {
  reservedAuthStates.delete(oauthState)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingAuths.has(oauthState)) {
        pendingAuths.delete(oauthState)
        reject(new Error("OAuth callback timeout - authorization took too long"))
      }
    }, CALLBACK_TIMEOUT_MS)

    pendingAuths.set(oauthState, { resolve, reject, timeout })
  })
}

/**
 * Cancel a pending authorization by state.
 */
export function cancelPendingCallback(oauthState: string): void {
  reservedAuthStates.delete(oauthState)
  const pending = pendingAuths.get(oauthState)
  if (pending) {
    clearTimeout(pending.timeout)
    pendingAuths.delete(oauthState)
    pending.reject(new Error("Authorization cancelled"))
  }
}

/**
 * Stop the callback server and reject all pending authorizations.
 */
export function stopCallbackServer(): Promise<void> {
  if (stoppingPromise) {
    restartableStoppingPromise = undefined
    callbackGeneration += 1
    return stoppingPromise
  }

  callbackGeneration += 1
  const cleanup = (async () => {
    while (bindingPromise) {
      await bindingPromise.catch(() => {})
    }

    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => {
          resolve()
        })
      })
      server = undefined
    }

    setOAuthCallbackPort(getConfiguredOAuthCallbackPort())
    callbackServerHost = DEFAULT_OAUTH_CALLBACK_HOST
    setOAuthCallbackPath(DEFAULT_OAUTH_CALLBACK_PATH)

    // Reject all pending auths (defer to allow any pending operations to complete)
    const pendingList = Array.from(pendingAuths.entries())
    pendingAuths.clear()
    reservedAuthStates.clear()
    setTimeout(() => {
      for (const [, pending] of pendingList) {
        clearTimeout(pending.timeout)
        pending.reject(new Error("OAuth callback server stopped"))
      }
    }, 0)
  })()

  const operation = cleanup.finally(() => {
    if (stoppingPromise === operation) stoppingPromise = undefined
  })
  stoppingPromise = operation
  return operation
}

/** Stop the callback server only when no bind or authorization owns it. */
export function stopCallbackServerIfIdle(): Promise<void> {
  if (stoppingPromise) return stoppingPromise
  if (bindingPromise || !server || pendingAuths.size > 0 || reservedAuthStates.size > 0) {
    return Promise.resolve()
  }
  const operation = stopCallbackServer().finally(() => {
    if (restartableStoppingPromise === operation) restartableStoppingPromise = undefined
  })
  restartableStoppingPromise = operation
  return operation
}

/**
 * Check if the callback server is running.
 */
export function isCallbackServerRunning(): boolean {
  return server !== undefined
}

/**
 * Get the number of pending authorizations.
 */
export function getPendingAuthCount(): number {
  return pendingAuths.size
}
