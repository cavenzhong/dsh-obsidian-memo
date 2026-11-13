/** 输入岛焦点和外部图片拖入判断，避免抢占正文编辑快捷键。 */
import { panelIsVisible } from '../data/visibility.js';

const CAPTURE_TAB_PASSTHROUGH = 'button,a,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="textbox"],[role="menuitem"],[tabindex]';

/** 切换到本面板时把焦点交给面板容器，让紧接着的 Enter/Tab 无需先点击即可进入输入岛。 */
function focusPanelForCapture(panel, doc) {
  if (!panel || typeof panel.focus !== 'function') return false;
  const active = doc && doc.activeElement;
  if (active && typeof panel.contains === 'function' && panel.contains(active)) return false;
  panel.focus({ preventScroll: true });
  return true;
}

function focusCaptureOnTab(event, { panel, form, title, busy }) {
  if (!panel || !form || !title || busy || event.defaultPrevented || !['Tab', 'Enter'].includes(event.key)
    || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || !panelIsVisible(panel)) return false;
  const target = event.target;
  if (target && (form.contains(target) || target.closest?.('.SN_noteEditor'))) return false;
  const doc = panel.ownerDocument;
  const atPageRoot = Boolean(target) && (target === doc?.body || target === doc?.documentElement || target === doc);
  if (!atPageRoot && !(target && panel.contains(target))) return false;
  if (event.key === 'Tab') {
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
    // Tab 仍保留按钮、卡片、输入框与浮层的原生焦点顺序。
    if (target?.closest?.(CAPTURE_TAB_PASSTHROUGH) ||
      panel.querySelector('[aria-modal="true"],[role="menu"],.SN_drawer,.SN_projectOverlay,.SN_noteDrawer,[role="dialog"]')) return false;
  }
  event.preventDefault();
  event.stopPropagation?.();
  title.focus();
  return true;
}

function captureRefocusField(active, bodyElement) {
  return active && active === bodyElement ? 'body' : 'title';
}

function captureFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files') || Boolean(event.dataTransfer?.files?.length);
}

export { focusCaptureOnTab, focusPanelForCapture, captureRefocusField, captureFileDrag };
