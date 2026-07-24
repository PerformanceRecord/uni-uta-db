export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

const DATA_VERSION_PATTERN = /^sha256:[a-f0-9]{64}$/;

function createPayloadError(message) {
  const error = new TypeError(message);
  error.name = 'InvalidSongsPayloadError';
  return error;
}

function canTryNextCandidate(status) {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

export function normalizeSongsPayload(payload) {
  const isLegacyArray = Array.isArray(payload);
  const isObject = payload && typeof payload === 'object' && !isLegacyArray;
  if (!isLegacyArray && !isObject) {
    throw createPayloadError(
      'Songs payload must be an array or an object with an items array',
    );
  }

  const sourceItems = isLegacyArray ? payload : payload.items;
  if (!Array.isArray(sourceItems)) {
    throw createPayloadError('Songs payload.items must be an array');
  }

  const invalidItemIndex = sourceItems.findIndex(
    (item) => !item || typeof item !== 'object' || Array.isArray(item),
  );
  if (invalidItemIndex >= 0) {
    throw createPayloadError(
      `Songs payload.items[${invalidItemIndex}] must be an object`,
    );
  }

  if (
    isObject
    && payload.schemaVersion !== undefined
    && payload.schemaVersion !== 1
  ) {
    throw createPayloadError('Unsupported songs payload.schemaVersion');
  }

  const hasTotal = isObject && payload.total !== undefined;
  if (
    hasTotal
    && (!Number.isInteger(payload.total) || payload.total !== sourceItems.length)
  ) {
    throw createPayloadError(
      `Songs payload.total must equal items.length (${sourceItems.length})`,
    );
  }

  const dataVersion = isObject && payload.dataVersion !== undefined
    ? payload.dataVersion
    : '';
  if (
    typeof dataVersion !== 'string'
    || (dataVersion && !DATA_VERSION_PATTERN.test(dataVersion))
  ) {
    throw createPayloadError('Songs payload.dataVersion is invalid');
  }

  return {
    payload: isLegacyArray
      ? { items: sourceItems, total: sourceItems.length }
      : payload,
    sourceItems,
    total: hasTotal ? payload.total : sourceItems.length,
    dataVersion,
  };
}

function normalizeCacheEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (!Number.isFinite(Number(entry.fetchedAt))) return null;

  try {
    const dataset = normalizeSongsPayload(entry.payload);
    return {
      ...dataset,
      etag: typeof entry.etag === 'string' ? entry.etag : '',
      fetchedAt: Number(entry.fetchedAt),
    };
  } catch (_) {
    return null;
  }
}

export function loadCache({ cacheKey }) {
  try {
    const raw = localStorage.getItem(cacheKey());
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function saveCache(entry, { cacheKey }) {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(entry));
  } catch (_) {}
}

export function clearApiCache({ cacheKey }) {
  try {
    localStorage.removeItem(cacheKey());
  } catch (_) {}
}

export function isSameOriginRequest(url) {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch (_) {
    return false;
  }
}

export async function fetchWithTimeout(
  url,
  options = {},
  {
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    fetchImpl = fetch,
  } = {},
) {
  const normalizedTimeoutMs = Number(timeoutMs);
  if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
    return fetchImpl(url, options);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), normalizedTimeoutMs);

  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error(
        `Request timed out after ${normalizedTimeoutMs} ms`,
      );
      timeoutError.name = 'TimeoutError';
      timeoutError.cause = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function load(ctx) {
  const {
    setLoadingStatus,
    clearErrorLog,
    setErrorLog,
    setStoppedStatus,
    setRunningStatus,
    filterItems,
    render,
    headersToObject,
    clipText,
    cacheKey,
    cacheMaxAgeMs = 0,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    requestCandidates,
    rows,
  } = ctx;

  setLoadingStatus();
  clearErrorLog();

  const rawCache = loadCache({ cacheKey });
  const cached = normalizeCacheEntry(rawCache);
  if (rawCache && !cached) {
    clearApiCache({ cacheKey });
  }

  if (requestCandidates.length === 0) {
    setErrorLog({
      timestamp: new Date().toISOString(),
      errorName: 'MissingSongsJsonUrl',
      statusDescription: 'songs-r2-json-url が未設定',
    });
    rows.innerHTML = '<div class="error">データ取得先が未設定です。meta[name="songs-r2-json-url"] か localStorage("songs_r2_json_url") を設定してください。</div>';
    setStoppedStatus();
    return null;
  }

  let requestUrl = requestCandidates[0];
  let cachedView = null;

  if (cached) {
    const cachedItems = filterItems(cached.sourceItems);
    cachedView = {
      filteredItems: cachedItems,
      sourceItems: cached.sourceItems,
      total: cached.total,
      dataVersion: cached.dataVersion,
    };
    render(cachedItems, { total: cached.total });

    const hasFreshCache = (
      cacheMaxAgeMs > 0
      && cached.fetchedAt > 0
      && (Date.now() - cached.fetchedAt) <= cacheMaxAgeMs
    );
    if (hasFreshCache) {
      setRunningStatus(cachedItems.length, cached.total);
      return {
        sourceItems: cached.sourceItems,
        total: cached.total,
        dataVersion: cached.dataVersion,
        fromCache: true,
      };
    }
  }

  try {
    let res = null;
    let lastError = null;
    const requestAttemptLogs = [];

    for (const candidateUrl of requestCandidates) {
      requestUrl = candidateUrl;
      let candidateResponse;

      try {
        const shouldSendIfNoneMatch = (
          cached?.etag
          && isSameOriginRequest(candidateUrl)
        );
        candidateResponse = await fetchWithTimeout(
          candidateUrl,
          {
            headers: shouldSendIfNoneMatch
              ? { 'If-None-Match': cached.etag }
              : {},
          },
          { timeoutMs: requestTimeoutMs },
        );
      } catch (fetchError) {
        lastError = fetchError;
        requestAttemptLogs.push({
          url: candidateUrl,
          status: fetchError?.name === 'TimeoutError'
            ? 'timeout'
            : 'network_error',
        });
        continue;
      }

      requestAttemptLogs.push({
        url: candidateUrl,
        status: candidateResponse.status,
      });
      if (candidateResponse.ok || candidateResponse.status === 304) {
        res = candidateResponse;
        break;
      }

      if (canTryNextCandidate(candidateResponse.status)) {
        lastError = new Error(`HTTP ${candidateResponse.status}`);
        lastError.name = 'HttpResponseError';
        lastError.details = {
          status: candidateResponse.status,
          statusText: candidateResponse.statusText,
          headers: headersToObject(candidateResponse.headers),
          attempts: requestAttemptLogs,
        };
        continue;
      }

      const bodyText = await candidateResponse.text();
      const httpError = new Error(`HTTP ${candidateResponse.status}`);
      httpError.name = 'HttpResponseError';
      httpError.details = {
        status: candidateResponse.status,
        statusText: candidateResponse.statusText,
        headers: headersToObject(candidateResponse.headers),
        bodyPreview: clipText(bodyText),
        attempts: requestAttemptLogs,
      };
      throw httpError;
    }

    if (!res) throw lastError || new Error('Fetch failed');

    if (res.status === 304) {
      if (!cached || !cachedView) {
        throw new Error('HTTP 304 received without a usable cache');
      }

      saveCache({
        etag: cached.etag,
        dataVersion: cached.dataVersion,
        payload: cached.payload,
        fetchedAt: Date.now(),
      }, { cacheKey });
      setRunningStatus(cachedView.filteredItems.length, cached.total);
      return {
        sourceItems: cached.sourceItems,
        total: cached.total,
        dataVersion: cached.dataVersion,
        fromCache: true,
      };
    }

    let rawPayload;
    try {
      rawPayload = await res.json();
    } catch (jsonError) {
      const parseError = new Error('JSON parse failed');
      parseError.name = 'JsonParseError';
      parseError.details = {
        status: res.status,
        statusText: res.statusText,
        headers: headersToObject(res.headers),
      };
      parseError.cause = jsonError;
      throw parseError;
    }

    const dataset = normalizeSongsPayload(rawPayload);
    const etag = res.headers.get('etag') || '';
    const cacheEntry = {
      etag,
      dataVersion: dataset.dataVersion,
      payload: dataset.payload,
      fetchedAt: Date.now(),
    };
    saveCache(cacheEntry, { cacheKey });

    const sameDataVersion = (
      cachedView?.dataVersion
      && dataset.dataVersion
      && cachedView.dataVersion === dataset.dataVersion
    );
    if (sameDataVersion) {
      setRunningStatus(cachedView.filteredItems.length, dataset.total);
    } else {
      const filteredItems = filterItems(dataset.sourceItems);
      render(filteredItems, { total: dataset.total });
      setRunningStatus(filteredItems.length, dataset.total);
    }

    return {
      sourceItems: dataset.sourceItems,
      total: dataset.total,
      dataVersion: dataset.dataVersion,
    };
  } catch (error) {
    const statusCode = (
      error?.details?.status
      || (String(error?.message || '').match(/HTTP\s+(\d{3})/)?.[1] ?? null)
    );
    if (!cached && String(error?.message || '').includes('404')) {
      clearApiCache({ cacheKey });
    }

    setErrorLog({
      timestamp: new Date().toISOString(),
      errorName: error?.name || 'Error',
      statusCode,
      statusDescription: cachedView
        ? '通信エラー（キャッシュ表示中）'
        : '通信エラー',
      message: String(error?.message || ''),
      attempts: error?.details?.attempts || null,
      requestUrl,
    });

    if (cachedView) {
      setRunningStatus(cachedView.filteredItems.length, cachedView.total);
      return {
        sourceItems: cachedView.sourceItems,
        total: cachedView.total,
        dataVersion: cachedView.dataVersion,
        fromCache: true,
        stale: true,
      };
    }

    rows.innerHTML = '<div class="error">データ取得に失敗しました。R2の公開URL設定を確認してください。</div>';
    setStoppedStatus();
    return null;
  }
}
