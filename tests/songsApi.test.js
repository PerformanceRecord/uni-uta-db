import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearApiCache, isSameOriginRequest, loadCache, saveCache } from '../src/data/songsApi.js';

describe('songsApi helpers', () => {
  const cacheName = 'unit-test-cache';
  const cacheKey = () => cacheName;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('saveCache / loadCache / clearApiCache が動作する', () => {
    const entry = { etag: 'abc', payload: { items: [{ title: 'x' }] }, fetchedAt: 1 };

    saveCache(entry, { cacheKey });
    expect(loadCache({ cacheKey })).toEqual(entry);

    clearApiCache({ cacheKey });
    expect(loadCache({ cacheKey })).toBeNull();
  });

  it('loadCacheはJSONが壊れていてもnullを返す', () => {
    localStorage.setItem(cacheName, '{bad json');
    expect(loadCache({ cacheKey })).toBeNull();
  });

  it('isSameOriginRequest が同一オリジン判定する', () => {
    expect(isSameOriginRequest('/songs.json')).toBe(true);
    expect(isSameOriginRequest('https://example.com/songs.json')).toBe(false);
  });
});
