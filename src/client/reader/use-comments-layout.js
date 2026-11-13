/** 评论区折叠与高度拖拽；偏好持久化，卸载时清理指针监听。 */
import {
  clampCommentsHeight, clearStoredCommentsHeight, readStoredCommentsCollapsed, readStoredCommentsHeight,
  storeCommentsCollapsed, storeCommentsHeight,
} from '../preferences.js';
import { React } from '../react.js';

function useCommentsLayout() {
  const [commentsCollapsed, setCommentsCollapsed] = React.useState(readStoredCommentsCollapsed);
  const [commentsHeight, setCommentsHeight] = React.useState(readStoredCommentsHeight);
  const [resizingComments, setResizingComments] = React.useState(false);
  const resizingRef = React.useRef(false);
  const cleanupRef = React.useRef(null);

  function persistHeight() {
    setCommentsHeight((current) => {
      if (typeof current === 'number' && Number.isFinite(current)) storeCommentsHeight(current);
      return current;
    });
  }

  function stopCommentsResize() {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    resizingRef.current = false;
    setResizingComments(false);
  }

  function toggleComments() {
    setCommentsCollapsed((current) => {
      const next = !current;
      storeCommentsCollapsed(next);
      return next;
    });
  }

  function startCommentsResize(event) {
    if (commentsCollapsed) return;
    if (event.button !== undefined && event.button !== 0) return;
    const handle = event.currentTarget;
    if (!handle || typeof handle.closest !== 'function') return;
    const section = handle.closest('.SN_noteDrawerComments');
    const drawer = handle.closest('.SN_noteDrawer');
    if (!section || !drawer || typeof section.getBoundingClientRect !== 'function' || typeof drawer.getBoundingClientRect !== 'function') return;
    const sectionRect = section.getBoundingClientRect();
    const drawerRect = drawer.getBoundingClientRect();
    if (!sectionRect || !drawerRect || drawerRect.height <= 0) return;
    // 不取消 pointerdown：否则浏览器会一并吞掉兼容的 dblclick，双击恢复默认就失效了。
    event.stopPropagation?.();
    if (typeof handle.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try { handle.setPointerCapture(event.pointerId); } catch (error) { /* 忽略 */ }
    }
    const startY = event.clientY;
    const startHeight = sectionRect.height;
    // 只量头部 + 操作条，不含正文；用它把「正文至少 140px」落到实际布局上。
    const head = typeof drawer.querySelector === 'function' ? drawer.querySelector('.SN_noteDrawerHead') : null;
    const actions = typeof drawer.querySelector === 'function' ? drawer.querySelector('.SN_drawerActions') : null;
    const headHeight = head && typeof head.getBoundingClientRect === 'function' ? head.getBoundingClientRect().height : 0;
    const actionsHeight = actions && typeof actions.getBoundingClientRect === 'function' ? actions.getBoundingClientRect().height : 0;
    const measuredChrome = headHeight + actionsHeight;
    const chromeReserve = measuredChrome > 0 ? measuredChrome : undefined;
    resizingRef.current = true;
    setResizingComments(true);
    const removeListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onFinish);
      window.removeEventListener('pointercancel', onFinish);
    };
    const onMove = (moveEvent) => {
      if (!resizingRef.current) return;
      // 在 move 里阻止默认行为：pointerdown 不取消（见上），但仍要避免拖动时选中文本。
      if (moveEvent.cancelable !== false) moveEvent.preventDefault?.();
      const next = clampCommentsHeight(startHeight + (startY - moveEvent.clientY), drawerRect.height, chromeReserve);
      setCommentsHeight(next);
    };
    const onFinish = () => {
      removeListeners();
      resizingRef.current = false;
      cleanupRef.current = null;
      setResizingComments(false);
      persistHeight();
    };
    cleanupRef.current = removeListeners;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onFinish);
    window.addEventListener('pointercancel', onFinish);
  }

  function resetCommentsHeight() {
    stopCommentsResize();
    setCommentsHeight(null);
    clearStoredCommentsHeight();
  }

  React.useEffect(() => () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  return {
    commentsCollapsed,
    commentsHeight,
    resizingComments,
    toggleComments,
    startCommentsResize,
    resetCommentsHeight,
    stopCommentsResize,
    persistCommentsHeight: persistHeight,
  };
}

export { useCommentsLayout };
