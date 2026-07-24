import { describe, expect, it, vi } from 'vitest';
import { debounce, rafThrottle } from '../src/utils/scheduling.js';

describe('scheduling', () => {
  it('debounce: 連続呼び出しを最後の1回へまとめる', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const run = debounce(callback, 120);

    run('first');
    run('second');
    vi.advanceTimersByTime(119);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('second');
    vi.useRealTimers();
  });

  it('debounce: cancelとflushを提供する', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const run = debounce(callback, 120);

    run('cancelled');
    run.cancel();
    vi.runAllTimers();
    expect(callback).not.toHaveBeenCalled();

    run('flushed');
    run.flush();
    expect(callback).toHaveBeenCalledWith('flushed');
    vi.useRealTimers();
  });

  it('rafThrottle: 同一フレームの呼び出しを最後の1回へまとめる', () => {
    const frames = [];
    const callback = vi.fn();
    const run = rafThrottle(callback, {
      requestAnimationFrameFn: (frame) => {
        frames.push(frame);
        return frames.length;
      },
      cancelAnimationFrameFn: vi.fn(),
    });

    run('first');
    run('second');
    expect(frames).toHaveLength(1);
    frames[0]();

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('second');
  });
});
