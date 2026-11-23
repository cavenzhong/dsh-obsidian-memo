/** 选中文字右键菜单：复制选中文字或发送到 DeepSeek。 */
import { ActionIcon, DeepSeekIcon } from '../components/icons.js';
import { h, React } from '../react.js';

const CONTEXT_MARGIN = 8;

function contextMenuPosition(x, y, size, viewport) {
  const width = Math.max(1, Number(size && size.width) || 200);
  const height = Math.max(1, Number(size && size.height) || 96);
  const vw = Math.max(1, Number(viewport && viewport.width) || 1024);
  const vh = Math.max(1, Number(viewport && viewport.height) || 768);
  const left = Math.max(CONTEXT_MARGIN, Math.min(Number(x) || 0, vw - width - CONTEXT_MARGIN));
  const top = Math.max(CONTEXT_MARGIN, Math.min(Number(y) || 0, vh - height - CONTEXT_MARGIN));
  return { left: Math.round(left), top: Math.round(top) };
}

function selectedFieldText(element) {
  if (!element || typeof element.selectionStart !== 'number' || typeof element.selectionEnd !== 'number') return '';
  if (element.selectionEnd <= element.selectionStart) return '';
  return String(element.value || '').slice(element.selectionStart, element.selectionEnd);
}

function inPanel(panel, node) {
  if (!panel || !node) return false;
  const element = node.nodeType === 3 ? node.parentNode : node;
  return Boolean(element && typeof panel.contains === 'function' && panel.contains(element));
}

/**
 * 读取当前选中的插件内文字；输入框/文本域优先，其次 DOM Selection。
 * 只有选区落在面板内且右键目标与选区相交时才返回，避免选中一段文字却右键别处也弹菜单。
 * @param {HTMLElement | null} panel - 插件面板根节点。
 * @param {Node | null} target - 右键事件目标。
 * @param {Document | null} doc - 当前文档。
 * @returns {string} 原文选中文字，未选中时为 ''。
 */
function readSelectedText(panel, target, doc) {
  if (!panel) return '';
  const field = doc && doc.activeElement;
  const fieldText = field && panel.contains(field) ? selectedFieldText(field) : '';
  if (fieldText.trim() !== '') return target === field ? fieldText : '';
  const selection = doc && typeof doc.getSelection === 'function' ? doc.getSelection() : null;
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return '';
  const text = selection.toString();
  if (text.trim() === '') return '';
  const range = selection.getRangeAt(0);
  if (!inPanel(panel, range.commonAncestorContainer)) return '';
  const element = target && target.nodeType === 1 ? target : target && target.parentElement;
  if (element && typeof range.intersectsNode === 'function' && !range.intersectsNode(element)) return '';
  return text;
}

function SelectionMenu(props) {
  const { t, menu, onCopy, onSend, onClose } = props;
  const ref = React.useRef(null);
  const [position, setPosition] = React.useState(null);
  const text = menu && typeof menu.text === 'string' ? menu.text : '';
  const preview = text.replace(/\s+/gu, ' ').trim().slice(0, 90);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const doc = element.ownerDocument;
    const win = doc && doc.defaultView;
    const place = () => {
      const rect = element.getBoundingClientRect();
      setPosition(contextMenuPosition(menu.x, menu.y, { width: rect.width, height: rect.height }, {
        width: win && win.innerWidth || 1024,
        height: win && win.innerHeight || 768,
      }));
    };
    place();
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('resize', place);
      return () => win.removeEventListener('resize', place);
    }
    return undefined;
  }, [menu]);

  React.useEffect(() => {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return undefined;
    const down = (event) => {
      const element = ref.current;
      if (element && typeof Node !== 'undefined' && event.target instanceof Node && element.contains(event.target)) return;
      onClose();
    };
    const key = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    doc.addEventListener('pointerdown', down, true);
    doc.addEventListener('keydown', key, true);
    return () => {
      doc.removeEventListener('pointerdown', down, true);
      doc.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  const style = position ? { left: position.left + 'px', top: position.top + 'px' } : { visibility: 'hidden' };
  return h('div', {
    ref: ref,
    className: 'SN_contextMenu SN_selectionMenu',
    role: 'menu',
    'aria-label': t('selection.label'),
    style: style,
  },
    h('p', { className: 'SN_contextMenuTitle' }, t('selection.label')),
    h('p', { className: 'SN_contextMenuPreview', title: text }, preview),
    h('button', {
      type: 'button', role: 'menuitem', className: 'SN_contextMenuItem',
      onClick: () => onCopy(text),
    }, h(ActionIcon, { kind: 'copy', size: 14 }), h('span', null, t('selection.copy'))),
    h('button', {
      type: 'button', role: 'menuitem', className: 'SN_contextMenuItem SN_contextMenuSend',
      onClick: () => onSend(text),
    }, h(DeepSeekIcon, { size: 14 }), h('span', null, t('selection.send'))),
  );
}

export { SelectionMenu, contextMenuPosition, readSelectedText };
