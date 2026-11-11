/** 渲染缩略拖拽浮层并绑定动画控制器。 */
import { ActionIcon } from '../components/icons.js';
import { cardDragLayout, createCardDragMotion } from './motion.js';
import { React, ReactDOM, h } from '../react.js';
import { NoteCard } from '../wall/note-card.js';

function CardDragOverlay({ note, point, action, targetId, targets, t, motionRef }) {
  const layerRef = React.useRef(null);
  React.useLayoutEffect(() => {
    if (!layerRef.current || !motionRef) return undefined;
    const motion = createCardDragMotion(layerRef.current, point);
    motionRef.current = motion;
    return () => { motion.dispose(); if (motionRef.current === motion) motionRef.current = null; };
  }, [point, motionRef]);
  const target = (targets || []).find((item) => item.id === targetId);
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
    text ? h('div', { className: 'SN_dragFollow', 'data-action': action }, h(ActionIcon, { kind: action, size: 15 }), h('span', null, text)) : null,
  );
  return typeof document !== 'undefined' && document.body ? ReactDOM.createPortal(layer, document.body) : layer;
}

export { CardDragOverlay };
