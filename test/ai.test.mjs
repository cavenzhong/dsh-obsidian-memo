/**
 * lib/ai.js 的单测：输出清理、项目文档拼装、请求构造、模型调用的成功/失败路径。
 * 全部用假 llm，不发网络请求。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCommentRequest,
  buildProjectDocument,
  buildProjectRequest,
  cleanupModelText,
  generateText,
  renderNoteForModel,
  sourceWikilink,
} from '../lib/ai.js'

/* ────────────────────────────── 纯函数 ────────────────────────────── */

test('cleanupModelText：去首尾空白、去 NUL、限长', () => {
  assert.equal(cleanupModelText('  \n 正文 \n '), '正文')
  assert.equal(cleanupModelText('a\u0000b'), 'ab')
  assert.equal(cleanupModelText('abcdef', 3), 'abc')
  assert.equal(cleanupModelText(''), '')
  assert.equal(cleanupModelText(null), '')
})

test('cleanupModelText：整段代码围栏被剥掉', () => {
  assert.equal(cleanupModelText('```md\n# 标题\n正文\n```'), '# 标题\n正文')
  assert.equal(cleanupModelText('```\n正文\n```'), '正文')
  // 不是「整段就是围栏」时保留原文
  assert.equal(cleanupModelText('前言\n```js\nx\n```'), '前言\n```js\nx\n```')
})

test('buildProjectDocument：frontmatter 指向源便签、无重复标题、带来源', () => {
  const document = buildProjectDocument({
    name: '甲',
    generated: '# 甲\n\n正文内容',
    sourceRelPath: '进行时/a.md',
    sourceTitle: 'A',
  })
  assert.equal(
    document,
    '---\nPROJECTS: "[[进行时/a|A]]"\nTODO: []\n---\n# 甲\n\n正文内容\n\n## 来源\n- [[进行时/a|A]]\n',
  )
})

test('buildProjectDocument：模型正文没有标题时补一个', () => {
  const document = buildProjectDocument({
    name: '乙',
    generated: '只有正文',
    sourceRelPath: '进行时/b.md',
    sourceTitle: 'B',
  })
  assert.match(document, /^---\nPROJECTS: "\[\[进行时\/b\|B\]\]"\nTODO: \[\]\n---\n# 乙\n\n只有正文\n\n## 来源/)
})

test('buildProjectDocument：来源路径/标题里的双引号被转义', () => {
  const sourceRelPath = '进行时/c "引号".md'
  const sourceTitle = 'C "引号"'
  const document = buildProjectDocument({ name: '丙', generated: '正文', sourceRelPath, sourceTitle })
  const escapedLink = '[[进行时/c \\"引号\\"|C \\"引号\\"]]'
  assert.ok(document.startsWith(`---\nPROJECTS: "${escapedLink}"\nTODO: []\n---\n`))
})

test('buildCommentRequest：emoji 提示词进 system，便签内容进 prompt，预算默认高', () => {
  const request = buildCommentRequest(
    { title: '标题', blocks: [{ kind: 'p', text: '一段正文' }], comments: [] },
    { prompt: '你是评论者' },
  )
  assert.match(request.system, /^你是评论者/)
  assert.match(request.system, /只输出评论正文本身/)
  assert.match(request.prompt, /标题：标题/)
  assert.match(request.prompt, /一段正文/)
  // 0.13：每枚 emoji 自带 AI 预算；缺省时回退默认高（high / 8192）。
  assert.equal(request.maxTokens, 8192)
  assert.equal(request.reasoningEffort, 'high')
})

test('buildCommentRequest：emoji.ai 的预设/自定义预算进入请求', () => {
  const note = { title: 'T', blocks: [], comments: [] }
  const low = buildCommentRequest(note, { prompt: 'p', ai: { preset: 'low' } })
  assert.equal(low.maxTokens, 2048)
  assert.equal(low.reasoningEffort, 'off')

  const custom = buildCommentRequest(note, { prompt: 'p', ai: { preset: 'custom', reasoningEffort: 'max', maxTokens: 12345 } })
  assert.equal(custom.maxTokens, 12345)
  assert.equal(custom.reasoningEffort, 'max')

  // 非自定义档以预设映射为准，手改的数值不生效。
  const forced = buildCommentRequest(note, { prompt: 'p', ai: { preset: 'medium', reasoningEffort: 'max', maxTokens: 1 } })
  assert.equal(forced.maxTokens, 4096)
  assert.equal(forced.reasoningEffort, 'low')
})

test('buildProjectRequest：建档提示词进 system，项目名与便签内容进 prompt，预算默认高', () => {
  const request = buildProjectRequest(
    { title: '标题', blocks: [], comments: [] },
    '建档提示词',
    '新项目',
  )
  assert.equal(request.system, '建档提示词')
  assert.match(request.prompt, /项目名：新项目/)
  assert.match(request.prompt, /标题：标题/)
  assert.equal(request.maxTokens, 8192)
  assert.equal(request.reasoningEffort, 'high')
})

test('buildProjectRequest：projectAi 预算进入请求', () => {
  const request = buildProjectRequest(
    { title: '标题', blocks: [], comments: [] },
    '建档提示词',
    '新项目',
    { preset: 'custom', reasoningEffort: 'low', maxTokens: 3000 },
  )
  assert.equal(request.maxTokens, 3000)
  assert.equal(request.reasoningEffort, 'low')
})

test('renderNoteForModel：块前缀与最近 3 条评论', () => {
  const rendered = renderNoteForModel({
    title: 'T',
    blocks: [
      { kind: 'p', text: '段落' },
      { kind: 'li', text: '列表' },
      { kind: 'h', text: '标题二' },
      { kind: 'quote', text: '引用' },
      { kind: 'code', text: '代码' },
    ],
    comments: [
      { emoji: '🔍', label: '洞察', text: '一' },
      { emoji: '💡', label: '延伸', text: '二' },
      { emoji: '⚠️', label: '风险', text: '三' },
      { emoji: '✅', label: '下一步', text: '四' },
    ],
  })
  assert.match(rendered, /^标题：T/)
  assert.match(rendered, /\n- 列表\n/)
  assert.match(rendered, /\n## 标题二\n/)
  assert.match(rendered, /\n> 引用\n/)
  assert.match(rendered, /\n代码\n/)
  // 只保留最后 3 条评论
  assert.doesNotMatch(rendered, /洞察：一/)
  assert.match(rendered, /延伸：二/)
  assert.match(rendered, /下一步：四/)
})

test('renderNoteForModel：标题（现在=文件名）与 blocks 首段都进入模型文本', () => {
  // 新行为：note.title 由 Host/scan 填成 md 文件名；首段不再从 blocks 剔除，
  // 因此评论/开档请求里既能看到文件名标题，也能看到第一段正文。
  const rendered = renderNoteForModel({
    title: '便签',
    blocks: [
      { kind: 'p', text: '这是首段正文。' },
      { kind: 'p', text: '这是第二段。' },
    ],
    comments: [],
  })
  assert.match(rendered, /^标题：便签/)
  assert.match(rendered, /这是首段正文。/)
  assert.match(rendered, /这是第二段。/)
})

test('renderNoteForModel：空便签不炸', () => {
  assert.equal(renderNoteForModel({}), '')
  assert.equal(renderNoteForModel({ title: '', blocks: [], comments: [] }), '')
})

test('sourceWikilink：去掉 .md 并生成别名', () => {
  assert.equal(sourceWikilink('项目/甲/甲.md', '甲'), '[[项目/甲/甲|甲]]')
  assert.equal(sourceWikilink('项目/乙.md', '乙'), '[[项目/乙|乙]]')
})

/* ───────────────────────────── generateText ───────────────────────────── */

/** 造一个 mock ctx，llm 的 stream 由 chunks 决定；calls 记录每次 stream 的 options。 */
function mockCtx({ chunks = [], throwAt, selection = { provider: 'mock', model: 'mock' }, withModel = true } = {}) {
  const calls = []
  const llm = {
    async *stream(options) {
      calls.push(options)
      if (throwAt === 'stream') throw new Error('网络断了')
      for (const chunk of chunks) yield chunk
    },
  }
  return {
    calls,
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') {
        if (!withModel) return undefined
        return {
          currentSelection() {
            if (throwAt === 'selection') throw new Error('没选模型')
            return selection
          },
        }
      }
      return undefined
    },
  }
}

const REQUEST = { system: 'sys', prompt: 'user' }

test('generateText：拼接 text-delta，忽略 finish stop', async () => {
  const generated = await generateText(
    mockCtx({
      chunks: [
        { type: 'text-delta', text: '第一段' },
        { type: 'text-delta', text: '第二段' },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    }),
    REQUEST,
  )
  assert.equal(generated.text, '第一段第二段')
  assert.equal(generated.truncated, false)
})

test('generateText：block-end 兜底文本', async () => {
  const generated = await generateText(
    mockCtx({
      chunks: [
        { type: 'block-end', block: { type: 'text', text: '整块文本' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    }),
    REQUEST,
  )
  assert.equal(generated.text, '整块文本')
})

test('generateText：剥掉整段代码围栏', async () => {
  const generated = await generateText(
    mockCtx({
      chunks: [
        { type: 'text-delta', text: '```md\n# 标题\n```' },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    }),
    REQUEST,
  )
  assert.equal(generated.text, '# 标题')
})

test('generateText：reasoningEffort / maxTokens 原样传给 llm.stream', async () => {
  const ctx = mockCtx({ chunks: [{ type: 'text-delta', text: 'x' }, { type: 'finish', reason: { kind: 'stop' } }] })
  await generateText(ctx, { ...REQUEST, reasoningEffort: 'off', maxTokens: 2048 })
  assert.equal(ctx.calls[0].reasoningEffort, 'off')
  assert.equal(ctx.calls[0].maxTokens, 2048)
})

test('generateText：请求没带思考档位时回退默认模型的档位', async () => {
  const ctx = mockCtx({
    chunks: [{ type: 'text-delta', text: 'x' }, { type: 'finish', reason: { kind: 'stop' } }],
    selection: { provider: 'mock', model: 'mock', reasoningEffort: 'max' },
  })
  await generateText(ctx, REQUEST)
  assert.equal(ctx.calls[0].reasoningEffort, 'max')
})

test('generateText：llm 服务缺失 → llm-unavailable', async () => {
  await assert.rejects(
    generateText({ get: () => undefined }, REQUEST),
    (error) => error.code === 'llm-unavailable',
  )
})

test('generateText：默认模型缺失 / 读取异常 / 未选模型 → llm-unavailable', async () => {
  await assert.rejects(
    generateText(mockCtx({ withModel: false }), REQUEST),
    (error) => error.code === 'llm-unavailable',
  )
  await assert.rejects(
    generateText(mockCtx({ throwAt: 'selection' }), REQUEST),
    (error) => error.code === 'llm-unavailable',
  )
  await assert.rejects(
    generateText(mockCtx({ selection: {} }), REQUEST),
    (error) => error.code === 'llm-unavailable',
  )
})

test('generateText：流抛错 → llm-failed 且带原因', async () => {
  await assert.rejects(
    generateText(mockCtx({ throwAt: 'stream' }), REQUEST),
    (error) => error.code === 'llm-failed' && /网络断了/.test(error.message),
  )
})

test('generateText：finish error / aborted → llm-failed；max-tokens 且无正文 → llm-token-budget', async () => {
  for (const reason of [{ kind: 'error', failure: { message: '模型挂了' } }, { kind: 'aborted' }]) {
    await assert.rejects(
      generateText(mockCtx({ chunks: [{ type: 'finish', reason }] }), REQUEST),
      (error) => error.code === 'llm-failed',
    )
  }
  // 0.13：思考把预算吃光、正文为空 → 单独错误码，Client 据此弹「去调 AI 预算」提示。
  await assert.rejects(
    generateText(mockCtx({ chunks: [{ type: 'finish', reason: { kind: 'max-tokens' } }] }), { ...REQUEST, maxTokens: 500, reasoningEffort: 'high' }),
    (error) => error.code === 'llm-token-budget' && /思考/.test(error.message),
  )
})

test('generateText：max-tokens 但有正文时算成功并标记 truncated', async () => {
  const generated = await generateText(
    mockCtx({
      chunks: [
        { type: 'text-delta', text: '已经写出的内容' },
        { type: 'finish', reason: { kind: 'max-tokens' } },
      ],
    }),
    REQUEST,
  )
  assert.equal(generated.text, '已经写出的内容')
  assert.equal(generated.truncated, true)
})

test('generateText：模型返回空内容 → llm-failed', async () => {
  await assert.rejects(
    generateText(mockCtx({ chunks: [{ type: 'finish', reason: { kind: 'stop' } }] }), REQUEST),
    (error) => error.code === 'llm-failed' && /空内容/.test(error.message),
  )
})
