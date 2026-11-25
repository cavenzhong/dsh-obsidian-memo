/** 渲染缩略拖拽浮层并绑定动画控制器。 */
import { ActionIcon, NoteGlyphIcon } from '../components/icons.js';
import { cardDragLayout, createCardDragMotion, iconDragLayout } from './motion.js';
import { React, ReactDOM, h } from '../react.js';
import { NoteCard } from '../wall/note-card.js';

function actionIconKind(action) {
  return action === 'workspace' ? 'move' : action;
}

function cleanPath(value) { return String(value || '').replace(/[\\/]+/g, '/').replace(/(.)\/$/, '$1'); }

/** 区分「等于根」的空路径与「不在根内」。Windows 与 Host 一样按不区分大小写比较。 */
function relativePath(rootValue, targetValue, ignoreCase) {
  const root = cleanPath(rootValue), target = cleanPath(targetValue);
  if (!root || !target) return null;
  const key = (path) => ignoreCase ? path.toLowerCase() : path;
  if (key(target) === key(root)) return '';
  const prefix = root.endsWith('/') ? root : root + '/';
  return key(target).startsWith(key(prefix)) ? target.slice(prefix.length) : null;
}

function archivePreviewHint(note, settings, t) {
  if (settings?.archiveMode !== 'mapped') {
    return t('drag.releaseArchiveLocal', { folder: settings?.archiveFolderName || '归档' });
  }
  if (!settings.archiveDir) return t('drag.releaseArchiveUnconfigured');
  const notePath = cleanPath(note?.path);
  const slash = notePath.lastIndexOf('/');
  const noteFolder = slash === 0 ? '/' : slash > 0 ? notePath.slice(0, slash) : '';
  const ignoreCase = /^(?:[a-z]:|\\\\|\/\/)/i.test(settings.vaultPath);
  const root = relativePath(settings.vaultPath, settings.archiveDir, ignoreCase);
  const nested = relativePath(settings.notesDir, noteFolder, ignoreCase)
    ?? relativePath(settings.vaultPath, noteFolder, ignoreCase);
  if (root === null || nested === null) return t('drag.releaseArchiveUnconfigured');
  const destination = [root, nested].filter(Boolean).join('/') || '.';
  return t('drag.releaseArchiveMapped', { path: destination });
}

function CardDragOverlay({ note, point, action, workspaceLabel, paper, archiveSettings, t, motionRef, zen = false }) {
  const layerRef = React.useRef(null);
  React.useLayoutEffect(() => {
    if (!layerRef.current || !motionRef) return undefined;
    const motion = createCardDragMotion(layerRef.current, point, { iconOnly: zen });
    motionRef.current = motion;
    return () => { motion.dispose(); if (motionRef.current === motion) motionRef.current = null; };
  }, [point, motionRef, zen]);
  const text = action === 'archive'
    ? archivePreviewHint(note, archiveSettings, t)
    : action === 'workspace'
      ? t('drag.releaseWorkspace', { label: workspaceLabel || '' })
      : action === 'deepseek'
        ? t('drag.releaseDeepSeek')
        : action === 'delete' ? t('drag.release') : '';
  // 初始定位只交给 React 一次；后续移动/停靠/窗口缩放由同一个 motion 持有。
  const layout = React.useMemo(() => (zen ? iconDragLayout : cardDragLayout)(point, { width: window.innerWidth || 1024, height: window.innerHeight || 768 }), [point, zen]);
  const preview = React.useMemo(() => h(NoteCard, { note, emojis: [], paper: paper, drawerOpen: true, preview: true, actions: { current: { t } } }), [note, t, paper]);
  const layer = h('div', {
    className: 'SN_dragLayer', ref: layerRef, 'aria-hidden': 'true', 'data-zen': zen ? 'true' : undefined,
    style: { transform: 'translate3d(' + layout.left + 'px,' + layout.top + 'px,0)', width: layout.previewWidth + 'px', height: layout.previewHeight + 'px', '--sn-drag-hint-width': layout.hintWidth + 'px' },
  },
    zen ? h('div', { className: 'SN_dragZenGlyph' }, h(NoteGlyphIcon, null))
      : h('div', { className: 'SN_dragPreview', style: { width: layout.width + 'px', height: layout.height + 'px', transform: 'scale(' + layout.scale + ')' } },
        preview,
      ),
    !zen && text ? h('div', { className: 'SN_dragFollow', 'data-action': action }, h(ActionIcon, { kind: actionIconKind(action), size: 15 }), h('span', null, text)) : null,
  );
  return typeof document !== 'undefined' && document.body ? ReactDOM.createPortal(layer, document.body) : layer;
}

export { CardDragOverlay, archivePreviewHint };
