// Public configuration contracts shared by config domains.
import type { AgentPluginSummary } from "./agent-plugin-loader.ts";
import type { McpConfig, ServerEntry } from "../contracts/core.js";

export interface KnownServerPreset {
  id: string;
  name: string;
  summary: string;
  entry: ServerEntry;
}

export const KNOWN_SERVER_PRESETS: readonly KnownServerPreset[] = [
  {
    id: "deepwiki",
    name: "DeepWiki",
    summary: "Ask questions about public GitHub repositories.",
    entry: { url: "https://mcp.deepwiki.com/mcp", protocolVersion: "auto" },
  },
  {
    id: "context7",
    name: "Context7",
    summary: "Look up current library documentation and examples.",
    entry: { url: "https://mcp.context7.com/mcp", protocolVersion: "auto" },
  },
  {
    id: "notion",
    name: "Notion",
    summary: "Search and work with your Notion workspace.",
    entry: { url: "https://mcp.notion.com/mcp", auth: "oauth", protocolVersion: "auto" },
  },
  {
    id: "github",
    name: "GitHub",
    summary: "Work with GitHub through your Copilot account.",
    entry: { url: "https://api.githubcopilot.com/mcp", auth: "oauth", protocolVersion: "auto" },
  },
  {
    id: "chrome-devtools",
    name: "Chrome DevTools",
    summary: "Inspect and automate a local Chrome browser.",
    entry: { command: "npx", args: ["-y", "chrome-devtools-mcp@1.6.0"] },
  },
];

export interface ConfigSourceSpec {
  id:
    | "shared-global"
    | "agents-global"
    | "agents-nested-global"
    | "pi-global"
    | "shared-project"
    | "agents-project"
    | "agents-nested-project"
    | "pi-project"
    | "adapter-config"
    | "pi-package-global"
    | "pi-package-project"
    | "agent-plugin-global"
    | "agent-plugin-project";
  label: string;
  readPath: string;
  writePath: string;
  kind: "user" | "project" | "shared" | "extension";
  shared: boolean;
  scope: "global" | "project" | "extension";
}

export interface ConfigDiscoveryPath {
  label: string;
  path: string;
  exists: boolean;
}

export interface ConfigDiscoverySource extends ConfigDiscoveryPath {
  id: ConfigSourceSpec["id"];
  scope: ConfigSourceSpec["scope"];
  kind: "shared" | "pi";
  serverCount: number;
  validationError?: { code: string; message: string };
}

export interface McpConfigConflict {
  serverName: string;
  sources: Array<{ kind: "shared" | "pi"; path: string }>;
  winner: { kind: "shared" | "pi"; path: string };
}

export interface RepoPromptDiscovery {
  configured: boolean;
  configuredPath?: string;
  executablePath?: string;
  targetPath?: string;
  serverName?: string;
  entry?: ServerEntry;
}

export interface McpDiscoverySummary {
  sources: ConfigDiscoverySource[];
  agentPlugins: AgentPluginSummary[];
  conflicts: McpConfigConflict[];
  hasAnyConfig: boolean;
  hasAnyDetectedPaths: boolean;
  hasSharedServers: boolean;
  hasPiOwnedServers: boolean;
  totalServerCount: number;
  fingerprint: string;
  repoPrompt: RepoPromptDiscovery;
}

export interface McpStandardConfigSummary {
  sources: ConfigDiscoverySource[];
  hasSharedServers: boolean;
  fingerprint: string;
}

export interface ConfigWritePreview {
  path: string;
  existed: boolean;
  changed: boolean;
  beforeText: string;
  afterText: string;
  diffText: string;
}
