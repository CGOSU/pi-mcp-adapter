import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConsentManager } from "../ui/consent-manager.ts";
import type { McpLifecycleManager } from "../runtime/lifecycle.ts";
import type { McpServerManager } from "../runtime/server-manager.ts";
import type { AuthStorageOptions } from "../auth/mcp-auth.ts";
import type { ToolMetadata, PromptMetadata, McpConfig } from "../contracts/core.ts";
import type { UiSessionMessages, UiServerHandle } from "../contracts/ui.ts";
import type { UiStreamSummary } from "../ui/stream-types.ts";
import type { McpStatusEventBus } from "../contracts/status.ts";
import type { UiResourceHandler } from "../ui/resource-handler.ts";
import type { McpRuntimeOwner } from "./owner.ts";
import type { McpOAuthRuntime } from "../auth/mcp-auth-flow.ts";

export interface CompletedUiSession {
  serverName: string;
  toolName: string;
  completedAt: Date;
  reason: string;
  messages: UiSessionMessages;
  stream?: UiStreamSummary;
}

export type SendMessageFn = (
  message: {
    customType: string;
    content: Array<{ type: "text"; text: string }>;
    display?: string;
    details?: unknown;
  },
  options?: { triggerTurn?: boolean }
) => void;

export interface McpExtensionState {
  owner: McpRuntimeOwner;
  manager: McpServerManager;
  lifecycle: McpLifecycleManager;
  toolMetadata: Map<string, ToolMetadata[]>;
  /** Resource counts retained separately because tool metadata includes resource tools. */
  resourceCounts: Map<string, number>;
  promptMetadata: Map<string, PromptMetadata[]>;
  /** Servers whose prompt inventory came from successful live discovery. */
  promptMetadataLive: Set<string>;
  serverInstructions: Map<string, string>;
  config: McpConfig;
  programmaticConfig?: boolean;
  oauthRuntime: McpOAuthRuntime;
  authStorageOptions: AuthStorageOptions;
  failureTracker: Map<string, number>;
  failureMessages: Map<string, string>;
  /** Session-only approvals keyed by server and original tool name. */
  approvedToolCalls: Map<string, true>;
  /** Shared event bus used by permission extensions to broker MCP approvals. */
  approvalEvents?: ExtensionAPI["events"];
  uiResourceHandler: UiResourceHandler;
  consentManager: ConsentManager;
  uiServer: UiServerHandle | null;
  completedUiSessions: CompletedUiSession[];
  openBrowser: (url: string) => Promise<void>;
  ui?: ExtensionContext["ui"];
  sendMessage?: SendMessageFn;
  onToolMetadataUpdated?: (serverName: string, reason: string) => void | Promise<void>;
  statusEvents?: McpStatusEventBus;
}
