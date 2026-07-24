import { state, DEFAULT_KINDS } from './state/appState.js';
import { byId } from './ui/dom.js';
import { setStatus, setLoadingStatus, setRunningStatus, setStoppedStatus, setErrorStatus } from './ui/status.js';
import { render } from './ui/renderSongs.js';
import { load } from './data/songsApi.js';
import {
  bestExternalUrl,
  filterSongItems,
  fmtDate,
  isPlaceholderUrl,
  resolveSingingTag,
  stableSongId,
} from './domain/songCatalog.js';
import {
  buildMyDanmaku,
  buildMyDanmakuPreview,
  DEFAULT_MY_DANMAKU_LABEL,
  loadMyDanmakuCache,
  normalizeMyEmoji,
  saveMyDanmakuCache,
} from './features/danmaku.js';
import {
  computeBubbleIntensity,
  createScrollBubbles,
} from './features/scrollBubbles.js';
import {
  copyTextToClipboard,
  insertTextIntoMemo,
} from './platform/clipboard.js';
import { readStorageItem } from './platform/storage.js';
import {
  registerServiceWorker,
  setupInstallHelpPopover,
} from './platform/pwa.js';
import {
  bindViewSwitcher,
  setupSwipeTrack,
  updatePageIndicator,
  updateViewSwitcher,
} from './ui/swipeTrack.js';
import { calculateMiddlePanelInsets } from './ui/panelLayout.js';
import { debounce, rafThrottle } from './utils/scheduling.js';

const CACHE_PREFIX = 'songs-cache-v3';
const DATA_CACHE_KEY = 'dataset';
const DATA_REFRESH_TTL_MS = 150 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 120;
const SWIPE_HINT_INTERVAL_MS = 3 * 60 * 1000;
const MAX_ERROR_BODY_CHARS = 4000;
const ENABLE_ERROR_LOG_UI = true;
const TAP_FOCUS_SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

function songsCacheKey() {
  return `${CACHE_PREFIX}:${DATA_CACHE_KEY}`;
}

const rows = byId('rows');
const selectedCount = byId('selectedCount');
const totalCount = byId('totalCount');
const toast = byId('toast');
const errorLogWrap = byId('errorLogWrap');
const errorLog = byId('errorLog');
const scrollBubbles = byId('scrollBubbles');
const statusShell = byId('statusShell');
const installHelpPopover = byId('installHelpPopover');
const installHelpBody = byId('installHelpBody');
const installHelpAction = byId('installHelpAction');
const installHelpClose = byId('installHelpClose');

let latestErrorLogText = '';
let toastTimer = null;
let sourceItemsCache = [];
let sourceTotalCache = 0;
let hasSourceItemsCache = false;

function isDesktopMotionOffMode() {
  return window.matchMedia('(pointer: fine)').matches;
}

function showToast(text, durationMs = 300) {
  if (!toast || !text) return;
  toast.textContent = text;
  toast.classList.add('show');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove('show');
  }, durationMs);
}

function clipText(value, max = MAX_ERROR_BODY_CHARS) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...<truncated ${text.length - max} chars>`;
}

function headersToObject(headers) {
  const picked = ['content-type', 'cache-control', 'etag', 'cf-ray', 'server', 'date'];
  const obj = {};
  for (const key of picked) {
    const value = headers.get(key);
    if (value) obj[key] = value;
  }
  return obj;
}

function setErrorLog(logObject) {
  latestErrorLogText = JSON.stringify(logObject, null, 2);
  if (ENABLE_ERROR_LOG_UI) {
    errorLog.textContent = latestErrorLogText;
    errorLogWrap.classList.add('show');
    syncTopPanelSize();
  }
  console.error('songs-db-detailed-error', logObject);
}

function clearErrorLog() {
  latestErrorLogText = '';
  if (ENABLE_ERROR_LOG_UI) {
    errorLog.textContent = 'エラー時に情報を表示します。';
  }
  errorLogWrap.classList.remove('show');
  syncTopPanelSize();
}

async function copyErrorLog() {
  if (!latestErrorLogText) {
    showToast('ログなし');
    return;
  }
  const copied = await copyTextToClipboard(latestErrorLogText);
  if (!copied) {
    setErrorStatus();
  }
}

let setSwipeCard = () => {};
let setTopSwipeCard = () => {};
let getTopSwipeCard = () => 0;
let triggerSwipeHint = () => {};
let swipeHintIntervalId = null;
let topMenuCollapsed = false;
let topSwipeCardIndex = 0;
let panelResizeObserver = null;

function getCollapsedTopHeight(topForm, filterPanel) {
  if (!topForm || !filterPanel) return 0;
  const wasCollapsed = topForm.classList.contains('collapsed');
  topForm.classList.add('collapsed');
  const statusSummary = filterPanel.querySelector('.top-summary .summary-box');
  const collapsedHeightBase = Math.ceil((statusSummary || filterPanel).getBoundingClientRect().height);
  const collapsedHeight = collapsedHeightBase + 2;
  if (!wasCollapsed) {
    topForm.classList.remove('collapsed');
  }
  return collapsedHeight;
}

function applyTopFormCollapsedState() {
  const topForm = byId('topForm');
  if (!topForm) return;
  const shouldCollapse = topSwipeCardIndex === 0 && topMenuCollapsed;
  topForm.classList.toggle('collapsed', shouldCollapse);
}

function setTopMenuCollapsed(nextCollapsed) {
  topMenuCollapsed = Boolean(nextCollapsed);
  applyTopFormCollapsedState();
  syncTopPanelSize();
}

function syncTopPanelSize() {
  const filterPanel = document.querySelector('.top-panel[aria-label="絞り込みカード"]');
  const topForm = byId('topForm');
  if (!filterPanel || !topForm) return;

  const hasCollapsed = topForm.classList.contains('collapsed');

  topForm.classList.remove('collapsed');
  const expandedHeight = Math.ceil(filterPanel.getBoundingClientRect().height);

  const collapsedHeight = getCollapsedTopHeight(topForm, filterPanel);

  topForm.classList.toggle('collapsed', hasCollapsed);

  if (expandedHeight > 0) {
    topForm.style.setProperty('--top-expanded-height', `${expandedHeight}px`);
  }
  if (collapsedHeight > 0) {
    topForm.style.setProperty('--top-collapsed-height', `${collapsedHeight}px`);
  }

  window.requestAnimationFrame(() => {
    updateMiddleCardsHeight();
  });
}

function setupTopSwipe() {
  const wrap = byId('topSwipeWrap');
  const track = byId('topSwipeTrack');
  const memoInput = byId('memoInput');
  const topForm = byId('topForm');
  const topPageIndicator = byId('topPageIndicator');
  const topViewSwitcher = byId('topViewSwitcher');
  const collapseButton = byId('collapseTopMenu');
  const expandButton = byId('expandTopMenu');

  if (!wrap || !track) return;
  const topSwipe = setupSwipeTrack({
    wrap,
    track,
    panelWidthPercent: 50,
    allowInteractiveStart: true,
    onCardChange: (index) => {
      topSwipeCardIndex = index;
      updatePageIndicator(topPageIndicator, index);
      updateViewSwitcher(topViewSwitcher, index);
      const isMemo = index === 1;
      topForm?.classList.toggle('memo-active', isMemo);
      if (isMemo) {
        setTopMenuCollapsed(false);
        return;
      }
      applyTopFormCollapsedState();
      syncTopPanelSize();
    },
  });
  setTopSwipeCard = topSwipe.setCard;
  getTopSwipeCard = topSwipe.getCurrent;
  bindViewSwitcher({
    switcher: topViewSwitcher,
    setCard: topSwipe.setCard,
  });

  if (memoInput) {
    memoInput.addEventListener('focus', () => {
      setTopSwipeCard(1);
    });
  }

  collapseButton?.addEventListener('click', () => {
    if (!topForm || topSwipeCardIndex !== 0) return;
    setTopMenuCollapsed(true);
  });

  expandButton?.addEventListener('click', () => {
    if (!topForm) return;
    setTopMenuCollapsed(false);
  });

  syncTopPanelSize();
  window.addEventListener('resize', syncTopPanelSize);
}

function setupBottomSwipe() {
  const wrap = byId('bottomSwipeWrap');
  const track = byId('bottomSwipeTrack');
  if (!wrap || !track) return;

  const bottomPageIndicator = byId('bottomPageIndicator');
  const bottomViewSwitcher = byId('bottomViewSwitcher');
  const stopHint = () => {
    track.classList.remove('hinting');
  };

  const startHint = () => {
    track.classList.remove('hinting');
    void track.offsetWidth;
    track.classList.add('hinting');
    window.setTimeout(() => {
      track.classList.remove('hinting');
    }, 6500);
  };

  const bottomSwipe = setupSwipeTrack({
    wrap,
    track,
    panelWidthPercent: 50,
    allowInteractiveStart: true,
    onCardChange: (index) => {
      updatePageIndicator(bottomPageIndicator, index);
      updateViewSwitcher(bottomViewSwitcher, index);
    },
  });
  const setCard = bottomSwipe.setCard;
  bindViewSwitcher({
    switcher: bottomViewSwitcher,
    setCard,
  });

  track.addEventListener('pointerdown', () => {
    stopHint();
  });
  byId('q')?.addEventListener('focus', stopHint, { once: true });
  byId('myEmoji')?.addEventListener('focus', stopHint, { once: true });

  byId('danmakuType')?.addEventListener('change', (evt) => {
    if (evt.target.value === 'my') setCard(1);
  });

  byId('saveMyDanmaku')?.addEventListener('click', () => {
    setCard(0);
  });

  setSwipeCard = setCard;
  triggerSwipeHint = isDesktopMotionOffMode() ? () => {} : startHint;

  if (!isDesktopMotionOffMode()) startHint();
}


function collapseSongCard(card) {
  card.classList.remove('expanded', 'preview-visible');
  const toggleBtn = card.querySelector('button[data-preview-toggle]');
  if (!toggleBtn) return;
  toggleBtn.textContent = '▶リンクを開く';
  toggleBtn.setAttribute('aria-expanded', 'false');
}

function collapseExpandedWhenOutOfView() {
  if (!isMobileLayout()) return;
  const activeCards = rows.querySelectorAll('.song-card.expanded, .song-card.preview-visible');
  if (!activeCards.length) return;
  const rowsRect = rows.getBoundingClientRect();
  activeCards.forEach((card) => {
    const cardRect = card.getBoundingClientRect();
    const isOutOfView = cardRect.bottom <= rowsRect.top || cardRect.top >= rowsRect.bottom;
    if (!isOutOfView) return;
    collapseSongCard(card);
  });
}

function updateMiddleCardsHeight() {
  if (!rows) return;

  const middleForm = document.querySelector('.middle-form');
  if (!middleForm) return;

  const middleRect = middleForm.getBoundingClientRect();
  const available = Math.floor(middleRect.height - 4);
  if (available > 120) {
    rows.style.maxHeight = `${available}px`;
  } else {
    rows.style.removeProperty('max-height');
  }
}

function updateMyDanmakuOptionLabel(inputValue = '') {
  const option = document.querySelector('#danmakuType option[value="my"]');
  if (!option) return;

  const typed = String(inputValue || '').trim();
  if (typed) {
    option.textContent = buildMyDanmakuPreview(typed);
    return;
  }
  option.textContent = DEFAULT_MY_DANMAKU_LABEL;
}

function eventTargetElement(target) {
  if (target instanceof Element) return target;
  return target?.parentElement || null;
}

function isInteractiveTarget(target) {
  const el = eventTargetElement(target);
  return Boolean(el?.closest?.('a, button, input, select, textarea, [role="button"]'));
}

let activeTapFocusEl = null;

function clearTapFocusRing() {
  if (!activeTapFocusEl) return;
  activeTapFocusEl.classList.remove('tap-focus-ring');
  activeTapFocusEl = null;
}

function setupTapFocusRing() {
  let hasPointerDown = false;

  document.addEventListener('pointerdown', (evt) => {
    hasPointerDown = true;
    const targetEl = eventTargetElement(evt.target);
    if (!targetEl?.closest?.(TAP_FOCUS_SELECTOR)) {
      clearTapFocusRing();
    }
  }, true);

  document.addEventListener('click', (evt) => {
    if (!hasPointerDown) return;
    hasPointerDown = false;

    const targetEl = eventTargetElement(evt.target);
    const ringTarget = targetEl?.closest?.(TAP_FOCUS_SELECTOR);
    if (!ringTarget) return;

    if (activeTapFocusEl && activeTapFocusEl !== ringTarget) {
      activeTapFocusEl.classList.remove('tap-focus-ring');
    }
    activeTapFocusEl = ringTarget;
    ringTarget.classList.add('tap-focus-ring');

    if (typeof ringTarget.focus === 'function') {
      ringTarget.focus({ preventScroll: true });
    }
  }, true);

  document.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Tab') return;
    hasPointerDown = false;
    clearTapFocusRing();
  }, true);
}

function isMobileLayout() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function collapseExpandedCards() {
  rows
    .querySelectorAll('.song-card.expanded, .song-card.preview-visible')
    .forEach(collapseSongCard);
}

function filterItems(items) {
  return filterSongItems(items, state);
}

const META_FALLBACK_JSON_URLS =
  document.querySelector('meta[name="songs-r2-fallbacks"]')?.content
    ?.split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  || [];

const GAS_SONGS_API_URL =
  document.querySelector('meta[name="songs-gas-api-url"]')?.content
  || '';

// 一時的にブラウザからのGAS直フォールバックを無効化する。
// 再実装時は true に戻すだけで既存コードを再利用できる。
const ENABLE_GAS_FALLBACK = false;

const SONGS_JSON_URL_OVERRIDE = [
  window.__SONGS_JSON_URL__,
  readStorageItem('songs_r2_json_url'),
  document.querySelector('meta[name="songs-r2-json-url"]')?.content,
]
  .map((value) => String(value || '').trim())
  .find((value) => value && !isPlaceholderUrl(value))
  || '';

const SONGS_JSON_FALLBACK_URLS = Array.from(new Set([
  ...META_FALLBACK_JSON_URLS,
]
  .map((value) => String(value || '').trim())
  .filter((value) => value && !isPlaceholderUrl(value))));


const renderDeps = {
  rows,
  selectedCount,
  totalCount,
  state,
  stableSongId,
  fmtDate,
  eventTargetElement,
  isInteractiveTarget,
  copyTextToClipboard,
  showToast,
  collapseExpandedCards,
  isMobileLayout,
  resolveSingingTag,
  bestExternalUrl,
};

function loadSongs() {
  const requestCandidates = [
    SONGS_JSON_URL_OVERRIDE,
    ...SONGS_JSON_FALLBACK_URLS,
    ...(ENABLE_GAS_FALLBACK ? [GAS_SONGS_API_URL] : []),
  ].filter(Boolean);
  return load({
    setLoadingStatus,
    clearErrorLog,
    setErrorLog,
    setStoppedStatus,
    setRunningStatus,
    filterItems,
    render: (items, totals) => render(items, totals, renderDeps),
    headersToObject,
    clipText,
    cacheKey: songsCacheKey,
    cacheMaxAgeMs: DATA_REFRESH_TTL_MS,
    requestCandidates,
    rows,
  }).then((result) => {
    if (!result) return result;
    sourceItemsCache = Array.isArray(result.sourceItems) ? result.sourceItems : [];
    sourceTotalCache = Number(result.total ?? sourceItemsCache.length);
    hasSourceItemsCache = true;
    return result;
  });
}

function rerenderFromLocalCache() {
  if (!hasSourceItemsCache) return false;
  const filteredItems = filterItems(sourceItemsCache);
  render(filteredItems, { total: sourceTotalCache }, renderDeps);
  setRunningStatus(filteredItems.length, sourceTotalCache);
  return true;
}

function rerenderOrLoadSongs() {
  if (rerenderFromLocalCache()) return;
  loadSongs();
}

async function copyMemo() {
  const memoInput = byId('memoInput');
  if (!memoInput) return;
  const copied = await copyTextToClipboard(memoInput.value || '');
  if (!copied) {

    return;
  }
  showToast('コピーしました');

}

async function pasteMemo() {
  const memoInput = byId('memoInput');
  if (!memoInput) return;

  memoInput.focus();
  try {
    const text = await navigator.clipboard.readText();
    insertTextIntoMemo(memoInput, text);
    memoInput.focus();
    showToast('貼り付けました');

  } catch (_) {
    const fallback = window.prompt('クリップボードへのアクセスに失敗しました。貼り付ける文字列を入力してください。', '');
    if (fallback === null) {

      return;
    }
    insertTextIntoMemo(memoInput, fallback);
    memoInput.focus();
    showToast('貼り付けました');

  }
}

async function copyDanmaku() {
  const type = byId('danmakuType').value;
  const isCustomDanmaku = type.startsWith('custom:');
  if (!isCustomDanmaku && type !== 'my') {
    showToast('対象なし');
    return;
  }

  let text = '';
  if (type === 'my') text = state.myDanmaku || loadMyDanmakuCache();
  if (isCustomDanmaku) text = type.slice('custom:'.length);

  if (!text.trim()) {
    showToast('対象なし');
    return;
  }

  const copied = await copyTextToClipboard(text.trim());
  if (copied) {
    showToast('弾幕をコピーしました');
  }
}

function toggleKind(kind) {
  const set = new Set(state.kinds);
  if (set.has(kind)) set.delete(kind);
  else set.add(kind);
  state.kinds = [...set];

  if (state.kinds.length === 0) {
    state.kinds = [...DEFAULT_KINDS];
    byId('kindCover').checked = true;
    byId('kindShort').checked = true;
    byId('kindLive').checked = true;
  }
  rerenderOrLoadSongs();
}

function bind() {
  if (!ENABLE_ERROR_LOG_UI) {
    errorLogWrap.hidden = true;
  }

  const rerenderSearch = debounce(
    rerenderOrLoadSongs,
    SEARCH_DEBOUNCE_MS,
  );

  byId('q').addEventListener('input', (e) => {
    state.q = e.target.value.trim();
    rerenderSearch();
  });

  byId('kindCover').addEventListener('change', () => toggleKind('cover'));
  byId('kindShort').addEventListener('change', () => toggleKind('short'));
  byId('kindLive').addEventListener('change', () => toggleKind('live'));

  byId('sortField').addEventListener('change', (e) => {
    state.sortField = e.target.value;
    state.sortMode = `${state.sortField}-${state.sortOrder}`;
    rerenderOrLoadSongs();
  });

  byId('sortOrder').addEventListener('change', (e) => {
    state.sortOrder = e.target.value;
    state.sortMode = `${state.sortField}-${state.sortOrder}`;
    rerenderOrLoadSongs();
  });

  byId('clear').addEventListener('click', () => {
    rerenderSearch.cancel();
    state.q = '';
    byId('q').value = '';
    rerenderOrLoadSongs();
  });

  byId('copyDanmaku').addEventListener('click', copyDanmaku);
  byId('copyMemo')?.addEventListener('click', copyMemo);
  byId('pasteMemo')?.addEventListener('click', pasteMemo);
  if (ENABLE_ERROR_LOG_UI) {
    byId('copyErrorLog').addEventListener('click', copyErrorLog);
  }

  byId('saveMyDanmaku').addEventListener('click', async () => {
    const emojiInput = byId('myEmoji');
    const rawEmoji = String(emojiInput.value || '').trim();

    if (!rawEmoji) {
      updateMyDanmakuOptionLabel('');
      showToast('絵文字を入力してください');
      return;
    }

    const safeEmoji = normalizeMyEmoji(rawEmoji);
    emojiInput.value = safeEmoji;

    const text = buildMyDanmaku(safeEmoji);
    state.myDanmaku = text;
    saveMyDanmakuCache(text);
    updateMyDanmakuOptionLabel(safeEmoji);

    const select = byId('danmakuType');
    select.value = 'my';
    select.classList.remove('roll-highlight');
    void select.offsetWidth;
    select.classList.add('roll-highlight');

    const copied = await copyTextToClipboard(text);

    setSwipeCard(0);
    showToast(copied ? '弾幕を作成してコピーしました' : '弾幕を作成しました');

  });

  const updateTopFormCollapseByScroll = () => {
    const topForm = byId('topForm');
    if (!topForm || !isMobileLayout()) return;
    if (getTopSwipeCard() === 1) return;

    const cardSample = rows?.querySelector('.song-card');
    const rowGap = Number.parseFloat(window.getComputedStyle(rows).rowGap || '0') || 0;
    const cardHeight = cardSample ? (cardSample.offsetHeight + rowGap) : 44;
    const collapseThreshold = cardHeight * 2;
    const currentScrollTop = rows?.scrollTop ?? window.scrollY;
    const shouldCollapse = currentScrollTop > collapseThreshold;
    if (shouldCollapse === topMenuCollapsed) return;
    setTopMenuCollapsed(shouldCollapse);
  };

  const updateScrollTopOffset = () => {
    const container = byId('songsPage');
    const topForm = byId('topForm');
    const middleForm = document.querySelector('.middle-form');
    const bottomForm = document.querySelector('.bottom-form');
    if (!topForm || !middleForm || !bottomForm || !container) return;

    const isWideDesktop = window.matchMedia('(min-width: 1100px)').matches;
    if (isWideDesktop) {
      [topForm, middleForm, bottomForm].forEach((panel) => {
        panel?.style.removeProperty('left');
        panel?.style.removeProperty('width');
      });
      middleForm.style.removeProperty('top');
      middleForm.style.removeProperty('bottom');
      updateMiddleCardsHeight();
      syncTopPanelSize();
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const maxCardWidth = 860;
    const cappedWidth = Math.min(containerRect.width, maxCardWidth);
    const cappedLeft = containerRect.left + ((containerRect.width - cappedWidth) / 2);
    const sharedLeft = `${Math.round(cappedLeft)}px`;
    const sharedWidth = `${Math.round(cappedWidth)}px`;

    topForm.style.left = sharedLeft;
    topForm.style.width = sharedWidth;
    middleForm.style.left = sharedLeft;
    middleForm.style.width = sharedWidth;
    bottomForm.style.left = sharedLeft;
    bottomForm.style.width = sharedWidth;

    const panelGap = isMobileLayout() ? 8 : 12;
    const topRect = topForm.getBoundingClientRect();
    const bottomRect = bottomForm.getBoundingClientRect();
    const middleInsets = calculateMiddlePanelInsets({
      viewportHeight: window.innerHeight,
      topPanelBottom: topRect.bottom,
      bottomPanelTop: bottomRect.top,
      gap: panelGap,
    });
    middleForm.style.top = `${middleInsets.top}px`;
    middleForm.style.bottom = `${middleInsets.bottom}px`;

    updateMiddleCardsHeight();
    syncTopPanelSize();
  };

  const scheduleViewportLayoutUpdate = rafThrottle(() => {
    updateTopFormCollapseByScroll();
    updateScrollTopOffset();
  });
  const scheduleRowsVisibilityUpdate = rafThrottle(() => {
    updateTopFormCollapseByScroll();
    collapseExpandedWhenOutOfView();
  });

  if (typeof window.ResizeObserver === 'function') {
    panelResizeObserver?.disconnect();
    panelResizeObserver = new window.ResizeObserver(
      scheduleViewportLayoutUpdate,
    );
    [byId('topForm'), document.querySelector('.bottom-form')]
      .filter(Boolean)
      .forEach((panel) => panelResizeObserver.observe(panel));
  }

  const MIN_BUBBLE_INTERVAL_MS = 48;
  const MIN_SCROLL_DELTA_FOR_BUBBLE = 3;
  let lastBubbleAt = 0;
  let lastWindowScrollTop = window.scrollY;
  let lastWindowBubbleAt = Date.now();
  let previousRowsScrollTop = 0;
  let lastRowsBubbleAt = Date.now();
  let cachedCardHeight = 44;
  let cachedCardHeightAt = 0;

  const getCardHeight = (now) => {
    if (now - cachedCardHeightAt <= 240) return cachedCardHeight;
    const cardSample = rows.querySelector('.song-card');
    const rowGap = Number.parseFloat(window.getComputedStyle(rows).rowGap || '0') || 0;
    cachedCardHeight = cardSample ? (cardSample.offsetHeight + rowGap) : 44;
    cachedCardHeightAt = now;
    return cachedCardHeight;
  };

  const maybeBubble = (deltaPx, elapsedMs, cardHeight) => {
    if (deltaPx < MIN_SCROLL_DELTA_FOR_BUBBLE) return;
    const now = Date.now();
    if (now - lastBubbleAt < MIN_BUBBLE_INTERVAL_MS) return;
    const intensity = computeBubbleIntensity(deltaPx, elapsedMs, cardHeight);
    if (intensity < 0.4) return;
    lastBubbleAt = now;
    const mode = intensity >= 10 ? 'burst' : 'normal';
    createScrollBubbles({
      container: scrollBubbles,
      mode,
      intensity,
      disabled: isDesktopMotionOffMode(),
    });
  };

  window.addEventListener('scroll', () => {
    scheduleViewportLayoutUpdate();

    const now = Date.now();
    const deltaWindow = Math.abs(window.scrollY - lastWindowScrollTop);
    const elapsedWindow = Math.max(1, now - lastWindowBubbleAt);
    const cardHeight = getCardHeight(now);

    maybeBubble(deltaWindow, elapsedWindow, cardHeight);
    lastWindowScrollTop = window.scrollY;
    lastWindowBubbleAt = now;
  });

  window.addEventListener('resize', scheduleViewportLayoutUpdate);

  rows.addEventListener('scroll', () => {
    const now = Date.now();
    const cardHeight = getCardHeight(now);
    const deltaPx = Math.abs(rows.scrollTop - previousRowsScrollTop);
    const elapsedRows = Math.max(1, now - lastRowsBubbleAt);

    maybeBubble(deltaPx, elapsedRows, cardHeight);

    previousRowsScrollTop = rows.scrollTop;
    lastRowsBubbleAt = now;

    scheduleRowsVisibilityUpdate();
  });


  const media = window.matchMedia('(max-width: 768px)');
  const handleMobileLayoutChange = () => {
    collapseExpandedCards();
    updateScrollTopOffset();
  };
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', handleMobileLayoutChange);
  } else if (typeof media.addListener === 'function') {
    media.addListener(handleMobileLayoutChange);
  }

  updateScrollTopOffset();
  updateMiddleCardsHeight();
  updateTopFormCollapseByScroll();
}

export function initializeApp() {
  registerServiceWorker();
  setupTapFocusRing();
  setupInstallHelpPopover({
    statusShell,
    installHelpPopover,
    installHelpBody,
    installHelpAction,
    installHelpClose,
  });
  byId('sortField').value = state.sortField;
  byId('sortOrder').value = state.sortOrder;
  state.sortMode = `${state.sortField}-${state.sortOrder}`;
  state.myDanmaku = loadMyDanmakuCache();
  updateMyDanmakuOptionLabel('');
  if (!state.myDanmaku) triggerSwipeHint();
  if (!swipeHintIntervalId && !isDesktopMotionOffMode()) {
    swipeHintIntervalId = window.setInterval(() => {
      if (!loadMyDanmakuCache()) triggerSwipeHint();
    }, SWIPE_HINT_INTERVAL_MS);
  }
  loadSongs();
}

export { bind, setupTopSwipe, setupBottomSwipe };
