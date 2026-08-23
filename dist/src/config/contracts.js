export const KNOWN_SERVER_PRESETS = [
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
//# sourceMappingURL=contracts.js.map