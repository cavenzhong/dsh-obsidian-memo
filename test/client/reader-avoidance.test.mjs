/** Floating readers reserve real layout space while keeping dismiss-on-click behavior. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_SOURCE, captureNodes, flush, hookRunner } from '../../test-support/client.mjs';
import { WORKSPACE_ALL_ID } from '../../src/client/constants.js';

test('阅读浮层避让：整块墙预留宽度，输入岛不重复偏移，窄墙卡片可收缩', () => {
  const panelRule = CLIENT_SOURCE.match(/^\.SN_panel\{[^\n]*/m)?.[0] || '';
  assert.match(panelRule, /;position:relative;/, '面板根节点是浮层的定位边界');
  assert.match(CLIENT_SOURCE, /\.SN_noteDrawerLayer\{[^}]*position:absolute;inset:0;/, '浮层贴合面板四边，抽屉在右侧占满高度');
  assert.match(CLIENT_SOURCE, /\.SN_wallWrap\{[^}]*min-width:0;[^}]*margin-right:var\(--sn-dock-right,0px\)/);
  assert.match(CLIENT_SOURCE, /\.SN_captureDock\{[^}]*left:0;right:0;/, '输入岛相对已缩窄的墙定位，不能再次减去抽屉宽度');
  assert.doesNotMatch(CLIENT_SOURCE, /\.SN_captureDock\{[^}]*right:var\(--sn-dock-right/);
  assert.match(CLIENT_SOURCE, /grid-template-columns:repeat\(auto-fill,minmax\(min\(248px,100%\),1fr\)\)/, '剩余空间不足一列时避免最小列宽撑进抽屉');
});

for (const split of [false, true]) {
  test(`${split ? '双屏' : '单屏'}阅读抽屉：浮动时覆盖顶栏右侧，锁定时并排，宽度同步避让`, (t) => checkReaderAvoidance(t, split));
}

async function checkReaderAvoidance(t, split) {
  const runner = hookRunner(t), api = runner.api;
  const previousDocument = globalThis.document, previousObserver = globalThis.ResizeObserver;
  const observers = [], listeners = new Map(), frameCallbacks = new Set();
  for (const [key, value] of Object.entries({
    requestAnimationFrame(callback) { frameCallbacks.add(callback); return callback; },
    cancelAnimationFrame(callback) { frameCallbacks.delete(callback); },
    getComputedStyle: () => ({ paddingTop: '18px' }),
  })) {
    const old = globalThis[key];
    globalThis[key] = value;
    t.after(() => { if (old === undefined) delete globalThis[key]; else globalThis[key] = old; });
  }
  let time = 0;
  const paint = () => {
    for (const callback of [...frameCallbacks]) { frameCallbacks.delete(callback); callback(time); }
    time += 400;
  };
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
  let accentedCard = null;
  const sourceWall = { scrollHeight: 1200, clientHeight: 600, scrollTop: 0, contains: () => true, querySelector: () => null,
    addEventListener() {}, removeEventListener() {}, style: { removeProperty() {} } };
  const sourceCard = { offsetTop: 240, closest: () => sourceWall,
    setAttribute(key) { if (key === 'data-revealed') accentedCard = this; },
    removeAttribute(key) { if (key === 'data-revealed') accentedCard = null; } };
  const note = { path: '/vault/notes/a.md', relPath: 'notes/a.md', title: '便签', created: Date.now(), comments: [], images: [] };
  if (split) api.writeStoredWorkspaces('/vault', [{ id: 'side', path: 'side', color: 'mist' }], WORKSPACE_ALL_ID, 'paper', { pinnedIds: [WORKSPACE_ALL_ID, 'side'] });
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
  const assertDrawerPlacement = (inline) => {
    const [panel, ...nodes] = render();
    const body = nodes.find((node) => node.props.className === 'SN_body');
    const reader = nodes.find((node) => node.type === api.components.NoteDrawer);
    assert.equal(reader.props.inline, inline);
    assert.equal(panel.children.includes(reader), !inline, '浮层直接挂在面板根节点，覆盖顶栏右侧');
    assert.equal(body.children.includes(reader), inline, '只有锁定态才与便签墙在顶栏下方并排');
  };
  const offset = () => wall().props.style['--sn-dock-right'];
  const resize = () => { for (const observer of observers.filter((item) => !item.disconnected)) observer.callback(); };
  render(); await flush();
  assert.equal(render().filter((node) => node.props.className === 'SN_workspacePane').length, split ? 2 : 1);
  assert.equal(offset(), '0px');
  const openCard = () => render().find((node) => node.type === api.components.NoteCard).props.actions.current.onOpen(note, sourceCard);
  openCard();
  await flush(); render();
  sourceCard.offsetTop = 462;
  paint();
  assert.equal(accentedCard, null, '尚未到达目标行，不显示描边');
  paint();
  assert.equal(sourceWall.scrollTop, 444);
  assert.equal(accentedCard, sourceCard, '打开抽屉且重排完成后，以真实来源卡片显示描边');
  assert.equal(offset(), '408px', '未锁定也为便签墙预留抽屉实测宽度');
  assertDrawerPlacement(false);
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
  assertDrawerPlacement(true);
  openCard();
  render();
  assert.equal(accentedCard, null, '再次点击锁定着的同一张卡应重播提示');
  paint();
  assert.equal(accentedCard, sourceCard);
  assert.equal(offset(), '0px', '锁定态由并排布局占位，不重复预留浮层宽度');
  assert.ok(observers.filter((item) => item.targets.includes(drawerElement)).every((item) => item.disconnected));
  drawer().props.onTogglePinned();
  render();
  assertDrawerPlacement(false);
  assert.equal(offset(), '480px');

  drawer().props.onClose();
  render();
  assert.equal(drawer(), undefined);
  assert.equal(accentedCard, null, '关闭时清除描边');
  assert.equal(offset(), '0px', '关闭后便签墙立即恢复原宽度');
  assert.ok(observers.filter((item) => item.targets.includes(drawerElement)).every((item) => item.disconnected));
}

function revealFixture(t, { reduceMotion = false } = {}) {
  const runner = hookRunner(t), frames = new Map(), listeners = new Map(), attributes = new Set(), style = new Map();
  let seq = 0;
  const globals = { requestAnimationFrame: (callback) => { frames.set(++seq, callback); return seq; },
    cancelAnimationFrame: (id) => frames.delete(id), getComputedStyle: () => ({ paddingTop: '18px', paddingBottom: '110px' }) };
  for (const [key, value] of Object.entries(globals)) {
    const old = globalThis[key];
    globalThis[key] = value;
    t.after(() => { if (old === undefined) delete globalThis[key]; else globalThis[key] = old; });
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const runFrame = (time) => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(time); } };
  const wall = { clientHeight: 650, scrollTop: 0, contains: () => true,
    ownerDocument: { defaultView: { matchMedia: () => ({ matches: reduceMotion }) } },
    get scrollHeight() { return 809 + (parseFloat(style.get('--sn-reveal-extra')) || 0); },
    querySelector: () => ({ offsetTop: 698, offsetHeight: 1 }),
    style: { setProperty: (name, value) => style.set(name, value), removeProperty: (name) => style.delete(name) },
    scrollTo({ top, behavior }) {
      assert.equal(behavior, 'instant', '每帧的缓动不叠加原生平滑滚动');
      this.scrollTop = Math.min(top, this.scrollHeight - this.clientHeight);
      listeners.get('scroll')?.();
    },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const card = { offsetTop: 240, closest: () => wall,
    setAttribute: (attr) => { assert.equal(wall.scrollTop, card.offsetTop - 18, '先定位再开始描边'); attributes.add(attr); },
    removeAttribute: (attr) => attributes.delete(attr) };
  const request = { node: card, path: '/vault/a/6.md' };
  const render = (current, path) => runner.render(({ current, path }) => runner.api.hooks.useCardReveal(current, path), { current, path });
  return { attributes, card, frames, listeners, render, request, runFrame, style, wall };
}

test('抽屉重排后按实际行缓动；末行留白在途中不裁剪，停稳后才高亮', (t) => {
  const { attributes, card, frames, listeners, render, request, runFrame, style, wall } = revealFixture(t);
  render(request, request.path);
  card.offsetTop = 462; // 抽屉避让使列数减少，卡片改到下一行。
  runFrame(100);
  assert.equal(wall.scrollTop, 0, '测量后的起始帧不跳动');
  assert.equal(style.get('--sn-reveal-extra'), '285px');
  runFrame(190);
  const first = wall.scrollTop;
  assert.ok(first > 0 && first < 444);
  assert.equal(attributes.size, 0);
  runFrame(280);
  assert.ok(wall.scrollTop > first);
  assert.ok(wall.scrollTop - first < first, '接近目标时减速');
  assert.equal(attributes.size, 0);
  assert.equal(style.get('--sn-reveal-extra'), '285px');
  runFrame(500);
  assert.equal(wall.scrollTop, 444);
  assert.ok(attributes.has('data-revealed'));
  t.mock.timers.tick(500);
  assert.ok(attributes.has('data-revealed'));
  t.mock.timers.tick(250);
  assert.equal(attributes.size, 0);
  wall.scrollTop = 20;
  listeners.get('scroll')();
  assert.equal(style.size, 0);
  render(request, null);
  assert.equal(listeners.size, 0);
  assert.equal(frames.size, 0);
});

test('主动滚动或关闭抽屉会中断缓动；新的便签定位不会沿用旧目标', (t) => {
  const { attributes, card, frames, listeners, render, request, runFrame, style, wall } = revealFixture(t);
  render(request, request.path);
  runFrame(100);
  runFrame(200);
  assert.ok(wall.scrollTop > 0);
  listeners.get('wheel')();
  const interruptedAt = wall.scrollTop;
  runFrame(800);
  assert.equal(wall.scrollTop, interruptedAt);
  assert.equal(attributes.size, 0);
  assert.equal(listeners.has('wheel'), false);
  assert.equal(listeners.has('pointerdown'), false);

  const next = { ...request, path: '/vault/a/7.md', node: { ...card, offsetTop: 462 } };
  render(next, next.path);
  runFrame(900);
  assert.ok(frames.size);
  render(next, null);
  assert.equal(frames.size, 0);
  assert.equal(listeners.size, 0);
  assert.equal(style.size, 0);
  assert.equal(attributes.size, 0);
});

test('系统开启减少动态效果时不缓动，直接定位后高亮', (t) => {
  const { attributes, card, frames, render, request, runFrame, wall } = revealFixture(t, { reduceMotion: true });
  render(request, request.path);
  runFrame(100);
  assert.equal(wall.scrollTop, card.offsetTop - 18);
  assert.ok(attributes.has('data-revealed'));
  assert.equal(frames.size, 0);
});

test('定位描边在卡片内容上方绘制 1px，保留 0.5 秒后淡出，不拦截点击', () => {
  assert.match(CLIENT_SOURCE, /\.SN_card\[data-revealed\]::before\{[^}]*z-index:9;[^}]*box-shadow:inset 0 0 0 1px var\(--sn-accent\);pointer-events:none;animation:SN_cardReveal \.25s ease-out \.5s both/);
  assert.match(CLIENT_SOURCE, /@keyframes SN_cardReveal\{from\{opacity:1\}to\{opacity:0\}\}/);
  assert.match(CLIENT_SOURCE, /prefers-reduced-motion:reduce\)\{\.SN_card\[data-revealed\]::before\{animation:none/);
});
