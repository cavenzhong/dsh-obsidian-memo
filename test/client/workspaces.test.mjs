/** client: workspace tabs regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CLIENT_SOURCE, captureNodes, hookRunner, loadClient } from '../../test-support/client.mjs'

const ALL = '__all__'

function entriesFixture() {
  return [
    { id: ALL, path: '进行时', label: '主空间', all: true, primary: true },
    { id: 'ws-1', path: '进行时/日记', label: '日记' },
    { id: 'ws-2', path: '收件箱', label: '收件箱' },
  ]
}

test('工作空间纯规则：仓库相对路径、标签去重与子树筛选', (t) => {
  const api = loadClient(t).mod.__test
  assert.equal(api.normalizeWorkspaceFolder('日记'), '日记')
  assert.equal(api.normalizeWorkspaceFolder('./日记/2026//'), '日记/2026')
  assert.equal(api.normalizeWorkspaceFolder('日记\\2026'), '日记/2026')
  assert.equal(api.normalizeWorkspaceFolder(''), '.')
  assert.equal(api.normalizeWorkspaceFolder('.'), '.')
  for (const invalid of ['../外面', '/绝对/路径', 'C:\\vault', '.obsidian', '日记/.隐藏']) {
    assert.equal(api.normalizeWorkspaceFolder(invalid), null, invalid)
  }

  // vaultRelative 供设置显示；仓库外原样返回，工作空间 hook 会把绝对路径按根处理。
  assert.equal(api.vaultRelative('/vault', '/vault/进行时'), '进行时')
  assert.equal(api.vaultRelative('/vault', '/vault'), '.')
  assert.equal(api.vaultRelative('/vault', '/other/进行时'), '/other/进行时')
  assert.equal(api.vaultRelative('', '/vault/进行时'), '/vault/进行时')

  const labels = api.workspaceLabels([
    { id: 'a', path: '日记' },
    { id: 'b', path: '工作/日记' },
    { id: 'c', path: '工作' },
  ])
  assert.equal(labels.get('b'), '工作/日记', '同名文件夹改用完整相对路径')
  assert.equal(labels.get('c'), '工作')

  const notes = [
    { path: '/vault/进行时/日记/今天.md', relPath: '进行时/日记/今天.md' },
    { path: '/vault/进行时/日记本/另一篇.md', relPath: '进行时/日记本/另一篇.md' },
    { path: '/vault/进行时/日记/子/更深处.md', relPath: '进行时/日记/子/更深处.md' },
    { path: '/vault/进行时/日记/无相对路径.md' },
  ]
  const scoped = api.filterNotesByWorkspace(notes, '进行时/日记', '/vault')
  assert.deepEqual(scoped.map((note) => note.path), [
    '/vault/进行时/日记/今天.md',
    '/vault/进行时/日记/子/更深处.md',
    '/vault/进行时/日记/无相对路径.md',
  ], '包含子树；没有 relPath 时回退绝对路径')
  assert.equal(api.filterNotesByWorkspace(notes, '.', '/vault'), notes, '主空间为仓库根时原样返回同一数组')
  const topOnly = api.filterNotesByWorkspace(notes, '进行时/日记', '/vault', { topOnly: true })
  assert.deepEqual(topOnly.map((note) => note.path), [
    '/vault/进行时/日记/今天.md',
    '/vault/进行时/日记/无相对路径.md',
  ], 'topOnly 只看该目录顶层，不看子树')

})

test('工作空间增删排序：根目录/重复/无效拒绝，删除后可撤销回原位置', (t) => {
  const api = loadClient(t).mod.__test
  assert.equal(api.addWorkspace([], '.').error, 'root')
  assert.equal(api.addWorkspace([], '../外面').error, 'invalid')
  const first = api.addWorkspace([], '进行时/日记')
  assert.equal(first.error, undefined)
  assert.equal(first.item.path, '进行时/日记')
  assert.equal(api.WORKSPACE_COLORS.length, 9, '9 个预设纸色')
  assert.ok(api.WORKSPACE_COLORS.some((color) => color.id === first.item.color), '新增空间默认随机分配纸色')
  assert.deepEqual(
    [api.workspaceColor('paper').light, api.workspaceColor('paper').dark],
    ['#FDFAF4', '#2C2721'],
    '纸色与 Host 卡片配色一致',
  )
  const used = new Set(api.WORKSPACE_COLORS.filter((color) => color.id !== 'light-gray').map((color) => color.id))
  assert.equal(api.nextWorkspaceColorId(used), 'light-gray', '优先使用未被占用的纸色')
  const recolored = api.setWorkspaceColor(first.items, first.item.id, 'mist')
  assert.equal(recolored[0].color, 'mist')
  assert.equal(api.setWorkspaceColor(first.items, first.item.id, 'nope'), first.items, '非法颜色不写入')
  assert.equal(api.setWorkspaceColor(first.items, first.item.id, first.item.color), first.items, '颜色未变化时原样返回')
  assert.equal(api.addWorkspace(first.items, '进行时/日记').error, 'duplicate')

  const second = api.addWorkspace(first.items, '收件箱')
  const third = api.addWorkspace(second.items, '项目')
  const items = third.items
  assert.deepEqual(items.map((item) => item.path), ['进行时/日记', '收件箱', '项目'])

  const reordered = api.moveWorkspace(items, second.item.id, 0)
  assert.deepEqual(reordered.map((item) => item.path), ['收件箱', '进行时/日记', '项目'])
  assert.equal(api.moveWorkspace(items, second.item.id, 1), items, '位置没变时返回原数组')
  assert.equal(api.moveWorkspace(items, 'missing', 0), items)

  const removed = api.removeWorkspace(items, second.item.id)
  assert.deepEqual(removed.items.map((item) => item.path), ['进行时/日记', '项目'])
  assert.equal(removed.removed.index, 1)
  assert.equal(api.removeWorkspace(items, 'missing'), null)
})

test('工作空间 localStorage：按仓库隔离、坏数据与重复项安全回退', (t) => {
  const { mod, storage } = loadClient(t)
  const api = mod.__test
  api.writeStoredWorkspaces('/vault-a', [{ id: 'a', path: '进行时/日记', color: 'mist' }], 'a')
  api.writeStoredWorkspaces('/vault-b', [{ id: 'b', path: '项目', color: 'moss' }], ALL)
  assert.deepEqual(api.readStoredWorkspaces('/vault-a'), { items: [{ id: 'a', path: '进行时/日记', color: 'mist' }], activeId: 'a', primaryColor: 'paper', pinnedIds: [], companionId: null, split: 0.5 })
  assert.deepEqual(api.readStoredWorkspaces('/vault-b'), { items: [{ id: 'b', path: '项目', color: 'moss' }], activeId: ALL, primaryColor: 'paper', pinnedIds: [], companionId: null, split: 0.5 })
  assert.deepEqual(api.readStoredWorkspaces('/vault-c'), { items: [], activeId: ALL, primaryColor: 'paper', pinnedIds: [], companionId: null, split: 0.5 })

  storage.setItem(api.WORKSPACES_KEY, JSON.stringify({ version: 1, vaults: {
    '/vault-a': { items: [{ id: 'x', path: '进行时/日记' }, { id: 'y', path: '进行时/日记' }, { id: 'z', path: '.' }, { id: 'w', path: '../外面' }], activeId: 'missing' },
  } }))
  const migrated = api.readStoredWorkspaces('/vault-a')
  assert.equal(migrated.activeId, ALL, '失效 active 回到所有')
  assert.deepEqual(migrated.items.map((item) => ({ id: item.id, path: item.path })), [{ id: 'x', path: '进行时/日记' }],
    '重复/根目录/越界路径被丢弃')
  assert.ok(api.WORKSPACE_COLORS.some((color) => color.id === migrated.items[0].color), '旧记录自动补一个预设纸色')

  storage.setItem(api.WORKSPACES_KEY, '{broken')
  assert.deepEqual(api.readStoredWorkspaces('/vault-a'), { items: [], activeId: ALL, primaryColor: 'paper', pinnedIds: [], companionId: null, split: 0.5 })
  const { mod: noStorage } = loadClient(t, { storage: null })
  assert.doesNotThrow(() => noStorage.__test.writeStoredWorkspaces('/vault-a', [{ id: 'a', path: '进行时' }], 'a'))
  assert.deepEqual(noStorage.__test.readStoredWorkspaces('/vault-a'), { items: [], activeId: ALL, primaryColor: 'paper', pinnedIds: [], companionId: null, split: 0.5 })
})

test('添加弹层定位：贴着「＋」，靠右时改为右对齐，窄栏不越出标签栏', (t) => {
  const api = loadClient(t).mod.__test
  assert.equal(api.workspacePopoverLeft({ left: 60, right: 86 }, 600, 330), 60, '左侧空间足够时左对齐')
  assert.equal(api.workspacePopoverLeft({ left: 520, right: 546 }, 600, 330), 216, '靠右时右对齐')
  assert.equal(api.workspacePopoverLeft({ left: 150, right: 176 }, 300, 330), 4, '窄栏把弹层压进栏内')
  assert.equal(api.workspacePopoverLeft({ left: 150, right: 176 }, 200, 330), 4)
  assert.equal(api.workspacePopoverLeft(null, 600, 330), 4, '缺少锚点时退回左侧')
})

test('工作空间标签栏：所有/自定义标签、点击切换、右键菜单含纸色，主空间不可删除', (t) => {
  const runner = hookRunner(t), api = runner.api
  const previousDocument = globalThis.document
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument })
  const selected = [], removed = [], colors = []
  const props = {
    t: (key) => key, entries: entriesFixture(), activeId: 'ws-1', vaultPath: '/vault', notesDir: '/vault/进行时',
    request: async () => ({ folders: [] }), history: [], dragActive: false, dropId: null,
    onSelect: (id) => selected.push(id), onAdd: () => ({ ok: true }), onRemove: (id) => removed.push(id),
    onSetColor: (...args) => colors.push(args), onReorder() {}, onHoverWorkspace() {}, onClearWorkspaceHover() {}, onDropWorkspace() {},
  }
  const render = () => captureNodes(runner.render(api.components.WorkspaceBar, props))
  let nodes = render()
  let tabs = nodes.filter((node) => node.props.className === 'SN_wsTab')
  assert.equal(tabs.length, 3)
  assert.equal(tabs[0].props['data-all'], 'true')
  assert.equal(tabs[1].props['data-active'], 'true')
  assert.equal(tabs[1].props['aria-selected'], 'true')
  assert.equal(tabs[0].props.tabIndex, -1)
  assert.equal(tabs[1].props.tabIndex, 0)
  assert.equal(nodes.find((node) => node.props.className === 'SN_wsTabs').props.role, 'tablist')
  assert.equal(nodes.filter((node) => node.props.className === 'SN_wsTool SN_wsAdd').length, 1)
  for (const target of ['ws-2', ALL]) tabs.find((node) => node.props['data-workspace-id'] === target).props.onClick({})
  assert.deepEqual(selected, ['ws-2', ALL])

  const custom = tabs[1].props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 100, clientY: 120 })
  assert.equal(custom, undefined)
  let prevented = 0
  tabs[0].props.onContextMenu({ preventDefault() { prevented++ }, stopPropagation() {}, clientX: 10, clientY: 10 })
  assert.equal(prevented, 1)
  nodes = render()
  const swatches = nodes.filter((node) => node.props.className === 'SN_wsSwatch')
  assert.equal(swatches.length, api.WORKSPACE_COLORS.length)
  assert.equal(swatches[0].props['aria-label'], 'workspace.color.paper')
  assert.equal(swatches[1].props['aria-label'], 'workspace.color.light-gray')
  assert.equal(swatches[1].props.style['--sn-ws-paper'], '#F2F2F2')
  assert.equal(swatches[1].props.style['--sn-ws-paper-dark'], '#282828')
  assert.equal(api.dictionaries.zh['workspace.color.light-gray'], '浅灰')
  assert.equal(api.dictionaries.en['workspace.color.light-gray'], 'Light gray')
  assert.equal(nodes.some((node) => node.props.className === 'SN_wsMenuItem SN_wsMenuDelete'), false)
  swatches[1].props.onClick()
  assert.deepEqual(colors, [[ALL, 'light-gray']])
  assert.equal(render().some((node) => node.props.className === 'SN_wsMenu'), false)

  tabs = render().filter((node) => node.props.className === 'SN_wsTab')
  const customTab = tabs[1]
  customTab.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 100, clientY: 120 })
  nodes = render()
  assert.equal(nodes.some((node) => node.props.className === 'SN_wsMenuItem SN_wsMenuDelete'), true)
  nodes.find((node) => node.props.className === 'SN_wsMenuItem SN_wsMenuDelete').props.onClick()
  assert.deepEqual(removed, ['ws-1'])
  assert.equal(render().some((node) => node.props.className === 'SN_wsMenu'), false)

  tabs = render().filter((node) => node.props.className === 'SN_wsTab')
  const arrow = tabs[0].props.onKeyDown({ key: 'ArrowRight', preventDefault() {}, currentTarget: tabs[0] })
  assert.equal(arrow, undefined)
  assert.equal(selected.at(-1), 'ws-1', '方向键切换标签')
  assert.match(CLIENT_SOURCE, /WORKSPACE_HOLD_MS/)
  assert.match(CLIENT_SOURCE, /SN_wsMoreMenu/)
  assert.match(CLIENT_SOURCE, /SN_wsCaret/)
  assert.match(CLIENT_SOURCE, /'data-workspace-bar'/)
  assert.match(CLIENT_SOURCE, /className: 'SN_headTop'/)
  assert.doesNotMatch(CLIENT_SOURCE, /SN_headPath/)
  assert.match(CLIENT_SOURCE, /onDrop: \(event\) => dragDrop\(event, entry\)/)
  assert.match(CLIENT_SOURCE, /SN_wsColors/)
  assert.match(CLIENT_SOURCE, /WORKSPACE_COLORS\.map/)
  assert.match(CLIENT_SOURCE, /document\.addEventListener\('pointerdown', outside, true\)/)
})

test('工作空间标签拖放：仓库内所有工作空间都接收便签', (t) => {
  const api = loadClient(t).mod.__test
  const hovered = [], dropped = [], left = []
  const bar = api.components.WorkspaceBar({
    t: (key) => key,
    entries: entriesFixture(),
    activeId: 'ws-1',
    vaultPath: '/vault',
    notesDir: '/vault/进行时',
    request: async () => ({ folders: [] }),
    history: [],
    dragActive: true,
    dropId: 'ws-1',
    onSelect() {},
    onAdd: () => ({ ok: true }),
    onRemove() {},
    onReorder() {},
    onHoverWorkspace: (entry) => hovered.push(entry.id),
    onClearWorkspaceHover: () => left.push('clear'),
    onDropWorkspace: (event, entry) => dropped.push(entry.id),
  })
  const tabs = captureNodes(bar).filter((node) => node.props.className === 'SN_wsTab')
  const makeEvent = (tab) => ({
    currentTarget: { contains: () => false, node: tab },
    relatedTarget: null,
    dataTransfer: {},
    preventDefault() {},
    stopPropagation() {},
  })
  const inside = tabs.find((node) => node.props['data-workspace-id'] === 'ws-1')
  const outside = tabs.find((node) => node.props['data-workspace-id'] === 'ws-2')
  inside.props.onDragEnter(makeEvent(inside))
  inside.props.onDrop(makeEvent(inside))
  outside.props.onDragEnter(makeEvent(outside))
  outside.props.onDrop(makeEvent(outside))
  assert.deepEqual(hovered, ['ws-1', 'ws-2'])
  assert.deepEqual(dropped, ['ws-1', 'ws-2'])
  const barNode = captureNodes(bar).find((node) => node.props.className === 'SN_wsBar')
  barNode.props.onDragLeave({ currentTarget: { contains: () => false }, relatedTarget: null })
  assert.deepEqual(left, ['clear'])
})

test('顶栏：标题/版本/计数与图标同一行，第二行渲染工作空间标签栏', (t) => {
  const api = loadClient(t).mod.__test
  const noop = () => {}
  const header = api.components.PanelHeader({
    t: (key) => key,
    view: { loaded: true, version: '0.18.0' },
    filteredNotes: [],
    sortId: 'created-desc',
    sortMenu: false,
    dateMenu: false,
    dateEnabled: false,
    dateFilter: 'today',
    dateRangeLabel: 'date.today',
    includeSubfolders: true,
    subfoldersBusy: false,
    settingsOpen: false,
    dateWrapRef: { current: null },
    sortWrapRef: { current: null },
    chooseDateFilter: noop, chooseSort: noop, openDateMenu: noop, openSettings: noop, setDateMenu: noop,
    toggleDateEnabled: noop, toggleDateRealtime: noop, toggleSortMenu: noop, toggleSubfolders: noop,
    onHeaderPointerDown: noop, onHeaderPointerMove: noop, onHeaderPointerUp: noop,
    onHeaderPointerCancel: noop, onHeaderClick: noop,
    workspaceBar: { type: 'workspace-bar-marker', props: {}, children: [] },
  })
  const nodes = captureNodes(header)
  const headTop = nodes.find((node) => node.props.className === 'SN_headTop')
  assert.ok(headTop, '顶栏第一行用 SN_headTop 包住标题与图标')
  assert.deepEqual(headTop.children.map((node) => node.props.className), ['SN_headMain', 'SN_headActions'])
  assert.deepEqual(headTop.children[0].children[0].children.map((node) => node.props.className),
    ['SN_title', 'SN_headByline', 'SN_count'])
  const headerNode = nodes.find((node) => node.type === 'header')
  assert.equal(headerNode.children[0], headTop)
  assert.equal(headerNode.children[1].type, 'workspace-bar-marker', '工作空间标签栏是顶栏第二行')
  assert.equal(nodes.some((node) => node.props.className === 'SN_headPath'), false)
  assert.match(CLIENT_SOURCE, /\.SN_headTop\{display:flex;align-items:center/)
  assert.match(CLIENT_SOURCE, /\.SN_wsBar\{[^}]*min-height:34px/)
  assert.match(CLIENT_SOURCE, /\.SN_wsBar\{[^}]*margin-top:-2px/, '标签栏与标题行的空隙收紧')
  assert.match(CLIENT_SOURCE, /\.SN_wsTab\[data-active='true'\]::after\{background:var\(--sn-accent\)/)
  assert.doesNotMatch(CLIENT_SOURCE, /\.SN_wsTab\{background:var\(--sn-ws-paper/)
  assert.match(CLIENT_SOURCE, /body\[data-ds-dark-theme\] \.SN_wsSwatch\{background:var\(--sn-ws-paper-dark\)/)
})

test('useWorkspaces：加载当前仓库标签、新增/重复保护、当前空间筛选与便签迁移', async (t) => {
  const runner = hookRunner(t), api = runner.api
  const toasts = [], requests = [], updates = []
  let response = {}
  const viewRef = { current: { settings: { vaultPath: '/vault', notesDir: '/vault/进行时', folderHistory: [] }, notes: [] } }
  const props = {
    tRef: { current: (key, params) => key + (params ? JSON.stringify(params) : '') },
    t: (key) => key,
    aliveRef: { current: true },
    request: (endpoint, payload) => { requests.push([endpoint, payload]); return Promise.resolve(response) },
    viewRef: viewRef,
    updateView: (next) => { updates.push(next) },
    refreshNow: async () => {},
    pushToast: (toast) => toasts.push(toast),
    pushErrorToast: (error) => toasts.push({ error: error }),
    noteDrawerRef: { current: null },
    closeNoteDrawer: () => {},
    editingRef: { current: false },
  }
  let state = runner.render(api.hooks.useWorkspaces, props)
  assert.deepEqual(state.entries.map((entry) => entry.id), [ALL], '只有主空间时标签栏可渲染')
  assert.equal(state.entries[0].path, '进行时', '主空间指向默认工作空间')
  assert.equal(state.entries[0].label, 'workspace.main')
  assert.equal(state.entries[0].primary, true)

  const added = state.add('进行时/日记')
  assert.equal(added.ok, true)
  state = runner.render(api.hooks.useWorkspaces, props)
  assert.equal(state.activeId, added.item.id)
  assert.equal(state.activeFolder, '进行时/日记')
  assert.equal(state.captureTarget, '/vault/进行时/日记', '新建便签落到当前工作空间')
  assert.equal(state.entries[1].label, '日记')
  assert.equal(toasts.at(-1).kind, 'success')
  assert.ok(api.WORKSPACE_COLORS.some((color) => color.id === state.entries[1].color), '新增空间带一个预设纸色')
  assert.equal(state.activePaper.id, state.entries[1].color)
  assert.equal(state.activePaper.light, api.workspaceColor(state.entries[1].color).light)

  state.setColor(added.item.id, 'mist')
  state = runner.render(api.hooks.useWorkspaces, props)
  assert.equal(state.activePaper.light, '#F4F8FC', '选色后当前空间的卡片使用所选纸色')
  assert.equal(api.readStoredWorkspaces('/vault').items.find((item) => item.id === added.item.id).color, 'mist', '选色写入本地存储')

  const duplicate = state.add('进行时/日记')
  assert.equal(duplicate.ok, false, '同一文件夹不能有两个标签')
  assert.match(duplicate.error, /workspace\.error\.duplicate/)
  const root = state.add('.')
  assert.equal(root.ok, false, '仓库根已由「所有」占用')
  assert.match(root.error, /workspace\.error\.root/)
  const notesRoot = state.add('进行时')
  assert.equal(notesRoot.ok, false, '默认工作空间与「主空间」内容相同，不再单开标签')
  assert.match(notesRoot.error, /workspace\.error\.notesRoot/)

  state.add('收件箱')
  state = runner.render(api.hooks.useWorkspaces, props)
  const other = state.entries.find((entry) => entry.path === '收件箱')

  const note = { path: '/vault/进行时/a.md', relPath: '进行时/a.md' }
  viewRef.current = { settings: viewRef.current.settings, notes: [note] }
  requests.length = 0
  await state.move(note, other)
  assert.deepEqual(requests[0], ['moveNote', { path: note.path, targetDir: '/vault/收件箱' }], '仓库内其它空间也发送迁移请求')
  assert.match(toasts.at(-1).text, /workspace\.moved/)

  state.select(ALL)
  state = runner.render(api.hooks.useWorkspaces, props)
  assert.equal(state.activeFolder, '进行时', '主空间 = 默认工作空间')
  assert.equal(state.captureTarget, '/vault/进行时')
  state.select(added.item.id)
  state = runner.render(api.hooks.useWorkspaces, props)

  requests.length = 0
  updates.length = 0
  response = { note: { path: '/vault/进行时/日记/a.md', relPath: '进行时/日记/a.md', title: 'a' }, undoToken: 'undo-1' }
  await state.move(note, state.entries.find((entry) => entry.id === added.item.id))
  const moveRequest = requests.find(([endpoint]) => endpoint === 'moveNote')
  assert.deepEqual(moveRequest, ['moveNote', { path: note.path, targetDir: '/vault/进行时/日记' }])
  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0].notes.map((item) => item.path), ['/vault/进行时/日记/a.md'], '迁移后按新路径更新当前墙')
  const movedToast = toasts.at(-1)
  assert.match(movedToast.text, /workspace\.moved/)
  assert.equal(typeof movedToast.action.run, 'function', '迁移 toast 提供撤销')

  requests.length = 0
  movedToast.action.run()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(requests[0], ['undoMove', { undoToken: 'undo-1' }])

  state = runner.render(api.hooks.useWorkspaces, props)
  const removedId = added.item.id
  state.remove(removedId)
  state = runner.render(api.hooks.useWorkspaces, props)
  assert.equal(state.activeId, ALL, '删除当前空间后回到「所有」')
  assert.equal(state.entries.length, 2)
  const removedToast = toasts.at(-1)
  assert.match(removedToast.text, /workspace\.removed/)
  removedToast.action.run()
  state = runner.render(api.hooks.useWorkspaces, props)
  assert.deepEqual(state.entries.map((entry) => entry.id), [ALL, removedId, other.id], '撤销删除插回原位置')
})
