// The native overlay owns the editor selection and its file/range callback.
// DOM Selection may be trimmed, serialized differently, or hidden in a shadow root.
const active = [];
function bind(add, text, mode) {
  if (typeof add !== 'function' || typeof text !== 'string' || !text.trim() || !['actions', 'actions-focused'].includes(mode)) return;
  const token = {}; active.push(token);
  let consumed = false;
  function key(event) {
    if (active.at(-1) !== token || event.defaultPrevented || event.isComposing || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'u') return;
    const path = event.composedPath();
    const elements = path.filter(node => node?.nodeType === 1);
    const inFileEditor = elements.some(el => el.closest?.('.cm-editor,[data-pierre-editor-surface],diffs-container,[data-text-file-editor-selection-toolbar],[data-pierre-selection-actions]'));
    // A file editor is the intended source. A chat composer or instruction input is not.
    if (!inFileEditor && elements.some(el => el.closest?.('input,textarea,[contenteditable]:not([contenteditable="false"])'))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat || consumed) return;
    consumed = true;
    window.getSelection()?.removeAllRanges();
    add(text);
  }
  window.addEventListener('keydown', key, true);
  return () => {
    const index = active.indexOf(token); if (index >= 0) active.splice(index, 1);
    window.removeEventListener('keydown', key, true);
  };
}
export { bind };
