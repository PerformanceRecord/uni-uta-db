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

export function isTopMenuBeyondAutoCollapseBoundary({
  currentlyCollapsed = false,
  scrollTop = 0,
  collapseThreshold = 0,
  expandThreshold = 1,
} = {}) {
  const safeScrollTop = Math.max(0, Number(scrollTop) || 0);
  const safeCollapseThreshold = Math.max(0, Number(collapseThreshold) || 0);
  const safeExpandThreshold = Math.min(
    safeCollapseThreshold,
    Math.max(0, Number(expandThreshold) || 0),
  );
  const activeThreshold = currentlyCollapsed
    ? safeExpandThreshold
    : safeCollapseThreshold;

  return safeScrollTop > activeThreshold;
}

export function resolveTopMenuCollapsed({
  autoCollapseEnabled = false,
  manualMode = '',
  beyondThreshold = false,
} = {}) {
  if (!autoCollapseEnabled) return false;
  if (manualMode === 'collapsed') return true;
  if (manualMode === 'expanded') return false;
  return Boolean(beyondThreshold);
}
