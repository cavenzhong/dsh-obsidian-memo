/** host: projects regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { ROOT, exists, makeCase, waitForJob } from '../../test-support/host.mjs'

test('openProject：生成项目 md、写回源便签 PROJECTS，轮询到 done', async () => {
  const c = await makeCase({ notes: { '便签.md': '# 便签标题\n\n说明一段。\n' } })
  const sourcePath = c.seeded['便签.md']

  const started = await c.call('openProject', { path: sourcePath, name: '测试项目' })
  assert.equal(started.ok, true)
  assert.equal(typeof started.value.jobId, 'string')
  assert.equal(started.value.projectPath, join(c.projectDir, '测试项目', '测试项目.md'))

  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done')
  assert.equal(job.kind, 'project')

  const projectPath = join(c.projectDir, '测试项目', '测试项目.md')
  assert.equal(await exists(projectPath), true)
  const document = await readFile(projectPath, 'utf8')
  // sourceTitle 来自 note.title = 文件名：内容里的 `# 便签标题` 不应出现在 alias 里
  assert.match(document, /^---\nPROJECTS: "\[\[进行时\/便签\|便签\]\]"\n/)
  assert.doesNotMatch(document, /便签标题/)
  assert.match(document, /# 测试项目/)
  assert.match(document, /模拟内容/)
  assert.match(document, /## 来源/)
  assert.match(document, /\[\[进行时\/便签\|便签\]\]/)

  const source = await readFile(sourcePath, 'utf8')
  assert.match(source, /^---\nPROJECTS: "\[\[项目\/测试项目\/测试项目\|测试项目\]\]"\n---\n\n# 便签标题/)
  assert.equal(job.link, 'linked')

  const noteResult = await c.call('note', { path: sourcePath })
  assert.equal(noteResult.ok, true)
  assert.match(noteResult.value.projects, /\[\[项目\/测试项目\/测试项目\|测试项目\]\]/)
})

test('openProject：重名 exists、空项目名 bad-request、未配置开档目录 not-configured', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n\n正文\n' } })
  const sourcePath = c.seeded['甲.md']

  const empty = await c.call('openProject', { path: sourcePath, name: '   ' })
  assert.equal(empty.ok, false)
  assert.equal(empty.error.code, 'bad-request')

  const started = await c.call('openProject', { path: sourcePath, name: '重名项目' })
  assert.equal(started.ok, true)
  await waitForJob(c.call, started.value.jobId)

  const duplicate = await c.call('openProject', { path: sourcePath, name: '重名项目' })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.error.code, 'exists')
})

test('openProject：按 projectAi 的预算请求模型，撞上限但有正文时 job.truncated', async () => {
  const seen = []
  const c = await makeCase({
    notes: { '开档.md': '# 开档\n\n正文\n' },
    settings: { projectAi: { preset: 'custom', reasoningEffort: 'low', maxTokens: 5000 } },
    ctx: {
      llm: {
        async *stream(options) {
          seen.push(options)
          yield { type: 'text-delta', text: '# 半截项目\n\n正文' }
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        },
      },
    },
  })
  const started = await c.call('openProject', { path: c.seeded['开档.md'], name: '截断项目' })
  assert.equal(started.ok, true)
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done')
  assert.equal(job.truncated, true)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].maxTokens, 5000)
  assert.equal(seen[0].reasoningEffort, 'low')
  const document = await readFile(join(c.projectDir, '截断项目', '截断项目.md'), 'utf8')
  assert.match(document, /半截项目/)
})

test('openProject：未配置 / 仓库外开档目录被拒绝', async () => {
  const unconfigured = await makeCase({
    notes: { '甲.md': '# 甲\n' },
    settings: { projectDir: '' },
  })
  const missing = await unconfigured.call('openProject', {
    path: unconfigured.seeded['甲.md'],
    name: '项目甲',
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'not-configured')

  const outsideDir = join(ROOT, 'outside-projects')
  const outside = await makeCase({
    notes: { '甲.md': '# 甲\n' },
    settings: { projectDir: outsideDir },
  })
  const rejected = await outside.call('openProject', {
    path: outside.seeded['甲.md'],
    name: '项目甲',
  })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'bad-request')
})
