/** Client reader-layout regression coverage. */
import test from 'node:test'
import { loadClient, getTestApi, captureNodes, CLIENT_SOURCE } from '../../test-support/client.mjs'
import assert from 'node:assert/strict'

test('client __test：readStoredPinned / storePinned（默认 false，1/0 持久化）', (t) => {
  const { mod, storage } = loadClient(t)
  const api = getTestApi(mod)

  // 默认（没有存储项）为未锁定
  assert.equal(api.readStoredPinned(), false)

  api.storePinned(true)
  assert.equal(storage.getItem(api.PINNED_KEY), '1')
  assert.equal(api.readStoredPinned(), true)

  api.storePinned(false)
  assert.equal(storage.getItem(api.PINNED_KEY), '0')
  assert.equal(api.readStoredPinned(), false)

  // 已存的 '1' 也能读回
  storage.setItem(api.PINNED_KEY, '1')
  assert.equal(api.readStoredPinned(), true)
})

test('client __test：drawerWidthBounds 未锁定 = [320, min(960, 面板宽 × 0.8)]', (t) => {
  const api = getTestApi(loadClient(t).mod)

  assert.deepEqual(api.drawerWidthBounds(1200), { lower: 320, upper: 960 })
  assert.deepEqual(api.drawerWidthBounds(1200, false), { lower: 320, upper: 960 })
  assert.deepEqual(api.drawerWidthBounds(600, false), { lower: 320, upper: 480 })
  assert.deepEqual(api.drawerWidthBounds(900, false), { lower: 320, upper: 720 })

  for (const width of [400, 600, 900, 1200, 2000]) {
    const bounds = api.drawerWidthBounds(width, false)
    assert.equal(bounds.lower, 320)
    assert.equal(bounds.upper, Math.max(320, Math.min(960, width * 0.8)))
    assert.ok(bounds.upper >= bounds.lower)
  }
})

test('client __test：drawerWidthBounds 锁定态上限 = max(320, min(960, 面板宽 - 260))', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const expectedUpper = (width) => Math.max(320, Math.min(960, width - 260))

  assert.deepEqual(api.drawerWidthBounds(1200, true), { lower: 320, upper: 940 })
  assert.deepEqual(api.drawerWidthBounds(900, true), { lower: 320, upper: 640 })
  assert.deepEqual(api.drawerWidthBounds(600, true), { lower: 320, upper: 340 })

  for (const width of [500, 600, 800, 900, 1200, 1500]) {
    const bounds = api.drawerWidthBounds(width, true)
    assert.equal(bounds.upper, expectedUpper(width), `panelWidth=${width}`)
    assert.equal(bounds.lower, 320)
    // 锁定态上限永远 >= 320（给墙留 260px 后仍保留最小抽屉宽）
    assert.ok(bounds.upper >= 320, `锁定态 upper 应 >= 320：${bounds.upper}`)
    assert.ok(bounds.upper >= bounds.lower)
  }

  // 锁定态比 overlay 态更早触顶（给便签墙让出 260px）
  assert.ok(api.drawerWidthBounds(1200, true).upper < api.drawerWidthBounds(1200, false).upper)
})

test('v0.16.5 抽屉操作条：四个线图标在左、Obsidian 在右同一行；AI emoji 与评论标题同一行', (t) => {
  const api = loadClient(t).mod.__test, calls = []
  const emojis = [{ id: 'one', emoji: '🔥', label: '毒舌' }, { id: 'two', emoji: '🌱', label: '落地' }]
  const drawerActions = { emojis, onComment: (emoji) => calls.push('comment:' + emoji.id),
    onToggleArchive: () => calls.push('archive'), onProject: () => calls.push('project'),
    onCopy: () => calls.push('copy'), onOpenObsidian: () => calls.push('obsidian'), onDelete: () => calls.push('delete') }
  const props = { t: (key) => key, drawer: { full: { title: '便签', blocks: [] } }, drawerActions }
  let nodes = captureNodes(api.components.NoteDrawer(props))

  // 操作条一行：左 = 四个文件操作，右 = Obsidian；不再有右侧两行容器。
  const bar = nodes.find((node) => node.props.className === 'SN_drawerActions')
  assert.deepEqual(bar.children.map((node) => node.props.className), ['SN_drawerActionLeft', 'SN_mini SN_obsidianBtn'])
  const top = captureNodes(bar).find((node) => node.props.className === 'SN_drawerActionTop')
  const buttons = captureNodes(top).filter((node) => node.type === 'button')
  assert.deepEqual(buttons.map((node) => node.props['aria-label']), ['card.archive', 'card.project', 'card.delete', 'drawer.copy'])
  assert.deepEqual(buttons.map((node) => node.children[0].props.kind), ['archive', 'project', 'delete', 'copy'])
  for (const button of buttons) {
    assert.equal(button.children[0].props.size, 15)
    assert.equal(button.children[1].props.className, 'SN_aiLabel')
    assert.equal(button.children[1].props['aria-hidden'], 'true')
    assert.deepEqual(button.children[1].children, [button.props['aria-label']])
    assert.equal(button.props.title, undefined)
    button.props.onClick()
  }
  const obsidian = bar.children[1]
  assert.ok(obsidian.children[0].type.name.includes('ObsidianIcon'))
  assert.equal(obsidian.children[1].props.className, 'SN_obsidianText')
  assert.deepEqual(obsidian.children[1].children, ['card.obsidian'])
  obsidian.props.onClick()
  assert.deepEqual(calls, ['archive', 'project', 'delete', 'copy', 'obsidian'])
  assert.ok(buttons[2].props.className.includes('SN_drawerDeleteBtn'))
  assert.equal(buttons[0].props['aria-haspopup'], 'menu')
  assert.equal(captureNodes(bar).some((node) => node.type === 'button' && node.props.className === 'SN_aiBtn'), false,
    '操作条不再放 AI emoji')

  // AI emoji 与评论标题同一行（标题右侧），点击仍发 comment。
  const commentsHead = nodes.find((node) => node.props.className === 'SN_noteDrawerCommentsHead')
  assert.deepEqual(commentsHead.children.map((node) => node.props.className), ['SN_noteViewSection', 'SN_commentEmojiRow'])
  const emojiButtons = captureNodes(commentsHead).filter((node) => node.type === 'button')
  assert.deepEqual(emojiButtons.map((node) => node.props['aria-label']), ['🔥 毒舌', '🌱 落地'])
  emojiButtons[0].props.onClick({ stopPropagation() {} })
  assert.deepEqual(calls, ['archive', 'project', 'delete', 'copy', 'obsidian', 'comment:one'])

  assert.doesNotMatch(CLIENT_SOURCE, /\.SN_drawerActionRight\{/, '操作条右侧两行容器应删除')
  assert.match(CLIENT_SOURCE, /\.SN_drawerActions\{[^}]*justify-content:space-between/)
  assert.match(CLIENT_SOURCE, /\.SN_drawerActions\{[^}]*flex-wrap:nowrap/)
  assert.match(CLIENT_SOURCE, /\.SN_drawerActionLeft\{[^}]*position:relative/)
  assert.match(CLIENT_SOURCE, /\.SN_drawerActionTop\{[^}]*flex-wrap:nowrap/)
  assert.match(CLIENT_SOURCE, /\.SN_commentEmojiRow\{[^}]*justify-content:flex-end/)
  assert.match(CLIENT_SOURCE, /\.SN_commentEmojiRow\{[^}]*flex:1 1 0/)
  assert.match(CLIENT_SOURCE, /\.SN_drawerActionBtn:hover:not\(:disabled\) \.SN_aiLabel[^}]*opacity:1/)
  nodes = captureNodes(api.components.NoteDrawer({ ...props, drawerActions: { ...drawerActions, pending: {} } }))
  const pendingButtons = captureNodes(nodes.find((node) => node.props.className === 'SN_drawerActionTop')).filter((node) => node.type === 'button')
  assert.deepEqual(pendingButtons.map((node) => Boolean(node.props.disabled)), [true, true, true, false])
  const pendingHead = nodes.find((node) => node.props.className === 'SN_noteDrawerCommentsHead')
  assert.equal(captureNodes(pendingHead).some((node) => node.props.className === 'SN_aiBtn'), false, 'pending 时不再渲染 emoji 按钮')
  const pendingHint = captureNodes(pendingHead).find((node) => node.props.className === 'SN_pending')
  assert.equal(pendingHint.props.role, 'status', 'pending 提示应可被读屏播报')
})

test('client 源码 / 0.13.9：锁定按钮改成图钉图标', () => {
  assert.match(CLIENT_SOURCE, /function PinIcon\(props\)/, '应新增 PinIcon')
  assert.doesNotMatch(CLIENT_SOURCE, /function LockIcon/, '旧的 LockIcon 应删除')
  assert.match(CLIENT_SOURCE, /h\(PinIcon, \{ pinned: pinned \}\)/, '抽屉头部应渲染图钉')
  assert.match(CLIENT_SOURCE, /d: 'M9\.3 3\.6h5\.4l-/, '图钉应使用 pin 形状的 path')
})

test('v0.16.5 DSH 0.2.2-rc.2 窗口拖动区：盖住顶栏拖动行的浮层声明 data-window-drag-exclude', (t) => {
  const api = loadClient(t).mod.__test
  const drawerProps = { t: (key) => key, drawer: {}, drawerActions: { emojis: [] } }
  // 未锁定抽屉盖在面板顶部（顶栏拖动行上），必须整块 no-drag，锁定/关闭按钮才可点；
  // 锁定态是 SN_body 内的普通列、不覆盖顶栏，但两态共用同一渲染，保持声明也无害。
  for (const pinned of [false, true]) {
    const nodes = captureNodes(api.components.NoteDrawer({ ...drawerProps, pinned }))
    assert.equal(nodes.find((node) => node.type === 'aside').props['data-window-drag-exclude'], '',
      `pinned=${pinned} 的抽屉应声明拖动排除`)
  }
  // 顶部居中的 toast（撤销 / 去设置）和对话框遮罩同样落在拖动行内。
  const toasts = captureNodes(api.components.ToastStack({ toasts: [{ id: 't', kind: 'success', text: 'ok', action: { label: 'undo', run() {} } }] }))
  assert.equal(toasts.find((node) => node.props.className === 'SN_toast').props['data-window-drag-exclude'], '')
  for (const dialog of [api.components.ProjectDialog({ t: (key) => key, note: { title: 'x' }, name: '', onName() {}, onConfirm() {}, onCancel() {} }),
    api.components.ConfirmDialog({ t: (key) => key, title: 'x', text: 'y', onConfirm() {}, onCancel() {} })]) {
    assert.equal(captureNodes(dialog).find((node) => node.props.className === 'SN_dialogLayer').props['data-window-drag-exclude'], '')
  }
  // 自绘顶栏仍显式声明 drag / no-drag，不依赖 DSH 的自动排除。
  assert.match(CLIENT_SOURCE, /\.SN_head\{[^}]*-webkit-app-region:drag/)
  assert.match(CLIENT_SOURCE, /\.SN_headActions,\.SN_headActions \*\{[^}]*-webkit-app-region:no-drag/)
})

test('v0.16 阅读标签沿用便签纸色，双击提示仅复用空正文占位', (t) => {
  const api = loadClient(t).mod.__test
  let edits = 0
  const note = { title: '标题', tag: '想法', color: '#F5F9F4', darkColor: '#232B24', blocks: [] }
  const props = { t: (key) => key, drawer: { summary: note, full: note }, onStartEdit: () => edits++ }
  let nodes = captureNodes(api.components.NoteDrawer(props))
  const meta = nodes.find((node) => node.props.className === 'SN_noteDrawerMeta')
  assert.deepEqual(captureNodes(meta).filter((node) => node.type === 'span').map((node) => node.children[0]), ['想法'])
  assert.equal(nodes.find((node) => node.props.className === 'SN_noteDrawerTag').props.title, '想法')
  assert.equal(nodes.find((node) => node.type === 'aside').props.style['--sn-card-bg-dark'], note.darkColor)
  assert.equal(nodes.find((node) => node.props.className === 'SN_noteViewEmpty').children[0], 'drawer.editHint')
  nodes.find((node) => node.props.className === 'SN_noteDrawerBody').props.onDoubleClick({ target: { closest: () => null } })
  assert.equal(edits, 1)
  for (const drawer of [
    { full: { ...note, blocks: [{ kind: 'p', text: '正文' }] } },
    { full: { ...note, blocks: [{ kind: 'image', src: 'image.png' }] } },
    { summary: note, loading: true },
    { summary: note, error: '读取失败' },
  ]) {
    nodes = captureNodes(api.components.NoteDrawer({ ...props, drawer }))
    assert.equal(nodes.some((node) => node.children.includes('drawer.editHint')), false)
  }
  nodes = captureNodes(api.components.NoteDrawer({ ...props, editing: true }))
  assert.equal(nodes.some((node) => node.children.includes('drawer.editHint')), false)
  assert.ok(nodes.find((node) => node.props.className === 'SN_noteEditHint').children.includes('drawer.shortcutHint'))
})
