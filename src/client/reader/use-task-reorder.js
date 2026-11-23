/** 阅读模式列表抓手；拖拽会话不跨便签、正文版本或编辑态。 */
import { listDragModel } from '../../shared/list-editing.js';
import { React } from '../react.js';

function suppressDragPreview(event) {
  const document = event.currentTarget.ownerDocument;
  if (!document?.body || !event.dataTransfer.setDragImage) return;
  const preview = document.createElement('canvas');
  preview.width = preview.height = 1;
  preview.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  // Chromium 要在 dragstart 返回后对仍在布局树里的元素取快照。
  document.body.append(preview);
  try { event.dataTransfer.setDragImage(preview, 0, 0); }
  finally { setTimeout(() => preview.remove(), 0); }
}

function useTaskReorder({ path, body, bodyLineOffset = 0, editing, busy, onReorderTask, t }) {
  const sourceRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(null);
  const [drop, setDrop] = React.useState(null);
  const currentRef = React.useRef(null);
  currentRef.current = { path, body, bodyLineOffset, editing, busy, onReorderTask };
  const clear = () => { sourceRef.current = null; setDragging(null); setDrop(null); };
  React.useEffect(clear, [path, body, bodyLineOffset, editing, busy]);

  function matchesCurrent(source) {
    const current = currentRef.current;
    return source && !current.editing && !current.busy && source.path === current.path
      && source.body === current.body && source.offset === current.bodyLineOffset;
  }
  const currentSource = () => matchesCurrent(sourceRef.current) ? sourceRef.current : null;

  return (block) => {
    if (editing || typeof body !== 'string' || !Number.isInteger(block.sourceLine) || typeof onReorderTask !== 'function') return {};
    const targetLine = block.sourceLine;
    const inSource = matchesCurrent(dragging) && targetLine >= dragging.line && (block.sourceEndLine ?? targetLine) < dragging.end;
    const row = inSource ? { 'data-list-dragging': 'true', 'data-list-drag-source': targetLine === dragging.line ? 'true' : undefined } : {};
    if (block.kind !== 'li' || (block.marker && typeof block.checked !== 'boolean')) return { row };

    function placement(event) {
      const source = currentSource();
      if (!source) return null;
      const rect = event.currentTarget.getBoundingClientRect();
      const after = event.clientY >= rect.top + rect.height / 2;
      return source.model.canMove(source.line - source.offset, targetLine - source.offset, after) ? { source, after } : null;
    }
    return {
      row: {
        ...row,
        'data-task-drop': currentSource() && drop?.line === targetLine ? (drop.after ? 'after' : 'before') : undefined,
        onDragOver(event) {
          if (!currentSource()) return;
          event.stopPropagation();
          const next = placement(event);
          if (!next) { setDrop(null); return; }
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          setDrop((previous) => previous?.line === targetLine && previous.after === next.after ? previous : { line: targetLine, after: next.after });
        },
        onDragLeave(event) {
          if (!event.currentTarget.contains(event.relatedTarget)) setDrop((previous) => previous?.line === targetLine ? null : previous);
        },
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
        title: t('drawer.listReorder'), 'aria-label': t('drawer.listReorder'),
        onClick: (event) => event.stopPropagation(),
        onDragStart(event) {
          event.stopPropagation();
          const candidate = { path, body, line: targetLine, offset: bodyLineOffset };
          if (!matchesCurrent(candidate) || !event.dataTransfer) { event.preventDefault(); return; }
          candidate.model = listDragModel(body);
          const end = candidate.model.itemEnd(targetLine - bodyLineOffset);
          if (end === null) { event.preventDefault(); return; }
          candidate.end = end + bodyLineOffset;
          sourceRef.current = candidate;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-dsh-task', String(targetLine));
          // 透明快照替代系统拖影；原抓手仍在源行，移动方向由插入线表达。
          suppressDragPreview(event);
          setDragging(candidate);
        },
        onDragEnd(event) { event.stopPropagation(); clear(); },
      },
    };
  };
}

export { useTaskReorder };
