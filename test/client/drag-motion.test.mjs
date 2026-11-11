/** client: drag-motion regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CLIENT_SOURCE, captureNodes, deferred, dragMotionFixture, flush, hookRunner, loadClient } from '../../test-support/client.mjs'

test('v0.15 拖拽浮层：预览为原尺寸 1/3，提示在上方独立层，四边位置不溢出', (t) => {
  const api = loadClient(t).mod.__test
  const point = { x: 200, y: 184, width: 300, height: 208, offsetX: 150, offsetY: 104 }
  const viewport = { width: 1024, height: 768 }
  const layout = api.cardDragLayout(point, viewport)
  assert.equal(layout.scale, 1 / 3)
  assert.equal(layout.previewWidth, 100)
  assert.equal(layout.previewHeight, 208 / 3)
  assert.equal(layout.left, 150)
  assert.equal(layout.top, 184 - 104 / 3)
  for (const [x, y] of [[0, 0], [1024, 0], [0, 768], [1024, 768]]) {
    const edge = api.cardDragLayout({ ...point, x, y }, viewport)
    assert.ok(edge.left >= 8 && edge.top >= 48)
    assert.ok(edge.left + edge.previewWidth <= viewport.width - 8)
    assert.ok(edge.top + edge.previewHeight <= viewport.height - 8)
    const center = edge.left + edge.previewWidth / 2
    assert.ok(center - edge.hintWidth / 2 >= 8)
    assert.ok(center + edge.hintWidth / 2 <= viewport.width - 8)
  }
  const previous = globalThis.document
  const body = {}
  globalThis.document = { body }
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous })
  const nodes = captureNodes(api.components.CardDragOverlay({ note: { path: 'a.md', title: '拖动便签' }, point, action: 'archive', targetId: 'work', targets: [{ id: 'work', label: '工作' }], t: (key, data) => data?.label || key }))
  const preview = nodes.find((node) => node.props.className === 'SN_dragPreview')
  assert.equal(preview.props.style.transform, 'scale(' + 1 / 3 + ')')
  const previewCard = preview.children[0]
  assert.equal(previewCard.props.preview, true)
  assert.equal(previewCard.props.drawerOpen, true, '拖动预览隐藏操作菜单')
  const renderedCard = api.components.NoteCard(previewCard.props)
  assert.equal(renderedCard.props.draggable, false)
  assert.equal(renderedCard.props.tabIndex, -1)
  assert.equal(nodes.find((node) => node.props.className === 'SN_dragFollow').children[1].children[0], '工作')
  assert.match(CLIENT_SOURCE, /ReactDOM\.createPortal\(layer, document\.body\)/)
  assert.match(CLIENT_SOURCE, /\.SN_dragFollow\{[^}]*bottom:calc\(100% \+ 8px\);z-index:2/)
  assert.match(CLIENT_SOURCE, /\.SN_dragPreview\{[^}]*z-index:1/)
  assert.match(CLIENT_SOURCE, /\.SN_dragLayer::before\{[^}]*box-shadow:/, '阴影按缩略图真实尺寸绘制，不随内部 1/3 缩放变淡')
  assert.match(CLIENT_SOURCE, /\.SN_dragFollow\{[^}]*left:50%;transform:translateX\(-50%\)/, '提示位于卡片上方居中')
})

test('v0.15 拖拽性能：1000 次移动合并为一帧，只写 transform，无 React 更新与布局读取', (t) => {
  const api = loadClient(t).mod.__test, fixture = dragMotionFixture(api)
  for (let index = 0; index < 1000; index++) fixture.move(200 + index / 10, 300 + index / 10)
  assert.equal(fixture.frames.size, 1)
  assert.equal(fixture.writes.length, 0, '事件内不直接操作布局')
  assert.equal(fixture.sourceReads(), 0)
  fixture.frame()
  assert.equal(fixture.writes.filter(([kind]) => kind === 'transform').length, 1)
  assert.equal(fixture.writes.length, 1, '视口中部只写 transform，不反复修改提示宽度导致布局失效')
  assert.match(fixture.writes[0][1], /^translate3d\(/)
  assert.equal(fixture.frames.size, 0)
  fixture.move(299.9, 399.9)
  fixture.move(0, 0, 'drag')
  fixture.move(NaN, 200)
  assert.equal(fixture.frames.size, 0, '相同位置与 dragend 的零坐标不产生额外帧')
  fixture.move(400, 400)
  assert.equal(fixture.frames.size, 1)
  fixture.motion.dispose()
  assert.equal(fixture.frames.size, 0)
  assert.equal(fixture.listeners.size, 0)
})

test('v0.15 放手：取消时仅测量一次原位置，150ms 合成动画回落，结束前不重现原卡片', async (t) => {
  const fixture = dragMotionFixture(loadClient(t).mod.__test)
  fixture.move(500, 500); fixture.frame()
  fixture.move(600, 600)
  let finished = false
  const result = fixture.motion.finish('return', fixture.source).then(() => { finished = true })
  assert.equal(fixture.sourceReads(), 1)
  assert.equal(fixture.frames.size, 0)
  assert.equal(fixture.listeners.size, 0)
  assert.equal(fixture.layer.dataset.settling, 'true')
  assert.equal(fixture.animations[0].options.duration, 150)
  assert.equal(fixture.animations[0].keyframes[1].transform, 'translate3d(50px,80px,0) scale(3)')
  assert.equal(finished, false)
  await fixture.motion.finish('return', fixture.source)
  assert.equal(fixture.sourceReads(), 1)
  assert.equal(fixture.animations.length, 1)
  fixture.complete(); await result
  assert.equal(finished, true)
  fixture.motion.dispose()
})

test('v0.15 放手：有效操作仅淡出，减弱动态效果时立即结束，取消清理无残留', async (t) => {
  const api = loadClient(t).mod.__test
  const fixture = dragMotionFixture(api)
  const result = fixture.motion.finish('drop', fixture.source)
  assert.equal(fixture.sourceReads(), 0, '删除/归档不读取原卡片布局')
  assert.equal(fixture.animations[0].options.duration, 110)
  assert.equal(fixture.animations[0].keyframes[1].opacity, 0)
  fixture.motion.dispose(); await result
  assert.equal(fixture.listeners.size, 0)
  const reduced = dragMotionFixture(api, { reducedMotion: true })
  await reduced.motion.finish('return', reduced.source)
  assert.equal(reduced.animations.length, 0)
  assert.equal(reduced.listeners.size, 0)
  reduced.motion.dispose()
})

test('归档待选择：缩略卡停在归档位置正中，停止跟随鼠标，取消仍能回到原卡片', async (t) => {
  const fixture = dragMotionFixture(loadClient(t).mod.__test)
  fixture.move(500, 500)
  const anchor = { getBoundingClientRect: () => ({ left: 100, top: 600, width: 300, height: 90 }) }
  fixture.motion.park(anchor)
  assert.equal(fixture.frames.size, 0)
  assert.equal(fixture.listeners.has('dragover'), false)
  assert.equal(fixture.listeners.has('drag'), false)
  assert.equal(fixture.layer.dataset.parked, 'true')
  assert.equal(fixture.writes.find(([kind]) => kind === 'transform')[1], 'translate3d(200px,610.3333333333334px,0)')
  const writes = fixture.writes.length
  fixture.move(800, 100); fixture.frame()
  assert.equal(fixture.writes.length, writes)
  assert.equal(fixture.sourceReads(), 0, '停靠不读取卡片墙布局')
  const result = fixture.motion.finish('return', fixture.source)
  assert.equal(fixture.sourceReads(), 1)
  assert.equal(fixture.animations[0].keyframes[0].transform, 'translate3d(200px,610.3333333333334px,0)')
  assert.equal(fixture.animations[0].keyframes[1].transform, 'translate3d(50px,80px,0) scale(3)')
  fixture.complete(); await result
  fixture.motion.dispose()
  assert.equal(fixture.listeners.size, 0)
})

test('拖拽放手：空白处接收内部拖放并立即回落，不等待原生 dragend，不拦截外部文件', async (t) => {
  const runner = hookRunner(t), listeners = new Map(), animation = deferred()
  const previousDocument = globalThis.document
  globalThis.document = {
    addEventListener(name, fn, capture = false) { listeners.set(name + ':' + capture, fn) },
    removeEventListener(name, fn, capture = false) { if (listeners.get(name + ':' + capture) === fn) listeners.delete(name + ':' + capture) },
  }
  globalThis.window.addEventListener = () => {}
  globalThis.window.removeEventListener = () => {}
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument })
  const note = { path: '/A.md', title: '甲', created: Date.now(), updated: Date.now(), images: [], comments: [] }
  runner.connect(async () => ({ ok: true, value: { configured: true, revision: '1', notes: [note], jobs: [], settings: { emojis: [], archiveTargets: [] } } }))
  const render = () => runner.render(runner.api.components.StickyNotesPanel, { t: (key) => key })
  render(); await flush()
  const card = captureNodes(render()).find((node) => node.type === runner.api.components.NoteCard)
  const source = {}
  card.props.actions.current.onDragStart(note, { x: 100, y: 100, width: 300, height: 208 }, source)
  const overlay = captureNodes(render()).find((node) => node.type === runner.api.components.CardDragOverlay)
  let finishes = 0
  overlay.props.motionRef.current = { finish(mode, element) { assert.equal(mode, 'return'); assert.equal(element, source); finishes++; return animation.promise } }
  const dragenter = listeners.get('dragenter:true'), dragover = listeners.get('dragover:true'), drop = listeners.get('drop:false')
  assert.equal(typeof dragenter, 'function')
  assert.equal(typeof dragover, 'function')
  assert.equal(typeof drop, 'function')
  let prevented = 0
  const internal = { type: 'dragover', dataTransfer: { types: ['application/x-dsh-memo'], dropEffect: 'none' }, preventDefault() { prevented++ } }
  dragover(internal)
  assert.equal(prevented, 1)
  assert.equal(internal.dataTransfer.dropEffect, 'move')
  dragenter({ ...internal, type: 'dragenter' })
  assert.equal(prevented, 2, '进入新元素后立即放手也接收，不必等下一次 dragover')
  const external = { type: 'drop', dataTransfer: { types: ['Files'] }, preventDefault() { assert.fail('外部文件不属于卡片会话') } }
  dragover(external); drop(external)
  assert.equal(finishes, 0)
  const ended = drop({ ...internal, type: 'drop' })
  assert.equal(prevented, 3)
  assert.equal(finishes, 1, 'drop 当场开始回落，早于可能被浏览器延迟的 dragend')
  assert.equal(card.props.actions.current.onDragEnd(), ended)
  assert.equal(finishes, 1)
  animation.resolve(); await ended
  assert.equal(render().props['data-card-dragging'], 'false')
  assert.equal(listeners.has('dragenter:true'), false)
  assert.equal(listeners.has('dragover:true'), false)
  assert.equal(listeners.has('drop:false'), false)
})
