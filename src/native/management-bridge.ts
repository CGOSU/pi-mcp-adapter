import { randomUUID } from "node:crypto";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  McpManagementAvailabilityEvent,
  McpManagementCapability,
  McpManagementDiscoveryRequest,
  McpManagementDiscoveryResponse,
  McpManagementErrorCode,
  McpManagementHandle,
  McpManagementResult,
  McpManagementSnapshot,
  McpOwnerAssembly,
  McpOwnerAssemblyResult,
} from "@earendil-works/pi-coding-agent";

const REQUIRED_CAPABILITIES = [
  "server.snapshot",
  "server.subscribe",
  "server.enable",
  "server.disable",
  "server.reconnect",
  "server.set-exposure",
  "tool.set-exposure",
  "catalog.refresh",
  "catalog.resources",
  "catalog.prompts",
  "resource.read",
  "resource.read-app",
  "prompt.get",
  "app.call-tool",
  "oauth.sign-in",
  "oauth.sign-out",
  "server.set-direct-tools",
  "execution.set-policy",
] as const satisfies readonly McpManagementCapability[];

const PROTOCOL_ID = "pi.mcp-management";
const PROTOCOL_VERSION = 1;
const DISCOVERY_EVENT = "pi:mcp-management:discover";
const AVAILABLE_EVENT = "pi:mcp-management:available";
const RESPONSE_EVENT_PREFIX = "pi:mcp-management:response:";
const DISCOVERY_TIMEOUT_MS = 750;
const MANAGEMENT_ERROR_CODES = new Set<McpManagementErrorCode>([
  "invalid-request",
  "invalid-input",
  "unsupported-protocol",
  "unsupported-version",
  "missing-capabilities",
  "session-unavailable",
  "session-ended",
  "server-not-found",
  "server-disabled",
  "server-not-connected",
  "unsupported-tool-name",
  "resource-not-found",
  "resource-read-denied",
  "resource-read-approval-required",
  "prompt-not-found",
  "app-tool-not-found",
  "app-tool-denied",
  "app-tool-approval-required",
  "config-update-failed",
  "catalog-refresh-failed",
  "oauth-unavailable",
  "sign-in-cancelled",
  "authentication-failed",
  "sign-out-failed",
  "operation-failed",
]);

type PublicApiExports = Pick<
  typeof import("@earendil-works/pi-coding-agent"),
  | "MCP_MANAGEMENT_PROTOCOL_ID"
  | "MCP_MANAGEMENT_PROTOCOL_VERSION"
  | "MCP_MANAGEMENT_DISCOVERY_EVENT"
  | "MCP_MANAGEMENT_AVAILABLE_EVENT"
  | "MCP_MANAGEMENT_RESPONSE_EVENT_PREFIX"
  | "MCP_MANAGEMENT_CAPABILITIES"
  | "installMcpOwnerAssembly"
>;

type AssemblyInstaller = (
  assembly: McpOwnerAssembly,
  events?: ExtensionAPI["events"],
) => McpOwnerAssemblyResult;

export type NativeManagementFailureCode =
  | "missing-public-api"
  | "invalid-public-api"
  | "discovery-timeout"
  | "invalid-response"
  | McpManagementErrorCode;

export interface NativeManagementFailure {
  readonly code: NativeManagementFailureCode;
  readonly message: string;
}

export type NativeManagementResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: NativeManagementFailure };

export interface NativeManagementRuntime {
  readonly protocolId: typeof PROTOCOL_ID;
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly discoveryEvent: string;
  readonly availableEvent: string;
  readonly responseEventPrefix: string;
  readonly requiredCapabilities: readonly McpManagementCapability[];
  readonly installAssembly: AssemblyInstaller;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPublicExport(name: keyof PublicApiExports): unknown {
  return (PiCodingAgent as unknown as Record<string, unknown>)[name];
}

function failure(code: NativeManagementFailureCode, message: string): NativeManagementResult<never> {
  return { ok: false, error: { code, message } };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string");
}

function getCapabilities(value: unknown): readonly McpManagementCapability[] | undefined {
  if (!isStringArray(value)) return undefined;
  const supported = getPublicExport("MCP_MANAGEMENT_CAPABILITIES");
  if (!isStringArray(supported)) return undefined;
  const supportedCapabilities = new Set(supported);
  return value.filter((capability) => supportedCapabilities.has(capability)) as readonly McpManagementCapability[];
}

function hasRequiredCapabilities(capabilities: readonly string[]): boolean {
  const offered = new Set(capabilities);
  return REQUIRED_CAPABILITIES.every((capability) => offered.has(capability));
}

function isManagementHandle(value: unknown): value is McpManagementHandle {
  if (!isRecord(value)) return false;
  try {
    return value.protocolVersion === PROTOCOL_VERSION &&
      isStringArray(value.capabilities) &&
      hasRequiredCapabilities(value.capabilities) &&
      typeof value.snapshot === "function" &&
      typeof value.subscribe === "function" &&
      typeof value.setServerEnabled === "function" &&
      typeof value.reconnectServer === "function" &&
      typeof value.setServerExposure === "function" &&
      typeof value.setToolExposure === "function" &&
      typeof value.setDirectTools === "function" &&
      typeof value.setExecutionPolicy === "function" &&
      typeof value.refreshCatalog === "function" &&
      typeof value.readResource === "function" &&
      typeof value.readAppResource === "function" &&
      typeof value.getPrompt === "function" &&
      typeof value.callAppTool === "function" &&
      typeof value.signIn === "function" &&
      typeof value.signOut === "function";
  } catch {
    return false;
  }
}

function isManagementError(value: unknown): value is { code: McpManagementErrorCode; message: string } {
  if (!isRecord(value)) return false;
  return typeof value.code === "string" &&
    MANAGEMENT_ERROR_CODES.has(value.code as McpManagementErrorCode) &&
    typeof value.message === "string";
}

function parseDiscoveryResponse(
  value: unknown,
  requestId: string,
): NativeManagementResult<McpManagementHandle> {
  if (!isRecord(value) || value.protocol !== PROTOCOL_ID || value.requestId !== requestId) {
    return failure("invalid-response", "Pi returned an invalid MCP management discovery response.");
  }
  if (value.version !== PROTOCOL_VERSION) {
    return failure("unsupported-version", "Pi returned an unsupported MCP management protocol version.");
  }
  const capabilities = getCapabilities(value.capabilities);
  if (!capabilities) {
    return failure("invalid-response", "Pi returned an invalid MCP management capability list.");
  }
  if (!hasRequiredCapabilities(capabilities)) {
    const missing = REQUIRED_CAPABILITIES.filter((capability) => !capabilities.includes(capability));
    return failure(
      "missing-capabilities",
      `Pi native MCP management is missing required capabilities: ${missing.join(", ")}. Install a patched Pi release that provides every required capability.`,
    );
  }
  if (!isRecord(value.result) || typeof value.result.ok !== "boolean") {
    return failure("invalid-response", "Pi returned an invalid MCP management result.");
  }
  if (!value.result.ok) {
    if (!isManagementError(value.result.error)) {
      return failure("invalid-response", "Pi returned an invalid MCP management error.");
    }
    return failure(value.result.error.code, value.result.error.message);
  }
  if (!isManagementHandle(value.result.value)) {
    return failure("invalid-response", "Pi returned an invalid MCP management handle.");
  }
  const handleCapabilities = getCapabilities(value.result.value.capabilities);
  if (!handleCapabilities || !hasRequiredCapabilities(handleCapabilities)) {
    return failure("missing-capabilities", "Pi's MCP management handle does not provide every required capability.");
  }
  return { ok: true, value: value.result.value };
}

function parseAvailability(value: unknown): McpManagementAvailabilityEvent | undefined {
  if (!isRecord(value) || value.protocol !== PROTOCOL_ID || typeof value.available !== "boolean") return undefined;
  if (value.version !== PROTOCOL_VERSION) return undefined;
  const capabilities = getCapabilities(value.capabilities);
  if (!capabilities) return undefined;
  return { protocol: PROTOCOL_ID, version: PROTOCOL_VERSION, available: value.available, capabilities };
}

export function getNativeManagementRuntime(): NativeManagementResult<NativeManagementRuntime> {
  const protocolId = getPublicExport("MCP_MANAGEMENT_PROTOCOL_ID");
  const protocolVersion = getPublicExport("MCP_MANAGEMENT_PROTOCOL_VERSION");
  const discoveryEvent = getPublicExport("MCP_MANAGEMENT_DISCOVERY_EVENT");
  const availableEvent = getPublicExport("MCP_MANAGEMENT_AVAILABLE_EVENT");
  const responseEventPrefix = getPublicExport("MCP_MANAGEMENT_RESPONSE_EVENT_PREFIX");
  const supportedCapabilities = getPublicExport("MCP_MANAGEMENT_CAPABILITIES");
  const installAssembly = getPublicExport("installMcpOwnerAssembly");

  if (
    protocolId === undefined ||
    protocolVersion === undefined ||
    discoveryEvent === undefined ||
    availableEvent === undefined ||
    responseEventPrefix === undefined ||
    supportedCapabilities === undefined ||
    installAssembly === undefined
  ) {
    return failure(
      "missing-public-api",
      "This Pi host does not expose the patched native MCP management API. Install a patched Pi release for a supported Pi version; adapter runtime fallback is disabled.",
    );
  }
  if (
    protocolId !== PROTOCOL_ID ||
    protocolVersion !== PROTOCOL_VERSION ||
    discoveryEvent !== DISCOVERY_EVENT ||
    availableEvent !== AVAILABLE_EVENT ||
    responseEventPrefix !== RESPONSE_EVENT_PREFIX ||
    !isStringArray(supportedCapabilities) ||
    typeof installAssembly !== "function"
  ) {
    return failure("invalid-public-api", "The Pi host exposes an incompatible native MCP management API.");
  }
  const supported = new Set(supportedCapabilities);
  const missing = REQUIRED_CAPABILITIES.filter((capability) => !supported.has(capability));
  if (missing.length > 0) {
    return failure(
      "missing-capabilities",
      `Pi native MCP management is missing required capabilities: ${missing.join(", ")}.`,
    );
  }

  return {
    ok: true,
    value: {
      protocolId: PROTOCOL_ID,
      protocolVersion: PROTOCOL_VERSION,
      discoveryEvent,
      availableEvent,
      responseEventPrefix,
      requiredCapabilities: REQUIRED_CAPABILITIES,
      installAssembly: installAssembly as AssemblyInstaller,
    },
  };
}

export function installNativeMcpOwnerAssembly(
  assembly: McpOwnerAssembly,
  events?: ExtensionAPI["events"],
): NativeManagementResult<() => void> {
  const runtime = getNativeManagementRuntime();
  if (!runtime.ok) return runtime;
  const result = runtime.value.installAssembly(assembly, events);
  if (!result.ok) {
    return failure("invalid-public-api", result.error.message);
  }
  return { ok: true, value: result.value };
}

export class NativeMcpManagementBridge {
  private handle: McpManagementHandle | undefined;
  private pending: Promise<NativeManagementResult<McpManagementHandle>> | undefined;
  private unsubscribeAvailability: (() => void) | undefined;
  private unsubscribeHandle: (() => void) | undefined;
  private cancelPending: (() => void) | undefined;
  private generation = 0;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly onHandle: (handle: McpManagementHandle) => void,
    private readonly onSnapshot: (snapshot: McpManagementSnapshot) => void,
    private readonly onUnavailable: (error: NativeManagementFailure) => void,
  ) {}

  startSession(): void {
    this.stopSession();
    const generation = ++this.generation;
    const runtime = getNativeManagementRuntime();
    if (!runtime.ok) {
      this.onUnavailable(runtime.error);
      return;
    }

    this.unsubscribeAvailability = this.pi.events.on(runtime.value.availableEvent, (event) => {
      const availability = parseAvailability(event);
      if (!availability) return;
      if (!availability.available) {
        this.clearHandle();
        this.onUnavailable({ code: "session-ended", message: "Pi native MCP management is no longer available in this session." });
        return;
      }
      if (this.handle) return;
      this.restartDiscovery(generation);
    });
    void this.discover(generation);
  }

  stopSession(): void {
    this.generation++;
    this.cancelPending?.();
    this.cancelPending = undefined;
    this.pending = undefined;
    this.unsubscribeAvailability?.();
    this.unsubscribeAvailability = undefined;
    this.clearHandle();
  }

  get currentHandle(): McpManagementHandle | undefined {
    return this.handle;
  }

  async discoverCurrent(): Promise<NativeManagementResult<McpManagementHandle>> {
    const runtime = getNativeManagementRuntime();
    if (!runtime.ok) {
      this.onUnavailable(runtime.error);
      return runtime;
    }
    if (this.handle) return { ok: true, value: this.handle };
    return this.discover(this.generation);
  }

  private clearHandle(): void {
    this.unsubscribeHandle?.();
    this.unsubscribeHandle = undefined;
    this.handle = undefined;
  }

  private restartDiscovery(generation: number): void {
    if (this.pending) {
      const cancel = this.cancelPending;
      this.pending = undefined;
      this.cancelPending = undefined;
      cancel?.();
    }
    void this.discover(generation);
  }

  private discover(generation: number): Promise<NativeManagementResult<McpManagementHandle>> {
    if (this.pending) return this.pending;
    const runtime = getNativeManagementRuntime();
    if (!runtime.ok) {
      this.onUnavailable(runtime.error);
      return Promise.resolve(runtime);
    }
    const result = this.requestHandle(runtime.value, generation);
    this.pending = result;
    void result.then((discovery) => {
      if (this.generation !== generation || this.pending !== result) return;
      this.pending = undefined;
      this.cancelPending = undefined;
      if (!discovery.ok) {
        this.onUnavailable(discovery.error);
        return;
      }
      this.clearHandle();
      this.handle = discovery.value;
      const subscribed = this.handle.subscribe((snapshot) => {
        if (this.generation !== generation || this.handle !== discovery.value) return;
        this.onSnapshot(snapshot);
      });
      if (!subscribed.ok) {
        this.handle = undefined;
        this.onUnavailable({ code: "invalid-response", message: subscribed.error.message });
        return;
      }
      this.unsubscribeHandle = subscribed.value;
      this.onHandle(discovery.value);
    });
    return result;
  }

  private requestHandle(
    runtime: NativeManagementRuntime,
    generation: number,
  ): Promise<NativeManagementResult<McpManagementHandle>> {
    const requestId = randomUUID();
    const channel = `${runtime.responseEventPrefix}${requestId}`;
    const request: McpManagementDiscoveryRequest = {
      protocol: runtime.protocolId,
      version: runtime.protocolVersion,
      requestId,
      requiredCapabilities: runtime.requiredCapabilities,
    };

    return new Promise((resolve) => {
      let settled = false;
      const unsubscribe = this.pi.events.on(channel, (event) => {
        finish(parseDiscoveryResponse(event, requestId));
      });
      const timer = setTimeout(() => {
        finish(failure(
          "discovery-timeout",
          "No Pi native MCP owner responded to discovery. The adapter does not start a separate MCP runtime.",
        ));
      }, DISCOVERY_TIMEOUT_MS);
      const cancel = () => finish(failure("session-ended", "The MCP management discovery session ended."));

      const finish = (result: NativeManagementResult<McpManagementHandle>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        if (this.cancelPending === cancel) this.cancelPending = undefined;
        resolve(this.generation === generation ? result : failure("session-ended", "The MCP management session changed."));
      };

      this.cancelPending = cancel;
      this.pi.events.emit(runtime.discoveryEvent, request);
    });
  }
}

export type NativeManagementHandleResult = NativeManagementResult<McpManagementHandle>;
export type NativeManagementDiscoveryResponse = McpManagementDiscoveryResponse;
export type NativeManagementPublicResult = McpManagementResult<unknown>;
