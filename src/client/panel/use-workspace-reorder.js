/** 工作空间标签的长按拖动排序：指针捕获、插入线与最终下标。 */
import { WORKSPACE_ALL_ID, WORKSPACE_HOLD_MS } from '../constants.js';
import { React } from '../react.js';

function useWorkspaceReorder({ entries, onReorder, stripRef }) {
  const [drag, setDrag] = React.useState(null);
  const dragRef = React.useRef(null);
  dragRef.current = drag;
  const pressRef = React.useRef(null);
  const suppressClickRef = React.useRef(false);

  React.useEffect(() => () => {
    if (pressRef.current) {
      if (pressRef.current.timer) clearTimeout(pressRef.current.timer);
      detachPress(pressRef.current);
    }
    pressRef.current = null;
  }, []);

  function detachPress(press) {
    if (!press || !press.listeners) return;
    document.removeEventListener('pointermove', press.listeners.move, true);
    document.removeEventListener('pointerup', press.listeners.up, true);
    document.removeEventListener('pointercancel', press.listeners.cancel, true);
    window.removeEventListener('blur', press.listeners.cancel);
    press.listeners = null;
  }

  function cancelDrag() {
    const press = pressRef.current;
    if (press) {
      if (press.timer) clearTimeout(press.timer);
      detachPress(press);
    }
    pressRef.current = null;
    dragRef.current = null;
    setDrag(null);
  }

  function insertionFor(clientX) {
    const strip = stripRef.current;
    if (!strip) return { index: 0, caretX: 0 };
    const stripRect = strip.getBoundingClientRect();
    // 拖动中的标签跟随指针，不参与插入点计算；位置按其余标签的中线算。
    const tabs = Array.from(strip.querySelectorAll('.SN_wsTab'))
      .filter((element) => element.getAttribute('data-all') !== 'true' && element.getAttribute('data-dragging') !== 'true');
    let index = tabs.length;
    let caretX = 0;
    for (let i = 0; i < tabs.length; i += 1) {
      const rect = tabs[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        index = i;
        caretX = rect.left - stripRect.left + strip.scrollLeft;
        break;
      }
    }
    if (index === tabs.length && tabs.length > 0) {
      const last = tabs[tabs.length - 1].getBoundingClientRect();
      caretX = last.right - stripRect.left + strip.scrollLeft;
    }
    return { index: index, caretX: Math.max(0, caretX) };
  }

  function movePress(press, event) {
    if (!press || pressRef.current !== press) return;
    const dx = event.clientX - press.startX;
    const dy = event.clientY - press.startY;
    if (!press.active) {
      // 长按前先移动：当成滚动/点击，不再进入排序拖拽。
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        if (press.timer) clearTimeout(press.timer);
        detachPress(press);
        pressRef.current = null;
      }
      return;
    }
    event.preventDefault?.();
    const insertion = insertionFor(event.clientX);
    const next = { id: press.entry.id, dx: dx, insertAt: insertion.index, caretX: insertion.caretX };
    dragRef.current = next;
    setDrag(next);
  }

  function endPress(press, event) {
    if (!press || pressRef.current !== press) return;
    if (press.timer) clearTimeout(press.timer);
    detachPress(press);
    pressRef.current = null;
    if (!press.active) return;
    suppressClickRef.current = true;
    // 长按在标签外松手时不会产生 click；0ms 后自动复位，避免吞掉下一次正常点击。
    setTimeout(() => { suppressClickRef.current = false; }, 0);
    try { press.target.releasePointerCapture?.(press.pointerId); } catch (error) { /* ignore */ }
    const insertion = insertionFor(event.clientX);
    const custom = entries.filter((entry) => entry.id !== WORKSPACE_ALL_ID);
    const from = custom.findIndex((entry) => entry.id === press.entry.id);
    // 插入点按「移除自己之后」的其余标签算，正好就是最终下标。
    const to = insertion.index;
    if (from >= 0 && to !== from && to >= 0 && to < custom.length) onReorder(press.entry.id, to);
    dragRef.current = null;
    setDrag(null);
  }

  function startPress(event, entry) {
    if (entry.id === WORKSPACE_ALL_ID || event.button !== 0 || event.isPrimary === false) return;
    if (pressRef.current || dragRef.current) cancelDrag();
    const target = event.currentTarget;
    const press = {
      entry: entry, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId,
      target: target, active: false, timer: null, listeners: null,
    };
    // 指针移出标签后仍要能收到移动/松手，否则长按会在别处误触发排序。
    press.listeners = {
      move: (e) => movePress(press, e),
      up: (e) => endPress(press, e),
      cancel: () => cancelDrag(),
    };
    document.addEventListener('pointermove', press.listeners.move, true);
    document.addEventListener('pointerup', press.listeners.up, true);
    document.addEventListener('pointercancel', press.listeners.cancel, true);
    window.addEventListener('blur', press.listeners.cancel);
    press.timer = setTimeout(() => {
      if (pressRef.current !== press) return;
      press.active = true;
      try { target.setPointerCapture?.(press.pointerId); } catch (error) { /* 捕获失败时仍可用 hover 视觉 */ }
      const next = { id: entry.id, dx: 0, insertAt: null, caretX: 0 };
      dragRef.current = next;
      setDrag(next);
    }, WORKSPACE_HOLD_MS);
    pressRef.current = press;
  }

  /** 长按结束后吞掉紧随的 click；返回 true 表示这次点击已被消费。 */
  function consumeClick() {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  }

  return { drag, startPress, cancelDrag, consumeClick };
}

export { useWorkspaceReorder };
