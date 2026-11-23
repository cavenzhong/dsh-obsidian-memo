/** Floating readers reserve real layout space while keeping dismiss-on-click behavior. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_SOURCE, captureNodes, flush, hookRunner } from '../../test-support/client.mjs';

test('阅读浮层避让：整块墙预留宽度，输入岛不重复偏移，窄墙卡片可收缩', () => {
  assert.match(CLIENT_SOURCE, /\.SN_wallWrap\{[^}]*min-width:0;[^}]*margin-right:var\(--sn-dock-right,0px\)/);
  assert.match(CLIENT_SOURCE, /\.SN_captureDock\{[^}]*left:0;right:0;/, '输入岛相对已缩窄的墙定位，不能再次减去抽屉宽度');
  assert.doesNotMatch(CLIENT_SOURCE, /\.SN_captureDock\{[^}]*right:var\(--sn-dock-right/);
  assert.match(CLIENT_SOURCE, /grid-template-columns:repeat\(auto-fill,minmax\(min\(248px,100%\),1fr\)\)/, '剩余空间不足一列时避免最小列宽撑进抽屉');
});

test('未锁定阅读面板：打开、拖宽、窗口变窄、锁定切换及关闭均同步便签墙留白', async (t) => {
  const runner = hookRunner(t), api = runner.api;
  const previousDocument = globalThis.document, previousObserver = globalThis.ResizeObserver;
  const observers = [], listeners = new Map();
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window.addEventListener = (name, fn) => listeners.set(name, fn);
  globalThis.window.removeEventListener = (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); };
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; observers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
  };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousObserver === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = previousObserver;
  });
  let width = 408, panelWidth = 1200, hasDrawer = false;
  const drawerElement = { getBoundingClientRect: () => ({ width }) };
  const panelElement = {
    getBoundingClientRect: () => ({ width: panelWidth, right: panelWidth }),
    querySelector: (selector) => selector === '.SN_noteDrawer' && hasDrawer ? drawerElement : null,
  };
  const note = { path: '/vault/notes/a.md', relPath: 'notes/a.md', title: '便签', created: Date.now(), comments: [], images: [] };
  runner.connect(async (_channel, endpoint) => {
    if (endpoint === 'note') return { ok: true, value: { ...note, body: '正文', blocks: [] } };
    assert.equal(endpoint, 'state');
    return { ok: true, value: { configured: true, revision: '1', notes: [note], jobs: [], settings: { vaultPath: '/vault', notesDir: '/vault/notes', emojis: [] } } };
  });
  const translate = (key) => key;
  const render = () => captureNodes(runner.render(api.components.StickyNotesPanel, { t: translate }, (tree) => {
    tree.props.ref.current = panelElement;
    hasDrawer = captureNodes(tree).some((node) => node.type === api.components.NoteDrawer);
  }));
  const wall = () => render().find((node) => node.props.className === 'SN_wallWrap');
  const drawer = () => render().find((node) => node.type === api.components.NoteDrawer);
  const offset = () => wall().props.style['--sn-dock-right'];
  const resize = () => { for (const observer of observers.filter((item) => !item.disconnected)) observer.callback(); };
  render(); await flush();
  assert.equal(offset(), '0px');
  render().find((node) => node.type === api.components.NoteCard).props.actions.current.onOpen(note);
  await flush(); render();
  assert.equal(offset(), '408px', '未锁定也为便签墙预留抽屉实测宽度');
  assert.equal(drawer().props.inline, false, '保留浮层交互，不直接改成锁定态');
  assert.equal(drawer().props.pinned, false);
  assert.ok(observers.some((item) => item.targets.includes(drawerElement) && item.targets.includes(panelElement)));

  drawer().props.onResizeStart({ button: 0, stopPropagation() {}, currentTarget: {} });
  width = 500;
  listeners.get('pointermove')({ clientX: 700 });
  render();
  assert.equal(drawer().props.drawerWidth, 500);
  assert.equal(offset(), '500px', '拖宽时墙与输入岛一起重新排布');
  listeners.get('pointerup')();

  panelWidth = 600; width = 480;
  resize(); render();
  assert.equal(drawer().props.drawerWidth, 480, '窗口缩小时继续遵守原有浮层宽度上限');
  assert.equal(offset(), '480px');
  drawer().props.onTogglePinned();
  render();
  assert.equal(drawer().props.inline, true);
  assert.equal(offset(), '0px', '锁定态由并排布局占位，不重复预留浮层宽度');
  assert.ok(observers.filter((item) => item.targets.includes(drawerElement)).every((item) => item.disconnected));
  drawer().props.onTogglePinned();
  render();
  assert.equal(drawer().props.inline, false);
  assert.equal(offset(), '480px');

  drawer().props.onClose();
  render();
  assert.equal(drawer(), undefined);
  assert.equal(offset(), '0px', '关闭后便签墙立即恢复原宽度');
  assert.ok(observers.filter((item) => item.targets.includes(drawerElement)).every((item) => item.disconnected));
});
