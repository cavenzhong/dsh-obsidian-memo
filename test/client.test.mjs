/**
 * lib/client.js 的纯函数单测（不渲染 React 组件）。
 *
 * client.js 是单文件浏览器 bundle：顶层只做一次
 * `window.__ModuleLoader__.load({ id, factory })`。这里用一个假的 window 捕获
 * factory，注入最小 React / localStorage stub 后实例化模块，只调用
 * `module.exports.__test` 暴露的纯函数（契约 §6.1）。
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
  // 0.12 可能新增别的 React API；未实现的一律返回 noop，避免 factory 定义期报错。
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
function loadClient(t, { storage = makeStorage() } = {}) {
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

  const mod = registration.factory(makeRequire(createReactStub()))
  return { mod, registration, storage }
}

/** 取 __test 并断言 0.12 要求的全部纯函数都暴露了。 */
function getTestApi(mod) {
  assert.equal(typeof mod, 'object', 'factory 应返回模块导出对象')
  assert.notEqual(mod.__test, undefined, '模块应导出 __test（契约 §6.1）')
  const api = mod.__test
  for (const key of [
    'APP_VERSION',
    'PINNED_KEY',
    'readStoredPinned',
    'storePinned',
    'cardImages',
    'drawerWidthBounds',
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

test('client __test：APP_VERSION 与 package.json 的 0.12 对齐', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(api.APP_VERSION, '0.12')
  assert.equal(PACKAGE_JSON.version, '0.12.0')
  assert.equal(PACKAGE_JSON.version.startsWith(`${api.APP_VERSION}.`), true)
})

test('client 源码：byline 为 by caven v0.12 且只在顶栏（宽松静态检查）', () => {
  // 契约 §6.3（修正轮）：署名只在面板顶栏大标题后，文案小写 v，版本来自 APP_VERSION。
  assert.match(CLIENT_SOURCE, /by caven v/, 'byline 文案应为小写 v 的 by caven v0.12')
  assert.doesNotMatch(CLIENT_SOURCE, /by caven V/, '旧文案 by caven V0.12 不应保留')
  // 允许两种实现：常量字符串拼接，或模板串；也允许直接写死 by caven v0.12
  assert.match(
    CLIENT_SOURCE,
    /'by caven v'\s*\+\s*APP_VERSION|`by caven v\$\{APP_VERSION\}`|by caven v0\.12/,
    'byline 应由 APP_VERSION 派生或与 0.12 对齐',
  )
  // 卡片与抽屉不再各渲染一处：旧实现是「声明 + 卡片 + 抽屉」共 3 处 BYLINE 引用，
  // 修正后应只剩「声明 + 顶栏一处」≤ 2 处。不绑定具体类名/组件名，避免脆测试。
  const bylineRefs = (CLIENT_SOURCE.match(/\bBYLINE\b/g) ?? []).length
  assert.ok(bylineRefs <= 2, `BYLINE 引用次数应 <= 2（声明 + 顶栏一处），实际 ${bylineRefs}`)
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
