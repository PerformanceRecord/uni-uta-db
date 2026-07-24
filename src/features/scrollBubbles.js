export const MAX_SCROLL_BUBBLES = 90;

export function computeBubbleIntensity(deltaPx, elapsedMs, cardHeight) {
  const safeDelta = Math.max(0, Number(deltaPx) || 0);
  const normalizedDistance = safeDelta / Math.max(1, Number(cardHeight) || 1);
  const velocityBoost = safeDelta / Math.max(16, (Number(elapsedMs) || 0) * 4);
  return normalizedDistance * (1 + velocityBoost);
}

export function computeBubbleCount({
  mode = 'normal',
  intensity = 1,
  activeCount = 0,
  maxBubbles = MAX_SCROLL_BUBBLES,
} = {}) {
  const burst = mode === 'burst';
  const normalizedIntensity = Math.max(
    1,
    Number.isFinite(intensity) ? intensity : 1,
  );
  const cappedIntensity = Math.min(40, normalizedIntensity);
  const requestedCount = burst
    ? Math.max(5, Math.round(cappedIntensity * 3))
    : Math.max(5, Math.round(cappedIntensity));
  const availableSlots = Math.max(0, maxBubbles - activeCount);
  return Math.min(requestedCount, availableSlots);
}

export function createScrollBubbles({
  container,
  mode = 'normal',
  intensity = 1,
  disabled = false,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  random = Math.random,
  maxBubbles = MAX_SCROLL_BUBBLES,
} = {}) {
  if (!container || disabled) return 0;

  const burst = mode === 'burst';
  const bubbleCount = computeBubbleCount({
    mode,
    intensity,
    activeCount: container.childElementCount,
    maxBubbles,
  });
  if (bubbleCount <= 0) return 0;

  const fragment = documentRef.createDocumentFragment();
  for (let index = 0; index < bubbleCount; index += 1) {
    const bubble = documentRef.createElement('span');
    const size = burst ? 12 + random() * 24 : 8 + random() * 18;
    bubble.className = 'scroll-bubble';
    bubble.style.left = `${6 + random() * 88}%`;
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.animationDelay = `${index * 0.04}s`;
    bubble.style.animationDuration = burst
      ? `${2.0 + random() * 0.9}s`
      : `${2.4 + random() * 1.4}s`;
    fragment.appendChild(bubble);
    windowRef.setTimeout(() => bubble.remove(), 5_000);
  }
  container.appendChild(fragment);
  return bubbleCount;
}
