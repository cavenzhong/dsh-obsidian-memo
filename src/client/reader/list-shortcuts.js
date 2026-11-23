import { editListAtSelection } from '../../shared/list-editing.js';

/** 仅绑定正文编辑框；非列表行与输入法组合态交还浏览器。 */
function handleListShortcut(event, applyChange) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return false;
  const action = event.key === '/' || event.code === 'Slash' ? 'cycle' : ({
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'outdent', ArrowRight: 'indent',
  })[event.key];
  const input = event.currentTarget;
  if (!action || input?.disabled) return false;
  const result = editListAtSelection(input.value, input.selectionStart, input.selectionEnd, action);
  if (!result) return false;
  event.preventDefault();
  event.stopPropagation();
  applyChange(result);
  return true;
}

export { handleListShortcut };
