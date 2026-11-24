/** 双视图分隔线：拖动时只更新轨道宽度，松手后才持久化。 */
import { React, h } from '../react.js';
import { WorkspaceWall } from '../wall/workspace-wall.js';
import { normalizeSplit } from './workspace-display.js';

function WorkspacePanes({ activeId, models, onSelect, onSplit, split, wallProps }) {
  const groupRef = React.useRef(null);
  const pointerRef = React.useRef(null);
  const [preview, setPreview] = React.useState(null);
  const ratio = preview ?? split;
  const dual = models.length === 2;
  React.useEffect(() => {
    if (!dual) { pointerRef.current = null; setPreview(null); }
  }, [dual]);
  function position(event) {
    const width = groupRef.current?.clientWidth || 0;
    const start = pointerRef.current;
    return width > 8 && start ? normalizeSplit(start.ratio + (event.clientX - start.x) / (width - 8)) : split;
  }
  function stop(event, save) {
    if (pointerRef.current?.id !== event.pointerId) return;
    const next = save ? position(event) : null;
    pointerRef.current = null;
    setPreview(null);
    if (next !== null) onSplit(next);
  }
  const separator = dual ? h('div', {
    key: 'divider', className: 'SN_workspaceDivider', role: 'separator', tabIndex: 0,
    'aria-label': wallProps.t('workspace.resize'), 'aria-orientation': 'vertical',
    'aria-valuemin': 20, 'aria-valuemax': 80, 'aria-valuenow': Math.round(ratio * 100),
    onPointerDown(event) {
      if (event.button !== 0 || event.isPrimary === false) return;
      pointerRef.current = { id: event.pointerId, x: event.clientX, ratio: split };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event) { if (pointerRef.current?.id === event.pointerId) setPreview(position(event)); },
    onPointerUp(event) { stop(event, true); },
    onPointerCancel(event) { stop(event, false); },
    onLostPointerCapture(event) { stop(event, false); },
    onDoubleClick: () => onSplit(0.5),
    onKeyDown(event) {
      const next = { ArrowLeft: split - 0.05, ArrowRight: split + 0.05, Home: 0.2, End: 0.8 }[event.key];
      if (typeof next !== 'number') return;
      event.preventDefault();
      onSplit(normalizeSplit(next));
    },
  }) : null;
  const walls = models.map((model) => h(WorkspaceWall, { ...wallProps, key: model.entry.id, model,
    split: dual, active: model.entry.id === activeId, onSelect }));
  if (separator) walls.splice(1, 0, separator);
  return h('div', { className: 'SN_workspacePanes', ref: groupRef, 'data-split': dual ? 'true' : 'false',
    style: dual ? { gridTemplateColumns: `minmax(0,${ratio}fr) 8px minmax(0,${1 - ratio}fr)` } : undefined,
  }, walls);
}

export { WorkspacePanes };
