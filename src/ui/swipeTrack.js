export function clampSwipeIndex(index) {
  return Math.max(0, Math.min(1, Number(index) || 0));
}

export function resolveSwipeIndex({
  current,
  deltaX,
  threshold,
}) {
  if (Math.abs(deltaX) <= threshold) return clampSwipeIndex(current);
  return clampSwipeIndex(deltaX < 0 ? current + 1 : current - 1);
}

export function updatePageIndicator(indicator, activeIndex) {
  if (!indicator) return;
  indicator.querySelectorAll('.dot').forEach((dot, index) => {
    dot.classList.toggle('active', index === activeIndex);
  });
}

export function updateViewSwitcher(switcher, activeIndex) {
  if (!switcher) return;
  const normalizedIndex = clampSwipeIndex(activeIndex);
  switcher.querySelectorAll('[data-card-index]').forEach((button) => {
    const isActive = Number(button.dataset.cardIndex) === normalizedIndex;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

export function bindViewSwitcher({ switcher, setCard }) {
  if (!switcher || typeof setCard !== 'function') return;
  switcher.querySelectorAll('[data-card-index]').forEach((button) => {
    button.addEventListener('click', () => {
      setCard(button.dataset.cardIndex);
    });
  });
}

export function setupSwipeTrack({
  wrap,
  track,
  panelWidthPercent = 50,
  onCardChange = null,
  allowInteractiveStart = false,
}) {
  let current = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let deltaY = 0;
  let pointerId = null;
  let gestureLocked = false;
  let gestureIsHorizontal = false;

  const setCard = (index, withAnimation = true) => {
    current = clampSwipeIndex(index);
    track.style.transition = withAnimation
      ? 'transform 0.45s cubic-bezier(0.2, 0.9, 0.2, 1)'
      : 'none';
    track.style.transform = `translateX(${-current * panelWidthPercent}%)`;
    if (typeof onCardChange === 'function') onCardChange(current);
  };

  const getThreshold = () => Math.max(54, wrap.clientWidth * 0.12);

  const resetGesture = () => {
    pointerId = null;
    deltaX = 0;
    deltaY = 0;
    gestureLocked = false;
    gestureIsHorizontal = false;
  };

  const onPointerMove = (event) => {
    if (!dragging || event.pointerId !== pointerId) return;

    deltaX = event.clientX - startX;
    deltaY = event.clientY - startY;
    if (!gestureLocked) {
      const moveAmount = Math.max(Math.abs(deltaX), Math.abs(deltaY));
      if (moveAmount < 6) return;
      gestureLocked = true;
      gestureIsHorizontal = Math.abs(deltaX) >= Math.abs(deltaY);
    }
    if (!gestureIsHorizontal) return;

    event.preventDefault();
    const base = -current * panelWidthPercent;
    const ratio = (
      deltaX / Math.max(1, wrap.clientWidth)
    ) * panelWidthPercent;
    const next = Math.max(-panelWidthPercent, Math.min(0, base + ratio));
    track.style.transform = `translateX(${next}%)`;
  };

  const onPointerUp = (event) => {
    if (!dragging || event.pointerId !== pointerId) return;

    dragging = false;
    track.classList.remove('dragging');
    const canReleasePointer = (
      typeof track.releasePointerCapture === 'function'
      && (
        typeof track.hasPointerCapture !== 'function'
        || track.hasPointerCapture(pointerId)
      )
    );
    if (canReleasePointer) {
      track.releasePointerCapture(pointerId);
    }

    if (!gestureIsHorizontal) {
      setCard(current, false);
      resetGesture();
      return;
    }

    setCard(resolveSwipeIndex({
      current,
      deltaX,
      threshold: getThreshold(),
    }));
    resetGesture();
  };

  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const directActionTarget = event.target?.closest?.('button, a');
    if (directActionTarget) return;

    const interactiveTarget = event.target?.closest?.(
      'button, input, select, textarea, label, a',
    );
    const isMousePointer = event.pointerType === 'mouse';
    if (interactiveTarget && (!allowInteractiveStart || isMousePointer)) return;

    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    deltaX = 0;
    deltaY = 0;
    gestureLocked = false;
    gestureIsHorizontal = false;
    pointerId = event.pointerId;
    track.classList.add('dragging');
    if (typeof track.setPointerCapture === 'function') {
      track.setPointerCapture(pointerId);
    }
  });

  track.addEventListener('pointermove', onPointerMove);
  track.addEventListener('pointerup', onPointerUp);
  track.addEventListener('pointercancel', onPointerUp);

  setCard(0, false);
  return {
    setCard,
    getCurrent: () => current,
  };
}
