import { createHash } from 'node:crypto';

export const SONGS_SCHEMA_VERSION = 1;

const ALLOWED_KINDS = new Set(['live', 'cover', 'short', 'other']);
const STRING_FIELDS = [
  'title',
  'artist',
  'kind',
  'memo',
  'singingTag',
  'liveLink',
  'liveTitle',
  'lastSungDate',
  'publishedAt',
];

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function normalizeStringField(item, field, index) {
  const value = item[field];
  if (typeof value !== 'string') {
    throw new TypeError(`items[${index}].${field} must be a string`);
  }
  return value.trim();
}

function isValidDateString(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

function validateOptionalDate(value, field, index) {
  if (value && !isValidDateString(value)) {
    throw new TypeError(
      `items[${index}].${field} must be empty or a valid YYYY-MM-DD date`,
    );
  }
}

function validateOptionalHttpUrl(value, field, index) {
  if (!value) return;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`items[${index}].${field} must be an HTTP(S) URL`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`items[${index}].${field} must be an HTTP(S) URL`);
  }
}

function normalizeItem(rawItem, index) {
  assertObject(rawItem, `items[${index}]`);

  const item = {};
  for (const field of STRING_FIELDS) {
    item[field] = normalizeStringField(rawItem, field, index);
  }

  if (!item.title) {
    throw new TypeError(`items[${index}].title must not be empty`);
  }
  if (!item.artist) {
    throw new TypeError(`items[${index}].artist must not be empty`);
  }
  if (!ALLOWED_KINDS.has(item.kind)) {
    throw new TypeError(
      `items[${index}].kind must be one of: ${[...ALLOWED_KINDS].join(', ')}`,
    );
  }

  validateOptionalHttpUrl(item.liveLink, 'liveLink', index);
  validateOptionalDate(item.lastSungDate, 'lastSungDate', index);
  validateOptionalDate(item.publishedAt, 'publishedAt', index);

  return item;
}

function normalizeIdentityPart(value) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ja')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertUniqueSongIdentities(items) {
  const identities = new Map();

  items.forEach((item, index) => {
    const identityKey = [
      normalizeIdentityPart(item.artist),
      normalizeIdentityPart(item.title),
    ].join('\u0000');

    if (identities.has(identityKey)) {
      const firstIndex = identities.get(identityKey);
      throw new TypeError(
        `Duplicate song identity at items[${firstIndex}] and items[${index}]: `
        + `${item.artist} / ${item.title}. Artist and title must be unique.`,
      );
    }

    identities.set(identityKey, index);
  });
}

function buildDataVersion(schemaVersion, items) {
  const canonicalPayload = JSON.stringify({ schemaVersion, items });
  const digest = createHash('sha256').update(canonicalPayload).digest('hex');
  return `sha256:${digest}`;
}

export function buildSongSnapshot(rawPayload) {
  assertObject(rawPayload, 'payload');

  if (rawPayload.error) {
    const message = typeof rawPayload.error?.message === 'string'
      ? rawPayload.error.message.trim()
      : 'Unknown GAS API error';
    throw new TypeError(`GAS API error: ${message}`);
  }

  if (!Array.isArray(rawPayload.items)) {
    throw new TypeError('payload.items must be an array');
  }

  const schemaVersion = rawPayload.schemaVersion ?? SONGS_SCHEMA_VERSION;
  if (schemaVersion !== SONGS_SCHEMA_VERSION) {
    throw new TypeError(
      `payload.schemaVersion must be ${SONGS_SCHEMA_VERSION}`,
    );
  }

  if (
    typeof rawPayload.generatedAt !== 'string'
    || !rawPayload.generatedAt.trim()
    || Number.isNaN(Date.parse(rawPayload.generatedAt))
  ) {
    throw new TypeError('payload.generatedAt must be a valid date-time string');
  }

  const items = rawPayload.items.map(normalizeItem);
  if (!Number.isInteger(rawPayload.total) || rawPayload.total !== items.length) {
    throw new TypeError(
      `payload.total must equal payload.items.length (${items.length})`,
    );
  }
  assertUniqueSongIdentities(items);

  const snapshot = {
    items,
    total: items.length,
    generatedAt: rawPayload.generatedAt.trim(),
    schemaVersion,
    dataVersion: buildDataVersion(schemaVersion, items),
  };

  return {
    snapshot,
  };
}
