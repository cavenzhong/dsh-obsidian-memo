/** 阅读模式列表抓手；拖拽会话不跨便签、正文版本或编辑态。 */
import { listDragModel } from '../../shared/list-editing.js';
import { React } from '../react.js';

const DROP_ROW = '[data-list-drop-line]';

function edgeScrollStep(container, { x, y }, elapsed) {
  const { top, bottom, left, right } = container.getBoundingClientRect();
  const edge = Math.min(80, (bottom - top) / 3);
  if (edge <= 0 || x < left || x >= right || y < top || y >= bottom) return 0;
  const proximity = (Math.max(0, edge - (bottom - y)) - Math.max(0, edge - (y - top))) / edge;
  return proximity ? Math.sign(proximity) * Math.max(1, Math.round(1.5 * proximity ** 2 * elapsed)) : 0;
}

function canScroll(container, step) {
  return step > 0 ? container.scrollTop < container.scrollHeight - container.clientHeight : step < 0 && container.scrollTop > 0;
}

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
  const scrollRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(null);
  const [drop, setDrop] = React.useState(null);
  const currentRef = React.useRef(null);
  currentRef.current = { path, body, bodyLineOffset, editing, busy, onReorderTask };
  function stopScroll() {
    const scroll = scrollRef.current;
    scrollRef.current = null;
    if (scroll?.frame != null) scroll.win.cancelAnimationFrame(scroll.frame);
  }
  const clear = () => { stopScroll(); sourceRef.current = null; setDragging(null); setDrop(null); };
  React.useLayoutEffect(() => {
    clear();
    return () => { stopScroll(); sourceRef.current = null; };
  }, [path, body, bodyLineOffset, editing, busy]);

  function matchesCurrent(source) {
    const current = currentRef.current;
    return source && !current.editing && !current.busy && typeof current.onReorderTask === 'function' && source.path === current.path
      && source.body === current.body && source.offset === current.bodyLineOffset;
  }
  const currentSource = () => matchesCurrent(sourceRef.current) ? sourceRef.current : null;

  function placement(container, { x, y, target }, source) {
    // 自动滚动时指针可能没动，但其下方的行已经变了；不要依赖上一次 dragover 的目标。
    const doc = container.ownerDocument;
    const hit = doc?.elementFromPoint ? doc.elementFromPoint(x, y) : target;
    const row = hit?.closest?.(DROP_ROW);
    if (!row || !container.contains(row)) return null;
    const line = Number(row.getAttribute('data-list-drop-line'));
    const rect = row.getBoundingClientRect();
    const after = y >= rect.top + rect.height / 2;
    if (source.tested?.line !== line || source.tested.after !== after) {
      source.tested = { line, after, allowed: source.model.canMove(source.line - source.offset, line - source.offset, after) };
    }
    return source.tested.allowed ? source.tested : null;
  }
  const publishDrop = (next) => setDrop((previous) => previous?.line === next?.line && previous?.after === next?.after ? previous : next);

  function autoScroll(container, point, source) {
    const win = container.ownerDocument?.defaultView;
    if (!win?.requestAnimationFrame || !canScroll(container, edgeScrollStep(container, point, 16))) { stopScroll(); return; }
    if (scrollRef.current?.container === container && scrollRef.current.source === source) {
      scrollRef.current.point = point;
      return;
    }
    stopScroll();
    const scroll = { container, point, source, win, frame: null, lastTime: null };
    scrollRef.current = scroll;
    function tick(time) {
      if (scrollRef.current !== scroll) return;
      scroll.frame = null;
      if (currentSource() !== source) { stopScroll(); return; }
      const elapsed = scroll.lastTime === null ? 16 : Math.min(32, time - scroll.lastTime);
      scroll.lastTime = time;
      const step = edgeScrollStep(container, scroll.point, elapsed);
      if (!canScroll(container, step)) { stopScroll(); return; }
      container.scrollTop += step;
      publishDrop(placement(container, scroll.point, source));
      if (canScroll(container, step)) scroll.frame = win.requestAnimationFrame(tick);
      else stopScroll();
    }
    scroll.frame = win.requestAnimationFrame(tick);
  }

  function blockProps(block) {
    if (editing || typeof body !== 'string' || !Number.isInteger(block.sourceLine) || typeof onReorderTask !== 'function') return {};
    const targetLine = block.sourceLine;
    const inSource = matchesCurrent(dragging) && targetLine >= dragging.line && (block.sourceEndLine ?? targetLine) < dragging.end;
    const row = inSource ? { 'data-list-dragging': 'true', 'data-list-drag-source': targetLine === dragging.line ? 'true' : undefined } : {};
    if (block.kind !== 'li' || (block.marker && typeof block.checked !== 'boolean')) return { row };

    return {
      row: {
        ...row,
        'data-list-drop-line': targetLine,
        'data-task-drop': currentSource() && drop?.line === targetLine ? (drop.after ? 'after' : 'before') : undefined,
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
          clear();
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
  }

  const pointer = (event) => ({ x: event.clientX, y: event.clientY, target: event.target });
  return { blockProps, scrollProps: {
    onDragOver(event) {
      const source = currentSource();
      if (!source) return;
      event.stopPropagation();
      const point = pointer(event), container = event.currentTarget;
      const next = placement(container, point, source);
      publishDrop(next);
      autoScroll(container, point, source);
      // 边缘缓动可能马上把可落点滚入指针下，即使当前命中的是间隙也接收原生 drop；写入仍复核最终落点。
      if (!next && !scrollRef.current) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    },
    onDragLeave(event) {
      if (!currentSource() || event.currentTarget.contains(event.relatedTarget)) return;
      stopScroll();
      publishDrop(null);
    },
    onDrop(event) {
      const source = currentSource();
      if (!source) return;
      event.preventDefault();
      event.stopPropagation();
      const next = placement(event.currentTarget, pointer(event), source);
      clear();
      if (next) currentRef.current.onReorderTask(source.line, next.line, next.after, source.body);
    },
  } };
}

export { useTaskReorder };
