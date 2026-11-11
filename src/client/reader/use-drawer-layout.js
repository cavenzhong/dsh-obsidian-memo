/** 抽屉宽度、拖动监听和钉住偏好；卸载时清理指针监听。 */
import {
  clampDrawerWidth, clearStoredDrawerWidth, readStoredDrawerWidth, readStoredPinned, storeDrawerWidth,
  storePinned,
} from '../preferences.js';
import { React } from '../react.js';

function useDrawerLayout({ panelRef }) {
  const [drawerWidth, setDrawerWidth] = React.useState(readStoredDrawerWidth);
  const [resizingDrawer, setResizingDrawer] = React.useState(false);
  const resizingRef = React.useRef(false);
  const resizeCleanupRef = React.useRef(null);
  const [pinned, setPinned] = React.useState(readStoredPinned);
  const pinnedUserClosedRef = React.useRef(false);
  const [panelWidth, setPanelWidth] = React.useState(0);
  const effectiveDrawerWidth = drawerWidth == null ? null : clampDrawerWidth(drawerWidth, panelWidth, pinned);

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof panel.getBoundingClientRect !== 'function') return undefined;
    const measure = () => {
      const rect = panel.getBoundingClientRect();
      if (rect && Number.isFinite(rect.width) && rect.width > 0) setPanelWidth(rect.width);
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure);
      observer.observe(panel);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  function startDrawerResize(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.stopPropagation();
    const panel = panelRef.current;
    if (!panel || typeof panel.getBoundingClientRect !== 'function') return;
    const rect = panel.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const handle = event.currentTarget;
    if (handle && typeof handle.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try { handle.setPointerCapture(event.pointerId); } catch (error) { /* 忽略 */ }
    }
    resizingRef.current = true;
    setResizingDrawer(true);
    const removeListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onFinish);
      window.removeEventListener('pointercancel', onFinish);
    };
    const onMove = (moveEvent) => {
      if (!resizingRef.current) return;
      setDrawerWidth(clampDrawerWidth(rect.right - moveEvent.clientX, rect.width, pinned));
    };
    const onFinish = () => {
      removeListeners();
      resizingRef.current = false;
      resizeCleanupRef.current = null;
      setResizingDrawer(false);
      setDrawerWidth((current) => {
        if (typeof current === 'number' && Number.isFinite(current)) storeDrawerWidth(current);
        return current;
      });
    };
    resizeCleanupRef.current = removeListeners;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onFinish);
    window.addEventListener('pointercancel', onFinish);
  }

  function resetDrawerWidth() {
    if (resizeCleanupRef.current) {
      resizeCleanupRef.current();
      resizeCleanupRef.current = null;
    }
    resizingRef.current = false;
    setResizingDrawer(false);
    setDrawerWidth(null);
    clearStoredDrawerWidth();
  }

  function togglePinned() {
    const next = !pinned;
    setPinned(next);
    storePinned(next);
  }
  React.useEffect(() => () => {
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;
  }, []);
  return { resizingDrawer, setResizingDrawer, resizingRef, resizeCleanupRef, pinned, pinnedUserClosedRef, effectiveDrawerWidth, startDrawerResize, resetDrawerWidth, togglePinned };
}

export { useDrawerLayout };
