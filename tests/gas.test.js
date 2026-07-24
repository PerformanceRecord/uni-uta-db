import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const gasSource = readFileSync(
  new URL('../gas/Code.gs', import.meta.url),
  'utf8',
);
const sheetScriptSource = readFileSync(
  new URL('../sheet_scripts/performance_record.gs', import.meta.url),
  'utf8',
);

function loadScript(source, globals = {}) {
  const context = {
    console: {
      error: vi.fn(),
      log: vi.fn(),
    },
    ...globals,
  };
  vm.runInNewContext(source, context);
  return context;
}

function createRichText(url = '') {
  return {
    getLinkUrl: () => url,
    getRuns: () => [],
  };
}

function createSpreadsheet(rows, {
  richUrls = [],
  formulas = [],
  lastColumn = 6,
} = {}) {
  const richTexts = rows.map((row, rowIndex) => (
    row.map((_, columnIndex) => (
      createRichText(columnIndex === 3 ? richUrls[rowIndex] || '' : '')
    ))
  ));
  const formulaRows = rows.map((row, rowIndex) => (
    row.map((_, columnIndex) => (
      columnIndex === 3 ? formulas[rowIndex] || '' : ''
    ))
  ));
  const range = {
    getDisplayValues: () => rows,
    getRichTextValues: () => richTexts,
    getFormulas: () => formulaRows,
  };
  const sheet = {
    getLastRow: () => 3 + rows.length,
    getLastColumn: () => lastColumn,
    getRange: vi.fn(() => range),
  };
  const spreadsheet = {
    getSheetByName: vi.fn(() => sheet),
  };
  return { range, sheet, spreadsheet };
}

function createContentService() {
  return {
    MimeType: {
      JSON: 'application/json',
      TEXT: 'text/plain',
    },
    createTextOutput: (text) => ({
      text,
      mimeType: '',
      setMimeType(mimeType) {
        this.mimeType = mimeType;
        return this;
      },
    }),
  };
}

describe('gas/Code.gs', () => {
  it('4行目から掲載対象だけを読み、歌ってみたをliveより優先する', () => {
    const { spreadsheet, sheet } = createSpreadsheet([
      [
        'アイナ・ジ・エンド',
        '革命道中 - On The Way',
        '歌ってみた',
        '20260412 革命道中 - On The Way',
        '',
        'TRUE',
      ],
      [
        '歌手',
        '歌枠曲',
        '歌枠',
        '20260627 歌枠タイトル',
        '',
        '✅',
      ],
      ['非掲載', '曲', 'ショート', '20260701', '', ''],
    ], {
      richUrls: [
        'https://www.youtube.com/watch?v=cover',
        'https://www.youtube.com/watch?v=live',
        '',
      ],
    });
    const gas = loadScript(gasSource);

    const payload = gas.buildSongsPayload_(spreadsheet);

    expect(sheet.getRange).toHaveBeenCalledWith(4, 1, 3, 6);
    expect(payload.total).toBe(2);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.items[0]).toMatchObject({
      kind: 'cover',
      lastSungDate: '2026-04-12',
      liveLink: 'https://www.youtube.com/watch?v=cover',
    });
    expect(payload.items[1]).toMatchObject({
      kind: 'live',
      lastSungDate: '2026-06-27',
    });
  });

  it('チェック済み行の必須項目欠損を拒否する', () => {
    const { spreadsheet } = createSpreadsheet([
      ['歌手', '', '歌枠', '20260627', '', 'TRUE'],
    ]);
    const gas = loadScript(gasSource);

    expect(() => gas.buildSongsPayload_(spreadsheet)).toThrow(
      'Checked row 4 requires both artist (A) and title (B)',
    );
  });

  it('NFKC・大文字小文字・空白を正規化して重複を拒否する', () => {
    const { spreadsheet } = createSpreadsheet([
      ['ＡＲＴＩＳＴ', 'Song  Title', '歌ってみた', '20260412', '', 'TRUE'],
      ['artist', 'Song Title', '歌枠', '20260627', '', 'TRUE'],
    ]);
    const gas = loadScript(gasSource);

    expect(() => gas.buildSongsPayload_(spreadsheet)).toThrow(
      'Duplicate song identity at rows 4 and 5',
    );
  });

  it('存在しない日付とHTTP以外のRichText URLを受理しない', () => {
    const invalidDate = createSpreadsheet([
      ['歌手', '曲', '歌枠', '20260230 配信', '', 'TRUE'],
    ]);
    const gas = loadScript(gasSource);

    expect(() => gas.buildSongsPayload_(invalidDate.spreadsheet)).toThrow(
      'Invalid YYYYMMDD date at row 4',
    );

    const invalidUrl = createSpreadsheet([
      ['歌手', '曲', '歌ってみた', '20260228 投稿', '', 'TRUE'],
    ], {
      richUrls: ['javascript:alert(1)'],
    });
    const payload = gas.buildSongsPayload_(invalidUrl.spreadsheet);
    expect(payload.items[0].liveLink).toBe('');
  });

  it('ビルド失敗時も診断可能なJSONを返す', () => {
    const contentService = createContentService();
    const gas = loadScript(gasSource, {
      ContentService: contentService,
      SpreadsheetApp: {
        getActiveSpreadsheet: () => ({
          getSheetByName: () => null,
        }),
      },
    });

    const response = gas.doGet({ parameter: { api: 'songs' } });
    const payload = JSON.parse(response.text);

    expect(response.mimeType).toBe('application/json');
    expect(payload).toMatchObject({
      error: {
        code: 'SONGS_BUILD_FAILED',
        message: 'Sheet not found: Performance Record',
      },
      schemaVersion: 1,
    });
  });

  it('Script PropertiesのSPREADSHEET_IDを優先する', () => {
    const openedSpreadsheet = {};
    const openById = vi.fn(() => openedSpreadsheet);
    const gas = loadScript(gasSource, {
      SpreadsheetApp: {
        getActiveSpreadsheet: () => null,
        openById,
      },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: () => 'configured-id',
        }),
      },
    });

    expect(gas.getSpreadsheet_()).toBe(openedSpreadsheet);
    expect(openById).toHaveBeenCalledWith('configured-id');
  });
});

describe('sheet_scripts/performance_record.gs', () => {
  it('歌ってみた > 歌枠 > ショートの優先順位を維持する', () => {
    const script = loadScript(sheetScriptSource);

    expect(script._detectSourceRank_('cover')).toBe(300);
    expect(script._detectSourceRank_('配信')).toBe(200);
    expect(script._detectSourceRank_('shorts')).toBe(100);
    expect(script._compareBetterSongRecord_(
      { sourceRank: 300, songDateNum: 20260412, updatedMs: 1, row: 5 },
      { sourceRank: 200, songDateNum: 20260627, updatedMs: 2, row: 4 },
    )).toBeGreaterThan(0);
  });

  it('同じカテゴリではD列日付が新しい行だけを残す', () => {
    const script = loadScript(sheetScriptSource);
    const older = {
      sourceRank: 200,
      songDateNum: 20260101,
      updatedMs: 10,
      row: 4,
    };
    const newer = {
      sourceRank: 200,
      songDateNum: 20260627,
      updatedMs: 1,
      row: 5,
    };

    expect(script._compareBetterSongRecord_(newer, older)).toBeGreaterThan(0);
    expect(script._compareBetterSongRecord_(older, newer)).toBeLessThan(0);
  });

  it('同一URLでも同カテゴリなら新しい日付を優先する', () => {
    const script = loadScript(sheetScriptSource);
    const older = {
      sourceRank: 100,
      songDateNum: 20250101,
      updatedMs: 10,
      row: 4,
      linkUrl: 'https://example.com/video',
    };
    const newer = {
      sourceRank: 100,
      songDateNum: 20260101,
      updatedMs: 20,
      row: 5,
      linkUrl: 'https://example.com/video',
    };

    expect(script._compareBetterSongRecord_(newer, older)).toBeGreaterThan(0);
  });

  it('歌ってみたがあれば新しい歌枠・ショートを全て履歴対象にする', () => {
    const script = loadScript(sheetScriptSource);
    const cover = {
      id: 'cover',
      row: 4,
      sourceRank: 300,
      songDateNum: 20240101,
      updatedMs: 1,
    };
    const live = {
      id: 'live',
      row: 5,
      sourceRank: 200,
      songDateNum: 20260627,
      updatedMs: 2,
    };
    const short = {
      id: 'short',
      row: 6,
      sourceRank: 100,
      songDateNum: 20260701,
      updatedMs: 3,
    };

    const selection = script._selectSongGroup_([live, short, cover]);

    expect(selection.keeper.id).toBe('cover');
    expect(Array.from(selection.archived, item => item.id).sort()).toEqual([
      'live',
      'short',
    ]);
  });

  it('歌ってみたがなければ最新の歌枠、歌枠もなければ最新ショートを残す', () => {
    const script = loadScript(sheetScriptSource);
    const olderLive = {
      id: 'old-live',
      row: 4,
      sourceRank: 200,
      songDateNum: 20250101,
      updatedMs: 1,
    };
    const newerLive = {
      id: 'new-live',
      row: 5,
      sourceRank: 200,
      songDateNum: 20260101,
      updatedMs: 2,
    };
    const newestShort = {
      id: 'new-short',
      row: 6,
      sourceRank: 100,
      songDateNum: 20260701,
      updatedMs: 3,
    };
    const oldShort = {
      id: 'old-short',
      row: 7,
      sourceRank: 100,
      songDateNum: 20240101,
      updatedMs: 4,
    };

    expect(
      script._selectSongGroup_([oldShort, newestShort, olderLive, newerLive])
        .keeper.id,
    ).toBe('new-live');
    expect(
      script._selectSongGroup_([oldShort, newestShort]).keeper.id,
    ).toBe('new-short');
  });

  it('履歴へ移す行から欠けているE列と有効なF列を継承する', () => {
    const script = loadScript(sheetScriptSource);
    const sourceRich = { id: 'source-link' };
    const keeper = {
      row: 4,
      sourceRank: 300,
      songDateNum: 20260412,
      updatedMs: 1,
      sourceValue: '',
      publishedValue: false,
    };
    const archived = [{
      row: 5,
      sourceRank: 200,
      songDateNum: 20260627,
      updatedMs: 2,
      sourceValue: '動画履歴チェック',
      sourceRich,
      publishedValue: '✅',
    }];

    expect(script._buildKeeperInheritance_(keeper, archived)).toMatchObject({
      keeperRow: 4,
      sourceValue: '動画履歴チェック',
      sourceRich,
      publishedValue: true,
      sourceChanged: true,
      publishedChanged: true,
    });
  });

  it('残す行にE列情報がある場合は下位行で上書きしない', () => {
    const script = loadScript(sheetScriptSource);
    const keeper = {
      row: 4,
      sourceRank: 300,
      songDateNum: 20260412,
      updatedMs: 1,
      sourceValue: '歌ってみた出典',
      publishedValue: true,
    };
    const archived = [{
      row: 5,
      sourceRank: 200,
      songDateNum: 20260627,
      updatedMs: 2,
      sourceValue: '歌枠出典',
      publishedValue: false,
    }];

    expect(script._buildKeeperInheritance_(keeper, archived)).toMatchObject({
      sourceValue: '歌ってみた出典',
      publishedValue: true,
      sourceChanged: false,
      publishedChanged: false,
    });
  });

  it('A/Bが揃った新規行の空F列だけをTRUEにする', () => {
    const script = loadScript(sheetScriptSource);
    const rows = [
      ['Artist', 'Song', '', '', '', ''],
      ['Artist', 'Explicitly hidden', '', '', '', false],
      ['', '', '', '', '', ''],
    ];
    const setValues = vi.fn();
    const sheet = {
      getRange: vi.fn((row, column, numRows, numColumns) => {
        if (column === 1 && numColumns === 6) {
          return { getValues: () => rows };
        }
        if (column === 6 && numColumns === 1) {
          return { setValues };
        }
        throw new Error(`Unexpected range: ${row},${column},${numRows},${numColumns}`);
      }),
    };

    expect(script._applyDefaultPublishChecks_(sheet, 4, 6)).toBe(1);
    expect(setValues).toHaveBeenCalledWith([
      [true],
      [false],
      [''],
    ]);
  });

  it('A:Gをまとめて貼り付けた場合も新規行のF列をTRUEにする', () => {
    const script = loadScript(sheetScriptSource);
    const setValues = vi.fn();
    const sheet = {
      getName: () => 'Performance Record',
      getRange: vi.fn((row, column, numRows, numColumns) => {
        if (column === 1 && numColumns === 6) {
          return {
            getValues: () => [['Artist', 'Song', '歌枠', '20260101', '', '']],
          };
        }
        if (column === 6 && numColumns === 1) {
          return { setValues };
        }
        throw new Error(`Unexpected range: ${row},${column},${numRows},${numColumns}`);
      }),
    };
    const event = {
      range: {
        getSheet: () => sheet,
        getRow: () => 4,
        getNumRows: () => 1,
        getColumn: () => 1,
        getNumColumns: () => 7,
      },
    };

    script.onEdit(event);

    expect(setValues).toHaveBeenCalledWith([[true]]);
  });

  it('既存行のC〜Fだけを編集しても空の掲載チェックを自動変更しない', () => {
    const script = loadScript(sheetScriptSource);
    const dateSetValues = vi.fn();
    const publishSetValues = vi.fn();
    const sheet = {
      getName: () => 'Performance Record',
      getRange: vi.fn((row, column) => {
        if (column === 6) return { setValues: publishSetValues };
        if (column === 7) {
          return {
            setValues: dateSetValues,
            setNumberFormat: vi.fn(),
          };
        }
        throw new Error(`Unexpected range: ${row},${column}`);
      }),
    };
    const event = {
      range: {
        getSheet: () => sheet,
        getRow: () => 4,
        getNumRows: () => 1,
        getColumn: () => 3,
        getNumColumns: () => 3,
      },
    };

    script.onEdit(event);

    expect(publishSetValues).not.toHaveBeenCalled();
    expect(dateSetValues).toHaveBeenCalledTimes(1);
  });

  it('Performance RecordをB昇順・A昇順・D降順で行全体ソートする', () => {
    const script = loadScript(sheetScriptSource);
    const sort = vi.fn();
    const sheet = {
      getLastRow: () => 8,
      getLastColumn: () => 9,
      getRange: vi.fn(() => ({ sort })),
    };

    expect(script._sortPerformanceRecordRows_(sheet)).toBe(5);
    expect(sheet.getRange).toHaveBeenCalledWith(4, 1, 5, 9);
    expect(JSON.parse(JSON.stringify(sort.mock.calls[0][0]))).toEqual([
      { column: 2, ascending: true },
      { column: 1, ascending: true },
      { column: 4, ascending: false },
    ]);
  });

  it('APIと同じ規則で重複キーを正規化する', () => {
    const script = loadScript(sheetScriptSource);

    expect(script._normalizeSongKeyText_(' ＡＲＴＩＳＴ　Name ')).toBe(
      'artist name',
    );
  });
});
