import test from 'node:test';
import assert from 'node:assert/strict';
import { captureNodes, editorOptions, flush, hookRunner, loadClient } from '../../test-support/client.mjs';

const LF = String.fromCharCode(10);
function keyEvent(patch = {}) {
  const flags = { prevented: false, stopped: false };
  return { key: '/', metaKey: true, currentTarget: { value: '- 工作', selectionStart: 2, selectionEnd: 4 },
    preventDefault() { flags.prevented = true; }, stopPropagation() { flags.stopped = true; }, flags, ...patch };
}
const task = (sourceLine) => ({ kind: 'li', checked: false, sourceLine, text: String(sourceLine) });
function dragEvent(patch = {}) {
  const flags = { prevented: false, stopped: false };
  return { clientY: 39, currentTarget: { getBoundingClientRect: () => ({ top: 10, height: 30 }), contains: () => false },
    dataTransfer: { setData() {} }, preventDefault() { flags.prevented = true; }, stopPropagation() { flags.stopped = true; }, flags, ...patch };
}

test('正文快捷键：Cmd/Ctrl 触发三态、上下、左右，非列表和组合态保留原行为', (t) => {
  const api = loadClient(t).mod.__test;
  const changes = [];
  const cycle = keyEvent();
  assert.equal(api.handleListShortcut(cycle, (next) => changes.push(next)), true);
  assert.equal(changes[0].text, '- [ ] 工作');
  assert.deepEqual(cycle.flags, { prevented: true, stopped: true });
  const ctrl = keyEvent({ metaKey: false, ctrlKey: true });
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
  for (const patch of [{ metaKey: false }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { key: 's' },
    { currentTarget: { value: '普通段落', selectionStart: 0, selectionEnd: 0 } }, { currentTarget: { value: '- 工作', selectionStart: 2, selectionEnd: 4, disabled: true } }]) {
    const event = keyEvent(patch);
    assert.equal(api.handleListShortcut(event, () => assert.fail('不应修改')), false);
    assert.equal(event.flags.prevented, false);
  }
});

test('阅读抓手：只在阅读任务项出现，记录拖动并显示上下插入线', (t) => {
  const runner = hookRunner(t), calls = [];
  const props = { path: '/A.md', body: ['- [ ] 一', '- [ ] 二'].join(LF), t: (key) => key, onReorderTask: (...args) => calls.push(args) };
  const render = () => runner.render(runner.api.hooks.useTaskReorder, props);
  let getProps = render();
  assert.deepEqual(getProps({ kind: 'li', text: '普通列表' }), {});
  const first = getProps(task(0));
  assert.equal(first.handle.draggable, true);
  first.handle.onDragStart(dragEvent());
  const over = dragEvent();
  getProps(task(1)).row.onDragOver(over);
  assert.equal(over.flags.prevented, true);
  getProps = render();
  assert.equal(getProps(task(1)).row['data-task-drop'], 'after');
  getProps(task(1)).row.onDrop(dragEvent());
  assert.deepEqual(calls, [[0, 1, true, props.body]]);
  assert.equal(render()(task(1)).row['data-task-drop'], undefined);
  const block = runner.api.components.NoteBlock({ block: task(0), taskDrag: first, t: props.t });
  assert.equal(captureNodes(block).find((node) => node.props.className === 'SN_taskGrip').children[0], '⋮');
});

test('阅读抓手：向前插入、正文源行偏移与嵌套保护', (t) => {
  const runner = hookRunner(t), calls = [];
  const props = { path: '/A.md', body: ['- [ ] 一', '  - [ ] 子项', '- [ ] 二'].join(LF), bodyLineOffset: 2, t: (key) => key, onReorderTask: (...args) => calls.push(args) };
  let getProps = runner.render(runner.api.hooks.useTaskReorder, props);
  getProps(task(4)).handle.onDragStart(dragEvent());
  getProps(task(2)).row.onDragOver(dragEvent({ clientY: 11 }));
  getProps = runner.render(runner.api.hooks.useTaskReorder, props);
  assert.equal(getProps(task(2)).row['data-task-drop'], 'before');
  getProps(task(3)).row.onDrop(dragEvent({ clientY: 11 }));
  assert.equal(calls.length, 0, '不可跨父子层级');
  getProps(task(4)).handle.onDragStart(dragEvent());
  getProps(task(2)).row.onDrop(dragEvent({ clientY: 11 }));
  assert.deepEqual(calls[0], [4, 2, false, props.body]);
});

test('阅读抓手：编辑中、忙碌、正文刷新、切换便签或外部拖动均不可写入', (t) => {
  for (const patch of [{ editing: true }, { busy: true }, { body: '- [ ] 新内容' }, { path: '/B.md' }]) {
    const runner = hookRunner(t), calls = [];
    let props = { path: '/A.md', body: ['- [ ] 一', '- [ ] 二'].join(LF), t: (key) => key, onReorderTask: (...args) => calls.push(args) };
    let getProps = runner.render(runner.api.hooks.useTaskReorder, props);
    const oldTarget = getProps(task(1));
    getProps(task(0)).handle.onDragStart(dragEvent());
    props = { ...props, ...patch };
    getProps = runner.render(runner.api.hooks.useTaskReorder, props);
    oldTarget.row.onDrop(dragEvent());
    assert.equal(calls.length, 0);
    if (props.editing) assert.deepEqual(getProps(task(0)), {});
    if (props.busy) assert.equal(getProps(task(0)).handle.draggable, false);
  }
  const runner = hookRunner(t), props = { path: '/A.md', body: '- [ ] 一' + LF + '- [ ] 二', t: (key) => key, onReorderTask: () => assert.fail('外部拖动不可写入') };
  const event = dragEvent();
  runner.render(runner.api.hooks.useTaskReorder, props)(task(1)).row.onDrop(event);
  assert.equal(event.flags.prevented, false);
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
