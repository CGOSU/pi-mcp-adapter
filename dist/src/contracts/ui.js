/**
 * Extract prompt text from either legacy MCP UI message shapes or native AppBridge user messages.
 */
export function extractUiPromptText(params) {
    if (params.type === "prompt" || params.prompt) {
        const prompt = params.prompt ?? String(params.message ?? "");
        return prompt || undefined;
    }
    if (params.role === "user" && Array.isArray(params.content)) {
        const text = params.content
            .map((block) => (block && typeof block === "object" && "text" in block ? String(block.text ?? "") : ""))
            .filter(Boolean)
            .join("\n\n");
        return text || undefined;
    }
    return undefined;
}
/**
 * Parse a canonical named UI handoff encoded as `intent\n{json}`.
 */
export function parseUiPromptHandoff(prompt) {
    const newlineIndex = prompt.indexOf("\n");
    if (newlineIndex <= 0) {
        return undefined;
    }
    const intent = prompt.slice(0, newlineIndex).trim();
    const payloadText = prompt.slice(newlineIndex + 1).trim();
    if (!intent || !payloadText) {
        return undefined;
    }
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(intent)) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(payloadText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return undefined;
        }
        return {
            intent,
            params: parsed,
            raw: prompt,
        };
    }
    catch {
        return undefined;
    }
}
export function createUiModelContextUpdate(params, maxChars = 12_000) {
    const payload = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
    if (Object.keys(payload).length === 0)
        return undefined;
    const serialized = JSON.stringify(payload);
    if (serialized.length <= maxChars) {
        return { payload, summary: serialized, truncated: false };
    }
    return {
        summary: `${serialized.slice(0, Math.max(0, maxChars - 1))}…`,
        truncated: true,
    };
}
//# sourceMappingURL=ui.js.map