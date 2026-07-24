import { describe, expect, it, vi } from 'vitest';
import {
  computeBubbleCount,
  computeBubbleIntensity,
  createScrollBubbles,
} from '../src/features/scrollBubbles.js';

describe('scrollBubbles', () => {
  it('移動距離・経過時間・カード高から強度を計算する', () => {
    expect(computeBubbleIntensity(44, 16, 44)).toBeCloseTo(1.6875);
    expect(computeBubbleIntensity(-10, 0, 0)).toBe(0);
  });

  it('通常・burstの個数と上限を計算する', () => {
    expect(computeBubbleCount({
      mode: 'normal',
      intensity: 2,
      activeCount: 0,
    })).toBe(5);
    expect(computeBubbleCount({
      mode: 'burst',
      intensity: 10,
      activeCount: 88,
    })).toBe(2);
  });

  it('上限の空き枠だけDOMへ追加する', () => {
    const bubbles = [];
    const fragment = {
      appendChild: (bubble) => bubbles.push(bubble),
    };
    const documentRef = {
      createDocumentFragment: () => fragment,
      createElement: () => ({
        className: '',
        style: {},
        remove: vi.fn(),
      }),
    };
    const container = {
      childElementCount: 3,
      appendChild: vi.fn(),
    };
    const windowRef = { setTimeout: vi.fn() };

    expect(createScrollBubbles({
      container,
      mode: 'burst',
      intensity: 10,
      documentRef,
      windowRef,
      random: () => 0.5,
      maxBubbles: 5,
    })).toBe(2);
    expect(bubbles).toHaveLength(2);
    expect(container.appendChild).toHaveBeenCalledWith(fragment);
    expect(windowRef.setTimeout).toHaveBeenCalledTimes(2);
  });
});
