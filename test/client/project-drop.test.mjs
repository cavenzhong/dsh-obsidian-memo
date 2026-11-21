import test from 'node:test'
import assert from 'node:assert/strict'
import { hookRunner, flush, deferred } from '../../test-support/client.mjs'

const note = { path: 'Inbox/A.md', title: '一条长便签' }
const target = { filename: '发布-项目.md', name: '发布' }
const result = { name: '发布准备', level: '符合', reason: '有阶段和交付目标' }
function setup(t, delay = true, overrides = {}) {
  const runner = hookRunner(t), calls = [], toasts = []
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const options = { aliveRef: { current: true }, jobs: [], projectDropConfirmEnabled: delay,
    setSortMenu() {}, refreshNow() {}, pushErrorToast: assert.fail, pushToast: (toast) => toasts.push(toast), t: key => key,
    async request(endpoint, payload) { calls.push([endpoint, payload]); return { jobId: 'job' } }, ...overrides,
  }
  const view = (jobs) => { if (jobs) options.jobs = jobs; return runner.render(runner.api.hooks.useProjectDialog, options) }
  return { calls, view, options, toasts }
}

test('拖放新建：等待可取消；分析结束前只有小提示，成功后才显示带 AI 名称的确认框', async t => {
  const { view, calls } = setup(t)
  view().queueProjectDrop(note)
  t.mock.timers.tick(2999)
  assert.equal(view().projectTarget, null)
  view().notices[0].actions[0].run()
  t.mock.timers.tick(3000)
  assert.deepEqual(calls, [])
  assert.deepEqual(view().notices, [])
  view().queueProjectDrop(note)
  t.mock.timers.tick(2999)
  assert.deepEqual(calls, [])
  t.mock.timers.tick(1); await flush()
  assert.deepEqual(calls, [['projectCheck', { path: note.path }]])
  const checking = view([{ id: 'job', kind: 'project-check', status: 'running' }])
  assert.equal(checking.projectTarget, null)
  assert.deepEqual(checking.notices.map(n => n.text), ['project.analyzing'])
  view([{ id: 'job', kind: 'project-check', status: 'done', result }])
  const ready = view()
  assert.deepEqual(ready.notices, [])
  assert.equal(ready.projectName, result.name)
  assert.deepEqual(ready.projectTarget, { ...note, check: result })
})

test('关闭等待：立即分析但不提前弹窗；终止后的迟到结果也不打开确认框', async t => {
  const { view, calls } = setup(t, false)
  view().queueProjectDrop(note); await flush()
  assert.equal(calls[0][0], 'projectCheck')
  const checking = view([{ id: 'job', kind: 'project-check', status: 'running' }])
  assert.equal(checking.projectTarget, null)
  await checking.notices[0].actions[0].run()
  assert.deepEqual(calls[1], ['cancelProject', { jobId: 'job' }])
  view([{ id: 'job', kind: 'project-check', status: 'done', result }])
  assert.equal(view().projectTarget, null)
})

test('拖放补充：同一等待结束后直接更新，不做新建评估', async t => {
  const { view, calls } = setup(t)
  view().queueProjectDrop(note, target)
  assert.deepEqual(calls, [])
  t.mock.timers.tick(3000); await flush()
  assert.deepEqual(calls, [['addProject', { path: note.path, filename: target.filename }]])
  assert.equal(view().projectTarget, null)
})

test('快速连续拖放不会静默替换第一个计时器；切换目录则取消旧计时器', async t => {
  const errors = [], { view, calls, options } = setup(t, true, { pushErrorToast: e => errors.push(e.message) })
  view().queueProjectDrop(note, target); view().queueProjectDrop({ path: 'B.md' })
  assert.deepEqual(errors, ['project.waitPrevious']); t.mock.timers.tick(3000); await flush()
  assert.deepEqual(calls, [['addProject', { path: note.path, filename: target.filename }]])
  view().queueProjectDrop(note); options.notesDir = '其他目录'; view(); t.mock.timers.tick(3000); await flush()
  assert.equal(calls.length, 1); assert.equal(view().notices.length, 0)
})

test('项目列表在写完和撤销后刷新，慢的旧目录响应不能盖过新目录', async t => {
  const first = deferred(), calls = [], { view, options } = setup(t, true, { projectDir: 'old', request(endpoint) {
    calls.push(endpoint); return calls.length === 1 ? first.promise : Promise.resolve({ projects: [{ id: String(calls.length) }] })
  } })
  view(); options.projectDir = 'new'; view(); await flush()
  first.resolve({ projects: [{ id: 'old' }] }); await flush()
  assert.equal(view().projectTargets[0].id, '2')
  const job = { id: 'job', kind: 'project', status: 'running' }; view([job]); assert.equal(calls.length, 2)
  view([{ ...job, status: 'done' }]); await flush(); assert.equal(view().projectTargets[0].id, '3')
  view([{ ...job, status: 'undone' }]); await flush(); assert.equal(view().projectTargets[0].id, '4')
})

test('任务先于 RPC 回执完成，仍能收到结果；Host 回收任务后不永久阻塞新建', async t => {
  const gate = deferred(), errors = [], { view, options } = setup(t, false, { request: () => gate.promise, pushErrorToast: e => errors.push(e.message) })
  view().queueProjectDrop(note); view([{ id: 'fast', status: 'done', result }])
  gate.resolve({ jobId: 'fast' }); await flush(); view(); assert.equal(view().projectName, result.name)
  view().closeProjectDialog(); options.request = async () => ({ jobId: 'next' })
  view().queueProjectDrop(note); await flush(); view([{ id: 'next', status: 'running' }]); view([])
  assert.deepEqual(errors, ['project.checkExpired']); assert.equal(view().projectBusy, false)
})

test('一个原地验收提示显示模型给出的具体变化，仍可查看、验收、撤销', async t => {
  const { view, calls } = setup(t, false, { t: (key, vars) => vars?.summary ? `${vars.name}：${vars.summary}` : key })
  const summary = '准备上线 → 因回归失败暂停'
  const state = view([{ id: 'edit', kind: 'project-add', name: '发布', status: 'done', review: true, summary }])
  assert.equal(state.projectTarget, null); assert.equal(state.notices.length, 1)
  const notice = state.notices[0]; assert.equal(notice.text, '发布：' + summary)
  assert.deepEqual(notice.actions.map(a => a.label), ['project.inspect', 'project.accept', 'toast.undo'])
  await notice.actions[2].run(); assert.deepEqual(calls, [['undoProject', { jobId: 'edit' }]])
})

test('补充项目格式失败：提示可重试，重试复用同一条便签和项目', async t => {
  const { view, calls, toasts } = setup(t, false)
  view().queueProjectDrop(note, target); await flush(); await flush()
  assert.deepEqual(calls, [['addProject', { path: note.path, filename: target.filename }]])
  view([{ id: 'job', kind: 'project-add', status: 'error', error: '项目未写入：当前概况应只包含正文。', errorCode: 'project-revision-invalid', path: note.path, projectPath: '项目/发布-项目.md', name: '发布' }])
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].text, 'project.formatRetry')
  assert.deepEqual(toasts[0].actions.map(a => a.label), ['project.retry', 'project.dismiss'])
  await toasts[0].actions[0].run(); await flush()
  assert.deepEqual(calls[1], ['addProject', { path: note.path, filename: target.filename }])
})
