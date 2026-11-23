/** Client drag-sessions regression coverage. */
import test from 'node:test'
import { loadClient, captureNodes, CLIENT_SOURCE, hookRunner, deferred, flush } from '../../test-support/client.mjs'
import assert from 'node:assert/strict'

test('归档拖拽提示：主空间内相对默认目录，主空间外相对仓库', (t) => {
  const { CardDragOverlay } = loadClient(t).mod.__test.components
  const hint = (path, vaultPath, notesDir, archiveDir) => {
    const nodes = captureNodes(CardDragOverlay({
      note: { path }, point: {}, action: 'archive',
      archiveSettings: { archiveMode: 'mapped', vaultPath, notesDir, archiveDir },
      t: (key, args) => args?.path || key,
    }))
    return nodes.find(node => node.props.className === 'SN_dragFollow').children[1].children[0]
  }
  const cases = [
    ['/vault/进行时/便签.md', '/vault', '/vault/进行时', '/vault/历史', '历史'],
    ['/vault/进行时/任务/便签.md', '/vault', '/vault/进行时', '/vault/历史', '历史/任务'],
    ['/vault/进行时-其他/任务/便签.md', '/vault', '/vault/进行时', '/vault/历史', '历史/进行时-其他/任务'],
    ['/vault/便签.md', '/vault', '/vault/进行时', '/vault/历史', '历史'],
    ['c:\\Vault\\工作\\任务\\便签.md', 'C:\\VAULT', 'C:\\VAULT\\进行时', 'C:\\VAULT\\历史', '历史/工作/任务'],
  ]
  for (const [path, vault, notes, archive, expected] of cases) assert.equal(hint(path, vault, notes, archive), expected)
})

test('v0.15 卡片：菜单仅保留复制和 Obsidian，Enter 不再打开详情，拖拽与删除正常', (t) => {
  const api = loadClient(t).mod.__test, calls = []
  const note = { path: '/vault/便签.md', title: '便签', images: [], comments: [] }
  const actions = { current: {
    t: (key) => key,
    onCopy: (n) => calls.push(['copy', n.path]),
    onOpen: (n) => calls.push(['open', n.path]),
    onOpenObsidian: (n) => calls.push(['obsidian', n.path]),
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

test('拖拽栏：归档直接执行，项目保留目标菜单，取消后输入草稿仍在', (t) => {
  const runner = hookRunner(t), api = runner.api
  const calls = [], active = []
  const menu = captureNodes(api.components.DropActions({
    t: (key) => key, active: null, activeTargetId: null, projectTargets: [{ id: 'work', label: '进行时' }],
    onHover: (kind, targetId, anchor) => active.push([kind, targetId, anchor]),
    onArchive: () => calls.push(['archive']),
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
  assert.deepEqual(calls, [['archive'], ['project'], ['delete']])
  const archiveHover = captureNodes(api.components.DropActions({
    t: (key) => key, active: 'archive', activeTargetId: null, projectTargets: [{ id: 'work', label: '进行时' }],
    onHover: (kind, targetId, anchor) => active.push([kind, targetId, anchor]),
    onArchive: () => calls.push(['archive-again']), onProject() {}, onDelete() {},
  }))
  assert.equal(archiveHover.some((node) => node.props.className === 'SN_dropTarget'), false)
  archiveHover.find((node) => node.props['data-action'] === 'archive').props.onDrop(event)
  assert.deepEqual(calls[3], ['archive-again'])
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
      if (endpoint === 'state') return { ok: true, value: { configured: true, revision: String(notes.length), notes, jobs: [], settings: { emojis: [], archiveMode: 'local' } } }
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

test('client 源码 / 0.17：顶栏同一区域既能拖动窗口，也能单击收起抽屉', () => {
  assert.match(CLIENT_SOURCE, /\.SN_head\{[^}]*-webkit-app-region:drag/, '非 darwin 仍保留原生 app-region 拖动')
  assert.match(CLIENT_SOURCE, /\[data-platform='darwin'\] \.SN_head\{[^}]*-webkit-app-region:no-drag;app-region:no-drag\}/, 'darwin 顶栏必须关闭 app-region，指针事件才能到达 DOM')
  assert.match(CLIENT_SOURCE, /\.SN_headActions,\.SN_headActions \*\{-webkit-app-region:no-drag/, '按钮/菜单保持 no-drag')
  assert.match(CLIENT_SOURCE, /HEADER_DRAG_THRESHOLD = 3/, '拖动阈值应独立固定')
  assert.match(CLIENT_SOURCE, /window\.moveTo\(Math\.round\(gesture\.winX\)/, '拖动应调用 window.moveTo 移动窗口')
  assert.match(CLIENT_SOURCE, /onLostPointerCapture: onHeaderPointerCancel/, '失去指针捕获时要结束手势')
  assert.match(CLIENT_SOURCE, /className: 'SN_head'/, '顶栏结构不变')
  assert.doesNotMatch(CLIENT_SOURCE, /SN_headTopClickArea/, '旧的标题上方点击条已移除')
  assert.doesNotMatch(CLIENT_SOURCE, /onMouseDown: onBackgroundMouseDown/, '不再用 mousedown 直接关闭抽屉')
})

test('未锁定阅读抽屉：顶栏单击收起，按住拖动移动窗口且不误关', async (t) => {
  const runner = hookRunner(t)
  const previousDocument = globalThis.document
  globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    documentElement: { dataset: { platform: 'darwin' } },
  }
  globalThis.window.addEventListener = () => {}
  globalThis.window.removeEventListener = () => {}
  globalThis.window.screenX = 240
  globalThis.window.screenY = 120
  const moves = []
  globalThis.window.moveTo = (x, y) => { moves.push([x, y]) }
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument })
  const note = { path: '/vault/便签.md', title: '便签', created: Date.now(), updated: Date.now(), comments: [], images: [], blocks: [] }
  runner.connect(async (_, endpoint) => {
    if (endpoint === 'state') return { ok: true, value: { configured: true, notes: [note], revision: '1', jobs: [], settings: { emojis: [] } } }
    if (endpoint === 'note') return { ok: true, value: { ...note, body: '正文' } }
    assert.fail('Unexpected endpoint ' + endpoint)
  })
  const render = () => runner.render(runner.api.components.StickyNotesPanel, { t: (key) => key })
  const find = (className) => captureNodes(render()).find((node) => node.props.className === className)
  const drawerOpen = () => captureNodes(render()).some((node) => node.type === runner.api.components.NoteDrawer)
  const closeDrawer = async () => {
    const drawer = captureNodes(render()).find((node) => node.type === runner.api.components.NoteDrawer)
    if (drawer) { drawer.props.onClose(); await flush() }
  }
  const openFromCard = async () => {
    await closeDrawer()
    const card = captureNodes(render()).find((node) => node.type === runner.api.components.NoteCard)
    card.props.actions.current.onOpen(note)
    await flush()
  }
  const pointer = (header, target, overrides = {}) => ({
    button: 0, isPrimary: true, pointerId: 7,
    screenX: 240, screenY: 120, clientX: 30, clientY: 20,
    target, currentTarget: header, preventDefault() {},
    ...overrides,
  })
  const clickAt = (header, target) => {
    header.props.onPointerDown(pointer(header, target))
    header.props.onPointerUp(pointer(header, target))
    header.props.onClick({ target, currentTarget: header })
  }
  render(); await flush()
  await openFromCard()

  let header = find('SN_head')
  assert.equal(drawerOpen(), true)
  const controlTarget = { closest: (selector) => selector.includes('button') ? {} : null }
  header.props.onPointerDown(pointer(header, controlTarget))
  header.props.onClick({ target: controlTarget, currentTarget: header })
  assert.equal(drawerOpen(), true, '顶栏按钮区域不误关抽屉')

  header = find('SN_head')
  const title = captureNodes(header).find((node) => node.props.className === 'SN_title')
  assert.ok(title, '标题区域应存在并可接收 DOM 事件')
  clickAt(header, title)
  assert.equal(drawerOpen(), false, '单击 Obsidian MEMO 标题区关闭未锁定抽屉')
  assert.deepEqual(moves, [], '单击不移动窗口')

  await openFromCard()
  header = find('SN_head')
  clickAt(header, header)
  assert.equal(drawerOpen(), false, '单击标题旁留白关闭未锁定抽屉')

  await openFromCard()
  header = find('SN_head')
  const titleForDrag = captureNodes(header).find((node) => node.props.className === 'SN_title')
  header.props.onPointerDown(pointer(header, titleForDrag, { screenX: 240, screenY: 120 }))
  header.props.onPointerMove(pointer(header, titleForDrag, { screenX: 260, screenY: 130 }))
  header.props.onPointerUp(pointer(header, titleForDrag, { screenX: 260, screenY: 130 }))
  header.props.onClick({ target: titleForDrag, currentTarget: header })
  assert.equal(drawerOpen(), true, '按住标题拖动窗口不应关闭抽屉')
  assert.deepEqual(moves, [[260, 130]], '窗口跟随指针移动')

  await openFromCard()
  header = find('SN_head')
  const titleForTinyMove = captureNodes(header).find((node) => node.props.className === 'SN_title')
  header.props.onPointerDown(pointer(header, titleForTinyMove, { screenX: 240, screenY: 120 }))
  header.props.onPointerMove(pointer(header, titleForTinyMove, { screenX: 242, screenY: 121 }))
  header.props.onPointerUp(pointer(header, titleForTinyMove, { screenX: 242, screenY: 121 }))
  header.props.onClick({ target: titleForTinyMove, currentTarget: header })
  assert.equal(drawerOpen(), false, '小于拖动阈值的移动仍按单击处理')
  assert.deepEqual(moves, [[260, 130]], '阈值内不移动窗口')

  await openFromCard()
  const drawer = captureNodes(render()).find((node) => node.type === runner.api.components.NoteDrawer)
  drawer.props.onTogglePinned()
  header = find('SN_head')
  const lockedTitleTarget = { closest: () => null }
  clickAt(header, lockedTitleTarget)
  assert.equal(drawerOpen(), true, '锁定态点击顶栏标题区不关闭')
})

test('归档拖放：松手立即执行，不停靠也不传目标 ID', async (t) => {
  const runner = hookRunner(t), operation = deferred(), animation = deferred()
  const previousDocument = globalThis.document
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  globalThis.window.addEventListener = () => {}
  globalThis.window.removeEventListener = () => {}
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument })
  const note = { path: '/vault/Notes/A.md', title: '甲', created: Date.now(), updated: Date.now(), images: [], comments: [] }
  const mutations = []
  runner.connect(async (_, endpoint, payload) => {
    if (endpoint === 'state') return { ok: true, value: { configured: true, revision: '1', notes: [note], jobs: [], settings: {
      vaultPath: '/vault', notesDir: '/vault/Notes', archiveMode: 'local', archiveFolderName: '已归档', emojis: [],
    } } }
    assert.equal(endpoint, 'archive'); mutations.push(payload)
    await operation.promise
    return { ok: true, value: { undoToken: 'undo' } }
  })
  const render = () => runner.render(runner.api.components.StickyNotesPanel, { t: (key) => key })
  render(); await flush()
  const card = captureNodes(render()).find((node) => node.type === runner.api.components.NoteCard)
  const source = {}
  card.props.actions.current.onDragStart(note, { x: 100, y: 100, width: 300, height: 208 }, source)
  const panel = render(), overlay = captureNodes(panel).find((node) => node.type === runner.api.components.CardDragOverlay)
  let parked = 0, modes = []
  overlay.props.motionRef.current = {
    park() { parked++ },
    finish(mode, element) { assert.equal(element, source); modes.push(mode); return animation.promise },
  }
  const composer = captureNodes(panel).find((node) => node.type === runner.api.components.CaptureComposer)
  composer.props.onArchiveDrop({ dataTransfer: { getData: () => note.path } })
  assert.deepEqual(mutations, [{ path: note.path }])
  assert.deepEqual(modes, ['drop'])
  assert.equal(parked, 0)
  animation.resolve(); operation.resolve(); await flush()
  assert.equal(render().props['data-card-dragging'], 'false')
})
