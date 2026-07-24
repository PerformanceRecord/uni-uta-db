import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import {
  clearApiCache,
  fetchWithTimeout,
  isSameOriginRequest,
  load,
  loadCache,
  normalizeSongsPayload,
  saveCache,
} from '../src/data/songsApi.js';

describe('songsApi utility functions', () => {
  let store;

  beforeEach(() => {
    vi.stubGlobal('location', {
      href: 'https://example.com/app',
      origin: 'https://example.com',
    });

    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        store.set(key, value);
      },
      removeItem: (key) => {
        store.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('isSameOriginRequest: 同一オリジンURLはtrue', () => {
    expect(isSameOriginRequest('/songs.json')).toBe(true);
    expect(isSameOriginRequest('https://example.com/data.json')).toBe(true);
  });

  it('isSameOriginRequest: 別オリジンや不正URLはfalse', () => {
    expect(isSameOriginRequest('https://other.example.com/data.json')).toBe(false);
    expect(isSameOriginRequest('https://[::1')).toBe(false);
  });

  it('loadCache/saveCache/clearApiCache が連携して動作する', () => {
    const cacheKey = () => 'songs-cache:test';
    const payload = { etag: 'abc', payload: { items: [] }, fetchedAt: 123 };

    saveCache(payload, { cacheKey });
    expect(loadCache({ cacheKey })).toEqual(payload);

    clearApiCache({ cacheKey });
    expect(loadCache({ cacheKey })).toBeNull();
  });

  it('normalizeSongsPayload: 配列形式とスナップショット形式を正規化する', () => {
    const item = { title: '曲', artist: '歌手' };
    expect(normalizeSongsPayload([item])).toMatchObject({
      sourceItems: [item],
      total: 1,
      dataVersion: '',
    });

    const dataVersion = `sha256:${'a'.repeat(64)}`;
    expect(normalizeSongsPayload({
      items: [item],
      total: 1,
      schemaVersion: 1,
      dataVersion,
    })).toMatchObject({
      sourceItems: [item],
      total: 1,
      dataVersion,
    });
  });

  it('normalizeSongsPayload: 件数不一致や未知のスキーマを拒否する', () => {
    expect(() => normalizeSongsPayload({
      items: [],
      total: 1,
    })).toThrow('total must equal items.length');
    expect(() => normalizeSongsPayload({
      items: [],
      total: 0,
      schemaVersion: 2,
    })).toThrow('Unsupported songs payload.schemaVersion');
  });

  it('fetchWithTimeout: 応答しない取得を中断する', async () => {
    const fetchImpl = vi.fn((_, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    await expect(fetchWithTimeout(
      'https://example.com/songs.json',
      {},
      { timeoutMs: 5, fetchImpl },
    )).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Request timed out after 5 ms',
    });
  });

  it('load: ETagが公開されないR2レスポンスもキャッシュする', async () => {
    const dataVersion = `sha256:${'b'.repeat(64)}`;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => ({
        items: [{ title: '曲', artist: '歌手' }],
        total: 1,
        schemaVersion: 1,
        dataVersion,
      }),
    })));
    const ctx = makeLoadContext();

    const result = await load(ctx);
    const cached = JSON.parse(store.get('songs-cache:test'));

    expect(result).toMatchObject({ total: 1, dataVersion });
    expect(cached).toMatchObject({
      etag: '',
      dataVersion,
      payload: { total: 1, dataVersion },
    });
    expect(ctx.render).toHaveBeenCalledTimes(1);
  });

  it('load: 同じdataVersionならキャッシュ表示後の再描画を省略する', async () => {
    const dataVersion = `sha256:${'c'.repeat(64)}`;
    const payload = {
      items: [{ title: '曲', artist: '歌手' }],
      total: 1,
      schemaVersion: 1,
      dataVersion,
    };
    store.set('songs-cache:test', JSON.stringify({
      etag: '',
      dataVersion,
      payload,
      fetchedAt: 1,
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => payload,
    })));
    const ctx = makeLoadContext();

    const result = await load(ctx);

    expect(result.dataVersion).toBe(dataVersion);
    expect(ctx.render).toHaveBeenCalledTimes(1);
  });

  it('load: 304応答時はキャッシュの取得日時を更新する', async () => {
    const dataVersion = `sha256:${'e'.repeat(64)}`;
    const payload = {
      items: [{ title: '曲', artist: '歌手' }],
      total: 1,
      schemaVersion: 1,
      dataVersion,
    };
    store.set('songs-cache:test', JSON.stringify({
      etag: 'etag-1',
      dataVersion,
      payload,
      fetchedAt: 1,
    }));
    vi.spyOn(Date, 'now').mockReturnValue(5_000);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 304,
      statusText: 'Not Modified',
      headers: new Headers(),
    })));
    const ctx = makeLoadContext({
      requestCandidates: ['/songs.json'],
    });

    const result = await load(ctx);
    const cached = JSON.parse(store.get('songs-cache:test'));

    expect(result).toMatchObject({ fromCache: true, dataVersion });
    expect(cached.fetchedAt).toBe(5_000);
    expect(ctx.render).toHaveBeenCalledTimes(1);
  });

  it('load: 一時的なHTTPエラーでは次の候補URLを試す', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: async () => ({
          items: [{ title: '曲', artist: '歌手' }],
          total: 1,
          schemaVersion: 1,
        }),
      }));
    const ctx = makeLoadContext({
      requestCandidates: [
        'https://primary.example.com/songs.json',
        'https://fallback.example.com/songs.json',
      ],
    });

    const result = await load(ctx);

    expect(result.total).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(ctx.setStoppedStatus).not.toHaveBeenCalled();
  });

  it('load: 通信失敗時は有効なキャッシュを保持して返す', async () => {
    const dataVersion = `sha256:${'d'.repeat(64)}`;
    const payload = {
      items: [{ title: '曲', artist: '歌手' }],
      total: 1,
      schemaVersion: 1,
      dataVersion,
    };
    store.set('songs-cache:test', JSON.stringify({
      etag: '',
      dataVersion,
      payload,
      fetchedAt: 1,
    }));
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    const ctx = makeLoadContext();

    const result = await load(ctx);

    expect(result).toMatchObject({
      total: 1,
      fromCache: true,
      stale: true,
    });
    expect(ctx.setRunningStatus).toHaveBeenCalledWith(1, 1);
    expect(ctx.setStoppedStatus).not.toHaveBeenCalled();
    expect(store.has('songs-cache:test')).toBe(true);
  });

  function makeLoadContext(overrides = {}) {
    return {
      setLoadingStatus: vi.fn(),
      clearErrorLog: vi.fn(),
      setErrorLog: vi.fn(),
      setStoppedStatus: vi.fn(),
      setRunningStatus: vi.fn(),
      filterItems: (items) => items,
      render: vi.fn(),
      headersToObject: () => ({}),
      clipText: (value) => String(value),
      cacheKey: () => 'songs-cache:test',
      cacheMaxAgeMs: 0,
      requestTimeoutMs: 50,
      requestCandidates: ['https://cdn.example.com/songs.json'],
      rows: { innerHTML: '' },
      ...overrides,
    };
  }
});
