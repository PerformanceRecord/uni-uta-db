import { describe, expect, it, vi } from 'vitest';
import {
  copyTextToClipboard,
  insertTextIntoMemo,
} from '../src/platform/clipboard.js';

describe('clipboard', () => {
  it('Clipboard APIで前後空白を除いた文字列をコピーする', async () => {
    const writeText = vi.fn(async () => {});

    await expect(copyTextToClipboard('  text  ', {
      navigatorRef: { clipboard: { writeText } },
    })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('text');
  });

  it('Clipboard API失敗時はtextarea方式へフォールバックする', async () => {
    const textarea = {
      value: '',
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      parentNode: null,
    };
    const body = {
      appendChild: vi.fn((element) => {
        element.parentNode = body;
      }),
      removeChild: vi.fn((element) => {
        element.parentNode = null;
      }),
    };
    const documentRef = {
      body,
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => true),
    };

    const copied = await copyTextToClipboard('text', {
      navigatorRef: {
        clipboard: { writeText: vi.fn(async () => { throw new Error(); }) },
      },
      documentRef,
    });

    expect(copied).toBe(true);
    expect(documentRef.execCommand).toHaveBeenCalledWith('copy');
    expect(body.removeChild).toHaveBeenCalledWith(textarea);
  });

  it('insertTextIntoMemo: 現在の選択範囲へ文字列を挿入する', () => {
    const inputEvent = {};
    const memoInput = {
      value: 'abcd',
      selectionStart: 1,
      selectionEnd: 3,
      setRangeText: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    const EventCtor = vi.fn(() => inputEvent);

    expect(insertTextIntoMemo(memoInput, 'X', { EventCtor })).toBe(true);
    expect(memoInput.setRangeText).toHaveBeenCalledWith('X', 1, 3, 'end');
    expect(memoInput.dispatchEvent).toHaveBeenCalledWith(inputEvent);
  });
});
