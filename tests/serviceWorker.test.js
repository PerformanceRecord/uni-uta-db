import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceWorkerSource = readFileSync(
  new URL('../sw.js', import.meta.url),
  'utf8',
);

function createServiceWorkerContext() {
  const listeners = {};
  const cache = {
    addAll: vi.fn(async () => {}),
    match: vi.fn(async () => null),
    put: vi.fn(async () => {}),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
    match: vi.fn(async () => null),
  };
  const self = {
    location: { origin: 'https://example.com' },
    clients: { claim: vi.fn(async () => {}) },
    skipWaiting: vi.fn(async () => {}),
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
  };
  const fetch = vi.fn();

  vm.runInNewContext(serviceWorkerSource, {
    URL,
    Promise,
    caches,
    fetch,
    self,
  });

  return {
    cache,
    caches,
    fetch,
    listeners,
    self,
  };
}

describe('service worker', () => {
  let context;

  beforeEach(() => {
    context = createServiceWorkerContext();
  });

  it('install時にアプリシェルを事前キャッシュする', async () => {
    let installTask;
    context.listeners.install({
      waitUntil: (task) => {
        installTask = task;
      },
    });
    await installTask;

    expect(context.caches.open).toHaveBeenCalledWith('uni-uta-shell-v4');
    const shellFiles = context.cache.addAll.mock.calls[0][0];
    expect(shellFiles).toContain('./index.html');
    expect(shellFiles).toContain('./assets/styles.css?v=4');
    expect(shellFiles).toContain('./src/app.js?v=4');
    expect(shellFiles).toContain('./src/features/danmaku.js');
    expect(shellFiles).toContain('./src/platform/storage.js');
    expect(context.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it('activate時に旧シェルキャッシュだけを削除する', async () => {
    context.caches.keys.mockResolvedValue([
      'uni-uta-shell-old',
      'uni-uta-shell-v4',
      'unrelated-cache',
    ]);
    let activateTask;
    context.listeners.activate({
      waitUntil: (task) => {
        activateTask = task;
      },
    });
    await activateTask;

    expect(context.caches.delete).toHaveBeenCalledTimes(1);
    expect(context.caches.delete).toHaveBeenCalledWith('uni-uta-shell-old');
    expect(context.self.clients.claim).toHaveBeenCalledOnce();
  });

  it('R2など別オリジンとsongs.jsonには介入しない', () => {
    const respondWith = vi.fn();

    context.listeners.fetch({
      request: {
        method: 'GET',
        mode: 'cors',
        url: 'https://r2.example.net/songs.json',
      },
      respondWith,
    });
    context.listeners.fetch({
      request: {
        method: 'GET',
        mode: 'cors',
        url: 'https://example.com/songs.json',
      },
      respondWith,
    });

    expect(respondWith).not.toHaveBeenCalled();
  });

  it('ナビゲーション失敗時はキャッシュ済みindex.htmlへ戻る', async () => {
    const cachedIndex = { source: 'cache' };
    context.fetch.mockRejectedValue(new Error('offline'));
    context.cache.match.mockImplementation(async (request) => (
      request === './index.html' ? cachedIndex : null
    ));
    let responseTask;

    context.listeners.fetch({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: 'https://example.com/app',
      },
      respondWith: (task) => {
        responseTask = task;
      },
    });

    await expect(responseTask).resolves.toBe(cachedIndex);
  });

  it('静的ファイルはキャッシュを返しながら更新する', async () => {
    const cachedResponse = { source: 'cache' };
    const networkResponse = {
      ok: true,
      clone: vi.fn(() => ({ source: 'clone' })),
    };
    context.cache.match.mockResolvedValue(cachedResponse);
    context.fetch.mockResolvedValue(networkResponse);
    const backgroundTasks = [];
    let responseTask;
    const request = {
      method: 'GET',
      mode: 'cors',
      url: 'https://example.com/assets/icons/favicon.svg',
    };

    context.listeners.fetch({
      request,
      respondWith: (task) => {
        responseTask = task;
      },
      waitUntil: (task) => {
        backgroundTasks.push(task);
      },
    });

    await expect(responseTask).resolves.toBe(cachedResponse);
    await Promise.all(backgroundTasks);
    expect(context.cache.put).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ source: 'clone' }),
    );
  });

  it('JavaScriptは新旧UIを混在させないためネットワークを優先する', async () => {
    const networkResponse = {
      ok: true,
      clone: vi.fn(() => ({ source: 'clone' })),
    };
    context.fetch.mockResolvedValue(networkResponse);
    let responseTask;
    const request = {
      method: 'GET',
      mode: 'cors',
      url: 'https://example.com/src/app.js',
    };

    context.listeners.fetch({
      request,
      respondWith: (task) => {
        responseTask = task;
      },
      waitUntil: vi.fn(),
    });

    await expect(responseTask).resolves.toBe(networkResponse);
    expect(context.fetch).toHaveBeenCalledWith(request);
    expect(context.cache.put).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ source: 'clone' }),
    );
  });

  it('JavaScriptの通信失敗時は同一世代のキャッシュへ戻る', async () => {
    const cachedResponse = { source: 'cache' };
    context.fetch.mockRejectedValue(new Error('offline'));
    context.cache.match.mockResolvedValue(cachedResponse);
    let responseTask;
    const request = {
      method: 'GET',
      mode: 'cors',
      url: 'https://example.com/src/app.js',
    };

    context.listeners.fetch({
      request,
      respondWith: (task) => {
        responseTask = task;
      },
      waitUntil: vi.fn(),
    });

    await expect(responseTask).resolves.toBe(cachedResponse);
  });

  it('navigation の取得成功時はクエリ付きURLではなく index.html に保存する', async () => {
    const networkResponse = {
      ok: true,
      clone: vi.fn(() => ({ source: 'clone' })),
    };
    context.fetch.mockResolvedValue(networkResponse);
    let responseTask;
    const request = {
      method: 'GET',
      mode: 'navigate',
      url: 'https://example.com/?cache-bust=1',
    };

    context.listeners.fetch({
      request,
      respondWith: (task) => {
        responseTask = task;
      },
    });

    await expect(responseTask).resolves.toBe(networkResponse);
    expect(context.cache.put).toHaveBeenCalledWith(
      './index.html',
      expect.objectContaining({ source: 'clone' }),
    );
    expect(context.cache.put).not.toHaveBeenCalledWith(
      request,
      expect.anything(),
    );
  });

  it('未キャッシュの静的ファイルがオフラインなら無効な応答を返さず失敗させる', async () => {
    context.cache.match.mockResolvedValue(null);
    context.fetch.mockRejectedValue(new Error('offline'));
    let responseTask;
    const request = {
      method: 'GET',
      mode: 'cors',
      url: 'https://example.com/assets/icons/missing.svg',
    };

    context.listeners.fetch({
      request,
      respondWith: (task) => {
        responseTask = task;
      },
      waitUntil: vi.fn(),
    });

    await expect(responseTask).rejects.toThrow('offline');
  });
});
