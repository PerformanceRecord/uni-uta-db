import { describe, expect, it } from 'vitest';
import {
  clampSwipeIndex,
  resolveSwipeIndex,
} from '../src/ui/swipeTrack.js';

describe('swipeTrack', () => {
  it('カードindexを0〜1へ制限する', () => {
    expect(clampSwipeIndex(-1)).toBe(0);
    expect(clampSwipeIndex(0.5)).toBe(0.5);
    expect(clampSwipeIndex(2)).toBe(1);
  });

  it('閾値を超えた横移動だけカードを切り替える', () => {
    expect(resolveSwipeIndex({
      current: 0,
      deltaX: -60,
      threshold: 54,
    })).toBe(1);
    expect(resolveSwipeIndex({
      current: 1,
      deltaX: 60,
      threshold: 54,
    })).toBe(0);
    expect(resolveSwipeIndex({
      current: 0,
      deltaX: -54,
      threshold: 54,
    })).toBe(0);
  });
});
