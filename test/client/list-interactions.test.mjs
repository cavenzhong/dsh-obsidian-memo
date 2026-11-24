import test from 'node:test';
import assert from 'node:assert/strict';
import { captureNodes, editorOptions, flush, hookRunner, loadClient } from '../../test-support/client.mjs';

const LF = String.fromCharCode(10);
function keyEvent(patch = {}) {
  const flags = { prevented: false, stopped: false };
  return { key: 'l', metaKey: true, currentTarget: { value: '- 工作', selectionStart: 2, selectionEnd: 4 },
    preventDefault() { flags.prevented = true; }, stopPropagation() { flags.stopped = true; }, flags, ...patch };
}
const bullet = (sourceLine) => ({ kind: 'li', sourceLine, text: String(sourceLine) });
const task = (sourceLine) => ({ kind: 'li', checked: false, sourceLine, text: String(sourceLine) });
function dragEvent(patch = {}) {
  const flags = { prevented: false, stopped: false };
  return { clientY: 39, currentTarget: { getBoundingClientRect: () => ({ top: 10, height: 30 }), contains: () => false },
    dataTransfer: { setData() {} }, preventDefault() { flags.prevented = true; }, stopPropagation() { flags.stopped = true; }, flags, ...patch };
}

function rowDragEvent(block, patch = {}) {
  const target = {
    closest: () => block.kind === 'li' ? target : null,
    getAttribute: () => String(block.sourceLine),
    getBoundingClientRect: () => ({ top: 10, height: 30 }),
  };
  return dragEvent({ currentTarget: { contains: (node) => node === target }, target, ...patch });
}

test('正文快捷键：Cmd/Ctrl+L 四态切换，Cmd/Ctrl+方向键换行和缩进', (t) => {
  const api = loadClient(t).mod.__test;
  const changes = [];
  const cycle = keyEvent();
  assert.equal(api.handleListShortcut(cycle, (next) => changes.push(next)), true);
  assert.equal(changes[0].text, '- [ ] 工作');
  assert.deepEqual(cycle.flags, { prevented: true, stopped: true });
  let current = { value: '工作', selectionStart: 0, selectionEnd: 2 };
  for (const text of ['- 工作', '- [ ] 工作', '- [x] 工作', '工作']) {
    const event = keyEvent({ currentTarget: current });
    assert.equal(api.handleListShortcut(event, ({ text, start, end }) => { current = { value: text, selectionStart: start, selectionEnd: end }; }), true);
    assert.equal(current.value, text);
  }
  const ctrl = keyEvent({ key: 'L', metaKey: false, ctrlKey: true });
  assert.equal(api.handleListShortcut(ctrl, () => {}), true);
  const indent = keyEvent({ key: 'ArrowRight' });
  api.handleListShortcut(indent, (next) => changes.push(next));
  assert.equal(changes.at(-1).text, '  - 工作');
  const down = keyEvent({ key: 'ArrowDown', currentTarget: { value: '- 工作' + LF + '- 二', selectionStart: 2, selectionEnd: 4 } });
  api.handleListShortcut(down, (next) => changes.push(next));
  assert.equal(changes.at(-1).text, '- 二' + LF + '- 工作');
  const up = keyEvent({ key: 'ArrowUp', currentTarget: { value: '- 二' + LF + '- 工作', selectionStart: 6, selectionEnd: 8 } });
  api.handleListShortcut(up, (next) => changes.push(next));
  assert.equal(changes.at(-1).text, '- 工作' + LF + '- 二');
  for (const patch of [{ metaKey: false }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { key: 's' }, { key: '/', code: 'Slash' },
    { key: 'ArrowRight', currentTarget: { value: '普通段落', selectionStart: 0, selectionEnd: 0 } }, { currentTarget: { value: '- 工作', selectionStart: 2, selectionEnd: 4, disabled: true } }]) {
    const event = keyEvent(patch);
    assert.equal(api.handleListShortcut(event, () => assert.fail('不应修改')), false);
    assert.equal(event.flags.prevented, false);
  }
});

test('阅读抓手：普通圆点与任务可混排，整项变暗，拖影不复制源抓手', async (t) => {
  const runner = hookRunner(t), calls = [];
  const props = { path: '/A.md', body: ['- 一', '  - 子项', '  续行', '- [ ] 二'].join(LF), t: (key) => key, onReorderTask: (...args) => calls.push(args) };
  const render = () => runner.render(runner.api.hooks.useTaskReorder, props);
  let { blockProps: getProps, scrollProps } = render();
  assert.equal(getProps({ ...bullet(3), marker: '1.' }).handle, undefined);
  assert.equal(getProps({ kind: 'p', sourceLine: 2 }).handle, undefined);
  const first = getProps(bullet(0));
  const block = runner.api.components.NoteBlock({ block: bullet(0), taskDrag: first, t: props.t });
  assert.equal(captureNodes(block).find((node) => node.props.className === 'SN_taskGrip').children[0], '⋮');
  assert.equal(first.handle.draggable, true);
  const previews = [];
  let connected = false;
  const canvas = { style: {}, remove() { connected = false; } };
  const ownerDocument = {
    body: { append(node) { assert.equal(node, canvas); connected = true; } },
    createElement(tag) { assert.equal(tag, 'canvas'); return canvas; },
  };
  first.handle.onDragStart(dragEvent({
    currentTarget: { ownerDocument },
    dataTransfer: { setData() {}, setDragImage(...args) { assert.equal(connected, true); previews.push(args); } },
  }));
  assert.deepEqual(previews, [[canvas, 0, 0]]);
  assert.deepEqual([canvas.width, canvas.height], [1, 1]);
  assert.match(canvas.style.cssText, /opacity:0/);
  const over = rowDragEvent(task(3));
  scrollProps.onDragOver(over);
  assert.equal(over.flags.prevented, true);
  ({ blockProps: getProps, scrollProps } = render());
  assert.equal(getProps(bullet(0)).row['data-list-drag-source'], 'true');
  for (const child of [bullet(1), { kind: 'p', sourceLine: 2 }]) {
    const drag = getProps(child);
    assert.equal(drag.row['data-list-dragging'], 'true');
    assert.equal(drag.row['data-list-drag-source'], undefined);
    assert.equal(runner.api.components.NoteBlock({ block: child, taskDrag: drag }).props['data-list-dragging'], 'true');
  }
  assert.equal(getProps(task(3)).row['data-list-dragging'], undefined);
  assert.equal(getProps(task(3)).row['data-task-drop'], 'after');
  scrollProps.onDrop(rowDragEvent(task(3)));
  assert.deepEqual(calls, [[0, 3, true, props.body]]);
  ({ blockProps: getProps } = render());
  assert.equal(getProps(bullet(0)).row['data-list-dragging'], undefined);
  assert.equal(getProps(task(3)).row['data-task-drop'], undefined);
  getProps(task(3)).handle.onDragStart(dragEvent());
  assert.equal(render().blockProps(task(3)).row['data-list-drag-source'], 'true');
  getProps(task(3)).handle.onDragEnd(dragEvent());
  assert.equal(render().blockProps(task(3)).row['data-list-dragging'], undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(connected, false);
});

test('阅读抓手：向前插入、正文源行偏移与嵌套保护', (t) => {
  const runner = hookRunner(t), calls = [];
  const props = { path: '/A.md', body: ['- [ ] 一', '  - [ ] 子项', '- [ ] 二'].join(LF), bodyLineOffset: 2, t: (key) => key, onReorderTask: (...args) => calls.push(args) };
  let { blockProps: getProps, scrollProps } = runner.render(runner.api.hooks.useTaskReorder, props);
  getProps(task(4)).handle.onDragStart(dragEvent());
  scrollProps.onDragOver(rowDragEvent(task(2), { clientY: 11 }));
  ({ blockProps: getProps, scrollProps } = runner.render(runner.api.hooks.useTaskReorder, props));
  assert.equal(getProps(task(2)).row['data-task-drop'], 'before');
  scrollProps.onDrop(rowDragEvent(task(3), { clientY: 11 }));
  assert.equal(calls.length, 0, '不可跨父子层级');
  getProps(task(4)).handle.onDragStart(dragEvent());
  scrollProps.onDrop(rowDragEvent(task(2), { clientY: 11 }));
  assert.deepEqual(calls[0], [4, 2, false, props.body]);
});

test('阅读抓手：编辑中、忙碌、正文刷新、切换便签或外部拖动均不可写入', (t) => {
  for (const patch of [{ editing: true }, { busy: true }, { body: '- [ ] 新内容' }, { path: '/B.md' }]) {
    const runner = hookRunner(t), calls = [];
    let props = { path: '/A.md', body: ['- [ ] 一', '- [ ] 二'].join(LF), t: (key) => key, onReorderTask: (...args) => calls.push(args) };
    let { blockProps: getProps, scrollProps } = runner.render(runner.api.hooks.useTaskReorder, props);
    getProps(task(0)).handle.onDragStart(dragEvent());
    props = { ...props, ...patch };
    ({ blockProps: getProps } = runner.render(runner.api.hooks.useTaskReorder, props));
    scrollProps.onDrop(rowDragEvent(task(1)));
    assert.equal(calls.length, 0);
    if (props.editing) assert.deepEqual(getProps(task(0)), {});
    if (props.busy) assert.equal(getProps(task(0)).handle.draggable, false);
  }
  const runner = hookRunner(t), props = { path: '/A.md', body: '- [ ] 一' + LF + '- [ ] 二', t: (key) => key, onReorderTask: () => assert.fail('外部拖动不可写入') };
  const event = rowDragEvent(task(1));
  runner.render(runner.api.hooks.useTaskReorder, props).scrollProps.onDrop(event);
  assert.equal(event.flags.prevented, false);
});

test('抽屉阅读拖拽：越靠边滚得越快，指针静止时仍更新插入线和落点', (t) => {
  const runner = hookRunner(t), { NoteDrawer, NoteBlock } = runner.api.components;
  const frames = new Map(), moves = [];
  const lines = Array.from({ length: 60 }, (_, i) => `${['-', '- [ ]', '- [x]'][i % 3]} ${i}`);
  const blocks = lines.map((_, i) => i % 3 ? { ...task(i), checked: i % 3 === 2 } : bullet(i));
  const body = lines.join(LF), viewportTop = 100, height = 300, rowHeight = 30;
  let top = 0, frameId = 0, time = 0;
  const container = {
    get scrollTop() { return top; },
    set scrollTop(value) { top = Math.min(this.scrollHeight - height, Math.max(0, value)); },
    scrollHeight: lines.length * rowHeight, clientHeight: height,
    getBoundingClientRect: () => ({ top: viewportTop, bottom: viewportTop + height, left: 0, right: 200 }),
    contains: (node) => rows.includes(node),
    ownerDocument: {
      defaultView: {
        requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
        cancelAnimationFrame(id) { frames.delete(id); },
      },
      elementFromPoint(_x, y) { return rows[Math.floor((y - viewportTop + top) / rowHeight)]; },
    },
  };
  const rows = blocks.map((_, i) => ({
    closest: (selector) => selector === '[data-list-drop-line]' ? rows[i] : null,
    getAttribute: (name) => name === 'data-list-drop-line' ? String(i) : null,
    getBoundingClientRect: () => ({ top: viewportTop + i * rowHeight - top, height: rowHeight }),
  }));
  const draw = (patch) => captureNodes(runner.render(NoteDrawer, {
    t: (key) => key, drawer: { path: '/A.md', full: { body, blocks } }, onReorderTask: (...args) => moves.push(args), ...patch,
  }));
  const scrollProps = () => draw().find((node) => node.props.className === 'SN_noteDrawerBody').props;
  const blockProps = () => draw().filter((node) => node.type === NoteBlock).map((node) => node.props.taskDrag);
  const edgeEvent = (y, patch) => dragEvent({ clientX: 50, clientY: y, target: rows[8], currentTarget: container, ...patch });
  const frame = () => {
    time += 16;
    for (const [id, fn] of [...frames]) { frames.delete(id); fn(time); }
  };

  scrollProps().onDragOver(edgeEvent(395));
  assert.equal(frames.size, 0, '外部拖动不能滚动抽屉');
  blockProps()[0].handle.onDragStart(dragEvent());
  scrollProps().onDragOver(edgeEvent(350));
  frame();
  const slow = top;
  assert.ok(slow > 0);
  scrollProps().onDragOver(edgeEvent(395));
  frame();
  assert.ok(top - slow > slow, '越靠近下边缘越快');
  for (let i = 0; i < 14; i += 1) frame();
  const target = Math.floor((395 - viewportTop + top) / rowHeight);
  assert.ok(target >= 19, '不移动鼠标也能滚到首屏以下');
  const after = 395 >= rows[target].getBoundingClientRect().top + rowHeight / 2;
  assert.equal(blockProps()[target].row['data-task-drop'], after ? 'after' : 'before');
  assert.equal(blockProps()[8].row['data-task-drop'], undefined);
  scrollProps().onDrop(edgeEvent(395));
  assert.deepEqual(moves, [[0, target, after, body]], '提交当前指针下的新行，不用先前的事件目标');
  assert.equal(frames.size, 0);

  blockProps()[target].handle.onDragStart(dragEvent());
  const before = top;
  scrollProps().onDragOver(edgeEvent(105));
  frame();
  assert.ok(top < before, '上边缘可向上滚动');
  scrollProps().onDragOver(edgeEvent(250));
  assert.equal(frames.size, 0, '移回中间时停止');
  scrollProps().onDragOver(edgeEvent(105));
  scrollProps().onDragLeave(edgeEvent(99, { relatedTarget: null }));
  assert.equal(frames.size, 0, '离开正文时停止');
  scrollProps().onDragOver(edgeEvent(395));
  draw({ editing: true });
  assert.equal(frames.size, 0, '进入编辑态时停止');

  blockProps()[0].handle.onDragStart(dragEvent());
  top = container.scrollHeight - height - 5;
  scrollProps().onDragOver(edgeEvent(395));
  frame();
  assert.equal(top, container.scrollHeight - height);
  assert.equal(frames.size, 0, '滚到底后不再安排帧');
  scrollProps().onDragOver(edgeEvent(105));
  assert.equal(frames.size, 1);
  runner.unmount();
  assert.equal(frames.size, 0, '关闭抽屉时停止');
});

test('抽屉：快捷键仅正文编辑框注册，阅读模式不注册', (t) => {
  const runner = hookRunner(t), { NoteDrawer } = runner.api.components;
  const full = { body: '- 工作', blocks: [task(0)] };
  const props = { t: (key) => key, drawer: { path: '/A.md', full, summary: {} }, bodyDraft: '- 工作', titleDraft: '标题', titleMode: 'filename', onBodyChange() {}, onReorderTask() {} };
  const read = captureNodes(runner.render(NoteDrawer, props));
  assert.equal(read.some((node) => node.props.className === 'SN_noteEditor'), false);
  const editing = captureNodes(runner.render(NoteDrawer, { ...props, editing: true }));
  assert.equal(typeof editing.find((node) => node.props.className === 'SN_noteEditor').props.onKeyDown, 'function');
  assert.ok(editing.find((node) => node.props.className === 'SN_noteEditHints'));
});

test('编辑提示：单行可换位时显示完整提示，Cmd/Ctrl 多选列表仅提示切换标记', (t) => {
  const { api, render } = hookRunner(t);
  const bodyDraft = ['普通段落', '- 一', '- [ ] 二', '- [x] 三', '', '- 独立项'].join(LF);
  const changes = [];
  const props = { t: (key) => key, editing: true, drawer: { path: '/A.md', full: { body: bodyDraft } }, bodyDraft, onBodyChange(text) { changes.push(text); } };
  const draw = (patch) => captureNodes(render(api.components.NoteDrawer, { ...props, ...patch }));
  const byClass = (nodes, name) => nodes.find((node) => node.props.className === name);
  const editor = () => byClass(draw(), 'SN_noteEditor').props;
  const hint = (patch) => byClass(draw(patch), 'SN_noteEditHint').children[0];
  const at = (text) => ({ value: bodyDraft, selectionStart: bodyDraft.indexOf(text), selectionEnd: bodyDraft.indexOf(text) });
  const siblings = at('- 一');
  const many = { ...siblings, selectionEnd: bodyDraft.indexOf(LF + LF) };
  const press = (currentTarget = siblings, patch) => editor().onKeyDown(keyEvent({ key: 'Meta', currentTarget, ...patch }));
  assert.equal(hint(), 'drawer.shortcutHint');
  press();
  assert.equal(hint(), 'drawer.listShortcutHint');
  editor().onSelect({ currentTarget: { ...siblings, selectionEnd: bodyDraft.indexOf('- [ ] 二') } });
  assert.equal(hint(), 'drawer.listCycleShortcutHint', '选区止于下一行行首也可切换，但不可用方向键换位');
  editor().onSelect({ currentTarget: many });
  assert.equal(hint(), 'drawer.listCycleShortcutHint');
  const up = keyEvent({ key: 'ArrowUp', currentTarget: many });
  editor().onKeyDown(up);
  assert.equal(up.flags.prevented, false);
  const cycle = keyEvent({ currentTarget: many });
  editor().onKeyDown(cycle);
  assert.equal(cycle.flags.prevented, true);
  assert.deepEqual(changes, [['普通段落', '- [ ] 一', '- [x] 二', '三', '', '- 独立项'].join(LF)]);
  editor().onSelect({ currentTarget: at('- 独立项') });
  assert.equal(hint(), 'drawer.listCycleShortcutHint');
  editor().onSelect({ currentTarget: at('普通段落') });
  assert.equal(hint(), 'drawer.shortcutHint');
  editor().onSelect({ currentTarget: siblings });
  assert.equal(hint(), 'drawer.listShortcutHint');
  editor().onKeyUp({ key: 'Meta', metaKey: false, currentTarget: siblings });
  assert.equal(hint(), 'drawer.shortcutHint');
  press(many, { key: 'Control', metaKey: false, ctrlKey: true });
  assert.equal(hint(), 'drawer.listCycleShortcutHint');
  editor().onCompositionStart();
  assert.equal(hint(), 'drawer.shortcutHint');
  editor().onCompositionEnd({ currentTarget: siblings });
  assert.equal(hint(), 'drawer.listShortcutHint');
  editor().onBlur({ currentTarget: siblings });
  assert.equal(hint(), 'drawer.shortcutHint');
  press();
  assert.equal(hint({ saving: true }), 'drawer.saving');
  assert.equal(hint(), 'drawer.shortcutHint');
});

test('阅读排序 hook：携带原版本、禁用编辑与重复提交，迟到结果不重开旧便签', async (t) => {
  const runner = hookRunner(t), calls = [], replaced = [];
  const full = { path: '/A.md', name: 'A', body: '- [ ] 一' + LF + '- [ ] 二', contentRevision: 'opened' };
  const other = { path: '/B.md', name: 'B', body: '正文', contentRevision: 'other' };
  let finish;
  runner.connect(async (_channel, _endpoint, payload) => ({ ok: true, value: payload.path === '/A.md' ? full : other }));
  const options = editorOptions({ request(endpoint, payload) { calls.push({ endpoint, payload }); return new Promise((resolve) => { finish = resolve; }); }, replaceNote: (note) => replaced.push(note) });
  const render = () => runner.render(runner.api.hooks.useNoteEditor, options);
  render().openNoteDrawer(full); await flush();
  render().startEditing();
  await render().reorderTask(0, 1, true, full.body);
  assert.equal(calls.length, 0);
  render().cancelEditing(); await flush();
  const pending = render().reorderTask(0, 1, true, full.body);
  await render().reorderTask(0, 1, true, full.body);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { endpoint: 'reorderTask', payload: { path: '/A.md', sourceLine: 0, targetLine: 1, after: true, expectedRevision: 'opened' } });
  render().openNoteDrawer(other); await flush();
  finish({ note: { ...full, title: 'updated' } }); await pending;
  assert.equal(render().noteDrawer.path, '/B.md');
  assert.equal(replaced.length, 1);
  assert.equal(render().taskBusy, false);
});

test('正文多选普通无序项，Cmd+L 批量转待办而不是交给宿主', (t) => {
  const { api } = hookRunner(t);
  const value = '- 一\n* 二\n+ 三';
  const prevented = [], changes = [];
  assert.equal(api.handleListShortcut({ key: 'l', metaKey: true,
    currentTarget: { value, selectionStart: 0, selectionEnd: value.length },
    preventDefault() { prevented.push('default'); }, stopPropagation() { prevented.push('bubble'); },
  }, (change) => changes.push(change)), true);
  assert.deepEqual(prevented, ['default', 'bubble']);
  assert.equal(changes[0].text, '- [ ] 一\n* [ ] 二\n+ [ ] 三');
  assert.equal(changes[0].start, 0);
  assert.equal(changes[0].end, changes[0].text.length);
});
