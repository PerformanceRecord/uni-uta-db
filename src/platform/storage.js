export function readStorageItem(
  key,
  storage,
) {
  try {
    storage ??= globalThis.localStorage;
    return storage?.getItem?.(String(key)) ?? null;
  } catch (_) {
    return null;
  }
}

export function writeStorageItem(
  key,
  value,
  storage,
) {
  try {
    storage ??= globalThis.localStorage;
    if (typeof storage?.setItem !== 'function') return false;
    storage.setItem(String(key), String(value));
    return true;
  } catch (_) {
    return false;
  }
}

export function removeStorageItem(
  key,
  storage,
) {
  try {
    storage ??= globalThis.localStorage;
    if (typeof storage?.removeItem !== 'function') return false;
    storage.removeItem(String(key));
    return true;
  } catch (_) {
    return false;
  }
}

