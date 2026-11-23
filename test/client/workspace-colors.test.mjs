/** Mounted workspace colors follow note ownership, not the selected view. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureNodes, hookRunner, loadClient } from '../../test-support/client.mjs';

const noteAt = (relPath) => ({ path: '/vault/' + relPath, relPath, title: relPath, tag: 'b', created: Date.now(), images: [], comments: [] });
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('空间纸色归属：最深已挂载目录优先，未挂载子目录继承，路径段与排序不混淆', (t) => {
  const api = loadClient(t).mod.__test;
  const entries = [
    { id: 'a', path: 'notes', color: 'rouge' },
    { id: 'c', path: 'notes/b/c', color: 'moss' },
    { id: 'b', path: 'notes/b', color: 'mist' },
    { id: 'outside', path: 'other', color: 'lilac' },
  ];
  const cases = [
    ['notes/a.md', 'rouge'],
    ['notes/unmounted/deep/a.md', 'rouge'],
    ['notes/b/a.md', 'mist'],
    ['notes/b/unmounted/a.md', 'mist'],
    ['notes/b/c/a.md', 'moss'],
    ['notes/b/c/deep/a.md', 'moss'],
    ['notes/b-other/a.md', 'rouge'],
    ['other/a.md', 'lilac'],
  ];
  for (const [path, expected] of cases) {
    const note = noteAt(path);
    assert.equal(api.noteWorkspacePaper(note, entries, '/vault')?.id, expected, path);
    assert.equal(api.noteWorkspacePaper(note, entries.slice().reverse(), '/vault')?.id, expected, '顺序无关: ' + path);
  }
  assert.equal(api.noteWorkspacePaper({ path: '/vault/notes/b/a.md' }, entries, '/vault')?.id, 'mist', '缺少 relPath 时按绝对路径匹配');
  assert.equal(api.noteWorkspacePaper({ path: ['C:', 'vault', 'notes', 'b', 'a.md'].join(String.fromCharCode(92)) }, entries, ['C:', 'vault'].join(String.fromCharCode(92)))?.id, 'mist', '兼容 Windows 分隔符');
  assert.equal(api.noteWorkspacePaper(noteAt('notes/b.md'), entries, '/vault')?.id, 'rouge', '文件名与工作空间目录同名前缀不能误判');
  assert.equal(api.noteWorkspacePaper(noteAt('elsewhere/a.md'), entries, '/vault'), null);
  assert.equal(api.noteWorkspacePaper(null, entries, '/vault'), null);
  assert.equal(api.noteWorkspacePaper(noteAt('notes/a.md'), [], '/vault'), null);
  assert.equal(api.noteWorkspacePaper(noteAt('notes/a.md'), null, '/vault'), null);
  const root = [{ id: '__all__', path: '.', color: 'paper' }, ...entries];
  assert.equal(api.noteWorkspacePaper(noteAt('root.md'), root, '/vault')?.id, 'paper');
  assert.equal(api.noteWorkspacePaper(noteAt('notes/b/a.md'), root, '/vault')?.id, 'mist');
});

test('父子空间改色：父不覆盖已挂载子空间，子改色在父视图同步，移除和撤销重新计算归属', (t) => {
  const runner = hookRunner(t), api = runner.api, toasts = [];
  const viewRef = { current: { settings: { vaultPath: '/vault', notesDir: '/vault/notes' }, notes: [] } };
  const tFn = (key) => key;
  const props = { t: tFn, tRef: { current: tFn }, aliveRef: { current: true }, viewRef, refreshNow() {}, pushToast: (toast) => toasts.push(toast) };
  const render = () => runner.render(api.hooks.useWorkspaces, props);
  const aNote = noteAt('notes/a.md'), bNote = noteAt('notes/b/deep/a.md'), cNote = noteAt('notes/b/c/a.md');
  render().setColor(api.WORKSPACE_ALL_ID, 'rouge');
  const b = render().add('notes/b').item;
  render().setColor(b.id, 'mist');
  const c = render().add('notes/b/c').item;
  render().setColor(c.id, 'moss');
  render().select(api.WORKSPACE_ALL_ID);
  let state = render();
  assert.equal(state.paperForNote(aNote).id, 'rouge');
  assert.equal(state.paperForNote(bNote).id, 'mist', '父视图里的 B 便签使用 B 纸色');
  assert.equal(state.paperForNote(cNote).id, 'moss');
  state.setColor(api.WORKSPACE_ALL_ID, 'sand');
  state = render();
  assert.equal(state.paperForNote(aNote).id, 'sand');
  assert.equal(state.paperForNote(bNote).id, 'mist', 'A 改色不影响菜单上已有 B 的子树');
  assert.equal(state.paperForNote(cNote).id, 'moss');
  const previousResolver = state.paperForNote;
  state.setColor(b.id, 'lilac');
  state = render();
  assert.notEqual(state.paperForNote, previousResolver, '改色使卡片 memo 重新派生');
  assert.equal(state.activeId, api.WORKSPACE_ALL_ID, '仍停留在父空间');
  assert.equal(state.paperForNote(bNote).id, 'lilac', '子空间改色立即反映到父视图');
  assert.equal(state.paperForNote(aNote).id, 'sand', '父空间自己的便签不变');
  assert.equal(state.paperForNote(cNote).id, 'moss', '更深层已挂载空间不被 B 覆盖');
  state.select(b.id);
  state = render();
  assert.equal(state.paperForNote(bNote).id, 'lilac', '切换视图不改变便签纸色');
  assert.equal(state.paperForNote(cNote).id, 'moss');
  state.select(api.WORKSPACE_ALL_ID);
  render().remove(b.id);
  state = render();
  assert.equal(state.paperForNote(bNote).id, 'sand', 'B 不再挂在菜单上时继承父空间');
  assert.equal(state.paperForNote(cNote).id, 'moss', '移除 B 不影响仍挂载的 C');
  toasts.at(-1).action.run();
  state = render();
  assert.equal(state.paperForNote(bNote).id, 'lilac', '撤销恢复 B 的独立颜色');
  const stored = api.readStoredWorkspaces('/vault');
  assert.equal(stored.primaryColor, 'sand');
  assert.equal(stored.items.find((item) => item.id === b.id).color, 'lilac');
});

test('面板集成：父空间里的卡片、tag、阅读抽屉和拖拽预览同步采用子空间颜色', async (t) => {
  const runner = hookRunner(t), api = runner.api;
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window.addEventListener = () => {};
  globalThis.window.removeEventListener = () => {};
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
  const aNote = noteAt('notes/a.md'), bNote = noteAt('notes/b/a.md');
  api.writeStoredWorkspaces('/vault', [{ id: 'b', path: 'notes/b', color: 'mist' }], api.WORKSPACE_ALL_ID, 'rouge');
  runner.connect(async (_channel, endpoint, payload) => {
    if (endpoint === 'note') return { ok: true, value: { ...bNote, body: '', blocks: [] } };
    assert.equal(endpoint, 'state');
    return { ok: true, value: { configured: true, revision: '1', notes: [aNote, bNote], jobs: [], settings: { vaultPath: '/vault', notesDir: '/vault/notes', emojis: [] } } };
  });
  const translate = (key) => key;
  const render = () => captureNodes(runner.render(api.components.StickyNotesPanel, { t: translate }));
  const cards = () => render().filter((node) => node.type === api.components.NoteCard);
  const cardFor = (note) => cards().find((node) => node.props.note.path === note.path);
  const bar = () => render().find((node) => node.type === api.components.WorkspaceBar);
  render(); await flush(); render();
  assert.equal(cardFor(aNote).props.paper.id, 'rouge');
  assert.equal(cardFor(bNote).props.paper.id, 'mist');
  bar().props.onSetColor(api.WORKSPACE_ALL_ID, 'sand');
  assert.equal(cardFor(aNote).props.paper.id, 'sand');
  assert.equal(cardFor(bNote).props.paper.id, 'mist');
  cardFor(bNote).props.actions.current.onOpen(bNote);
  await flush();
  const drawer = () => render().find((node) => node.type === api.components.NoteDrawer);
  assert.equal(drawer().props.paper.id, 'mist');
  bar().props.onSetColor('b', 'lilac');
  const color = api.workspaceColor('lilac');
  assert.equal(cardFor(aNote).props.paper.id, 'sand');
  assert.equal(cardFor(bNote).props.paper, color);
  assert.equal(drawer().props.paper, color, '已打开的阅读抽屉同步更新');
  const card = api.components.NoteCard(cardFor(bNote).props);
  assert.equal(card.props.style['--sn-card-bg'], color.light);
  assert.equal(card.props.style['--sn-card-bg-dark'], color.dark);
  assert.ok(captureNodes(card).some((node) => node.props.className === 'SN_cardTag'), 'tag 保留在继承纸色变量的卡片中');
  drawer().props.onClose();
  const source = {};
  cardFor(bNote).props.actions.current.onDragStart(bNote, { x: 100, y: 100, width: 300, height: 208 }, source);
  const overlay = render().find((node) => node.type === api.components.CardDragOverlay);
  assert.equal(overlay.props.paper, color, '拖拽预览不退回父空间颜色');
});

test('嵌套主空间：挂载其父目录时，主空间也是独立的颜色边界', (t) => {
  const runner = hookRunner(t), api = runner.api;
  const viewRef = { current: { settings: { vaultPath: '/vault', notesDir: '/vault/notes/b' }, notes: [] } };
  const translate = (key) => key;
  const props = { t: translate, tRef: { current: translate }, aliveRef: { current: true }, viewRef, refreshNow() {}, pushToast() {} };
  const render = () => runner.render(api.hooks.useWorkspaces, props);
  render().setColor(api.WORKSPACE_ALL_ID, 'mist');
  const a = render().add('notes').item;
  render().setColor(a.id, 'rouge');
  let state = render();
  const aNote = noteAt('notes/a.md'), bNote = noteAt('notes/b/a.md');
  assert.equal(state.activeId, a.id);
  assert.equal(state.paperForNote(aNote).id, 'rouge');
  assert.equal(state.paperForNote(bNote).id, 'mist', '挂载父目录时主空间的便签保留自己的颜色');
  state.setColor(a.id, 'sand');
  state = render();
  assert.equal(state.paperForNote(aNote).id, 'sand');
  assert.equal(state.paperForNote(bNote).id, 'mist');
  state.setColor(api.WORKSPACE_ALL_ID, 'lilac');
  state = render();
  assert.equal(state.activeId, a.id);
  assert.equal(state.paperForNote(aNote).id, 'sand');
  assert.equal(state.paperForNote(bNote).id, 'lilac', '主空间改色同步到其父目录视图');
});
