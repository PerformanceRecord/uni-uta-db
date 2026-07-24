import { describe, expect, it } from 'vitest';
import {
  bestExternalUrl,
  filterSongItems,
  fmtDate,
  isPlaceholderUrl,
  kindForFilter,
  normalizeKind,
  resolveSingingTag,
  sortSongItems,
  stableSongId,
} from '../src/domain/songCatalog.js';

const songs = [
  {
    title: 'Beta Song',
    artist: 'Artist B',
    memo: '歌枠',
    singingTag: '歌枠',
    kind: 'live',
    publishedAt: '2026-06-27',
  },
  {
    title: 'Alpha Song',
    artist: 'Artist A',
    memo: '歌ってみた',
    singingTag: '歌ってみた',
    kind: 'live',
    publishedAt: '2026-04-12',
  },
  {
    title: 'Short Song',
    artist: 'Artist C',
    memo: 'ショート',
    singingTag: 'ショート',
    kind: 'short',
    publishedAt: '2026-07-01',
  },
];

describe('songCatalog', () => {
  it.each([
    ['cover', 'cover'],
    ['歌ってみた', 'cover'],
    ['歌みた', 'cover'],
    ['short', 'short'],
    ['ショート動画', 'short'],
    ['stream', 'live'],
    ['歌枠', 'live'],
    ['', 'live'],
    ['unknown', 'live'],
  ])('normalizeKind(%s) -> %s', (input, expected) => {
    expect(normalizeKind(input)).toBe(expected);
  });

  it('resolveSingingTag: 表示ラベルを既存仕様どおり正規化する', () => {
    expect(resolveSingingTag('歌ってみた')).toEqual({
      kind: 'cover',
      label: '歌ってみた',
    });
    expect(resolveSingingTag('ショート')).toEqual({
      kind: 'short',
      label: 'ショート',
    });
    expect(resolveSingingTag('歌枠')).toEqual({
      kind: 'live',
      label: '',
    });
    expect(resolveSingingTag('歌ってみた,ショート')).toEqual({
      kind: 'cover',
      label: '歌ってみた',
    });
  });

  it('kindForFilter: GASのkindよりsingingTagを優先する', () => {
    expect(kindForFilter({
      kind: 'live',
      singingTag: '歌ってみた',
    })).toBe('cover');
  });

  it('bestExternalUrl: 直接URL、HTMLリンク、文中URLを抽出する', () => {
    expect(bestExternalUrl(' https://example.org/direct ')).toBe(
      'https://example.org/direct',
    );
    expect(bestExternalUrl(
      '<a href="https://example.org/from-html">link</a>',
    )).toBe('https://example.org/from-html');
    expect(bestExternalUrl(
      '視聴先 https://example.org/from-text です',
    )).toBe('https://example.org/from-text');
    expect(bestExternalUrl('javascript:alert(1)')).toBe('');
  });

  it('stableSongId: 識別子をURL安全な固定形式で生成する', () => {
    expect(stableSongId({
      videoId: 'abc 123',
      title: '曲名 / Song',
      artist: '歌手',
    })).toBe('abc%20123|%E6%9B%B2%E5%90%8D%20%2F%20Song|%E6%AD%8C%E6%89%8B');
  });

  it('sortSongItems: 入力配列を変更せず指定順に並べる', () => {
    const originalTitles = songs.map((item) => item.title);
    const sorted = sortSongItems(songs, 'date-desc');

    expect(sorted.map((item) => item.title)).toEqual([
      'Short Song',
      'Beta Song',
      'Alpha Song',
    ]);
    expect(songs.map((item) => item.title)).toEqual(originalTitles);
  });

  it('filterSongItems: 種別・検索・並び順をまとめて適用する', () => {
    const result = filterSongItems(songs, {
      q: 'artist a',
      kinds: ['cover'],
      sortMode: 'title-asc',
    });

    expect(result.map((item) => item.title)).toEqual(['Alpha Song']);
  });

  it('fmtDate: 空値と不正値を従来どおり扱う', () => {
    expect(fmtDate('')).toBe('-');
    expect(fmtDate('not-a-date')).toBe('not-a-date');
  });

  it('isPlaceholderUrl: 未設定用URLを除外する', () => {
    expect(isPlaceholderUrl('https://pub-xxxxxxxx.r2.dev/songs.json')).toBe(true);
    expect(isPlaceholderUrl('https://example.com/songs.json')).toBe(true);
    expect(isPlaceholderUrl('https://data.example.net/songs.json')).toBe(false);
  });
});
