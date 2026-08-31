import {
  buildProxyDescription,
  prepareDirectToolArguments,
  resolveDirectTools
} from "./chunks/chunk-I5MJPLKC.js";
import {
  MCP_STATUS_EVENT,
  MCP_STATUS_SNAPSHOT_VERSION,
  isServerInActiveFailureBackoff,
  logger,
  publishMcpStatusShutdown
} from "./chunks/chunk-3G7YTFA4.js";
import {
  createMcpRuntimeOwner,
  createOwnedUi,
  isAbortError
} from "./chunks/chunk-CYSFURUK.js";
import {
  cloneMcpConfig,
  loadMcpConfig
} from "./chunks/chunk-AZSKIV4J.js";
import "./chunks/chunk-PI2QHUXN.js";
import {
  createCachedToolSelectorCandidateIndex,
  createMetadataCatalogSnapshot,
  formatToolName,
  getMissingConfiguredDirectToolServers,
  isServerCacheValid,
  isToolAllowed,
  isUiToolVisibleToModel,
  loadMetadataCache,
  parseDirectToolSelectors,
  reconstructPromptMetadata,
  resolveToolPrefix,
  resourceNameToToolName
} from "./chunks/chunk-NBQZZ3IQ.js";
import {
  MCP_TOOL_APPROVAL_REQUEST_EVENT,
  formatTerminalError,
  getConfigPathFromArgv,
  isServerDisabled,
  normalizeDirectToolInputSchema,
  truncateAtWord
} from "./chunks/chunk-Z3P2QPCB.js";
import "./chunks/chunk-ELOBWFRH.js";

// src/extension/install.ts
import { Type as Type3 } from "typebox";

// src/tools/prompts.ts
function resolveCachedPrompts(config, snapshot) {
  const catalog = snapshot ?? createMetadataCatalogSnapshot(config, loadMetadataCache());
  const cache = catalog.cache;
  if (!cache?.servers) return [];
  const prefix = config.settings?.toolPrefix ?? "server";
  const specs = [];
  for (const serverName of Object.keys(cache.servers)) {
    const definition = config.mcpServers[serverName];
    const entry = catalog.validEntries.get(serverName);
    if (!definition || !entry?.prompts?.length) continue;
    specs.push(...reconstructPromptMetadata(serverName, entry.prompts, prefix, definition));
  }
  return specs;
}
function parsePromptArgs(input) {
  const positional = [];
  const named = {};
  const tokens = tokenizeArgs(input);
  for (const token of tokens) {
    const eq = findUnquotedEquals(token);
    if (eq > 0) {
      const key = token.slice(0, eq).trim();
      const value = stripQuotes(token.slice(eq + 1).trim());
      if (key) {
        named[key] = value;
        continue;
      }
    }
    positional.push(stripQuotes(token));
  }
  return { positional, named };
}
function tokenizeArgs(input) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}
function findUnquotedEquals(token) {
  let quote = null;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "=") return i;
  }
  return -1;
}
function stripQuotes(value) {
  if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value.charAt(0))) {
    return value.slice(1, -1);
  }
  return value;
}
function resolvePromptArgs(metadata, parsed) {
  const args = {};
  const declared = metadata.arguments;
  let positionalIndex = 0;
  for (const argDef of declared) {
    const value = parsed.named[argDef.name] ?? parsed.positional[positionalIndex++];
    if (value !== void 0 && value !== "") {
      args[argDef.name] = value;
    }
  }
  for (const [key, value] of Object.entries(parsed.named)) {
    if (!(key in args)) args[key] = value;
  }
  const missing = declared.filter((a) => a.required && (args[a.name] === void 0 || args[a.name] === ""));
  if (missing.length > 0) {
    return { ok: false, error: buildUsageMessage(metadata, missing) };
  }
  return { ok: true, args };
}
function buildUsageMessage(metadata, missing) {
  const usage = metadata.arguments.map((a) => a.required ? `<${a.name}>` : `[${a.name}]`).join(" ");
  const missingList = missing.map((a) => a.name).join(", ");
  return `Missing required argument${missing.length > 1 ? "s" : ""}: ${missingList}.
Usage: /${metadata.commandName} ${usage}`.trim();
}
function formatPromptResult(result) {
  const lines = [];
  for (const message of result.messages) {
    const text = extractMessageText(message);
    if (!text) continue;
    if (message.role === "user" && result.messages.length === 1) {
      lines.push(text);
    } else {
      lines.push(`[${message.role}] ${text}`);
    }
  }
  return lines.join("\n\n").trim();
}
function extractMessageText(message) {
  const content = message.content;
  if (!content || typeof content !== "object") return "";
  switch (content.type) {
    case "text":
      return content.text ?? "";
    case "resource": {
      const resource = content.resource;
      if (!resource) return "";
      if ("text" in resource && typeof resource.text === "string") {
        return `[resource ${resource.uri}]
${resource.text}`;
      }
      return `[resource ${resource.uri}]`;
    }
    case "resource_link":
      return `[resource_link ${content.uri ?? ""}${content.name ? ` \u2014 ${content.name}` : ""}]`;
    case "image":
      return `[image ${content.mimeType ?? "unknown"}${content.data ? " (embedded)" : ""}]`;
    case "audio":
      return `[audio ${content.mimeType ?? "unknown"}]`;
    default:
      return "";
  }
}
function createPromptCommand(pi, getState, metadata, ensureState) {
  const description = buildCommandDescription(metadata);
  return {
    description,
    handler: async (args, ctx) => {
      let state = getState();
      if (!state && ensureState) {
        try {
          state = await ensureState(ctx.signal);
        } catch (error) {
          if (ctx.hasUI) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
          }
          return;
        }
      }
      if (!state) {
        if (ctx.hasUI) ctx.ui.notify("MCP not initialized", "error");
        return;
      }
      const liveMetadata = findLivePromptMetadata(state, metadata.serverName, metadata.originalName);
      if (state.promptMetadataLive?.has(metadata.serverName) && !liveMetadata) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `MCP prompt "${metadata.originalName}" is no longer advertised by server "${metadata.serverName}". Run /mcp reconnect to refresh.`,
            "error"
          );
        }
        return;
      }
      const live = liveMetadata ?? metadata;
      const parsed = parsePromptArgs(args ?? "");
      const resolved = resolvePromptArgs(live, parsed);
      if (!resolved.ok) {
        if (ctx.hasUI) ctx.ui.notify(resolved.error ?? "Invalid prompt arguments", "error");
        return;
      }
      const promptArgs = resolved.args ?? {};
      if (!state.config.mcpServers[metadata.serverName]) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `MCP prompt "${live.originalName}" is no longer configured. Run /mcp reconnect to refresh.`,
            "error"
          );
        }
        return;
      }
      const { lazyConnect } = await import("./chunks/initialization-QWDGRTUG.js");
      const connected = await lazyConnect(state, metadata.serverName, ctx.signal);
      if (!connected) {
        if (ctx.hasUI) {
          const conn = state.manager.getConnection(metadata.serverName);
          const message = conn?.status === "needs-auth" ? `MCP server "${metadata.serverName}" needs authentication. Run /mcp-auth ${metadata.serverName}.` : `MCP server "${metadata.serverName}" is not available. Run /mcp reconnect ${metadata.serverName}.`;
          ctx.ui.notify(message, "error");
        }
        return;
      }
      const refreshed = findLivePromptMetadata(state, metadata.serverName, metadata.originalName);
      if (state.promptMetadataLive?.has(metadata.serverName) && !refreshed) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `MCP prompt "${metadata.originalName}" is no longer advertised by server "${metadata.serverName}". Run /mcp reconnect to refresh.`,
            "error"
          );
        }
        return;
      }
      const dispatchMetadata = refreshed ?? live;
      let result;
      try {
        result = await state.manager.getPrompt(
          metadata.serverName,
          dispatchMetadata.originalName,
          Object.keys(promptArgs).length > 0 ? promptArgs : void 0,
          ctx.signal
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug(`MCP prompt "${live.originalName}" on ${metadata.serverName} failed: ${message}`);
        if (ctx.hasUI) {
          ctx.ui.notify(`MCP prompt "${live.originalName}" failed: ${message}`, "error");
        }
        return;
      }
      const text = formatPromptResult(result);
      if (!text) {
        if (ctx.hasUI) {
          ctx.ui.notify(`MCP prompt "${live.originalName}" returned no text content.`, "warning");
        }
        return;
      }
      pi.sendUserMessage(text);
    }
  };
}
function findLivePromptMetadata(state, serverName, originalName) {
  return state.promptMetadata?.get(serverName)?.find((p) => p.originalName === originalName);
}
function buildCommandDescription(metadata) {
  const base = metadata.description || metadata.title || `MCP prompt from ${metadata.serverName}`;
  return truncateAtWord(`MCP: ${base}`, 120) || `MCP prompt from ${metadata.serverName}`;
}

// src/tools/tool-result-renderer.ts
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
var plainTheme = { fg: (_name, text) => text };
var DEFAULT_MAX_CALL_INPUT_CHARS = 1500;
var DEFAULT_MAX_COMPACT_INPUT_CHARS = 240;
var DEFAULT_BOXED_COLLAPSED_LINES = 3;
var DEFAULT_COMPACT_COLLAPSED_LINES = 1;
var DEFAULT_MAX_COLLAPSED_CHARS = 8e3;
var COLLAPSED_RENDER_CHAR_SLACK = 8;
var EmptyComponent = class {
  render() {
    return [];
  }
  invalidate() {
  }
};
var CompactMcpToolResult = class {
  constructor(title, inputPreview, display, theme) {
    this.title = title;
    this.inputPreview = inputPreview;
    this.display = display;
    this.theme = theme;
  }
  title;
  inputPreview;
  display;
  theme;
  rendered = null;
  render(width) {
    const safeWidth = Math.max(1, Math.floor(width));
    if (this.rendered?.width === safeWidth) return this.rendered.lines;
    const resultLines = this.display.lines.filter((line, index, lines2) => {
      return !(this.display.truncated && index === lines2.length - 1 && line === "\u2026");
    });
    const lines = resultLines.length > 0 ? resultLines : [""];
    const bodies = lines.map((line, index) => {
      const prefix = index === 0 ? this.renderPrefix(safeWidth) : "";
      return `${prefix}${this.theme.fg("toolOutput", line)}`;
    });
    const hiddenText = this.display.truncated || bodies.some((body) => visibleWidth(body) > safeWidth);
    const rendered = bodies.map((body, index) => {
      const suffix = hiddenText && index === bodies.length - 1 ? " \u2026 (Ctrl+O to expand)" : "";
      if (!suffix) return truncateToWidth(body, safeWidth, "\u2026");
      if (safeWidth >= suffix.length + 20) {
        return `${truncateToWidth(body, safeWidth - suffix.length, "\u2026")}${this.theme.fg("muted", suffix)}`;
      }
      const shortSuffix = " (Ctrl+O)";
      if (safeWidth >= shortSuffix.length + 5) {
        return `${truncateToWidth(body, safeWidth - shortSuffix.length, "\u2026")}${this.theme.fg("muted", shortSuffix)}`;
      }
      return truncateToWidth(this.theme.fg("muted", shortSuffix.trim()), safeWidth, "\u2026");
    });
    this.rendered = { width: safeWidth, lines: rendered };
    return rendered;
  }
  invalidate() {
    this.rendered = null;
  }
  renderPrefix(width) {
    if (!this.title) return "";
    const arrow = " \u2192 ";
    if (!this.inputPreview) return `${this.theme.fg("toolTitle", this.title)}${arrow}`;
    const maxPrefixWidth = Math.max(12, Math.floor(width * 0.55));
    const titleWidth = visibleWidth(this.title);
    const inputWidth = Math.max(0, maxPrefixWidth - titleWidth - 1);
    if (inputWidth <= 3) {
      return `${this.theme.fg("toolTitle", truncateToWidth(this.title, maxPrefixWidth, "\u2026"))}${arrow}`;
    }
    const input = truncateToWidth(this.inputPreview, inputWidth, "\u2026");
    return `${this.theme.fg("toolTitle", this.title)} ${this.theme.fg("muted", input)}${arrow}`;
  }
};
var CollapsibleText = class {
  constructor(text, expanded, maxCollapsedLines, ellipsis, expandHint, preTruncated = false) {
    this.text = text;
    this.expanded = expanded;
    this.maxCollapsedLines = maxCollapsedLines;
    this.preTruncated = preTruncated;
    this.fullText = new Text(text, 0, 0);
    this.footerText = new Text(`${ellipsis}
${expandHint}`, 0, 0);
  }
  text;
  expanded;
  maxCollapsedLines;
  preTruncated;
  fullText;
  footerText;
  collapsedText = null;
  collapsedRender = null;
  render(width) {
    if (this.expanded) {
      return this.fullText.render(width);
    }
    const safeWidth = Math.max(1, Math.floor(width));
    const charBudget = safeWidth * (this.maxCollapsedLines + 1) * COLLAPSED_RENDER_CHAR_SLACK;
    if (!this.collapsedText || this.collapsedText.charBudget !== charBudget) {
      const prefix = this.text.length > charBudget ? this.text.slice(0, charBudget) : this.text;
      this.collapsedText = {
        charBudget,
        fullyIncluded: prefix === this.text,
        text: new Text(prefix, 0, 0)
      };
      this.collapsedRender = null;
    }
    const lines = this.collapsedText.text.render(width);
    if (!this.preTruncated && this.collapsedText.fullyIncluded && lines.length <= this.maxCollapsedLines) return lines;
    if (this.collapsedRender?.width === width && this.collapsedRender.charBudget === charBudget) {
      return this.collapsedRender.lines;
    }
    const rendered = [
      ...lines.slice(0, this.maxCollapsedLines),
      ...this.footerText.render(width)
    ];
    this.collapsedRender = { width, charBudget, lines: rendered };
    return rendered;
  }
  invalidate() {
    this.fullText.invalidate();
    this.footerText.invalidate();
    this.collapsedText?.text.invalidate();
    this.collapsedRender = null;
  }
};
function truncateText(value, maxChars) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}\u2026`;
}
function formatJsonish(value, maxChars) {
  if (typeof value === "string") {
    try {
      return truncateText(JSON.stringify(JSON.parse(value), null, 2), maxChars);
    } catch {
      return truncateText(value, maxChars);
    }
  }
  try {
    return truncateText(JSON.stringify(value, null, 2), maxChars);
  } catch {
    return truncateText(String(value), maxChars);
  }
}
function hasUsefulObjectContent(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}
function formatMcpProxyToolCallLines(args, maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS) {
  if (args.action === "ui-messages") return [`mcp ${args.action}`];
  if (args.tool) {
    const target = args.server ? `${args.tool} @ ${args.server}` : args.tool;
    const lines = [`mcp call ${target}`];
    if (args.args) lines.push(formatJsonish(args.args, maxInputChars));
    return lines;
  }
  if (args.connect) return [`mcp connect ${args.connect}`];
  if (args.describe) return [`mcp describe ${args.describe}`];
  if (args.search) {
    let line = `mcp search ${args.search}`;
    if (args.server) line += ` @ ${args.server}`;
    if (args.regex === true) line += " (regex)";
    if (args.includeSchemas === false) line += " (schemas hidden)";
    return [line];
  }
  if (args.server) return [`mcp list ${args.server}`];
  if (args.action) return [`mcp ${args.action}`];
  return ["mcp status"];
}
function formatMcpDirectToolCallLines(displayName, args, maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS) {
  if (!hasUsefulObjectContent(args)) return [displayName];
  return [displayName, formatJsonish(args, maxInputChars)];
}
function formatMcpScriptToolCallLines(args, maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS) {
  return ["mcpScript", truncateText(args.code, maxInputChars)];
}
function renderToolCallLines(lines, theme) {
  const activeTheme = theme ?? plainTheme;
  const [title = "mcp", ...rest] = lines;
  const styledTitle = activeTheme.fg("toolTitle", activeTheme.bold ? activeTheme.bold(title) : title);
  const styledRest = rest.map((line) => activeTheme.fg("muted", line));
  return new Text([styledTitle, ...styledRest].join("\n"), 0, 0);
}
function formatCompactInputPreview(lines, maxChars = DEFAULT_MAX_COMPACT_INPUT_CHARS) {
  return truncateText(lines.slice(1).join(" ").replace(/\s+/g, " ").trim(), maxChars);
}
function resolveMcpToolRenderOptions(settings) {
  const resultRendering = settings?.toolResultRendering === "boxed" ? "boxed" : "compact";
  const collapsedLines = settings?.collapsedResultLines;
  const defaultLines = resultRendering === "boxed" ? DEFAULT_BOXED_COLLAPSED_LINES : DEFAULT_COMPACT_COLLAPSED_LINES;
  return {
    resultRendering,
    collapsedResultLines: collapsedLines === 1 || collapsedLines === 2 || collapsedLines === 3 ? collapsedLines : defaultLines
  };
}
function shouldUseCompactFinalRender(options, context) {
  return options.resultRendering === "compact" && context !== void 0 && context.isPartial === false && context.expanded !== true && context.isError !== true;
}
function renderToolCall(lines, theme, context, options) {
  if (context?.state) {
    context.state.compactTitle = lines[0] ?? "mcp";
    context.state.compactInputPreview = formatCompactInputPreview(lines);
  }
  if (shouldUseCompactFinalRender(options, context)) return new EmptyComponent();
  return renderToolCallLines(lines, theme);
}
function createMcpProxyToolCallRenderer(options) {
  return (args, theme, context) => {
    return renderToolCall(formatMcpProxyToolCallLines(args), theme, context, options);
  };
}
function createMcpDirectToolCallRenderer(displayName, options = resolveMcpToolRenderOptions()) {
  return (args, theme, context) => {
    return renderToolCall(formatMcpDirectToolCallLines(displayName, args), theme, context, options);
  };
}
function createMcpScriptToolCallRenderer(options = resolveMcpToolRenderOptions()) {
  return (args, theme, context) => {
    if (shouldUseCompactFinalRender(options, context)) return new EmptyComponent();
    return renderToolCallLines(formatMcpScriptToolCallLines(args), theme);
  };
}
function blockToLines(block) {
  if (block.type === "text") {
    return block.text.split("\n");
  }
  return [`[image: ${block.mimeType}]`];
}
function collectCollapsedResultLines(content, maxLines, maxChars) {
  if (content.length === 0) return { lines: ["(empty result)"], truncated: false };
  const lines = [];
  let remainingChars = maxChars;
  let truncated = false;
  const appendLine = (line) => {
    if (lines.length === 0) {
      const previewWidth = Math.min(line.length, remainingChars);
      if (line.slice(0, previewWidth).trim() === "") {
        if (line.length >= remainingChars) {
          truncated = true;
          remainingChars = 0;
          return false;
        }
        remainingChars -= line.length + 1;
        return true;
      }
    }
    if (lines.length >= maxLines || remainingChars <= 0) {
      truncated = true;
      return false;
    }
    if (line.length > remainingChars) {
      lines.push(line.slice(0, remainingChars));
      truncated = true;
      remainingChars = 0;
      return false;
    }
    lines.push(line);
    remainingChars -= line.length + 1;
    return true;
  };
  for (const block of content) {
    if (block.type !== "text") {
      if (!appendLine(`[image: ${block.mimeType}]`)) break;
      continue;
    }
    let start = 0;
    while (start <= block.text.length) {
      const newline = block.text.indexOf("\n", start);
      const line = newline === -1 ? block.text.slice(start) : block.text.slice(start, newline);
      if (!appendLine(line)) break;
      if (newline === -1) break;
      start = newline + 1;
    }
    if (truncated) break;
  }
  if (lines.length === 0) lines.push(truncated ? "(leading blank output omitted)" : "");
  if (truncated && lines.length >= maxLines) lines.push("\u2026");
  return { lines, truncated };
}
function formatMcpToolResultIdentity(details) {
  if (details?.mode !== "call") return null;
  const server = typeof details.server === "string" ? details.server : typeof details.hintServer === "string" ? details.hintServer : null;
  if (!server) return null;
  if (typeof details.tool === "string") return `MCP ${server}/${details.tool}`;
  if (typeof details.resourceUri === "string") return `MCP ${server} resource ${details.resourceUri}`;
  if (typeof details.requestedTool === "string") return `MCP ${server}/${details.requestedTool}`;
  return null;
}
function formatMcpToolResultLines(result, expanded, maxCollapsedLines = DEFAULT_BOXED_COLLAPSED_LINES, maxCollapsedChars = DEFAULT_MAX_COLLAPSED_CHARS) {
  if (!expanded) {
    return collectCollapsedResultLines(result.content, maxCollapsedLines, maxCollapsedChars);
  }
  const allLines = result.content.flatMap(blockToLines);
  const lines = allLines.length > 0 ? allLines : ["(empty result)"];
  return { lines, truncated: false };
}
function renderMcpToolResult(result, options, theme, context, renderOptions = resolveMcpToolRenderOptions()) {
  const activeTheme = theme ?? plainTheme;
  if (options.isPartial) {
    return new Text(activeTheme.fg("warning", "Running MCP tool..."), 0, 0);
  }
  const hasErrorDetails = Boolean(result.details.error);
  const expanded = options.expanded || context?.isError === true || hasErrorDetails;
  if (!expanded && renderOptions.resultRendering === "compact") {
    const display2 = formatMcpToolResultLines(result, false, renderOptions.collapsedResultLines);
    const title = context?.state?.compactTitle ?? formatMcpToolResultIdentity(result.details) ?? "";
    const inputPreview = context?.state?.compactInputPreview ?? "";
    return new CompactMcpToolResult(title, inputPreview, display2, activeTheme);
  }
  const display = formatMcpToolResultLines(result, expanded, renderOptions.collapsedResultLines);
  const identity = formatMcpToolResultIdentity(result.details);
  const output = [
    ...identity ? [activeTheme.fg("muted", identity)] : [],
    ...display.lines.map((line) => activeTheme.fg("toolOutput", line))
  ].join("\n");
  return new CollapsibleText(
    output,
    expanded,
    renderOptions.collapsedResultLines + (identity ? 1 : 0),
    activeTheme.fg("muted", "\u2026"),
    activeTheme.fg("muted", "(Ctrl+O to expand)"),
    display.truncated
  );
}
function createMcpToolResultRenderer(renderOptions) {
  return (result, options, theme, context) => renderMcpToolResult(result, options, theme, context, renderOptions);
}

// src/tools/error-signal.ts
function toolErrorOverride(details) {
  if (details && typeof details === "object" && "error" in details) {
    const code = details.error;
    if (code === "tool_error" || code === "call_failed") {
      return { isError: true };
    }
  }
  return void 0;
}

// src/extension/tool-surface.ts
import { Type as Type2 } from "typebox";

// src/tools/namespace-tools.ts
import { Type } from "typebox";

// src/tools/mcp-references.ts
var BUILTIN_NAMES = /* @__PURE__ */ new Set(["read", "bash", "edit", "write", "grep", "find", "ls", "mcp"]);
function namespaceProxyName(serverName) {
  return `mcp__${serverName.replace(/-/g, "_")}`;
}
function parseMcpReference(raw) {
  if (!raw.startsWith("mcp:")) return { raw };
  const rest = raw.slice("mcp:".length).trim();
  if (!rest) return { raw };
  const slash = rest.indexOf("/");
  if (slash === -1) return { raw, server: rest };
  const server = rest.slice(0, slash).trim();
  const tool = rest.slice(slash + 1).trim();
  return {
    raw,
    ...server ? { server } : {},
    ...tool ? { tool } : {}
  };
}
function resolveDirectSelection(config, definition, serverName, envOverride) {
  if (envOverride) {
    if (envOverride.servers.has(serverName)) return true;
    const selectedTools = envOverride.tools.get(serverName);
    return selectedTools ? [...selectedTools] : false;
  }
  if (definition.directTools !== void 0) return definition.directTools;
  return config.settings?.directTools === true;
}
function isMcpServerDirectlyRegistered(definition, settings, serverName, envOverride) {
  if (envOverride) return envOverride.servers.has(serverName);
  if (definition?.directTools !== void 0) {
    return definition.directTools === true || Array.isArray(definition.directTools) && definition.directTools.length > 0;
  }
  return settings?.directTools === true;
}
function hasCallableCachedTargets(entry, definition) {
  return entry.tools.length > 0 || definition.exposeResources !== false && (entry.resources?.length ?? 0) > 0;
}
function hasNamespaceProxy(config, cache, envOverride, collidingNamespaceNames, existingDirectNames, serverName, snapshot) {
  const definition = config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition)) return false;
  if (isMcpServerDirectlyRegistered(definition, config.settings, serverName, envOverride)) return false;
  const toolName = namespaceProxyName(serverName);
  if (collidingNamespaceNames.has(toolName) || existingDirectNames.has(toolName)) return false;
  const entry = resolveValidCache(definition, cache, serverName, snapshot);
  return !!entry && hasCallableCachedTargets(entry, definition);
}
function resolveValidCache(definition, cache, serverName, snapshot) {
  if (!definition) return void 0;
  if (snapshot) return snapshot.validEntries.get(serverName);
  const entry = cache?.servers[serverName];
  if (!entry || !isServerCacheValid(entry, definition)) return void 0;
  return entry;
}
function cachedServers(config, cache, snapshot) {
  const servers = [];
  if (!cache) return servers;
  for (const [serverName, definition] of Object.entries(config.mcpServers)) {
    if (isServerDisabled(definition)) continue;
    const entry = resolveValidCache(definition, cache, serverName, snapshot);
    if (!entry) continue;
    servers.push({ serverName, definition, entry, prefix: resolveToolPrefix(definition, config.settings?.toolPrefix) });
  }
  return servers;
}
function namespaceCollisionNames(config, cache, envOverride, existingDirectNames, snapshot) {
  const names = /* @__PURE__ */ new Map();
  if (!cache) return /* @__PURE__ */ new Set();
  for (const serverName of Object.keys(config.mcpServers)) {
    if (!hasNamespaceProxy(config, cache, envOverride, /* @__PURE__ */ new Set(), existingDirectNames, serverName, snapshot)) continue;
    const toolName = namespaceProxyName(serverName);
    names.set(toolName, (names.get(toolName) ?? 0) + 1);
  }
  return new Set([...names].filter(([, count]) => count > 1).map(([name]) => name));
}
function registeredDirectNames(config, cache, envOverride, selectorIndex, snapshot) {
  const owners = /* @__PURE__ */ new Map();
  for (const { serverName, definition, entry, prefix } of cachedServers(config, cache, snapshot)) {
    const selection = resolveDirectSelection(config, definition, serverName, envOverride);
    for (const { name, originalName } of directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex)) {
      if (!owners.has(name)) owners.set(name, { serverName, originalName });
    }
  }
  return owners;
}
function allCurrentCandidates(config, cache, snapshot) {
  if (!cache) return void 0;
  return createCachedToolSelectorCandidateIndex(config.mcpServers, cache, config.settings?.toolPrefix ?? "server", snapshot);
}
function directToolName(toolName, serverName, definition, prefix, selectorIndex) {
  if (!isToolAllowed(toolName, serverName, prefix, definition.includeTools, definition.excludeTools, selectorIndex)) return void 0;
  return formatToolName(toolName, serverName, prefix);
}
function directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex, onlyTool) {
  if (!selection) return [];
  const names = [];
  const addTool = (toolName) => {
    if (selection !== true && !selection.includes(toolName)) return;
    const name = directToolName(toolName, serverName, definition, prefix, selectorIndex);
    if (!name) return;
    if (BUILTIN_NAMES.has(name)) return;
    if (onlyTool !== void 0 && toolName !== onlyTool && name !== onlyTool) return;
    names.push({ name, originalName: toolName });
  };
  for (const tool of entry.tools) {
    if (!isUiToolVisibleToModel(tool.uiVisibility)) continue;
    addTool(tool.name);
  }
  if (definition.exposeResources !== false) {
    for (const resource of entry.resources ?? []) addTool(`read_${resourceNameToToolName(resource.name)}`);
  }
  return names;
}
function ownedDirectToolNames(names, serverName, directNameOwners) {
  return names.filter(({ name, originalName }) => {
    const owner = directNameOwners.get(name);
    return owner?.serverName === serverName && owner.originalName === originalName;
  }).map(({ name }) => name);
}
function hasAllowedProxyTool(entry, serverName, definition, prefix, selectorIndex, toolName) {
  if (toolName === void 0) return true;
  const matchesAllowedName = (baseName) => {
    if (!isToolAllowed(baseName, serverName, prefix, definition.includeTools, definition.excludeTools, selectorIndex)) return false;
    return toolName === formatToolName(baseName, serverName, prefix);
  };
  if (entry.tools.some(
    (tool) => isUiToolVisibleToModel(tool.uiVisibility) && matchesAllowedName(tool.name)
  )) return true;
  if (definition.exposeResources === false) return false;
  return (entry.resources ?? []).some((resource) => {
    const baseName = `read_${resourceNameToToolName(resource.name)}`;
    return matchesAllowedName(baseName);
  });
}
function addName(names, seen, name) {
  if (seen.has(name)) return;
  seen.add(name);
  names.push(name);
}
function resolveKnownServerReference(parsed, config, cache, envOverride, collidingNamespaceNames, existingDirectNames, directNameOwners, selectorIndex, names, seen, diagnostics, snapshot) {
  const serverName = parsed.server;
  const definition = config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition)) {
    diagnostics.push(`MCP reference "${parsed.raw}" refers to disabled or unknown server "${serverName}"`);
    return;
  }
  const entry = resolveValidCache(definition, cache, serverName, snapshot);
  if (!entry) {
    diagnostics.push(`MCP reference "${parsed.raw}" cannot be resolved: no valid cached metadata for server "${serverName}"`);
    return;
  }
  const prefix = resolveToolPrefix(definition, config.settings?.toolPrefix);
  const selection = resolveDirectSelection(config, definition, serverName, envOverride);
  const directNames = ownedDirectToolNames(
    directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex, parsed.tool),
    serverName,
    directNameOwners
  );
  if (directNames.length > 0) {
    for (const name of directNames) addName(names, seen, name);
    return;
  }
  if (hasNamespaceProxy(config, cache, envOverride, collidingNamespaceNames, existingDirectNames, serverName, snapshot)) {
    if (hasAllowedProxyTool(entry, serverName, definition, prefix, selectorIndex, parsed.tool)) {
      addName(names, seen, namespaceProxyName(serverName));
      return;
    }
    diagnostics.push(`MCP reference "${parsed.raw}" refers to unknown or hidden tool "${parsed.tool}" on server "${serverName}"`);
    return;
  }
  diagnostics.push(`MCP reference "${parsed.raw}" resolves to no registered tool`);
}
function resolveBareToolReference(raw, toolName, config, cache, envOverride, collidingNamespaceNames, existingDirectNames, directNameOwners, selectorIndex, names, seen, diagnostics, snapshot) {
  let matched = false;
  for (const { serverName, definition, entry, prefix } of cachedServers(config, cache, snapshot)) {
    const selection = resolveDirectSelection(config, definition, serverName, envOverride);
    const directNames = ownedDirectToolNames(
      directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex, toolName),
      serverName,
      directNameOwners
    );
    for (const name of directNames) {
      addName(names, seen, name);
      matched = true;
    }
    if (hasNamespaceProxy(config, cache, envOverride, collidingNamespaceNames, existingDirectNames, serverName, snapshot) && hasAllowedProxyTool(entry, serverName, definition, prefix, selectorIndex, toolName)) {
      addName(names, seen, namespaceProxyName(serverName));
      matched = true;
    }
  }
  if (!matched) diagnostics.push(`MCP reference "${raw}" does not match a configured server or cached tool`);
}
function resolveMcpToolReferences(refs, config, cache, envOverride, snapshot) {
  const names = [];
  const diagnostics = [];
  const seen = /* @__PURE__ */ new Set();
  if (!config) {
    return {
      names: refs.filter((ref) => !ref.startsWith("mcp:")),
      diagnostics: refs.filter((ref) => ref.startsWith("mcp:")).map((ref) => `MCP reference "${ref}" cannot be resolved: no MCP config`)
    };
  }
  const catalog = snapshot ?? createMetadataCatalogSnapshot(config, cache);
  const effectiveCache = catalog.cache;
  const parsedOverride = envOverride ? parseDirectToolSelectors(envOverride) : null;
  const selectorIndex = allCurrentCandidates(config, effectiveCache, catalog);
  const directNameOwners = registeredDirectNames(config, effectiveCache, parsedOverride, selectorIndex, catalog);
  const directNames = new Set(directNameOwners.keys());
  const collidingNamespaceNames = namespaceCollisionNames(config, effectiveCache, parsedOverride, directNames, catalog);
  for (const ref of refs) {
    if (!ref.startsWith("mcp:")) {
      addName(names, seen, ref);
      continue;
    }
    const parsed = parseMcpReference(ref);
    if (!parsed.server) {
      diagnostics.push(`MCP reference "${ref}" is empty after the "mcp:" prefix`);
      continue;
    }
    if (config.mcpServers[parsed.server]) {
      resolveKnownServerReference(parsed, config, effectiveCache, parsedOverride, collidingNamespaceNames, directNames, directNameOwners, selectorIndex, names, seen, diagnostics, catalog);
    } else if (parsed.tool === void 0) {
      resolveBareToolReference(ref, parsed.server, config, effectiveCache, parsedOverride, collidingNamespaceNames, directNames, directNameOwners, selectorIndex, names, seen, diagnostics, catalog);
    } else {
      diagnostics.push(`MCP reference "${ref}" refers to unknown server "${parsed.server}"`);
    }
  }
  return { names, diagnostics };
}

// src/tools/namespace-tools.ts
function namespaceProxyCandidate(config, cache, envOverride, existingDirectNames, serverName, snapshot) {
  const definition = config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition)) return null;
  if (isMcpServerDirectlyRegistered(definition, config.settings, serverName, envOverride)) return null;
  const entry = snapshot ? snapshot.validEntries.get(serverName) : cache.servers?.[serverName];
  if (!entry || !snapshot && !isServerCacheValid(entry, definition) || !hasCallableCachedTargets(entry, definition)) return null;
  const toolName = namespaceProxyName(serverName);
  if (existingDirectNames.has(toolName)) return null;
  return {
    serverName,
    toolName,
    description: `Namespace-proxy for MCP server "${serverName}". Forwards \`{tool, args}\` through the adapter's executeCall, so it inherits the same auth / lifecycle / output-guard rules as the \`mcp\` proxy.`
  };
}
function filterCollidingNamespaceProxyTools(candidates) {
  const names = /* @__PURE__ */ new Map();
  for (const spec of candidates) {
    const colliding = names.get(spec.toolName) ?? [];
    colliding.push(spec);
    names.set(spec.toolName, colliding);
  }
  return candidates.filter((spec) => {
    const colliding = names.get(spec.toolName);
    if (colliding.length === 1) return true;
    if (colliding[0] === spec) {
      console.warn(`MCP: skipping namespace proxy "${spec.toolName}" because servers ${colliding.map(({ serverName }) => `"${serverName}"`).sort().join(", ")} normalize to the same name`);
    }
    return false;
  });
}
function resolveNamespaceProxyTools(config, cache, envOverride, existingDirectNames, unavailableServers, snapshot) {
  if (!config || !cache) return [];
  return filterCollidingNamespaceProxyTools(
    Object.keys(config.mcpServers).map((serverName) => namespaceProxyCandidate(config, cache, envOverride, existingDirectNames, serverName, snapshot)).filter((spec) => spec !== null)
  ).filter((spec) => !unavailableServers.has(spec.serverName));
}
function namespaceExecute(getState, ensureState, getInitPromise, serverName, getPiTools) {
  return async (_toolCallId, params, signal) => {
    if (typeof params.tool !== "string" || params.tool.length === 0) {
      return {
        content: [{ type: "text", text: `mcp__${serverName} requires a \`tool\` parameter naming the underlying MCP tool.` }],
        details: { error: "missing_tool", server: serverName }
      };
    }
    let state = getState();
    if (!state) {
      try {
        state = await (ensureState ? ensureState(signal) : getInitPromise());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `MCP initialization failed for ${serverName}: ${message}` }],
          details: { error: "init_failed", server: serverName, message }
        };
      }
    }
    if (!state) {
      return {
        content: [{ type: "text", text: `MCP not initialized for ${serverName}.` }],
        details: { error: "not_initialized", server: serverName }
      };
    }
    const { executeCall } = await import("./chunks/call-LROLQ6X4.js");
    return executeCall(
      state,
      params.tool,
      params.args ?? {},
      serverName,
      getPiTools,
      signal,
      "proxy"
    );
  };
}
var parameters = Type.Object({
  tool: Type.String({ description: "Underlying MCP tool name to call on this server." }),
  args: Type.Optional(Type.Object({}, {
    additionalProperties: true,
    description: "Arguments for the underlying tool. The exact shape depends on the tool being called; use mcp({ describe: 'server/tool' }) to inspect."
  }))
});
function createNamespaceRenderCall(renderOptions, serverName) {
  const renderCall = createMcpProxyToolCallRenderer(renderOptions);
  return (args, theme, context) => renderCall({
    ...args.tool !== void 0 ? { tool: args.tool } : {},
    ...args.args !== void 0 ? { args: args.args } : {},
    server: serverName
  }, theme, context);
}
function registerNamespaceProxyTool(input, spec, renderOptions, renderShell, renderResult) {
  input.pi.registerTool({
    name: spec.toolName,
    label: `MCP: ${spec.serverName}`,
    description: spec.description,
    promptSnippet: `MCP namespace proxy for ${spec.serverName}`,
    parameters,
    renderShell,
    renderCall: createNamespaceRenderCall(renderOptions, spec.serverName),
    renderResult,
    execute: namespaceExecute(
      input.getState,
      input.ensureState,
      input.getInitPromise,
      spec.serverName,
      input.getPiTools
    )
  });
}
function getActiveToolsForStaleCleanup(pi, staleNames) {
  if (staleNames.length === 0) return void 0;
  try {
    return pi.getActiveTools?.();
  } catch (error) {
    if (error instanceof Error && error.message.includes("Action methods cannot be called during extension loading")) return void 0;
    throw error;
  }
}
function deactivateStaleNamespaceTools(input, nextNames) {
  const activeDirectNames = input.activeDirectNames ?? /* @__PURE__ */ new Set();
  const staleNames = [...input.existingNamespaceNames].filter(
    (name) => !nextNames.has(name) && !activeDirectNames.has(name)
  );
  const deactivated = [];
  const unregisterTool = input.pi.unregisterTool;
  for (const stale2 of staleNames) {
    if (unregisterTool?.(stale2)) deactivated.push(stale2);
  }
  const activeTools = getActiveToolsForStaleCleanup(input.pi, staleNames);
  if (!activeTools) return deactivated;
  const stale = new Set(staleNames);
  const nextActiveTools = activeTools.filter((name) => !stale.has(name));
  if (nextActiveTools.length === activeTools.length) return deactivated;
  input.pi.setActiveTools(nextActiveTools);
  for (const name of staleNames) {
    if (!deactivated.includes(name)) deactivated.push(name);
  }
  return deactivated;
}
function syncNamespaceProxyTools(input) {
  const snapshot = input.catalogSnapshot ?? (input.config ? createMetadataCatalogSnapshot(input.config, input.cache) : void 0);
  const specs = resolveNamespaceProxyTools(
    input.config,
    snapshot?.cache ?? input.cache,
    input.envOverride,
    input.existingDirectNames,
    input.unavailableServers ?? /* @__PURE__ */ new Set(),
    snapshot
  );
  const nextNames = new Set(specs.map((s) => s.toolName));
  const result = { specs, added: [], updated: [], deactivated: [] };
  const renderOptions = input.renderOptions ?? resolveMcpToolRenderOptions();
  const renderShell = input.renderShell ?? (renderOptions.resultRendering === "compact" ? "self" : "default");
  const renderResult = input.renderResult ?? createMcpToolResultRenderer(renderOptions);
  for (const spec of specs) {
    registerNamespaceProxyTool(input, spec, renderOptions, renderShell, renderResult);
    (input.existingNamespaceNames.has(spec.toolName) ? result.updated : result.added).push(spec.toolName);
  }
  result.deactivated.push(...deactivateStaleNamespaceTools(input, nextNames));
  return result;
}

// src/extension/tool-surface.ts
function createExtensionToolSurface(dependencies) {
  const {
    pi,
    earlyConfig,
    envRaw,
    envDirectToolOverride,
    namespaceEnvOverride,
    toolRenderOptions,
    toolRenderShell,
    renderMcpToolResult: renderMcpToolResult2,
    getState,
    getInitPromise,
    ensureMcpState,
    loadDirectToolsModule,
    activeFailureServers,
    registerProxyTool
  } = dependencies;
  const registeredDirectTools = /* @__PURE__ */ new Map();
  const registeredNamespaceProxyTools = /* @__PURE__ */ new Set();
  const fallbackDeactivatedTools = /* @__PURE__ */ new Set();
  let proxyToolRegistered = false;
  let proxyToolDescription = null;
  const toToolParameters = (schema) => typeof Type2.Unsafe === "function" ? Type2.Unsafe(schema) : schema;
  function directToolFingerprint(spec) {
    return JSON.stringify({
      serverName: spec.serverName,
      originalName: spec.originalName,
      prefixedName: spec.prefixedName,
      description: spec.description,
      inputSchema: spec.inputSchema,
      resourceUri: spec.resourceUri,
      uiResourceUri: spec.uiResourceUri,
      uiStreamMode: spec.uiStreamMode
    });
  }
  function createLazyDirectToolExecutor(spec) {
    let executor = null;
    let loading = null;
    return (...args) => {
      if (executor) return executor(...args);
      loading ??= loadDirectToolsModule().then(({ createDirectToolExecutor }) => {
        const nextExecutor = createDirectToolExecutor(
          getState,
          getInitPromise,
          spec,
          (signal) => ensureMcpState(signal)
        );
        executor = nextExecutor;
        return nextExecutor;
      }).catch((error) => {
        loading = null;
        throw error;
      });
      return loading.then((nextExecutor) => nextExecutor(...args));
    };
  }
  function registerDirectTool(spec, config) {
    pi.registerTool({
      name: spec.prefixedName,
      label: `MCP: ${spec.originalName}`,
      description: spec.description || "(no description)",
      promptSnippet: truncateAtWord(spec.description, 100) || `MCP tool from ${spec.serverName}`,
      parameters: toToolParameters(normalizeDirectToolInputSchema(spec.inputSchema)),
      ...config.settings?.strictDirectToolArguments === true ? { prepareArguments: (args) => prepareDirectToolArguments(spec.inputSchema, args) } : {},
      execute: createLazyDirectToolExecutor(spec),
      renderShell: toolRenderShell,
      renderCall: createMcpDirectToolCallRenderer(spec.prefixedName, toolRenderOptions),
      renderResult: renderMcpToolResult2
    });
  }
  function getActiveToolsIfReady() {
    try {
      return pi.getActiveTools?.();
    } catch (error) {
      if (error instanceof Error && error.message.includes("Action methods cannot be called during extension loading")) return void 0;
      throw error;
    }
  }
  function deactivateTools(toolNames) {
    if (toolNames.length === 0) return [];
    const unregisterTool = pi.unregisterTool;
    const unregistered = toolNames.filter((toolName) => unregisterTool?.(toolName) === true);
    const fallbackNames = toolNames.filter((toolName) => !unregistered.includes(toolName));
    const remove = new Set(toolNames);
    const activeTools = getActiveToolsIfReady();
    if (!activeTools || activeTools.length === 0) {
      for (const toolName of fallbackNames) fallbackDeactivatedTools.add(toolName);
      return unregistered;
    }
    const nextActiveTools = activeTools.filter((name) => !remove.has(name));
    if (nextActiveTools.length !== activeTools.length) {
      for (const toolName of fallbackNames) fallbackDeactivatedTools.add(toolName);
      pi.setActiveTools(nextActiveTools);
    }
    return unregistered;
  }
  function syncDirectTools(config, snapshot) {
    const reservedDirectNames = /* @__PURE__ */ new Set();
    const prefix = config.settings?.toolPrefix ?? "server";
    const specs = envRaw === "__none__" ? [] : resolveDirectTools(config, snapshot.cache, prefix, envDirectToolOverride, activeFailureServers(), reservedDirectNames, snapshot);
    const nextNames = new Set(specs.map((spec) => spec.prefixedName));
    const added = [];
    const updated = [];
    const deactivated = [];
    for (const spec of specs) {
      const fingerprint = directToolFingerprint(spec);
      const previous = registeredDirectTools.get(spec.prefixedName);
      if (previous !== fingerprint) {
        registerDirectTool(spec, config);
        registeredDirectTools.set(spec.prefixedName, fingerprint);
        if (fallbackDeactivatedTools.delete(spec.prefixedName)) {
          const activeTools = getActiveToolsIfReady();
          if (activeTools && !activeTools.includes(spec.prefixedName)) {
            pi.setActiveTools([...activeTools, spec.prefixedName]);
          }
        }
        (previous ? updated : added).push(spec.prefixedName);
      }
    }
    for (const toolName of [...registeredDirectTools.keys()]) {
      if (nextNames.has(toolName)) continue;
      registeredDirectTools.delete(toolName);
      deactivated.push(toolName);
    }
    deactivateTools(deactivated);
    return { specs, reservedDirectNames, activeDirectNames: nextNames, added, updated, deactivated };
  }
  function syncNamespaceTools(config, snapshot, reservedDirectNames = new Set(registeredDirectTools.keys()), activeDirectNames = new Set(registeredDirectTools.keys())) {
    const result = syncNamespaceProxyTools({
      config,
      cache: snapshot.cache,
      catalogSnapshot: snapshot,
      envOverride: namespaceEnvOverride,
      existingDirectNames: reservedDirectNames,
      activeDirectNames,
      existingNamespaceNames: registeredNamespaceProxyTools,
      unavailableServers: activeFailureServers(),
      pi,
      getState,
      ensureState: (signal) => ensureMcpState(signal),
      getInitPromise,
      getPiTools: () => pi.getAllTools(),
      renderOptions: toolRenderOptions,
      renderShell: toolRenderShell,
      renderResult: renderMcpToolResult2
    });
    for (const name of result.added) registeredNamespaceProxyTools.add(name);
    for (const name of result.deactivated) registeredNamespaceProxyTools.delete(name);
  }
  function applyDirectToolConfigChanges(changes) {
    const state = getState();
    if (!state) return;
    for (const [serverName, value] of changes) {
      const definition = state.config.mcpServers[serverName];
      if (!definition) continue;
      state.config.mcpServers[serverName] = { ...definition, directTools: value };
    }
  }
  function syncProxyTool(config, snapshot, directSpecs) {
    const missingConfiguredDirectToolServers = getMissingConfiguredDirectToolServers(
      config,
      snapshot.cache,
      envRaw === void 0 || envRaw === "__none__" ? void 0 : envDirectToolOverride,
      snapshot
    );
    const shouldRegisterProxyTool = config.settings?.disableProxyTool !== true || directSpecs.length === 0 || missingConfiguredDirectToolServers.length > 0;
    if (shouldRegisterProxyTool) {
      const description = buildProxyDescription(config);
      if (!proxyToolRegistered || proxyToolDescription !== description) {
        registerProxyTool(description);
        proxyToolRegistered = true;
        proxyToolDescription = description;
        return;
      }
      const activeTools = getActiveToolsIfReady();
      if (activeTools && !activeTools.includes("mcp")) {
        pi.setActiveTools([...activeTools, "mcp"]);
      }
      return;
    }
    if (proxyToolRegistered) {
      const unregistered = deactivateTools(["mcp"]);
      if (unregistered.includes("mcp")) {
        proxyToolRegistered = false;
        proxyToolDescription = null;
      }
    }
  }
  function syncToolSurface(ctx) {
    const config = getState()?.config ?? earlyConfig;
    const snapshot = createMetadataCatalogSnapshot(config, loadMetadataCache());
    const result = syncDirectTools(config, snapshot);
    syncProxyTool(config, snapshot, result.specs);
    syncNamespaceTools(config, snapshot, result.reservedDirectNames, result.activeDirectNames);
    const changed = result.added.length + result.updated.length + result.deactivated.length;
    if (changed > 0 && ctx?.hasUI) {
      ctx.ui.notify(
        `MCP: direct tools refreshed (+${result.added.length}, ~${result.updated.length}, -${result.deactivated.length})`,
        "info"
      );
    }
  }
  return {
    applyDirectToolConfigChanges,
    syncDirectTools,
    syncNamespaceTools,
    syncProxyTool,
    syncToolSurface
  };
}

// src/extension/session.ts
var INIT_WAIT_TIMEOUT_MS = 3e4;
var INIT_FAILURE_MESSAGE_MAX_CHARS = 1e3;
var INIT_WAIT_TIMED_OUT = /* @__PURE__ */ Symbol("init-wait-timed-out");
function snapshotExtensionContext(ctx, signalOverride) {
  const hasUI = ctx?.hasUI === true;
  const snapshot = {
    cwd: ctx?.cwd ?? process.cwd(),
    hasUI,
    mode: ctx?.mode ?? "print"
  };
  if (hasUI && ctx?.ui !== void 0) snapshot.ui = ctx.ui;
  if (ctx?.model !== void 0) snapshot.model = ctx.model;
  if (ctx?.modelRegistry !== void 0) snapshot.modelRegistry = ctx.modelRegistry;
  const signal = signalOverride ?? ctx?.signal;
  if (signal !== void 0) snapshot.signal = signal;
  return snapshot;
}
async function awaitWithTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(INIT_WAIT_TIMED_OUT), timeoutMs);
        timer.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// src/extension/install.ts
var runtimeRegistrars = /* @__PURE__ */ new WeakMap();
function optionalNumber(options) {
  const number = Type3.Number;
  return typeof number === "function" ? Type3.Optional(number(options)) : { type: "number", ...options };
}
function parseEnvDirectToolOverride(raw) {
  return raw?.split(",").map((s) => s.trim()).filter(Boolean);
}
function resolveNamespaceEnvOverride(raw, selectors) {
  if (raw === "__none__") return { servers: /* @__PURE__ */ new Set(), tools: /* @__PURE__ */ new Map() };
  return selectors ? parseDirectToolSelectors(selectors) : null;
}
function installMcpAdapter(pi, options) {
  const sessionConfig = options.config !== void 0 ? cloneMcpConfig(options.config) : void 0;
  const programmaticConfig = sessionConfig !== void 0;
  let state = null;
  let initPromise = null;
  let currentOwner = null;
  let currentInitializationContext = null;
  let lifecycleGeneration = 0;
  let retainedInitFailure = null;
  let initModulePromise = null;
  let oauthFlowModulePromise = null;
  let commandsModulePromise = null;
  let proxyModesModulePromise = null;
  let mcpCodeModulePromise = null;
  let directToolsModulePromise = null;
  let configWriteModulePromise = null;
  const loadInitModule = () => initModulePromise ??= import("./chunks/initialization-QWDGRTUG.js");
  const loadOAuthFlowModule = () => oauthFlowModulePromise ??= import("./chunks/mcp-auth-flow-XTCYFOQW.js");
  const loadCommandsModule = () => commandsModulePromise ??= import("./chunks/handlers-2TLR4YXN.js");
  const loadProxyModesModule = () => proxyModesModulePromise ??= import("./chunks/dispatcher-7XHUVNIJ.js");
  const loadMcpCodeModule = () => mcpCodeModulePromise ??= import("./chunks/mcp-code-N3URALK3.js");
  const loadDirectToolsModule = () => directToolsModulePromise ??= import("./chunks/direct-tools-XOJR7Z3Z.js");
  const loadConfigWriteModule = () => configWriteModulePromise ??= import("./chunks/write-V2O5KVWN.js");
  function retainInitFailure(error) {
    const message = truncateAtWord(formatTerminalError(error), INIT_FAILURE_MESSAGE_MAX_CHARS);
    retainedInitFailure = message;
    return message;
  }
  function clearRetainedInitFailure() {
    retainedInitFailure = null;
  }
  function buildInitRetryInstruction(prefix, failure = retainedInitFailure) {
    const retry = "Fix the MCP server configuration or startup failure, then call mcp(...) again to retry initialization.";
    return failure ? `${prefix}: ${failure}. ${retry}` : `${prefix}. ${retry}`;
  }
  function isOwnerAbortError(error, owner) {
    if (!owner.signal.aborted) return isAbortError(error);
    const reason = owner.signal.reason;
    if (reason instanceof Error && reason.message === "MCP initialization failed" && error !== reason) {
      return isAbortError(error);
    }
    return true;
  }
  function startGatewayRetryInitialization(ctx) {
    const generation = ++lifecycleGeneration;
    const owner = createMcpRuntimeOwner();
    currentOwner = owner;
    currentInitializationContext = snapshotExtensionContext(ctx);
    state = null;
    startInitialization(ctx, owner, generation, "stale_gateway_retry_initialization");
  }
  async function shutdownState(currentState, reason) {
    if (!currentState) {
      publishMcpStatusShutdown(pi.events);
      return;
    }
    publishMcpStatusShutdown(currentState.statusEvents);
    if (currentState.uiServer) {
      currentState.uiServer.close(reason);
      currentState.uiServer = null;
    }
    let flushError;
    try {
      const { flushMetadataCache } = await loadInitModule();
      flushMetadataCache(currentState);
    } catch (error) {
      flushError = error;
    }
    try {
      if (currentState.owner) {
        await currentState.owner.stop(reason);
      } else {
        await currentState.lifecycle.gracefulShutdown();
      }
    } catch (error) {
      if (flushError) {
        console.error(`MCP: graceful shutdown failed after metadata flush error: ${formatTerminalError(error)}`);
      } else {
        throw error;
      }
    }
    if (flushError) {
      throw flushError;
    }
  }
  const earlyConfigPath = programmaticConfig ? void 0 : options.configPath ?? getConfigPathFromArgv();
  const earlyConfig = programmaticConfig ? cloneMcpConfig(sessionConfig) : loadMcpConfig(earlyConfigPath);
  const earlyCatalogSnapshot = createMetadataCatalogSnapshot(earlyConfig, loadMetadataCache());
  const envRaw = process.env.MCP_DIRECT_TOOLS;
  const envDirectToolOverride = parseEnvDirectToolOverride(envRaw);
  const namespaceEnvOverride = resolveNamespaceEnvOverride(envRaw, envDirectToolOverride);
  const toolRenderOptions = resolveMcpToolRenderOptions(earlyConfig.settings);
  const toolRenderShell = toolRenderOptions.resultRendering === "compact" ? "self" : "default";
  const renderMcpToolResult2 = createMcpToolResultRenderer(toolRenderOptions);
  let directToolsFrozen = false;
  const runtimeServers = /* @__PURE__ */ new Map();
  function attachRuntimeServerLifecycle(targetState, name, definition) {
    const lifecycleMode = definition.lifecycle ?? "lazy";
    const persistsAfterFirstSpawn = lifecycleMode === "eager" || lifecycleMode === "lazy-keep-alive";
    const idleOverride = definition.idleTimeout ?? (persistsAfterFirstSpawn ? 0 : void 0);
    targetState.lifecycle.registerServer(name, definition, idleOverride !== void 0 ? { idleTimeout: idleOverride } : void 0);
    if (lifecycleMode === "keep-alive") targetState.lifecycle.markKeepAlive(name, definition);
  }
  const toolSurface = createExtensionToolSurface({
    pi,
    earlyConfig,
    envRaw,
    envDirectToolOverride,
    namespaceEnvOverride,
    toolRenderOptions,
    toolRenderShell,
    renderMcpToolResult: renderMcpToolResult2,
    getState: () => state,
    getInitPromise: () => initPromise,
    ensureMcpState: (signal) => ensureMcpState(signal),
    loadDirectToolsModule,
    activeFailureServers: () => {
      const currentState = state;
      if (!currentState) return /* @__PURE__ */ new Set();
      return new Set(Object.keys(currentState.config.mcpServers).filter((serverName) => isServerInActiveFailureBackoff(currentState, serverName)));
    },
    registerProxyTool
  });
  function applyDirectToolConfigChanges(changes) {
    toolSurface.applyDirectToolConfigChanges(changes);
  }
  function syncToolSurface(ctx) {
    toolSurface.syncToolSurface(ctx);
  }
  const registeredPromptCommands = /* @__PURE__ */ new Set();
  function registerPromptCommands(specs) {
    for (const spec of specs) {
      if (registeredPromptCommands.has(spec.commandName)) {
        logger.debug(`MCP: prompt "${spec.originalName}" on ${spec.serverName} skipped; /${spec.commandName} is already registered`);
        continue;
      }
      registeredPromptCommands.add(spec.commandName);
      pi.registerCommand(spec.commandName, createPromptCommand(pi, () => state, spec, (signal) => ensureMcpState(signal)));
    }
  }
  function syncPromptCommands() {
    registerPromptCommands([...state?.promptMetadata?.values() ?? []].flat());
  }
  registerPromptCommands(resolveCachedPrompts(earlyConfig, earlyCatalogSnapshot));
  runtimeRegistrars.set(pi, (name, definition) => {
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error("MCP server name must be a non-empty string");
    }
    if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
      throw new Error(`MCP server definition for "${name}" must be an object`);
    }
    const effective = state?.config ?? earlyConfig;
    if (runtimeServers.has(name) || Object.hasOwn(effective.mcpServers, name)) {
      throw new Error(`MCP server "${name}" is already registered`);
    }
    const entry = { ...structuredClone(definition), directTools: false };
    runtimeServers.set(name, entry);
    const registeredState = state;
    if (registeredState) {
      registeredState.config.mcpServers[name] = entry;
      attachRuntimeServerLifecycle(registeredState, name, entry);
      syncToolSurface();
      void updateMcpStatus(registeredState).catch((error) => {
        console.error(`MCP: failed to update status after runtime registration: ${formatTerminalError(error)}`);
      });
    }
    let disposed = false;
    return {
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        runtimeServers.delete(name);
        const currentState = state;
        if (!currentState || currentState.config.mcpServers[name] !== entry) return;
        delete currentState.config.mcpServers[name];
        currentState.lifecycle.unregisterServer(name);
        await currentState.manager.close(name);
        syncToolSurface();
        await updateMcpStatus(currentState);
      }
    };
  });
  const getPiTools = () => pi.getAllTools();
  async function updateMcpStatus(targetState) {
    const { updateStatusBar } = await loadInitModule();
    updateStatusBar(targetState);
  }
  pi.registerFlag("mcp-config", {
    description: "Path to MCP config file",
    type: "string"
  });
  function startInitialization(ctx, owner, generation, staleReason) {
    const initializationContext = snapshotExtensionContext(ctx);
    if (currentOwner === owner) currentInitializationContext = initializationContext;
    owner.addCleanup(async () => {
      const { cleanupMaterializedBinaryResources } = await import("./chunks/tool-registrar-DYALFWRO.js");
      cleanupMaterializedBinaryResources(owner.signal);
    });
    const promise = Promise.all([loadOAuthFlowModule(), loadInitModule()]).then(([oauthFlow, initModule]) => {
      const oauthRuntime = oauthFlow.createOAuthRuntime(owner.signal);
      owner.addCleanup(() => oauthFlow.shutdownOAuth(oauthRuntime));
      return initModule.initializeMcp(pi, initializationContext, owner, {
        ...programmaticConfig || options.configPath !== void 0 ? {
          ...earlyConfigPath !== void 0 ? { configPath: earlyConfigPath } : {},
          ...sessionConfig !== void 0 ? { config: sessionConfig } : {}
        } : {},
        oauthRuntime
      });
    });
    initPromise = promise;
    return promise.then(async (nextState) => {
      if (!owner.isActive() || generation !== lifecycleGeneration || initPromise !== promise) {
        try {
          await shutdownState(nextState, staleReason);
        } catch (error) {
          console.error(`MCP: failed to clean stale initialization state: ${formatTerminalError(error)}`);
        }
        return;
      }
      state = nextState;
      clearRetainedInitFailure();
      for (const [name, definition] of runtimeServers) {
        if (Object.hasOwn(nextState.config.mcpServers, name)) {
          console.error(`MCP: runtime-registered server "${name}" now collides with a configured server; keeping the configured server`);
          continue;
        }
        nextState.config.mcpServers[name] = definition;
        attachRuntimeServerLifecycle(nextState, name, definition);
      }
      nextState.onToolMetadataUpdated = (_serverName, _reason) => {
        if (state !== nextState || !owner.isActive()) return;
        syncPromptCommands();
        if (directToolsFrozen) {
          logger.debug(`MCP: metadata update for ${_serverName} (${_reason}) skipped \u2014 directTools frozen`);
          return;
        }
        syncToolSurface(initializationContext);
      };
      syncPromptCommands();
      syncToolSurface(initializationContext);
      nextState.statusEvents = pi.events;
      await updateMcpStatus(nextState);
      initPromise = null;
      if (earlyConfig.settings?.freezeDirectTools === true) {
        directToolsFrozen = true;
        logger.info(`MCP: direct tools frozen after initial sync \u2014 reconnects won't rebuild the system prompt; use mcp({ connect: "server" }) to rediscover`);
      }
    }).catch(async (err) => {
      if (!owner.isActive() || generation !== lifecycleGeneration) {
        return;
      }
      if (initPromise !== promise && initPromise !== null) {
        return;
      }
      const message = retainInitFailure(err);
      console.error(`MCP initialization failed: ${message}`);
      initPromise = null;
      if (state) return;
      try {
        await owner.stop("MCP initialization failed");
      } catch (error) {
        console.error(`MCP: failed to clean rejected initialization: ${formatTerminalError(error)}`);
      }
    });
  }
  function ensureMcpState(signal, context) {
    if (state) return Promise.resolve(state);
    if (initPromise) return initPromise;
    if (retainedInitFailure) {
      startGatewayRetryInitialization(snapshotExtensionContext(
        context ?? currentInitializationContext ?? void 0,
        signal
      ));
      return initPromise;
    }
    let owner = currentOwner;
    let generation = lifecycleGeneration;
    if (!owner?.isActive()) {
      owner = createMcpRuntimeOwner();
      currentOwner = owner;
      generation = ++lifecycleGeneration;
    }
    const initializationContext = snapshotExtensionContext(
      context ?? currentInitializationContext ?? void 0,
      signal
    );
    currentInitializationContext = initializationContext;
    startInitialization(initializationContext, owner, generation, "stale_deferred_initialization");
    return initPromise;
  }
  function hasValidMetadataCache(config, snapshot) {
    if (!snapshot.cache) return false;
    return Object.entries(config.mcpServers).every(([serverName, definition]) => definition.disabled === true || snapshot.validEntries.has(serverName));
  }
  function shouldInitializeOnSessionStart() {
    if (runtimeServers.size > 0) return true;
    const hasStartupServer = Object.values(earlyConfig.mcpServers).some((definition) => {
      if (definition.disabled === true) return false;
      return definition.lifecycle === "eager" || definition.lifecycle === "keep-alive";
    });
    if (hasStartupServer) return true;
    const snapshot = createMetadataCatalogSnapshot(earlyConfig, loadMetadataCache());
    if (!hasValidMetadataCache(earlyConfig, snapshot)) return true;
    if (envRaw !== void 0 && envRaw !== "__none__") {
      return getMissingConfiguredDirectToolServers(earlyConfig, snapshot.cache, envDirectToolOverride, snapshot).length > 0;
    }
    return false;
  }
  function startLoadTimeInitialization() {
    const hasStartupServer = Object.values(earlyConfig.mcpServers).some((definition) => {
      if (definition.disabled === true) return false;
      return definition.lifecycle === "eager" || definition.lifecycle === "keep-alive";
    });
    if (!hasStartupServer) return;
    setImmediate(() => {
      if (lifecycleGeneration !== 0 || state || initPromise) return;
      const generation = ++lifecycleGeneration;
      const owner = createMcpRuntimeOwner();
      currentOwner = owner;
      const context = snapshotExtensionContext(void 0);
      currentInitializationContext = context;
      startInitialization(context, owner, generation, "stale_load_time_initialization");
    });
  }
  pi.on("session_start", async (_event, ctx) => {
    const generation = ++lifecycleGeneration;
    const previousState = state;
    const previousOwner = currentOwner;
    const owner = createMcpRuntimeOwner();
    currentOwner = owner;
    currentInitializationContext = snapshotExtensionContext(ctx);
    state = null;
    initPromise = null;
    clearRetainedInitFailure();
    const stopPrevious = previousOwner?.stop("MCP extension session restarted") ?? Promise.resolve();
    try {
      await Promise.all([
        stopPrevious,
        shutdownState(previousState, "session_restart")
      ]);
    } catch (error) {
      console.error(`MCP: failed to shut down previous session state: ${formatTerminalError(error)}`);
    }
    if (generation !== lifecycleGeneration || !owner.isActive()) return;
    const initialization = shouldInitializeOnSessionStart() ? startInitialization(currentInitializationContext, owner, generation, "stale_session_start") : null;
    if (initialization && envRaw !== void 0 && envRaw !== "__none__") {
      const missingEnvDirectTools = getMissingConfiguredDirectToolServers(
        earlyConfig,
        loadMetadataCache(),
        envDirectToolOverride
      );
      if (missingEnvDirectTools.length > 0) {
        await initialization;
      }
    }
  });
  pi.on("input", async () => {
    const inputOwner = currentOwner;
    if (!inputOwner?.isActive()) return;
    if (!state && initPromise) {
      try {
        await awaitWithTimeout(initPromise, INIT_WAIT_TIMEOUT_MS);
      } catch {
        return;
      }
    }
    const inputState = state;
    if (!inputState || !inputOwner.isActive()) return;
    try {
      await inputState.lifecycle.ensureConverged(inputOwner.signal);
    } catch (error) {
      if (!isAbortError(error, inputOwner.signal)) {
        logger.debug(`MCP: keep-alive convergence failed before input: ${formatTerminalError(error)}`);
      }
    }
  });
  pi.on("session_shutdown", async () => {
    ++lifecycleGeneration;
    const currentState = state;
    const owner = currentOwner;
    currentOwner = null;
    currentInitializationContext = null;
    state = null;
    initPromise = null;
    clearRetainedInitFailure();
    const stopOwner = owner?.stop("MCP extension session shutdown") ?? Promise.resolve();
    try {
      await Promise.all([
        stopOwner,
        shutdownState(currentState, "session_shutdown")
      ]);
    } catch (error) {
      console.error(`MCP: session shutdown cleanup failed: ${formatTerminalError(error)}`);
    }
  });
  pi.on("tool_result", (event) => toolErrorOverride(event.details));
  const registerMcpCommand = (commandName) => pi.registerCommand(commandName, {
    description: "Show MCP server status",
    getArgumentCompletions: (prefix) => {
      const normalized = prefix.trimStart();
      const argumentMatch = normalized.match(/^(\S+)\s+(.*)$/);
      if (!argumentMatch) {
        const subcommands = [
          { value: "reconnect", label: "reconnect \u2014 Reconnect servers" },
          { value: "tools", label: "tools \u2014 List all tools" },
          { value: "prompts", label: "prompts \u2014 List all MCP prompts" },
          { value: "setup", label: "setup \u2014 Configure MCP servers" },
          { value: "logout", label: "logout \u2014 Clear server credentials" },
          { value: "token", label: "token \u2014 Manage stored bearer tokens" },
          { value: "disable", label: "disable \u2014 Disable a server" },
          { value: "enable", label: "enable \u2014 Enable a server" },
          { value: "status", label: "status \u2014 Show server status" }
        ].filter(({ value }) => value.startsWith(normalized));
        return subcommands.length > 0 ? subcommands : null;
      }
      const [, subcommand, argumentPrefix] = argumentMatch;
      if (subcommand !== "reconnect" && subcommand !== "logout" && subcommand !== "disable" && subcommand !== "enable" && subcommand !== "token" || argumentPrefix === void 0 || !state) return null;
      if (subcommand === "token") {
        const tokenMatch = argumentPrefix.trimStart().match(/^(set|remove|status)\s+(.*)$/);
        if (!tokenMatch) {
          const actions = ["set", "remove", "status"].filter((action2) => action2.startsWith(argumentPrefix.trimStart())).map((action2) => ({ value: `token ${action2} `, label: `${action2} \u2014 Bearer token ${action2}` }));
          return actions.length > 0 ? actions : null;
        }
        const action = tokenMatch[1] ?? "";
        const serverPrefix = tokenMatch[2] ?? "";
        const servers2 = Object.keys(state.config.mcpServers).filter((serverName) => serverName.startsWith(serverPrefix.trimStart())).map((serverName) => ({ value: `token ${action} ${serverName}`, label: serverName }));
        return servers2.length > 0 ? servers2 : null;
      }
      const servers = Object.keys(state.config.mcpServers).filter((serverName) => serverName.startsWith(argumentPrefix.trimStart())).map((serverName) => ({ value: `${subcommand} ${serverName}`, label: serverName }));
      return servers.length > 0 ? servers : null;
    },
    handler: async (args, ctx) => {
      const commandOwner = currentOwner;
      const commandReload = typeof ctx.reload === "function" ? ctx.reload.bind(ctx) : async () => {
      };
      const commandHasUI = ctx.hasUI;
      const commandCtx = {
        hasUI: commandHasUI,
        ui: commandHasUI ? commandOwner ? createOwnedUi(ctx.ui, commandOwner) : ctx.ui : void 0,
        cwd: ctx.cwd,
        mode: ctx.mode,
        signal: commandOwner?.signal ?? ctx.signal
      };
      if (!state) {
        try {
          state = await ensureMcpState(commandCtx.signal, commandCtx);
          commandOwner?.throwIfInactive();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (commandCtx.hasUI) commandCtx.ui?.notify(`MCP initialization failed: ${message}`, "error");
          return;
        }
      }
      if (!state) {
        if (commandCtx.hasUI) commandCtx.ui?.notify("MCP not initialized", "error");
        return;
      }
      const {
        showStatus,
        showTools,
        showPrompts,
        reconnectServer,
        reconnectServers,
        authenticateServer,
        logoutServer,
        manageBearerToken,
        openMcpAuthPanel,
        openMcpPanel,
        openMcpSetup
      } = await loadCommandsModule();
      const parts = args?.trim()?.split(/\s+/) ?? [];
      const subcommand = parts[0] ?? "";
      const targetServer = parts[1];
      const rest = parts.slice(1).join(" ");
      switch (subcommand) {
        case "reconnect":
          commandOwner?.throwIfInactive();
          await reconnectServers(state, commandCtx, targetServer);
          if (directToolsFrozen) syncToolSurface(commandCtx);
          break;
        case "tools":
          await showTools(state, commandCtx);
          break;
        case "prompts":
          await showPrompts(state, commandCtx);
          break;
        case "setup": {
          commandOwner?.throwIfInactive();
          if (programmaticConfig) {
            commandCtx.ui?.notify("MCP setup is unavailable when config is supplied by createMcpAdapter().", "info");
            break;
          }
          const result = await openMcpSetup(state, pi, commandCtx, earlyConfigPath, "setup");
          if (result?.configChanged) {
            commandOwner?.throwIfInactive();
            await commandReload();
            return;
          }
          break;
        }
        case "logout": {
          const serverName = rest;
          if (!serverName) {
            if (commandCtx.hasUI) commandCtx.ui?.notify("Usage: /mcp logout <server>", "error");
            return;
          }
          commandOwner?.throwIfInactive();
          await logoutServer(serverName, state, commandCtx);
          break;
        }
        case "token": {
          const action = parts[1];
          const serverName = parts.slice(2).join(" ");
          if (action !== "set" && action !== "remove" && action !== "status") {
            if (commandCtx.hasUI) commandCtx.ui?.notify("Usage: /mcp token set|remove|status <server>", "error");
            return;
          }
          if (!serverName) {
            if (commandCtx.hasUI) commandCtx.ui?.notify("Usage: /mcp token set|remove|status <server>", "error");
            return;
          }
          commandOwner?.throwIfInactive();
          await manageBearerToken(action, serverName, state, commandCtx);
          break;
        }
        case "disable":
        case "enable": {
          const serverName = rest;
          if (programmaticConfig) {
            commandCtx.ui?.notify(`/mcp ${subcommand} is unavailable when config is supplied by createMcpAdapter().`, "info");
            break;
          }
          if (!serverName) {
            commandCtx.ui?.notify(`Usage: /mcp ${subcommand} <server>`, "error");
            break;
          }
          if (!state.config.mcpServers[serverName]) {
            commandCtx.ui?.notify(`Server "${serverName}" not found in effective config`, "error");
            break;
          }
          commandOwner?.throwIfInactive();
          const { writeProjectServerDisabledOverride } = await loadConfigWriteModule();
          const result = writeProjectServerDisabledOverride(earlyConfigPath, commandCtx.cwd, serverName, subcommand === "disable");
          if (result.changed) {
            commandCtx.ui?.notify(`${subcommand === "disable" ? "Disabled" : "Enabled"} server "${serverName}" in ${result.path} \u2014 run /reload to apply`, "info");
          } else {
            commandCtx.ui?.notify(`Server "${serverName}" is already ${subcommand === "disable" ? "disabled" : "enabled"}`, "info");
          }
          break;
        }
        case "status":
        case "":
        default:
          if (commandCtx.hasUI) {
            commandOwner?.throwIfInactive();
            if (programmaticConfig) {
              commandCtx.ui?.notify("MCP status is shown from the in-memory SDK config; configuration discovery is unavailable.", "info");
              await showStatus(state, commandCtx);
              break;
            }
            const result = await openMcpPanel(state, pi, commandCtx, earlyConfigPath, (changes) => {
              applyDirectToolConfigChanges(changes);
              syncToolSurface(commandCtx);
            });
            if (result?.configChanged) {
              commandOwner?.throwIfInactive();
              await commandReload();
              return;
            }
          } else {
            await showStatus(state, commandCtx);
          }
          break;
      }
    }
  });
  registerMcpCommand("mcp");
  registerMcpCommand("pi-mcp");
  pi.registerCommand("mcp-auth", {
    description: "Authenticate with an MCP server (OAuth)",
    handler: async (args, ctx) => {
      const commandOwner = currentOwner;
      const commandHasUI = ctx.hasUI;
      const commandCtx = {
        hasUI: commandHasUI,
        ui: commandHasUI ? commandOwner ? createOwnedUi(ctx.ui, commandOwner) : ctx.ui : void 0,
        cwd: ctx.cwd,
        mode: ctx.mode,
        signal: commandOwner?.signal ?? ctx.signal
      };
      const serverName = args?.trim();
      if (!serverName && !commandCtx.hasUI) {
        return;
      }
      if (!state) {
        try {
          state = await ensureMcpState(commandCtx.signal, commandCtx);
          commandOwner?.throwIfInactive();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (commandCtx.hasUI) commandCtx.ui?.notify(`MCP initialization failed: ${message}`, "error");
          return;
        }
      }
      if (!state) {
        if (commandCtx.hasUI) commandCtx.ui?.notify("MCP not initialized", "error");
        return;
      }
      const { authenticateServer, reconnectServer, openMcpAuthPanel } = await loadCommandsModule();
      if (!serverName) {
        if (programmaticConfig) {
          commandCtx.ui?.notify("Use /mcp-auth <server> to authenticate a server from the in-memory SDK config.", "info");
          return;
        }
        await openMcpAuthPanel(state, pi, commandCtx, earlyConfigPath);
        return;
      }
      const result = await authenticateServer(serverName, state.config, commandCtx, commandCtx.signal, state.oauthRuntime);
      if (result.ok) {
        commandOwner?.throwIfInactive();
        await reconnectServer(state, commandCtx, serverName);
      }
    }
  });
  if (earlyConfig.settings?.scriptMode !== false) {
    pi.registerTool({
      name: "mcpScript",
      label: "MCP Script",
      description: "Run trusted JavaScript that makes multiple MCP tool calls in one request \u2014 loop, filter, chain, or fan out between calls. For a single MCP call, search, describe, status check, or auth action, use the mcp tool instead. Discover with await tools.search({ query }) \u2014 resolves to { items: [{ path, name, server, description? }], total, hasMore, nextOffset }, not an { ok, data } envelope. Inspect with await tools.describe({ path }) \u2014 resolves to the tool descriptor with inputTypeScript, or { path, error: { code, message, suggestions } }. Then call tools.call(path, args) \u2014 resolves to { ok: true, data } or { ok: false, error: { code, message } } \u2014 or use direct flat calls when the name is already known; use emit(value) for user-visible output. Load the mcp-scripting skill for the full workflow guide.",
      promptSnippet: "Batch multiple MCP tool calls in one JavaScript request (loop, filter, chain)",
      parameters: Type3.Object({
        code: Type3.String({ description: "Trusted JavaScript MCP script. Use tools.<prefixedToolName>(args) and emit(value)." }),
        timeoutMs: optionalNumber({ minimum: 1, description: "Execution timeout in milliseconds (default: 30000)" })
      }),
      renderCall: createMcpScriptToolCallRenderer(toolRenderOptions),
      renderResult: renderMcpToolResult2,
      async execute(_toolCallId, params, signal) {
        const executeOwner = currentOwner;
        let initialization = initPromise;
        if (!state && !initialization) {
          try {
            initialization = ensureMcpState(signal);
          } catch (error) {
            if (executeOwner && isOwnerAbortError(error, executeOwner)) throw error;
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text", text: `MCP initialization failed: ${message}` }],
              details: { mode: "script", error: "init_failed", message }
            };
          }
        }
        if (!state && initialization) {
          try {
            const initialized = await awaitWithTimeout(initialization, INIT_WAIT_TIMEOUT_MS);
            if (initialized === INIT_WAIT_TIMED_OUT) {
              return {
                content: [{ type: "text", text: "MCP initialization is still in progress. Try again shortly." }],
                details: { mode: "script", error: "init_timeout", timeoutMs: INIT_WAIT_TIMEOUT_MS }
              };
            }
            executeOwner?.throwIfInactive();
            state = initialized;
          } catch (error) {
            if (executeOwner && isOwnerAbortError(error, executeOwner)) throw error;
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text", text: `MCP initialization failed: ${message}` }],
              details: { mode: "script", error: "init_failed", message }
            };
          }
        }
        if (!state) {
          return {
            content: [{ type: "text", text: retainedInitFailure ? buildInitRetryInstruction("MCP is not initialized after an earlier initialization failure") : "MCP not initialized" }],
            details: { mode: "script", error: "not_initialized", ...retainedInitFailure ? { message: retainedInitFailure } : {} }
          };
        }
        executeOwner?.throwIfInactive();
        const { runMcpScript } = await loadMcpCodeModule();
        return runMcpScript(state, params.code, params.timeoutMs, getPiTools, signal);
      }
    });
  }
  function registerProxyTool(description) {
    pi.registerTool({
      name: "mcp",
      label: "MCP",
      description,
      promptSnippet: "MCP gateway \u2014 status, search, describe, auth, and single MCP tool calls",
      renderShell: toolRenderShell,
      renderCall: createMcpProxyToolCallRenderer(toolRenderOptions),
      parameters: Type3.Object({
        tool: Type3.Optional(Type3.String({ description: "Tool name to call (e.g., 'xcodebuild_list_sims')" })),
        args: Type3.Optional(Type3.Union([
          Type3.String({ description: `Arguments as a JSON string (e.g., '{"key": "value"}')` }),
          Type3.Object({}, {
            additionalProperties: true,
            description: 'Arguments as a JSON object (e.g., { "key": "value" })'
          })
        ], { description: "Tool arguments as a JSON object, or as a JSON string encoding one" })),
        connect: Type3.Optional(Type3.String({ description: "Server name to connect (lazy connect + metadata refresh)" })),
        describe: Type3.Optional(Type3.String({ description: "Tool name to describe (shows parameters)" })),
        instructions: Type3.Optional(Type3.String({ description: "Server name to show that server's usage instructions" })),
        search: Type3.Optional(Type3.String({ description: "Search tools by name/description" })),
        regex: Type3.Optional(Type3.Boolean({ description: "Treat search as regex (default: substring match)" })),
        includeSchemas: Type3.Optional(Type3.Boolean({ description: "Include parameter schemas in search results (default: true)" })),
        limit: optionalNumber({ minimum: 1, description: "Maximum search results to return (default: 12)" }),
        offset: optionalNumber({ minimum: 0, description: "Search result offset (default: 0)" }),
        server: Type3.Optional(Type3.String({ description: "Filter to specific server (also disambiguates tool calls)" })),
        action: Type3.Optional(Type3.String({ description: "Action: 'ui-messages', 'auth-start', or 'auth-complete'" }))
      }),
      renderResult: renderMcpToolResult2,
      async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
        let executeOwner = currentOwner;
        const parseArgs = (value) => {
          if (value === void 0 || value === "") return void 0;
          let args;
          if (typeof value === "string") {
            try {
              args = JSON.parse(value);
            } catch (error) {
              if (error instanceof SyntaxError) {
                throw new Error(`Invalid args JSON: ${error.message}`, { cause: error });
              }
              throw error;
            }
          } else {
            args = value;
          }
          if (typeof args !== "object" || args === null || Array.isArray(args)) {
            const gotType = Array.isArray(args) ? "array" : args === null ? "null" : typeof args;
            throw new Error(`Invalid args: expected a JSON object, got ${gotType}`);
          }
          return args;
        };
        const parsedArgs = parseArgs(params.args);
        const hasGatewayMode = (value) => value.tool !== void 0 || value.connect !== void 0 || value.describe !== void 0 || value.instructions !== void 0 || value.search !== void 0 || value.server !== void 0 || value.action !== void 0;
        if (!hasGatewayMode(params) && params.args !== void 0) {
          throw new Error('Gateway params were nested inside `args`; pass them top-level (for example, mcp({ search: "..." }) or mcp({ tool: "...", args: {} })).');
        }
        let initialization = initPromise;
        if (!state && !initialization) {
          try {
            initialization = ensureMcpState(signal, _ctx);
            executeOwner = currentOwner;
          } catch (error) {
            if (executeOwner && isOwnerAbortError(error, executeOwner)) throw error;
            const message = retainInitFailure(error);
            return {
              content: [{ type: "text", text: buildInitRetryInstruction("MCP initialization failed", message) }],
              details: { error: "init_failed", message }
            };
          }
        }
        if (!state && initialization) {
          try {
            const initialized = await awaitWithTimeout(initialization, INIT_WAIT_TIMEOUT_MS);
            if (initialized === INIT_WAIT_TIMED_OUT) {
              return {
                content: [{ type: "text", text: "MCP initialization is still in progress. Try again shortly." }],
                details: { error: "init_timeout", timeoutMs: INIT_WAIT_TIMEOUT_MS }
              };
            }
            executeOwner?.throwIfInactive();
            state = initialized;
          } catch (error) {
            if (executeOwner && isOwnerAbortError(error, executeOwner)) throw error;
            const message = retainInitFailure(error);
            return {
              content: [{ type: "text", text: buildInitRetryInstruction("MCP initialization failed", message) }],
              details: { error: "init_failed", message }
            };
          }
        }
        if (!state) {
          return {
            content: [{ type: "text", text: retainedInitFailure ? buildInitRetryInstruction("MCP is not initialized after an earlier initialization failure") : "MCP not initialized" }],
            details: { error: "not_initialized", ...retainedInitFailure ? { message: retainedInitFailure } : {} }
          };
        }
        executeOwner?.throwIfInactive();
        const {
          executeAuthComplete,
          executeAuthStart,
          executeCall,
          executeConnect,
          executeDescribe,
          executeInstructions,
          executeList,
          executeSearch,
          executeStatus,
          executeUiMessages
        } = await loadProxyModesModule();
        if (params.action === "ui-messages") {
          return executeUiMessages(state);
        }
        if (params.action === "auth-start") {
          if (!params.server) {
            return {
              content: [{ type: "text", text: 'auth-start requires `server`. Example: mcp({ action: "auth-start", server: "linear-server" })' }],
              details: { mode: "auth-start", error: "missing_server" }
            };
          }
          return signal ? executeAuthStart(state, params.server, signal) : executeAuthStart(state, params.server);
        }
        if (params.action === "auth-complete") {
          if (!params.server) {
            return {
              content: [{ type: "text", text: "auth-complete requires `server`." }],
              details: { mode: "auth-complete", error: "missing_server" }
            };
          }
          const input = parsedArgs?.redirectUrl ?? parsedArgs?.code ?? parsedArgs?.input;
          if (typeof input !== "string" || input.trim().length === 0) {
            return {
              content: [{ type: "text", text: "auth-complete requires args with `redirectUrl`, `code`, or `input`." }],
              details: { mode: "auth-complete", error: "missing_input" }
            };
          }
          return signal ? executeAuthComplete(state, params.server, input, signal) : executeAuthComplete(state, params.server, input);
        }
        if (params.tool) {
          return executeCall(state, params.tool, parsedArgs, params.server, getPiTools, signal);
        }
        if (params.connect) {
          const result = await executeConnect(state, params.connect, signal);
          syncToolSurface(_ctx);
          return result;
        }
        if (params.describe) {
          return executeDescribe(state, params.describe);
        }
        if (params.instructions) {
          return executeInstructions(state, params.instructions);
        }
        if (params.search !== void 0) {
          return executeSearch(state, params.search, params.regex, params.server, params.includeSchemas, params.limit, params.offset);
        }
        if (params.server) {
          return executeList(state, params.server);
        }
        return executeStatus(state);
      }
    });
  }
  const initialDirectResult = toolSurface.syncDirectTools(earlyConfig, earlyCatalogSnapshot);
  toolSurface.syncProxyTool(earlyConfig, earlyCatalogSnapshot, initialDirectResult.specs);
  toolSurface.syncNamespaceTools(earlyConfig, earlyCatalogSnapshot, initialDirectResult.reservedDirectNames, initialDirectResult.activeDirectNames);
  startLoadTimeInitialization();
}
function createMcpAdapter(options = {}) {
  const factoryConfig = options.config !== void 0 ? cloneMcpConfig(options.config) : void 0;
  return function mcpAdapter(pi) {
    installMcpAdapter(pi, {
      ...options.configPath !== void 0 ? { configPath: options.configPath } : {},
      ...factoryConfig !== void 0 ? { config: cloneMcpConfig(factoryConfig) } : {}
    });
  };
}
function registerMcpServer(options) {
  const { pi, name, definition } = options;
  const register = runtimeRegistrars.get(pi);
  if (!register) {
    throw new Error("pi-mcp-adapter is not installed for this Pi instance");
  }
  return register(name, definition);
}
var install_default = createMcpAdapter();
export {
  MCP_STATUS_EVENT,
  MCP_STATUS_SNAPSHOT_VERSION,
  MCP_TOOL_APPROVAL_REQUEST_EVENT,
  createMcpAdapter,
  install_default as default,
  namespaceProxyName,
  parseMcpReference,
  registerMcpServer,
  resolveMcpToolReferences
};
