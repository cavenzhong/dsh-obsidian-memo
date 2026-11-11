/** 底部归档/项目/删除操作栏，转发拖放和归档目录选择。 */
import { ActionIcon } from '../components/icons.js';
import { h } from '../react.js';

function DropActions({ t, active, activeTargetId, targets, parked, onHover, onArchive, onArchiveChoose, onProject, onDelete }) {
  function enter(event, kind, targetId = null) {
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = kind === 'archive' && targets.length === 0 ? 'none' : 'move';
    onHover(kind, targetId);
  }
  function drop(event, kind, targetId = null) {
    event.preventDefault(); event.stopPropagation();
    if (kind === 'archive') onArchive(event, targetId);
    else if (kind === 'project') onProject(event);
    else onDelete(event);
  }
  return h('div', { className: 'SN_dropActions', role: 'group', 'aria-label': t('drag.actions') },
    h('p', { className: 'SN_dropHint', 'aria-live': 'polite' }, t('drag.hint')),
    h('div', { className: 'SN_dropRow' }, ['archive', 'project', 'delete'].map((kind) => h('div', {
      key: kind, className: 'SN_dropItem', 'data-action': kind,
      'data-parked': kind === 'archive' && parked ? 'true' : undefined,
      'data-active': active === kind ? 'true' : 'false',
      'aria-disabled': kind === 'archive' && targets.length === 0 ? 'true' : undefined,
      onDragEnter: (event) => enter(event, kind),
      onDragOver: (event) => enter(event, kind),
      onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) onHover(null, null); },
      onDrop: (event) => drop(event, kind),
    },
    active === 'archive' && kind === 'archive' && targets.length > 0
      ? h('div', { className: 'SN_dropTargets', role: 'menu', 'aria-label': t('archive.aria') }, targets.map((target) => h('button', {
        key: target.id,
        type: 'button', role: 'menuitem',
        className: 'SN_dropTarget',
        'data-target-id': target.id,
        'data-active': activeTargetId === target.id ? 'true' : 'false',
        onDragEnter: (event) => enter(event, 'archive', target.id),
        onDragOver: (event) => enter(event, 'archive', target.id),
        onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) onHover('archive', null); },
        onDrop: (event) => drop(event, 'archive', target.id),
        onClick: (event) => { event.stopPropagation(); if (parked) onArchiveChoose(target.id); },
      }, target.label || target.id)))
      : null,
    h(ActionIcon, { kind }), h('span', { className: 'SN_dropLabel' }, t(kind === 'delete' ? 'drag.delete' : 'card.' + kind))))),
  );
}

export { DropActions };
