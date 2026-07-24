import { describe, expect, it } from 'vitest';
import { buildSongSnapshot } from '../scripts/lib/songSnapshot.mjs';

function makeItem(overrides = {}) {
  return {
    title: 'テスト曲',
    artist: 'テスト歌手',
    kind: 'live',
    memo: '',
    singingTag: '',
    liveLink: 'https://example.com/watch?v=1',
    liveTitle: 'テスト配信',
    lastSungDate: '2026-07-20',
    publishedAt: '2026-07-20',
    ...overrides,
  };
}

function makePayload(overrides = {}) {
  return {
    items: [makeItem()],
    total: 1,
    generatedAt: '2026-07-24T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  };
}

describe('buildSongSnapshot', () => {
  it('validates and adds a SHA-256 dataVersion', () => {
    const { snapshot } = buildSongSnapshot(makePayload());

    expect(snapshot).toMatchObject({
      total: 1,
      schemaVersion: 1,
      generatedAt: '2026-07-24T00:00:00.000Z',
    });
    expect(snapshot.dataVersion).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('keeps dataVersion stable when only generatedAt changes', () => {
    const first = buildSongSnapshot(makePayload()).snapshot;
    const second = buildSongSnapshot(
      makePayload({ generatedAt: '2026-07-25T00:00:00.000Z' }),
    ).snapshot;

    expect(second.dataVersion).toBe(first.dataVersion);
  });

  it('normalizes a legacy empty payload without schemaVersion', () => {
    const { snapshot } = buildSongSnapshot({
      items: [],
      total: 0,
      generatedAt: '2026-07-24T00:00:00.000Z',
    });

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.items).toEqual([]);
  });

  it('rejects a total that does not match the item count', () => {
    expect(() => buildSongSnapshot(makePayload({ total: 2 }))).toThrow(
      'payload.total must equal payload.items.length (1)',
    );
  });

  it('surfaces a diagnostic error returned by GAS', () => {
    expect(() => buildSongSnapshot({
      error: {
        code: 'SONGS_BUILD_FAILED',
        message: 'Duplicate song identity',
      },
      generatedAt: '2026-07-24T00:00:00.000Z',
      schemaVersion: 1,
    })).toThrow('GAS API error: Duplicate song identity');
  });

  it.each([
    ['kind', 'unknown', 'must be one of'],
    ['liveLink', 'javascript:alert(1)', 'must be an HTTP(S) URL'],
    ['lastSungDate', '2026-02-30', 'must be empty or a valid YYYY-MM-DD date'],
    ['publishedAt', '2026/07/20', 'must be empty or a valid YYYY-MM-DD date'],
  ])('rejects an invalid %s', (field, value, message) => {
    const payload = makePayload({ items: [makeItem({ [field]: value })] });

    expect(() => buildSongSnapshot(payload)).toThrow(message);
  });

  it('rejects an exact duplicate instead of selecting one automatically', () => {
    const item = makeItem();
    const payload = makePayload({
      items: [item, { ...item }],
      total: 2,
    });

    expect(() => buildSongSnapshot(payload)).toThrow(
      'Duplicate song identity at items[0] and items[1]',
    );
  });

  it('rejects a newer live entry when the same cover song already exists', () => {
    const cover = makeItem({
      kind: 'cover',
      lastSungDate: '2026-04-12',
      publishedAt: '2026-04-12',
      liveTitle: '歌ってみた',
    });
    const laterLive = makeItem({
      kind: 'live',
      lastSungDate: '2026-06-27',
      publishedAt: '2026-06-27',
      liveTitle: '歌枠',
    });
    const payload = makePayload({
      items: [cover, laterLive],
      total: 2,
    });

    expect(() => buildSongSnapshot(payload)).toThrow(
      'Artist and title must be unique',
    );
  });
});
