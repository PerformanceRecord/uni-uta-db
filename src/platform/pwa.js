export function isIosSafari(userAgent = globalThis.navigator?.userAgent || '') {
  const isAppleMobile = /iPhone|iPad|iPod/i.test(userAgent);
  const isSafari = (
    /Safari/i.test(userAgent)
    && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent)
  );
  return isAppleMobile && isSafari;
}

export function isStandaloneMode(
  windowRef = globalThis.window,
  navigatorRef = globalThis.navigator,
) {
  return (
    windowRef?.matchMedia?.('(display-mode: standalone)').matches
    || navigatorRef?.standalone === true
  );
}

export function getInstallHelpContent({
  standalone,
  promptReady,
  iosSafari,
}) {
  if (standalone) {
    return {
      message: 'このアプリはすでにホーム画面から起動中です',
      showAction: false,
    };
  }
  if (promptReady) {
    return {
      message: 'このアプリをホーム画面に追加できます',
      showAction: true,
    };
  }
  if (iosSafari) {
    return {
      message: '共有ボタン(⍐)→その他からホーム画面にアプリを追加できます',
      showAction: false,
    };
  }
  return {
    message: 'URL横の共有ボタン→その他からホーム画面にアプリを追加できます！',
    showAction: false,
  };
}

function addMediaChangeListener(mediaQuery, listener) {
  if (typeof mediaQuery?.addEventListener === 'function') {
    mediaQuery.addEventListener('change', listener);
  } else if (typeof mediaQuery?.addListener === 'function') {
    mediaQuery.addListener(listener);
  }
}

export async function registerServiceWorker({
  navigatorRef = globalThis.navigator,
  scriptUrl = './sw.js',
  logger = globalThis.console,
} = {}) {
  if (!navigatorRef || !('serviceWorker' in navigatorRef)) return null;

  try {
    return await navigatorRef.serviceWorker.register(scriptUrl);
  } catch (error) {
    logger?.warn?.('service-worker-register-failed', error);
    return null;
  }
}

export function setupInstallHelpPopover({
  statusShell,
  installHelpPopover,
  installHelpBody,
  installHelpAction,
  installHelpClose,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  navigatorRef = globalThis.navigator,
}) {
  if (
    !statusShell
    || !installHelpPopover
    || !installHelpBody
    || !installHelpAction
    || !installHelpClose
  ) {
    return null;
  }

  let isOpen = false;
  let deferredInstallPrompt = null;

  const closePopover = () => {
    if (!isOpen) return;
    isOpen = false;
    installHelpPopover.hidden = true;
    statusShell.setAttribute('aria-expanded', 'false');
  };

  const openPopover = () => {
    isOpen = true;
    const onIosSafari = isIosSafari(navigatorRef?.userAgent || '');
    const content = getInstallHelpContent({
      standalone: isStandaloneMode(windowRef, navigatorRef),
      promptReady: Boolean(deferredInstallPrompt),
      iosSafari: onIosSafari,
    });

    installHelpBody.textContent = content.message;
    installHelpAction.hidden = !content.showAction;
    installHelpAction.disabled = false;
    installHelpPopover.classList.toggle('ios-inline', onIosSafari);
    installHelpPopover.hidden = false;
    statusShell.setAttribute('aria-expanded', 'true');
  };

  const togglePopover = () => {
    if (isOpen) closePopover();
    else openPopover();
  };

  windowRef.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  windowRef.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    closePopover();
  });

  addMediaChangeListener(
    windowRef.matchMedia('(display-mode: standalone)'),
    () => {
      if (isStandaloneMode(windowRef, navigatorRef)) closePopover();
    },
  );
  addMediaChangeListener(
    windowRef.matchMedia('(max-width: 860px)'),
    closePopover,
  );

  statusShell.addEventListener('click', togglePopover);
  statusShell.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    togglePopover();
  });

  installHelpClose.addEventListener('click', closePopover);
  installHelpAction.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    try {
      deferredInstallPrompt.prompt();
      await Promise.resolve(deferredInstallPrompt.userChoice).catch(() => null);
    } finally {
      deferredInstallPrompt = null;
      closePopover();
    }
  });

  documentRef.addEventListener('click', (event) => {
    if (!isOpen) return;
    if (
      installHelpPopover.contains(event.target)
      || statusShell.contains(event.target)
    ) {
      return;
    }
    closePopover();
  });

  documentRef.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePopover();
  });

  return { openPopover, closePopover };
}
