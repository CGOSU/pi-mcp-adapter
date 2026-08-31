#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function printHelp(log = console.log) {
  log("pi-mcp-adapter helper\n");
  log("Install the package with:");
  log("  pi install npm:pi-mcp-adapter\n");
  log("");
  log("Bearer token storage (servers configured with auth: \"bearer\" and bearerTokenStore: true):");
  log("  pi-mcp-adapter token set <server>     Store a token read from stdin (masked prompt or pipe; never argv)");
  log("  pi-mcp-adapter token status <server>  Report whether a stored token matches the configured URL");
  log("  pi-mcp-adapter token remove <server>  Remove the stored token");
}

async function importTokenModules(error) {
  try {
    const [store, config, utils] = await Promise.all([
      import("./src/auth/mcp-bearer-store.ts"),
      import("./dist/config.js"),
      import("./src/utils.ts"),
    ]);
    return { store, config, utils };
  } catch (err) {
    error("Token commands need a Node.js version that can load TypeScript modules (Node 22.18+ or 23+).");
    error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

function readTokenFromStdin(stdin) {
  if (stdin.isTTY) return readTokenMasked(stdin);
  return new Promise((resolve, reject) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      data += chunk;
    });
    stdin.on("end", () => resolve(data.replace(/[\r\n]+$/, "")));
    stdin.on("error", reject);
  });
}

// Raw-mode masked prompt: the token never echoes to the terminal.
function readTokenMasked(stdin) {
  return new Promise((resolve, reject) => {
    process.stderr.write("Enter bearer token (input hidden): ");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let token = "";
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Token entry cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(token);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          token = token.slice(0, -1);
          continue;
        }
        token += char;
      }
    };
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
    };
    stdin.on("data", onData);
  });
}

async function runToken(argv, log, error, stdin) {
  const [action, serverName, ...extra] = argv;
  if (!["set", "status", "remove"].includes(action) || !serverName) {
    error("Usage: pi-mcp-adapter token <set|status|remove> <server>");
    error("`token set` reads the token from stdin only. Never pass the token as an argument.");
    return 1;
  }
  if (extra.length > 0) {
    error("Unexpected extra arguments. The token must not be passed on the command line; pipe it on stdin or use the interactive prompt.");
    return 1;
  }

  const modules = await importTokenModules(error);
  if (!modules) return 1;

  // Argv-derived text is sanitized before terminal output, and the resolved
  // URL is never printed: it can embed userinfo or interpolated secrets.
  const safeName = modules.utils.sanitizeTerminalText(serverName);
  const definition = modules.config.loadMcpConfig(undefined, process.cwd()).mcpServers[serverName];
  if (!definition) {
    error(`Server "${safeName}" not found in the effective MCP config.`);
    return 1;
  }
  if (definition.auth !== "bearer" || definition.bearerTokenStore !== true) {
    error(`Server "${safeName}" is not configured for bearerTokenStore. Set "auth": "bearer" and "bearerTokenStore": true.`);
    return 1;
  }
  // resolveServerUrl embeds the interpolated URL in its exceptions, so catch
  // and redact: the URL can carry userinfo or interpolated secrets.
  let serverUrl;
  try {
    serverUrl = modules.utils.resolveServerUrl(definition);
  } catch {
    error(`Server "${safeName}" has an invalid or unresolvable URL. Fix the server's url in the MCP config and retry.`);
    return 1;
  }
  if (!serverUrl) {
    error(`Server "${safeName}" has no URL configured.`);
    return 1;
  }

  if (action === "set") {
    const token = await readTokenFromStdin(stdin);
    if (!token) {
      error("No token provided on stdin.");
      return 1;
    }
    try {
      modules.store.saveBearerTokenForUrl(serverName, token, serverUrl);
    } catch (err) {
      error(modules.utils.sanitizeTerminalText(err instanceof Error ? err.message : String(err)));
      return 1;
    }
    log(`Bearer token stored for "${safeName}" and bound to the configured server URL.`);
    if (definition.bearerToken !== undefined || definition.bearerTokenEnv !== undefined) {
      log("Note: this server also configures bearerToken or bearerTokenEnv, which take precedence over the stored token.");
    }
    return 0;
  }

  if (action === "status") {
    const status = modules.store.inspectBearerTokenForUrl(serverName, serverUrl);
    if (status.status === "present") {
      log(`Bearer token is stored for "${safeName}".`);
      return 0;
    }
    if (status.status === "url-mismatch") {
      log(`Bearer token is stored for "${safeName}", but its URL does not match the current server URL. Run \`pi-mcp-adapter token set ${safeName}\` to rebind it.`);
      return 1;
    }
    if (status.status === "unavailable") {
      error(status.message);
      return 1;
    }
    log(`No bearer token is stored for "${safeName}".`);
    return 1;
  }

  try {
    modules.store.removeBearerToken(serverName);
  } catch (err) {
    error(modules.utils.sanitizeTerminalText(err instanceof Error ? err.message : String(err)));
    return 1;
  }
  log(`Bearer token removed for "${safeName}".`);
  return 0;
}

export async function main(argv = process.argv.slice(2), log = console.log, error = console.error, stdin = process.stdin) {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp(log);
    return 0;
  }

  if (command === "token") {
    return runToken(rest, log, error, stdin);
  }

  if (command === "install") {
    error("The custom downloader has been retired.");
    error("Use `pi install npm:pi-mcp-adapter` instead.");
    return 1;
  }

  error(`Unknown command: ${command}`);
  printHelp(log);
  return 1;
}

const resolvedEntrypoint = process.argv[1] ? fs.realpathSync(process.argv[1]) : undefined;
const isEntrypoint = resolvedEntrypoint && import.meta.url === pathToFileURL(resolvedEntrypoint).href;

if (isEntrypoint) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    console.error(`\nHelper failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
