/** 阅读抽屉缩窄墙后，按卡片实际所在行缓动定位。 */
import { React } from '../react.js';

function cardRevealPosition({ cardTop, paddingTop, contentHeight, viewportHeight }) {
  const top = Math.max(0, cardTop - paddingTop);
  return { top, extra: top > 0 ? Math.max(0, Math.ceil(top + viewportHeight - contentHeight)) : 0 };
}

function scrollInstantly(wall, top) {
  // 每帧都直接写入滚动位置，避免与宿主的 scroll-behavior: smooth 叠加。
  if (typeof wall.scrollTo === 'function') wall.scrollTo({ top, behavior: 'instant' });
  else wall.scrollTop = top;
}

function useCardReveal(request, drawerPath) {
  React.useLayoutEffect(() => {
    if (!request || request.path !== drawerPath) return;
    const card = request.node;
    const wall = card?.closest?.('.SN_wall');
    if (!wall) return;
    let frame = null, timer, extra = 0, scrolling = false;
    const interruptionEvents = ['wheel', 'pointerdown'];

    function trimSpace() {
      if (!extra || wall.scrollTop > Math.max(0, wall.scrollHeight - wall.clientHeight - extra) + 1) return;
      wall.removeEventListener('scroll', trimSpace);
      wall.style.removeProperty('--sn-reveal-extra');
      extra = 0;
    }

    function stopScrolling() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (!scrolling) return;
      scrolling = false;
      for (const type of interruptionEvents) wall.removeEventListener(type, stopScrolling);
      // 缓动途中暂不裁剪留白，否则会在到达末行之前提前失去滚动空间。
      if (extra) {
        wall.addEventListener('scroll', trimSpace, { passive: true });
        trimSpace();
      }
    }

    function highlight() {
      stopScrolling();
      card.setAttribute('data-revealed', '');
      timer = setTimeout(() => card.removeAttribute('data-revealed'), 750);
    }

    // 等 React 提交实测抽屉宽度；offsetTop 不受卡片按压/hover 变换影响。
    frame = requestAnimationFrame((startTime) => {
      frame = null;
      if (!wall.contains(card)) return;
      const sentinel = wall.querySelector('.SN_loadMore');
      const css = getComputedStyle(wall);
      const position = cardRevealPosition({ cardTop: card.offsetTop, paddingTop: parseFloat(css.paddingTop) || 0,
        contentHeight: sentinel ? sentinel.offsetTop + sentinel.offsetHeight + (parseFloat(css.paddingBottom) || 0) : wall.scrollHeight,
        viewportHeight: wall.clientHeight });
      const { top } = position;
      extra = position.extra;
      if (extra) wall.style.setProperty('--sn-reveal-extra', extra + 'px');
      const from = wall.scrollTop;
      const distance = top - from;
      const reduceMotion = wall.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      scrolling = true;
      if (Math.abs(distance) <= 1 || reduceMotion) {
        scrollInstantly(wall, top);
        highlight();
        return;
      }
      for (const type of interruptionEvents) wall.addEventListener(type, stopScrolling, { passive: true });
      const duration = Math.min(360, 180 + Math.abs(distance) * 0.24);
      function animate(now) {
        frame = null;
        if (!wall.contains(card)) { stopScrolling(); return; }
        const progress = Math.min(1, (now - startTime) / duration);
        scrollInstantly(wall, progress === 1 ? top : from + distance * (1 - (1 - progress) ** 3));
        if (progress === 1) highlight();
        else frame = requestAnimationFrame(animate);
      }
      frame = requestAnimationFrame(animate);
    });
    return () => {
      stopScrolling();
      clearTimeout(timer);
      if (extra) {
        wall.removeEventListener('scroll', trimSpace);
        wall.style.removeProperty('--sn-reveal-extra');
      }
      card.removeAttribute('data-revealed');
    };
  }, [request, drawerPath]);
}

export { cardRevealPosition, useCardReveal };
