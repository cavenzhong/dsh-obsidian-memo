/** Cmd 提示和数字键共用同一份工作空间顺序。 */
import { panelIsVisible } from '../data/visibility.js';
import { React } from '../react.js';

const TEXT_ENTRY = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
const WORKSPACE_MENU = '.SN_wsPop,.SN_wsMenu:not(.SN_wsMoreMenu)';

function workspaceShortcutDigit(index) {
  return index >= 0 && index < 9 ? index + 1 : null;
}

function useWorkspaceShortcuts(options) {
  const { panelRef, enabled } = options;
  const optionsRef = React.useRef(options);
  optionsRef.current = options;
  React.useEffect(() => {
    const panel = panelRef.current;
    const doc = panel?.ownerDocument;
    const win = doc?.defaultView;
    if (!enabled || !win) return;
    let held = false;

    function ready(target) {
      return optionsRef.current.enabled && panelIsVisible(panel) && !panel.querySelector(WORKSPACE_MENU)
        && (target === doc || target === doc.body || target === doc.documentElement || panel.contains(target))
        && !target?.closest?.(TEXT_ENTRY);
    }

    function hide() {
      if (!held) return;
      held = false;
      panel.removeAttribute('data-workspace-shortcuts');
    }

    function keyDown(event) {
      if (!ready(event.target)) { hide(); return; }
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (!event.metaKey && event.key !== 'Meta') return;
      if (event.altKey || event.ctrlKey || event.shiftKey) return;
      if (!held) {
        held = true;
        panel.setAttribute('data-workspace-shortcuts', '');
      }
      const { entries, onSelect, onToggle } = optionsRef.current;
      const index = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
      const entry = workspaceShortcutDigit(index) && entries[index];
      const toggle = onToggle
        && (event.key === ';' || event.key === '；' || (event.key === 'Unidentified' && event.code === 'Semicolon'));
      if (!toggle && !entry) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (toggle) onToggle();
      else onSelect(entry.id);
    }
    function keyUp(event) { if (event.key === 'Meta' || !event.metaKey) hide(); }
    function focusIn(event) { if (!ready(event.target)) hide(); }

    doc.addEventListener('keydown', keyDown, true);
    doc.addEventListener('keyup', keyUp, true);
    doc.addEventListener('focusin', focusIn, true);
    doc.addEventListener('visibilitychange', hide);
    win.addEventListener('blur', hide);
    return () => {
      hide();
      doc.removeEventListener('keydown', keyDown, true);
      doc.removeEventListener('keyup', keyUp, true);
      doc.removeEventListener('focusin', focusIn, true);
      doc.removeEventListener('visibilitychange', hide);
      win.removeEventListener('blur', hide);
    };
  }, [panelRef, enabled]);
}

export { useWorkspaceShortcuts, workspaceShortcutDigit };
