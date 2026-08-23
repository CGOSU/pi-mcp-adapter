import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const INIT_WAIT_TIMEOUT_MS = 30_000;
export const INIT_FAILURE_MESSAGE_MAX_CHARS = 1_000;
export const INIT_WAIT_TIMED_OUT: unique symbol = Symbol("init-wait-timed-out");

export function snapshotExtensionContext(
  ctx: ExtensionContext | undefined,
  signalOverride?: AbortSignal,
): ExtensionContext {
  const hasUI = ctx?.hasUI === true;
  const snapshot: Record<string, unknown> = {
    cwd: ctx?.cwd ?? process.cwd(),
    hasUI,
    mode: ctx?.mode ?? "print",
  };
  if (hasUI && ctx?.ui !== undefined) snapshot.ui = ctx.ui;
  if (ctx?.model !== undefined) snapshot.model = ctx.model;
  if (ctx?.modelRegistry !== undefined) snapshot.modelRegistry = ctx.modelRegistry;
  const signal = signalOverride ?? ctx?.signal;
  if (signal !== undefined) snapshot.signal = signal;
  return snapshot as unknown as ExtensionContext;
}

export async function awaitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof INIT_WAIT_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof INIT_WAIT_TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(INIT_WAIT_TIMED_OUT), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
