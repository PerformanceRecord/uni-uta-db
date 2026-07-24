import { describe, expect, it } from 'vitest';
import {
  extractVideoPreview,
  getSongCardToggleState,
} from '../src/ui/renderSongs.js';

describe('song card preview', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abc123', 'abc123'],
    ['https://youtu.be/abc123?t=10', 'abc123'],
    ['https://www.youtube.com/shorts/abc123', 'abc123'],
  ])('YouTube URLからサムネイルを生成する: %s', (url, videoId) => {
    expect(extractVideoPreview(url)).toMatchObject({
      type: 'YouTube',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  });

  it('動画でないURLにはサムネイルを生成しない', () => {
    expect(extractVideoPreview('https://example.com/watch?v=abc123')).toBeNull();
  });

  it('モバイルではカード展開と同時にサムネイルを表示する', () => {
    expect(getSongCardToggleState({
      expanded: false,
      mobile: true,
      hasPreview: true,
    })).toEqual({
      expanded: true,
      previewVisible: true,
    });
  });

  it('サムネイルのないカードはモバイルでも詳細だけを展開する', () => {
    expect(getSongCardToggleState({
      expanded: false,
      mobile: true,
      hasPreview: false,
    })).toEqual({
      expanded: true,
      previewVisible: false,
    });
  });

  it('PCでは従来どおりサムネイルを自動表示しない', () => {
    expect(getSongCardToggleState({
      expanded: false,
      mobile: false,
      hasPreview: true,
    })).toEqual({
      expanded: true,
      previewVisible: false,
    });
  });

  it('展開済みカードの再操作では詳細とサムネイルを閉じる', () => {
    expect(getSongCardToggleState({
      expanded: true,
      mobile: true,
      hasPreview: true,
    })).toEqual({
      expanded: false,
      previewVisible: false,
    });
  });
});
