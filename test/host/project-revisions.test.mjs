import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeCase, waitForJob } from '../../test-support/host.mjs'
import { LIMITS } from '../../lib/shared.js'

const name = '支付发布', filename = name + '-项目.md'
const manual = '## 我写的验收口径\n金额要核对到分。  \n```md\n## 当前概况\n```'
const sheet = (state, log) => `# ${name}\n\n## 当前概况\n${state}\n\n## 进展记录\n${log}\n\n${manual}\n`
function stream(answer, stop = 'stop') {
  return { async *stream(opts) { yield { type: 'text-delta', text: await answer(opts.messages[0].content[0].text) }; yield { type: 'finish', reason: { kind: stop } } } }
}

// The model is scripted; exercise actual RPCs, disk revisions, ownership links and review, not model quality.
test('五张便签持续修订同一篇索引：结论翻转、旧证据保留、只补证据、按次验收/撤销', async () => {
  const updates = [
    ['联调', '准备支付联调', '尚未联调', '确认范围'],
    ['通过', '联调结束', '准备上线', '安排发布'],
    ['失败', '回归失败', '暂停上线', '复查失败用例'],
    ['定位', '确认失败范围', '暂停上线', '修复支付用例'],
    ['修复', '支付用例已复验通过', '恢复发布', '安排发布'],
  ]
  const notes = Object.fromEntries(updates.map(([id, evidence]) => [id + '.md', evidence]))
  let i = 0, previous = null, summary, overview, entry
  const c = await makeCase({ notes, ctx: { llm: stream(prompt => {
    const [id, evidence, state, next] = updates[i]
    assert.ok(prompt.includes(evidence)); if (previous !== null) assert.ok(prompt.includes(previous))
    const link = `[[进行时/${id}|${evidence}]]`
    summary = i === 3 ? '状态未变：已定位失败范围' : `当前状态：${updates[i - 1]?.[2] ?? '立项'} → ${state}`
    overview = `目标：验证支付流程。${link}，因此${state}。下一步：${next}。`
    entry = `${link}。${state}。`
    return JSON.stringify({ summary, overview, entry }) // 不传手记、旧记录，Host 独立保留它们。
  }) } })
  for (i = 0; i < updates.length; ++i) {
    const id = updates[i][0], path = c.seeded[id + '.md']
    const started = await c.call(i ? 'addProject' : 'openProject', { path, name, filename }); assert.ok(started.ok)
    const job = await waitForJob(c.call, started.value.jobId); assert.equal(job.status, 'done', job.error); assert.equal(job.summary, summary)
    const target = started.value.projectPath
    const updated = await readFile(target, 'utf8'); assert.equal(job.review, true)
    assert.equal(updated.split('## 当前概况')[1].split('## 进展记录')[0].trim(), overview)
    const ledger = text => text.split('## 进展记录')[1].split(manual)[0].trim()
    assert.ok(ledger(updated).endsWith(entry))
    if (previous) { assert.ok(ledger(updated).startsWith(ledger(previous) + '\n')); assert.ok(updated.endsWith(manual + '\n')) }
    assert.match(await readFile(path, 'utf8'), /PROJECT: "\[\[项目\/支付发布-项目\|支付发布\]\]"/)
    if (i === updates.length - 1) {
      assert.ok((await c.call('undoProject', { jobId: job.id })).ok)
      assert.equal(await readFile(target, 'utf8'), previous); assert.equal(await readFile(path, 'utf8'), notes[id + '.md'])
    } else { assert.ok((await c.call('acceptProject', { jobId: job.id })).ok); previous = updated; if (i === 0) { previous += '\n' + manual + '\n'; await writeFile(target, previous) } }
  }
})

const oldLog = '- 当初[[记录/旧|提出方案]]。', old = sheet('准备上线', oldLog)
const fields = { summary: '暂停', overview: '因回归失败暂停', entry: '已暂停发布。' }
for (const [why, answer, stop, code] of [
  ['只给一段进展', '已暂停', 'stop', 'project-revision-invalid'],
  ['漏摘要', JSON.stringify({ ...fields, summary: ' ' }), 'stop', 'project-revision-invalid'],
  ['缺概况', JSON.stringify({ ...fields, overview: '' }), 'stop', 'project-revision-invalid'],
  ['历史无新增', JSON.stringify({ ...fields, entry: '' }), 'stop', 'project-revision-invalid'],
  ['试图引入第二份手记', JSON.stringify({ ...fields, entry: '## 我写的验收口径\n改成分' }), 'stop', 'project-revision-invalid'],
  ['返回合法 JSON 但被截断', JSON.stringify(fields), 'max-tokens', 'llm-token-budget'],
]) test('拒绝不完整的整稿，两份原文均不动：' + why, async () => {
  const c = await makeCase({ notes: { 'A.md': '进展' }, ctx: { llm: stream(() => answer, stop) } })
  const target = join(c.projectDir, filename); await mkdir(c.projectDir); await writeFile(target, old)
  const path = c.seeded['A.md'], started = await c.call('addProject', { path, filename })
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.errorCode, code); assert.ok(!job.review); assert.equal(job.summary, undefined)
  assert.equal(await readFile(target, 'utf8'), old); assert.equal(await readFile(path, 'utf8'), '进展')
})

test('模型重复宿主容器标题时归一化后写入，用户手记与旧记录仍受保护', async () => {
  const wrapped = { ...fields, overview: '## 当前概况\n\n因回归失败暂停', entry: '## 进展记录\n\n已暂停发布。' }
  const c = await makeCase({ notes: { 'A.md': '进展' }, ctx: { llm: stream(() => JSON.stringify(wrapped)) } })
  const target = join(c.projectDir, filename); await mkdir(c.projectDir); await writeFile(target, old)
  const path = c.seeded['A.md'], started = await c.call('addProject', { path, filename })
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done', job.error); assert.equal(job.review, true)
  const updated = await readFile(target, 'utf8')
  assert.ok(updated.includes('## 当前概况\n\n因回归失败暂停'))
  assert.match(updated, /### .+\n\n已暂停发布。/u)
  assert.ok(updated.includes('## 我写的验收口径\n金额要核对到分。  \n```md\n## 当前概况\n```'))
  assert.match(await readFile(path, 'utf8'), /PROJECT: "\[\[项目\/支付发布-项目\|支付发布\]\]"/)
})

test('输入旧稿超过原 12000 字仍包含结尾和 YAML；外部同时编辑时不覆盖', async () => {
  const original = '\uFEFF---\r\ntags: [发布]\r\n---\r\n' + sheet('旧概况', oldLog + '史'.repeat(13000)).replace(/\n/g, '\r\n')
  const note = '证'.repeat(12500) + '便签末尾依据'
  let target
  const c = await makeCase({ notes: { 'A.md': note }, ctx: { llm: stream(async prompt => {
    assert.ok(prompt.includes(original)); assert.ok(prompt.includes(note)); await writeFile(target, '用户并发修改')
    return JSON.stringify(fields)
  }) } }); target = join(c.projectDir, filename); await mkdir(c.projectDir); await writeFile(target, original)
  const path = c.seeded['A.md'], started = await c.call('addProject', { path, filename })
  assert.equal((await waitForJob(c.call, started.value.jobId)).errorCode, 'conflict')
  assert.equal(await readFile(target, 'utf8'), '用户并发修改'); assert.equal(await readFile(path, 'utf8'), note)
})

test('超出整稿输入边界时在调用模型前停止，不使用被裁切的旧稿', async () => {
  let called = false
  const c = await makeCase({ notes: { 'A.md': '进展' }, ctx: { llm: stream(() => { called = true; return '' }) } })
  const target = join(c.projectDir, filename), original = '长'.repeat(LIMITS.projectDocumentChars + 1)
  await mkdir(c.projectDir); await writeFile(target, original)
  const path = c.seeded['A.md'], started = await c.call('addProject', { path, filename })
  assert.equal((await waitForJob(c.call, started.value.jobId)).errorCode, 'project-too-long'); assert.equal(called, false)
  assert.equal(await readFile(target, 'utf8'), original); assert.equal(await readFile(path, 'utf8'), '进展')
})
