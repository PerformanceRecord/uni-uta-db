import { describe, expect, it, vi } from 'vitest';
import {
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from '../src/platform/storage.js';

describe('storage', () => {
  it('保存・読込・削除を共通の安全な境界で扱う', () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };

    expect(writeStorageItem('key', 123, storage)).toBe(true);
    expect(readStorageItem('key', storage)).toBe('123');
    expect(removeStorageItem('key', storage)).toBe(true);
    expect(readStorageItem('key', storage)).toBeNull();
  });

  it('ブラウザがストレージ利用を拒否しても例外を外へ漏らさない', () => {
    const deniedStorage = {
      getItem: vi.fn(() => { throw new DOMException('denied'); }),
      setItem: vi.fn(() => { throw new DOMException('denied'); }),
      removeItem: vi.fn(() => { throw new DOMException('denied'); }),
    };

    expect(readStorageItem('key', deniedStorage)).toBeNull();
    expect(writeStorageItem('key', 'value', deniedStorage)).toBe(false);
    expect(removeStorageItem('key', deniedStorage)).toBe(false);
  });
});
