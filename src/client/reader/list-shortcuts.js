import { editListAtSelection, listShortcutHintAtSelection } from '../../shared/list-editing.js';
import { React } from '../react.js';

const isComposing = (event) => event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229;
const listModifier = (event) => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && !isComposing(event);

/** 仅绑定正文编辑框；不适用的组合键交还宿主。 */
function handleListShortcut(event, applyChange) {
  if (!listModifier(event)) return false;
  const action = event.key?.toLowerCase() === 'l' ? 'cycle' : ({
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'outdent', ArrowRight: 'indent',
  })[event.key];
  const input = event.currentTarget;
  if (!action || !input || input.disabled || input.readOnly) return false;
  const result = editListAtSelection(input.value, input.selectionStart, input.selectionEnd, action);
  if (!result) return false;
  event.preventDefault();
  event.stopPropagation();
  applyChange(result);
  return true;
}

function useListShortcuts({ editing, path, saving }) {
  const held = React.useRef(false);
  const composing = React.useRef(false);
  const [hint, setHint] = React.useState(null);
  function reset() {
    held.current = false;
    composing.current = false;
    setHint(null);
  }
  React.useEffect(() => {
    reset();
    if (!editing || saving) return;
    window.addEventListener?.('blur', reset);
    return () => window.removeEventListener?.('blur', reset);
  }, [editing, path, saving]);

  function refresh(input) {
    setHint(held.current && !composing.current && !input.disabled && !input.readOnly
      ? listShortcutHintAtSelection(input.value, input.selectionStart, input.selectionEnd) : null);
  }
  function updateModifier(event) {
    held.current = Boolean(listModifier(event));
    refresh(event.currentTarget);
  }
  return {
    hintKey: editing && !saving && hint ? (hint === 'move' ? 'drawer.listShortcutHint' : 'drawer.listCycleShortcutHint') : 'drawer.shortcutHint',
    refresh,
    fieldProps(applyChange) {
      return {
        onKeyDown(event) {
          updateModifier(event);
          if (!composing.current) handleListShortcut(event, applyChange);
        },
        onKeyUp: updateModifier,
        onClick: updateModifier,
        onCompositionStart() { composing.current = true; setHint(null); },
        onCompositionEnd(event) { composing.current = false; refresh(event.currentTarget); },
      };
    },
    reset,
  };
}

export { handleListShortcut, useListShortcuts };
