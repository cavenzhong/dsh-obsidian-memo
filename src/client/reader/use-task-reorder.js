/** 阅读模式任务抓手；拖拽会话不跨便签、正文版本或编辑态。 */
import { moveListItem } from '../../shared/list-editing.js';
import { React } from '../react.js';

function useTaskReorder({ path, body, bodyLineOffset = 0, editing, busy, onReorderTask, t }) {
  const sourceRef = React.useRef(null);
  const [drop, setDrop] = React.useState(null);
  const currentRef = React.useRef(null);
  currentRef.current = { path, body, editing, busy, onReorderTask };
  const clear = () => { sourceRef.current = null; setDrop(null); };
  React.useEffect(clear, [path, body, editing, busy]);

  function currentSource() {
    const source = sourceRef.current, current = currentRef.current;
    return source && !current.editing && !current.busy && source.path === current.path && source.body === current.body ? source : null;
  }

  return (block) => {
    if (editing || typeof block.checked !== 'boolean' || !Number.isInteger(block.sourceLine) || typeof onReorderTask !== 'function') return {};
    const targetLine = block.sourceLine;
    function placement(event) {
      const source = currentSource();
      if (!source) return null;
      const rect = event.currentTarget.getBoundingClientRect();
      const after = event.clientY >= rect.top + rect.height / 2;
      return moveListItem(source.body, source.line - bodyLineOffset, targetLine - bodyLineOffset, after) ? { source, after } : null;
    }
    return {
      row: {
        'data-task-drop': drop?.line === targetLine ? (drop.after ? 'after' : 'before') : undefined,
        onDragOver(event) {
          if (!currentSource()) return;
          event.stopPropagation();
          const next = placement(event);
          if (!next) { setDrop(null); return; }
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          setDrop((previous) => previous?.line === targetLine && previous.after === next.after ? previous : { line: targetLine, after: next.after });
        },
        onDragLeave(event) { if (!event.currentTarget.contains(event.relatedTarget)) setDrop(null); },
        onDrop(event) {
          if (!currentSource()) return;
          event.preventDefault();
          event.stopPropagation();
          const next = placement(event);
          clear();
          if (next) currentRef.current.onReorderTask(next.source.line, targetLine, next.after, next.source.body);
        },
      },
      handle: {
        type: 'button', className: 'SN_taskGrip', draggable: !busy, disabled: busy,
        title: t('drawer.taskReorder'), 'aria-label': t('drawer.taskReorder'),
        onClick: (event) => event.stopPropagation(),
        onDragStart(event) {
          const current = currentRef.current;
          event.stopPropagation();
          if (current.editing || current.busy || current.path !== path || current.body !== body || !event.dataTransfer) { event.preventDefault(); return; }
          sourceRef.current = { path, body, line: targetLine };
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-dsh-task', String(targetLine));
        },
        onDragEnd(event) { event.stopPropagation(); clear(); },
      },
    };
  };
}

export { useTaskReorder };
