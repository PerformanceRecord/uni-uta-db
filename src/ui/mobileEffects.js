const MOBILE_SKELETON_CARD_COUNT = 4;

export function calculateScrollProgress({
  scrollTop = 0,
  scrollHeight = 0,
  clientHeight = 0,
} = {}) {
  const maxScrollTop = Math.max(
    0,
    (Number(scrollHeight) || 0) - (Number(clientHeight) || 0),
  );
  if (maxScrollTop === 0) return 0;
  return Math.min(1, Math.max(0, (Number(scrollTop) || 0) / maxScrollTop));
}

export function updateMobileScrollProgress({
  rows,
  progressElement,
  enabled = false,
} = {}) {
  if (!rows || !progressElement) return 0;

  const scrollable = enabled && rows.scrollHeight > rows.clientHeight;
  const progress = scrollable
    ? calculateScrollProgress({
      scrollTop: rows.scrollTop,
      scrollHeight: rows.scrollHeight,
      clientHeight: rows.clientHeight,
    })
    : 0;

  progressElement.style.setProperty('--list-scroll-progress', String(progress));
  progressElement.classList.toggle('visible', scrollable);
  return progress;
}

export function renderMobileLoadingSkeleton({
  rows,
  enabled = false,
  cardCount = MOBILE_SKELETON_CARD_COUNT,
} = {}) {
  if (!rows || !enabled || rows.childElementCount > 0) return false;

  const normalizedCount = Math.max(1, Math.min(6, Number(cardCount) || 1));
  const cards = Array.from(
    { length: normalizedCount },
    (_, index) => (
      `<article class="song-card ui-card skeleton-card" aria-hidden="true">`
      + `<span class="skeleton-kind" style="--skeleton-index:${index}"></span>`
      + '<span class="skeleton-title"></span>'
      + '<span class="skeleton-artist"></span>'
      + '</article>'
    ),
  ).join('');

  rows.innerHTML = cards;
  rows.setAttribute('aria-busy', 'true');
  return true;
}

export function restartAnimationClass(element, className) {
  if (!element || !className) return false;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  return true;
}

export function playMobileCardRipple({
  card,
  event,
  enabled = false,
} = {}) {
  if (!enabled || !card || !event) return false;

  const rect = card.getBoundingClientRect();
  const fallbackX = rect.width / 2;
  const fallbackY = Math.min(rect.height / 2, 48);
  const x = Number.isFinite(event.clientX)
    ? Math.min(rect.width, Math.max(0, event.clientX - rect.left))
    : fallbackX;
  const y = Number.isFinite(event.clientY)
    ? Math.min(rect.height, Math.max(0, event.clientY - rect.top))
    : fallbackY;

  card.style.setProperty('--tap-ripple-x', `${x}px`);
  card.style.setProperty('--tap-ripple-y', `${y}px`);
  return restartAnimationClass(card, 'tap-ripple');
}

export function showMobileCopyFeedback({
  target,
  enabled = false,
} = {}) {
  if (!enabled || !target) return false;
  const feedbackTarget = target.closest?.(
    '.song-card, .memo-panel, .bottom-static-controls, .my-danmaku-form',
  ) || target;
  return restartAnimationClass(feedbackTarget, 'copy-success');
}

