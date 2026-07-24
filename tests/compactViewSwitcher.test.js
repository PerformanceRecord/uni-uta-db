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

describe('compact browser view switcher', () => {
  it('上部と下部に2画面の切り替えボタンを持つ', () => {
    expect(indexHtml).toContain('id="topViewSwitcher"');
    expect(indexHtml).toContain('id="bottomViewSwitcher"');
    expect(indexHtml.match(/data-card-index="0"/g)).toHaveLength(2);
    expect(indexHtml.match(/data-card-index="1"/g)).toHaveLength(2);
  });

  it('縮小ブラウザのマウス操作時だけ表示する', () => {
    expect(styles).toContain(
      '@media (max-width: 1099px) and (pointer: fine)',
    );
    expect(styles).toMatch(
      /\.compact-view-switch\s*\{\s*display:\s*none;/,
    );
  });
});
