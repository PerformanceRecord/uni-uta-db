export function calculateMiddlePanelInsets({
  viewportHeight,
  topPanelBottom,
  bottomPanelTop,
  gap,
}) {
  const safeViewportHeight = Math.max(0, Number(viewportHeight) || 0);
  const safeTopPanelBottom = Math.max(0, Number(topPanelBottom) || 0);
  const safeBottomPanelTop = Math.max(0, Number(bottomPanelTop) || 0);
  const safeGap = Math.max(0, Number(gap) || 0);

  return {
    top: Math.ceil(safeTopPanelBottom + safeGap),
    bottom: Math.ceil(
      Math.max(0, safeViewportHeight - safeBottomPanelTop) + safeGap,
    ),
  };
}

export function shouldAutoCollapseTopMenu({
  mobileLayout = false,
  compactDesktopLayout = false,
} = {}) {
  return Boolean(mobileLayout && !compactDesktopLayout);
}
