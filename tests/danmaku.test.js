import { describe, expect, it, vi } from 'vitest';
import {
  buildMyDanmaku,
  buildMyDanmakuPreview,
  loadMyDanmakuCache,
  normalizeMyEmoji,
  sanitizeUtf16,
  saveMyDanmakuCache,
  splitGraphemes,
} from '../src/features/danmaku.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key)),
    values,
  };
}

describe('danmaku', () => {
  it('sanitizeUtf16: 正常なサロゲートペアを保持する', () => {
    expect(sanitizeUtf16('A😀B')).toBe('A😀B');
  });

  it('sanitizeUtf16: 孤立したサロゲートを除去する', () => {
    expect(sanitizeUtf16(`A\uD83DB\uDC00C`)).toBe('ABC');
  });

  it('splitGraphemes: Segmenterがなければコードポイント単位へ戻す', () => {
    expect(splitGraphemes('😀✨', null)).toEqual(['😀', '✨']);
  });

  it('normalizeMyEmoji: 空入力は既定の絵文字へ戻す', () => {
    expect(normalizeMyEmoji('')).toBe('🙂');
    expect(normalizeMyEmoji('\uD83D')).toBe('🙂');
  });

  it('normalizeMyEmoji: 絵文字を最大2書記素に制限する', () => {
    expect(normalizeMyEmoji('👨‍👩‍👧‍👦✨🎤')).toBe('👨‍👩‍👧‍👦✨');
  });

  it('buildMyDanmaku: 現行の弾幕文字列を生成する', () => {
    expect(buildMyDanmaku('🎤')).toBe(
      '🍣🧡🎤🍣🧡🎤🍣🧡🎤👏',
    );
    expect(buildMyDanmakuPreview('🎤')).toBe('🍣🧡🎤');
  });

  it('save/load: 有効期限内の値を保存して取得する', () => {
    const storage = createStorage();

    expect(saveMyDanmakuCache('弾幕', {
      storage,
      cacheKey: 'test',
      ttlMs: 1_000,
      now: () => 5_000,
    })).toBe(true);
    expect(loadMyDanmakuCache({
      storage,
      cacheKey: 'test',
      now: () => 5_999,
    })).toBe('弾幕');

    expect(JSON.parse(storage.values.get('test'))).toEqual({
      value: '弾幕',
      expiresAt: 6_000,
    });
  });

  it('load: 期限切れの値を削除する', () => {
    const storage = createStorage();
    storage.values.set('test', JSON.stringify({
      value: '弾幕',
      expiresAt: 6_000,
    }));

    expect(loadMyDanmakuCache({
      storage,
      cacheKey: 'test',
      now: () => 6_001,
    })).toBe('');
    expect(storage.removeItem).toHaveBeenCalledWith('test');
  });

  it.each([
    ['JSON不正', '{invalid'],
    ['期限不正', JSON.stringify({ value: '弾幕', expiresAt: 'invalid' })],
    ['空文字', JSON.stringify({ value: '', expiresAt: 10_000 })],
  ])('load: %sのキャッシュを破棄する', (_, cachedValue) => {
    const storage = createStorage();
    storage.values.set('test', cachedValue);

    expect(loadMyDanmakuCache({
      storage,
      cacheKey: 'test',
      now: () => 5_000,
    })).toBe('');
    expect(storage.removeItem).toHaveBeenCalledWith('test');
  });

  it('storage障害を呼び出し元へ伝播させない', () => {
    const storage = {
      getItem: () => {
        throw new Error('read failed');
      },
      setItem: () => {
        throw new Error('write failed');
      },
      removeItem: () => {
        throw new Error('remove failed');
      },
    };

    expect(saveMyDanmakuCache('弾幕', { storage })).toBe(false);
    expect(loadMyDanmakuCache({ storage })).toBe('');
  });
});
