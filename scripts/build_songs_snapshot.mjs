import { rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildSongSnapshot } from './lib/songSnapshot.mjs';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function readPositiveInteger(name, fallback) {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

async function fetchPayload(url, options) {
  let lastError;

  for (let attempt = 1; attempt <= options.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = new Error(
          `GAS request failed with HTTP ${response.status}`,
        );
        error.retryable = isRetryableStatus(response.status);
        throw error;
      }

      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
        throw new Error(
          `GAS response exceeds ${options.maxBytes} bytes`,
        );
      }

      const contentType = response.headers.get('content-type') || '';
      if (
        contentType
        && !contentType.toLowerCase().includes('application/json')
        && !contentType.toLowerCase().includes('text/json')
      ) {
        console.warn(
          `Warning: unexpected GAS Content-Type: ${contentType}`,
        );
      }

      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength === 0) {
        throw new Error('GAS response is empty');
      }
      if (body.byteLength > options.maxBytes) {
        throw new Error(
          `GAS response exceeds ${options.maxBytes} bytes`,
        );
      }

      const text = new TextDecoder().decode(body).replace(/^\uFEFF/, '');
      const firstCharacter = text.trimStart()[0];
      if (firstCharacter !== '{') {
        throw new Error(
          'GAS response is not a JSON object (an HTML error page may have been returned)',
        );
      }

      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error(`GAS response is invalid JSON: ${error.message}`);
      }
    } catch (error) {
      const retryable = error.name === 'AbortError' || error.retryable !== false;
      lastError = error.name === 'AbortError'
        ? new Error(`GAS request timed out after ${options.timeoutMs} ms`)
        : error;

      if (!retryable || attempt === options.maxRetries) {
        throw lastError;
      }

      const retryDelayMs = Math.min(500 * (2 ** (attempt - 1)), 8_000);
      console.warn(
        `GAS fetch attempt ${attempt}/${options.maxRetries} failed: `
        + `${lastError.message}. Retrying in ${retryDelayMs} ms.`,
      );
      await delay(retryDelayMs);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError;
}

async function writeSnapshot(outputPath, snapshot) {
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  const serialized = `${JSON.stringify(snapshot)}\n`;

  try {
    await writeFile(temporaryPath, serialized, 'utf8');
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function main() {
  const apiUrl = String(process.env.GAS_SONGS_API_URL || '')
    .replace(/[\r\n]/g, '')
    .trim();
  if (!apiUrl) {
    throw new Error('GAS_SONGS_API_URL is required');
  }

  const parsedUrl = new URL(apiUrl);
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('GAS_SONGS_API_URL must use HTTP or HTTPS');
  }

  const options = {
    timeoutMs: readPositiveInteger('SYNC_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    maxRetries: readPositiveInteger('SYNC_MAX_RETRIES', DEFAULT_MAX_RETRIES),
    maxBytes: readPositiveInteger('SYNC_MAX_BYTES', DEFAULT_MAX_BYTES),
  };
  const outputPath = resolve(
    process.env.SNAPSHOT_FILE || 'songs.generated.json',
  );

  console.log('Fetch and validate songs snapshot from GAS...');
  const payload = await fetchPayload(parsedUrl, options);
  const { snapshot } = buildSongSnapshot(payload);
  await writeSnapshot(outputPath, snapshot);

  console.log(
    `Snapshot ready: ${snapshot.total} items, ${snapshot.dataVersion}`,
  );
  console.log(`Output: ${outputPath}`);
}

main().catch((error) => {
  console.error(`Snapshot build failed: ${error.message}`);
  process.exitCode = 1;
});
