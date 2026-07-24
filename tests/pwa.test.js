import { describe, expect, it, vi } from 'vitest';
import {
  getInstallHelpContent,
  isIosSafari,
  registerServiceWorker,
} from '../src/platform/pwa.js';

describe('pwa', () => {
  it('iOS Safariだけを判定する', () => {
    expect(isIosSafari(
      'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1',
    )).toBe(true);
    expect(isIosSafari(
      'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/120 Mobile Safari/604.1',
    )).toBe(false);
  });

  it('インストール状態に応じた既存メッセージを返す', () => {
    expect(getInstallHelpContent({
      standalone: true,
      promptReady: false,
      iosSafari: false,
    })).toMatchObject({
      message: 'このアプリはすでにホーム画面から起動中です',
      showAction: false,
    });
    expect(getInstallHelpContent({
      standalone: false,
      promptReady: true,
      iosSafari: false,
    }).showAction).toBe(true);
  });

  it('Service Workerを登録し、失敗はログだけに留める', async () => {
    const registration = {};
    const register = vi.fn(async () => registration);
    await expect(registerServiceWorker({
      navigatorRef: { serviceWorker: { register } },
    })).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith('./sw.js');

    const logger = { warn: vi.fn() };
    await expect(registerServiceWorker({
      navigatorRef: {
        serviceWorker: {
          register: vi.fn(async () => { throw new Error('failed'); }),
        },
      },
      logger,
    })).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
