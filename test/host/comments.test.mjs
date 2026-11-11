/** host: comments regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
