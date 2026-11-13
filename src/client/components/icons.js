/** 手写 SVG 图标，只负责渲染。 */
import { h } from '../react.js';

function PanelIcon(props) {
  const size = props && typeof props.size === 'number' && props.size > 0 ? props.size : 18;
  const active = Boolean(props && props.active);
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
    style: { display: 'block', opacity: active ? 1 : 0.92 },
  },
    h('path', {
      d: 'M6 3.25h11.25a2.5 2.5 0 0 1 2.5 2.5v9.1L14.6 20.75H6a2.5 2.5 0 0 1-2.5-2.5V5.75a2.5 2.5 0 0 1 2.5-2.5Z',
      stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round',
    }),
    h('path', {
      d: 'M19.75 14.85h-3.4a2.5 2.5 0 0 0-2.5 2.5v3.4',
      stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round',
    }),
    h('path', {
      d: 'M7.3 8.4h7.4M7.3 11.9h4.9',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.8,
    }),
    h('circle', { cx: 17.9, cy: 6.1, r: 2.15, fill: '#B4472F' }),
  );
}

function RefreshIcon(props) {
  const spinning = Boolean(props && props.spinning);
  return h('svg', {
    width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
    'aria-hidden': 'true', focusable: 'false',
    className: spinning ? 'SN_spin' : undefined,
    style: { display: 'block' },
  },
    h('path', {
      d: 'M20 11.2a8 8 0 1 0-.9 4.6',
      stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
    }),
    h('path', {
      d: 'M20.2 4.9v5.2h-5.2',
      stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
    }),
  );
}

function GearIcon() {
  return h('svg', {
    width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
    'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
  },
    h('circle', { cx: 12, cy: 12, r: 3.1, stroke: 'currentColor', strokeWidth: 1.7 }),
    h('path', {
      d: 'M19.4 12c0-.5-.05-1-.15-1.45l2-1.55-1.9-3.3-2.4 1a8.6 8.6 0 0 0-2.5-1.45L14.2 2.6h-4.4l-.25 2.65A8.6 8.6 0 0 0 7.05 6.7l-2.4-1-1.9 3.3 2 1.55a8.7 8.7 0 0 0 0 2.9l-2 1.55 1.9 3.3 2.4-1a8.6 8.6 0 0 0 2.5 1.45l.25 2.65h4.4l.25-2.65a8.6 8.6 0 0 0 2.5-1.45l2.4 1 1.9-3.3-2-1.55c.1-.45.15-.95.15-1.45Z',
      stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
    }),
  );
}

function CloseIcon() {
  return h('svg', {
    width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
    'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
  },
    h('path', { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
  );
}

function FolderTreeIcon() {
  return h('svg', {
    width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
    'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
  },
    h('path', {
      d: 'M3.2 6.4h5.2l1.9 2.2h10.5a1.7 1.7 0 0 1 1.7 1.7v9.1a1.7 1.7 0 0 1-1.7 1.7H3.2a1.7 1.7 0 0 1-1.7-1.7V8.1a1.7 1.7 0 0 1 1.7-1.7Z',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
    }),
    h('path', {
      d: 'M7 11.6v5M7 13.9h3.2M7 16.6h3.2',
      stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
    }),
  );
}

function PinIcon(props) {
  const pinned = Boolean(props && props.pinned);
  return h('svg', {
    width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
    'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
  },
    h('path', {
      d: 'M9.3 3.6h5.4l-.8 5.1 3 2.7v1.2H7.1v-1.2l3-2.7-.8-5.1Z',
      fill: pinned ? 'currentColor' : 'none',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
    }),
    h('path', {
      d: 'M12 12.6v7.2',
      stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
    }),
  );
}

function SortIcon() {
  return h('svg', {
    width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
    'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
  },
    h('path', { d: 'M4 7h11M4 12h8M4 17h5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
    h('path', { d: 'M17.5 7.5v9.5M14.7 14.4l2.8 2.8 2.8-2.8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  );
}

function ObsidianIcon() {
  return h('svg', {
    width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none',
    'aria-hidden': 'true', focusable: 'false', style: { display: 'block', flex: 'none' },
  },
    h('path', { d: 'M13.4 4.4h6.2v6.2', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { d: 'M19.6 4.4l-8 8', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
    h('path', { d: 'M18.6 14.2v3.8a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2V6.8a2 2 0 0 1 2-2h3.8', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
  );
}

function CalendarIcon() {
  return h('svg', {
    width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
    'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
  },
    h('rect', {
      x: 3.2, y: 5.2, width: 17.6, height: 15.6, rx: 2.4,
      stroke: 'currentColor', strokeWidth: 1.5,
    }),
    h('path', {
      d: 'M3.4 9.6h17.2M8.2 3.4v3.4M15.8 3.4v3.4',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
    }),
    h('path', {
      d: 'M7.4 13.3h2.1M11.1 13.3h2.1M14.8 13.3h2.1M7.4 16.8h2.1M11.1 16.8h2.1',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.72,
    }),
  );
}

function ChevronIcon(props) {
  const size = props && typeof props.size === 'number' && props.size > 0 ? props.size : 12;
  return h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    'aria-hidden': 'true', focusable: 'false', className: 'SN_chevron',
    style: { display: 'block', transform: props && props.collapsed ? 'rotate(-90deg)' : 'none' },
  },
    h('path', {
      d: 'M6 9l6 6 6-6',
      stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
    }),
  );
}

function ActionIcon({ kind, size = 20 }) {
  const paths = {
    delete: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7',
    archive: 'M4 4h16v4H4zM6 8v12h12V8M10 12h4',
    project: 'M3 7V5h6l2 2h10v12H3zM12 10v6m-3-3h6',
    copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
    up: 'M12 19V5m-6 6 6-6 6 6',
  };
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
    h('path', { d: paths[kind], stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
}

export { PanelIcon, RefreshIcon, GearIcon, CloseIcon, FolderTreeIcon, PinIcon, SortIcon, ObsidianIcon, CalendarIcon, ChevronIcon, ActionIcon };
