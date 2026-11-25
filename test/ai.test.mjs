/**
 * lib/ai.js 的单测：输出清理、评论请求构造与模型调用的成功/失败路径。
 * 全部用假 llm，不发网络请求。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCommentRequest,
  cleanupModelText,
  generateText,
  modelCatalog,
  renderNoteForModel,
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

test('buildCommentRequest：emoji 提示词进 system，便签内容进 prompt，预算默认高', () => {
  const request = buildCommentRequest(
    { title: '标题', body: '一段正文' },
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

test('renderNoteForModel：原始 Markdown 不受展示块与评论上限影响', () => {
  const body = '# 正文\n\n' + '长'.repeat(2100) + '段尾信息\n\n> [!quote] 😈 评论\n> 原始评论'
  const rendered = renderNoteForModel({ title: '便签', body, blocks: [{ kind: 'p', text: '已裁切的展示内容' }] })
  assert.match(rendered, /^标题：便签/)
  assert.ok(rendered.includes(body))
  assert.doesNotMatch(rendered, /已裁切的展示内容/)
})

test('renderNoteForModel：空文本与超长输入有明确边界提示', () => {
  assert.equal(renderNoteForModel({}), '')
  const rendered = renderNoteForModel({ body: '🙂'.repeat(13000) })
  assert.equal(Array.from(rendered).length, 12000)
  assert.match(rendered, /后续内容未提供/)
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


test('modelCatalog：遍历已注册 provider 的模型目录，默认模型排最前并去重', async () => {
  const calls = []
  const result = await modelCatalog({
    get(name) {
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) }
      if (name === 'llm') return {
        listProviders: () => [
          { id: 'deepseek-account', name: 'DeepSeek' },
          { id: 'neko-gemini', name: 'NEKO-GEMINI4' },
          { id: 'broken', name: 'Broken' },
        ],
        listModels: async (provider) => {
          calls.push(provider)
          if (provider === 'broken') throw new Error('no adapter')
          return provider === 'deepseek-account'
            ? [
              { provider: 'deepseek-account', id: 'deepseek-flash', name: 'DeepSeek Flash' },
              { provider: 'deepseek-account', id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
            ]
            : [{ provider: 'neko-gemini', id: 'gemini-4-argon', name: 'gemini-4-argon' }]
        },
      }
      return undefined
    },
  })
  // 每个 listModels 都必须带显式 provider；失败的那个 provider 不能拖垮整个目录。
  assert.deepEqual(calls, ['deepseek-account', 'neko-gemini', 'broken'])
  assert.deepEqual(result.models.map((item) => `${item.provider}/${item.model}`), [
    'deepseek-account/deepseek-flash',
    'deepseek-account/deepseek-reasoner',
    'neko-gemini/gemini-4-argon',
  ])
  assert.equal(result.models[0].label, 'DeepSeek / DeepSeek Flash')
})

test('modelCatalog：没有默认模型时仍列出模型目录', async () => {
  const result = await modelCatalog({
    get: (name) => name === 'llm' ? {
      listProviders: () => ['solo'],
      listModels: async () => [{ provider: 'solo', id: 'm1', name: 'M1' }],
    } : undefined,
  })
  assert.equal(result.default, null)
  assert.deepEqual(result.models, [{ provider: 'solo', model: 'm1', label: 'solo / M1' }])
})


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

test('generateText：provider 不接受思考档位时去掉 effort 重试一次', async () => {
  const calls = []
  const ctx = {
    get(name) {
      if (name === 'llm') {
        return {
          async *stream(options) {
            calls.push(options)
            if (calls.length === 1) {
              const error = new Error('provider "neko-gemini" model "gemini-4-argon" does not support reasoning effort "high"')
              error.code = 'UNSUPPORTED_REASONING_EFFORT'
              throw error
            }
            yield { type: 'text-delta', text: 'ok' }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        }
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'neko-gemini', model: 'gemini-4-argon' }) }
      return undefined
    },
  }
  const generated = await generateText(ctx, { ...REQUEST, reasoningEffort: 'high' })
  assert.equal(generated.text, 'ok')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].reasoningEffort, 'high')
  assert.equal(calls[1].reasoningEffort, undefined)
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

test('generateText：评论达到字符上限时标记 truncated', async () => {
  const ctx = {
    get(key) {
      return key === 'llm'
        ? { async *stream() { yield { type: 'text-delta', text: '字'.repeat(5000) }; yield { type: 'finish', reason: { kind: 'stop' } } } }
        : { currentSelection: () => ({ provider: 'mock', model: 'mock' }) }
    },
  }
  const comment = await generateText(ctx, buildCommentRequest({ body: '正文' }, { prompt: '评论' }))
  assert.equal(comment.text.length, 4000)
  assert.equal(comment.truncated, true)
})

test('模型目录支持异步 provider 列表，同时隔离同步抛错与异步拒绝', async () => {
  const llm = { listProviders: async () => ['async-fail', 'sync-fail', 'ok'], listModels(provider) {
    if (provider === 'async-fail') return Promise.reject(new Error('offline'))
    if (provider === 'sync-fail') throw new Error('NO_ADAPTER')
    return [{ id: 'm' }]
  } }
  const ctx = { get: name => name === 'llm' ? llm : null }
  assert.deepEqual((await modelCatalog(ctx)).models.map(m => m.provider), ['ok'])
  llm.listProviders = async () => { throw new Error('offline') }
  assert.deepEqual((await modelCatalog(ctx)).models, [])
})
