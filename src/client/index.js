/** 注册客户端面板、官方设置、字典与样式；资源随 ctx.effect 卸载。 */
import { PanelIcon } from './components/icons.js';
import { NS, PANEL_ID } from './constants.js';
import { en, zh } from './i18n/index.js';
import { StickyNotesPanel } from './panel.js';
import { runtime, setRuntime } from './runtime.js';
import { OfficialSettingsPage } from './settings/official-page.js';
import { injectStyles } from './styles/index.js';
import { __test } from './testing.js';

const inject = ['slots', 'locale', 'connection'];

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), 'sticky-notes: dictionaries');
  ctx.effect(() => injectStyles(), 'sticky-notes: styles');
  const t = ctx.locale.bind(NS);
  setRuntime({ connection: ctx.connection, t: t });
  ctx.effect(() => () => {
    if (runtime && runtime.t === t) setRuntime(null);
  }, 'sticky-notes: runtime');

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
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab', id: PANEL_ID, order: 30, locale: NS, label: () => t('nav.label'),
  }, OfficialSettingsPage));
}

export { inject, apply, NS, PANEL_ID, __test };
