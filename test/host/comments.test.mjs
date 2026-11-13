/** host: comments regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { makeCase, waitForJob } from '../../test-support/host.mjs'

test('comment：异步生成后写入 callout，轮询到 done', async () => {
  const c = await makeCase({ notes: { '评论.md': '# 评论标题\n\n评论正文。\n' } })
  const notePath = c.seeded['评论.md']

  const started = await c.call('comment', { path: notePath, emojiId: 'devil' })
  assert.equal(started.ok, true)
  assert.equal(typeof started.value.jobId, 'string')

  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done')
  assert.equal(job.kind, 'comment')
  assert.equal(job.path, notePath)

  const content = await readFile(notePath, 'utf8')
  assert.match(content, /> \[!quote\] 😈 毒舌 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  assert.match(content, /模拟内容/)
  assert.match(content, /评论正文。/)

  const state = await c.call('state')
  const note = state.value.notes.find((item) => item.path === notePath)
  assert.equal(note.commentCount, 1)
  assert.equal(note.comments[0].label, '毒舌')
  assert.equal(note.comments[0].emoji, '😈')
  assert.equal(note.pending, null)
  // 0.12：新评论的 emoji 立刻进入 commentKinds
  assert.deepEqual(note.commentKinds, ['😈'])
  // 卡片按类型汇总：emoji + label + 条数
  assert.deepEqual(note.commentGroups, [{ emoji: '😈', label: '毒舌', count: 1 }])
})

test('comment：emojiId 未知时 bad-request', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })
  const result = await c.call('comment', { path: c.seeded['甲.md'], emojiId: 'nope' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'bad-request')
})

test('comment：llm 不可用时 job.status 为 error 且文件不变', async () => {
  const c = await makeCase({
    notes: { '甲.md': '# 甲\n\n原文\n' },
    ctx: { llm: undefined },
  })
  const notePath = c.seeded['甲.md']
  const before = await readFile(notePath, 'utf8')

  const started = await c.call('comment', { path: notePath, emojiId: 'devil' })
  assert.equal(started.ok, true)
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'error')
  assert.match(job.error, /llm/i)
  assert.equal(await readFile(notePath, 'utf8'), before)
})

test('comment：按这枚 emoji 自己的 AI 预算请求模型', async () => {
  const seen = []
  const c = await makeCase({
    notes: { '预算.md': '# 预算\n\n正文\n' },
    settings: {
      emojis: [
        { id: 'devil', emoji: '😈', label: '毒舌', callout: 'quote', prompt: 'p', ai: { preset: 'custom', reasoningEffort: 'off', maxTokens: 3000 } },
      ],
    },
    ctx: {
      llm: {
        async *stream(options) {
          seen.push(options)
          yield { type: 'text-delta', text: '评论' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    },
  })
  const started = await c.call('comment', { path: c.seeded['预算.md'], emojiId: 'devil' })
  assert.equal(started.ok, true)
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].maxTokens, 3000)
  assert.equal(seen[0].reasoningEffort, 'off')
})

test('comment：思考吃光预算（无正文）→ llm-token-budget，文件不变', async () => {
  const c = await makeCase({
    notes: { '断粮.md': '# 断粮\n\n原文\n' },
    ctx: {
      llm: {
        async *stream() {
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        },
      },
    },
  })
  const notePath = c.seeded['断粮.md']
  const before = await readFile(notePath, 'utf8')

  const started = await c.call('comment', { path: notePath, emojiId: 'devil' })
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'error')
  // 0.13：带错误码，Client 据此弹「去调 AI 预算」提示
  assert.equal(job.errorCode, 'llm-token-budget')
  assert.match(job.error, /思考/)
  assert.equal(await readFile(notePath, 'utf8'), before)
})

test('comment：撞上 token 上限但有正文 → done + truncated，评论仍写入', async () => {
  const c = await makeCase({
    notes: { '半截.md': '# 半截\n\n原文\n' },
    ctx: {
      llm: {
        async *stream() {
          yield { type: 'text-delta', text: '写到一半的评论' }
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        },
      },
    },
  })
  const notePath = c.seeded['半截.md']
  const started = await c.call('comment', { path: notePath, emojiId: 'devil' })
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done')
  assert.equal(job.truncated, true)
  assert.match(await readFile(notePath, 'utf8'), /写到一半的评论/)
})

const TWO_COMMENTS = '# 删除\n\n正文\n\n> [!quote] 😈 毒舌 · 2026-11-13 10:00\n> 第一条\n\n> [!tip] 🌱 落地 · 2026-11-13 10:05\n> 第二条\n'

test('deleteComment：按序号删除 callout，返回汇总并整份撤回', async () => {
  const c = await makeCase({ notes: { '删除.md': TWO_COMMENTS } })
  const notePath = c.seeded['删除.md']
  const note = await c.call('note', { path: notePath })
  assert.equal(note.ok, true)
  assert.equal(note.value.commentCount, 2)
  assert.deepEqual(note.value.commentGroups, [
    { emoji: '😈', label: '毒舌', count: 1 },
    { emoji: '🌱', label: '落地', count: 1 },
  ])

  const deleted = await c.call('deleteComment', {
    path: notePath,
    index: 0,
    expectedTitle: note.value.comments[0].title,
    expectedTime: note.value.comments[0].time,
  })
  assert.equal(deleted.ok, true)
  assert.equal(deleted.value.note.commentCount, 1)
  assert.deepEqual(deleted.value.note.commentGroups, [{ emoji: '🌱', label: '落地', count: 1 }])
  assert.equal(typeof deleted.value.undoToken, 'string')
  const after = await readFile(notePath, 'utf8')
  assert.doesNotMatch(after, /第一条/)
  assert.match(after, /第二条/)

  const undo = await c.call('undoDeleteComment', { undoToken: deleted.value.undoToken })
  assert.equal(undo.ok, true)
  assert.equal(await readFile(notePath, 'utf8'), TWO_COMMENTS)
  assert.equal((await c.call('state')).value.notes.find((item) => item.path === notePath).commentCount, 2)
})

test('deleteComment：序号/标题已被外部修改时拒绝，文件不变', async () => {
  const c = await makeCase({ notes: { '变化.md': TWO_COMMENTS } })
  const notePath = c.seeded['变化.md']
  const note = await c.call('note', { path: notePath })

  const wrong = await c.call('deleteComment', {
    path: notePath,
    index: 0,
    expectedTitle: '另一条评论',
    expectedTime: note.value.comments[0].time,
  })
  assert.equal(wrong.ok, false)
  assert.equal(wrong.error.code, 'conflict')
  assert.equal(await readFile(notePath, 'utf8'), TWO_COMMENTS)

  const outOfRange = await c.call('deleteComment', {
    path: notePath,
    index: 9,
    expectedTitle: note.value.comments[0].title,
    expectedTime: note.value.comments[0].time,
  })
  assert.equal(outOfRange.ok, false)
  assert.equal(outOfRange.error.code, 'conflict')
})

test('undoDeleteComment：删除后文件又被修改则拒绝撤回', async () => {
  const c = await makeCase({ notes: { '再改.md': TWO_COMMENTS } })
  const notePath = c.seeded['再改.md']
  const note = await c.call('note', { path: notePath })
  const deleted = await c.call('deleteComment', {
    path: notePath,
    index: 0,
    expectedTitle: note.value.comments[0].title,
    expectedTime: note.value.comments[0].time,
  })
  assert.equal(deleted.ok, true)
  const external = (await readFile(notePath, 'utf8')) + '\n外部追加\n'
  await writeFile(notePath, external, 'utf8')

  const undo = await c.call('undoDeleteComment', { undoToken: deleted.value.undoToken })
  assert.equal(undo.ok, false)
  assert.equal(undo.error.code, 'conflict')
  assert.equal(await readFile(notePath, 'utf8'), external)
})

test('undoDeleteComment：未知 token 返回 not-found', async () => {
  const c = await makeCase({ notes: { '未知.md': TWO_COMMENTS } })
  const undo = await c.call('undoDeleteComment', { undoToken: 'nope' })
  assert.equal(undo.ok, false)
  assert.equal(undo.error.code, 'not-found')
})
