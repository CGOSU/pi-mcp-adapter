// Stable extension entry and public helper facade. The production extension path is native-only.
export type { McpAdapterOptions, ServerEntry } from "./src/contracts/core.js";
export {
  namespaceProxyName,
  parseMcpReference,
  resolveMcpToolReferences,
  type McpReferenceResolution,
  type ParsedMcpReference,
} from "./src/tools/mcp-references.js";
export {
  MCP_STATUS_EVENT,
  MCP_STATUS_SNAPSHOT_VERSION,
  type McpServerRuntimeStatus,
  type McpServerStatusSnapshot,
  type McpStatusSnapshot,
} from "./src/contracts/status.js";
export {
  MCP_TOOL_APPROVAL_REQUEST_EVENT,
  type McpToolApprovalDecision,
  type McpToolApprovalHandler,
  type McpToolApprovalOrigin,
  type McpToolApprovalRequest,
} from "./src/contracts/core.js";
export {
  createMcpAdapter,
  registerMcpServer,
  type McpServerRegistration,
  default,
} from "./src/native/extension.ts";
