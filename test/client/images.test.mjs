/** client: images regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CARD_IMAGE_ENTRIES, CLIENT_SOURCE, captureNodes, deferred, flush, getTestApi, hookRunner, loadClient } from '../../test-support/client.mjs'

test('图片处理：默认与 Host 对齐，压缩关闭时原文件直通，尺寸保持比例且不放大', async (t) => {
  const api = loadClient(t).mod.__test
  const { normalizeImageCompression, LIMITS } = await import('../../lib/shared.js')
  for (const input of [undefined, {}, { enabled: false, quality: 90, maxDimension: 4096 }, { quality: -1, maxDimension: 99999 }, { quality: '', maxDimension: null }, { quality: true, maxDimension: [] }, { quality: '  ', maxDimension: '4096' }]) {
    assert.deepEqual(api.readImageCompression(input), normalizeImageCompression(input))
  }
  assert.equal(api.readImageCompression({ quality: true }).quality, 70)
  assert.equal(api.readImageCompression({ maxDimension: [] }).maxDimension, 2048)
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
  assert.doesNotMatch(CLIENT_SOURCE, /@media \(hover:none\)\{\.SN_cardActions/, '触屏也不能强制显示卡片底部菜单')
})

test('v0.16 阅读图片按视口懒加载，并与卡片共用最多三个并发请求', async (t) => {
  const runner = hookRunner(t), observers = [], requests = [], root = {}
  const previous = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this) }
    observe() {}
    disconnect() {}
  }
  t.after(() => { if (previous === undefined) delete globalThis.IntersectionObserver; else globalThis.IntersectionObserver = previous })
  runner.connect((channel, endpoint, payload) => {
    const pending = deferred(); requests.push({ endpoint, payload, ...pending }); return pending.promise
  })
  const render = () => runner.render(() => Array.from({ length: 5 }, (_, i) => runner.api.components.NoteImage({ path: '/note.md', source: `${i}.png` })), undefined,
    (nodes) => nodes.forEach((node) => { node.props.ref.current = { closest: () => root } }))
  render(); await flush()
  assert.equal(requests.length, 0)
  assert.equal(observers.length, 5)
  assert.ok(observers.every((observer) => observer.options.root === root))
  for (const observer of observers) observer.callback([{ isIntersecting: true }])
  await flush()
  assert.equal(requests.length, 3)
  assert.ok(requests.every((item) => item.endpoint === 'readImage' && item.payload.maxBytes === undefined))
  requests[0].resolve({ ok: true, value: { dataUrl: 'data:image/png;base64,first' } }); await flush()
  assert.equal(requests.length, 4)
  for (const item of requests.slice(1)) item.resolve({ ok: true, value: { dataUrl: 'data:image/png;base64,next' } })
  await flush()
  assert.equal(requests.length, 5)
  requests[4].resolve({ ok: true, value: { dataUrl: 'data:image/png;base64,last' } }); await flush()
  assert.equal(render().filter((node) => node.type === 'img').length, 5)
  assert.equal(runner.api.imageQueueStats().active, 0)
})

test('v0.16 阅读图片复用卡片已读取的原图缓存', async (t) => {
  const runner = hookRunner(t), requests = []
  runner.connect(async (...args) => { requests.push(args); return { ok: true, value: {} } })
  runner.api.writeImageCache(runner.api.imageCacheKey('/note.md', 'image.png'), 'data:image/png;base64,cached')
  const props = { path: '/note.md', source: 'image.png' }
  runner.render(runner.api.components.NoteImage, props); await flush()
  const node = runner.render(runner.api.components.NoteImage, props)
  assert.equal(node.type, 'img')
  assert.equal(node.props.src, 'data:image/png;base64,cached')
  assert.equal(requests.length, 0)
})
