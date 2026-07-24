export const MY_DANMAKU_CACHE_KEY = 'my-danmaku-cache-v1';
export const MY_DANMAKU_CACHE_MS = 15 * 60 * 1000;
export const DEFAULT_MY_DANMAKU_LABEL = 'カスタム弾幕';

export function sanitizeUtf16(text) {
  const raw = String(text || '');
  let sanitized = '';

  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const isHighSurrogate = code >= 0xD800 && code <= 0xDBFF;
    const isLowSurrogate = code >= 0xDC00 && code <= 0xDFFF;

    if (isHighSurrogate) {
      const nextCode = raw.charCodeAt(index + 1);
      const nextIsLowSurrogate = (
        nextCode >= 0xDC00 && nextCode <= 0xDFFF
      );
      if (nextIsLowSurrogate) {
        sanitized += raw[index] + raw[index + 1];
        index += 1;
      }
      continue;
    }

    if (!isLowSurrogate) {
      sanitized += raw[index];
    }
  }

  return sanitized;
}

export function splitGraphemes(
  text,
  Segmenter = globalThis.Intl?.Segmenter,
) {
  const value = String(text || '');
  if (typeof Segmenter === 'function') {
    const segmenter = new Segmenter('ja', { granularity: 'grapheme' });
    return Array.from(segmenter.segment(value), ({ segment }) => segment);
  }
  return Array.from(value);
}

export function normalizeMyEmoji(emoji) {
  const safe = sanitizeUtf16(String(emoji || '').trim());
  if (!safe) return '🙂';

  const limited = splitGraphemes(safe).slice(0, 2).join('');
  return limited || '🙂';
}

export function buildMyDanmaku(emoji) {
  const safeEmoji = normalizeMyEmoji(emoji);
  return `🍣🧡${safeEmoji}🍣🧡${safeEmoji}🍣🧡${safeEmoji}👏`;
}

export function buildMyDanmakuPreview(emoji) {
  return `🍣🧡${normalizeMyEmoji(emoji)}`;
}

export function saveMyDanmakuCache(
  text,
  {
    storage = globalThis.localStorage,
    cacheKey = MY_DANMAKU_CACHE_KEY,
    ttlMs = MY_DANMAKU_CACHE_MS,
    now = Date.now,
  } = {},
) {
  const entry = {
    value: String(text || ''),
    expiresAt: now() + ttlMs,
  };

  try {
    storage.setItem(cacheKey, JSON.stringify(entry));
    return true;
  } catch (_) {
    return false;
  }
}

export function loadMyDanmakuCache(
  {
    storage = globalThis.localStorage,
    cacheKey = MY_DANMAKU_CACHE_KEY,
    now = Date.now,
  } = {},
) {
  try {
    const raw = storage.getItem(cacheKey);
    if (!raw) return '';

    const entry = JSON.parse(raw);
    const expiresAt = Number(entry?.expiresAt);
    if (
      !entry?.value
      || !Number.isFinite(expiresAt)
      || expiresAt <= 0
      || now() > expiresAt
    ) {
      storage.removeItem(cacheKey);
      return '';
    }

    return String(entry.value);
  } catch (_) {
    try {
      storage?.removeItem?.(cacheKey);
    } catch (_) {}
    return '';
  }
}
