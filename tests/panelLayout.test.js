import { describe, expect, it } from 'vitest';
import { calculateMiddlePanelInsets } from '../src/ui/panelLayout.js';

describe('panel layout', () => {
  it('楽曲領域を上部バーの下、下部バーの上へ収める', () => {
    expect(calculateMiddlePanelInsets({
      viewportHeight: 720,
      topPanelBottom: 180.2,
      bottomPanelTop: 600.4,
      gap: 8,
    })).toEqual({
      top: 189,
      bottom: 128,
    });
  });

  it('不正な負数から負の余白を生成しない', () => {
    expect(calculateMiddlePanelInsets({
      viewportHeight: -1,
      topPanelBottom: -1,
      bottomPanelTop: -1,
      gap: -1,
    })).toEqual({
      top: 0,
      bottom: 0,
    });
  });
});
