const CJK_RANGE = /[\u2E80-\u9FFF\uA000-\uA4FF\uAC00-\uD7FF\uF900-\uFAFF]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_RANGE) || []).length;
  const nonCjkLen = text.length - cjkCount;
  return Math.ceil(cjkCount / 1.5 + nonCjkLen / 4);
}
