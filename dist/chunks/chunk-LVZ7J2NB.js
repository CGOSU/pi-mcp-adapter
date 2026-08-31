// src/contracts/core.ts
function isServerDisabled(definition) {
  return definition?.disabled === true;
}
var MCP_TOOL_APPROVAL_REQUEST_EVENT = "pi-mcp-adapter:tool-approval-request";

export {
  isServerDisabled,
  MCP_TOOL_APPROVAL_REQUEST_EVENT
};
