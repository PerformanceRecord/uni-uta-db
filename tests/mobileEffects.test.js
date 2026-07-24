import { describe, expect, it, vi } from 'vitest';
import {
  calculateScrollProgress,
  playMobileCardRipple,
  renderMobileLoadingSkeleton,
  showMobileCopyFeedback,
  updateMobileScrollProgress,
} from '../src/ui/mobileEffects.js';

function createClassList() {
  const values = new Set();
  return {
    add: vi.fn((value) => values.add(value)),
    remove: vi.fn((value) => values.delete(value)),
    toggle: vi.fn((value, enabled) => {
      if (enabled) values.add(value);
      else values.delete(value);
    }),
    contains: (value) => values.has(value),
  };
}

describe('mobile effects', () => {
  it('スクロール範囲に対する進捗を0〜1へ正規化する', () => {
    expect(calculateScrollProgress({
      scrollTop: 250,
      scrollHeight: 1000,
      clientHeight: 500,
    })).toBe(0.5);
    expect(calculateScrollProgress({
      scrollTop: 900,
      scrollHeight: 1000,
      clientHeight: 500,
    })).toBe(1);
    expect(calculateScrollProgress({
      scrollTop: 0,
      scrollHeight: 400,
      clientHeight: 500,
    })).toBe(0);
  });

  it('モバイルでスクロール可能な場合だけ水位線を表示する', () => {
    const classList = createClassList();
    const style = { setProperty: vi.fn() };
    const progress = updateMobileScrollProgress({
      rows: { scrollTop: 200, scrollHeight: 800, clientHeight: 400 },
      progressElement: { classList, style },
      enabled: true,
    });

    expect(progress).toBe(0.5);
    expect(style.setProperty).toHaveBeenCalledWith(
      '--list-scroll-progress',
      '0.5',
    );
    expect(classList.toggle).toHaveBeenCalledWith('visible', true);
  });

  it('既存表示が空のモバイルだけにスケルトンを描画する', () => {
    const rows = {
      childElementCount: 0,
      innerHTML: '',
      setAttribute: vi.fn(),
    };

    expect(renderMobileLoadingSkeleton({
      rows,
      enabled: true,
      cardCount: 3,
    })).toBe(true);
    expect(rows.innerHTML.match(/skeleton-card/g)).toHaveLength(3);
    expect(rows.setAttribute).toHaveBeenCalledWith('aria-busy', 'true');
  });

  it('タップ位置をCSS変数へ設定して水紋を再生する', () => {
    const classList = createClassList();
    const style = { setProperty: vi.fn() };
    const card = {
      classList,
      offsetWidth: 320,
      style,
      getBoundingClientRect: () => ({
        left: 10,
        top: 20,
        width: 320,
        height: 90,
      }),
    };

    expect(playMobileCardRipple({
      card,
      event: { clientX: 50, clientY: 60 },
      enabled: true,
    })).toBe(true);
    expect(style.setProperty).toHaveBeenCalledWith('--tap-ripple-x', '40px');
    expect(style.setProperty).toHaveBeenCalledWith('--tap-ripple-y', '40px');
    expect(classList.add).toHaveBeenCalledWith('tap-ripple');
  });

  it('コピー成功の反応はモバイル時だけ対象コンテナへ付ける', () => {
    const classList = createClassList();
    const feedbackTarget = { classList, offsetWidth: 100 };
    const target = { closest: vi.fn(() => feedbackTarget) };

    expect(showMobileCopyFeedback({
      target,
      enabled: true,
    })).toBe(true);
    expect(classList.add).toHaveBeenCalledWith('copy-success');
    expect(showMobileCopyFeedback({
      target,
      enabled: false,
    })).toBe(false);
  });
});

