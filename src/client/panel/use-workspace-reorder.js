/** 工作空间标签拖动排序，兼容触屏短滑与长按拖动。 */
import { WORKSPACE_ALL_ID, WORKSPACE_HOLD_MS } from '../constants.js';
import { React } from '../react.js';

function workspaceInsertion(slots, id, clientX, stripLeft, scrollLeft) {
  const rest = slots.filter((slot) => slot.id !== WORKSPACE_ALL_ID && slot.id !== id);
  const index = rest.findIndex((slot) => clientX < (slot.left + slot.right) / 2);
  const edge = index < 0 ? rest.at(-1)?.right : rest[index].left;
  return { index: index < 0 ? rest.length : index, caretX: edge === undefined ? 0 : edge - stripLeft + scrollLeft };
}

function useWorkspaceReorder({ entries, onReorder, stripRef }) {
  const [drag, setDrag] = React.useState(null);
  const pressRef = React.useRef(null);
  const suppressClickRef = React.useRef(false);
  const clickTimerRef = React.useRef(null);
  React.useEffect(() => () => {
    detach(pressRef.current);
    pressRef.current = null;
    clearTimeout(clickTimerRef.current);
  }, []);

  function detach(press) {
    if (!press) return;
    clearTimeout(press.timer);
    if (press.frame != null) cancelAnimationFrame(press.frame);
    document.removeEventListener('pointermove', press.move, true);
    document.removeEventListener('pointerup', press.up, true);
    document.removeEventListener('pointercancel', press.cancel, true);
    window.removeEventListener('blur', press.cancel);
  }

  function stop(press) {
    detach(press);
    pressRef.current = null;
    setDrag(null);
  }

  function cancelDrag(event) {
    const press = pressRef.current;
    if (!press || (typeof event?.pointerId === 'number' && event.pointerId !== press.pointerId)) return;
    stop(press);
  }

  function insertionFor(strip, id, clientX) {
    const slots = Array.from(strip.querySelectorAll('.SN_wsSlot'), (slot) => {
      const { left, right } = slot.getBoundingClientRect();
      return { id: slot.getAttribute('data-workspace-slot'), left, right };
    });
    return workspaceInsertion(slots, id, clientX, strip.getBoundingClientRect().left, strip.scrollLeft);
  }

  function updateDrag(press, strip) {
    const insertion = insertionFor(strip, press.id, press.x);
    setDrag({ id: press.id, dx: press.x - press.startX + strip.scrollLeft - press.scrollStart,
      insertAt: insertion.index, caretX: insertion.caretX });
  }

  function autoScroll(press, strip) {
    if (press.frame != null) return;
    const tick = () => {
      press.frame = null;
      if (pressRef.current !== press) return;
      const rect = strip.getBoundingClientRect();
      const edge = Math.min(28, rect.width / 3);
      const step = press.x < rect.left + edge ? -12 : press.x > rect.right - edge ? 12 : 0;
      const before = strip.scrollLeft;
      strip.scrollLeft += step;
      if (strip.scrollLeft !== before) {
        updateDrag(press, strip);
        press.frame = requestAnimationFrame(tick);
      }
    };
    if (typeof requestAnimationFrame === 'function') press.frame = requestAnimationFrame(tick);
  }

  function startPress(event, entry) {
    if (entry.id === WORKSPACE_ALL_ID || event.button !== 0 || event.isPrimary === false) return;
    const strip = stripRef.current;
    if (!strip) return;
    cancelDrag();
    const touch = event.pointerType === 'touch';
    const target = event.currentTarget;
    const press = { id: entry.id, startX: event.clientX, startY: event.clientY, x: event.clientX,
      scrollStart: strip.scrollLeft, pointerId: event.pointerId, mode: 'waiting', frame: null };

    function beginDrag() {
      clearTimeout(press.timer);
      press.mode = 'dragging';
      try { target.setPointerCapture?.(press.pointerId); } catch (error) { /* 文档仍监听指针 */ }
    }

    press.move = (e) => {
      if (e.pointerId !== press.pointerId) return;
      press.x = e.clientX;
      const dx = e.clientX - press.startX, dy = e.clientY - press.startY;
      if (press.mode === 'waiting' && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        if (Math.abs(dx) <= Math.abs(dy)) { stop(press); return; }
        if (touch) {
          clearTimeout(press.timer);
          press.mode = 'swiping';
        } else {
          beginDrag();
        }
      }
      if (press.mode === 'swiping') strip.scrollLeft = press.scrollStart - dx;
      if (press.mode !== 'dragging') return;
      e.preventDefault?.();
      updateDrag(press, strip);
      autoScroll(press, strip);
    };
    press.up = (e) => {
      if (e.pointerId !== press.pointerId) return;
      stop(press);
      if (press.mode === 'waiting') return;
      // 拖动或滑动结束后仅吞掉紧随的 click。
      suppressClickRef.current = true;
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => { suppressClickRef.current = false; }, 0);
      if (press.mode !== 'dragging') return;
      const custom = entries.filter((item) => item.id !== WORKSPACE_ALL_ID);
      const from = custom.findIndex((item) => item.id === press.id);
      const { index } = insertionFor(strip, press.id, e.clientX);
      if (from >= 0 && index !== from && index < custom.length) onReorder(press.id, index);
    };
    press.cancel = cancelDrag;
    pressRef.current = press;
    document.addEventListener('pointermove', press.move, true);
    document.addEventListener('pointerup', press.up, true);
    document.addEventListener('pointercancel', press.cancel, true);
    window.addEventListener('blur', press.cancel);
    press.timer = setTimeout(() => {
      if (pressRef.current !== press || press.mode !== 'waiting') return;
      beginDrag();
      setDrag({ id: press.id, dx: 0, insertAt: null, caretX: 0 });
    }, WORKSPACE_HOLD_MS);
  }

  function consumeClick() {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  }

  return { drag, startPress, cancelDrag, consumeClick };
}

export { useWorkspaceReorder, workspaceInsertion };
