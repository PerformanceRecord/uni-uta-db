import { KIND_MAP } from '../state/appState.js';

export function fmtDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('ja-JP');
}

export function normalizeKind(kind) {
  const raw = String(kind || '').trim();
  if (!raw) return 'live';

  const lowered = raw.toLowerCase();
  if (KIND_MAP[lowered]) return KIND_MAP[lowered];
  if (KIND_MAP[raw]) return KIND_MAP[raw];
  if (
    lowered.includes('cover')
    || raw.includes('歌ってみた')
    || raw.includes('歌みた')
  ) {
    return 'cover';
  }
  if (
    lowered.includes('live')
    || lowered.includes('stream')
    || raw.includes('歌枠')
    || raw.includes('配信')
  ) {
    return 'live';
  }
  if (lowered.includes('short') || raw.includes('ショート')) return 'short';
  return 'live';
}

export function resolveSingingTag(text) {
  const raw = String(text || '').trim();
  if (!raw) return { kind: 'live', label: '' };

  const kind = normalizeKind(raw);
  if (kind === 'short') return { kind, label: 'ショート' };
  if (kind === 'cover') return { kind, label: '歌ってみた' };
  return { kind: 'live', label: '' };
}

export function kindForFilter(item) {
  const tagText = String(item?.singingTag || item?.memo || '').trim();
  return tagText
    ? resolveSingingTag(tagText).kind
    : normalizeKind(item?.kind);
}

export function stableSongId(item) {
  const videoId = String(
    item?.videoId || item?.videoid || item?.video_id || '',
  ).trim();
  const title = String(item?.title || '').trim();
  const artist = String(item?.artist || '').trim();
  return [videoId, title, artist]
    .map((part) => encodeURIComponent(part))
    .join('|');
}

export function urlsFromText(text) {
  if (!text) return [];
  const matches = String(text).match(/https?:\/\/[^\s)]+/ig) || [];
  return Array.from(new Set(
    matches.map((url) => url.trim()).filter(Boolean),
  ));
}

export function normalizeExternalUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

export function hrefUrlsFromHtml(text) {
  if (!text) return [];

  const source = String(text);
  const urls = [];
  const hrefPattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/ig;
  let match;

  while ((match = hrefPattern.exec(source)) !== null) {
    const candidate = normalizeExternalUrl(
      match[1] || match[2] || match[3],
    );
    if (candidate) urls.push(candidate);
  }

  return Array.from(new Set(urls));
}

export function bestExternalUrl(value) {
  const direct = normalizeExternalUrl(value);
  if (direct) return direct;

  const hrefUrl = hrefUrlsFromHtml(value)[0];
  if (hrefUrl) return hrefUrl;

  return urlsFromText(value)[0] || '';
}

function dateOf(item) {
  const timestamp = Date.parse(item?.publishedAt || '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortSongItems(items, sortMode = 'date-desc') {
  const sorted = [...items];

  switch (sortMode) {
    case 'artist-asc':
      return sorted.sort((a, b) => (
        String(a.artist || '').localeCompare(String(b.artist || ''), 'ja')
      ));
    case 'artist-desc':
      return sorted.sort((a, b) => (
        String(b.artist || '').localeCompare(String(a.artist || ''), 'ja')
      ));
    case 'title-asc':
      return sorted.sort((a, b) => (
        String(a.title || '').localeCompare(String(b.title || ''), 'ja')
      ));
    case 'title-desc':
      return sorted.sort((a, b) => (
        String(b.title || '').localeCompare(String(a.title || ''), 'ja')
      ));
    case 'date-asc':
      return sorted.sort((a, b) => dateOf(a) - dateOf(b));
    case 'date-desc':
    default:
      return sorted.sort((a, b) => dateOf(b) - dateOf(a));
  }
}

export function filterSongItems(items, filterState = {}) {
  const query = String(filterState.q || '').toLowerCase();
  const kinds = new Set(filterState.kinds || []);
  const filtered = items
    .filter((item) => kinds.has(kindForFilter(item)))
    .filter((item) => {
      if (!query) return true;
      const target = [item.title, item.artist, item.memo]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return target.includes(query);
    });

  return sortSongItems(filtered, filterState.sortMode);
}

export function isPlaceholderUrl(url) {
  const text = String(url || '').trim();
  return (
    text.includes('xxxxxxxx')
    || text.includes('<')
    || text.includes('example.com')
  );
}
