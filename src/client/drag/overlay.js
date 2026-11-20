/** 渲染缩略拖拽浮层并绑定动画控制器。 */
import { ActionIcon } from '../components/icons.js';
import { cardDragLayout, createCardDragMotion } from './motion.js';
import { Fragment, React, ReactDOM, h } from '../react.js';
import { NoteCard } from '../wall/note-card.js';

// 菜单提示在顶层 portal 中，避免被缩略卡盖住；只在锚点/窗口变化时读取菜单矩形。
function ArchiveDragHint({ anchor, text }) {
  const ref = React.useRef(null);
  React.useLayoutEffect(() => {
    const element = ref.current, win = anchor.ownerDocument.defaultView;
    if (!element || !win) return undefined;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.max(1, Math.min(270, win.innerWidth - 16));
      const left = Math.max(8 + width / 2, Math.min(rect.left + rect.width / 2, win.innerWidth - 8 - width / 2));
      element.style.left = left + 'px';
      element.style.top = (rect.top - 8) + 'px';
      element.style.maxWidth = width + 'px';
    };
    place();
    win.addEventListener('resize', place);
    const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(place) : null;
    observer?.observe(anchor);
    return () => { win.removeEventListener('resize', place); observer?.disconnect(); };
  }, [anchor]);
  return h('div', { ref, className: 'SN_dragFollow SN_dragTargetHint', 'data-action': 'archive', 'aria-hidden': 'true' },
    h(ActionIcon, { kind: 'archive', size: 15 }), h('span', null, text));
}

function CardDragOverlay({ note, point, action, targetId, targetAnchor, targets, t, motionRef }) {
  const layerRef = React.useRef(null);
  React.useLayoutEffect(() => {
    if (!layerRef.current || !motionRef) return undefined;
    const motion = createCardDragMotion(layerRef.current, point);
    motionRef.current = motion;
    return () => { motion.dispose(); if (motionRef.current === motion) motionRef.current = null; };
  }, [point, motionRef]);
  const target = (targets || []).find((item) => item.id === targetId);
  const anchored = action === 'archive' && target && targetAnchor;
  const text = action === 'archive'
    ? (target ? t('drag.releaseArchiveTarget', { label: target.label || target.id }) : t('drag.releaseArchive'))
    : action === 'project' ? t('drag.releaseProject') : action === 'delete' ? t('drag.release') : '';
  // 初始定位只交给 React 一次；后续移动/停靠/窗口缩放由同一个 motion 持有。
  const layout = React.useMemo(() => cardDragLayout(point, { width: window.innerWidth || 1024, height: window.innerHeight || 768 }), [point]);
  const layer = h('div', {
    className: 'SN_dragLayer', ref: layerRef, 'aria-hidden': 'true',
    style: { transform: 'translate3d(' + layout.left + 'px,' + layout.top + 'px,0)', width: layout.previewWidth + 'px', height: layout.previewHeight + 'px', '--sn-drag-hint-width': layout.hintWidth + 'px' },
  },
    h('div', { className: 'SN_dragPreview', style: { width: layout.width + 'px', height: layout.height + 'px', transform: 'scale(' + layout.scale + ')' } },
      React.useMemo(() => h(NoteCard, { note, emojis: [], drawerOpen: true, preview: true, actions: { current: { t } } }), [note, t]),
    ),
    text && !anchored ? h('div', { className: 'SN_dragFollow', 'data-action': action }, h(ActionIcon, { kind: action, size: 15 }), h('span', null, text)) : null,
  );
  const overlay = anchored ? h(Fragment, null, layer, h(ArchiveDragHint, { anchor: targetAnchor, text })) : layer;
  return typeof document !== 'undefined' && document.body ? ReactDOM.createPortal(overlay, document.body) : overlay;
}

export { CardDragOverlay };
