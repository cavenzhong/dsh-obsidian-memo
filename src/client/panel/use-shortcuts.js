/** 管理浮层快捷键的监听生命周期与 Esc 优先级。 */
import { panelIsVisible } from '../data/visibility.js';
import { React } from '../react.js';

function usePanelShortcuts({
  anyOverlay, cancelEditing, closeCommentConfirm, closeNoteDrawer, closeProjectDialog, closeSettings,
  commentConfirm, currentDrawerNote, dateMenu, drawerArchive, editing, noteDrawer, panelRef, pinned,
  pinnedUserClosedRef, projectBusy, projectTarget, runDelete, saveEditing, savingSettings, setDateMenu,
  setDrawerArchive, setSortMenu, settingsOpen, sortMenu,
}) {
  const keyHandlerRef = React.useRef(null);

  React.useEffect(() => {
    if (!anyOverlay) return undefined;
    const listener = (event) => {
      if (typeof keyHandlerRef.current === 'function') keyHandlerRef.current(event);
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [anyOverlay]);

  keyHandlerRef.current = function handleGlobalKeyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Backspace' && !event.isComposing && event.keyCode !== 229 && !event.defaultPrevented) {
      if (settingsOpen || projectTarget || commentConfirm || editing || event.target?.closest?.('input,textarea,[contenteditable]:not([contenteditable="false"])')) return;
      const panel = panelRef.current;
      if (!panel || !panelIsVisible(panel)) return;
      const doc = panel.ownerDocument;
      if (event.target !== doc?.body && !panel.contains(event.target)) return;
      const note = currentDrawerNote();
      if (note) { event.preventDefault(); event.stopPropagation(); runDelete(note); }
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      // 0.13 同类评论确认框在最上层：Esc 只关它（§7.7）。
      if (commentConfirm) {
        closeCommentConfirm();
        return;
      }
      if (drawerArchive) {
        setDrawerArchive(false);
        return;
      }
      if (dateMenu) {
        setDateMenu(false);
        return;
      }
      if (sortMenu) {
        setSortMenu(false);
        return;
      }
      if (projectTarget) {
        if (!projectBusy) closeProjectDialog();
        return;
      }
      if (settingsOpen) {
        if (!savingSettings) closeSettings();
        return;
      }
      if (noteDrawer) {
        if (editing) cancelEditing();
        else {
          // 锁定态用 Esc 主动关闭：本次挂载内不要自动重开（重进面板仍会恢复/选第一篇）。
          if (pinned) pinnedUserClosedRef.current = true;
          closeNoteDrawer();
        }
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S') && editing) {
      event.preventDefault();
      event.stopPropagation();
      saveEditing();
    }
  };

}

export { usePanelShortcuts };
