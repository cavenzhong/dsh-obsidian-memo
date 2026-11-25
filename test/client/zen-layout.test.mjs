/** Zen titles, temporary pane sizes and normal drawer restoration. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { captureNodes, flush, hookRunner, loadClient } from '../../test-support/client.mjs'

function layoutFixture(t) {
  const runner = hookRunner(t), listeners = new Map()
  window.addEventListener = (name, handler) => listeners.set(name, handler)
  window.removeEventListener = (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name) }
  let closed = 0, captures = 0
  const rect = { left: 100, width: 1200 }
  const props = { zen: true, pinned: false, panelRef: { current: { getBoundingClientRect: () => rect } },
    onClose() { closed++ } }
  const render = () => runner.render(runner.api.useZenLayout, props)
  const handle = { setPointerCapture() { captures++ }, hasPointerCapture() { return captures > 0 }, releasePointerCapture() { captures-- } }
  const event = { button: 0, pointerId: 1, currentTarget: handle, preventDefault() {}, stopPropagation() {} }
  return { runner, props, render, rect, event, listeners, closed: () => closed, captures: () => captures }
}

test('Zen 标题列表保留完整长标题，不做字符串截断', (t) => {
  const api = loadClient(t).mod.__test
  const title = '这是一条需要跨多行显示且不省略任何文字的标题'.repeat(10) + 'unbroken-'.repeat(30)
  const note = { path: '/long.md', title }
  const tree = api.components.ZenWorkspaceList({ model: { sortedNotes: [note] }, actionsRef: { current: {} }, t: (key) => key })
  const node = captureNodes(tree).find(({ props }) => props.className === 'SN_zenRowTitle')
  assert.equal(node.children.join(''), title)
})

test('Zen 分栏约束保证合理比例，窄面板回落到默认三分之一', (t) => {
  const api = loadClient(t).mod.__test
  for (const width of [300, 600, 1200, 2400]) {
    const lower = api.clampZenSplit(-1, width), upper = api.clampZenSplit(2, width)
    assert.ok(lower >= 0.2 && lower <= 1 / 3)
    assert.ok(upper <= 0.5 && upper >= 1 / 3)
    assert.equal(api.clampZenSplit(1 / 3, width), 1 / 3)
  }
  assert.equal(api.clampZenSplit(0.4, 1200), 0.4)
})

test('Zen 分隔线拖动仅在本次模式生效，退出清理监听并且重新进入重置', (t) => {
  const f = layoutFixture(t)
  f.runner.api.storePinned(false)
  const before = Array.from({ length: f.runner.storage.length }, (_, i) => { const key = f.runner.storage.key(i); return [key, f.runner.storage.getItem(key)] })
  assert.equal(f.render().split, 1 / 3)
  f.render().startResize(f.event)
  assert.equal(f.render().resizing, true)
  assert.equal(f.captures(), 1)
  f.listeners.get('pointermove')({ clientX: 580 })
  assert.equal(f.render().split, 0.4)
  f.listeners.get('pointermove')({ clientX: 2000 })
  assert.equal(f.render().split, 0.5)
  f.props.zen = false
  f.render()
  assert.equal(f.closed(), 1)
  assert.equal(f.listeners.size, 0)
  assert.equal(f.captures(), 0)
  f.props.zen = true
  f.render()
  assert.equal(f.render().split, 1 / 3)
  assert.equal(f.render().resizing, false)
  const after = Array.from({ length: f.runner.storage.length }, (_, i) => { const key = f.runner.storage.key(i); return [key, f.runner.storage.getItem(key)] })
  assert.deepEqual(after, before, 'Zen 分栏不写入 localStorage，也不修改图钉偏好')
})

test('Zen 分隔线在取消、失焦、卸载时清理，右键不启动拖动', (t) => {
  const f = layoutFixture(t)
  f.render().startResize({ ...f.event, button: 2 })
  assert.equal(f.listeners.size, 0)
  for (const end of ['pointerup', 'pointercancel', 'blur']) {
    f.render().startResize(f.event)
    f.listeners.get(end)()
    assert.equal(f.listeners.size, 0)
    assert.equal(f.render().resizing, false)
    assert.equal(f.captures(), 0)
  }
  f.render().startResize(f.event)
  f.runner.unmount()
  assert.equal(f.listeners.size, 0)
  assert.equal(f.captures(), 0)
})

test('Zen 分隔线键盘调整与双击重置，无笔记时仍可调宽', (t) => {
  const f = layoutFixture(t)
  f.render().onKeyDown({ key: 'ArrowRight', preventDefault() {} })
  assert.equal(f.render().split, 1 / 3 + 0.02)
  f.render().onKeyDown({ key: 'Home', preventDefault() {} })
  assert.equal(f.render().split, 1 / 3)
  f.render().startResize(f.event)
  f.listeners.get('pointermove')({ clientX: 580 })
  f.render().reset()
  assert.equal(f.render().split, 1 / 3)
  assert.equal(f.listeners.size, 0)
})

for (const pinned of [false, true]) {
  test(`Zen 退出${pinned ? '保留已钉住面板' : '折叠未钉住的详情及右侧空间'}`, async (t) => {
    const runner = hookRunner(t), { api } = runner
    api.storePinned(pinned)
    const previousDocument = globalThis.document
    globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {} }
    t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument })
    const note = { path: '/vault/A.md', relPath: 'A.md', title: '正文', created: Date.now(), updated: Date.now(), images: [], comments: [] }
    runner.connect(async (_channel, endpoint) => ({ ok: true, value: endpoint === 'state' ?
      { configured: true, revision: '1', notes: [note], jobs: [], settings: { vaultPath: '/vault', notesDir: '/vault' } } :
      { ...note, body: '正文', blocks: [] } }))
    const render = () => captureNodes(runner.render(api.components.StickyNotesPanel, { t: (key) => key }))
    const component = (nodes, name) => nodes.find(({ type }) => type === api.components[name])
    render(); await flush()
    component(render(), 'WorkspaceBar').props.onToggleZen()
    render(); await flush()
    let nodes = render()
    assert.ok(component(nodes, 'ZenWorkspaceList'))
    assert.ok(component(nodes, 'NoteDrawer'))
    const divider = nodes.find(({ props }) => props.className === 'SN_zenDivider')
    assert.equal(divider.props['aria-valuenow'], 33)
    component(nodes, 'WorkspaceBar').props.onToggleZen()
    render(); await flush()
    nodes = render()
    assert.equal(Boolean(component(nodes, 'NoteDrawer')), pinned)
    assert.equal(nodes.some(({ props }) => props.className === 'SN_zenDivider'), false)
    assert.equal(nodes.find(({ props }) => props.className === 'SN_body').props.style, undefined)
    assert.equal(api.readStoredPinned(), pinned)
    if (pinned) assert.equal(component(nodes, 'NoteDrawer').props.pinned, true)
  })
}


test('Zen 的 Esc、标题点击与切换操作不会意外关闭详情或丢弃编辑草稿', async (t) => {
  const runner = hookRunner(t), { api } = runner
  const listeners = new Map()
  const previous = globalThis.document
  globalThis.document = { body: {}, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) }
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous })
  const notes = ['A', 'B', 'other/C'].map((name) => ({ path: `/vault/${name}.md`, relPath: `${name}.md`, title: name,
    created: Date.now(), updated: Date.now(), images: [], comments: [] }))
  api.writeStoredWorkspaces('/vault', [{ id: 'other', path: 'other', color: 'mist' }], api.WORKSPACE_ALL_ID, 'paper', { zen: true })
  runner.connect(async (_channel, endpoint, payload) => ({ ok: true, value: endpoint === 'state' ?
    { configured: true, revision: '1', notes, jobs: [], settings: { vaultPath: '/vault', notesDir: '/vault' } } :
    { ...notes.find((note) => note.path === payload.path), body: '原文', blocks: [] } }))
  const render = () => captureNodes(runner.render(api.components.StickyNotesPanel, { t: (key) => key }))
  const component = (nodes, name) => nodes.find(({ type }) => type === api.components[name])
  render(); await flush(); render(); await flush()
  let nodes = render()
  const drawer = component(nodes, 'NoteDrawer')
  listeners.get('keydown')({ key: 'Escape', stopPropagation() {} })
  assert.equal(component(render(), 'NoteDrawer').props.drawer.path, drawer.props.drawer.path)
  drawer.props.onStartEdit()
  nodes = render()
  component(nodes, 'NoteDrawer').props.onBodyChange('应当保留的草稿')
  nodes = render()
  const bar = component(nodes, 'WorkspaceBar').props
  const list = component(nodes, 'ZenWorkspaceList').props
  list.onOpen(notes.find((note) => note.path === drawer.props.drawer.path))
  list.onOpen(notes.find((note) => note.path !== drawer.props.drawer.path))
  bar.onSelect('other')
  bar.onToggleZen()
  nodes = render()
  assert.equal(component(nodes, 'WorkspaceBar').props.zen, true)
  assert.equal(component(nodes, 'WorkspaceBar').props.activeId, api.WORKSPACE_ALL_ID)
  assert.equal(component(nodes, 'NoteDrawer').props.drawer.path, drawer.props.drawer.path)
  assert.equal(component(nodes, 'NoteDrawer').props.bodyDraft, '应当保留的草稿')
})
