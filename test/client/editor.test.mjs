/** Client editor regression coverage. */
import test from 'node:test'
import { loadClient, captureNodes, hookRunner, flush, deferred, editorOptions, getTestApi, CLIENT_SOURCE } from '../../test-support/client.mjs'
import assert from 'node:assert/strict'

test('阅读列表：有序项目显示数字标记，无序项目保留圆点样式', (t) => {
  const api = loadClient(t).mod.__test
  const ordered = api.components.NoteBlock({ block: { kind: 'li', text: '第二项', marker: '2.' } })
  assert.equal(ordered.props.className, 'SN_blockLi SN_blockOrdered')
  assert.equal(captureNodes(ordered).find((n) => n.props.className === 'SN_listNumber').children[0], '2.')
  assert.equal(api.components.NoteBlock({ block: { kind: 'li', text: '圆点' } }).props.className, 'SN_blockLi')
  const orderedTask = api.components.NoteBlock({ block: { kind: 'li', text: '完成项', marker: '3.', checked: false, sourceLine: 2 }, taskBusy: false, onToggleTask() {} })
  assert.match(orderedTask.props.className, /SN_blockTask/)
  assert.match(orderedTask.props.className, /SN_blockOrdered/)
  const taskNodes = captureNodes(orderedTask)
  assert.equal(taskNodes.find((n) => n.props.className === 'SN_listNumber').children[0], '3.')
  assert.equal(taskNodes.find((n) => n.props.role === 'checkbox').props['aria-checked'], false)
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
