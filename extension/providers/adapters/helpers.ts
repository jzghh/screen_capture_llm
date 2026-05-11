export function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
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
