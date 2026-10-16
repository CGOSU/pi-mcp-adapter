import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [logPath, serverLabel] = process.argv.slice(2);
if (!logPath || !serverLabel) {
  throw new Error("The fixture requires a log path and a server label.");
}

function record(value) {
  appendFileSync(logPath, `${value}\n`, "utf8");
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const tools = [
  {
    name: "lookup",
    description: "Return a local fixture result.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "fail",
    description: "Return a fixture MCP error.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "slow",
    description: "Hold a local operation until its native server is withdrawn.",
    inputSchema: { type: "object", properties: {} },
  },
];

record(`start:${serverLabel}`);

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    record(`invalid-json:${serverLabel}`);
    continue;
  }
  if (request.id === undefined || typeof request.method !== "string") continue;

  let result;
  switch (request.method) {
    case "initialize":
      result = {
        protocolVersion: "2025-11-25",
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          prompts: { listChanged: true },
        },
        serverInfo: { name: `local-${serverLabel}`, version: "1.0.0" },
      };
      break;
    case "tools/list":
      result = { tools };
      break;
    case "resources/list":
      result = {
        resources: [{ uri: "fixture://guide", name: "guide", description: "Local guide", mimeType: "text/plain" }],
      };
      break;
    case "resources/templates/list":
      result = {
        resourceTemplates: [{ uriTemplate: "fixture://topics/{topic}", name: "topic-guide", mimeType: "text/plain" }],
      };
      break;
    case "prompts/list":
      result = { prompts: [{ name: "fixture-prompt", description: "A local prompt", arguments: [] }] };
      break;
    case "resources/read": {
      const uri = request.params?.uri;
      record(`read:${serverLabel}:${uri}`);
      result = { contents: [{ uri, mimeType: "text/plain", text: `local resource ${uri}` }] };
      break;
    }
    case "prompts/get":
      record(`prompt:${serverLabel}:${request.params?.name}`);
      result = {
        description: "A local fixture prompt.",
        messages: [{ role: "user", content: { type: "text", text: "Use only local fixture data." } }],
      };
      break;
    case "tools/call": {
      const name = request.params?.name;
      const args = request.params?.arguments ?? {};
      record(`call:${serverLabel}:${name}:${args.query ?? ""}:start`);
      if (name === "lookup") {
        record(`call:${serverLabel}:${name}:${args.query ?? ""}:complete`);
        result = {
          content: [{ type: "text", text: `lookup result for ${args.query}` }],
          structuredContent: { query: args.query, result: `local:${args.query}` },
        };
      } else if (name === "fail") {
        result = { content: [{ type: "text", text: "local fixture rejected the request" }], isError: true };
      } else if (name === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        record(`call:${serverLabel}:${name}:complete`);
        result = { content: [{ type: "text", text: "slow fixture completed" }] };
      } else {
        send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: "Unknown fixture tool." },
        });
        continue;
      }
      break;
    }
    default:
      send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown fixture method." } });
      continue;
  }

  send({ jsonrpc: "2.0", id: request.id, result });
}
