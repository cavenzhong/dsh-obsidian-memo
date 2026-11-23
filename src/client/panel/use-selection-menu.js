/** 选中文字右键菜单：读取插件内选区、复制或交给 DeepSeek 发送菜单。 */
import { readSelectedText } from '../deepseek/selection-menu.js';
import { React } from '../react.js';

function useSelectionMenu({ aliveRef, deepseek, panelRef, pushErrorToast, pushToast, tRef }) {
  const [selectionMenu, setSelectionMenu] = React.useState(null);

  function handlePanelContextMenu(event) {
    if (event.defaultPrevented || event.target?.closest?.('.SN_sendMenu,.SN_selectionMenu')) return;
    const text = readSelectedText(panelRef.current, event.target, typeof document === 'undefined' ? null : document);
    if (text === '') return;
    event.preventDefault();
    event.stopPropagation();
    deepseek.closeMenu();
    const rect = typeof event.target?.getBoundingClientRect === 'function' ? event.target.getBoundingClientRect() : null;
    setSelectionMenu({
      text: text,
      x: event.clientX || (rect && rect.left) || 0,
      y: event.clientY || (rect && rect.bottom) || 0,
      anchor: event.target,
    });
  }

  function copySelection(text) {
    setSelectionMenu(null);
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(() => { if (aliveRef.current) pushToast({ text: tRef.current('toast.selectionCopied'), kind: 'success' }); })
      .catch(() => { if (aliveRef.current) pushErrorToast(new Error(tRef.current('toast.copyFailed'))); });
  }

  function sendSelection(text) {
    const anchor = selectionMenu && selectionMenu.anchor;
    setSelectionMenu(null);
    deepseek.requestSendText(text, anchor);
  }

  return {
    selectionMenu: selectionMenu,
    handlePanelContextMenu: handlePanelContextMenu,
    copySelection: copySelection,
    sendSelection: sendSelection,
    closeSelection: () => setSelectionMenu(null),
  };
}

export { useSelectionMenu };
