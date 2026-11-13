/** client: capture regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { captureNodes, deferred, flush, hookRunner, loadClient } from '../../test-support/client.mjs'

test('v0.15 输入岛：空正文失焦或 Backspace 收起，Esc 退出焦点且保留非空草稿', (t) => {
  const runner = hookRunner(t)
  const props = { enabled: true, t: (key) => key, onCreate() {}, onCreated() {}, onError() {} }
  const render = () => captureNodes(runner.render(runner.api.components.CaptureComposer, props))
  const key = (name) => ({ key: name, preventDefault() {}, stopPropagation() {} })
  let nodes = render()
  const open = () => nodes.find((node) => node.props.className === 'SN_captureTitle').props.onKeyDown(key('Tab'))
  open(); nodes = render()
  nodes.find((node) => node.type === 'form').props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: {} })
  nodes = render()
  assert.equal(nodes.some((node) => node.props.className === 'SN_captureBody'), false)
  open(); nodes = render()
  nodes.find((node) => node.props.className === 'SN_captureBody').props.onKeyDown(key('Backspace'))
  nodes = render()
  assert.equal(nodes.some((node) => node.props.className === 'SN_captureBody'), false)
  open(); nodes = render()
  nodes.find((node) => node.props.className === 'SN_captureBody').props.onChange({ target: { value: '保留的正文', style: {}, scrollHeight: 80 } })
  nodes = render()
  let blurred = 0
  const previous = globalThis.document
  globalThis.document = { activeElement: { blur() { blurred++ } } }
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous })
  nodes.find((node) => node.type === 'form').props.onKeyDown(key('Escape'))
  assert.equal(blurred, 1)
  nodes = render()
  assert.equal(nodes.find((node) => node.props.className === 'SN_captureBody').props.value, '保留的正文')
  assert.equal(nodes.find((node) => node.props.className === 'SN_captureTitle').type, 'textarea')
})

test('v0.15 Enter：卡片悬停/聚焦、按钮、阅读面板和菜单均进入输入岛，仅岛内与正文编辑放行', (t) => {
  const api = loadClient(t).mod.__test
  let focused = 0, prevented = 0, stopped = 0, visible = true
  const root = {}, html = {}, blank = {}, outside = {}, islandTitle = {}, islandBody = {}
  const control = { closest: (selector) => selector === '.SN_noteEditor' ? null : control }
  const editor = { closest: (selector) => selector === '.SN_noteEditor' ? editor : null }
  const doc = { body: root, documentElement: html }
  const options = {
    panel: { ownerDocument: doc, getClientRects: () => visible ? [{}] : [], contains: (target) => target !== outside, querySelector: () => ({}) },
    form: { contains: (target) => [islandTitle, islandBody].includes(target) }, title: { focus() { focused++ } },
  }
  const event = { key: 'Enter', target: blank, preventDefault() { prevented++ }, stopPropagation() { stopped++ } }
  for (const target of [blank, root, html, doc, control]) {
    assert.equal(api.focusCaptureOnTab({ ...event, target }, options), true, '无焦点、卡片和按钮统一聚焦输入岛，菜单打开不影响 Enter')
  }
  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
    assert.equal(api.focusCaptureOnTab({ ...event, ...extra }, options), true, '岛外 Enter 不因修饰键改为卡片/按钮操作')
  }
  for (const extra of [{ target: islandTitle }, { target: islandBody }, { target: editor }, { target: outside }, { isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { defaultPrevented: true }]) {
    assert.equal(api.focusCaptureOnTab({ ...event, ...extra }, options), false)
  }
  visible = false
  assert.equal(api.focusCaptureOnTab(event, options), false, '面板隐藏时不影响其他页面')
  visible = true
  assert.equal(api.focusCaptureOnTab(event, { ...options, busy: true }), false)
  assert.equal(focused, 9)
  assert.equal(prevented, focused)
  assert.equal(stopped, focused)
  assert.equal(api.dictionaries.zh['card.openHint'], '单击打开')
  assert.equal(api.dictionaries.en['card.openHint'], 'Click to open')
})

test('v0.15 Enter：实际输入岛 hook 在捕获阶段拦截卡片与按钮，岛内和右侧正文编辑仍可输入', (t) => {
  const runner = hookRunner(t), registrations = [], removals = []
  const previous = globalThis.document
  const doc = {
    body: {},
    addEventListener(...args) { registrations.push(args) },
    removeEventListener(...args) { removals.push(args) },
  }
  globalThis.document = doc
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous })
  const nodes = captureNodes(runner.render(runner.api.components.CaptureComposer, { enabled: true, t: (key) => key }))
  let focused = 0
  const form = { contains: (target) => target === field }
  const field = { style: {}, scrollHeight: 32, focus() { focused++ } }
  const panel = { ownerDocument: doc, contains: () => true, getClientRects: () => [{}], querySelector: () => null }
  nodes.find((node) => node.props.className === 'SN_captureDock').props.ref.current = { closest: () => panel }
  nodes.find((node) => node.type === 'form').props.ref.current = form
  nodes.find((node) => node.props.className === 'SN_captureTitle').props.ref.current = field
  const [name, listener, capture] = registrations.find(([name]) => name === 'keydown')
  assert.equal(name, 'keydown')
  assert.equal(capture, true, '必须先于卡片/按钮的 React 处理器和浏览器默认点击')
  const editor = { closest: (selector) => selector === '.SN_noteEditor' ? editor : null }
  for (const target of [doc.body, { closest: () => null }, { closest: (selector) => selector === '.SN_noteEditor' ? null : {} }]) {
    let prevented = false, stopped = false
    listener({ key: 'Enter', target, preventDefault() { prevented = true }, stopPropagation() { stopped = true } })
    assert.equal(prevented, true)
    assert.equal(stopped, true)
  }
  for (const target of [field, editor]) {
    listener({ key: 'Enter', target, preventDefault() { assert.fail('输入区 Enter 不应被拦截') }, stopPropagation() { assert.fail('输入区 Enter 不应被拦截') } })
  }
  assert.equal(focused, 3)
  runner.render(runner.api.components.CaptureComposer, { enabled: false, t: (key) => key })
  assert.ok(removals.some(([name, callback, capture]) => name === 'keydown' && callback === listener && capture === true))
})

test('快速记录：Tab 展开正文，输入法 Enter 不提交；重名失败保留草稿，成功才清空', async (t) => {
  const runner = hookRunner(t)
  let pending = deferred(), count = 0, saved
  const props = { t: (key) => key, enabled: true, onCreate: (payload) => { count++; saved = payload; return pending.promise }, onCreated() {}, onError() {} }
  const render = () => captureNodes(runner.render(runner.api.components.CaptureComposer, props))
  let nodes = render()
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onChange({ target: { value: '标题草稿' } })
  nodes = render()
  const title = nodes.find((n) => n.props.className === 'SN_captureTitle')
  title.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true }, preventDefault() { throw new Error('不应拦截输入法') } })
  assert.equal(count, 0)
  title.props.onKeyDown({ key: 'Tab', preventDefault() {}, stopPropagation() {} })
  nodes = render()
  nodes.find((n) => n.props.className === 'SN_captureBody').props.onChange({ target: { value: '正文草稿', style: {}, scrollHeight: 90 } })
  nodes = render()
  assert.equal(nodes.find((n) => n.props.className === 'SN_captureSubmitHint').children[0], 'capture.submitHint')
  const submit = nodes.find((n) => n.type === 'form').props.onSubmit
  const first = submit(), duplicate = submit()
  await flush()
  assert.equal(count, 1)
  assert.deepEqual(saved, { title: '标题草稿', body: '正文草稿', images: [] })
  pending.reject(new Error('同名便签已存在'))
  await Promise.all([first, duplicate])
  nodes = render()
  assert.equal(nodes.find((n) => n.props.className === 'SN_captureTitle').props.value, '标题草稿')
  assert.equal(nodes.find((n) => n.props.className === 'SN_captureBody').props.value, '正文草稿')
  pending = deferred()
  const second = nodes.find((n) => n.type === 'form').props.onSubmit()
  pending.resolve({ path: '/vault/标题草稿.md' })
  await second
  nodes = render()
  assert.equal(nodes.find((n) => n.props.className === 'SN_captureTitle').props.value, '')
  assert.equal(nodes.some((n) => n.props.className === 'SN_captureBody'), false)
})

test('快速记录：标题 Enter/Tab 阻止事件冒泡，避免触发宿主快捷键', async (t) => {
  const runner = hookRunner(t)
  let stopped = 0
  const pending = deferred()
  const props = { t: (key) => key, enabled: true, onCreate: () => pending.promise, onCreated() {}, onError() {} }
  const render = () => captureNodes(runner.render(runner.api.components.CaptureComposer, props))
  let nodes = render()
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onChange({ target: { value: '标题' } })
  nodes = render()
  const title = nodes.find((n) => n.props.className === 'SN_captureTitle')
  title.props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() { stopped++ } })
  assert.equal(stopped, 1)
  title.props.onKeyDown({ key: 'Tab', preventDefault() {}, stopPropagation() { stopped++ } })
  assert.equal(stopped, 2)
  pending.resolve({})
  await flush()
})

test('快速记录：正文 Shift+Tab 返回标题修改，保留正文，Tab 可再次返回正文', (t) => {
  const runner = hookRunner(t)
  let focused = '', prevented = 0, stopped = 0
  const props = { enabled: true, t: (key) => key, onCreate() {}, onCreated() {}, onError() {} }
  const render = () => {
    const nodes = captureNodes(runner.render(runner.api.components.CaptureComposer, props))
    for (const name of ['Title', 'Body']) {
      const node = nodes.find((n) => n.props.className === 'SN_capture' + name)
      if (node) node.props.ref.current = { style: {}, scrollHeight: 24, focus() { focused = name } }
    }
    return nodes
  }
  let nodes = render()
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onChange({ target: { value: '原标题' } })
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onKeyDown({ key: 'Tab', preventDefault() {}, stopPropagation() {} })
  nodes = render()
  nodes.find((n) => n.props.className === 'SN_captureBody').props.onChange({ target: { value: '保留正文', style: {}, scrollHeight: 90 } })
  nodes = render()
  const body = nodes.find((n) => n.props.className === 'SN_captureBody')
  const event = { key: 'Tab', shiftKey: true, preventDefault() { prevented++ }, stopPropagation() { stopped++ } }
  body.props.onKeyDown(event)
  assert.equal(focused, 'Title')
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onChange({ target: { value: '修改标题' } })
  nodes = render()
  assert.equal(nodes.find((n) => n.props.className === 'SN_captureTitle').props.value, '修改标题')
  assert.equal(nodes.find((n) => n.props.className === 'SN_captureBody').props.value, '保留正文')
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onKeyDown({ key: 'Tab', preventDefault() {}, stopPropagation() {} })
  assert.equal(focused, 'Body')
  for (const extra of [{ shiftKey: false }, { isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    body.props.onKeyDown({ ...event, ...extra })
  }
  assert.equal(prevented, 1)
})

test('快速记录：正文删空后自动收起为标题态并聚焦标题，重新 Tab 可再展开', (t) => {
  const runner = hookRunner(t)
  let focused = ''
  const props = { enabled: true, t: (key) => key, onCreate() {}, onCreated() {}, onError() {} }
  const render = () => {
    const nodes = captureNodes(runner.render(runner.api.components.CaptureComposer, props))
    for (const name of ['Title', 'Body']) {
      const node = nodes.find((n) => n.props.className === 'SN_capture' + name)
      if (node) node.props.ref.current = { style: {}, scrollHeight: 24, focus() { focused = name } }
    }
    return nodes
  }
  let nodes = render()
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onKeyDown({ key: 'Tab', preventDefault() {}, stopPropagation() {} })
  nodes = render()
  nodes.find((n) => n.props.className === 'SN_captureBody').props.onChange({ target: { value: '要删掉的正文', style: {}, scrollHeight: 90 } })
  nodes = render()
  assert.equal(nodes.some((n) => n.props.className === 'SN_captureBody'), true)
  nodes.find((n) => n.props.className === 'SN_captureBody').props.onChange({ target: { value: '', style: {}, scrollHeight: 68 } })
  nodes = render()
  assert.equal(nodes.some((n) => n.props.className === 'SN_captureBody'), false, '正文空后应收起正文区')
  assert.equal(nodes.some((n) => n.props.className === 'SN_captureSubmitHint'), false)
  assert.equal(nodes.some((n) => n.props.className === 'SN_captureHint'), true, '应回到标题态的 Tab 提示')
  assert.equal(focused, 'Title')
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onKeyDown({ key: 'Tab', preventDefault() {}, stopPropagation() {} })
  nodes = render()
  assert.equal(nodes.some((n) => n.props.className === 'SN_captureBody'), true, '再次 Tab 可重新展开')
})

test('快速记录：拖入图片添加预览，拖入反馈结束后复原，不执行浏览器默认打开文件', (t) => {
  const runner = hookRunner(t), errors = []
  const props = { enabled: true, t: (key) => key, onError: (error) => errors.push(error), onCreate() {}, onCreated() {} }
  const render = () => captureNodes(runner.render(runner.api.components.CaptureComposer, props))
  let nodes = render(), prevented = 0
  const file = new Blob(['image'], { type: 'image/png' })
  const event = { dataTransfer: { types: ['Files'], files: [file] }, preventDefault() { prevented++ }, stopPropagation() {} }
  nodes.find((n) => n.type === 'form').props.onDragEnter(event)
  nodes = render()
  assert.equal(nodes.find((n) => n.type === 'form').props['data-dragging'], 'true')
  nodes.find((n) => n.type === 'form').props.onDrop(event)
  nodes = render()
  assert.equal(nodes.find((n) => n.type === 'form').props['data-dragging'], 'false')
  assert.equal(nodes.filter((n) => n.props.className === 'SN_captureThumb').length, 1)
  assert.equal(prevented, 2)
  assert.equal(errors.length, 0)
})

test('快速记录：只有无焦点/面板空白处按 Tab 才进入标题，交互元素保持原生 Tab 顺序', (t) => {
  const api = loadClient(t).mod.__test
  let focused = 0, prevented = 0, modal = false, visible = true
  const body = {}, wall = {}, card = { closest: () => ({}) }, headerButton = { closest: () => ({}) }
  const input = { closest: () => ({}) }, outside = {}
  const doc = { body }
  const panel = {
    ownerDocument: doc,
    getClientRects: () => visible ? [{}] : [],
    contains: (target) => [wall, card, headerButton, input].includes(target),
    querySelector: () => modal ? {} : null,
  }
  const form = { contains: (target) => target === input }, title = { focus() { focused++ } }
  const event = { key: 'Tab', target: body, preventDefault() { prevented++ } }
  const options = { panel, form, title }
  assert.equal(api.focusCaptureOnTab(event, options), true, '无焦点时 Tab 进入标题')
  assert.equal(api.focusCaptureOnTab({ ...event, target: wall }, options), true, '面板空白处进入标题')
  for (const interactive of [card, headerButton, input]) {
    assert.equal(api.focusCaptureOnTab({ ...event, target: interactive }, options), false, '交互元素保持原生 Tab 顺序')
  }
  for (const patch of [{ shiftKey: true }, { target: outside }, { ctrlKey: true }, { isComposing: true }]) {
    assert.equal(api.focusCaptureOnTab({ ...event, ...patch }, options), false)
  }
  modal = true
  assert.equal(api.focusCaptureOnTab(event, options), false, '抽屉/模态/菜单打开时不拦截')
  modal = false; visible = false
  assert.equal(api.focusCaptureOnTab(event, options), false, '面板不可见不拦截')
  assert.equal(focused, 2)
  assert.equal(prevented, 2)
})

test('切换面板：容器获得焦点后 Enter 可进入输入岛，已在面板内则不重复抢焦点', (t) => {
  const api = loadClient(t).mod.__test
  const calls = []
  const outside = { id: 'sidebar-entry' }, inside = { id: 'panel-child' }
  const panel = {
    contains: (target) => target === inside || target === panel,
    focus(options) { calls.push(options) },
  }
  const doc = { activeElement: outside }
  assert.equal(api.focusPanelForCapture(panel, doc), true, '入口按钮仍有焦点时由面板接管')
  assert.deepEqual(calls, [{ preventScroll: true }])
  doc.activeElement = inside
  assert.equal(api.focusPanelForCapture(panel, doc), false, '焦点已在面板内不重复聚焦')
  assert.equal(calls.length, 1)
  assert.equal(api.focusPanelForCapture(null, doc), false)
  assert.equal(api.focusPanelForCapture({}, doc), false)
})

test('切换面板：StickyNotesPanel 挂载时把焦点交给面板容器（tabIndex=-1）', (t) => {
  const runner = hookRunner(t)
  const previous = globalThis.document
  let focused = 0, focusOptions = null
  globalThis.document = {
    hidden: false,
    activeElement: { tagName: 'BUTTON' },
    addEventListener() {},
    removeEventListener() {},
  }
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous })
  const panelNode = {
    contains: () => false,
    querySelector: () => null,
    focus(options) { focused++; focusOptions = options },
  }
  const panel = runner.render(runner.api.components.StickyNotesPanel, { t: (key) => key }, (node) => {
    node.props.ref.current = panelNode
  })
  assert.equal(panel.props.className, 'SN_panel')
  assert.equal(panel.props.tabIndex, -1, '面板本身可编程聚焦但不进入 Tab 顺序')
  assert.equal(focused, 1)
  assert.deepEqual(focusOptions, { preventScroll: true })
})

test('快速记录：失败提交的焦点恢复字段——正文回正文，其余回标题', (t) => {
  const api = loadClient(t).mod.__test
  const body = {}
  assert.equal(api.captureRefocusField(body, body), 'body')
  assert.equal(api.captureRefocusField({}, body), 'title')
  assert.equal(api.captureRefocusField(null, body), 'title')
  assert.equal(api.captureRefocusField(body, null), 'title')
})

test('v0.16 输入岛停用时释放附件对象 URL，重新启用仍保留文字草稿', (t) => {
  const runner = hookRunner(t), revoked = []
  t.mock.method(URL, 'createObjectURL', () => 'blob:memo-image')
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url))
  const props = { enabled: true, t: (key) => key, onError() {} }
  let nodes = captureNodes(runner.render(runner.api.components.CaptureComposer, props))
  nodes.find((node) => node.props.className === 'SN_captureTitle').props.onChange({ target: { value: '文字草稿' } })
  nodes.find((node) => node.props.type === 'file').props.onChange({ target: { files: [{ type: 'image/png', size: 1 }], value: 'image.png' } })
  nodes = captureNodes(runner.render(runner.api.components.CaptureComposer, props))
  assert.ok(nodes.some((node) => node.props.className === 'SN_captureThumb'))
  runner.render(runner.api.components.CaptureComposer, { ...props, enabled: false })
  assert.deepEqual(revoked, ['blob:memo-image'])
  nodes = captureNodes(runner.render(runner.api.components.CaptureComposer, props))
  assert.equal(nodes.some((node) => node.props.className === 'SN_captureThumb'), false)
  assert.equal(nodes.find((node) => node.props.className === 'SN_captureTitle').props.value, '文字草稿')
})
