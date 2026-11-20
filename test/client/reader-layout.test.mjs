/** Client reader-layout regression coverage. */
import test from 'node:test'
import { loadClient, getTestApi, captureNodes, hookRunner, CLIENT_SOURCE } from '../../test-support/client.mjs'
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

test('v0.16.6 抽屉操作条：四个线图标在左、Obsidian 在右同一行；AI emoji 与评论标题同一行', (t) => {
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

  // AI emoji 与评论标题同一行（标题右侧），点击仍发 comment；标题本身是折叠按钮。
  const commentsHead = nodes.find((node) => node.props.className === 'SN_noteDrawerCommentsHead')
  assert.deepEqual(commentsHead.children.map((node) => node.props.className), ['SN_commentToggle', 'SN_commentEmojiRow'])
  const toggle = commentsHead.children[0]
  assert.equal(toggle.type, 'button')
  assert.equal(toggle.props['aria-expanded'], 'true')
  assert.deepEqual(captureNodes(toggle).find((node) => node.props.className === 'SN_noteViewSection').children, ['drawer.comments'])
  const emojiButtons = captureNodes(commentsHead).filter((node) => node.type === 'button' && node.props.className === 'SN_aiBtn')
  assert.deepEqual(emojiButtons.map((node) => node.props['aria-label']), ['🔥 毒舌', '🌱 落地'])
  emojiButtons[0].props.onClick({ stopPropagation() {} })
  assert.deepEqual(calls, ['archive', 'project', 'delete', 'copy', 'obsidian', 'comment:one'])

  assert.doesNotMatch(CLIENT_SOURCE, /\.SN_drawerActionRight\{/, '操作条右侧两行容器应删除')
  assert.match(CLIENT_SOURCE, /\.SN_drawerActions\{[^}]*justify-content:space-between/)
  assert.match(CLIENT_SOURCE, /\.SN_drawerActions\{[^}]*flex-wrap:nowrap/)
  assert.match(CLIENT_SOURCE, /\.SN_drawerActionLeft\{[^}]*position:relative/)
  assert.match(CLIENT_SOURCE, /\.SN_drawerActionTop\{[^}]*flex-wrap:nowrap/)
  assert.match(CLIENT_SOURCE, /\.SN_commentEmojiRow\{[^}]*justify-content:flex-end/)
  assert.match(CLIENT_SOURCE, /\.SN_commentEmojiRow \.SN_aiLabel\{[^}]*width:max-content;[^}]*writing-mode:horizontal-tb/)
  assert.match(CLIENT_SOURCE, /\.SN_drawerActionBtn:hover:not\(:disabled\) \.SN_aiLabel[^}]*opacity:1/)
  nodes = captureNodes(api.components.NoteDrawer({ ...props, drawerActions: { ...drawerActions, pending: {} } }))
  const pendingButtons = captureNodes(nodes.find((node) => node.props.className === 'SN_drawerActionTop')).filter((node) => node.type === 'button')
  assert.deepEqual(pendingButtons.map((node) => Boolean(node.props.disabled)), [true, true, true, false])
  const pendingHead = nodes.find((node) => node.props.className === 'SN_noteDrawerCommentsHead')
  const pendingEmojis = captureNodes(pendingHead).filter((node) => node.props.className === 'SN_aiBtn')
  assert.deepEqual(pendingEmojis.map((node) => node.props.disabled), [true, true], '生成期间保留预设但不允许重复提交')
  const pendingHint = captureNodes(pendingHead).find((node) => node.props.className === 'SN_pending')
  assert.equal(pendingHint.props.role, 'status', 'pending 提示应可被读屏播报')
})

test('client 源码 / 0.13.9：锁定按钮改成图钉图标', () => {
  assert.match(CLIENT_SOURCE, /function PinIcon\(props\)/, '应新增 PinIcon')
  assert.doesNotMatch(CLIENT_SOURCE, /function LockIcon/, '旧的 LockIcon 应删除')
  assert.match(CLIENT_SOURCE, /h\(PinIcon, \{ pinned: pinned \}\)/, '抽屉头部应渲染图钉')
  assert.match(CLIENT_SOURCE, /d: 'M9\.3 3\.6h5\.4l-/, '图钉应使用 pin 形状的 path')
})

test('v0.16.6 DSH 0.2.2-rc.2 窗口拖动区：盖住顶栏拖动行的浮层声明 data-window-drag-exclude', (t) => {
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
  for (const dialog of [api.components.ProjectDialog({ t: (key) => key, check: { level: '符合', reason: '可跟踪' }, name: 'x', onName() {}, onConfirm() {}, onCancel() {} }),
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

test('长标题编辑随内容折行，编辑区可滚动而保存栏在外；双击相应区域聚焦', (t) => {
  const { api, render } = hookRunner(t)
  const titleDraft = '在窄面板中会折行的完整标题'.repeat(40)
  let edited = 0, value
  const props = {
    t: (key) => key, drawer: { full: { title: titleDraft, blocks: [] } },
    titleDraft, bodyDraft: '正文', titleMode: 'filename',
    onStartEdit: () => edited++, onTitleChange: (next) => { value = next },
  }
  const get = (tree, cls) => captureNodes(tree).find((node) => node.props.className === cls)
  const view = render(api.components.NoteDrawer, props)
  get(view, 'SN_noteDrawerTitle').props.onDoubleClick()
  const editing = render(api.components.NoteDrawer, { ...props, editing: true })
  const content = get(editing, 'SN_noteEditContent')
  const title = get(content, 'SN_titleEditor')
  assert.equal(title.props.value, titleDraft, '不截断长标题')
  assert.equal(title.props.wrap, 'soft')
  assert.equal(title.props.maxLength, undefined, '允许就地修改既有的长文件名')
  assert.equal(get(content, 'SN_titleEditorFit').props['data-title'], titleDraft, '旧 WebView 使用完整标题撑高')
  assert.equal(title.props.autoFocus, true)
  assert.equal(get(content, 'SN_noteEditor').props.autoFocus, false)
  assert.equal(get(content, 'SN_noteEditBar'), undefined)
  assert.ok(get(editing, 'SN_noteEditBar'))
  assert.match(CLIENT_SOURCE, /\.SN_noteEditContent\{[^}]*overflow-y:auto/)
  assert.doesNotMatch(CLIENT_SOURCE, /\.SN_titleEditor\{[^}]*max-height/)
  title.props.onChange({ target: { value: titleDraft + '\n末尾' } })
  assert.equal(value, titleDraft + ' 末尾')
  let prevented = 0
  const enter = { key: 'Enter', preventDefault: () => prevented++ }
  title.props.onKeyDown({ ...enter, nativeEvent: { isComposing: true } })
  assert.equal(prevented, 0)
  title.props.onKeyDown(enter)
  assert.equal(prevented, 1)
  get(render(api.components.NoteDrawer, props), 'SN_noteDrawerBody').props.onDoubleClick({ target: { closest: () => null } })
  const bodyEdit = render(api.components.NoteDrawer, { ...props, editing: true })
  assert.equal(get(bodyEdit, 'SN_noteEditor').props.autoFocus, true)
  assert.equal(edited, 2)
})

test('恢复编辑位置：回到原输入框、保留反向选区与滚动，普通重渲染不重置位置', (t) => {
  const { api, render, unmount } = hookRunner(t)
  const position = { field: 'title', start: 2, end: 20, direction: 'backward', top: 30, left: 4, contentTop: 64 }
  const editPositionRef = { current: position }
  const content = { scrollTop: 0 }, events = []
  let fields
  function textarea(field, value) {
    return {
      value, selectionStart: 0, selectionEnd: 0, selectionDirection: 'none', scrollTop: 0, scrollLeft: 0,
      focus(options) {
        events.push([field, 'focus', options])
        fields[field].onFocus({ currentTarget: this })
      },
      setSelectionRange(start, end, direction) {
        events.push([field, 'selection', start, end, direction])
        Object.assign(this, { selectionStart: start, selectionEnd: end, selectionDirection: direction })
      },
    }
  }
  const title = textarea('title', '原标题太长'), body = textarea('body', '正文有两段\n看这里')
  const props = {
    t: (key) => key, drawer: { path: '/vault/note.md', full: {} }, editing: true, titleMode: 'filename',
    titleDraft: title.value, bodyDraft: body.value, editPositionRef,
    onEditPositionChange: (next) => { editPositionRef.current = next },
  }
  function draw() {
    render(api.components.NoteDrawer, props, (tree) => {
      const find = (className) => captureNodes(tree).find((node) => node.props.className === className).props
      fields = { title: find('SN_titleEditor'), body: find('SN_noteEditor'), content: find('SN_noteEditContent') }
      fields.title.ref.current = title
      fields.body.ref.current = body
      fields.content.ref.current = content
    })
  }
  draw()
  assert.equal(fields.title.autoFocus, false)
  assert.equal(fields.body.autoFocus, false)
  assert.deepEqual(events, [['title', 'focus', { preventScroll: true }], ['title', 'selection', 2, 5, 'backward']])
  assert.equal(editPositionRef.current, position, '恢复过程的 focus 事件不能覆盖原选区')
  assert.deepEqual([title.scrollTop, title.scrollLeft, content.scrollTop], [30, 4, 64])

  body.selectionStart = body.selectionEnd = 6
  fields.body.onSelect({ currentTarget: body })
  body.scrollTop = 88
  fields.body.onScroll({ currentTarget: body })
  fields.title.onScroll({ currentTarget: title })
  content.scrollTop = 128
  fields.content.onScroll({ target: content, currentTarget: content })
  assert.deepEqual(editPositionRef.current, { field: 'body', start: 6, end: 6, direction: 'none', top: 88, left: 0, contentTop: 128 })
  draw()
  assert.equal(events.length, 2, '同一编辑会话内的渲染不会抢焦点')

  unmount(); draw()
  assert.deepEqual(events.slice(2), [['body', 'focus', { preventScroll: true }], ['body', 'selection', 6, 6, 'none']])
})

test('评论区折叠仍显示四个 AI 按钮和提示，只有非零评论显示计数', (t) => {
  const api = loadClient(t).mod.__test
  let toggles = 0, selected = null
  const comment = { emoji: '😈', label: '毒舌', title: '😈 毒舌 · 2026-11-13 10:00', time: '2026-11-13 10:00', text: '评论正文' }
  const layout = { commentsCollapsed: false, commentsHeight: null, resizingComments: false, onToggle: () => toggles++ }
  const emojis = ['😈', '🌱', '✨', '💡'].map((emoji, index) => ({ id: String(index), emoji, label: `评论预设 ${index + 1}` }))
  const drawerActions = { emojis, onComment: (emoji) => { selected = emoji } }
  const tZh = (key, args) => api.dictionaries.zh[key]?.replace('{count}', args?.count)
  let nodes = captureNodes(api.components.NoteDrawer({
    t: tZh,
    drawer: { full: { title: '便签', blocks: [], comments: [comment] } },
    commentsLayout: layout,
  }))
  let section = nodes.find((node) => node.props.className === 'SN_noteDrawerComments')
  assert.equal(section.props['data-collapsed'], 'false')
  assert.equal(section.props['aria-label'], '评论（1）')
  const toggle = section.children.find((node) => node.props.className === 'SN_noteDrawerCommentsHead').children[0]
  assert.equal(typeof toggle.children[0].type, 'function', '文字左侧是折叠图标组件')
  assert.equal(toggle.children[0].props.collapsed, false)
  assert.equal(toggle.children[1].props.className, 'SN_noteViewSection')
  assert.equal(toggle.children[1].children[0], '评论（1）')
  toggle.props.onClick({ stopPropagation() {} })
  assert.equal(toggles, 1)
  assert.equal(captureNodes(section).some((node) => node.props.className === 'SN_noteDrawerCommentsBody'), true)

  nodes = captureNodes(api.components.NoteDrawer({
    t: tZh,
    drawer: { full: { title: '便签', blocks: [], comments: [] } },
    drawerActions,
    commentsLayout: { ...layout, commentsCollapsed: true, commentsHeight: 240 },
  }))
  section = nodes.find((node) => node.props.className === 'SN_noteDrawerComments')
  assert.equal(section.props['data-collapsed'], 'true')
  assert.equal(section.props.style, undefined)
  const head = section.children.find((node) => node.props.className === 'SN_noteDrawerCommentsHead')
  assert.deepEqual(head.children.map((node) => node.props.className), ['SN_commentToggle', 'SN_commentEmojiRow'])
  const collapsedToggle = head.children[0]
  assert.equal(collapsedToggle.props['aria-expanded'], 'false')
  assert.equal(collapsedToggle.children[1].children[0], '评论')
  assert.equal(section.props['aria-label'], '评论')
  assert.equal(section.children.some((node) => node && node.props.className === 'SN_noteDrawerCommentsBody'), false)
  const headNodes = captureNodes(head)
  assert.equal(headNodes.find((node) => node.props.className === 'SN_commentAIHint').children[0], 'AI 评论')
  const buttons = headNodes.filter((node) => node.props.className === 'SN_aiBtn')
  assert.equal(buttons.length, 4)
  buttons[3].props.onClick({ stopPropagation() {} })
  assert.equal(selected, emojis[3])
  const handle = section.children.find((node) => node.props.className === 'SN_noteDrawerCommentsHandle')
  assert.equal(handle.props['data-disabled'], 'true')
  assert.equal(handle.props.onPointerDown, undefined)
})

test('v0.16.7 评论区高度：拖拽手柄接线、显式高度与双击复位', (t) => {
  const api = loadClient(t).mod.__test
  const calls = []
  const layout = {
    commentsCollapsed: false, commentsHeight: 220, resizingComments: true,
    onResizeStart: () => calls.push('start'), onResizeReset: () => calls.push('reset'),
  }
  const nodes = captureNodes(api.components.NoteDrawer({
    t: (key) => key,
    drawer: { full: { title: '便签', blocks: [], comments: [] } },
    commentsLayout: layout,
  }))
  const section = nodes.find((node) => node.props.className === 'SN_noteDrawerComments')
  assert.equal(section.props.style.height, '220px')
  assert.equal(section.props.style.maxHeight, 'min(72%, calc(100% - 260px))')
  assert.equal(section.props['data-resizing'], 'true')
  const handle = section.children.find((node) => node.props.className === 'SN_noteDrawerCommentsHandle')
  assert.equal(handle.props.role, 'separator')
  assert.equal(handle.props['aria-orientation'], 'horizontal')
  assert.equal(handle.props['data-resizing'], 'true')
  handle.props.onPointerDown()
  handle.props.onDoubleClick()
  assert.deepEqual(calls, ['start', 'reset'])
  assert.match(CLIENT_SOURCE, /\.SN_noteDrawerCommentsHandle\{[^}]*cursor:row-resize/)
  assert.match(CLIENT_SOURCE, /\.SN_noteDrawerHandle,\.SN_noteDrawerCommentsHandle\{[^}]*--sn-resize-line:2px/)
  assert.match(CLIENT_SOURCE, /\.SN_noteDrawerHandle::after\{[^}]*width:var\(--sn-resize-line\)/)
  assert.match(CLIENT_SOURCE, /\.SN_noteDrawerCommentsHandle::after\{[^}]*height:var\(--sn-resize-line\)/)
  assert.match(CLIENT_SOURCE, /\.SN_noteDrawerHandle:is\(:hover,[^}]*,\.SN_noteDrawerCommentsHandle[^}]*:hover[^}]*background:var\(--sn-accent\)/)
  assert.match(CLIENT_SOURCE, /\.SN_noteDrawerComments\[data-collapsed='true'\]\{[^}]*height:auto!important/)
})

test('v0.16.7 右侧评论删除：按钮带本地化标签，点击回调序号', (t) => {
  const api = loadClient(t).mod.__test
  const deleted = []
  const comment = { emoji: '😈', label: '毒舌', time: '2026-11-13 10:00', text: '正文' }
  const nodes = captureNodes(api.components.NoteDrawer({
    t: (key) => key,
    drawer: { full: { title: '便签', blocks: [], comments: [comment, comment] } },
    commentsActions: { deletingIndex: 1, onDelete: (index, value) => deleted.push([index, value]) },
  }))
  const commentNodes = nodes.filter((node) => node.type === api.components.NoteComment)
  assert.equal(commentNodes.length, 2)
  assert.equal(commentNodes[0].props.deleteLabel, 'drawer.commentDelete')
  assert.equal(commentNodes[0].props.deleting, false)
  assert.equal(commentNodes[1].props.deleting, true)
  commentNodes[1].props.onDelete()
  assert.deepEqual(deleted.map(([index]) => index), [1])
  assert.equal(deleted[0][1], comment)

  const buttons = captureNodes(api.components.NoteComment({ ...commentNodes[0].props, deleting: false }))
    .filter((node) => node.type === 'button' && node.props.className === 'SN_commentCardDelete')
  assert.equal(buttons.length, 1)
  assert.equal(buttons[0].props['aria-label'], 'drawer.commentDelete')
  buttons[0].props.onClick({ stopPropagation() {} })
  assert.deepEqual(deleted.map(([index]) => index), [1, 0])
  assert.match(CLIENT_SOURCE, /\.SN_commentCard:hover \.SN_commentCardDelete/)
  assert.match(CLIENT_SOURCE, /@media \(hover:none\)\{\.SN_commentCardDelete\{opacity:\.55\}\}/)
})
