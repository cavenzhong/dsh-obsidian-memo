import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_SOURCE, hookRunner } from '../../test-support/client.mjs';

function eventTarget(extend = {}) {
  const handlers = new Map();
  return { handlers,
    addEventListener: (name, listener) => handlers.set(name, listener),
    removeEventListener: (name, listener) => { if (handlers.get(name) === listener) handlers.delete(name); },
    ...extend,
  };
}

function shortcutsFixture() {
  const selected = [], toggles = [], attrs = new Map();
  let menu = null;
  const win = eventTarget(), editor = { closest: () => editor }, body = {};
  const doc = eventTarget({ body, defaultView: win });
  const panel = {
    attrs, ownerDocument: doc, contains: (node) => node === editor, querySelector: () => menu,
    setAttribute: (key, value) => attrs.set(key, value), removeAttribute: (key) => attrs.delete(key),
  };
  const options = { panelRef: { current: panel }, enabled: true, entries: ['main', 'a', 'b'].map((id) => ({ id })),
    onSelect: (id) => selected.push(id), onToggle: () => toggles.push(true) };
  function press(key, extend = {}) {
    const event = { key, target: body, metaKey: true, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extend };
    doc.handlers.get('keydown')?.(event);
    return event;
  }
  return { options, doc, editor, panel, win, press, selected, toggles, setMenu: (value) => { menu = value; } };
}

test('Cmd+数字按标签顺序切换空间，重排后跟随新顺序，与便签 DOM 无关', (t) => {
  const { api, render } = hookRunner(t), ui = shortcutsFixture();
  const { press, options, selected, toggles, panel, doc } = ui;
  render(api.hooks.useWorkspaceShortcuts, options);
  assert.equal(panel.attrs.size, 0);
  assert.equal(press('2', { metaKey: false }).stopped, undefined);
  press('Meta');
  assert.equal(panel.attrs.get('data-workspace-shortcuts'), '');
  assert.equal(press('2').defaultPrevented, true);
  assert.deepEqual(selected, ['a']);
  assert.equal(press('9').defaultPrevented, undefined, '未分配数字不拦截');
  assert.equal(press('0').defaultPrevented, undefined);
  render(api.hooks.useWorkspaceShortcuts, { ...options, entries: [options.entries[0], options.entries[2], options.entries[1]] });
  assert.equal(press('2').defaultPrevented, true);
  assert.equal(press('3', { repeat: true }).stopped, true, '不因长按重复切换');
  assert.deepEqual(selected, ['a', 'b']);
  assert.equal(press('；').stopped, true);
  assert.equal(press(';', { repeat: true }).stopped, true);
  assert.equal(press('x', { code: 'Semicolon' }).stopped, undefined, '不占用不同键盘布局上的其他组合键');
  assert.deepEqual(toggles, [true]);
  doc.handlers.get('keyup')({ key: 'Meta', metaKey: false });
  assert.equal(panel.attrs.size, 0);
});

test('工作空间快捷键避让编辑输入、弹层、输入法、外部焦点，并在窗口失焦时清理', (t) => {
  const runner = hookRunner(t), ui = shortcutsFixture();
  const { press, panel, win, doc, editor, toggles, selected } = ui;
  runner.render(runner.api.hooks.useWorkspaceShortcuts, ui.options);
  press('2', { target: editor });
  press('2', { target: {} });
  press(';', { isComposing: true });
  press(';', { shiftKey: true });
  ui.setMenu({});
  press('2');
  assert.deepEqual(toggles, []);
  assert.deepEqual(selected, []);
  assert.equal(panel.attrs.size, 0);
  ui.setMenu(null);
  press('Meta');
  doc.handlers.get('focusin')({ target: editor });
  assert.equal(panel.attrs.size, 0);
  press('Meta');
  win.handlers.get('blur')();
  assert.equal(panel.attrs.size, 0);
  press('1');
  assert.deepEqual(selected, ['main']);
  runner.render(runner.api.hooks.useWorkspaceShortcuts, { ...ui.options, enabled: false });
  assert.equal(panel.attrs.size, 0);
  assert.equal(doc.handlers.size, 0);
});

test('只有一个空间时不拦截 Cmd+;，仅主空间有数字键', (t) => {
  const runner = hookRunner(t), ui = shortcutsFixture();
  runner.render(runner.api.hooks.useWorkspaceShortcuts, { ...ui.options, entries: ui.options.entries.slice(0, 1), onToggle: undefined });
  assert.equal(ui.press(';').defaultPrevented, undefined);
  assert.equal(ui.press('2').defaultPrevented, undefined);
  assert.equal(ui.press('1').defaultPrevented, true);
  assert.deepEqual(ui.selected, ['main']);
});

test('提示只按需显示在工作空间栏；分隔线只画 1px 且不能盖住浮岛', () => {
  assert.match(CLIENT_SOURCE, /\.SN_wsTabHint,\.SN_wsSplitHint\{display:none/);
  assert.match(CLIENT_SOURCE, /\[data-workspace-shortcuts\] :is\(\.SN_wsTabHint,\.SN_wsSplitHint\)\{display:inline-flex/);
  assert.doesNotMatch(CLIENT_SOURCE, /data-note-shortcut|visibleShortcutCards/);
  assert.match(CLIENT_SOURCE, /\.SN_workspaceDivider::before\{[^}]*inset:0 4px 0 3px;[^}]*opacity:\.5;/);
  assert.match(CLIENT_SOURCE, /\.SN_workspaceDivider:is\(:hover,:focus-visible,:active\)::before\{background:var\(--sn-accent\);opacity:1\}/);
  assert.match(CLIENT_SOURCE, /\.SN_workspacePanes\{isolation:isolate/);
  assert.match(CLIENT_SOURCE, /\.SN_captureDock\{position:absolute;z-index:31/);
});
