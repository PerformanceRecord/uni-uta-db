/**
 * Performance Record -> songs.json API (Google Apps Script)
 *
 * Script Properties:
 * - SPREADSHEET_ID: Webアプリから参照するスプレッドシートID
 *
 * Compatibility:
 * - Script Properties未設定時はDEFAULT_SPREADSHEET_IDを使用する。
 * - doGet({ parameter: { api: 'songs' } })でJSONを返す。
 */

const SHEET_NAME = 'Performance Record';
const HEADER_ROW = 3;
const DATA_START_ROW = HEADER_ROW + 1;
const REQUIRED_COLUMNS = 6;
const SCHEMA_VERSION = 1;
const SPREADSHEET_ID_PROPERTY = 'SPREADSHEET_ID';
const DEFAULT_SPREADSHEET_ID = '1Rr1pYbfVcj0ae5EhzIsK8UbEIIE0cUz-00zjruxZQK0';
const CHECKED_MARKERS = [
  'true',
  '1',
  'yes',
  'y',
  'on',
  'checked',
  'check',
  '✅',
  '☑',
  '✔',
];

function doGet(e) {
  const api = String((e && e.parameter && e.parameter.api) || '');
  if (api !== 'songs') {
    return ContentService.createTextOutput(
      'OK: add ?api=songs to fetch songs.json payload.'
    ).setMimeType(ContentService.MimeType.TEXT);
  }

  try {
    return outputJson_(buildSongsPayload_());
  } catch (error) {
    console.error('songs-api-build-failed', error);
    return outputJson_({
      error: {
        code: 'SONGS_BUILD_FAILED',
        message: safeErrorMessage_(error),
      },
      generatedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    });
  }
}

function buildSongsPayload_(spreadsheet) {
  const ss = spreadsheet || getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('Sheet not found: ' + SHEET_NAME);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) {
    return createSongsPayload_([]);
  }

  const lastColumn = sheet.getLastColumn();
  if (lastColumn < REQUIRED_COLUMNS) {
    throw new Error(
      'Required columns are missing: expected at least ' + REQUIRED_COLUMNS +
      ' columns (A-F), but got ' + lastColumn + '.'
    );
  }

  const rowCount = lastRow - DATA_START_ROW + 1;
  const range = sheet.getRange(
    DATA_START_ROW,
    1,
    rowCount,
    REQUIRED_COLUMNS
  );
  const values = range.getDisplayValues();
  const richTexts = range.getRichTextValues();
  const formulas = range.getFormulas();
  const items = [];
  const sourceRows = [];

  for (let index = 0; index < values.length; index += 1) {
    const sheetRow = DATA_START_ROW + index;
    const row = values[index] || [];
    const richRow = richTexts[index] || [];
    const formulaRow = formulas[index] || [];
    const artist = clean_(row[0]); // A
    const title = clean_(row[1]); // B
    const tag = clean_(row[2]); // C
    const liveField = clean_(row[3]); // D
    const checked = clean_(row[5]); // F

    if (!isChecked_(checked)) continue;
    if (!artist || !title) {
      throw new Error(
        'Checked row ' + sheetRow +
        ' requires both artist (A) and title (B).'
      );
    }

    const liveUrl = extractCellUrl_(
      liveField,
      richRow[3] || null,
      clean_(formulaRow[3])
    );
    const liveYmd = extractLeadingYmd_(liveField);
    if (liveYmd && !isValidYmd_(liveYmd)) {
      throw new Error(
        'Invalid YYYYMMDD date at row ' + sheetRow + ': ' + liveYmd
      );
    }

    const normalizedLiveDate = liveYmd ? formatYmd_(liveYmd) : '';
    const memoKind = inferKindFromText_(tag);
    items.push({
      title: title,
      artist: artist,
      kind: resolveKind_(memoKind),
      memo: tag,
      singingTag: tag,
      liveLink: liveUrl,
      liveTitle: extractLiveTitle_(liveField),
      lastSungDate: normalizedLiveDate,
      publishedAt: normalizedLiveDate,
    });
    sourceRows.push(sheetRow);
  }

  assertUniqueSongIdentities_(items, sourceRows);
  return createSongsPayload_(items);
}

function createSongsPayload_(items) {
  return {
    items: items,
    total: items.length,
    generatedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
}

function getSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  let configuredId = '';
  if (typeof PropertiesService !== 'undefined') {
    configuredId = clean_(
      PropertiesService
        .getScriptProperties()
        .getProperty(SPREADSHEET_ID_PROPERTY)
    );
  }
  const spreadsheetId = configuredId || DEFAULT_SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error(
      'Spreadsheet could not be resolved. Set the SPREADSHEET_ID Script Property.'
    );
  }

  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throw new Error(
      'Failed to open spreadsheet by SPREADSHEET_ID: ' +
      safeErrorMessage_(error)
    );
  }
}

function clean_(value) {
  return String(value == null ? '' : value).trim();
}

function safeErrorMessage_(error) {
  return clean_(error && error.message ? error.message : error) || 'Unknown error';
}

function isChecked_(value) {
  return CHECKED_MARKERS.indexOf(clean_(value).toLowerCase()) !== -1;
}

function normalizeHttpUrl_(value) {
  const url = clean_(value);
  return /^https?:\/\//i.test(url) ? url : '';
}

function extractCellUrl_(text, richText, formula) {
  return (
    extractRichTextUrl_(richText)
    || extractHyperlinkUrlFromFormula_(formula)
    || extractUrl_(text)
  );
}

function extractHyperlinkUrlFromFormula_(formula) {
  const raw = clean_(formula);
  if (!raw) return '';

  const match = raw.match(
    /^=\s*HYPERLINK\s*\(\s*"([^"]+)"\s*[;,]/i
  );
  return match ? normalizeHttpUrl_(match[1]) : '';
}

function extractRichTextUrl_(richText) {
  if (!richText || typeof richText.getRuns !== 'function') return '';

  try {
    const direct = normalizeHttpUrl_(richText.getLinkUrl());
    if (direct) return direct;
  } catch (_) {}

  try {
    const runs = richText.getRuns() || [];
    for (let index = 0; index < runs.length; index += 1) {
      const runUrl = normalizeHttpUrl_(runs[index].getLinkUrl());
      if (runUrl) return runUrl;
    }
  } catch (_) {}
  return '';
}

function extractUrl_(text) {
  const match = clean_(text).match(/https?:\/\/[^\s)]+/i);
  return match ? normalizeHttpUrl_(match[0]) : '';
}

function extractLeadingYmd_(text) {
  const match = clean_(text).match(/^(\d{8})/);
  return match ? match[1] : '';
}

function isValidYmd_(ymd) {
  if (!/^\d{8}$/.test(ymd)) return false;

  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const day = Number(ymd.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

function formatYmd_(ymd) {
  return (
    ymd.slice(0, 4) + '-' +
    ymd.slice(4, 6) + '-' +
    ymd.slice(6, 8)
  );
}

function extractLiveTitle_(liveField) {
  const raw = clean_(liveField);
  if (!raw || /^\d{8}$/.test(raw)) return '';

  return raw
    .replace(/https?:\/\/[^\s)]+/ig, '')
    .replace(/^\d{8}[\s_-]*/, '')
    .trim();
}

function inferKindFromText_(memo) {
  const text = clean_(memo).toLowerCase();
  if (!text) return '';
  if (
    text.indexOf('歌ってみた') !== -1
    || text.indexOf('歌みた') !== -1
    || text.indexOf('cover') !== -1
  ) {
    return 'cover';
  }
  if (
    text.indexOf('歌枠') !== -1
    || text.indexOf('配信') !== -1
    || text.indexOf('live') !== -1
    || text.indexOf('stream') !== -1
  ) {
    return 'live';
  }
  if (
    text.indexOf('ショート') !== -1
    || text.indexOf('short') !== -1
  ) {
    return 'short';
  }
  return 'other';
}

function resolveKind_(memoKind) {
  if (memoKind === 'cover') return 'cover';
  if (memoKind === 'short') return 'short';
  return 'live';
}

function normalizeSongIdentityPart_(value) {
  let normalized = clean_(value);
  if (typeof normalized.normalize === 'function') {
    normalized = normalized.normalize('NFKC');
  }
  return normalized
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function assertUniqueSongIdentities_(items, sourceRows) {
  const firstRows = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const identity = (
      normalizeSongIdentityPart_(item.artist) + '\u0000' +
      normalizeSongIdentityPart_(item.title)
    );
    if (Object.prototype.hasOwnProperty.call(firstRows, identity)) {
      throw new Error(
        'Duplicate song identity at rows ' +
        firstRows[identity] + ' and ' + sourceRows[index] + ': ' +
        item.artist + ' / ' + item.title
      );
    }
    firstRows[identity] = sourceRows[index];
  }
}

function outputJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
