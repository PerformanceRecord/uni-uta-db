export async function copyTextToClipboard(
  text,
  {
    navigatorRef = globalThis.navigator,
    documentRef = globalThis.document,
  } = {},
) {
  const normalized = String(text || '').trim();
  if (!normalized) return false;

  try {
    await navigatorRef.clipboard.writeText(normalized);
    return true;
  } catch (_) {
    let fallbackInput = null;
    try {
      fallbackInput = documentRef.createElement('textarea');
      fallbackInput.value = normalized;
      fallbackInput.setAttribute('readonly', '');
      fallbackInput.style.position = 'fixed';
      fallbackInput.style.top = '-9999px';
      documentRef.body.appendChild(fallbackInput);
      fallbackInput.focus();
      fallbackInput.select();
      return Boolean(documentRef.execCommand('copy'));
    } catch (_) {
      return false;
    } finally {
      if (fallbackInput?.parentNode) {
        fallbackInput.parentNode.removeChild(fallbackInput);
      }
    }
  }
}

export function insertTextIntoMemo(
  memoInput,
  text,
  { EventCtor = globalThis.Event } = {},
) {
  if (!memoInput) return false;

  const safeText = String(text ?? '');
  const valueLength = String(memoInput.value || '').length;
  const start = Number.isInteger(memoInput.selectionStart)
    ? memoInput.selectionStart
    : valueLength;
  const end = Number.isInteger(memoInput.selectionEnd)
    ? memoInput.selectionEnd
    : valueLength;

  memoInput.setRangeText(safeText, start, end, 'end');
  memoInput.dispatchEvent(new EventCtor('input', { bubbles: true }));
  return true;
}
