import { describe, expect, it } from 'vitest';
import {
  clampSwipeIndex,
  resolveSwipeIndex,
  setupSwipeTrack,
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

  it('Pointer Capture API がない環境でもスワイプを完了できる', () => {
    const listeners = {};
    const classNames = new Set();
    const track = {
      style: {},
      classList: {
        add: (name) => classNames.add(name),
        remove: (name) => classNames.delete(name),
      },
      addEventListener: (type, listener) => {
        listeners[type] = listener;
      },
    };
    const swipe = setupSwipeTrack({
      wrap: { clientWidth: 300 },
      track,
    });

    listeners.pointerdown({
      button: 0,
      clientX: 250,
      clientY: 20,
      pointerId: 1,
      pointerType: 'touch',
      target: { closest: () => null },
    });
    listeners.pointermove({
      clientX: 120,
      clientY: 22,
      pointerId: 1,
      preventDefault: () => {},
    });

    expect(() => listeners.pointerup({ pointerId: 1 })).not.toThrow();
    expect(swipe.getCurrent()).toBe(1);
    expect(track.style.transform).toBe('translateX(-50%)');
    expect(classNames.has('dragging')).toBe(false);
  });
});
