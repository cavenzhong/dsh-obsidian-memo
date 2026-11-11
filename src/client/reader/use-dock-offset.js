/** 测量浮动阅读面板宽度，为底部输入和拖拽操作栏预留空间。 */
import { React } from '../react.js';

function useDockOffset({ effectiveDrawerWidth, noteDrawer, panelRef, pinned }) {
  const [dockRight, setDockRight] = React.useState(0);

  React.useLayoutEffect(() => {
    const panel = panelRef.current;
    const drawer = panel?.querySelector('.SN_noteDrawer');
    if (!drawer || pinned) { setDockRight(0); return undefined; }
    // 进场动画会临时平移面板；宽度不受 transform 影响，避免把动画偏移当作留白。
    const measure = () => setDockRight(Math.max(0, drawer.getBoundingClientRect().width));
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(drawer);
    observer?.observe(panel);
    return () => observer?.disconnect();
  }, [Boolean(noteDrawer), pinned, effectiveDrawerWidth]);

  return { dockRight };
}

export { useDockOffset };
