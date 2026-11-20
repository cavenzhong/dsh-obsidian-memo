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
  assert.equal(runner.storage.getItem('dsh-sticky-notes.editorDraft.v1'), null, '保存成功清除本地恢复记录')
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

// 0.16.8：正文模式标题同步
test('编辑 hook 0.16.8：firstLine 标题 ↔ 正文双向同步，保存 payload 不含 name', async (t) => {
  const runner = hookRunner(t)
  const full = { path: '/A.md', name: '2026-11-13-1924', title: '旧标题', body: '旧标题\n\n旧正文\n', contentRevision: 'v1' }
  runner.connect(async () => ({ ok: true, value: full }))
  const calls = []
  const options = editorOptions({
    titleMode: 'firstLine',
    request: async (endpoint, payload) => {
      calls.push({ endpoint, payload })
      return { note: { path: '/A.md', name: full.name, title: '最终标题', titleMode: 'firstLine' } }
    },
  })
  let editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.openNoteDrawer({ path: '/A.md' })
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.startEditing()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  assert.equal(editor.titleDraft, '旧标题', '标题从正文派生，而不是复制文件名')
  assert.equal(editor.bodyDraft, '旧标题\n\n旧正文\n')

  editor.handleTitleChange('新标题')
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  assert.equal(editor.bodyDraft, '新标题\n\n旧正文\n', '改标题实时写回正文首行')

  editor.handleBodyChange('正文首行\n\n新正文')
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  assert.equal(editor.titleDraft, '正文首行', '改正文首行实时反推标题')

  editor.handleTitleChange('最终标题')
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.saveEditing()
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  assert.equal(calls[0].endpoint, 'saveNote')
  assert.equal(calls[0].payload.name, undefined, '正文模式不发送 name')
  assert.equal(calls[0].payload.body, '最终标题\n\n新正文')
  assert.equal(editor.editing, false)
})

test('编辑 hook：清空标题保持空输入，再输入时仍修改原来的标题位置', async (t) => {
  const runner = hookRunner(t)
  const full = { path: '/A.md', name: '文件名', title: '旧标题', body: '旧标题\n\n正文\n', contentRevision: 'v1' }
  runner.connect(async () => ({ ok: true, value: full }))
  const options = editorOptions({ titleMode: 'firstLine' })
  let editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.openNoteDrawer({ path: '/A.md' })
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.startEditing()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.handleTitleChange('')
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  assert.equal(editor.bodyDraft, '\n正文\n')
  assert.equal(editor.titleDraft, '', '输入中间态不把下一段正文接管为标题')
  editor.handleTitleChange('新标题')
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  assert.equal(editor.bodyDraft, '新标题\n\n正文\n', '再次输入仍保留整段正文')
})

test('编辑 hook 0.16.8：heading 无一级标题时标题框为空，输入标题会插入 # 行', async (t) => {
  const runner = hookRunner(t)
  const full = { path: '/B.md', name: '文件名', title: '文件名', body: '正文\n', contentRevision: 'v1' }
  runner.connect(async () => ({ ok: true, value: full }))
  const options = editorOptions({ titleMode: 'heading' })
  let editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.openNoteDrawer({ path: '/B.md' })
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.startEditing()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  assert.equal(editor.titleDraft, '', '没有 H1 时标题框为空（不回退文件名）')
  editor.handleTitleChange('新标题')
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  assert.equal(editor.bodyDraft, '# 新标题\n正文\n')
})

test('编辑 hook 0.16.8：filename 模式仍发送 name，保持原改名行为', async (t) => {
  const runner = hookRunner(t)
  const full = { path: '/A.md', name: '甲', title: '甲', body: '原文', contentRevision: 'v1' }
  runner.connect(async () => ({ ok: true, value: full }))
  const calls = []
  const options = editorOptions({
    titleMode: 'filename',
    request: async (endpoint, payload) => { calls.push({ endpoint, payload }); return { note: { path: '/B.md', name: '乙' } } },
  })
  let editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.openNoteDrawer({ path: '/A.md' })
  await flush()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.startEditing()
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.handleTitleChange('乙')
  editor = runner.render(runner.api.hooks.useNoteEditor, options)
  editor.saveEditing()
  await flush()
  assert.equal(calls[0].payload.name, '乙')
})

test('编辑草稿：切走后恢复同一篇、文件名和最后一次正文修改，仍用编辑前版本校验保存', async (t) => {
  const runner = hookRunner(t), writes = [], errors = []
  const key = 'dsh-sticky-notes.editorDraft.v1'
  const summary = { path: '/vault/note.md', name: '原文件名' }
  let full = { ...summary, body: '原正文', contentRevision: 'original' }
  runner.connect(async (_channel, endpoint) => {
    assert.equal(endpoint, 'note')
    return { ok: true, value: full }
  })
  const options = editorOptions({
    notesForRestore: [summary],
    request: async (endpoint, payload) => {
      writes.push({ endpoint, payload })
      throw Object.assign(new Error('已有外部修改'), { code: 'conflict' })
    },
    pushErrorToast: (error) => errors.push(error),
  })
  const render = () => runner.render(runner.api.hooks.useNoteEditor, options)
  render().openNoteDrawer(summary)
  await flush()
  render().startEditing()
  const body = '最后一键也保留\n- [ ] 待办\n'
  render().handleTitleChange('未保存的新文件名')
  render().handleBodyChange(body)
  runner.unmount() // 写入计时尚未触发，清理必须冲刷最后一次变更。
  assert.equal(JSON.parse(runner.storage.getItem(key)).body, body)
  full = { ...full, body: '外部修改的正文', contentRevision: 'newer' }
  render(); await flush()
  const resumed = render()
  assert.equal(resumed.noteDrawer.path, summary.path)
  assert.equal(resumed.editing, true)
  assert.equal(resumed.bodyDraft, body)
  assert.equal(resumed.titleDraft, '未保存的新文件名')
  assert.equal(writes.length, 0, '恢复不是自动保存')
  resumed.saveEditing(); await flush()
  assert.deepEqual(writes[0], { endpoint: 'saveNote', payload: { path: summary.path, name: '未保存的新文件名', body, expectedRevision: 'original' } })
  assert.equal(errors[0].code, 'conflict')
  assert.equal(render().bodyDraft, body)
  render().cancelEditing(); await flush()
  runner.unmount(); render(); await flush()
  assert.equal(runner.storage.getItem(key), null)
  assert.equal(render().editing, false, '主动取消后不再恢复')
})

test('编辑草稿：只移动光标也会跨面板保留；无效位置不影响正文恢复', async (t) => {
  const runner = hookRunner(t), { storage } = runner
  const key = 'dsh-sticky-notes.editorDraft.v1'
  const note = { path: '/vault/note.md', name: '便签', body: '第一段\n第二段' }
  const options = editorOptions({ notesForRestore: [note] })
  const render = () => runner.render(runner.api.hooks.useNoteEditor, options)
  runner.connect(async () => ({ ok: true, value: note }))
  render().openNoteDrawer(note); await flush()
  render().startEditing()
  const position = { field: 'body', start: 5, end: 5, direction: 'none', top: 42, left: 0, contentTop: 16 }
  render().handleEditPositionChange(position)
  runner.unmount()
  const stored = JSON.parse(storage.getItem(key))
  assert.deepEqual(stored.position, position)
  render(); await flush()
  assert.equal(render().editing, true)
  assert.deepEqual(render().editPositionRef.current, position)
  runner.unmount()

  storage.setItem(key, JSON.stringify({ ...stored, body: '未保存的正文', position: { ...position, start: -1 } }))
  render(); await flush()
  const resumed = render()
  assert.equal(resumed.editing, true)
  assert.equal(resumed.bodyDraft, '未保存的正文')
  assert.equal(resumed.editPositionRef.current, null)
})

test('编辑草稿：钉住面板仍优先恢复日期筛选外的便签；正文标题延续原来编辑的行', async (t) => {
  const runner = hookRunner(t), { api, storage } = runner
  const previousDocument = globalThis.document
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument })
  const draft = { path: '/vault/old.md', name: '旧便签', body: '原首行\n\n第二段', contentRevision: 'old', created: 1 }
  const recent = { path: '/vault/today.md', name: '今天', created: Date.now() }
  let read = null
  runner.connect(async (_channel, endpoint, payload) => {
    if (endpoint === 'state') return { ok: true, value: { configured: true, revision: '1', notes: [recent, draft], settings: { titleMode: 'firstLine' } } }
    assert.equal(endpoint, 'note')
    if (read) return read.promise
    assert.equal(payload.path, draft.path)
    return { ok: true, value: draft }
  })
  const edit = () => runner.render(api.hooks.useNoteEditor, editorOptions({ titleMode: 'firstLine' }))
  edit().openNoteDrawer(draft); await flush()
  edit().startEditing(); edit().handleTitleChange('')
  const position = { field: 'title', start: 0, end: 0, direction: 'none', top: 0, left: 0, contentTop: 0 }
  edit().handleEditPositionChange(position)
  runner.unmount()
  storage.setItem(api.PINNED_KEY, '1')
  storage.setItem(api.DATE_FILTER_ENABLED_KEY, '1')
  storage.setItem('dsh-sticky-notes.dateFilter.v1', 'today')
  read = deferred()
  const panel = () => captureNodes(runner.render(api.components.StickyNotesPanel, { t: (key) => key }))
  const drawer = (tree) => tree.find((node) => node.type === api.components.NoteDrawer)
  panel(); await flush()
  panel() // 提交恢复的 effect，此时读全文还在飞，钉住逻辑不得立刻改选。
  assert.equal(drawer(panel()).props.drawer.path, draft.path)
  read.resolve({ ok: true, value: draft }); await flush()
  const resumed = drawer(panel())
  assert.equal(resumed.props.drawer.path, draft.path)
  assert.equal(resumed.props.editing, true)
  assert.equal(resumed.props.titleDraft, '')
  assert.deepEqual(resumed.props.editPositionRef.current, position)
  resumed.props.onTitleChange('替换旧首行')
  assert.equal(drawer(panel()).props.bodyDraft, '替换旧首行\n\n第二段')
})
