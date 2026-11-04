import { readFileSync } from "node:fs";
import { parseJsonConfig } from "../config/read.ts";
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { McpSettings, ServerEntry } from "../contracts/core.js";
import { validateMcpConfig, validateServerEntry } from "../config/validation.ts";
import { MCP_SETTINGS_FIELD_MAPPING } from "./config-mapping.ts";

export type StandardConfigResult =
  | { readonly ok: true; readonly value: McpServerConfig }
  | { readonly ok: false; readonly error: { readonly code: "invalid-server" | "unsupported-fields"; readonly message: string } };

export type StandardNativeConfigResult =
  | { readonly ok: true; readonly value: { readonly names: ReadonlySet<string>; readonly settings: McpSettings | undefined } }
  | { readonly ok: false; readonly error: { readonly code: "read-failed" | "invalid-json" | "invalid-config" | "invalid-settings"; readonly message: string } };

export function readStandardNativeConfiguration(paths: ReadonlySet<string>): StandardNativeConfigResult {
  const names = new Set<string>();
  let settings: McpSettings | undefined;
  for (const path of paths) {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      return { ok: false, error: { code: "read-failed", message: "Native Pi MCP configuration could not be read safely." } };
    }
    let parsed: unknown;
    try {
      parsed = parseJsonConfig(raw);
    } catch {
      return { ok: false, error: { code: "invalid-json", message: "Native Pi MCP configuration is not valid JSON." } };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: { code: "invalid-config", message: "Native Pi MCP configuration must be an object." } };
    }
    const config = parsed as Record<string, unknown>;
    if (config.settings !== undefined) {
      const validated = validateMcpConfig({ mcpServers: {}, settings: config.settings });
      if (!validated.ok) return { ok: false, error: { code: "invalid-settings", message: "Native Pi configuration contains invalid adapter settings; additional sources cannot be imported safely." } };
      settings = { ...settings, ...validated.value.settings };
    }
    if (config.mcpServers === undefined) continue;
    if (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)) {
      return { ok: false, error: { code: "invalid-config", message: "Native Pi MCP server map must be an object." } };
    }
    for (const name of Object.keys(config.mcpServers)) names.add(name);
  }
  return { ok: true, value: { names, settings } };
}

const SUPPORTED_FIELDS = new Set([
  "command", "args", "env", "cwd", "url", "headers", "enabled", "disabled",
  "exposure", "toolExposure", "directTools", "requestTimeoutMs", "description",
]);

function isPresentationSetting(key: string): boolean {
  return Object.hasOwn(MCP_SETTINGS_FIELD_MAPPING, key)
    && MCP_SETTINGS_FIELD_MAPPING[key as keyof McpSettings].owner === "adapter-presentation";
}

export function getStandardPresentationSettings(settings?: McpSettings): string[] {
  return Object.keys(settings ?? {})
    .filter((key) => settings?.[key as keyof McpSettings] !== undefined && isPresentationSetting(key))
    .map((key) => `settings.${key}`);
}

// Do not pass adapter-only authentication or policies to a host that may ignore them.
export function mapStandardServer(name: string, entry: ServerEntry, settings?: McpSettings): StandardConfigResult {
  const validated = validateServerEntry(name, entry, { requireTransport: true });
  if (!validated.ok) return { ok: false, error: { code: "invalid-server", message: validated.error.message } };
  const value = validated.value;
  const unsupported = [
    ...Object.keys(value).filter((key) => value[key as keyof ServerEntry] !== undefined
      && !SUPPORTED_FIELDS.has(key)
      && !(key === "httpTransport" && value.url && value.httpTransport === "streamable-http")),
    ...Object.keys(settings ?? {}).filter((key) => settings?.[key as keyof McpSettings] !== undefined
      && key !== "directTools" && !isPresentationSetting(key)).map((key) => `settings.${key}`),
  ];
  if (unsupported.length) {
    return { ok: false, error: { code: "unsupported-fields", message: `Standard Pi MCP mode: unsupported fields for "${name}": ${unsupported.join(", ")}. This server was not registered; use native Pi configuration or the enhanced management host without dropping required policies.` } };
  }
  const direct = value.directTools ?? settings?.directTools;
  const toolExposure = {
    ...(Array.isArray(direct) ? Object.fromEntries(direct.map((tool) => [tool, "direct" as const])) : {}),
    ...value.toolExposure,
  };
  const common = {
    enabled: value.disabled === true ? false : value.enabled ?? true,
    exposure: value.exposure ?? (direct === true ? "direct" as const : "codemode" as const),
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(Object.keys(toolExposure).length ? { toolExposure } : {}),
    ...(value.requestTimeoutMs && value.requestTimeoutMs > 0 ? { timeout: value.requestTimeoutMs / 1000 } : {}),
  };
  if (value.command) {
    return { ok: true, value: {
      ...common, command: value.command,
      ...(value.args === undefined ? {} : { args: value.args }),
      ...(value.env === undefined ? {} : { env: value.env }),
      ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
    } };
  }
  if (value.url) {
    return { ok: true, value: { ...common, url: value.url, ...(value.headers === undefined ? {} : { headers: value.headers }) } };
  }
  return { ok: false, error: { code: "invalid-server", message: `Standard Pi MCP mode requires a stdio command or HTTP URL for "${name}".` } };
}
