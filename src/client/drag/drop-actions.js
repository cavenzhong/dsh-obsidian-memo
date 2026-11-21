/** 底部归档/项目/删除操作栏；仅项目保留目标选择菜单。 */
import { ActionIcon } from '../components/icons.js';
import { h } from '../react.js';

function DropActions({ t, active, activeTargetId, projectTargets, parked, onHover, onArchive, onProject, onProjectChoose, onDelete }) {
  function enter(event, kind, targetId = null) {
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    onHover(kind, targetId, targetId ? event.currentTarget.parentElement : null);
  }
  function drop(event, kind, targetId = null) {
    event.preventDefault(); event.stopPropagation();
    if (kind === 'archive') onArchive(event);
    else if (kind === 'project') onProject(event, targetId);
    else onDelete(event);
  }
  const menu = active === 'project'
    ? h('div', { className: 'SN_dropTargets', role: 'menu', 'aria-label': t('project.aria') },
      [{ id: '__new__', filename: '', name: t('project.newTarget'), label: t('project.newTarget') }, ...(projectTargets || [])].map((target) => h('button', {
        key: target.id, type: 'button', role: 'menuitem', className: 'SN_dropTarget',
        'data-target-id': target.id, 'data-active': activeTargetId === target.id ? 'true' : 'false',
        onDragEnter: (event) => enter(event, 'project', target.id), onDragOver: (event) => enter(event, 'project', target.id),
        onDragLeave: (event) => { if (event.relatedTarget?.closest?.('.SN_dropTarget')?.parentElement === event.currentTarget.parentElement) return; if (!event.currentTarget.contains(event.relatedTarget)) onHover('project', null); },
        onDrop: (event) => drop(event, 'project', target.id),
        onClick: (event) => { event.stopPropagation(); if (parked) onProjectChoose(target); },
      }, target.label || target.name || target.id)))
    : null;
  return h('div', { className: 'SN_dropActions', role: 'group', 'aria-label': t('drag.actions') },
    h('p', { className: 'SN_dropHint', 'aria-live': 'polite' }, t('drag.hint')),
    h('div', { className: 'SN_dropRow' }, ['archive', 'project', 'delete'].map((kind) => {
      return h('div', { key: kind, className: 'SN_dropItem', 'data-action': kind,
        'data-parked': active === kind && parked ? 'true' : undefined,
        'data-active': active === kind ? 'true' : 'false',
        onDragEnter: (event) => enter(event, kind), onDragOver: (event) => enter(event, kind),
        onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) onHover(null, null); }, onDrop: (event) => drop(event, kind),
      }, kind === 'project' ? menu : null, h(ActionIcon, { kind }), h('span', { className: 'SN_dropLabel' }, t(kind === 'delete' ? 'drag.delete' : 'card.' + kind)));
    })),
  );
}

export { DropActions };
