/***** 既存：リンク変換 用 設定 *****/
const CFG = {
  SHEET_NAME: 'Performance Record', // 対象シート名
  START_ROW: 4,                     // データ開始行（先頭3行をスキップする想定）
  COLUMNS: ['D'],                   // 変換対象列（'C' も足せます: ['C','D']）
  LABEL_MODE: 'AS_IS',              // 'AS_IS'=既存テキスト、'ARROW'=常に「▶前回」
  DRY_RUN: false                    // true で書き換えせずログのみ
};

/***** 追加：日付自動挿入 用 設定 *****/
const CFG_DATE = {
  SHEET_NAME: 'Performance Record', // 日付自動挿入の対象
  HEADER_ROW: 3,                    // 見出し行
  DATA_START_ROW: 4,                // 実データ開始行
  RANGE_COL_START: 1,               // A列
  RANGE_COL_END: 6,                 // F列
  DATE_COL: 7,                      // G列（更新日）
  DATE_FORMAT: 'yyyy-mm-dd'         // 表示形式
};

/***** 追加：エクスポート 用 設定 *****/
const CFG_EXPORT = {
  SHEET_NAME: 'Performance Record', // 抽出元シート
  HEADER_ROW: 3,                    // ヘッダー行（A3:G3）
  DATA_START_ROW: 4,                // データ開始行（A4～）
  COL_START: 1,                     // A列
  COL_END: 7,                       // G列
  DATE_COL: 7,                      // G列（更新日）
  EXPORT_SHEET_BASENAME: 'DB差分',  // 出力シート名の接頭辞
  EXPORT_FILE_BASENAME: '歌唱DB'    // 出力ファイル名の接頭辞
};

/***** 追加：歌唱DB整理 用 設定 *****/
const CFG_SONG_CLEANUP = {
  SHEET_NAME: 'Performance Record',
  HEADER_ROW: 3,      // 見出し行（A3:G3）
  DATA_START_ROW: 4,   // 実データ開始行
  COL_ARTIST: 1,       // A列
  COL_TITLE: 2,        // B列
  COL_NOTE: 3,         // C列（備考）
  COL_LINK: 4,         // D列（歌枠直リンク）
  COL_SOURCE: 5,       // E列（出典元情報）
  COL_PUBLISHED: 6,    // F列（掲載チェック）
  COL_UPDATED: 7,      // G列（最新更新日）
  COL_START: 1,        // A列
  COL_END: 7,          // G列まで取得
  ARCHIVE_SHEET_NAME: '履歴', // 退避先シート
  DRY_RUN: false,
  LOG_LIMIT: 200
};

/***** メニュー（統合版） *****/
function onOpen(){
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('リンク変換')
    .addItem('UIリンク → HYPERLINK() に変換', 'convertUiLinksToHyperlink')
    .addItem('DRY RUN（書き換えなしで確認）', 'dryRun_convert')
    .addToUi();

  ui.createMenu('エクスポート')
    .addItem('更新日でExcel出力', 'showExportDialog')
    .addToUi();

  ui.createMenu('歌唱DB整理')
    .addItem('DRY RUN（削除せず判定だけ）', 'dryRun_cleanupSongRecords')
    .addItem('重複整理を実行', 'cleanupSongRecords')
    .addToUi();
}

function dryRun_convert() {
  CFG.DRY_RUN = true;
  try {
    convertUiLinksToHyperlink();
  } finally {
    CFG.DRY_RUN = false;
  }
}

function dryRun_cleanupSongRecords() {
  CFG_SONG_CLEANUP.DRY_RUN = true;
  try {
    cleanupSongRecords();
  } finally {
    CFG_SONG_CLEANUP.DRY_RUN = false;
  }
}

/***** 本体：リンク変換（既存） *****/
function convertUiLinksToHyperlink() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.SHEET_NAME);
  if (!sh) throw new Error('指定シートが見つかりません: ' + CFG.SHEET_NAME);

  const lastRow = sh.getLastRow();
  if (lastRow < CFG.START_ROW) {
    Logger.log('処理対象がありません。');
    return;
  }

  const colIndexes = CFG.COLUMNS.map(c => letterToColumn(c));
  const numRows = lastRow - CFG.START_ROW + 1;

  let changed = 0;
  const actions = [];

  colIndexes.forEach(col => {
    const rng = sh.getRange(CFG.START_ROW, col, numRows, 1);
    const values = rng.getDisplayValues();
    const formulas = rng.getFormulas();
    const rich = rng.getRichTextValues();

    for (let i = 0; i < numRows; i++) {
      const row = CFG.START_ROW + i;
      const cellVal = values[i][0] || '';
      const cellFormula = formulas[i][0] || '';
      const rtv = rich[i][0];

      if (/^\s*=\s*HYPERLINK\(/i.test(cellFormula)) continue;

      const url = pickUrlFromRich(rtv) || pickUrlFromFormula(cellFormula) || pickUrlFromText(cellVal);
      if (!url) continue;

      const label = CFG.LABEL_MODE === 'ARROW' ? '▶前回' : (cellVal.trim() || url);
      const formula = makeHyperlinkFormula(url, label);

      if (!CFG.DRY_RUN) {
        sh.getRange(row, col).setFormula(formula);
      }
      changed++;
      actions.push(`#${row}${columnToLetter(col)}: "${cellVal}" → ${formula}`);
    }
  });

  Logger.log(`変換完了: ${changed} セル更新${CFG.DRY_RUN ? '（DRY RUN）' : ''}`);
  actions.slice(0, 200).forEach(line => Logger.log(line));
}

/***** 追加：A～F編集時にG列へ日付自動挿入 *****/
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== CFG_DATE.SHEET_NAME) return;

    const rowStart = e.range.getRow();
    const numRows  = e.range.getNumRows();
    const colStart = e.range.getColumn();
    const numCols  = e.range.getNumColumns();
    const colEnd   = colStart + numCols - 1;
    const rowEnd   = rowStart + numRows - 1;

    const writeStartRow = Math.max(rowStart, CFG_DATE.DATA_START_ROW);
    if (writeStartRow > rowEnd) return;

    const intersectsAF = !(colStart > CFG_DATE.RANGE_COL_END || colEnd < CFG_DATE.RANGE_COL_START);
    const intersectsSongIdentity = !(
      colStart > CFG_SONG_CLEANUP.COL_TITLE ||
      colEnd < CFG_SONG_CLEANUP.COL_ARTIST
    );
    if (intersectsSongIdentity) {
      // 新規行でA/Bが揃い、F列が未設定なら掲載対象を既定値にする。
      _applyDefaultPublishChecks_(sh, writeStartRow, rowEnd);
    }

    // G列を人手で編集した時は更新日を書き戻さない。
    if (colStart <= CFG_DATE.DATE_COL && CFG_DATE.DATE_COL <= colEnd) return;
    if (!intersectsAF) return;

    const today = new Date();
    const out = [];
    for (let r = writeStartRow; r <= rowEnd; r++) out.push([today]);

    const rng = sh.getRange(writeStartRow, CFG_DATE.DATE_COL, out.length, 1);
    rng.setValues(out);
    rng.setNumberFormat(CFG_DATE.DATE_FORMAT);
  } catch (err) {
    console.error(err);
  }
}

/***** 追加：更新日指定でExcelダウンロード（要件反映） *****/
// ダイアログ表示
function showExportDialog() {
  const html = HtmlService.createHtmlOutputFromFile('export')
    .setWidth(460)
    .setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, '更新日でExcel出力');
}

// G列（更新日）のユニーク値（yyyy-mm-dd）を新しい順で返す
function getUniqueDates() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG_EXPORT.SHEET_NAME);
  if (!sh) throw new Error('シートが見つかりません: ' + CFG_EXPORT.SHEET_NAME);

  const lastRow = sh.getLastRow();
  if (lastRow < CFG_EXPORT.DATA_START_ROW) return [];

  const rng = sh.getRange(CFG_EXPORT.DATA_START_ROW, CFG_EXPORT.DATE_COL, lastRow - CFG_EXPORT.DATA_START_ROW + 1, 1);
  const vals = rng.getValues().flat();

  const set = new Set();
  for (const v of vals) {
    const d = _toDateOrNull_(v);
    if (!d) continue;
    set.add(_fmtYmd_(d));
  }
  return [...set].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/**
 * 選択日付（yyyy-mm-dd文字列配列）のうち最小日付を基準に抽出。
 * - ヘッダー(A3:G3)をExcelの1行目に設定
 * - 本文は2行目から
 * - C/DはRichTextの本文のみ。Dは文頭8桁を yyyy/mm/dd に整形
 * - ファイル名：歌唱DByyyymmdd.xlsx（yyyymmdd=最小日付）
 * - シート名：DB差分yyyymmdd
 */
function exportSinceDates(selectedDateStrs) {
  if (!Array.isArray(selectedDateStrs) || selectedDateStrs.length === 0) {
    throw new Error('日付が選択されていません。');
  }
  const minStr = selectedDateStrs.reduce((m, x) => (x < m ? x : m));
  const minNum = Number(minStr.replace(/-/g, ''));

  const src = SpreadsheetApp.getActive().getSheetByName(CFG_EXPORT.SHEET_NAME);
  if (!src) throw new Error('シートが見つかりません: ' + CFG_EXPORT.SHEET_NAME);

  const lastRow = src.getLastRow();
  if (lastRow < CFG_EXPORT.DATA_START_ROW) throw new Error('抽出対象データがありません。');

  // 本文(A4:G*)
  const numRows = lastRow - CFG_EXPORT.DATA_START_ROW + 1;
  const dataRange = src.getRange(CFG_EXPORT.DATA_START_ROW, CFG_EXPORT.COL_START, numRows, CFG_EXPORT.COL_END);
  const dataValues = dataRange.getValues();
  const dataRich   = dataRange.getRichTextValues();

  // ヘッダー(A3:G3)
  const header = src.getRange(CFG_EXPORT.HEADER_ROW, CFG_EXPORT.COL_START, 1, CFG_EXPORT.COL_END).getValues()[0];

  // 抽出＆C/D整形
  const filtered = [];
  for (let i = 0; i < dataValues.length; i++) {
    const rowVals = dataValues[i].slice();
    const rowRich = dataRich[i];

    // G列（更新日）判定
    const gVal = rowVals[CFG_EXPORT.DATE_COL - 1];
    const d = _toDateOrNull_(gVal);
    if (!d) continue;
    const ymdNum = Number(_fmtYmd_(d).replace(/-/g, ''));
    if (ymdNum < minNum) continue;

    // C列: RichText本文のみ
    rowVals[2] = _richTextToPlain_(rowRich[2], rowVals[2]);

    // D列: RichText本文→文頭8桁→yyyy/mm/dd
    const dPlain = _richTextToPlain_(rowRich[3], rowVals[3]);
    const m = String(dPlain || '').match(/^(\d{8})/);
    rowVals[3] = m ? _yyyymmddToSlash_(m[1]) : '';

    filtered.push(rowVals);
  }

  // 新規ブック作成
  const yyyymmdd = minStr.replace(/-/g, '');
  const fileTitle = `${CFG_EXPORT.EXPORT_FILE_BASENAME}${yyyymmdd}`;
  const sheetName = `${CFG_EXPORT.EXPORT_SHEET_BASENAME}${yyyymmdd}`;

  const outSS = SpreadsheetApp.create(fileTitle);
  const outSh = outSS.getActiveSheet();
  outSh.setName(sheetName);

  // ヘッダー1行目、本文2行目以降に出力
  if (header && header.length) {
    outSh.getRange(1, 1, 1, header.length).setValues([header]);
  }
  if (filtered.length > 0) {
    outSh.getRange(2, 1, filtered.length, filtered[0].length).setValues(filtered);
  }
  outSh.autoResizeColumns(1, CFG_EXPORT.COL_END);

  const fileId = outSS.getId();
  const gid = outSh.getSheetId();
  const url = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx&gid=${gid}`;
  return {
    fileId,
    name: `${fileTitle}.xlsx`,
    url,
    rows: filtered.length,
    since: minStr,
    sheet: sheetName
  };
}

/***** 追加：歌唱DB整理 本体 *****/
/**
 * 対象：Performance Record シートのみ
 *
 * 判定ルール
 * 1) A列アーティスト名 + B列曲名 が一致する行を同一歌唱曲データとする
 * 2) 歌ってみた > 歌枠 > ショート のカテゴリ優先度で1件を残す
 * 3) 同カテゴリ内では D列表示文字列の冒頭8桁(yyyymmdd) が新しい方を残す
 * 4) さらに同値なら G列（最新更新日）が新しい方、最後は上にある行を残す
 * 5) 残さない行は全て履歴シートへ移動する
 * 6) 履歴へ移す行のE列/F列を、欠落させないよう残す行へ継承する
 * 7) 完了後、B列昇順 → A列昇順 → D列降順で行全体を並べ替える
 */
function cleanupSongRecords() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG_SONG_CLEANUP.SHEET_NAME);
  if (!sh) throw new Error('指定シートが見つかりません: ' + CFG_SONG_CLEANUP.SHEET_NAME);

  const lastRow = sh.getLastRow();
  if (lastRow < CFG_SONG_CLEANUP.DATA_START_ROW) {
    SpreadsheetApp.getUi().alert('処理対象データがありません。');
    return;
  }

  const numRows = lastRow - CFG_SONG_CLEANUP.DATA_START_ROW + 1;
  const rng = sh.getRange(
    CFG_SONG_CLEANUP.DATA_START_ROW,
    CFG_SONG_CLEANUP.COL_START,
    numRows,
    CFG_SONG_CLEANUP.COL_END
  );

  const values   = rng.getValues();
  const displays = rng.getDisplayValues();
  const formulas = rng.getFormulas();
  const richs    = rng.getRichTextValues();

  const records = [];
  for (let i = 0; i < numRows; i++) {
    const row = CFG_SONG_CLEANUP.DATA_START_ROW + i;

    const artistRaw  = values[i][CFG_SONG_CLEANUP.COL_ARTIST - 1];
    const titleRaw   = values[i][CFG_SONG_CLEANUP.COL_TITLE - 1];
    const noteRaw    = values[i][CFG_SONG_CLEANUP.COL_NOTE - 1];
    const noteRich   = richs[i][CFG_SONG_CLEANUP.COL_NOTE - 1];
    const linkDisp   = displays[i][CFG_SONG_CLEANUP.COL_LINK - 1] || '';
    const linkForm   = formulas[i][CFG_SONG_CLEANUP.COL_LINK - 1] || '';
    const linkRich   = richs[i][CFG_SONG_CLEANUP.COL_LINK - 1];
    const sourceRaw  = values[i][CFG_SONG_CLEANUP.COL_SOURCE - 1];
    const sourceRich = richs[i][CFG_SONG_CLEANUP.COL_SOURCE - 1];
    const publishedRaw = values[i][CFG_SONG_CLEANUP.COL_PUBLISHED - 1];
    const updatedRaw = values[i][CFG_SONG_CLEANUP.COL_UPDATED - 1];

    const artist = _normalizeSongKeyText_(artistRaw);
    const title  = _normalizeSongKeyText_(titleRaw);

    // A/Bどちらかが空なら対象外
    if (!artist || !title) continue;

    const linkUrl = pickUrlFromRich(linkRich) || pickUrlFromFormula(linkForm) || pickUrlFromText(linkDisp);
    const songDateNum = _extractSongDateNumFromDisplay_(linkDisp);
    const updatedMs = _toMsOrNull_(updatedRaw);
    const sourceRank = _detectSourceRank_(noteRaw);

    records.push({
      row,
      rawRow: values[i].slice(),
      artist,
      title,
      key: artist + '\t' + title,
      note: noteRaw == null ? '' : String(noteRaw),
      noteRich: noteRich || null,
      linkDisplay: linkDisp,
      linkRich: linkRich || null,
      linkUrl: linkUrl || '',
      sourceValue: sourceRaw,
      sourceRich: sourceRich || null,
      publishedValue: publishedRaw,
      updatedMs,
      songDateNum,
      sourceRank
    });
  }

  if (records.length === 0) {
    SpreadsheetApp.getUi().alert('A列・B列が埋まっている処理対象データがありません。');
    return;
  }

  // A+Bでグループ化
  const groups = {};
  records.forEach(rec => {
    if (!groups[rec.key]) groups[rec.key] = [];
    groups[rec.key].push(rec);
  });

  const archiveMap = {}; // row => reason（履歴シートへ移動）
  const recordMap = {}; // row => record
  records.forEach(rec => { recordMap[rec.row] = rec; });
  let rankedArchived = 0;
  let inheritedSourceCount = 0;
  let inheritedPublishCount = 0;
  const inheritancePlans = [];
  const logs = [];

  Object.keys(groups).forEach(key => {
    const group = groups[key];
    if (group.length <= 1) return;

    const selection = _selectSongGroup_(group);
    const keeper = selection.keeper;
    const archived = selection.archived;
    const inheritance = _buildKeeperInheritance_(keeper, archived);
    if (inheritance.sourceChanged || inheritance.publishedChanged) {
      inheritancePlans.push(inheritance);
      if (inheritance.sourceChanged) inheritedSourceCount++;
      if (inheritance.publishedChanged) inheritedPublishCount++;
    }

    archived.forEach(rec => {
      archiveMap[rec.row] =
        `同一曲の優先順位で履歴へ移動（残す行: ${keeper.row} / 種別優先: ${_sourceRankLabel_(keeper.sourceRank)} / 日付: ${keeper.songDateNum || 'なし'}）`;
      rankedArchived++;
      if (logs.length < CFG_SONG_CLEANUP.LOG_LIMIT) {
        logs.push(`Row ${rec.row} 移動: 同一曲整理 → keep Row ${keeper.row} [${rec.artist} / ${rec.title}]`);
      }
    });
  });

  const rowsToArchive = Object.keys(archiveMap).map(Number);
  const rowsToDeleteDesc = rowsToArchive.slice().sort((a, b) => b - a);

  if (!CFG_SONG_CLEANUP.DRY_RUN) {
    inheritancePlans.forEach(plan => {
      if (plan.sourceChanged) {
        const sourceCell = sh.getRange(plan.keeperRow, CFG_SONG_CLEANUP.COL_SOURCE);
        if (plan.sourceRich) {
          sourceCell.setRichTextValue(
            _cloneRichTextWithFallbackText_(plan.sourceRich, plan.sourceValue)
          );
        } else {
          sourceCell.setValue(plan.sourceValue);
        }
      }
      if (plan.publishedChanged) {
        sh.getRange(plan.keeperRow, CFG_SONG_CLEANUP.COL_PUBLISHED).setValue(plan.publishedValue);
      }
    });

    if (rowsToArchive.length > 0) {
      const archiveSheet = _ensureArchiveSheetWithHeader_(sh);
      const rowsToAppend = rowsToArchive
        .slice()
        .sort((a, b) => a - b)
        .map(rowNum => {
          const rec = recordMap[rowNum];
          return rec ? rec.rawRow : null;
        })
        .filter(r => r != null);

      if (rowsToAppend.length > 0) {
        const startRow = archiveSheet.getLastRow() + 1;
        archiveSheet.getRange(startRow, CFG_SONG_CLEANUP.COL_START, rowsToAppend.length, CFG_SONG_CLEANUP.COL_END)
          .setValues(rowsToAppend);

        // C列もハイパーリンク付きテキストを保持したまま履歴へ移動
        const cRichValues = rowsToArchive
          .slice()
          .sort((a, b) => a - b)
          .map(rowNum => {
            const rec = recordMap[rowNum];
            const rich = rec && rec.noteRich ? rec.noteRich : null;
            const text = rec && rec.note != null ? String(rec.note) : '';
            if (rich) {
              return [_cloneRichTextWithFallbackText_(rich, text)];
            }
            return [SpreadsheetApp.newRichTextValue().setText(text).build()];
          });
        archiveSheet
          .getRange(startRow, CFG_SONG_CLEANUP.COL_NOTE, cRichValues.length, 1)
          .setRichTextValues(cRichValues);

        // D列はハイパーリンク付きテキストを保持したまま履歴へ移動
        const dRichValues = rowsToArchive
          .slice()
          .sort((a, b) => a - b)
          .map(rowNum => {
            const rec = recordMap[rowNum];
            const rich = rec && rec.linkRich ? rec.linkRich : null;
            if (rich) return [rich];
            const text = rec && rec.linkDisplay ? rec.linkDisplay : '';
            return [SpreadsheetApp.newRichTextValue().setText(text).build()];
          });
        archiveSheet
          .getRange(startRow, CFG_SONG_CLEANUP.COL_LINK, dRichValues.length, 1)
          .setRichTextValues(dRichValues);

        // E列もリンク付き出典情報を保持したまま履歴へ移動
        const eRichValues = rowsToArchive
          .slice()
          .sort((a, b) => a - b)
          .map(rowNum => {
            const rec = recordMap[rowNum];
            const rich = rec && rec.sourceRich ? rec.sourceRich : null;
            const text = rec && rec.sourceValue != null ? String(rec.sourceValue) : '';
            return [_cloneRichTextWithFallbackText_(rich, text)];
          });
        archiveSheet
          .getRange(startRow, CFG_SONG_CLEANUP.COL_SOURCE, eRichValues.length, 1)
          .setRichTextValues(eRichValues);
      }
    }
    if (rowsToDeleteDesc.length > 0) {
      _deleteRowsDescendingInChunks_(sh, rowsToDeleteDesc);
    }

    _sortPerformanceRecordRows_(sh);
  }

  Logger.log('--- 歌唱DB整理 結果 ---');
  Logger.log(`対象曲キー数: ${Object.keys(groups).length}`);
  Logger.log(`履歴移動対象行数: ${rowsToDeleteDesc.length}${CFG_SONG_CLEANUP.DRY_RUN ? '（DRY RUN）' : ''}`);
  Logger.log(`  - 同一曲優先順位整理（履歴移動）: ${rankedArchived}`);
  Logger.log(`  - E列継承: ${inheritedSourceCount}`);
  Logger.log(`  - F列継承: ${inheritedPublishCount}`);
  logs.forEach(line => Logger.log(line));

  const preview = logs.slice(0, 20).join('\n');
  SpreadsheetApp.getUi().alert(
    `歌唱DB整理 ${CFG_SONG_CLEANUP.DRY_RUN ? '（DRY RUN）' : '完了'}\n\n` +
    `対象曲キー数: ${Object.keys(groups).length}\n` +
    `履歴移動対象行数: ${rowsToDeleteDesc.length}\n` +
    `- 同一曲優先順位整理（履歴移動）: ${rankedArchived}\n` +
    `- E列継承: ${inheritedSourceCount}\n` +
    `- F列継承: ${inheritedPublishCount}\n\n` +
    (preview ? `詳細（先頭20件）:\n${preview}` : `${CFG_SONG_CLEANUP.DRY_RUN ? '対象候補' : '対象'}はありません。`)
  );
}

/***** ヘルパー（既存：リンク変換） *****/
function pickUrlFromRich(rtv) {
  if (!rtv) return '';
  try {
    const u = rtv.getLinkUrl && rtv.getLinkUrl();
    if (u) return String(u).trim();
  } catch(e){}
  try {
    const runs = rtv.getRuns ? rtv.getRuns() : [];
    for (let k = 0; k < runs.length; k++) {
      const s = runs[k].getTextStyle();
      const u = s && s.getLinkUrl && s.getLinkUrl();
      if (u) return String(u).trim();
    }
  } catch(e){}
  return '';
}

function pickUrlFromFormula(f) {
  if (!f) return '';
  let m = f.match(/HYPERLINK\(\s*"([^"]+)"/i); if (m) return m[1].trim();
  m = f.match(/HYPERLINK\(\s*'([^']+)'/i); if (m) return m[1].trim();
  m = f.match(/href="([^"]+)"/i) || f.match(/href=\\"([^\\"]+)\\"/i); if (m) return m[1].trim();
  m = f.match(/HYPERLINK\(&quot;([^&]+)&quot;/i); if (m) return m[1].trim();
  return '';
}

function pickUrlFromText(s) {
  if (!s) return '';
  const m = String(s).match(/https?:\/\/\S+/i);
  return m ? m[0].trim() : '';
}

function makeHyperlinkFormula(url, label) {
  const esc = (t) => String(t).replace(/"/g, '""');
  return `=HYPERLINK("${esc(url)}","${esc(label)}")`;
}

function letterToColumn(letter){
  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.toUpperCase().charCodeAt(i) - 64);
  }
  return col;
}

function columnToLetter(column) {
  let temp = '', letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

/***** 追加：ユーティリティ（エクスポート） *****/
function _toDateOrNull_(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function _fmtYmd_(d) {
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return `${y}-${m}-${day}`;
}

function _timestamp_() {
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Asia/Kuala_Lumpur';
  return Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
}

function _richTextToPlain_(rtv, fallback) {
  try {
    if (rtv && typeof rtv.getText === 'function') return rtv.getText();
  } catch(e){}
  return (fallback == null) ? '' : String(fallback);
}

function _yyyymmddToSlash_(s8) {
  return `${s8.slice(0,4)}/${s8.slice(4,6)}/${s8.slice(6,8)}`;
}

/***** 追加：歌唱DB整理 ヘルパー *****/

function _applyDefaultPublishChecks_(sheet, startRow, endRow) {
  if (!sheet || startRow > endRow) return 0;

  const numRows = endRow - startRow + 1;
  const rows = sheet
    .getRange(startRow, 1, numRows, CFG_SONG_CLEANUP.COL_PUBLISHED)
    .getValues();
  const nextValues = rows.map(row => [row[CFG_SONG_CLEANUP.COL_PUBLISHED - 1]]);
  let changed = 0;

  for (let i = 0; i < rows.length; i++) {
    const artist = _normalizeSongKeyText_(rows[i][CFG_SONG_CLEANUP.COL_ARTIST - 1]);
    const title = _normalizeSongKeyText_(rows[i][CFG_SONG_CLEANUP.COL_TITLE - 1]);
    const published = rows[i][CFG_SONG_CLEANUP.COL_PUBLISHED - 1];

    if (!artist || !title || _hasCellData_(published)) continue;
    nextValues[i][0] = true;
    changed++;
  }

  if (changed > 0) {
    sheet
      .getRange(startRow, CFG_SONG_CLEANUP.COL_PUBLISHED, numRows, 1)
      .setValues(nextValues);
  }
  return changed;
}

// どちらを残すべきか比較。aが優先なら正数を返す
function _compareBetterSongRecord_(a, b) {
  // 1) C列優先: 歌ってみた > 歌枠 > ショート > その他
  if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;

  // 2) 同順位なら D列表示文字列の冒頭8桁 yyyymmdd が新しい方
  if (a.songDateNum !== b.songDateNum) return a.songDateNum - b.songDateNum;

  // 3) さらに同値なら G列（最新更新日）が新しい方
  const au = a.updatedMs == null ? -Infinity : a.updatedMs;
  const bu = b.updatedMs == null ? -Infinity : b.updatedMs;
  if (au !== bu) return au - bu;

  // 4) 最後は上にある行を優先
  return b.row - a.row;
}

function _selectSongGroup_(records) {
  if (!records || records.length === 0) {
    return { keeper: null, archived: [] };
  }

  let keeper = records[0];
  for (let i = 1; i < records.length; i++) {
    if (_compareBetterSongRecord_(records[i], keeper) > 0) {
      keeper = records[i];
    }
  }
  return {
    keeper,
    archived: records.filter(record => record !== keeper)
  };
}

function _buildKeeperInheritance_(keeper, archivedRecords) {
  const archived = (archivedRecords || [])
    .slice()
    .sort((a, b) => _compareBetterSongRecord_(b, a));

  let sourceValue = keeper.sourceValue;
  let sourceRich = keeper.sourceRich || null;
  if (!_hasCellData_(sourceValue)) {
    for (let i = 0; i < archived.length; i++) {
      if (_hasCellData_(archived[i].sourceValue)) {
        sourceValue = archived[i].sourceValue;
        sourceRich = archived[i].sourceRich || null;
        break;
      }
    }
  }

  let publishedValue = keeper.publishedValue;
  const allRecords = [keeper].concat(archived);
  if (allRecords.some(record => _isPublishedCheckEnabled_(record.publishedValue))) {
    publishedValue = true;
  } else if (!_hasCellData_(publishedValue)) {
    for (let i = 0; i < archived.length; i++) {
      if (_hasCellData_(archived[i].publishedValue)) {
        publishedValue = archived[i].publishedValue;
        break;
      }
    }
  }

  return {
    keeperRow: keeper.row,
    sourceValue,
    sourceRich,
    publishedValue,
    sourceChanged: sourceValue !== keeper.sourceValue,
    publishedChanged: publishedValue !== keeper.publishedValue
  };
}

function _hasCellData_(value) {
  return value != null && String(value).trim() !== '';
}

function _isPublishedCheckEnabled_(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return normalized === 'true' ||
    normalized === '1' ||
    normalized === 'yes' ||
    normalized === 'on' ||
    normalized === '✅' ||
    normalized === '☑';
}

function _performanceRecordSortSpec_() {
  return [
    { column: CFG_SONG_CLEANUP.COL_TITLE, ascending: true },
    { column: CFG_SONG_CLEANUP.COL_ARTIST, ascending: true },
    { column: CFG_SONG_CLEANUP.COL_LINK, ascending: false }
  ];
}

function _sortPerformanceRecordRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < CFG_SONG_CLEANUP.DATA_START_ROW) return 0;

  const numRows = lastRow - CFG_SONG_CLEANUP.DATA_START_ROW + 1;
  const lastColumn = Math.max(
    CFG_SONG_CLEANUP.COL_END,
    sheet.getLastColumn()
  );
  sheet
    .getRange(
      CFG_SONG_CLEANUP.DATA_START_ROW,
      CFG_SONG_CLEANUP.COL_START,
      numRows,
      lastColumn
    )
    .sort(_performanceRecordSortSpec_());
  return numRows;
}

function _detectSourceRank_(note) {
  const s = note == null ? '' : String(note).toLowerCase();

  let rank = 0;
  if (s.indexOf('歌ってみた') !== -1) rank = Math.max(rank, 300);
  if (s.indexOf('歌みた') !== -1)       rank = Math.max(rank, 300);
  if (s.indexOf('cover') !== -1)        rank = Math.max(rank, 300);
  if (s.indexOf('歌枠') !== -1)       rank = Math.max(rank, 200);
  if (s.indexOf('配信') !== -1)       rank = Math.max(rank, 200);
  if (s.indexOf('live') !== -1)        rank = Math.max(rank, 200);
  if (s.indexOf('stream') !== -1)      rank = Math.max(rank, 200);
  if (s.indexOf('ショート') !== -1)   rank = Math.max(rank, 100);
  if (s.indexOf('short') !== -1)      rank = Math.max(rank, 100);

  return rank;
}

function _sourceRankLabel_(rank) {
  if (rank >= 300) return '歌ってみた';
  if (rank >= 200) return '歌枠';
  if (rank >= 100) return 'ショート';
  return 'その他';
}

function _extractSongDateNumFromDisplay_(displayText) {
  const s = displayText == null ? '' : String(displayText).trim();
  const m = s.match(/^(\d{8})/);
  return m ? Number(m[1]) : 0;
}

function _normalizeSongKeyText_(v) {
  let normalized = String(v == null ? '' : v);
  if (typeof normalized.normalize === 'function') {
    normalized = normalized.normalize('NFKC');
  }
  return normalized
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function _toMsOrNull_(v) {
  const d = _toDateOrNull_(v);
  return d ? d.getTime() : null;
}

// 履歴シートを用意し、必要ならヘッダーを整備する
function _ensureArchiveSheetWithHeader_(sourceSheet) {
  const ss = sourceSheet.getParent();
  let archive = ss.getSheetByName(CFG_SONG_CLEANUP.ARCHIVE_SHEET_NAME);
  if (!archive) {
    archive = ss.insertSheet(CFG_SONG_CLEANUP.ARCHIVE_SHEET_NAME);
  }

  const header = sourceSheet
    .getRange(
      CFG_SONG_CLEANUP.HEADER_ROW,
      CFG_SONG_CLEANUP.COL_START,
      1,
      CFG_SONG_CLEANUP.COL_END
    )
    .getValues()[0];

  const hasAnyHeaderValue = archive
    .getRange(1, CFG_SONG_CLEANUP.COL_START, 1, CFG_SONG_CLEANUP.COL_END)
    .getValues()[0]
    .some(v => String(v == null ? '' : v).trim() !== '');

  if (!hasAnyHeaderValue) {
    archive.getRange(1, CFG_SONG_CLEANUP.COL_START, 1, CFG_SONG_CLEANUP.COL_END).setValues([header]);
  }

  return archive;
}

// 行削除は下からまとめて行う
function _deleteRowsDescendingInChunks_(sh, rowNumbers) {
  if (!rowNumbers || rowNumbers.length === 0) return;

  const rows = rowNumbers.slice().sort((a, b) => b - a);
  let startRow = rows[0];
  let count = 1;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    if (row === startRow - 1) {
      count++;
      startRow = row;
      continue;
    }

    sh.deleteRows(startRow, count);
    startRow = row;
    count = 1;
  }

  sh.deleteRows(startRow, count);
}

function _cloneRichTextWithFallbackText_(rich, fallbackText) {
  const text = String(fallbackText == null ? '' : fallbackText);
  if (!rich) return SpreadsheetApp.newRichTextValue().setText(text).build();
  const richText = String(rich.getText ? rich.getText() : '');
  if (richText !== text) return SpreadsheetApp.newRichTextValue().setText(text).build();
  return rich.copy().build();
}

/** シート上の図形ボタンに割り当てる入口（任意） */
function runExportDialogFromButton() {
  showExportDialog();
}
