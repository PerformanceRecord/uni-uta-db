import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isSameOriginRequest, loadCache, saveCache, clearApiCache } from '../src/data/songsApi.js';

describe('songsApi utility functions', () => {
  beforeEach(() => {
    vi.stubGlobal('location', {
      href: 'https://example.com/app',
      origin: 'https://example.com',
    });

    const store = new Map();
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
});
