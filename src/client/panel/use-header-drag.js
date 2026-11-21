/** 顶栏手势：macOS 桌面版拖动窗口，同时把短按保留为单击。 */
import { React } from '../react.js';

// 这些元素保留自己的点击/键盘行为，不参与窗口拖动。
const HEADER_CONTROL_SELECTOR = [
  'button', 'a', 'input', 'select', 'textarea', 'summary', 'label',
  '[contenteditable="true"]', '[role="button"]', '[role="link"]', '[role="tab"]',
  '[role="menuitem"]', '[role="menuitemradio"]', '[role="menuitemcheckbox"]',
  '[role="menu"]', '[role="listbox"]', '[role="dialog"]', '[role="alertdialog"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="slider"]',
  '[role="combobox"]', '[role="textbox"]', '[data-no-window-drag]',
].join(',');
const HEADER_DRAG_THRESHOLD = 3;

function isHeaderControlTarget(target) {
  return Boolean(target && typeof target.closest === 'function' && target.closest(HEADER_CONTROL_SELECTOR));
}

// Electron 原生 app-region 拖动区不会向 DOM 转发指针事件；macOS 桌面版改用
// 指针事件 + window.moveTo 自己移动窗口，才能让同一块区域既拖动又响应单击。
function canDragWindow() {
  return typeof window !== 'undefined'
    && typeof window.moveTo === 'function'
    && typeof document !== 'undefined'
    && document.documentElement?.dataset?.platform === 'darwin';
}

/**
 * @param {() => void} onTap 顶栏非控件区域的单击（收起未锁定抽屉）。
 * @param {() => boolean} onPress 非控件按下时调用；返回 true 表示吞掉后续 click（例如退出编辑态）。
 */
function useHeaderDrag({ onTap, onPress }) {
  const gestureRef = React.useRef(null);
  const suppressClickRef = React.useRef(false);
  const onTapRef = React.useRef(onTap);
  const onPressRef = React.useRef(onPress);
  onTapRef.current = onTap;
  onPressRef.current = onPress;

  function handlePointerDown(event) {
    suppressClickRef.current = false;
    if (!event || event.button !== 0 || event.isPrimary === false) return;
    if (isHeaderControlTarget(event.target)) return;
    if (onPressRef.current?.() === true) suppressClickRef.current = true;
    const rawX = Number(event.screenX);
    const rawY = Number(event.screenY);
    const gesture = {
      pointerId: event.pointerId,
      startX: Number.isFinite(rawX) ? rawX : 0,
      startY: Number.isFinite(rawY) ? rawY : 0,
      lastX: Number.isFinite(rawX) ? rawX : 0,
      lastY: Number.isFinite(rawY) ? rawY : 0,
      winX: Number.isFinite(window.screenX) ? window.screenX : 0,
      winY: Number.isFinite(window.screenY) ? window.screenY : 0,
      canDrag: canDragWindow(),
      moved: false,
    };
    gestureRef.current = gesture;
    if (!gesture.canDrag) return;
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch (_error) {
      // 指针捕获失败时点击仍可用；拖动只在顶栏内部继续。
    }
  }

  function moveWindow(gesture, screenX, screenY) {
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    const dx = screenX - gesture.lastX;
    const dy = screenY - gesture.lastY;
    gesture.lastX = screenX;
    gesture.lastY = screenY;
    if (dx === 0 && dy === 0) return;
    gesture.winX += dx;
    gesture.winY += dy;
    try {
      window.moveTo(Math.round(gesture.winX), Math.round(gesture.winY));
    } catch (_error) {
      // 不支持 moveTo 时保持点击行为，不打断用户操作。
    }
  }

  function handlePointerMove(event) {
    const gesture = gestureRef.current;
    if (!gesture || !gesture.canDrag || event.pointerId !== gesture.pointerId) return;
    const screenX = Number(event.screenX);
    const screenY = Number(event.screenY);
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    if (!gesture.moved) {
      // 小于阈值视为单击：交给 click 收起右侧面板；超过阈值才移动窗口。
      if (Math.abs(screenX - gesture.startX) < HEADER_DRAG_THRESHOLD
        && Math.abs(screenY - gesture.startY) < HEADER_DRAG_THRESHOLD) return;
      gesture.moved = true;
      try { window.getSelection?.()?.removeAllRanges?.(); } catch (_error) { /* 选区清理失败不影响拖动 */ }
    }
    moveWindow(gesture, screenX, screenY);
    event.preventDefault?.();
  }

  function handlePointerUp(event) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    // 窗口移动后指针事件可能被合并/丢弃；松手时补上最后一段位移，
    // 避免快速拖动结束时窗口停在半路。
    if (gesture.canDrag && gesture.moved) {
      moveWindow(gesture, Number(event.screenX), Number(event.screenY));
    }
    gestureRef.current = null;
    if (gesture.moved) suppressClickRef.current = true;
  }

  function handlePointerCancel(event) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gestureRef.current = null;
    if (gesture.moved) suppressClickRef.current = true;
  }

  function handleClick(event) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (isHeaderControlTarget(event.target)) return;
    onTapRef.current?.();
  }

  return {
    onHeaderPointerDown: handlePointerDown,
    onHeaderPointerMove: handlePointerMove,
    onHeaderPointerUp: handlePointerUp,
    onHeaderPointerCancel: handlePointerCancel,
    onHeaderClick: handleClick,
  };
}

export { useHeaderDrag };
