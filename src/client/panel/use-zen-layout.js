/** Zen 临时分栏：只在本次模式内调宽，不覆盖普通阅读面板偏好。 */
import { React } from '../react.js';

const DEFAULT_ZEN_SPLIT = 1 / 3;

function clampZenSplit(value, width) {
  const lower = Math.min(DEFAULT_ZEN_SPLIT, Math.max(0.2, 180 / width));
  const upper = Math.max(DEFAULT_ZEN_SPLIT, Math.min(0.5, 1 - 320 / width));
  return Math.max(lower, Math.min(value, upper));
}

function useZenLayout({ zen, pinned, panelRef, onClose }) {
  const [split, setSplit] = React.useState(DEFAULT_ZEN_SPLIT);
  const [resizing, setResizing] = React.useState(false);
  const previousZen = React.useRef(zen);
  const cleanupRef = React.useRef(null);

  function stopResize() {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setResizing(false);
  }

  function reset() {
    stopResize();
    setSplit(DEFAULT_ZEN_SPLIT);
  }

  React.useLayoutEffect(() => {
    if (previousZen.current === zen) return;
    previousZen.current = zen;
    reset();
    if (!zen && !pinned) onClose();
  }, [zen, pinned, onClose]);
  React.useEffect(() => () => cleanupRef.current?.(), []);

  function bodyRect() {
    const panel = panelRef.current;
    return (panel?.querySelector?.('.SN_body') || panel)?.getBoundingClientRect();
  }

  function startResize(event) {
    if (!zen || (event.button !== undefined && event.button !== 0)) return;
    const rect = bodyRect();
    if (!rect || rect.width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    stopResize();
    const handle = event.currentTarget;
    if (event.pointerId !== undefined && handle?.setPointerCapture) {
      try { handle.setPointerCapture(event.pointerId); } catch { /* 捕获失效时仍由 window 收尾。 */ }
    }
    setResizing(true);
    const move = (next) => setSplit(clampZenSplit((next.clientX - rect.left) / rect.width, rect.width));
    const finish = () => stopResize();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      if (event.pointerId !== undefined && handle?.hasPointerCapture?.(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
    };
  }

  function onKeyDown(event) {
    if (event.key === 'Home') { event.preventDefault(); reset(); return; }
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const rect = bodyRect();
    if (!rect || rect.width <= 0) return;
    event.preventDefault();
    const step = (event.shiftKey ? 0.1 : 0.02) * (event.key === 'ArrowLeft' ? -1 : 1);
    setSplit((value) => clampZenSplit(value + step, rect.width));
  }

  return { split, resizing, startResize, reset, onKeyDown };
}

export { clampZenSplit, useZenLayout };
