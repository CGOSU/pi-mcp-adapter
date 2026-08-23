// Config file parsing and imported-host adapters.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import stripJsonComments from "strip-json-comments";
import { toStringRecord } from "../utils.ts";
import { IMPORT_PATHS } from "./paths.js";
import type { ImportKind, McpConfig, McpSettings, ServerEntry } from "../contracts/core.js";

export function resolveImportCandidates(importKind: ImportKind, cwd: string): string[] {
  return (IMPORT_PATHS[importKind] ?? []).map((candidate) => {
    if (importKind === "opencode" && candidate === "./opencode.json") {
      const start = resolve(cwd);
      let gitRoot: string | undefined;
      let current = start;
      while (true) {
        if (existsSync(join(current, ".git"))) {
          gitRoot = current;
          break;
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }

      if (!gitRoot) return join(start, "opencode.json");
      current = start;
      while (true) {
        const projectConfig = join(current, "opencode.json");
        if (existsSync(projectConfig) || current === gitRoot) return projectConfig;
        current = dirname(current);
      }
    }
    return candidate.startsWith(".") ? resolve(cwd, candidate) : candidate;
  });
}

export function parseJsonConfig(raw: string): unknown {
  return JSON.parse(stripJsonComments(raw, { trailingCommas: true }));
}

export function readImportedConfig(path: string): unknown {
  const raw = readFileSync(path, "utf-8");
  return path.endsWith(".toml") ? parseToml(raw) : parseJsonConfig(raw);
}

export function loadImportedConfig(
  importKind: ImportKind,
  cwd: string,
  warningPrefix: string,
): { path: string; value: unknown } | null {
  if (importKind === "opencode") {
    let merged: Record<string, unknown> = {};
    let highestPrecedencePath: string | undefined;

    for (const path of resolveImportCandidates(importKind, cwd)) {
      if (!existsSync(path)) continue;

      try {
        const value = readImportedConfig(path);
        if (value && typeof value === "object" && !Array.isArray(value)) {
          merged = mergeOpenCodeConfigs(merged, value as Record<string, unknown>);
          highestPrecedencePath = path;
        }
      } catch (error) {
        console.warn(warningPrefix, error);
      }
    }

    return highestPrecedencePath ? { path: highestPrecedencePath, value: merged } : null;
  }

  for (const path of resolveImportCandidates(importKind, cwd)) {
    if (!existsSync(path)) continue;

    try {
      return { path, value: readImportedConfig(path) };
    } catch (error) {
      console.warn(warningPrefix, error);
    }
  }

  return null;
}

export function resolveImportPath(importKind: ImportKind, cwd = process.cwd()): string | null {
  return loadImportedConfig(importKind, cwd, `Failed to discover imported MCP config from ${importKind}:`)?.path ?? null;
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
    ...(Array.isArray(raw.imports) ? { imports: raw.imports as ImportKind[] } : {}),
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

function mergeOpenCodeConfigs(base: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const baseMcp = base.mcp;
  const nextMcp = next.mcp;
  const mergedMcp: Record<string, unknown> = {
    ...(baseMcp && typeof baseMcp === "object" && !Array.isArray(baseMcp) ? baseMcp : {}),
  };

  if (nextMcp && typeof nextMcp === "object" && !Array.isArray(nextMcp)) {
    for (const [name, nextEntry] of Object.entries(nextMcp)) {
      const baseEntry = mergedMcp[name];
      if (
        baseEntry && typeof baseEntry === "object" && !Array.isArray(baseEntry)
        && nextEntry && typeof nextEntry === "object" && !Array.isArray(nextEntry)
      ) {
        const safeBase = { ...(baseEntry as Record<string, unknown>) };
        const override = nextEntry as Record<string, unknown>;
        if (typeof override.type === "string" && override.type !== safeBase.type) {
          for (const field of ["command", "environment", "cwd", "url", "headers", "oauth"]) delete safeBase[field];
        }
        if (typeof override.url === "string" && override.url !== safeBase.url) {
          delete safeBase.headers;
          delete safeBase.oauth;
        }
        if (Array.isArray(override.command)) {
          const baseCommand = safeBase.command;
          const commandChanged = !Array.isArray(baseCommand)
            || override.command.length !== baseCommand.length
            || override.command.some((value, index) => value !== baseCommand[index]);
          if (commandChanged) {
            delete safeBase.environment;
            delete safeBase.cwd;
          }
        }

        const mergedEntry = { ...safeBase, ...override };
        for (const field of ["environment", "headers", "oauth"]) {
          const baseField = safeBase[field];
          const nextField = override[field];
          if (
            baseField && typeof baseField === "object" && !Array.isArray(baseField)
            && nextField && typeof nextField === "object" && !Array.isArray(nextField)
          ) {
            mergedEntry[field] = { ...(baseField as Record<string, unknown>), ...(nextField as Record<string, unknown>) };
          }
        }
        mergedMcp[name] = mergedEntry;
      } else {
        mergedMcp[name] = nextEntry;
      }
    }
  }

  return { ...base, ...next, mcp: mergedMcp };
}

export function extractServers(config: unknown, kind: ImportKind): Record<string, ServerEntry> {
  if (!config || typeof config !== "object") return {};

  const obj = config as Record<string, unknown>;

  let servers: unknown;
  switch (kind) {
    case "claude-desktop":
    case "claude-code":
      servers = obj.mcpServers;
      break;
    case "codex":
      servers = obj.mcp_servers ?? obj.mcpServers;
      break;
    case "cursor":
    case "windsurf":
    case "vscode":
      servers = obj.mcpServers ?? obj["mcp-servers"];
      break;
    case "opencode":
      servers = obj.mcp;
      break;
    default:
      return {};
  }

  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return {};
  }

  const mappedServers: Record<string, ServerEntry> = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (kind === "opencode") {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const raw = entry as Record<string, unknown>;
      if (raw.enabled === false) continue;

      if (raw.type === "local" && Array.isArray(raw.command) && raw.command.length > 0 && raw.command.every((value): value is string => typeof value === "string")) {
        const env = toStringRecord(raw.environment);
        const command = raw.command[0];
        if (command === undefined) continue;
        const mapped: ServerEntry = {
          command,
          args: raw.command.slice(1),
          ...(env ? { env } : {}),
          ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
        };
        mappedServers[name] = mapped;
        continue;
      }

      if (raw.type === "remote" && typeof raw.url === "string") {
        const headers = toStringRecord(raw.headers);
        const mapped: ServerEntry = {
          url: raw.url,
          ...(headers ? { headers } : {}),
        };
        if (raw.oauth === false) {
          mapped.oauth = false;
        } else if (raw.oauth && typeof raw.oauth === "object" && !Array.isArray(raw.oauth)) {
          const oauth = raw.oauth as Record<string, unknown>;
          mapped.auth = "oauth";
          mapped.oauth = {
            ...(typeof oauth.clientId === "string" ? { clientId: oauth.clientId } : {}),
            ...(typeof oauth.clientSecret === "string" ? { clientSecret: oauth.clientSecret } : {}),
            ...(typeof oauth.scope === "string" ? { scope: oauth.scope } : {}),
            ...(typeof oauth.skipIssuerMetadataValidation === "boolean"
              ? { skipIssuerMetadataValidation: oauth.skipIssuerMetadataValidation }
              : {}),
          };
        }
        mappedServers[name] = mapped;
      }
      continue;
    }

    if (!isRecord(entry)) continue;
    if (kind !== "codex") {
      mappedServers[name] = entry;
      continue;
    }

    const mapped = { ...entry };
    const bearerTokenEnv = mapped.bearer_token_env_var;
    const httpHeaders = mapped.http_headers;
    const envHttpHeaders = mapped.env_http_headers;

    if (typeof bearerTokenEnv === "string") {
      mapped.bearerTokenEnv = bearerTokenEnv;
      if (mapped.auth === undefined) mapped.auth = "bearer";
    }
    if (httpHeaders && typeof httpHeaders === "object" && !Array.isArray(httpHeaders)) {
      mapped.headers = { ...(mapped.headers as Record<string, string> | undefined), ...(httpHeaders as Record<string, string>) };
    }
    if (envHttpHeaders && typeof envHttpHeaders === "object" && !Array.isArray(envHttpHeaders)) {
      const headers = { ...(mapped.headers as Record<string, string> | undefined) };
      for (const [header, envVar] of Object.entries(envHttpHeaders)) {
        if (typeof envVar === "string" && headers[header] === undefined) headers[header] = `$env:${envVar}`;
      }
      mapped.headers = headers;
    }

    delete mapped.bearer_token_env_var;
    delete mapped.http_headers;
    delete mapped.env_http_headers;
    mappedServers[name] = mapped as ServerEntry;
  }

  return mappedServers;
}
