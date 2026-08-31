// src/extension/failure-backoff.ts
var FAILURE_BACKOFF_MS = 60 * 1e3;
function getFailureAgeSeconds(state, serverName) {
  const failedAt = state.failureTracker.get(serverName);
  if (!failedAt) return null;
  const ageMs = Date.now() - failedAt;
  if (ageMs > FAILURE_BACKOFF_MS) return null;
  return Math.round(ageMs / 1e3);
}
function getFailureMessage(state, serverName) {
  if (getFailureAgeSeconds(state, serverName) === null) return null;
  return state.failureMessages?.get(serverName) ?? null;
}
function isServerInActiveFailureBackoff(state, serverName) {
  const connection = state.manager.getConnection(serverName);
  return connection?.status !== "connected" && connection?.status !== "needs-auth" && getFailureAgeSeconds(state, serverName) !== null;
}

// src/logger.ts
var LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
var LEVEL_PREFIX = {
  debug: "[MCP-UI:DEBUG]",
  info: "[MCP-UI]",
  warn: "[MCP-UI:WARN]",
  error: "[MCP-UI:ERROR]"
};
var Logger = class {
  minLevel = "info";
  handlers = [];
  defaultContext = {};
  setLevel(level) {
    this.minLevel = level;
  }
  setDefaultContext(context) {
    this.defaultContext = context;
  }
  addHandler(handler) {
    this.handlers.push(handler);
  }
  clearHandlers() {
    this.handlers = [];
  }
  shouldLog(level) {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }
  emit(level, message, context, error) {
    if (!this.shouldLog(level)) return;
    const entry = {
      level,
      message,
      context: { ...this.defaultContext, ...context },
      ...error !== void 0 ? { error } : {},
      timestamp: /* @__PURE__ */ new Date()
    };
    const prefix = LEVEL_PREFIX[level];
    const contextStr = formatContext(entry.context);
    const fullMessage = contextStr ? `${prefix} ${message} ${contextStr}` : `${prefix} ${message}`;
    if (level === "error") {
      console.error(fullMessage, error ?? "");
    } else if (level === "warn") {
      console.warn(fullMessage);
    } else if (level === "debug") {
      console.debug(fullMessage);
    } else {
      console.log(fullMessage);
    }
    for (const handler of this.handlers) {
      try {
        handler(entry);
      } catch {
      }
    }
  }
  debug(message, context) {
    this.emit("debug", message, context);
  }
  info(message, context) {
    this.emit("info", message, context);
  }
  warn(message, context) {
    this.emit("warn", message, context);
  }
  error(message, error, context) {
    this.emit("error", message, context, error);
  }
  /**
   * Create a child logger with additional default context.
   */
  child(context) {
    return new ChildLogger(this, context);
  }
};
var ChildLogger = class _ChildLogger {
  constructor(parent, context) {
    this.parent = parent;
    this.context = context;
  }
  parent;
  context;
  debug(message, context) {
    this.parent.debug(message, { ...this.context, ...context });
  }
  info(message, context) {
    this.parent.info(message, { ...this.context, ...context });
  }
  warn(message, context) {
    this.parent.warn(message, { ...this.context, ...context });
  }
  error(message, error, context) {
    this.parent.error(message, error, { ...this.context, ...context });
  }
  child(context) {
    return new _ChildLogger(this.parent, { ...this.context, ...context });
  }
};
function formatContext(context) {
  if (!context || Object.keys(context).length === 0) return "";
  const parts = [];
  for (const [key, value] of Object.entries(context)) {
    if (value !== void 0 && value !== null) {
      parts.push(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
  }
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}
var logger = new Logger();
if (process.env.MCP_UI_DEBUG === "1" || process.env.MCP_UI_DEBUG === "true") {
  logger.setLevel("debug");
}

// src/contracts/status.ts
var MCP_STATUS_EVENT = "pi-mcp-adapter/status/v1";
var MCP_STATUS_SNAPSHOT_VERSION = 1;

// src/extension/status.ts
function createMcpStatusSnapshot(state) {
  const servers = [];
  let totalTools = 0;
  let totalResources = 0;
  let connectedCount = 0;
  let disabledCount = 0;
  for (const name of Object.keys(state.config.mcpServers)) {
    const definition = state.config.mcpServers[name];
    const disabled = definition?.disabled === true;
    const connection = disabled ? void 0 : state.manager.getConnection(name);
    const failedAgoSeconds = disabled ? null : getFailureAgeSeconds(state, name);
    const activeFailure = !disabled && isServerInActiveFailureBackoff(state, name);
    const metadata = disabled || activeFailure ? void 0 : state.toolMetadata.get(name);
    const toolCount = metadata?.length ?? (connection?.status === "connected" ? connection.tools.length : 0);
    const resourceCount = disabled || activeFailure ? void 0 : state.resourceCounts?.get(name) ?? (connection?.status === "connected" ? connection.resources.length : void 0);
    let status = "not-connected";
    if (disabled) {
      status = "disabled";
      disabledCount++;
    } else if (connection?.status === "connected") {
      status = "connected";
      connectedCount++;
    } else if (connection?.status === "needs-auth") {
      status = "needs-auth";
    } else if (activeFailure) {
      status = "failed";
    } else if (metadata !== void 0) {
      status = "cached";
    }
    totalTools += disabled ? 0 : toolCount;
    if (!disabled && resourceCount !== void 0) totalResources += resourceCount;
    servers.push({
      name,
      status,
      toolCount,
      ...resourceCount !== void 0 ? { resourceCount } : {},
      ...status === "failed" && failedAgoSeconds !== null ? { failedAgoSeconds } : {},
      disabled
    });
  }
  return {
    version: MCP_STATUS_SNAPSHOT_VERSION,
    servers,
    totalTools,
    totalResources,
    connectedCount,
    disabledCount
  };
}
function publishMcpStatusSnapshot(state, snapshot) {
  const events = state.statusEvents;
  if (!events) return;
  try {
    events.emit(MCP_STATUS_EVENT, snapshot ?? createMcpStatusSnapshot(state));
  } catch {
  }
}
function publishMcpStatusShutdown(events) {
  if (!events) return;
  try {
    events.emit(MCP_STATUS_EVENT, {
      version: MCP_STATUS_SNAPSHOT_VERSION,
      servers: [],
      totalTools: 0,
      totalResources: 0,
      connectedCount: 0,
      disabledCount: 0
    });
  } catch {
  }
}

export {
  FAILURE_BACKOFF_MS,
  getFailureAgeSeconds,
  getFailureMessage,
  isServerInActiveFailureBackoff,
  logger,
  MCP_STATUS_EVENT,
  MCP_STATUS_SNAPSHOT_VERSION,
  publishMcpStatusSnapshot,
  publishMcpStatusShutdown
};
