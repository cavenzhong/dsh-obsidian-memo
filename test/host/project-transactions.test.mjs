import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeCase, waitForJob, exists } from '../../test-support/host.mjs'

const original = '\uFEFF---\r\nPROJECT: []\r\n---\r\n\r\n进度\r\n'
const index = '\uFEFF---\r\n---\r\n# 跟踪\r\n\r\n旧进度\r\n'
const filename = '跟踪-项目.md'
const revision = JSON.stringify({ summary: '已核实交付日期', overview: '已核实交付日期。', entry: '日期确认。' })

for (const mode of ['undo', 'external-edit']) test('补充项目的两文件验收：' + mode, async () => {
  const c = await makeCase({ notes: { 'A.md': original }, ctx: { llm: { async *stream() { yield { type: 'text-delta', text: revision } } } } }), path = c.seeded['A.md'], target = join(c.projectDir, filename)
  await mkdir(c.projectDir); await writeFile(target, index)
  const started = await c.call('addProject', { path, filename })
  assert.equal(started.ok, true)
  const id = started.value.jobId
  assert.equal((await waitForJob(c.call, id)).review, true)
  const updated = await readFile(target, 'utf8'), linked = await readFile(path, 'utf8')
  assert.ok(updated.startsWith(index)); assert.match(updated, /## 当前概况\r\n/)
  assert.equal(linked, original.replace('[]', '"[[项目/跟踪-项目|跟踪]]"'))
  if (mode === 'undo') {
    assert.equal((await c.call('undoProject', { jobId: id })).ok, true)
    assert.equal(await readFile(path, 'utf8'), original); assert.equal(await readFile(target, 'utf8'), index)
  } else {
    await writeFile(target, '用户刚修改')
    assert.equal((await c.call('undoProject', { jobId: id })).error.code, 'conflict')
    assert.equal(await readFile(path, 'utf8'), linked); assert.equal(await readFile(target, 'utf8'), '用户刚修改')
    assert.equal((await c.call('acceptProject', { jobId: id })).ok, true)
  }
})

for (const mode of ['late-file', 'unload', 'cancel']) test('新建生成中：' + mode + ' 不覆盖目标或回写源文件', async () => {
  let release, signal
  const gate = new Promise(resolve => { release = resolve })
  let started; const entered = new Promise(resolve => { started = resolve })
  const c = await makeCase({ notes: { 'A.md': '原文' }, ctx: { llm: { async *stream(opts) {
    signal = opts.signal; started(); await gate; yield { type: 'text-delta', text: revision }
  } } } })
  const path = c.seeded['A.md'], target = join(c.projectDir, filename)
  const result = await c.call('openProject', { path, name: '跟踪' }); assert.ok(result.ok)
  const jobId = result.value.jobId; await entered
  let cancelling
  if (mode === 'late-file') { await mkdir(c.projectDir); await writeFile(target, '外部创建') }
  else if (mode === 'unload') await c.disposeAll()
  else {
    const aborted = new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    cancelling = c.call('cancelProject', { jobId }); await aborted
  }
  release(); await cancelling
  const job = await waitForJob(c.call, jobId)
  assert.equal(await readFile(path, 'utf8'), '原文')
  if (mode === 'late-file') { assert.equal(job.errorCode, 'conflict'); assert.equal(await readFile(target, 'utf8'), '外部创建') }
  else { assert.equal(job.status, 'cancelled'); assert.equal(await exists(target), false) }
})

test('源便签有旧列表型归属时，既不重复评估，也不写入另一个项目', async () => {
  const source = '---\nPROJECTS:\n- "[[原项目]]"\n---\n原文'
  const c = await makeCase({ notes: { 'A.md': source }, ctx: { llm: { stream() { throw new Error('不应发起 AI') } } } })
  const path = c.seeded['A.md']
  assert.equal((await c.call('projectCheck', { path })).error.code, 'conflict')
  const result = await c.call('openProject', { path, name: '跟踪' })
  assert.equal((await waitForJob(c.call, result.value.jobId)).errorCode, 'conflict')
  assert.equal(await readFile(path, 'utf8'), source); assert.equal(await exists(join(c.projectDir, filename)), false)
})

test('确认新建绑定到评估时的便签版本和项目目录', async () => {
  const c = await makeCase({ notes: { 'A.md': '第一版' } }), path = c.seeded['A.md']
  const check = await c.call('projectCheck', { path })
  const { result } = await waitForJob(c.call, check.value.jobId)
  assert.equal(typeof result.sourceRevision, 'string')
  assert.equal((await c.call('openProject', { path, name: '跟踪', expectedProjectDir: '旧目录' })).error.code, 'conflict')
  await writeFile(path, '已改为另一件事')
  const started = await c.call('openProject', { path, name: '跟踪', sourceRevision: result.sourceRevision })
  assert.equal((await waitForJob(c.call, started.value.jobId)).errorCode, 'conflict')
  assert.equal(await readFile(path, 'utf8'), '已改为另一件事'); assert.equal(await exists(join(c.projectDir, filename)), false)
})

test('回写双链不可把临界大小的便签写出扫描/撤销的读取上限', async () => {
  const { LIMITS } = await import('../../lib/shared.js')
  const source = 'a'.repeat(LIMITS.maxFileBytes), c = await makeCase({ notes: { 'A.md': source } })
  const path = c.seeded['A.md'], r = await c.call('openProject', { path, name: '跟踪' })
  assert.equal((await waitForJob(c.call, r.value.jobId)).errorCode, 'bad-request')
  assert.equal(await readFile(path, 'utf8'), source); assert.equal(await exists(join(c.projectDir, filename)), false)
})
