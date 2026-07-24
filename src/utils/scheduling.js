export function debounce(
  callback,
  waitMs,
  {
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout,
  } = {},
) {
  let timeoutId = null;
  let lastArgs = [];
  let lastThis;

  const invoke = () => {
    timeoutId = null;
    callback.apply(lastThis, lastArgs);
  };

  function debounced(...args) {
    lastArgs = args;
    lastThis = this;
    if (timeoutId !== null) clearTimeoutFn(timeoutId);
    timeoutId = setTimeoutFn(invoke, waitMs);
  }

  debounced.cancel = () => {
    if (timeoutId !== null) clearTimeoutFn(timeoutId);
    timeoutId = null;
  };

  debounced.flush = () => {
    if (timeoutId === null) return;
    clearTimeoutFn(timeoutId);
    invoke();
  };

  return debounced;
}

export function rafThrottle(
  callback,
  {
    requestAnimationFrameFn = globalThis.requestAnimationFrame,
    cancelAnimationFrameFn = globalThis.cancelAnimationFrame,
  } = {},
) {
  let frameId = null;
  let lastArgs = [];
  let lastThis;

  function throttled(...args) {
    lastArgs = args;
    lastThis = this;
    if (frameId !== null) return;

    frameId = requestAnimationFrameFn(() => {
      frameId = null;
      callback.apply(lastThis, lastArgs);
    });
  }

  throttled.cancel = () => {
    if (frameId !== null) cancelAnimationFrameFn(frameId);
    frameId = null;
  };

  return throttled;
}
