import { canMoveListAtSelection, editListAtSelection } from '../../shared/list-editing.js';
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
  const [showHint, setShowHint] = React.useState(false);
  function reset() {
    held.current = false;
    composing.current = false;
    setShowHint(false);
  }
  React.useEffect(() => {
    reset();
    if (!editing || saving) return;
    window.addEventListener?.('blur', reset);
    return () => window.removeEventListener?.('blur', reset);
  }, [editing, path, saving]);

  function refresh(input) {
    setShowHint(Boolean(held.current && !composing.current && !input.disabled && !input.readOnly
      && canMoveListAtSelection(input.value, input.selectionStart, input.selectionEnd)));
  }
  function updateModifier(event) {
    held.current = Boolean(listModifier(event));
    refresh(event.currentTarget);
  }
  return {
    showHint: editing && !saving && showHint,
    refresh,
    fieldProps(applyChange) {
      return {
        onKeyDown(event) {
          updateModifier(event);
          if (!composing.current) handleListShortcut(event, applyChange);
        },
        onKeyUp: updateModifier,
        onClick: updateModifier,
        onCompositionStart() { composing.current = true; setShowHint(false); },
        onCompositionEnd(event) { composing.current = false; refresh(event.currentTarget); },
      };
    },
    reset,
  };
}

export { handleListShortcut, useListShortcuts };
