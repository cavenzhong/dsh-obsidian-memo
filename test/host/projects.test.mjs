/** host: projects regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { ROOT, exists, makeCase, waitForJob } from '../../test-support/host.mjs'

test('openProject：生成项目整稿和验收摘要、写回源便签 PROJECT，轮询到 done', async () => {
  const c = await makeCase({ notes: { '便签.md': '# 便签标题\n\n说明一段。\n' } })
  const sourcePath = c.seeded['便签.md']

  const started = await c.call('openProject', { path: sourcePath, name: '测试项目' })
  assert.equal(started.ok, true)
  assert.equal(typeof started.value.jobId, 'string')
  assert.equal(started.value.projectPath, join(c.projectDir, '测试项目-项目.md'))

  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done')
  assert.equal(job.kind, 'project')

  const projectPath = join(c.projectDir, '测试项目-项目.md')
  assert.equal(await exists(projectPath), true)
  const document = await readFile(projectPath, 'utf8')
  // Host 给出真实路径；别名由模型选择，不覆盖为便签文件名。
  assert.match(document, /^# 测试项目/)
  assert.doesNotMatch(document, /便签标题/)
  assert.match(document, /# 测试项目/)
  assert.match(document, /模拟内容/)
  assert.match(document, /## 当前概况/)
  assert.match(document, /## 进展记录/)
  assert.ok(!document.includes('## 来源'))
  assert.equal(job.summary, '已建立模拟项目')
  assert.match(document, /\[\[进行时\/便签\|本次判断的依据\]\]/)

  const source = await readFile(sourcePath, 'utf8')
  assert.match(source, /^---\nPROJECT: "\[\[项目\/测试项目-项目\|测试项目\]\]"\n---\n\n# 便签标题/)
  assert.equal(job.link, 'linked')

  const noteResult = await c.call('note', { path: sourcePath })
  assert.equal(noteResult.ok, true)
  assert.match(noteResult.value.projects, /\[\[项目\/测试项目-项目\|测试项目\]/)
})

test('aiModels：列出默认模型与所有已注册 provider 的模型，单个 provider 失败不影响结果', async () => {
  const c = await makeCase({
    notes: { '模型.md': '# 模型\n' },
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) },
      llm: {
        async *stream() {},
        listProviders: () => [
          { id: 'deepseek-account', name: 'DeepSeek' },
          { id: 'neko-gemini', name: 'NEKO-GEMINI4' },
          { id: 'broken', name: 'Broken' },
        ],
        async listModels(provider) {
          if (provider === 'broken') throw new Error('no adapter')
          return provider === 'deepseek-account'
            ? [
              { provider: 'deepseek-account', id: 'deepseek-flash', name: 'DeepSeek Flash' },
              { provider: 'deepseek-account', id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
            ]
            : [{ provider: 'neko-gemini', id: 'gemini-4-argon', name: 'gemini-4-argon' }]
        },
      },
    },
  })

  const result = await c.call('aiModels', {})
  assert.equal(result.ok, true)
  assert.equal(result.value.default.model, 'deepseek-flash')
  assert.deepEqual(result.value.models.map((item) => `${item.provider}/${item.model}`), [
    'deepseek-account/deepseek-flash',
    'deepseek-account/deepseek-reasoner',
    'neko-gemini/gemini-4-argon',
  ])
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

test('openProject：按 projectAi 预算请求；哪怕已有正文，截断也不新建或写入归属', async () => {
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
  assert.equal(job.status, 'error')
  assert.equal(job.errorCode, 'llm-token-budget')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].maxTokens, 5000)
  assert.equal(seen[0].reasoningEffort, 'low')
  assert.equal(await exists(join(c.projectDir, '截断项目-项目.md')), false)
  assert.equal(await readFile(c.seeded['开档.md'], 'utf8'), '# 开档\n\n正文\n')
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
