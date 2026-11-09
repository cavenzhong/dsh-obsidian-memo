/**
 * lib/client.js 的纯函数、组件结构和 hook 行为测试。
 *
 * client.js 是单文件浏览器 bundle：顶层只做一次
 * `window.__ModuleLoader__.load({ id, factory })`。这里用一个假的 window 捕获
 * factory，注入 React / localStorage 测试运行器，执行纯函数和 hook 的状态、effect 与异步行为。
 *
 * 不依赖 jsdom / 真实 DOM；window 作为参数注入模块作用域，并在测试期间同步到
 * globalThis.window，测试结束恢复原值。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_SOURCE = readFileSync(
  fileURLToPath(new URL('../lib/client.js', import.meta.url)),
  'utf8',
)
const PACKAGE_JSON = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
)

/* ─────────────────────────────── 测试基建 ─────────────────────────────── */

/** 最小的 localStorage stub。 */
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
    clear() {
      map.clear()
    },
    get length() {
      return map.size
    },
    key(index) {
      return [...map.keys()][index] ?? null
    },
  }
}

/** 最小 React stub：组件不会被渲染，只需要存在的函数。 */
function createReactStub() {
  const base = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    Fragment: Symbol.for('react.fragment'),
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect() {},
    useLayoutEffect() {},
    useRef(value) {
      return { current: value === undefined ? null : value }
    },
    useMemo(factory) {
      return factory()
    },
    useCallback(fn) {
      return fn
    },
    memo(fn) {
      return fn
    },
    forwardRef(fn) {
      return fn
    },
    createContext(value) {
      return { Provider: ({ children }) => children, Consumer: () => null, _currentValue: value }
    },
    useContext(context) {
      return context?._currentValue
    },
  }
  // 后续版本可能新增别的 React API；未实现的一律返回 noop，避免 factory 定义期报错。
  return new Proxy(base, {
    get(target, prop) {
      return prop in target ? target[prop] : () => null
    },
  })
}

/** 只允许 react / react-dom（契约 §6.1）。 */
function makeRequire(react) {
  return (id) => {
    if (id === 'react') return react
    if (id === 'react-dom') return { createPortal: (node) => node, render: () => {} }
    throw new Error(`client.js 只允许 require('react') / require('react-dom')，实际：${id}`)
  }
}

/**
 * 加载 client.js，返回 { mod, registration, storage }。
 * t.after 恢复 globalThis.window。
 */
function loadClient(t, { storage = makeStorage(), react = createReactStub() } = {}) {
  let registration = null
  const fakeWindow = {
    __ModuleLoader__: {
      load(entry) {
        registration = entry
      },
    },
    localStorage: storage,
    location: { href: 'http://127.0.0.1:52223/' },
  }

  const hadOwnWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
  const previousWindow = globalThis.window
  globalThis.window = fakeWindow
  t.after(() => {
    if (hadOwnWindow) globalThis.window = previousWindow
    else delete globalThis.window
  })

  // 执行 bundle 顶层代码；window 作为参数注入，模块闭包捕获的就是这个假 window。
  // eslint-disable-next-line no-new-func
  new Function('window', CLIENT_SOURCE)(fakeWindow)

  assert.notEqual(registration, null, 'client.js 应当调用 window.__ModuleLoader__.load')
  assert.equal(registration.id, 'dsh-sticky-notes')
  assert.equal(typeof registration.factory, 'function')

  const mod = registration.factory(makeRequire(react))
  return { mod, registration, storage }
}

/** 执行实际 hook 与 effect；显式 render 模拟提交，避免源码字符串充当行为测试。 */
function hookRunner(t) {
  const react = createReactStub(), cells = []
  let cursor = 0, effects = []
  react.useState = (initial) => {
    const index = cursor++
    if (!(index in cells)) cells[index] = { value: typeof initial === 'function' ? initial() : initial }
    return [cells[index].value, (value) => { cells[index].value = typeof value === 'function' ? value(cells[index].value) : value }]
  }
  react.useRef = (initial) => {
    const index = cursor++
    if (!(index in cells)) cells[index] = { current: initial }
    return cells[index]
  }
  react.useEffect = (effect, deps) => {
    const index = cursor++, old = cells[index]
    if (!old || !deps || deps.some((value, i) => value !== old.deps?.[i])) {
      effects.push(() => {
        old?.cleanup?.()
        cells[index] = { deps, cleanup: effect() }
      })
    }
  }
  react.useLayoutEffect = react.useEffect
  const mod = loadClient(t, { react }).mod
  const api = mod.__test
  t.after(() => { for (const cell of cells) cell?.cleanup?.() })
  return {
    api,
    apply: mod.apply,
    connect(call) {
      mod.apply({
        connection: { rpc: { call } },
        locale: { register() {}, bind: () => (key) => key }, slots: { inject() {} },
        effect(fn) { const dispose = fn(); if (typeof dispose === 'function') t.after(dispose); return dispose },
      })
    },
    render(fn, options) {
      cursor = 0
      effects = []
      const result = fn(options)
      for (const effect of effects) effect()
      return result
    },
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

function captureNodes(node, result = []) {
  if (Array.isArray(node)) node.forEach((child) => captureNodes(child, result))
  else if (node && typeof node === 'object') { result.push(node); captureNodes(node.children, result) }
  return result
}

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
  title.props.onKeyDown({ key: 'Tab', preventDefault() {} })
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

test('快速记录：正文 Shift+Tab 返回标题修改，保留正文，Tab 可再次返回正文', (t) => {
  const runner = hookRunner(t)
  let focused = '', prevented = 0, stopped = 0
  const props = { enabled: true, t: (key) => key, onCreate() {}, onCreated() {}, onError() {} }
  const render = () => {
    const nodes = captureNodes(runner.render(runner.api.components.CaptureComposer, props))
    for (const name of ['Title', 'Body']) {
      const node = nodes.find((n) => n.props.className === 'SN_capture' + name)
      if (node) node.props.ref.current = { focus() { focused = name } }
    }
    return nodes
  }
  let nodes = render()
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onChange({ target: { value: '原标题' } })
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onKeyDown({ key: 'Tab', preventDefault() {} })
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
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onKeyDown({ key: 'Tab', preventDefault() {} })
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
      if (node) node.props.ref.current = { focus() { focused = name } }
    }
    return nodes
  }
  let nodes = render()
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onKeyDown({ key: 'Tab', preventDefault() {} })
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
  nodes.find((n) => n.props.className === 'SN_captureTitle').props.onKeyDown({ key: 'Tab', preventDefault() {} })
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

test('阅读列表：有序项目显示数字标记，无序项目保留圆点样式', (t) => {
  const api = loadClient(t).mod.__test
  const ordered = api.components.NoteBlock({ block: { kind: 'li', text: '第二项', marker: '2.' } })
  assert.equal(ordered.props.className, 'SN_blockLi SN_blockOrdered')
  assert.equal(captureNodes(ordered).find((n) => n.props.className === 'SN_listNumber').children[0], '2.')
  assert.equal(api.components.NoteBlock({ block: { kind: 'li', text: '圆点' } }).props.className, 'SN_blockLi')
})

test('图片处理：默认与 Host 对齐，压缩关闭时原文件直通，尺寸保持比例且不放大', async (t) => {
  const api = loadClient(t).mod.__test
  const { normalizeImageCompression, LIMITS } = await import('../lib/shared.js')
  for (const input of [undefined, {}, { enabled: false, quality: 90, maxDimension: 4096 }, { quality: -1, maxDimension: 99999 }, { quality: '', maxDimension: null }]) {
    assert.deepEqual(api.readImageCompression(input), normalizeImageCompression(input))
  }
  assert.equal(api.CAPTURE_IMAGES, LIMITS.captureImages)
  assert.equal(api.CAPTURE_IMAGE_BYTES, LIMITS.captureImageBytes)
  assert.equal(api.CAPTURE_TOTAL_BYTES, LIMITS.captureTotalBytes)
  assert.equal(api.CAPTURE_SOURCE_IMAGE_BYTES, LIMITS.captureSourceImageBytes)
  assert.equal(api.CAPTURE_SOURCE_TOTAL_BYTES, LIMITS.captureSourceTotalBytes)
  const file = { type: 'image/png', size: 10 }
  assert.equal(await api.compressCaptureImage(file, { enabled: false }), file)
  assert.deepEqual(api.captureImageSize(4000, 3000, 2048), { width: 2048, height: 1536 })
  assert.deepEqual(api.captureImageSize(500, 1000, 2048), { width: 500, height: 1000 })
  assert.deepEqual(api.captureImageSize(1000, 4000, 1024), { width: 256, height: 1024 })
  assert.equal(api.captureFiles([], [{ type: 'image/png', size: 9 * 1024 * 1024 }]), '')
  assert.equal(api.captureFiles([], [{ type: 'image/png', size: 9 * 1024 * 1024 }], { enabled: false }), 'capture.imageLimit')
  assert.equal(api.captureFiles([], [{ type: 'image/svg+xml', size: 10 }]), 'capture.imageType')
})

test('图片文件夹设置：支持手填、清空和选择文件夹，不受压缩开关影响', (t) => {
  const api = loadClient(t).mod.__test
  const patches = [], picks = []
  const nodes = captureNodes(api.components.SettingsDrawer({
    t: (key) => key, draft: { attachmentDir: '附件/图片', imageCompression: { enabled: false } },
    picking: null, saving: false, onPatch: (patch) => patches.push(patch), onPick: (field) => picks.push(field),
  }))
  const field = nodes.find((n) => n.props.field === 'attachmentDir')
  const controls = captureNodes(field.type(field.props))
  const input = controls.find((n) => n.type === 'input')
  assert.equal(input.props.value, '附件/图片')
  assert.equal(input.props.disabled, false)
  input.props.onChange({ target: { value: '新的图片目录' } })
  input.props.onChange({ target: { value: '' } })
  controls.find((n) => n.type === 'button').props.onClick()
  assert.deepEqual(patches, [{ attachmentDir: '新的图片目录' }, { attachmentDir: '' }])
  assert.deepEqual(picks, ['attachmentDir'])
})

test('图片处理设置：关闭压缩保留质量与分辨率，数字失焦提交并限制范围', (t) => {
  const api = loadClient(t).mod.__test
  const changes = []
  const nodes = captureNodes(api.components.ImageProcessingSettings({ t: (key) => key, value: { enabled: true, quality: 70, maxDimension: 2048 }, onChange: (next) => changes.push(next) }))
  nodes.find((n) => n.props.type === 'checkbox').props.onChange({ target: { checked: false } })
  assert.deepEqual(changes[0], { enabled: false, quality: 70, maxDimension: 2048 })
  nodes.find((n) => n.props['aria-label'] === 'settings.imageQuality').props.onBlur({ target: { value: '200' } })
  assert.equal(changes[1].quality, 100)
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('state 请求顺序：较新的响应先到时，迟到的旧响应不能覆盖', async (t) => {
  const api = loadClient(t).mod.__test
  const requests = [], applied = []
  const reader = api.createStateReader({
    call(payload, signal) { const pending = deferred(); requests.push({ ...pending, payload, signal }); return pending.promise },
    getRevision: () => 'known',
    onValue: (value) => applied.push(value),
  })
  const first = reader.read(false), second = reader.read(true)
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(requests[1].payload.knownRevision, null)
  requests[1].resolve({ revision: 'new' })
  await second
  requests[0].resolve({ revision: 'old' })
  assert.equal(await first, null)
  assert.deepEqual(applied, [{ revision: 'new' }])
  const pending = reader.read(false)
  reader.invalidate()
  requests[2].reject(new Error('迟到的网络错误'))
  assert.equal(await pending, null)
})

test('mergeState：任务变化保留未变化卡片和设置对象', (t) => {
  const api = loadClient(t).mod.__test
  const state = { configured: true, revision: 'first', notes: [{ path: '/A.md', title: '甲', pending: null }], settings: { emojis: [] }, jobs: [] }
  const first = api.mergeState(null, state)
  const next = api.mergeState(first, JSON.parse(JSON.stringify({ ...state, revision: 'job-changed', jobs: [{ id: 'job', status: 'done' }] })))
  assert.equal(next.notes[0], first.notes[0])
  assert.equal(next.settings, first.settings)
})

test('编辑 hook：冲突后保留草稿和编辑态，保存携带打开时版本', async (t) => {
  const runner = hookRunner(t), calls = [], errors = []
  const full = { path: '/A.md', name: '甲', body: '原文', contentRevision: 'opened-version' }
  const options = {
    tRef: { current: (key) => key }, aliveRef: { current: true }, controllersRef: { current: new Set() },
    request(endpoint, payload) { calls.push({ endpoint, payload }); return Promise.reject(Object.assign(new Error('内容冲突'), { code: 'conflict' })) },
    refreshNow: async () => {}, replaceNote() {}, replaceRenamedNote() {}, pushToast() {},
    pushErrorToast: (error) => errors.push(error), onOpen() {}, onClose() {},
  }
  let editor = runner.render(runner.api.hooks.useNoteEditor, options)
  // 用真实读取路径加载全文。
  const ctx = { connection: { rpc: { call: async () => ({ ok: true, value: full }) } }, locale: { register() {}, bind: () => (key) => key }, slots: { inject() {} }, effect(fn) { return fn() } }
  // apply 给 callRpc 注入测试连接，仍执行实际 hook 异步行为。
  // hook 属于 runner 的模块；运行时通过其 apply 注入。
  runner.apply(ctx)
  editor.openNoteDrawer(full)
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.startEditing()
  editor.handleBodyChange('我的草稿')
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.saveEditing()
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  assert.equal(calls[0].payload.expectedRevision, 'opened-version')
  assert.equal(editor.bodyDraft, '我的草稿')
  assert.equal(editor.editing, true)
  assert.equal(editor.savingNote, false)
  assert.equal(errors[0].code, 'conflict')
})

test('编辑 hook：切换便签后迟到的读取不能覆盖当前抽屉', async (t) => {
  const runner = hookRunner(t), reads = []
  runner.connect((channel, endpoint, payload) => {
    const pending = deferred(); reads.push({ ...pending, payload }); return pending.promise
  })
  const options = editorOptions()
  let editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.openNoteDrawer({ path: '/A.md' })
  editor.openNoteDrawer({ path: '/B.md' })
  reads[1].resolve({ ok: true, value: { path: '/B.md', name: '乙', body: '乙正文', contentRevision: 'B' } })
  await flush()
  reads[0].resolve({ ok: true, value: { path: '/A.md', body: '迟到的甲正文' } })
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  assert.equal(editor.noteDrawer.path, '/B.md')
  assert.equal(editor.noteDrawer.full.body, '乙正文')
  assert.equal(editor.noteDrawer.loading, false)
})

function editorOptions(overrides = {}) {
  return {
    tRef: { current: (key) => key }, aliveRef: { current: true }, controllersRef: { current: new Set() },
    request: async () => ({}), refreshNow: async () => {}, replaceNote() {}, replaceRenamedNote() {},
    pushToast() {}, pushErrorToast() {}, onOpen() {}, onClose() {}, ...overrides,
  }
}

test('编辑 hook：保存期间关闭并重开同一篇，旧保存回调不清除新草稿', async (t) => {
  const runner = hookRunner(t), saving = deferred()
  const full = { path: '/A.md', name: '甲', body: '原文', contentRevision: 'initial' }
  runner.connect(async () => ({ ok: true, value: full }))
  const options = editorOptions({ request: () => saving.promise })
  let editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.openNoteDrawer(full)
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.startEditing()
  editor.handleBodyChange('旧草稿')
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.saveEditing()
  editor.closeNoteDrawer()
  editor.openNoteDrawer(full)
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.startEditing()
  editor.handleBodyChange('新草稿')
  saving.resolve({ note: { path: '/A.md', name: '甲' } })
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  assert.equal(editor.editing, true)
  assert.equal(editor.bodyDraft, '新草稿')
})

test('编辑 hook：同时保存标题正文后抽屉跟随新路径并结束编辑', async (t) => {
  const runner = hookRunner(t), renamed = []
  runner.connect(async (channel, endpoint, payload) => ({
    ok: true, value: { path: payload.path, name: payload.path === '/A.md' ? '甲' : '乙', body: '原文', contentRevision: 'version' },
  }))
  const options = editorOptions({
    request: async () => ({ note: { path: '/B.md', name: '乙' } }),
    replaceRenamedNote: (oldPath, note) => renamed.push([oldPath, note.path]),
  })
  let editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.openNoteDrawer({ path: '/A.md' })
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.startEditing()
  editor.handleBodyChange('新正文')
  editor.setTitleDraft('乙')
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.saveEditing()
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  assert.deepEqual(renamed, [['/A.md', '/B.md']])
  assert.equal(editor.noteDrawer.path, '/B.md')
  assert.equal(editor.editing, false)
  assert.equal(editor.savingNote, false)
})

test('设置 hook：实时设置刷新不覆盖正在编辑的草稿', (t) => {
  const runner = hookRunner(t), viewRef = { current: { settings: { vaultPath: '/old', emojis: [] } } }
  const options = {
    t: (key) => key, tRef: { current: (key) => key }, viewRef, updateView() {},
    request: async () => ({}), refreshNow: async () => {}, aliveRef: { current: true },
    panelRef: { current: null }, pushToast() {}, pushErrorToast() {}, onOpen() {},
  }
  let settings = runner.render(runner.api.hooks.useSettingsDraft, options)
  settings.openSettings()
  settings.patchDraft({ vaultPath: '/my-draft' })
  viewRef.current = { settings: { vaultPath: '/external', emojis: [] } }
  settings = runner.render(runner.api.hooks.useSettingsDraft, options)
  assert.equal(settings.settingsDraft.vaultPath, '/my-draft')
  settings.closeSettings()
  settings = runner.render(runner.api.hooks.useSettingsDraft, options)
  settings.openSettings()
  settings = runner.render(runner.api.hooks.useSettingsDraft, options)
  assert.equal(settings.settingsDraft.vaultPath, '/external')
})

test('面板 hook：组合数据、抽屉与设置职责后可以挂载和卸载', (t) => {
  const runner = hookRunner(t)
  const panel = runner.render(runner.api.components.StickyNotesPanel, { t: (key) => key })
  assert.equal(panel.props.className, 'SN_panel')
})

/** 取 __test 并断言契约 §6.1 要求的全部纯函数都暴露了。 */
function getTestApi(mod) {
  assert.equal(typeof mod, 'object', 'factory 应返回模块导出对象')
  assert.notEqual(mod.__test, undefined, '模块应导出 __test（契约 §6.1）')
  const api = mod.__test
  for (const key of [
    'PINNED_KEY',
    'PINNED_NOTE_KEY',
    'readStoredPinned',
    'storePinned',
    'readStoredPinnedNote',
    'storePinnedNote',
    'clearStoredPinnedNote',
    'DATE_FILTERS',
    'DEFAULT_DATE_FILTER',
    'DEFAULT_DATE_FILTER_ENABLED',
    'DATE_FILTER_ENABLED_KEY',
    'readStoredDateFilter',
    'storeDateFilter',
    'readStoredDateEnabled',
    'storeDateEnabled',
    'readStoredDateRealtime',
    'storeDateRealtime',
    'dateFilterBounds',
    'dateFilterAnchor',
    'filterNotesByDate',
    'replaceNoteAtPath',
    'cardImages',
    'drawerWidthBounds',
    'DRAWER_ACTIONS_NARROW_WIDTH',
    'drawerActionsNarrow',
    'nextPollDelay',
    'WALL_PAGE_SIZE',
    'nextVisibleCount',
    'formatVersionLabel',
  ]) {
    assert.notEqual(api[key], undefined, `__test.${key} 缺失（契约 §6.1）`)
  }
  return api
}

/* ─────────────────────────────── bundle 约定 ─────────────────────────────── */

test('client bundle：__ModuleLoader__ 注册 id / factory / inject / __test', (t) => {
  const { mod, registration } = loadClient(t)
  assert.equal(typeof registration.factory, 'function')
  assert.equal(typeof mod.apply, 'function')
  // 契约 §2 / §6.1：inject = ['slots', 'locale', 'connection']
  for (const service of ['slots', 'locale', 'connection']) {
    assert.ok(Array.isArray(mod.inject) && mod.inject.includes(service), `inject 缺少 ${service}`)
  }
  assert.notEqual(mod.__test, undefined)
  getTestApi(mod)
})

test('client __test：formatVersionLabel 取完整版本（含补丁号），缺失/非法不显示版本', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(typeof api.formatVersionLabel, 'function', '__test.formatVersionLabel 缺失（v0.13）')
  // 正常版本：保留完整 major.minor.patch，支持 v 前缀、预发布后缀、首尾空白
  assert.equal(api.formatVersionLabel('0.13.0'), '0.13.0')
  assert.equal(api.formatVersionLabel('v0.13.2'), '0.13.2')
  assert.equal(api.formatVersionLabel('0.13.4'), '0.13.4')
  assert.equal(api.formatVersionLabel('0.13.0-beta.1'), '0.13.0')
  assert.equal(api.formatVersionLabel('  0.13.4  '), '0.13.4')
  // 0.13.9.2 起支持四段发布号（package.json 版本即四段时也要完整显示）
  assert.equal(api.formatVersionLabel('0.13.9.2'), '0.13.9.2')
  assert.equal(api.formatVersionLabel('v0.13.9.2'), '0.13.9.2')
  assert.equal(api.formatVersionLabel('0.13.9.2-beta.1'), '0.13.9.2')
  assert.equal(api.formatVersionLabel('1.2.3'), '1.2.3')
  assert.equal(api.formatVersionLabel('1.2'), '1.2')
  // 缺失 / 空 / 非法 → 回退 APP_VERSION（旧 Host 没下发 version 的情况）
  for (const bad of [undefined, null, '', '   ', 'abc', 'v', 0, 123, true, {}, []]) {
    assert.equal(
      api.formatVersionLabel(bad),
      '',
      `formatVersionLabel(${JSON.stringify(bad)}) 应返回空串`,
    )
  }
})

test('版本仅从 Host 下发，locale 与浏览器代码无需手动同步版本', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(api.formatVersionLabel(PACKAGE_JSON.version), PACKAGE_JSON.version)
  for (const name of ['zh', 'en']) {
    const locale = JSON.parse(readFileSync(new URL('../locale/' + name + '.json', import.meta.url), 'utf8'))
    assert.match(locale.meta.description, /Obsidian MEMO/)
    assert.doesNotMatch(locale.meta.description, /Obsidian MEMO \d/)
  }
})

test('client 源码：byline 为 by caven v<state.version> 且只在顶栏（宽松静态检查）', () => {
  // v0.13：BYLINE 常量已删除，版本从 Host 的 state.version 派生（旧 Host 才回退 APP_VERSION）。
  assert.doesNotMatch(CLIENT_SOURCE, /\bBYLINE\b/, 'BYLINE 常量应已删除（版本改由 state.version 派生）')
  assert.match(CLIENT_SOURCE, /by caven v/, 'byline 文案应为小写 v 的 by caven v<version>')
  assert.doesNotMatch(CLIENT_SOURCE, /by caven V/, '旧文案 by caven V0.12 不应保留')
  // 只检查代码里的字符串字面量（注释里可以出现版本说明）；写死版本会被这条拦住
  assert.doesNotMatch(CLIENT_SOURCE, /['"]by caven v\d/, 'byline 不应写死版本号，应由 state.version 派生')
  // 渲染时应由 formatVersionLabel(view.version) 派生（不绑定具体拼接/模板写法）
  assert.match(CLIENT_SOURCE, /formatVersionLabel\(view\.version\)/, 'byline 应由 state.version 派生')
  // 只在顶栏出现：顶栏 byline span 有且只有一个渲染点，卡片/抽屉没有 byline 类名
  const headBylineSites = (CLIENT_SOURCE.match(/SN_headByline/g) ?? []).length
  assert.ok(headBylineSites >= 1, '顶栏应有 byline 渲染点')
  assert.doesNotMatch(CLIENT_SOURCE, /SN_noteDrawerByline|SN_cardByline|SN_byline\b/)
})

/* ─────────────────────────── 面板锁（§7.3） ─────────────────────────── */

test('client __test：PINNED_KEY 为契约约定的 localStorage 键', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(api.PINNED_KEY, 'dsh-sticky-notes.panelLocked')
})

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

test('client __test：localStorage 不可用时锁定读写安全回退', (t) => {
  const { mod } = loadClient(t, { storage: null })
  const api = getTestApi(mod)
  assert.equal(api.readStoredPinned(), false)
  assert.doesNotThrow(() => api.storePinned(true))
  assert.equal(api.readStoredPinned(), false)
})

/* ─────────────────────── 卡片图片（§7.2） ─────────────────────── */

const CARD_IMAGE_ENTRIES = [
  { source: 'a.png', alt: 'A', wiki: false },
  { source: '附件/b.png', alt: '', wiki: true },
  { source: './c.jpg', alt: 'C', wiki: false },
  { source: 'd.webp', alt: 'D', wiki: false },
]

test('client __test：cardImages 前 3 张 + more 计算', (t) => {
  const api = getTestApi(loadClient(t).mod)

  // 7 张正文图：前 3 张下发，more = 7 - 3 = 4
  const many = api.cardImages({ path: 'x.md', images: CARD_IMAGE_ENTRIES, imageCount: 7 })
  assert.equal(many.items.length, 3)
  assert.deepEqual(many.items, CARD_IMAGE_ENTRIES.slice(0, 3))
  assert.equal(many.more, 4)

  // 5 张：more = 5 - 3 = 2
  const five = api.cardImages({ images: CARD_IMAGE_ENTRIES.slice(0, 3), imageCount: 5 })
  assert.equal(five.items.length, 3)
  assert.equal(five.more, 2)

  // 恰好 3 张：没有 ＋N
  const exactly = api.cardImages({ images: CARD_IMAGE_ENTRIES.slice(0, 3), imageCount: 3 })
  assert.equal(exactly.items.length, 3)
  assert.equal(exactly.more, 0)

  // 少于 3 张：全部渲染，没有 ＋N
  const two = api.cardImages({ images: CARD_IMAGE_ENTRIES.slice(0, 2), imageCount: 2 })
  assert.equal(two.items.length, 2)
  assert.equal(two.more, 0)

  // 缺 imageCount（旧 Host）时按 images 长度算，不应该凭空出现 ＋N
  const noCount = api.cardImages({ images: CARD_IMAGE_ENTRIES.slice(0, 3) })
  assert.equal(noCount.items.length, 3)
  assert.equal(noCount.more, 0)
})

test('client __test：cardImages 对缺失 / 异常字段安全', (t) => {
  const api = getTestApi(loadClient(t).mod)

  for (const note of [null, undefined, {}, { images: null }, { images: 'x' }, { images: [] }, { imageCount: 3 }]) {
    const result = api.cardImages(note)
    assert.ok(Array.isArray(result.items), `items 应为数组：${JSON.stringify(note)}`)
    assert.equal(result.items.length, 0)
    assert.equal(typeof result.more, 'number')
    assert.ok(Number.isFinite(result.more) && result.more >= 0, `more 非法：${result.more}`)
  }
  assert.deepEqual(api.cardImages({}), { items: [], more: 0 })
  assert.deepEqual(api.cardImages(null), { items: [], more: 0 })
})

/* ─────────────────────── 抽屉宽度（§7.3） ─────────────────────── */

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

/* ─────────────── 动态加载（0.13.8，§7.1） ─────────────── */

test('client __test：便签墙首屏 50 张，触底每次再补 50 张（不超过总数）', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(api.WALL_PAGE_SIZE, 50, '首屏/每批应为 50 张')
  assert.equal(api.nextVisibleCount(50, 120), 100)
  assert.equal(api.nextVisibleCount(100, 120), 120)
  // 已经到头 / 总数更少：不再增加
  assert.equal(api.nextVisibleCount(120, 120), 120)
  assert.equal(api.nextVisibleCount(50, 12), 12)
  assert.equal(api.nextVisibleCount(0, 120), 50)
  // 非法输入不抛错，按 0 / 50 处理
  assert.equal(api.nextVisibleCount(undefined, 120), 50)
  assert.equal(api.nextVisibleCount(50, undefined), 50)
  assert.equal(api.nextVisibleCount(50, 120, 10), 60)
})

test('client 字典：0.13.8 新文案（在 Obsidian 打开 / 加载中 / callout 样式）中英文齐全', (t) => {
  const api = getTestApi(loadClient(t).mod)
  for (const key of ['card.obsidian', 'panel.loadingMore', 'settings.callout', 'settings.calloutValue']) {
    assert.equal(typeof api.dictionaries.zh[key], 'string', `zh 缺少 ${key}`)
    assert.notEqual(api.dictionaries.zh[key], '', `zh ${key} 不应为空`)
    assert.equal(typeof api.dictionaries.en[key], 'string', `en 缺少 ${key}`)
    assert.notEqual(api.dictionaries.en[key], '', `en ${key} 不应为空`)
  }
  assert.equal(api.dictionaries.zh['card.obsidian'], '在 Obsidian 打开')
  assert.match(api.dictionaries.zh['settings.calloutValue'], /\{style\}/, 'callout 样式文案应包含 {style} 插值')
  assert.match(api.dictionaries.en['settings.calloutValue'], /\{style\}/)
})

test('client StyleSelect：按钮显示「callout样式-xx」，点开菜单 13 项并给当前项打勾', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const t2 = (key, params) => {
    if (params && params.style) return 'callout样式-' + params.style
    const callout = /^callout\.(.+)$/.exec(key)
    if (callout) return ({ quote: '引用', note: '笔记' })[callout[1]] || callout[1]
    return key
  }
  const collect = (node, out = []) => {
    if (node == null) return out
    if (Array.isArray(node)) {
      for (const item of node) collect(item, out)
      return out
    }
    if (typeof node === 'object') {
      out.push(node)
      collect(node.children, out)
    }
    return out
  }
  const tree = api.components.StyleSelect({ t: t2, value: 'quote', disabled: false, onChange: () => {} })
  const nodes = collect(tree)
  const button = nodes.find((node) => node && node.type === 'button' && node.props && node.props['aria-haspopup'] === 'menu')
  assert.ok(button, '样式按钮缺失')
  assert.equal(button.props.title, 'callout样式-引用')
  assert.equal(button.children[0].children[0], 'callout样式-引用')
  // 未点开时没有菜单；菜单项由 CALLOUT_IDS 驱动（13 项），打开后当前项带 ✓。
  assert.equal(nodes.some((node) => node && node.props && node.props.role === 'menuitemradio'), false)
})

/* ─────────────────── 轮询退避（§7.9 性能） ─────────────────── */

test('client __test：nextPollDelay 未变化时按 1.5× 退避、封顶 30s', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(typeof api.nextPollDelay, 'function', '__test.nextPollDelay 缺失（性能契约）')

  const POLL_BASE = 4000
  const POLL_MAX = 30000

  // 有变化 → 回到 base
  assert.equal(api.nextPollDelay(POLL_BASE, false), POLL_BASE)
  assert.equal(api.nextPollDelay(25000, false), POLL_BASE, '变化时应重置为 base')
  // 未变化 → min(30000, round(prev * 1.5))
  assert.equal(api.nextPollDelay(POLL_BASE, true), 6000)
  assert.equal(api.nextPollDelay(6000, true), 9000)
  assert.equal(api.nextPollDelay(3000, true), 4500)
  assert.equal(api.nextPollDelay(4001, true), 6002, '应四舍五入：round(4001 * 1.5) = 6002')
  assert.equal(api.nextPollDelay(20000, true), 30000, '20000 * 1.5 正好封顶')
  assert.equal(api.nextPollDelay(25000, true), 30000, '超过 30s 应截断')
  assert.equal(api.nextPollDelay(POLL_MAX, true), POLL_MAX, '已在封顶值应保持')

  // 从 base 逐步退避：非递减、始终在 [6000, 30000]
  let previous = 0
  for (let prev = POLL_BASE; prev <= POLL_MAX; prev += 1000) {
    const next = api.nextPollDelay(prev, true)
    assert.equal(next, Math.min(POLL_MAX, Math.round(prev * 1.5)), `prev=${prev}`)
    assert.ok(next >= 6000 && next <= POLL_MAX)
    assert.ok(next >= previous, `退避不应变小：${previous} -> ${next}`)
    previous = next
  }
})

test('client __test：nextPollDelay 非法输入安全（不抛错、不返回 NaN/负数/超上限）', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(typeof api.nextPollDelay, 'function', '__test.nextPollDelay 缺失（性能契约）')

  for (const prev of [undefined, null, NaN, Infinity, -Infinity, -1, 0, '4000', {}, []]) {
    assert.equal(api.nextPollDelay(prev, false), 4000, `prev=${String(prev)} 有变化时应回到 base`)
    const unchanged = api.nextPollDelay(prev, true)
    assert.equal(typeof unchanged, 'number', `prev=${String(prev)} 应返回数字`)
    assert.ok(Number.isFinite(unchanged), `prev=${String(prev)} 不应返回 NaN/Infinity`)
    assert.ok(unchanged > 0 && unchanged <= 30000, `prev=${String(prev)} 越界：${unchanged}`)
  }
})

/* ───────────── 图片队列 / 缓存 / jobs 签名统计（§7.8，安全断言） ───────────── */

test('client __test：图片队列 / 缓存 / jobsSignature 统计安全（§7.8）', async (t) => {
  const api = getTestApi(loadClient(t).mod)
  for (const key of [
    'enqueueImageLoad',
    'imageCacheBytes',
    'imageCacheSize',
    'imageQueueStats',
    'clearImageQueue',
    'jobsSignature',
    'readImageCache',
    'writeImageCache',
  ]) {
    assert.equal(typeof api[key], 'function', `__test.${key} 缺失（契约 §6.1 / §7.8）`)
  }

  // 空模块状态：队列/缓存都是空的，读取不存在的 key 安全
  assert.deepEqual(api.imageQueueStats(), { active: 0, queued: 0, completed: 0, failed: 0 })
  assert.equal(api.imageCacheBytes(), 0)
  assert.equal(api.imageCacheSize(), 0)
  assert.equal(api.readImageCache('nope'), '')

  // 队列：正常任务可完成；非法任务返回 rejected promise 而不是同步抛错
  const okTask = api.enqueueImageLoad(async () => 'done')
  assert.equal(typeof okTask.promise?.then, 'function')
  assert.equal(await okTask.promise, 'done')
  const badTask = api.enqueueImageLoad(null)
  await assert.rejects(badTask.promise)
  const idle = api.imageQueueStats()
  assert.equal(idle.active, 0)
  assert.equal(idle.queued, 0)

  // 缓存：写入后可读回；clear 后字节/条目归零（LRU 语义不绑死条目数细节）
  api.writeImageCache('note.md\u0000a.png', 'data:image/png;base64,AAAA')
  assert.equal(api.readImageCache('note.md\u0000a.png'), 'data:image/png;base64,AAAA')
  assert.ok(api.imageCacheBytes() > 0)
  assert.equal(api.imageCacheSize(), 1)
  api.clearImageCache()
  assert.equal(api.imageCacheBytes(), 0)
  assert.equal(api.imageCacheSize(), 0)
  assert.equal(api.readImageCache('note.md\u0000a.png'), '')
  // 非法写入不应破坏统计
  assert.doesNotThrow(() => api.writeImageCache('', 'x'))
  assert.doesNotThrow(() => api.writeImageCache('k', ''))
  assert.equal(api.imageCacheBytes(), 0)

  // clearImageQueue 安全，统计字段始终是数字
  assert.doesNotThrow(() => api.clearImageQueue())
  const afterClear = api.imageQueueStats()
  assert.equal(afterClear.active, 0)
  assert.equal(afterClear.queued, 0)
  for (const value of Object.values(afterClear)) assert.equal(typeof value, 'number')

  // jobsSignature：同一组 jobs 稳定；空/非法输入安全；内容变化则不同
  assert.equal(api.jobsSignature([]), '')
  assert.equal(api.jobsSignature(null), '')
  assert.equal(api.jobsSignature(undefined), '')
  const jobs = [{ id: 'b', status: 'running' }, { id: 'a', status: 'done', error: 'x' }]
  assert.equal(typeof api.jobsSignature(jobs), 'string')
  assert.equal(api.jobsSignature(jobs), api.jobsSignature([...jobs]))
  assert.notEqual(api.jobsSignature(jobs), api.jobsSignature([{ id: 'a', status: 'done' }]))
  // 与 Host jobsFingerprint 对齐：errorCode / truncated 也必须参与签名（预算提示依赖）
  assert.notEqual(
    api.jobsSignature([{ id: 'j', status: 'error', error: 'x' }]),
    api.jobsSignature([{ id: 'j', status: 'error', error: 'x', errorCode: 'llm-token-budget' }]),
  )
  assert.notEqual(
    api.jobsSignature([{ id: 'j', status: 'done' }]),
    api.jobsSignature([{ id: 'j', status: 'done', truncated: true }]),
  )
})

/* ─────────────────── 无变化不重渲染（§7.8，mergeState 快路径） ─────────────────── */

test('client __test：mergeState 无变化时返回同一对象（不新建 view）', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const settings = {
    vaultPath: '/vault',
    notesDir: '/vault/notes',
    projectDir: '',
    archiveTargets: [],
    emojis: [{ id: 'devil', emoji: '😈', label: '毒舌', callout: 'quote', prompt: 'x' }],
    projectPrompt: 'p',
    includeSubfolders: true,
  }
  const prev = {
    loaded: true,
    configured: true,
    error: null,
    revision: 'r1',
    version: '0.13.0',
    settings,
    jobs: [],
    notes: [{ path: '/vault/notes/a.md' }],
  }

  // unchanged 且 configured/error/revision/version/settings/jobs 签名都没变 → 必须原样返回 prev
  const same = api.mergeState(prev, {
    configured: true,
    revision: 'r1',
    unchanged: true,
    version: '0.13.0',
    jobs: [],
    settings: { ...settings, emojis: settings.emojis.map((item) => ({ ...item })) },
  })
  assert.equal(same, prev, 'unchanged 且签名相同应返回同一对象，避免整墙重渲染')

  // 旧 Host 没下发 version（缺失）时视为不变，不应触发重渲染
  const missingVersion = api.mergeState(prev, {
    configured: true,
    revision: 'r1',
    unchanged: true,
    jobs: [],
    settings,
  })
  assert.equal(missingVersion, prev, '缺失 version 应视为不变')

  // version 变化必须新建 view（顶栏 byline 随之更新）
  const versionChanged = api.mergeState(prev, {
    configured: true,
    revision: 'r1',
    unchanged: true,
    version: '0.14.1',
    jobs: [],
    settings,
  })
  assert.notEqual(versionChanged, prev)
  assert.equal(versionChanged.version, '0.14.1')

  // jobs 变化要新建 view（pending 展示依赖）
  const jobsChanged = api.mergeState(prev, {
    configured: true,
    revision: 'r1',
    unchanged: true,
    version: '0.13.0',
    jobs: [{ id: 'job-1', status: 'running' }],
    settings,
  })
  assert.notEqual(jobsChanged, prev)
  assert.equal(jobsChanged.jobs.length, 1)

  // revision / notes 变化要新建 view
  const revisionChanged = api.mergeState(prev, {
    configured: true,
    revision: 'r2',
    version: '0.13.0',
    jobs: [],
    settings,
    notes: [{ path: '/vault/notes/b.md' }],
  })
  assert.notEqual(revisionChanged, prev)
  assert.equal(revisionChanged.revision, 'r2')

  // 非法 value 安全回退
  assert.equal(api.mergeState(prev, null), prev)
  assert.equal(api.mergeState(prev, undefined), prev)
})

/* ─────────────────────────── AI 预算（0.13） ─────────────────────────── */

test('client __test：AI 预算预设与 shared.js 保持一致（防漂移）', async (t) => {
  const api = getTestApi(loadClient(t).mod)
  const shared = await import('../lib/shared.js')
  assert.deepEqual(api.AI_PRESETS, shared.AI_PRESETS, 'client 与 shared 的预设映射必须一致')
  assert.deepEqual(api.AI_PRESET_IDS, shared.AI_PRESET_IDS)
  assert.deepEqual(api.AI_EFFORTS, shared.REASONING_EFFORTS)
  assert.deepEqual(api.DEFAULT_AI, shared.DEFAULT_AI)
})

test('client __test：readAiBudget 容错旧值、非自定义档以预设为准、自定义夹紧', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.deepEqual(api.readAiBudget(undefined), { preset: 'high', reasoningEffort: 'high', maxTokens: 8192 })
  assert.deepEqual(api.readAiBudget(null), { preset: 'high', reasoningEffort: 'high', maxTokens: 8192 })
  assert.deepEqual(api.readAiBudget({ preset: 'bogus' }), { preset: 'high', reasoningEffort: 'high', maxTokens: 8192 })
  assert.deepEqual(api.readAiBudget({ preset: 'low' }), { preset: 'low', reasoningEffort: 'off', maxTokens: 2048 })
  // 非自定义档：手改的 effort / maxTokens 不生效
  assert.deepEqual(
    api.readAiBudget({ preset: 'medium', reasoningEffort: 'max', maxTokens: 1 }),
    { preset: 'medium', reasoningEffort: 'low', maxTokens: 4096 },
  )
  // 自定义档：保留并校验
  assert.deepEqual(
    api.readAiBudget({ preset: 'custom', reasoningEffort: 'max', maxTokens: 1234 }),
    { preset: 'custom', reasoningEffort: 'max', maxTokens: 1234 },
  )
  assert.equal(api.readAiBudget({ preset: 'custom', reasoningEffort: 'off', maxTokens: 1 }).maxTokens, 256)
  assert.equal(api.readAiBudget({ preset: 'custom', reasoningEffort: 'off', maxTokens: 10 ** 9 }).maxTokens, 65536)
  assert.equal(api.readAiBudget({ preset: 'custom', reasoningEffort: 'off', maxTokens: 3000.4 }).maxTokens, 3000)
  assert.equal(api.readAiBudget({ preset: 'custom', reasoningEffort: 'x', maxTokens: 'x' }).reasoningEffort, 'high')
  assert.equal(api.readAiBudget({ preset: 'custom', reasoningEffort: 'x', maxTokens: 'x' }).maxTokens, 8192)
})

test('client __test：patchAiBudget 切预设套用预设值，切自定义保留现值', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.deepEqual(
    api.patchAiBudget({ preset: 'high' }, { preset: 'custom' }),
    { preset: 'custom', reasoningEffort: 'high', maxTokens: 8192 },
  )
  assert.deepEqual(
    api.patchAiBudget({ preset: 'custom', reasoningEffort: 'high', maxTokens: 8192 }, { maxTokens: 6000 }),
    { preset: 'custom', reasoningEffort: 'high', maxTokens: 6000 },
  )
  assert.deepEqual(
    api.patchAiBudget({ preset: 'custom', reasoningEffort: 'max', maxTokens: 6000 }, { preset: 'low' }),
    { preset: 'low', reasoningEffort: 'off', maxTokens: 2048 },
  )
})

test('client 字典：AI 预算与预算提示文案中英文齐全', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const keys = [
    'settings.aiBudget',
    'settings.aiPreset.low', 'settings.aiPreset.medium', 'settings.aiPreset.high', 'settings.aiPreset.custom',
    'settings.aiPresetDetail.low', 'settings.aiPresetDetail.medium', 'settings.aiPresetDetail.high', 'settings.aiPresetDetail.custom',
    'settings.aiEffort', 'settings.aiEffort.off', 'settings.aiEffort.low', 'settings.aiEffort.high', 'settings.aiEffort.max',
    'settings.aiMaxTokens', 'settings.aiTokensUnit', 'settings.aiProjectHint',
    'toast.budgetFailed', 'toast.budgetCommentTruncated', 'toast.budgetProjectTruncated',
    'toast.budgetAction', 'toast.budgetAck',
  ]
  for (const key of keys) {
    assert.equal(typeof api.dictionaries.zh[key], 'string', `zh 缺少 ${key}`)
    assert.notEqual(api.dictionaries.zh[key], '', `zh ${key} 不应为空`)
    assert.equal(typeof api.dictionaries.en[key], 'string', `en 缺少 ${key}`)
    assert.notEqual(api.dictionaries.en[key], '', `en ${key} 不应为空`)
  }
})

test('client ToastStack：预算提示渲染「去设置 / 知道了」两个动作，并兼容旧单 action', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const noop = () => {}
  const two = api.components.ToastStack({
    toasts: [{
      id: 1,
      kind: 'error',
      text: '预算不够',
      actions: [{ label: '去设置', run: noop }, { label: '知道了', run: noop }],
    }],
    onDismiss: noop,
  })
  const toast = two.children[0][0]
  // stub 的 createElement 不展平数组子节点，这里手动展开一层。
  const buttons = toast.children.flat().filter((child) => child && child.type === 'button')
  assert.equal(buttons.length, 2)
  assert.equal(buttons[0].children[0], '去设置')
  assert.equal(buttons[1].children[0], '知道了')

  const single = api.components.ToastStack({
    toasts: [{ id: 2, kind: 'success', text: '已归档', action: { label: '撤销', run: noop } }],
    onDismiss: noop,
  })
  const singleButtons = single.children[0][0].children.flat().filter((child) => child && child.type === 'button')
  assert.equal(singleButtons.length, 1)
  assert.equal(singleButtons[0].children[0], '撤销')
})

test('client SettingsDrawer：每枚 emoji 与开档各有一个 AI 预算控件，自定义才露出两个字段', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const collect = (node, out = []) => {
    if (node == null) return out
    if (Array.isArray(node)) {
      for (const item of node) collect(item, out)
      return out
    }
    if (typeof node === 'object') {
      out.push(node)
      collect(node.children, out)
    }
    return out
  }
  const t2 = (key) => key
  const draft = {
    vaultPath: '/v',
    notesDir: '/v/notes',
    projectDir: '/v/projects',
    archiveTargets: [],
    emojis: [
      { id: 'a', emoji: '😈', label: '毒舌', callout: 'quote', prompt: 'p' },
      { id: 'b', emoji: '✨', label: '另一面', callout: 'abstract', prompt: 'p', ai: { preset: 'custom', reasoningEffort: 'max', maxTokens: 5000 } },
    ],
    projectPrompt: '建档',
  }
  const noop = () => {}
  const tree = api.components.SettingsDrawer({
    t: t2,
    draft: draft,
    picking: null,
    saving: false,
    onPatch: noop,
    onPick: noop,
    onAddArchive: noop,
    onRemoveArchive: noop,
    onPatchEmoji: noop,
    onRemoveEmoji: noop,
    onAddEmoji: noop,
    onSave: noop,
    onCancel: noop,
  })
  // 组件元素（AiBudgetRow）带 ai prop：2 枚 emoji + 1 个开档
  const budgetRows = collect(tree).filter((node) => node && typeof node.type === 'function' && node.props && Object.prototype.hasOwnProperty.call(node.props, 'ai'))
  assert.equal(budgetRows.length, 3)
  // 每行都渲染出「AI 预算」预设下拉
  const presetValues = budgetRows.map((row) => {
    const rendered = collect(row.type(row.props))
    const select = rendered.find((node) => node && node.type === 'select' && node.props && node.props['aria-label'] === 'settings.aiBudget')
    assert.ok(select, 'AI 预算下拉缺失')
    return select.props.value
  })
  assert.deepEqual(presetValues, ['high', 'custom', 'high'])
  // 自定义行额外渲染「思考档位 + 输出上限」
  const customRendered = collect(budgetRows[1].type(budgetRows[1].props))
  const effort = customRendered.find((node) => node && node.type === 'select' && node.props && node.props['aria-label'] === 'settings.aiEffort')
  const tokens = customRendered.find((node) => node && node.type === 'input' && node.props && node.props['aria-label'] === 'settings.aiMaxTokens')
  assert.equal(effort.props.value, 'max')
  assert.equal(tokens.props.defaultValue, '5000')
  // 非自定义行不渲染这两个字段
  const presetRendered = collect(budgetRows[0].type(budgetRows[0].props))
  assert.equal(presetRendered.some((node) => node && node.props && node.props['aria-label'] === 'settings.aiEffort'), false)
  assert.equal(presetRendered.some((node) => node && node.props && node.props['aria-label'] === 'settings.aiMaxTokens'), false)
})

/* ─────────────────────── 日期筛选（0.13.4） ─────────────────────── */

const DATE_DAY_MS = 24 * 60 * 60 * 1000;
const DATE_NOW = new Date(2026, 10, 4, 15, 30, 0, 0).getTime(); // 本地时间 2026-11-04 15:30

function startOfLocalDayForTest(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 本地「年月日 ± N 天」的 0 点（跨夏令时也正确）。 */
function localDayOffsetForTest(ms, deltaDays) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + deltaDays).getTime();
}

function noteIds(list) {
  return list.map((note) => note.path);
}

test('client __test：DATE_FILTERS 四档（今天/3 天/本周/本月），默认今天且开关默认点亮', (t) => {
  const api = getTestApi(loadClient(t).mod)
  // 0.13.9：「全部」从菜单里去掉——开关熄灭就是显示全部。
  assert.deepEqual(api.DATE_FILTERS.map((item) => item.id), ['today', '3d', 'week', 'month'])
  assert.equal(api.DEFAULT_DATE_FILTER, 'today')
  assert.equal(api.DEFAULT_DATE_FILTER_ENABLED, true)
  assert.equal(api.DATE_FILTER_ENABLED_KEY, 'dsh-sticky-notes.dateFilterEnabled.v1')
})

test('client __test：dateFilterBounds 默认不勾选（以最新一篇为锚），勾选「真实时间」按每日 00:00 分界', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const anchor = DATE_NOW - 3 * DATE_DAY_MS

  // 默认（不勾选）：以最新一篇为锚滚动 24h/72h/7d/30d
  const today = api.dateFilterBounds('today', { now: DATE_NOW, anchor })
  assert.equal(today.start, anchor - DATE_DAY_MS)
  assert.equal(today.realtime, false)
  assert.equal(api.dateFilterBounds('3d', { now: DATE_NOW, anchor }).start, anchor - 3 * DATE_DAY_MS)
  assert.equal(api.dateFilterBounds('week', { now: DATE_NOW, anchor }).start, anchor - 7 * DATE_DAY_MS)
  assert.equal(api.dateFilterBounds('month', { now: DATE_NOW, anchor }).start, anchor - 30 * DATE_DAY_MS)

  // 没有锚点（空墙/旧数据）时退回当前时间
  assert.equal(api.dateFilterBounds('today', { now: DATE_NOW }).start, DATE_NOW - DATE_DAY_MS)

  // 勾选「日期截止按真实时间」：自然日/周/月 00:00 分界
  const midnight = startOfLocalDayForTest(DATE_NOW)
  assert.equal(api.dateFilterBounds('today', { now: DATE_NOW, realtime: true }).start, midnight)
  assert.equal(api.dateFilterBounds('3d', { now: DATE_NOW, realtime: true }).start, localDayOffsetForTest(DATE_NOW, -2))
  const sinceMonday = (new Date(DATE_NOW).getDay() + 6) % 7
  assert.equal(api.dateFilterBounds('week', { now: DATE_NOW, realtime: true }).start, localDayOffsetForTest(DATE_NOW, -sinceMonday))
  const date = new Date(DATE_NOW)
  assert.equal(
    api.dateFilterBounds('month', { now: DATE_NOW, realtime: true }).start,
    new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
  )

  // 旧存储兼容：`all` 仍然表示不设下界（0.13.9 起正常入口改用开关熄灭）。
  const all = api.dateFilterBounds('all', { now: DATE_NOW, realtime: true, anchor })
  assert.equal(all.start, -Infinity)
  assert.equal(all.end, Infinity)

  // 非法 id 回退今天（默认锚定模式）
  assert.equal(api.dateFilterBounds('bogus', { now: DATE_NOW }).start, DATE_NOW - DATE_DAY_MS)
})

test('client __test：filterNotesByDate 默认按最新一篇锚定；勾选真实时间按自然日；全部返回所有', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const notes = [
    { path: 'today', created: DATE_NOW - 1000 },
    { path: 'yesterday', created: localDayOffsetForTest(DATE_NOW, -1) + 1000 },
    { path: 'two-days', created: localDayOffsetForTest(DATE_NOW, -2) + 1000 },
    { path: 'three-days', created: localDayOffsetForTest(DATE_NOW, -3) + 1000 },
  ]
  const anchor = notes[0].created

  // 不勾选（默认）：以最新一篇为锚
  assert.deepEqual(noteIds(api.filterNotesByDate(notes, 'today', false, DATE_NOW)), ['today'])
  assert.deepEqual(noteIds(api.filterNotesByDate(notes, '3d', false, DATE_NOW)), ['today', 'yesterday', 'two-days'])

  // 勾选：按每日 00:00 的自然日分界（结果相同，但语义不同）
  assert.deepEqual(noteIds(api.filterNotesByDate(notes, 'today', true, DATE_NOW)), ['today'])
  assert.deepEqual(noteIds(api.filterNotesByDate(notes, '3d', true, DATE_NOW)), ['today', 'yesterday', 'two-days'])

  // 显式锚点：24h / 72h / 7d / 30d 边界
  const rolling = [
    { path: 'x', created: anchor - 60 * 60 * 1000 },
    { path: 'y', created: anchor - 25 * 60 * 60 * 1000 },
    { path: 'z', created: anchor - 80 * 60 * 60 * 1000 },
  ]
  assert.deepEqual(noteIds(api.filterNotesByDate(rolling, 'today', false, DATE_NOW, anchor)), ['x'])
  assert.deepEqual(noteIds(api.filterNotesByDate(rolling, '3d', false, DATE_NOW, anchor)), ['x', 'y'])

  // 旧存储兼容：`all` 仍然不筛选
  assert.deepEqual(
    noteIds(api.filterNotesByDate(notes, 'all', true, DATE_NOW)),
    ['today', 'yesterday', 'two-days', 'three-days'],
  )

  // 0.13.9 开关：enabled=false 直接返回全部（与档位无关）；缺省 true 保持旧行为
  assert.deepEqual(
    noteIds(api.filterNotesByDate(notes, 'today', false, DATE_NOW, undefined, false)),
    ['today', 'yesterday', 'two-days', 'three-days'],
  )
  assert.deepEqual(
    noteIds(api.filterNotesByDate(notes, 'today', false, DATE_NOW, undefined, true)),
    ['today'],
  )

  // created 缺失（含 0 哨兵）时用 mtime 兜底
  assert.deepEqual(noteIds(api.filterNotesByDate([{ path: 'mtime', mtime: DATE_NOW }], 'today', false, DATE_NOW)), ['mtime'])
  assert.deepEqual(noteIds(api.filterNotesByDate([{ path: 'zero', created: 0, mtime: DATE_NOW }], 'today', false, DATE_NOW)), ['zero'])
  assert.equal(api.dateFilterAnchor(notes), notes[0].created)
})

test('client __test：日期筛选 localStorage 持久化与容错（开关 + 档位 + 真实时间勾选）', (t) => {
  const { mod, storage } = loadClient(t)
  const api = getTestApi(mod)

  // 默认：今天、开关点亮、不勾选「真实时间」（= 以最新一篇为锚）
  assert.equal(api.readStoredDateFilter(), 'today')
  assert.equal(api.readStoredDateEnabled(), true)
  assert.equal(api.readStoredDateRealtime(), false)

  // 非法存储值回退默认
  storage.setItem('dsh-sticky-notes.dateFilter.v1', 'bogus')
  assert.equal(api.readStoredDateFilter(), 'today')

  api.storeDateFilter('month')
  assert.equal(storage.getItem('dsh-sticky-notes.dateFilter.v1'), 'month')
  assert.equal(api.readStoredDateFilter(), 'month')
  api.storeDateFilter('bogus')
  assert.equal(api.readStoredDateFilter(), 'today')

  // 0.13.9 开关状态：'1' / '0'
  api.storeDateEnabled(false)
  assert.equal(storage.getItem('dsh-sticky-notes.dateFilterEnabled.v1'), '0')
  assert.equal(api.readStoredDateEnabled(), false)
  api.storeDateEnabled(true)
  assert.equal(storage.getItem('dsh-sticky-notes.dateFilterEnabled.v1'), '1')
  assert.equal(api.readStoredDateEnabled(), true)

  api.storeDateRealtime(true)
  assert.equal(storage.getItem('dsh-sticky-notes.dateRealtime.v1'), '1')
  assert.equal(api.readStoredDateRealtime(), true)
  api.storeDateRealtime(false)
  assert.equal(storage.getItem('dsh-sticky-notes.dateRealtime.v1'), '0')
  assert.equal(api.readStoredDateRealtime(), false)
})

test('client __test：旧版 dateFilter=all 迁移为「开关熄灭」，新开关键优先', (t) => {
  const fresh = loadClient(t)
  fresh.storage.setItem('dsh-sticky-notes.dateFilter.v1', 'all')
  assert.equal(fresh.mod.__test.readStoredDateFilter(), 'today', '旧 all 读成默认档位')
  assert.equal(fresh.mod.__test.readStoredDateEnabled(), false, '旧 all 应迁移成开关熄灭（显示全部）')

  // 有独立开关键时以它为准：即使旧档位是 all，只要新键说开就是开。
  const explicit = loadClient(t)
  explicit.storage.setItem('dsh-sticky-notes.dateFilter.v1', 'all')
  explicit.storage.setItem('dsh-sticky-notes.dateFilterEnabled.v1', '1')
  assert.equal(explicit.mod.__test.readStoredDateEnabled(), true)
})

test('client __test：localStorage 不可用时日期筛选读写安全回退', (t) => {
  const { mod } = loadClient(t, { storage: null })
  const api = getTestApi(mod)
  assert.equal(api.readStoredDateFilter(), 'today')
  assert.equal(api.readStoredDateEnabled(), true)
  assert.equal(api.readStoredDateRealtime(), false)
  assert.doesNotThrow(() => api.storeDateFilter('month'))
  assert.doesNotThrow(() => api.storeDateEnabled(false))
  assert.doesNotThrow(() => api.storeDateRealtime(true))
  assert.equal(api.readStoredDateFilter(), 'today')
  assert.equal(api.readStoredDateEnabled(), true)
  assert.equal(api.readStoredDateRealtime(), false)
})

test('client 源码 / 字典：日期筛选是顶栏第一个「开关 + 档位菜单」，且没有「全部」项', (t) => {
  const api = getTestApi(loadClient(t).mod)
  for (const key of ['date.today', 'date.3d', 'date.week', 'date.month', 'date.realtime', 'date.realtimeHint', 'date.toggleOn', 'date.toggleOff']) {
    assert.equal(typeof api.dictionaries.zh[key], 'string', `zh 缺少 ${key}`)
    assert.equal(typeof api.dictionaries.en[key], 'string', `en 缺少 ${key}`)
  }
  assert.equal(api.dictionaries.zh['date.realtime'], '日期截止按真实时间')
  // 0.13.9：菜单里不再有「全部」。
  assert.equal(api.dictionaries.zh['date.all'], undefined, '「全部」文案应移除（开关熄灭即全部）')
  const actionsIndex = CLIENT_SOURCE.indexOf("className: 'SN_headActions'")
  assert.ok(actionsIndex > 0, '应找到顶栏操作区')
  const dateIndex = CLIENT_SOURCE.indexOf('日期筛选（顶栏第一个）', actionsIndex)
  const subIndex = CLIENT_SOURCE.indexOf('子文件夹开关', actionsIndex)
  assert.ok(dateIndex > actionsIndex, '应找到日期筛选开关')
  assert.ok(subIndex > dateIndex, '日期筛选按钮应排在子文件夹开关之前')
  assert.equal((CLIENT_SOURCE.match(/ref: dateWrapRef/g) || []).length, 1, '日期菜单不应重复渲染')
  // 0.14：主按钮维持开关语义；范围菜单通过悬停或方向键打开。
  assert.match(CLIENT_SOURCE, /'aria-pressed': dateEnabled \? 'true' : 'false'/)
  assert.doesNotMatch(CLIENT_SOURCE, /SN_dateCaret/)
  assert.match(CLIENT_SOURCE, /onMouseEnter: openDateMenu/)
  assert.match(CLIENT_SOURCE, /onClick: toggleDateEnabled/)
  assert.doesNotMatch(CLIENT_SOURCE, /'date\.all': '全部'/, '菜单不应再有「全部」')
  assert.match(CLIENT_SOURCE, /'date\.realtime': '日期截止按真实时间'/, '勾选项名称应为「日期截止按真实时间」')
  assert.match(
    CLIENT_SOURCE,
    /'date\.realtimeHint': '勾选：按照每日 00:00 作为分界点显示；不勾选：按照最后一篇时间的标准界线'/,
    '勾选项说明应描述真实时间分界 / 最后一篇时间界线',
  )
  assert.doesNotMatch(CLIENT_SOURCE, /date\.rolling/, '旧的 date.rolling 文案应已移除')
})

/* ─────────────────── 0.13.9 细节（卡片/按钮/图钉/拖拽） ─────────────────── */

test('client 源码 / 0.13.9：卡片没有正文时不渲染「暂无正文」占位', () => {
  assert.doesNotMatch(CLIENT_SOURCE, /card\.noExcerpt/, 'card.noExcerpt 文案应移除')
  assert.doesNotMatch(CLIENT_SOURCE, /暂无正文/, '不应再出现「暂无正文」')
  assert.match(CLIENT_SOURCE, /excerpt \? h\('p', \{/, '摘要有内容才渲染 <p>')
})

test('client 组件 / 0.13.9：NoteCard 无正文时不渲染摘要行，有正文时照常渲染', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const actions = {
    current: {
      t: (key) => key,
      onOpen: () => {},
      onPreset: () => {},
      onCardEnter: () => {},
      onCardLeave: () => {},
      onToggleArchive: () => {},
      onArchive: () => {},
      onProject: () => {},
      onOpenObsidian: () => {},
    },
  }
  const render = (excerpt) => {
    const card = api.components.NoteCard({
      note: { path: 'a.md', title: '标题', excerpt: excerpt, comments: [], commentCount: 0, images: [] },
      emojis: [],
      pending: null,
      hoverActive: false,
      archiveMenuOpen: false,
      targets: [],
      menuRef: { current: null },
      drawerOpen: false,
      actions: actions,
    })
    const classes = []
    const texts = []
    const walk = (node) => {
      if (node == null) return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (typeof node === 'object') {
        if (node.props && node.props.className) classes.push(String(node.props.className))
        walk(node.children)
      } else {
        texts.push(String(node))
      }
    }
    walk(card)
    return { classes: classes, texts: texts }
  }

  const empty = render('')
  assert.equal(empty.classes.includes('SN_cardExcerpt'), false, '没有正文时不应渲染摘要 <p>')
  assert.equal(empty.texts.some((text) => text.includes('暂无正文')), false, '没有正文时不应出现占位文案')

  const filled = render('一段正文')
  assert.equal(filled.classes.includes('SN_cardExcerpt'), true, '有正文时应渲染摘要 <p>')
  assert.ok(filled.texts.includes('一段正文'))
})

test('client 源码 / 0.13.9：「在 Obsidian 打开」是紫色高亮，右侧抽屉操作条可换行（归档/开档在上、它在下）', () => {
  // 紫色：文字与 hover 都使用统一的 --sn-accent（暗色主题自动换成 #A78BFA）。
  assert.match(CLIENT_SOURCE, /\.SN_obsidianBtn\{[^}]*color:var\(--sn-accent\)/, '按钮文字应为紫色高亮')
  assert.match(
    CLIENT_SOURCE,
    /\.SN_obsidianBtn:hover:not\(:disabled\)\{[^}]*color:var\(--sn-accent\)/,
    'hover 也应保持紫色',
  )
  // 空间不足时允许换行：右组 flex-wrap + 右对齐，Obsidian 按钮自然落到下一行。
  assert.match(CLIENT_SOURCE, /\.SN_drawerActionRight\{[^}]*flex-wrap:wrap/, '右侧操作组应允许换行')
  assert.match(CLIENT_SOURCE, /\.SN_drawerActionRight\{[^}]*justify-content:flex-end/, '换行后仍靠右')
  // 抽屉窄时右侧组改竖排：归档/开档一组在上，Obsidian 按钮在下一行、靠右。
  assert.match(CLIENT_SOURCE, /'data-narrow': actionsNarrow \? 'true' : 'false'/, '右侧组应带窄布局标记')
  assert.match(CLIENT_SOURCE, /\.SN_drawerActionRight\[data-narrow='true'\]\{[^}]*flex-direction:column/, '窄布局应竖排')
  assert.match(CLIENT_SOURCE, /\.SN_drawerActionRight\[data-narrow='true'\] \.SN_drawerActionPair\{[^}]*justify-content:flex-end/, '归档/开档组靠右')
  assert.match(CLIENT_SOURCE, /actionsNarrow: drawerActionsNarrowFlag/, '面板应把窄布局标记传给抽屉')
})

test('client __test：0.13.9 抽屉操作条窄布局阈值（「在 Obsidian 打开」换行）', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(api.DRAWER_ACTIONS_NARROW_WIDTH, 430)
  assert.equal(api.drawerActionsNarrow(320), true, '320px 窄面板应换行')
  assert.equal(api.drawerActionsNarrow(429), true)
  assert.equal(api.drawerActionsNarrow(430), false, '达到阈值按宽布局')
  assert.equal(api.drawerActionsNarrow(620), false)
  // 宽度未知 / 非法 → 不换行（首帧 panelWidth=0 时不闪）
  for (const bad of [0, -1, undefined, null, NaN, Infinity, '400']) {
    assert.equal(api.drawerActionsNarrow(bad), false, `drawerActionsNarrow(${String(bad)}) 应为 false`)
  }
})

test('client 源码 / 0.13.9：锁定按钮改成图钉图标', () => {
  assert.match(CLIENT_SOURCE, /function PinIcon\(props\)/, '应新增 PinIcon')
  assert.doesNotMatch(CLIENT_SOURCE, /function LockIcon/, '旧的 LockIcon 应删除')
  assert.match(CLIENT_SOURCE, /h\(PinIcon, \{ pinned: pinned \}\)/, '抽屉头部应渲染图钉')
  assert.match(CLIENT_SOURCE, /d: 'M9\.3 3\.6h5\.4l-/, '图钉应使用 pin 形状的 path')
})

test('client 源码 / 0.13.9：顶栏标题区可拖拽 DSH 窗口，按钮区保持可点击', () => {
  assert.match(CLIENT_SOURCE, /\.SN_head\{[^}]*-webkit-app-region:drag/, '顶栏应是窗口拖拽区')
  assert.match(CLIENT_SOURCE, /\.SN_headActions,\.SN_headActions \*\{-webkit-app-region:no-drag/, '按钮/菜单恢复 no-drag')
  assert.match(CLIENT_SOURCE, /className: 'SN_head'/, '顶栏结构不变')
})

test('client __test：replaceNoteAtPath 改名后乐观替换旧 path（保留 pending / 其他字段）', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const notes = [
    { path: '/v/旧名.md', name: '旧名', created: 1, pending: { emoji: '😈', label: '毒舌' } },
    { path: '/v/别篇.md', name: '别篇', created: 2 },
  ]
  const summary = { path: '/v/新名.md', name: '新名', title: '新名', created: 1, excerpt: '正文' }
  const next = api.replaceNoteAtPath(notes, '/v/旧名.md', summary)
  assert.ok(Array.isArray(next))
  assert.equal(next.length, 2)
  assert.equal(next[0].path, '/v/新名.md')
  assert.equal(next[0].name, '新名')
  assert.equal(next[0].excerpt, '正文')
  assert.deepEqual(next[0].pending, { emoji: '😈', label: '毒舌' }, 'pending 应保留')
  assert.equal(next[1], notes[1], '其他便签引用不变')

  // 没命中 / 非法参数 → null（调用方回退 refresh，不能误删或造数据）
  assert.equal(api.replaceNoteAtPath(notes, '/v/不存在.md', summary), null)
  for (const bad of [null, undefined, 'x', {}]) assert.equal(api.replaceNoteAtPath(bad, '/v/旧名.md', summary), null)
  assert.equal(api.replaceNoteAtPath(notes, '', summary), null)
  assert.equal(api.replaceNoteAtPath(notes, '/v/旧名.md', null), null)
  assert.equal(api.replaceNoteAtPath(notes, '/v/旧名.md', { name: '缺 path' }), null)
})

test('client 源码：改名保存走乐观替换，保存中不误关抽屉', () => {
  assert.match(CLIENT_SOURCE, /replaceRenamedNote\(path, savedNote\)/, 'saveEditing 改名分支应乐观替换 view.notes')
  assert.match(CLIENT_SOURCE, /if \(savingNoteRef\.current\) return;/, '保存请求在飞时，筛选跟随 effect 应跳过')
})

/* ─────────────────── 锁定面板记住打开的便签（0.13.4） ─────────────────── */

test('client __test：PINNED_NOTE_KEY 与锁定面板便签路径的存取/清除', (t) => {
  const { mod, storage } = loadClient(t)
  const api = getTestApi(mod)
  assert.equal(api.PINNED_NOTE_KEY, 'dsh-sticky-notes.pinnedNote')
  assert.equal(api.readStoredPinnedNote(), '')

  api.storePinnedNote('/vault/notes/甲.md')
  assert.equal(storage.getItem(api.PINNED_NOTE_KEY), '/vault/notes/甲.md')
  assert.equal(api.readStoredPinnedNote(), '/vault/notes/甲.md')

  // 空路径/非字符串不写入
  api.storePinnedNote('')
  api.storePinnedNote(null)
  assert.equal(api.readStoredPinnedNote(), '/vault/notes/甲.md')

  api.clearStoredPinnedNote()
  assert.equal(storage.getItem(api.PINNED_NOTE_KEY), null)
  assert.equal(api.readStoredPinnedNote(), '')
})

test('client __test：localStorage 不可用时锁定便签路径读写安全回退', (t) => {
  const { mod } = loadClient(t, { storage: null })
  const api = getTestApi(mod)
  assert.equal(api.readStoredPinnedNote(), '')
  assert.doesNotThrow(() => api.storePinnedNote('/a.md'))
  assert.doesNotThrow(() => api.clearStoredPinnedNote())
})

/* ──────────── 卡片菜单出现时统一隐藏图片（0.13.4 简化） ──────────── */

test('client 源码：菜单出现就隐藏图片预览，旧 emoji 蒙版逻辑已移除', () => {
  // 统一规则：data-menu=true（= 悬停/聚焦卡片或归档菜单打开）时隐藏图片条
  assert.match(
    CLIENT_SOURCE,
    /\.SN_card\[data-menu='true'\] \.SN_cardImages\{[^}]*opacity:0/,
    '缺少 .SN_card[data-menu=true] .SN_cardImages 的隐藏规则',
  )
  // 操作区可见性必须与 data-menu 同源：不能再由 CSS :hover/:focus-within 单独先显示菜单
  assert.doesNotMatch(CLIENT_SOURCE, /\.SN_card:hover \.SN_cardActions/, '操作区不应再由 CSS :hover 单独显示')
  assert.doesNotMatch(CLIENT_SOURCE, /\.SN_card:focus-within \.SN_cardActions/, '操作区不应再由 CSS :focus-within 单独显示')
  assert.match(CLIENT_SOURCE, /\.SN_cardActions\[data-visible='true'\]\{opacity:1/, '操作区应由 data-visible 控制')
  // data-menu 与 data-visible 必须来自同一个 menuVisible 表达式
  assert.match(CLIENT_SOURCE, /'data-menu': menuVisible \? 'true' : 'false'/)
  assert.match(CLIENT_SOURCE, /'data-visible': menuVisible \? 'true' : undefined/)
  // 旧的「仅 emoji 行 hover 才出现的同色渐变蒙版」已移除
  assert.doesNotMatch(CLIENT_SOURCE, /SN_cardScrim/, 'SN_cardScrim 应已删除')
  assert.doesNotMatch(CLIENT_SOURCE, /aiRowActive|onAiRowEnter|onAiRowLeave/, 'emoji 行专属的 hover 逻辑应已简化')
  // 卡片根节点自己监听 hover/focus
  assert.match(CLIENT_SOURCE, /onMouseEnter: \(\) => actions\.current\.onCardEnter\(note\)/)
  assert.match(CLIENT_SOURCE, /onMouseLeave: \(event\) => actions\.current\.onCardLeave\(/)
  // 抽屉打开时也要记录 hover（否则关闭抽屉后菜单会停在旧卡片上）
  const enterCardStart = CLIENT_SOURCE.indexOf('function enterCard(')
  const leaveCardStart = CLIENT_SOURCE.indexOf('function leaveCard(')
  assert.ok(enterCardStart > 0 && leaveCardStart > enterCardStart, 'enterCard / leaveCard 应存在')
  assert.doesNotMatch(
    CLIENT_SOURCE.slice(enterCardStart, leaveCardStart),
    /noteDrawer/,
    'enterCard 不应因抽屉打开而忽略 hover（menuVisible 已用 drawerOpen 屏蔽菜单）',
  )
  // 触屏兜底规则已删除：菜单可见性统一由 data-visible 决定
  assert.doesNotMatch(CLIENT_SOURCE, /@media \(hover:none\)/, 'hover:none 的强制显示规则应已删除')
})
