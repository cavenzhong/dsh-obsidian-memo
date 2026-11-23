/** 注册客户端面板、字典与样式；资源随 ctx.effect 卸载。 */
import { PanelIcon } from './components/icons.js';
import { NS, PANEL_ID } from './constants.js';
import { en, zh } from './i18n/index.js';
import { StickyNotesPanel } from './panel.js';
import { runtime, setRuntime } from './runtime.js';
import { SidebarWideReporter } from './sidebar-state.js';
import { injectStyles } from './styles/index.js';
import { __test } from './testing.js';

const inject = ['slots', 'locale', 'connection'];

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), 'sticky-notes: dictionaries');
  ctx.effect(() => injectStyles(), 'sticky-notes: styles');
  const t = ctx.locale.bind(NS);
  setRuntime({ connection: ctx.connection, locale: ctx.locale, t: t, ctx: ctx });
  ctx.effect(() => () => {
    if (runtime && runtime.t === t) setRuntime(null);
  }, 'sticky-notes: runtime');

  // 宿主侧栏折叠状态：无视觉输出，只把 wide 上报给主面板（顶部留白与发送目标用）。
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'sticky-notes-sidebar-state',
    order: 100,
  }, SidebarWideReporter));

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 3,
    locale: NS,
    label: () => t('nav.label'),
  }, PanelIcon));

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
  }, StickyNotesPanel));
}

export { inject, apply, NS, PANEL_ID, __test };
