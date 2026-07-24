import { describe, expect, it } from 'vitest';
import {
  bindViewSwitcher,
  clampSwipeIndex,
  resolveSwipeIndex,
  setupSwipeTrack,
  updateViewSwitcher,
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

  it('画面切り替えボタンの選択状態を更新する', () => {
    const buttons = [0, 1].map((index) => {
      const classNames = new Set();
      return {
        dataset: { cardIndex: String(index) },
        classNames,
        classList: {
          toggle: (name, active) => {
            if (active) classNames.add(name);
            else classNames.delete(name);
          },
        },
        setAttribute: (name, value) => {
          if (name === 'aria-pressed') {
            buttons[index].ariaPressed = value;
          }
        },
      };
    });
    const switcher = {
      querySelectorAll: () => buttons,
    };

    updateViewSwitcher(switcher, 1);

    expect(buttons[0].classNames.has('active')).toBe(false);
    expect(buttons[0].ariaPressed).toBe('false');
    expect(buttons[1].classNames.has('active')).toBe(true);
    expect(buttons[1].ariaPressed).toBe('true');
  });

  it('画面切り替えボタンから対象カードへ移動する', () => {
    const listeners = [];
    const buttons = [0, 1].map((index) => ({
      dataset: { cardIndex: String(index) },
      addEventListener: (type, listener) => {
        if (type === 'click') listeners[index] = listener;
      },
    }));
    const switcher = {
      querySelectorAll: () => buttons,
    };
    const selected = [];

    bindViewSwitcher({
      switcher,
      setCard: (index) => selected.push(index),
    });
    listeners[1]();

    expect(selected).toEqual(['1']);
  });

  it('タッチ操作でもボタン上ではスワイプを開始しない', () => {
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
    setupSwipeTrack({
      wrap: { clientWidth: 300 },
      track,
      allowInteractiveStart: true,
    });

    listeners.pointerdown({
      button: 0,
      clientX: 100,
      clientY: 20,
      pointerId: 1,
      pointerType: 'touch',
      target: {
        closest: (selector) => (
          selector === 'button, a' ? { tagName: 'BUTTON' } : null
        ),
      },
    });

    expect(classNames.has('dragging')).toBe(false);
  });
});
