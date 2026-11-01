import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStorageItem, writeStorageItem, removeStorageItem } from '../src/platform/storage.js';
import { loadMyDanmakuCache, saveMyDanmakuCache } from '../src/features/danmaku.js';
import { fetchWithTimeout, load } from '../src/data/songsApi.js';
import { extractVideoPreview } from '../src/ui/renderSongs.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('reliability regressions', () => {
  it('localStorage自体を取得できなくても起動を妨げない', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('denied', 'SecurityError'); },
    });
    try {
      expect(readStorageItem('x')).toBeNull();
      expect(writeStorageItem('x', 'y')).toBe(false);
      expect(removeStorageItem('x')).toBe(false);
      expect(loadMyDanmakuCache()).toBe('');
      expect(saveMyDanmakuCache('test')).toBe(false);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete globalThis.localStorage;
    }
  });

  it('ヘッダー受信後に本文が停止してもタイムアウトする', async () => {
    let requestSignal;
    await expect(fetchWithTimeout('https://example.com/songs.json', {}, {
      timeoutMs: 5,
      fetchImpl: async (_, { signal }) => {
        requestSignal = signal;
        return { json: () => new Promise(() => {}) };
      },
      consumeResponse: (response) => response.json(),
    })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(requestSignal.aborted).toBe(true);
  });

  it.each(['json', 'schema', 'body-timeout'])('不正な取得結果から予備へ切り替える: %s', async (failure) => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    const item = { title: '曲', artist: '歌手' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => {
        if (failure === 'json') throw new SyntaxError('invalid');
        if (failure === 'body-timeout') return new Promise(() => {});
        return { items: [], total: 1 };
      } })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => ({ items: [item], total: 1 }) });
    vi.stubGlobal('fetch', fetchMock);
    const render = vi.fn();
    const result = await load({
      setLoadingStatus() {}, clearErrorLog() {}, setErrorLog: vi.fn(),
      setStoppedStatus: vi.fn(), setRunningStatus() {},
      filterItems: (items) => items, render,
      headersToObject: () => ({}), clipText: (value) => value,
      cacheKey: () => 'test', requestTimeoutMs: 5,
      requestCandidates: ['https://primary.example/songs.json', 'https://backup.example/songs.json'],
      rows: { innerHTML: '' },
    });
    expect(result.sourceItems).toEqual([item]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledWith([item], { total: 1 });
  });

  it.each([
    'https://notyoutube.com/watch?v=abc',
    'https://youtube.com.example.com/watch?v=abc',
    'https://notyoutu.be/abc',
    'https://notnicovideo.jp/watch/sm123',
    'ftp://www.youtube.com/watch?v=abc',
  ])('類似ドメインやHTTP以外を動画と誤認しない: %s', (url) => {
    expect(extractVideoPreview(url)).toBeNull();
  });
});
