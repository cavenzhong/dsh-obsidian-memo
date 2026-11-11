/** Client drag-sessions regression coverage. */
import test from 'node:test'
import { loadClient, captureNodes, CLIENT_SOURCE, hookRunner, deferred, flush } from '../../test-support/client.mjs'
import assert from 'node:assert/strict'

test('v0.15 卡片：菜单仅保留复制和 Obsidian，Enter 不再打开详情，拖拽与删除正常', (t) => {
  const api = loadClient(t).mod.__test, calls = []
  const note = { path: '/vault/便签.md', title: '便签', images: [], comments: [] }
  const actions = { current: {
    t: (key) => key,
    onCopy: (n) => calls.push(['copy', n.path]),
    onOpen: (n) => calls.push(['open', n.path]),
    onOpenObsidian: (n) => calls.push(['obsidian', n.path]),
    onToggleArchive: (n) => calls.push(['archive', n.path]),
    onProject: (n) => calls.push(['project', n.path]),
    onDelete: (n) => calls.push(['delete', n.path]),
    onDragStart: (n) => calls.push(['drag', n.path]),
    onDragEnd: () => calls.push(['end']),
  } }
  const card = api.components.NoteCard({ note, emojis: [], actions, hoverActive: true })
  const nodes = captureNodes(card)
  nodes.find((node) => node.children.includes('card.copy')).props.onClick({ stopPropagation() {} })
  nodes.find((node) => node.props.className === 'SN_mini SN_obsidianBtn').props.onClick({ stopPropagation() {} })
  assert.equal(nodes.some((node) => node.children.includes('card.archive') || node.children.includes('card.project')), false)
  const actionRow = nodes.find((node) => node.props.className === 'SN_actionRow')
  assert.equal(actionRow.children.filter((node) => node.type === 'button').length, 2)
  assert.equal(nodes.some((node) => node.props.className === 'SN_cardDelete'), false)
  let stopped = 0, prevented = 0
  const element = {}, enter = { key: 'Enter', target: element, currentTarget: element, preventDefault() { prevented++ }, stopPropagation() { stopped++ } }
  card.props.onKeyDown(enter)
  card.props.onKeyDown({ ...enter, target: {} })
  card.props.onKeyDown({ ...enter, nativeEvent: { isComposing: true } })
  assert.equal(prevented, 0)
  assert.equal(stopped, 0, '卡片不再截获 Enter，由输入岛统一处理')
  card.props.onKeyDown({ key: 'Backspace', metaKey: true, preventDefault() {}, stopPropagation() {} })
  const data = {}, transfer = { setData: (kind, value) => { data[kind] = value } }
  card.props.onDragStart({ target: { closest: () => null }, dataTransfer: transfer })
  card.props.onDragEnd()
  assert.deepEqual(calls, [['copy', note.path], ['obsidian', note.path], ['delete', note.path], ['drag', note.path], ['end']])
  assert.equal(data['application/x-dsh-memo'], note.path)
  assert.equal(transfer.effectAllowed, 'move')
})

test('v0.15 拖拽：透明系统拖影，保存真实尺寸与抓取位置，原卡片保留空虚线框', async (t) => {
  const api = loadClient(t).mod.__test
  let appended = false, removed = false, received, dragImage
  const image = { style: {}, remove() { removed = true } }
  const currentTarget = {
    getBoundingClientRect: () => ({ left: 50, top: 80, width: 300, height: 208 }),
    ownerDocument: { createElement: (tag) => { assert.equal(tag, 'canvas'); return image }, body: { appendChild(node) { assert.equal(node, image); appended = true } } },
  }
  const note = { path: '/vault/a.md', title: '便签', images: [], comments: [] }
  const card = api.components.NoteCard({ note, dragging: true, actions: { current: { t: (key) => key, onDragStart: (...args) => { received = args } } } })
  card.props.onDragStart({ target: { closest: () => null }, currentTarget, clientX: 200, clientY: 184, dataTransfer: {
    setData() {}, setDragImage(...args) { assert.equal(appended, true); dragImage = args },
  } })
  assert.deepEqual(dragImage, [image, 0, 0])
  assert.equal(image.width, 1)
  assert.equal(image.height, 1)
  assert.deepEqual(received, [note, { x: 200, y: 184, width: 300, height: 208, offsetX: 150, offsetY: 104 }, currentTarget])
  assert.equal(card.props['data-dragging'], 'true')
  assert.match(CLIENT_SOURCE, /\.SN_card\[data-dragging='true'\]\{[^}]*outline:2px dashed[^}]*transform:none/)
  assert.match(CLIENT_SOURCE, /\.SN_card\[data-dragging='true'\]>\*\{visibility:hidden\}/)
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(removed, true)
})

test('v0.15 拖拽栏：归档、到项目、删除均可执行，取消拖拽后输入草稿仍在', (t) => {
  const runner = hookRunner(t), api = runner.api
  const calls = [], active = []
  const menu = captureNodes(api.components.DropActions({
    t: (key) => key, active: null, activeTargetId: null, targets: [{ id: 'work', label: '进行时' }],
    onHover: (kind, targetId) => active.push([kind, targetId]),
    onArchive: (_, targetId) => calls.push(['archive', targetId]),
    onProject: () => calls.push(['project']),
    onDelete: () => calls.push(['delete']),
  }))
  const event = { dataTransfer: {}, preventDefault() {}, stopPropagation() {} }
  for (const node of menu.filter((node) => node.props['data-action'])) {
    node.props.onDragEnter(event)
    node.props.onDragOver(event)
    assert.equal(event.dataTransfer.dropEffect, 'move')
    node.props.onDrop(event)
  }
  assert.deepEqual(calls, [['archive', null], ['project'], ['delete']])
  const archiveMenu = captureNodes(api.components.DropActions({
    t: (key) => key, active: 'archive', activeTargetId: null, targets: [{ id: 'work', label: '进行时' }],
    onHover: (kind, targetId) => active.push([kind, targetId]),
    onArchive: (_, targetId) => calls.push(['archive', targetId]), onProject() {}, onDelete() {},
  }))
  const target = archiveMenu.find((node) => node.props.className === 'SN_dropTarget')
  target.props.onDragOver(event)
  target.props.onDrop(event)
  assert.deepEqual(calls[3], ['archive', 'work'])
  assert.ok(active.some(([kind, targetId]) => kind === 'archive' && targetId === 'work'))
  const props = { enabled: true, t: (key) => key }
  let nodes = captureNodes(runner.render(api.components.CaptureComposer, props))
  nodes.find((node) => node.props.className === 'SN_captureTitle').props.onChange({ target: { value: '未提交的草稿' } })
  nodes = captureNodes(runner.render(api.components.CaptureComposer, { ...props, dragNote: { path: 'a.md' } }))
  assert.equal(nodes.find((node) => node.props.className === 'SN_captureDock').props['data-card-dragging'], 'true')
  nodes = captureNodes(runner.render(api.components.CaptureComposer, props))
  assert.equal(nodes.find((node) => node.props.className === 'SN_captureTitle').props.value, '未提交的草稿')
})

for (const failed of [false, true]) {
  test(`拖拽会话：drop 与 dragend 只收尾一次，${failed ? '操作失败恢复卡片' : '操作成功移除卡片'}`, async (t) => {
    const runner = hookRunner(t), operation = deferred(), animation = deferred()
    const previousDocument = globalThis.document
    globalThis.document = { addEventListener() {}, removeEventListener() {} }
    globalThis.window.addEventListener = () => {}
    globalThis.window.removeEventListener = () => {}
    t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument })
    const note = { path: '/A.md', name: '甲', title: '甲', created: Date.now(), updated: Date.now(), images: [], comments: [] }
    let notes = [note], mutations = 0, finishes = 0
    runner.connect(async (_, endpoint) => {
      if (endpoint === 'state') return { ok: true, value: { configured: true, revision: String(notes.length), notes, jobs: [], settings: { emojis: [], archiveTargets: [] } } }
      assert.equal(endpoint, 'deleteNote')
      mutations++
      await operation.promise
      if (failed) return { ok: false, error: { code: 'test-failed', message: '测试失败', details: {} } }
      notes = []
      return { ok: true, value: { undoToken: 'undo', expiresAt: Date.now() + 5000 } }
    })
    const render = () => runner.render(runner.api.components.StickyNotesPanel, { t: (key) => key })
    render(); await flush()
    let panel = render()
    const card = captureNodes(panel).find((node) => node.type === runner.api.components.NoteCard)
    const actions = card.props.actions
    actions.current.onDragStart(note, { x: 100, y: 100, width: 300, height: 208 }, {})
    panel = render()
    const overlay = captureNodes(panel).find((node) => node.type === runner.api.components.CardDragOverlay)
    overlay.props.motionRef.current = { finish(mode) { assert.equal(mode, 'drop'); finishes++; return animation.promise } }
    const composer = captureNodes(panel).find((node) => node.type === runner.api.components.CaptureComposer)
    const event = { dataTransfer: { getData: () => note.path } }
    composer.props.onDeleteDrop(event)
    composer.props.onDeleteDrop(event)
    const ended = actions.current.onDragEnd()
    assert.equal(mutations, 1)
    assert.equal(finishes, 1)
    assert.equal(render().props['data-card-dragging'], 'true')
    animation.resolve(); await flush()
    assert.equal(render().props['data-card-dragging'], 'true', '动画结束后仍等待文件操作，避免原卡片闪回')
    operation.resolve(); await ended; await flush()
    panel = render()
    assert.equal(panel.props['data-card-dragging'], 'false')
    assert.equal(captureNodes(panel).filter((node) => node.type === runner.api.components.NoteCard).length, failed ? 1 : 0)
    assert.equal(mutations, 1)
    assert.equal(finishes, 1)
  })
}

test('client 源码 / 0.13.9：顶栏标题区可拖拽 DSH 窗口，按钮区保持可点击', () => {
  assert.match(CLIENT_SOURCE, /\.SN_head\{[^}]*-webkit-app-region:drag/, '顶栏应是窗口拖拽区')
  assert.match(CLIENT_SOURCE, /\.SN_headActions,\.SN_headActions \*\{-webkit-app-region:no-drag/, '按钮/菜单恢复 no-drag')
  assert.match(CLIENT_SOURCE, /className: 'SN_head'/, '顶栏结构不变')
})

for (const exit of ['pointerdown', 'focusin', 'blur', 'Escape', 'Enter', 'choose']) {
  test('归档目录待选择：停靠后 ' + exit + ' 正确结束会话，不在原卡片弹菜单', async (t) => {
    const runner = hookRunner(t), listeners = new Map(), animation = deferred(), operation = deferred()
    const previousDocument = globalThis.document
    globalThis.document = {
      addEventListener(name, fn, capture = false) { listeners.set(name + ':' + capture, fn) },
      removeEventListener(name, fn, capture = false) { if (listeners.get(name + ':' + capture) === fn) listeners.delete(name + ':' + capture) },
    }
    globalThis.window.addEventListener = (name, fn) => listeners.set('window:' + name, fn)
    globalThis.window.removeEventListener = (name, fn) => { if (listeners.get('window:' + name) === fn) listeners.delete('window:' + name) }
    t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument })
    const note = { path: '/A.md', title: '甲', created: Date.now(), updated: Date.now(), images: [], comments: [] }
    let notes = [note]
    const mutations = [], targets = [{ id: 'work', label: '工作' }, { id: 'life', label: '生活' }]
    runner.connect(async (_, endpoint, payload) => {
      if (endpoint === 'state') return { ok: true, value: { configured: true, revision: String(notes.length), notes, jobs: [], settings: { emojis: [], archiveTargets: targets } } }
      assert.equal(endpoint, 'archive'); mutations.push(payload)
      await operation.promise; notes = []
      return { ok: true, value: {} }
    })
    let focused = 0
    const field = { focus() { focused++ } }, form = { contains: () => false }
    const root = { contains: () => true, getClientRects: () => [{}], querySelector: (selector) => selector === '.SN_capture' ? form : selector === '.SN_captureTitle' ? field : null }
    const props = { t: (key) => key }, render = () => {
      const panel = runner.render(runner.api.components.StickyNotesPanel, props)
      panel.props.ref.current = root
      return panel
    }
    render(); await flush()
    const card = captureNodes(render()).find((node) => node.type === runner.api.components.NoteCard), anchor = {}
    const source = {}
    card.props.actions.current.onDragStart(note, { x: 100, y: 100, width: 300, height: 208 }, source)
    let panel = render(), modes = [], parked = []
    captureNodes(panel).find((node) => node.type === runner.api.components.CardDragOverlay).props.motionRef.current = {
      park(element) { parked.push(element) },
      finish(mode, element) { assert.equal(element, source); modes.push(mode); return animation.promise },
    }
    let composer = captureNodes(panel).find((node) => node.type === runner.api.components.CaptureComposer)
    composer.props.onArchiveDrop({ dataTransfer: { getData: () => note.path }, currentTarget: { closest: () => anchor } })
    card.props.actions.current.onDragEnd()
    assert.deepEqual(parked, [anchor])
    assert.deepEqual(modes, [])
    assert.deepEqual(mutations, [])
    panel = render()
    composer = captureNodes(panel).find((node) => node.type === runner.api.components.CaptureComposer)
    assert.equal(composer.props.archiveParked, true)
    assert.equal(composer.props.dropAction, 'archive')
    assert.equal(captureNodes(panel).filter((node) => node.props.className === 'SN_menu').length, 0)
    listeners.get('pointerdown:true')({ target: { closest: () => anchor } })
    listeners.get('focusin:true')({ target: { closest: () => anchor } })
    composer.props.onDragHover(null)
    assert.deepEqual(modes, [], '在归档区内移动焦点或鼠标不关闭菜单')
    if (exit === 'choose') {
      composer.props.onArchiveChoose('missing')
      assert.deepEqual(modes, [])
      const menu = captureNodes(runner.api.components.DropActions({ t: props.t, active: 'archive', targets, parked: true, onArchiveChoose: composer.props.onArchiveChoose }))
      const item = menu.find((node) => node.props['data-target-id'] === 'life')
      assert.equal(item.type, 'button')
      assert.equal(item.props.role, 'menuitem')
      item.props.onClick({ stopPropagation() {} })
      composer.props.onArchiveChoose('life')
      assert.deepEqual(modes, ['drop'])
      assert.deepEqual(mutations, [{ path: note.path, targetId: 'life' }])
    } else if (exit === 'Escape' || exit === 'Enter') listeners.get('keydown:true')({ key: exit, target: {}, preventDefault() {}, stopPropagation() {} })
    else if (exit === 'blur') listeners.get('window:blur')({ type: 'blur' })
    else listeners.get(exit + ':true')({ target: { closest: () => null } })
    if (exit !== 'choose') assert.deepEqual(modes, ['return'])
    assert.equal(render().props['data-card-dragging'], 'true')
    animation.resolve(); await flush()
    if (exit === 'choose') { assert.equal(render().props['data-card-dragging'], 'true'); operation.resolve(); await flush() }
    assert.equal(focused, 0, '必须等 React 提交输入岛可见状态后再聚焦')
    panel = render()
    assert.equal(panel.props['data-card-dragging'], 'false')
    assert.equal(captureNodes(panel).filter((node) => node.type === runner.api.components.NoteCard).length, exit === 'choose' ? 0 : 1)
    assert.equal(listeners.has('pointerdown:true'), false)
    assert.equal(listeners.has('focusin:true'), false)
    assert.equal(listeners.has('window:blur'), false)
    assert.equal(focused, exit === 'Enter' ? 1 : 0)
  })
}
