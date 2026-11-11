/** Shared client test harness. Every test worker owns isolated state. */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const CLIENT_BUNDLE = readFileSync(
  fileURLToPath(new URL('../lib/client.js', import.meta.url)),
  'utf8',
)

const CLIENT_ROOT = new URL('../src/client/', import.meta.url)

const CLIENT_SOURCE = readdirSync(CLIENT_ROOT, { recursive: true })
  .filter((path) => path.endsWith('.js')).sort()
  .map((path) => readFileSync(new URL(path, CLIENT_ROOT), 'utf8')).join('\n')

const PACKAGE_JSON = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
)

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

function makeRequire(react) {
  return (id) => {
    if (id === 'react') return react
    if (id === 'react-dom') return { createPortal: (node) => node, render: () => {} }
    throw new Error(`client.js 只允许 require('react') / require('react-dom')，实际：${id}`)
  }
}

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
  new Function('window', CLIENT_BUNDLE)(fakeWindow)

  assert.notEqual(registration, null, 'client.js 应当调用 window.__ModuleLoader__.load')
  assert.equal(registration.id, 'dsh-obsidian-memo')
  assert.equal(typeof registration.factory, 'function')

  const mod = registration.factory(makeRequire(react))
  return { mod, registration, storage }
}

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
    render(fn, options, beforeEffects) {
      cursor = 0
      effects = []
      const result = fn(options)
      beforeEffects?.(result)
      for (const effect of effects) effect()
      return result
    },
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

function dragMotionFixture(api, { reducedMotion = false } = {}) {
  const listeners = new Map(), frames = new Map(), writes = [], animations = []
  let sequence = 0, sourceReads = 0, completed
  const win = {
    innerWidth: 1024, innerHeight: 768,
    requestAnimationFrame(fn) { const id = ++sequence; frames.set(id, fn); return id },
    cancelAnimationFrame(id) { frames.delete(id) },
    addEventListener(name, fn) { listeners.set(name, fn) },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name) },
    matchMedia: () => ({ matches: reducedMotion }),
  }
  const doc = { defaultView: win, addEventListener: win.addEventListener, removeEventListener: win.removeEventListener }
  const style = { set transform(value) { writes.push(['transform', value]) }, setProperty(...args) { writes.push(args) } }
  const layer = { ownerDocument: doc, style, dataset: {}, animate(keyframes, options) {
    const finished = new Promise((resolve) => { completed = resolve })
    const animation = { keyframes, options, finished, cancel() { completed() } }
    animations.push(animation); return animation
  } }
  const source = { isConnected: true, getBoundingClientRect() { sourceReads++; return { left: 50, top: 80, width: 300, height: 208 } } }
  const point = { x: 200, y: 184, width: 300, height: 208, offsetX: 150, offsetY: 104 }
  const motion = api.createCardDragMotion(layer, point)
  return { motion, point, layer, source, win, listeners, frames, writes, animations,
    sourceReads: () => sourceReads, complete: () => completed?.(),
    frame() { const queued = [...frames.values()]; frames.clear(); queued.forEach((fn) => fn()) },
    move(x, y, type = 'dragover') { listeners.get(type)?.({ clientX: x, clientY: y, type }) },
  }
}

function captureNodes(node, result = []) {
  if (Array.isArray(node)) node.forEach((child) => captureNodes(child, result))
  else if (node && typeof node === 'object') { result.push(node); captureNodes(node.children, result) }
  return result
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function editorOptions(overrides = {}) {
  return {
    tRef: { current: (key) => key }, aliveRef: { current: true }, controllersRef: { current: new Set() },
    request: async () => ({}), refreshNow: async () => {}, replaceNote() {}, replaceRenamedNote() {},
    pushToast() {}, pushErrorToast() {}, onOpen() {}, onClose() {}, ...overrides,
  }
}

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
    'nextPollDelay',
    'WALL_PAGE_SIZE',
    'nextVisibleCount',
    'formatVersionLabel',
  ]) {
    assert.notEqual(api[key], undefined, `__test.${key} 缺失（契约 §6.1）`)
  }
  return api
}

const CARD_IMAGE_ENTRIES = [
  { source: 'a.png', alt: 'A', wiki: false },
  { source: '附件/b.png', alt: '', wiki: true },
  { source: './c.jpg', alt: 'C', wiki: false },
  { source: 'd.webp', alt: 'D', wiki: false },
]

const DATE_DAY_MS = 24 * 60 * 60 * 1000;

const DATE_NOW = new Date(2026, 10, 4, 15, 30, 0, 0).getTime();

function startOfLocalDayForTest(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function localDayOffsetForTest(ms, deltaDays) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + deltaDays).getTime();
}

function noteIds(list) {
  return list.map((note) => note.path);
}

export { CARD_IMAGE_ENTRIES, CLIENT_SOURCE, DATE_DAY_MS, DATE_NOW, PACKAGE_JSON, captureNodes, deferred, dragMotionFixture, editorOptions, flush, getTestApi, hookRunner, loadClient, localDayOffsetForTest, noteIds, startOfLocalDayForTest }
