/** 拖拽浮层的帧合并、位置计算、停靠和收尾动画。 */


function cardDragLayout(point, viewport) {
  const width = point?.width > 0 ? point.width : 320;
  const height = point?.height > 0 ? point.height : 208;
  const scale = 1 / 3;
  const previewWidth = width * scale, previewHeight = height * scale;
  const left = Math.max(8, Math.min((point?.x || 0) - Math.max(0, Math.min(point?.offsetX || 0, width)) * scale, viewport.width - previewWidth - 8));
  const top = Math.max(48, Math.min((point?.y || 0) - Math.max(0, Math.min(point?.offsetY || 0, height)) * scale, viewport.height - previewHeight - 8));
  const center = left + previewWidth / 2;
  const hintWidth = Math.min(270, 2 * Math.max(1, Math.min(center - 8, viewport.width - 8 - center)));
  return { width, height, scale, previewWidth, previewHeight, left, top, hintWidth };
}

function createCardDragMotion(layer, initialPoint) {
  const win = layer.ownerDocument.defaultView;
  const point = Object.assign({}, initialPoint);
  let viewport = { width: win.innerWidth, height: win.innerHeight };
  let layout = cardDragLayout(point, viewport);
  let frame = null, disposed = false, settling = false, animation = null, anchor = null;
  const transform = (position) => 'translate3d(' + position.left + 'px,' + position.top + 'px,0)';
  const position = (next) => {
    if (next.left !== layout.left || next.top !== layout.top) layer.style.transform = transform(next);
    if (next.hintWidth !== layout.hintWidth) layer.style.setProperty('--sn-drag-hint-width', next.hintWidth + 'px');
    layout = next;
  };
  const paint = () => {
    frame = null;
    if (disposed || settling) return;
    position(cardDragLayout(point, viewport));
  };
  const schedule = () => { if (frame === null) frame = win.requestAnimationFrame(paint); };
  const move = (event) => {
    if (disposed || settling || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)
      || (event.type === 'drag' && event.clientX === 0 && event.clientY === 0)
      || (point.x === event.clientX && point.y === event.clientY)) return;
    point.x = event.clientX; point.y = event.clientY;
    schedule();
  };
  const placeParked = () => {
    const rect = anchor.getBoundingClientRect();
    viewport = { width: win.innerWidth, height: win.innerHeight };
    Object.assign(point, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, offsetX: layout.width / 2, offsetY: layout.height / 2 });
    position(cardDragLayout(point, viewport));
  };
  const resize = () => { if (anchor) placeParked(); else { viewport = { width: win.innerWidth, height: win.innerHeight }; schedule(); } };
  const detach = () => {
    if (frame !== null) { win.cancelAnimationFrame(frame); frame = null; }
    layer.ownerDocument.removeEventListener('dragover', move, true);
    layer.ownerDocument.removeEventListener('drag', move, true);
    win.removeEventListener('resize', resize);
  };
  layer.ownerDocument.addEventListener('dragover', move, true);
  layer.ownerDocument.addEventListener('drag', move, true);
  win.addEventListener('resize', resize);
  return {
    park(element) {
      if (disposed || settling || !element) return;
      detach(); anchor = element;
      layer.dataset.parked = 'true';
      placeParked();
      win.addEventListener('resize', resize);
    },
    finish(mode, source) {
      if (settling || disposed) return Promise.resolve();
      settling = true; detach();
      // 只在松手时读一次原卡片位置；回落结束前保留虚线占位，避免原卡片闪回。
      const rect = mode === 'return' && source?.isConnected ? source.getBoundingClientRect() : null;
      layer.dataset.settling = 'true';
      if (!layer.animate || win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return Promise.resolve();
      const end = rect
        ? { transform: 'translate3d(' + rect.left + 'px,' + rect.top + 'px,0) scale(' + rect.width / layout.previewWidth + ')', opacity: 1 }
        : { transform: transform(layout) + ' scale(.9)', opacity: 0 };
      animation = layer.animate([{ transform: transform(layout), opacity: 1 }, end], {
        duration: rect ? 150 : 110, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards',
      });
      return animation.finished.catch(() => {});
    },
    dispose() { disposed = true; detach(); animation?.cancel(); },
  };
}

export { cardDragLayout, createCardDragMotion };
