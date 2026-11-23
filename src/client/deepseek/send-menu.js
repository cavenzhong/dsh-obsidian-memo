/** 所有「发送到 DeepSeek」入口共用的浮动菜单：先选形式，再选工作区。 */
import { isDefaultWorkspace, workspaceDisplayName } from '../../shared/send.js';
import { DeepSeekIcon, CloseIcon } from '../components/icons.js';
import { h, React } from '../react.js';

const MENU_WIDTH = 282;
const MENU_MARGIN = 8;

function anchorRect(anchor) {
  try {
    return anchor && typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : null;
  } catch {
    return null;
  }
}

/**
 * 计算固定菜单的视口内位置：优先出现在锚点下方，空间不足时翻到上方。
 * @param {{ left: number, top: number, right: number, bottom: number } | null} rect
 * @param {{ width: number, height: number }} size
 * @param {{ width: number, height: number }} viewport
 * @returns {{ left: number, top: number }}
 */
function sendMenuPosition(rect, size, viewport) {
  const width = Math.max(1, Number(size && size.width) || MENU_WIDTH);
  const height = Math.max(1, Number(size && size.height) || 320);
  const vw = Math.max(1, Number(viewport && viewport.width) || 1024);
  const vh = Math.max(1, Number(viewport && viewport.height) || 768);
  const box = rect || { left: vw / 2, top: vh / 2, right: vw / 2, bottom: vh / 2 };
  const left = Math.max(MENU_MARGIN, Math.min(Number(box.left) || 0, vw - width - MENU_MARGIN));
  let top = (Number(box.bottom) || 0) + 6;
  if (top + height > vh - MENU_MARGIN) top = Math.max(MENU_MARGIN, (Number(box.top) || 0) - height - 6);
  return { left: Math.round(left), top: Math.round(top) };
}

function renderFormatButton(props) {
  const { t, id, active, disabled, onClick } = props;
  const label = t(id === 'document' ? 'send.format.document' : 'send.format.text');
  const hint = t(id === 'document' ? 'send.format.documentHint' : 'send.format.textHint');
  return h('button', {
    type: 'button',
    className: 'SN_sendFormatBtn',
    'data-active': active ? 'true' : 'false',
    'aria-pressed': active ? 'true' : 'false',
    disabled: disabled,
    onClick: onClick,
  },
    h('span', { className: 'SN_sendFormatGlyph', 'aria-hidden': 'true' }, id === 'document' ? '@' : '¶'),
    h('span', { className: 'SN_sendFormatText' },
      h('span', { className: 'SN_sendFormatLabel' }, label),
      h('span', { className: 'SN_sendFormatHint' }, hint),
    ),
  );
}

function SendMenu(props) {
  const { t, menu, workspaces, defaultId, sending, onChoose, onFormat, onClose } = props;
  const menuRef = React.useRef(null);
  const [position, setPosition] = React.useState(null);
  const source = workspaces && Array.isArray(workspaces.items) ? workspaces.items : [];
  const textOnly = Boolean(menu && menu.kind === 'text');
  const note = menu && menu.note ? menu.note : {};
  const selected = textOnly && typeof menu.text === 'string' ? menu.text.replace(/\s+/gu, ' ').trim() : '';
  const title = textOnly ? selected : (note.title || note.name || '');
  const heading = textOnly ? t('send.titleText') : t('send.title');
  const format = menu && menu.format === 'document' ? 'document' : 'text';

  React.useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return undefined;
    const doc = element.ownerDocument;
    const win = doc && doc.defaultView;
    const place = () => {
      const rect = element.getBoundingClientRect();
      setPosition(sendMenuPosition(anchorRect(menu.anchor), { width: rect.width, height: rect.height }, {
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
  }, [menu, workspaces]);

  React.useEffect(() => {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return undefined;
    const down = (event) => {
      const element = menuRef.current;
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
    ref: menuRef,
    className: 'SN_sendMenu',
    role: 'dialog',
    'aria-label': heading,
    'data-sending': sending ? 'true' : undefined,
    style: style,
  },
    h('div', { className: 'SN_sendMenuHead' },
      h('span', { className: 'SN_sendMenuMark', 'aria-hidden': 'true' }, h(DeepSeekIcon, { size: 18 })),
      h('span', { className: 'SN_sendMenuHeading' },
        h('strong', { className: 'SN_sendMenuTitle' }, heading),
        title ? h('span', { className: 'SN_sendMenuNote', title: textOnly ? selected : title }, title) : null,
      ),
      h('button', {
        type: 'button', className: 'SN_sendMenuClose', 'aria-label': t('send.close'), title: t('send.close'),
        disabled: sending, onClick: onClose,
      }, h(CloseIcon, { size: 12 })),
    ),
    textOnly
      ? h('div', { className: 'SN_sendSelectionOnly' },
        h('p', { className: 'SN_sendSectionTitle' }, t('send.selectedText')),
        h('p', { className: 'SN_sendSelectionText', title: selected }, selected),
      )
      : h('div', { className: 'SN_sendSection' },
        h('p', { className: 'SN_sendSectionTitle' }, t('send.format')),
        h('div', { className: 'SN_sendFormats', role: 'group', 'aria-label': t('send.format') },
          renderFormatButton({
            t: t, id: 'text', active: format === 'text', disabled: sending,
            onClick: () => onFormat('text'),
          }),
          renderFormatButton({
            t: t, id: 'document', active: format === 'document', disabled: sending,
            onClick: () => onFormat('document'),
          }),
        ),
      ),
    h('div', { className: 'SN_sendSection' },
      h('p', { className: 'SN_sendSectionTitle' }, t('send.workspace')),
      h('div', { className: 'SN_sendWorkspaces', role: 'group', 'aria-label': t('send.workspace') },
        source.map((workspace) => {
          const primary = workspace.workspaceId === defaultId || isDefaultWorkspace(workspace);
          return h('button', {
            key: workspace.workspaceId,
            type: 'button',
            className: 'SN_sendWorkspace',
            'data-primary': primary ? 'true' : 'false',
            'aria-label': workspaceDisplayName(workspace, t('send.defaultWorkspace')),
            disabled: sending,
            onClick: () => onChoose(workspace),
          },
            h('span', { className: 'SN_sendWorkspaceMain' },
              h('span', { className: 'SN_sendWorkspaceName' },
                workspaceDisplayName(workspace, t('send.defaultWorkspace')),
                primary ? h('span', { className: 'SN_sendBadge' }, t('send.defaultBadge')) : null,
              ),
              h('span', { className: 'SN_sendWorkspacePath', title: workspace.path }, workspace.path),
            ),
            h('span', { className: 'SN_sendWorkspaceGo', 'aria-hidden': 'true' }, '→'),
          );
        }),
        source.length === 0
          ? h('button', {
            type: 'button', className: 'SN_sendWorkspace', 'data-primary': 'true', disabled: sending,
            onClick: () => onChoose(null),
          },
            h('span', { className: 'SN_sendWorkspaceMain' },
              h('span', { className: 'SN_sendWorkspaceName' },
                t('send.currentWorkspace'),
                h('span', { className: 'SN_sendBadge' }, t('send.defaultBadge')),
              ),
              h('span', { className: 'SN_sendWorkspacePath' }, workspaces && workspaces.phase === 'pending' ? t('send.loadingWorkspaces') : t('send.noWorkspaces')),
            ),
            h('span', { className: 'SN_sendWorkspaceGo', 'aria-hidden': 'true' }, '→'),
          )
          : null,
      ),
    ),
    h('p', { className: 'SN_sendHint' }, sending ? t('send.opening') : t('send.hint')),
  );
}

export { SendMenu, sendMenuPosition };
