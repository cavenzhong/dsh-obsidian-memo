import test from 'node:test';
import assert from 'node:assert/strict';
import { captureNodes, hookRunner } from '../../test-support/client.mjs';

test('评论提示词：内置与自定义预设修改后都能恢复默认', (t) => {
  const runner = hookRunner(t);
  const defaults = { customEmoji: '默认自定义', emojis: { builtin: '默认内置' } };
  let draft = { vaultPath: '/vault', promptDefaults: defaults, emojis: [
    { id: 'builtin', emoji: '✨', prompt: '改过内置' }, { id: 'custom', emoji: '😈', prompt: '改过自定义' },
  ] };
  const props = () => ({ t: (key) => key, draft, onPatchEmoji(index, patch) {
    draft = { ...draft, emojis: draft.emojis.map((value, i) => i === index ? { ...value, ...patch } : value) };
  } });
  const editors = () => captureNodes(runner.render(runner.api.components.SettingsDrawer, props()))
    .filter((node) => node.type?.name === 'PromptEditor');
  assert.equal(editors().length, 2);
  for (const editor of editors()) {
    const restore = captureNodes(editor.type(editor.props)).find((node) => node.props.className === 'SN_promptRestore');
    assert.ok(restore);
    restore.props.onClick();
  }
  assert.equal(draft.emojis[0].prompt, defaults.emojis.builtin);
  assert.equal(draft.emojis[1].prompt, defaults.customEmoji);
  runner.unmount();
});

test('工作空间配色：主空间与子空间独立设色、持久化并按仓库隔离', (t) => {
  const runner = hookRunner(t), api = runner.api;
  const viewRef = { current: { settings: { vaultPath: '/vault-a', notesDir: '/vault-a/notes' } } };
  const props = { t: (key) => key, tRef: { current: (key) => key }, aliveRef: { current: true }, viewRef, refreshNow() {}, pushToast() {}, pushErrorToast() {}, editingRef: { current: false } };
  const render = () => runner.render(api.hooks.useWorkspaces, props);
  let state = render();
  assert.equal(state.activePaper.id, 'paper');
  assert.equal(state.entries[0].color, 'paper');
  state.setColor(api.WORKSPACE_ALL_ID, 'lilac');
  state = render();
  assert.equal(state.activePaper.id, 'lilac');
  assert.equal(api.readStoredWorkspaces('/vault-a').primaryColor, 'lilac');
  const added = state.add('其他');
  render().setColor(added.item.id, 'mist');
  state = render();
  assert.equal(state.activePaper.id, 'mist', '进入子空间时使用子空间自己的颜色');
  let stored = api.readStoredWorkspaces('/vault-a');
  assert.equal(stored.primaryColor, 'lilac', '修改子空间不覆盖主空间颜色设置');
  assert.equal(stored.items.find((item) => item.id === added.item.id).color, 'mist');
  render().select(api.WORKSPACE_ALL_ID);
  state = render();
  assert.equal(state.activePaper.id, 'lilac', '子空间改色不影响主空间卡片颜色');
  state.select(added.item.id);
  assert.equal(render().activePaper.id, 'mist', '切回子空间仍保留其独立颜色');
  render().select(api.WORKSPACE_ALL_ID);
  viewRef.current = { settings: { vaultPath: '/vault-b', notesDir: '/vault-b/notes' } };
  render();
  assert.equal(render().activePaper.id, 'paper');
  viewRef.current = { settings: { vaultPath: '/vault-a', notesDir: '/vault-a/notes' } };
  render();
  state = render();
  assert.equal(state.activePaper.id, 'lilac');
  state.setColor(api.WORKSPACE_ALL_ID, 'invalid');
  assert.equal(render().activePaper.id, 'lilac');
  stored = api.readStoredWorkspaces('/vault-a');
  assert.equal(stored.items.find((item) => item.id === added.item.id).color, 'mist', '修改主空间也不覆盖子空间颜色设置');
});

test('工作空间配色：色板、标签、卡片和阅读纸色共用浅深色，主空间菜单无删除', (t) => {
  const runner = hookRunner(t), api = runner.api, color = api.workspaceColor('mist');
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
  const entries = [{ id: api.WORKSPACE_ALL_ID, path: 'notes', label: '主空间', primary: true, color: 'mist' }];
  const selected = [];
  const props = { t: (key) => key, entries, activeId: api.WORKSPACE_ALL_ID, history: [], onSetColor: (...args) => selected.push(args) };
  const render = () => captureNodes(runner.render(api.components.WorkspaceBar, props));
  const tab = render().find((node) => node.props.role === 'tab');
  assert.equal(tab.props.style, undefined, '标签按钮不带工作空间纸色背景变量');
  tab.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 });
  const menu = render();
  assert.equal(menu.some((node) => node.props.className === 'SN_wsMenuItem SN_wsMenuDelete'), false);
  const swatch = menu.find((node) => node.props.className === 'SN_wsSwatch' && node.props['data-active'] === 'true');
  assert.deepEqual(swatch.props.style, { '--sn-ws-paper': color.light, '--sn-ws-paper-dark': color.dark });
  swatch.props.onClick();
  assert.deepEqual(selected, [[api.WORKSPACE_ALL_ID, 'mist']]);
  const card = api.components.NoteCard({ note: { path: '/A.md', title: '标题', color: '#other' }, actions: { current: { t: (key) => key } }, paper: color });
  assert.equal(card.props.style['--sn-card-bg'], color.light);
  assert.equal(card.props.style['--sn-card-bg-dark'], color.dark);
  runner.unmount();
  const drawer = captureNodes(runner.render(api.components.NoteDrawer, { t: (key) => key, drawer: { path: '/A.md', summary: { title: '标题' }, full: { body: '', blocks: [] } }, paper: color }));
  const surface = drawer.find((node) => node.props.style?.['--sn-card-bg']);
  assert.equal(surface.props.style['--sn-card-bg'], color.light);
  assert.equal(surface.props.style['--sn-card-bg-dark'], color.dark);
});
