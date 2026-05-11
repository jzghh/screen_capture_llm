import { FETCH_TIMEOUT_MS } from "@/utils/types";

export function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Combines the caller's AbortSignal with a hard timeout.
 * Uses AbortSignal.any when available, falls back to manual wiring.
 */
export function withTimeout(signal?: AbortSignal, ms = FETCH_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeout]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  timeout.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

/** Anthropic shape: { error: { message: "..." } }, OpenAI shape: { error: "..." } */
export function extractError(data: unknown): string {
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const err = obj.error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) {
      const m = (err as Record<string, unknown>).message;
      if (typeof m === "string") return m;
    }
  }
  return "";
}
