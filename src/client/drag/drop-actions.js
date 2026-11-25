/** 底部归档 / DeepSeek / 删除操作栏。 */
import { ActionIcon } from '../components/icons.js';
import { h } from '../react.js';

function DropActions({ t, active, onHover, onArchive, onDelete, onDeepSeek }) {
  function enter(event, kind) {
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    onHover(kind, null, null);
  }
  function drop(event, kind) {
    event.preventDefault(); event.stopPropagation();
    if (kind === 'archive') onArchive(event);
    else if (kind === 'deepseek') onDeepSeek(event);
    else onDelete(event);
  }
  return h('div', { className: 'SN_dropActions', role: 'group', 'aria-label': t('drag.actions') },
    h('p', { className: 'SN_dropHint', 'aria-live': 'polite' }, t('drag.hint')),
    h('div', { className: 'SN_dropRow' }, ['archive', 'deepseek', 'delete'].map((kind) => h('div', {
      key: kind, className: 'SN_dropItem', 'data-action': kind,
      'data-active': active === kind ? 'true' : 'false',
      onDragEnter: (event) => enter(event, kind), onDragOver: (event) => enter(event, kind),
      onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) onHover(null, null, null); },
      onDrop: (event) => drop(event, kind),
    }, h(ActionIcon, { kind }), h('span', { className: 'SN_dropLabel' }, t(kind === 'delete' ? 'drag.delete' : kind === 'deepseek' ? 'drag.deepseek' : 'card.archive'))))),
  );
}

export { DropActions };
