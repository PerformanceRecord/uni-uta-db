import { describe, expect, it } from 'vitest';
import {
  calculateMiddlePanelInsets,
  isTopMenuBeyondAutoCollapseBoundary,
  resolveTopMenuCollapsed,
  shouldAutoCollapseTopMenu,
} from '../src/ui/panelLayout.js';

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

  it('モバイルだけで上部メニューの自動折り畳みを有効にする', () => {
    expect(shouldAutoCollapseTopMenu({
      mobileLayout: true,
      compactDesktopLayout: false,
    })).toBe(true);
    expect(shouldAutoCollapseTopMenu({
      mobileLayout: true,
      compactDesktopLayout: true,
    })).toBe(false);
    expect(shouldAutoCollapseTopMenu({
      mobileLayout: false,
      compactDesktopLayout: true,
    })).toBe(false);
  });

  it('モバイルの手動折り畳み状態を自動判定より優先する', () => {
    expect(resolveTopMenuCollapsed({
      autoCollapseEnabled: true,
      manualMode: 'collapsed',
      beyondThreshold: false,
    })).toBe(true);
    expect(resolveTopMenuCollapsed({
      autoCollapseEnabled: true,
      manualMode: 'expanded',
      beyondThreshold: true,
    })).toBe(false);
    expect(resolveTopMenuCollapsed({
      autoCollapseEnabled: true,
      manualMode: '',
      beyondThreshold: true,
    })).toBe(true);
    expect(resolveTopMenuCollapsed({
      autoCollapseEnabled: false,
      manualMode: 'collapsed',
      beyondThreshold: true,
    })).toBe(false);
  });

  it('自動収納後は楽曲一覧が最上端へ着くまで展開しない', () => {
    expect(isTopMenuBeyondAutoCollapseBoundary({
      currentlyCollapsed: false,
      scrollTop: 161,
      collapseThreshold: 160,
      expandThreshold: 1,
    })).toBe(true);
    expect(isTopMenuBeyondAutoCollapseBoundary({
      currentlyCollapsed: true,
      scrollTop: 120,
      collapseThreshold: 160,
      expandThreshold: 1,
    })).toBe(true);
    expect(isTopMenuBeyondAutoCollapseBoundary({
      currentlyCollapsed: true,
      scrollTop: 1,
      collapseThreshold: 160,
      expandThreshold: 1,
    })).toBe(false);
  });
});
