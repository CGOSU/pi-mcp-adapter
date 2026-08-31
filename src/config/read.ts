// Configuration file parsing and validation.
import { existsSync, readFileSync } from "node:fs";
import stripJsonComments from "strip-json-comments";
import type { McpConfig, McpSettings, ServerEntry } from "../contracts/core.js";

export function parseJsonConfig(raw: string): unknown {
  return JSON.parse(stripJsonComments(raw, { trailingCommas: true }));
}

export function readValidatedConfig(path: string, label: string): McpConfig | null {
  if (!existsSync(path)) return null;

  try {
    return validateConfig(parseJsonConfig(readFileSync(path, "utf-8")));
  } catch (error) {
    console.warn(`Failed to load ${label}:`, error);
    return null;
  }
}

export function validateConfig(raw: unknown): McpConfig {
  if (!isRecord(raw)) {
    return { mcpServers: {} };
  }

  return {
    mcpServers: toServerEntries(raw.mcpServers ?? raw["mcp-servers"]),
    ...(raw.settings !== undefined ? { settings: raw.settings as McpSettings } : {}),
  };
}

function toServerEntries(servers: unknown): Record<string, ServerEntry> {
  if (!isRecord(servers)) return {};
  const entries: Record<string, ServerEntry> = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (isServerEntry(entry)) entries[name] = entry;
  }
  return entries;
}

function isServerEntry(value: unknown): value is ServerEntry {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
