/** 底部归档/项目/删除操作栏，转发拖放和归档目录/项目索引选择。 */
import { ActionIcon } from '../components/icons.js';
import { h } from '../react.js';

function DropActions({ t, active, activeTargetId, targets, projectTargets, parked, onHover, onArchive, onArchiveChoose, onProject, onProjectChoose, onDelete }) {
  function enter(event, kind, targetId = null) {
    event.preventDefault(); event.stopPropagation();
    const list = kind === 'archive' ? targets : kind === 'project' ? projectTargets : [];
    event.dataTransfer.dropEffect = kind === 'archive' && list.length === 0 ? 'none' : 'move';
    onHover(kind, targetId, targetId ? event.currentTarget.parentElement : null);
  }
  function drop(event, kind, targetId = null) {
    event.preventDefault(); event.stopPropagation();
    if (kind === 'archive') onArchive(event, targetId);
    else if (kind === 'project') onProject(event, targetId);
    else onDelete(event);
  }
  const menu = (kind, list, emptyLabel) => active === kind && (kind === 'project' || list.length > 0)
    ? h('div', { className: 'SN_dropTargets', role: 'menu', 'aria-label': t(kind === 'archive' ? 'archive.aria' : 'project.aria') },
      (kind === 'project' ? [{ id: '__new__', filename: '', name: t('project.newTarget'), label: t('project.newTarget') }, ...list] : list).map((target) => h('button', {
        key: target.id, type: 'button', role: 'menuitem', className: 'SN_dropTarget',
        'data-target-id': target.id, 'data-active': activeTargetId === target.id ? 'true' : 'false',
        onDragEnter: (event) => enter(event, kind, target.id), onDragOver: (event) => enter(event, kind, target.id),
        onDragLeave: (event) => { if (event.relatedTarget?.closest?.('.SN_dropTarget')?.parentElement === event.currentTarget.parentElement) return; if (!event.currentTarget.contains(event.relatedTarget)) onHover(kind, null); },
        onDrop: (event) => drop(event, kind, target.id),
        onClick: (event) => { event.stopPropagation(); if (parked && kind === 'archive') onArchiveChoose(target.id); else if (parked && kind === 'project') onProjectChoose(target); },
      }, target.label || target.name || target.id)))
    : null;
  return h('div', { className: 'SN_dropActions', role: 'group', 'aria-label': t('drag.actions') },
    h('p', { className: 'SN_dropHint', 'aria-live': 'polite' }, t('drag.hint')),
    h('div', { className: 'SN_dropRow' }, ['archive', 'project', 'delete'].map((kind) => {
      const list = kind === 'archive' ? targets : kind === 'project' ? projectTargets : [];
      return h('div', { key: kind, className: 'SN_dropItem', 'data-action': kind,
        'data-parked': active === kind && parked ? 'true' : undefined,
        'data-active': active === kind ? 'true' : 'false', 'aria-disabled': kind === 'archive' && list.length === 0 ? 'true' : undefined,
        onDragEnter: (event) => enter(event, kind), onDragOver: (event) => enter(event, kind),
        onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) onHover(null, null); }, onDrop: (event) => drop(event, kind),
      }, menu(kind, list), h(ActionIcon, { kind }), h('span', { className: 'SN_dropLabel' }, t(kind === 'delete' ? 'drag.delete' : 'card.' + kind)));
    })),
  );
}

export { DropActions };
