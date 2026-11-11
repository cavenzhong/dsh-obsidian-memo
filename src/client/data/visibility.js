/** 判断面板和文档可见性，供轮询与快捷键使用。 */


function panelIsVisible(panel) {
  if (typeof document !== 'undefined' && document.hidden) return false;
  if (!panel || typeof panel.getClientRects !== 'function') return true;
  try {
    return panel.getClientRects().length > 0;
  } catch (error) {
    return true;
  }
}

export { panelIsVisible };
