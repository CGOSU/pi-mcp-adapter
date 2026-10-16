// Configuration file parsing and validation.
import { existsSync, readFileSync } from "node:fs";
import stripJsonComments from "strip-json-comments";
import type { McpConfig } from "../contracts/core.js";
import {
  validateMcpConfig,
  type ConfigValidationError,
  type ConfigValidationIssue,
  type ConfigValidationResult,
} from "./validation.ts";

export type ConfigReadError = ConfigValidationError | {
  readonly code: "invalid-json" | "read-failed";
  readonly message: string;
  readonly issues: readonly [];
};

export type ConfigReadResult =
  | { readonly ok: true; readonly value: McpConfig | null; readonly issues?: readonly ConfigValidationIssue[] }
  | { readonly ok: false; readonly error: ConfigReadError };

export function parseJsonConfig(raw: string): unknown {
  return JSON.parse(stripJsonComments(raw, { trailingCommas: true }));
}

export function readValidatedConfig(path: string, _label: string): ConfigReadResult {
  try {
    if (!existsSync(path)) return { ok: true, value: null };
    let parsed: unknown;
    try {
      parsed = parseJsonConfig(readFileSync(path, "utf-8"));
    } catch {
      return { ok: false, error: { code: "invalid-json", message: "Configuration file is not valid JSON.", issues: [] } };
    }
    const validated: ConfigValidationResult<McpConfig> = validateMcpConfig(parsed);
    return validated.ok
      ? { ok: true, value: validated.value, ...(validated.issues ? { issues: validated.issues } : {}) }
      : validated;
  } catch {
    return { ok: false, error: { code: "read-failed", message: "Configuration file could not be read.", issues: [] } };
  }
}
