import { describe, expect, it } from 'vitest';
import { escapeHtml, extractVideoPreview } from '../src/ui/renderSongs.js';

describe('escapeHtml', () => {
  it('HTML特殊文字をエスケープする', () => {
    expect(escapeHtml(`<tag "quote" 'single' &`)).toBe('&lt;tag &quot;quote&quot; &#39;single&#39; &amp;');
  });
});

describe('extractVideoPreview', () => {
  it('YouTube URLからサムネイル情報を生成する', () => {
    const preview = extractVideoPreview('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(preview).not.toBeNull();
    expect(preview.type).toBe('YouTube');
    expect(preview.thumbnailUrl).toContain('/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('ニコニコ動画URLからサムネイル情報を生成する', () => {
    const preview = extractVideoPreview('https://www.nicovideo.jp/watch/sm9');

    expect(preview).not.toBeNull();
    expect(preview.type).toBe('ニコニコ動画');
    expect(preview.thumbnailUrl).toContain('/9/9');
  });

  it('不正URLはnullを返す', () => {
    expect(extractVideoPreview('not-a-url')).toBeNull();
    expect(extractVideoPreview('')).toBeNull();
  });
});
