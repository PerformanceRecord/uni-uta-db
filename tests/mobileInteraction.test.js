import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(
  new URL('../src/app.js', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('../assets/styles.css', import.meta.url),
  'utf8',
);

describe('mobile interactions', () => {
  it('スクロール中に画面外カードを自動で縮めない', () => {
    expect(appSource).not.toContain('collapseExpandedWhenOutOfView');
  });

  it('楽曲一覧内にスクロールを閉じ込めてアンカー補正を無効にする', () => {
    expect(styles).toContain('overflow-anchor: none;');
    expect(styles).toContain('overscroll-behavior-y: contain;');
  });
});
