import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(
  new URL('../index.html', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('../assets/styles.css', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../src/app.js', import.meta.url),
  'utf8',
);

describe('lightweight decorative effects', () => {
  it('水面光は全レイアウト共通の静的レイヤーである', () => {
    expect(indexHtml).toContain('class="water-light"');
    expect(styles).toContain('.water-light {');
    expect(styles).not.toMatch(/\.water-light\s*\{[^}]*animation:/s);
  });

  it('操作演出はモバイル効果クラス配下へ限定する', () => {
    expect(appSource).toContain(
      "document.body.classList.toggle('mobile-effects', enabled)",
    );
    expect(styles).toContain(
      '.mobile-effects .song-card.tap-ripple .song-card-main::after',
    );
    expect(styles).toContain('.mobile-effects .search-match');
    expect(styles).toContain('.mobile-effects .skeleton-card');
    expect(styles).toContain('.mobile-effects .mobile-scroll-progress');
  });

  it('視差に弱い利用者向けに追加アニメーションを停止する', () => {
    const reducedMotionStart = styles.lastIndexOf(
      '@media (prefers-reduced-motion: reduce)',
    );
    const reducedMotionStyles = styles.slice(reducedMotionStart);
    expect(reducedMotionStyles).toContain(
      '.mobile-effects .song-card.tap-ripple .song-card-main::after',
    );
    expect(reducedMotionStyles).toContain('animation: none !important;');
  });

  it('リリース資産はv11で統一する', () => {
    expect(indexHtml).toContain('assets/styles.css?v=11');
    expect(indexHtml).toContain('./src/app.js?v=11');
  });
});
