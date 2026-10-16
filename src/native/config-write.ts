import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { McpServerConfigPatch } from "@earendil-works/pi-coding-agent";
import { parseJsonConfig } from "../config/read.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectToolsSelection(value: unknown): value is boolean | string[] {
  if (typeof value === "boolean") return true;
  try {
    if (!Array.isArray(value) || value.length > 256) return false;
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) return false;
      const toolName: unknown = value[index];
      if (
        typeof toolName !== "string" ||
        toolName.length === 0 ||
        toolName.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(toolName)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function readConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = parseJsonConfig(readFileSync(path, "utf8"));
  } catch {
    throw new Error("The MCP config file cannot be parsed safely.");
  }
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
    throw new Error("The MCP config file must contain an object mcpServers field.");
  }
  return parsed;
}

function updateServer(
  servers: Record<string, unknown>,
  serverName: string,
  patch: McpServerConfigPatch,
  allowCreate: boolean,
): void {
  const existing = servers[serverName];
  if (existing === undefined && !allowCreate) {
    throw new Error("The MCP config source no longer contains this server.");
  }
  if (existing !== undefined && !isRecord(existing)) {
    throw new Error("The MCP config entry cannot be updated safely.");
  }

  const server = existing === undefined ? {} : { ...existing };
  const isOverride = server.command === undefined && server.url === undefined && server.socket === undefined && server.type === undefined;
  if (patch.enabled !== undefined) {
    delete server.disabled;
    if (patch.enabled && !isOverride) delete server.enabled;
    else server.enabled = patch.enabled;
  }
  if (patch.exposure !== undefined) {
    if (patch.exposure === "codemode" && !isOverride) delete server.exposure;
    else server.exposure = patch.exposure;
  }
  if (patch.toolExposure !== undefined) {
    const current = server.toolExposure;
    if (current !== undefined && !isRecord(current)) {
      throw new Error("The MCP tool exposure entry cannot be updated safely.");
    }
    server.toolExposure = { ...(current ?? {}), ...patch.toolExposure };
  }
  if ("directTools" in patch && patch.directTools !== undefined) {
    if (!isDirectToolsSelection(patch.directTools)) {
      throw new Error("The MCP direct-tool selection is invalid.");
    }
    server.directTools = Array.isArray(patch.directTools) ? [...patch.directTools] : patch.directTools;
  }
  servers[serverName] = server;
}

/** Applies native management changes to the adapter's existing, provenance-selected config target. */
export function writeNativeMcpConfigPatch(
  path: string,
  serverName: string,
  patch: McpServerConfigPatch,
  allowCreateOverride: boolean,
): void {
  const parsed = readConfig(path);
  const serverKey = parsed.mcpServers === undefined && parsed["mcp-servers"] !== undefined ? "mcp-servers" : "mcpServers";
  const value = parsed[serverKey];
  if (value !== undefined && !isRecord(value)) {
    throw new Error("The MCP config server map cannot be updated safely.");
  }
  const servers = value === undefined ? {} : { ...value };
  updateServer(servers, serverName, patch, allowCreateOverride);
  parsed[serverKey] = servers;

  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryFileExists = false;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    temporaryFileExists = true;
    renameSync(temporaryPath, path);
    temporaryFileExists = false;
  } catch {
    if (temporaryFileExists) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Preserve the original write failure; the uniquely named temporary file is non-authoritative.
      }
    }
    throw new Error("The MCP config change could not be written safely.");
  }
}
