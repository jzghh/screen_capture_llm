export function computePanelPosition(
  selRect: { top: number; bottom: number; left: number },
  panelSize: { width: number; height: number },
  viewport = { w: window.innerWidth, h: window.innerHeight },
): { top: number; left: number } {
  const M = 12;
  const { w: vw, h: vh } = viewport;
  const { width: pw, height: ph } = panelSize;

  let top = selRect.bottom + M;
  if (top + ph > vh - M) {
    const above = selRect.top - ph - M;
    top = above >= M ? above : Math.max(M, (vh - ph) / 2);
  }

  const left = Math.min(Math.max(M, selRect.left), vw - pw - M);
  return { top, left };
}
