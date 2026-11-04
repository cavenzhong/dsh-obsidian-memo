/**
 * dsh-sticky-notes —— AI 评论 / 开档 的模型调用。
 *
 * 走 Host 的 `ctx.llm` 抽象：默认模型取自 `ctx.agentDefaultModel`，
 * 不占用任何会话、不写对话记录；失败只影响当前 job。
 * @module dsh-sticky-notes/ai
 */

import { LIMITS, normalizeAi } from './shared.js'

/** 带错误码的错误。 */
function codedError(code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

/** 把模型输出清理成正文：去围栏、去前后空白、限长。 */
export function cleanupModelText(input, maxChars = LIMITS.llmCommentChars) {
  let text = String(input ?? '').trim()
  const fenced = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/u)
  if (fenced) text = fenced[1].trim()
  text = text.replace(/\u0000/g, '').trim()
  return Array.from(text).slice(0, maxChars).join('')
}

/**
 * 调一次模型，收集纯文本。
 * @param {*} ctx - Host 插件上下文。
 * @param {{ system: string, prompt: string, maxTokens?: number, reasoningEffort?: string, timeoutMs?: number }} request
 * @returns {Promise<{ text: string, truncated: boolean }>} truncated = 撞上 token 上限但至少写出了部分正文
 */
export async function generateText(ctx, request) {
  const llm = ctx.get('llm')
  const defaultModel = ctx.get('agentDefaultModel')
  if (llm === undefined || typeof llm.stream !== 'function') throw codedError('llm-unavailable', '当前 profile 没有可用的 llm 服务')
  if (defaultModel === undefined || typeof defaultModel.currentSelection !== 'function') {
    throw codedError('llm-unavailable', '当前 profile 没有默认模型配置')
  }
  let selection
  try {
    selection = defaultModel.currentSelection()
  } catch (error) {
    throw codedError('llm-unavailable', `读不到默认模型：${error?.message ?? error}`, error)
  }
  if (!selection?.provider || !selection?.model) throw codedError('llm-unavailable', '还没有可用的默认模型，请先在 DSH 里选模型')

  // 0.13：单次请求显式带 reasoningEffort / maxTokens（设置里每枚 emoji / 开档各一份）；
  // 缺省时才回退默认模型的思考档位。注意 DeepSeek 的 max_tokens 含思考 token。
  const effort = request.reasoningEffort ?? selection.reasoningEffort

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), request.timeoutMs ?? 180_000)
  let text = ''
  let failure = null
  let truncated = false
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
      system: request.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }] }],
      ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text
        continue
      }
      if (chunk?.type === 'block-end' && chunk.block?.type === 'text' && text.length === 0 && typeof chunk.block.text === 'string') {
        text += chunk.block.text
        continue
      }
      if (chunk?.type === 'finish') {
        const reason = chunk.reason ?? {}
        if (reason.kind === 'error') failure = reason.failure?.message ?? '模型返回错误'
        else if (reason.kind === 'aborted') failure = '生成被取消或超时'
        else if (reason.kind === 'max-tokens') {
          // 有正文 = 被截断（能救）；没正文 = 思考把预算吃光（llm-token-budget，Client 会引导去调设置）。
          if (text.trim() !== '') truncated = true
          else failure = codedError(
            'llm-token-budget',
            `模型把 token 预算用在思考上了，没写出正文（maxTokens ${request.maxTokens ?? '默认'} / 思考档位 ${effort ?? '默认'}）`,
          )
        }
      }
    }
  } catch (error) {
    const message = error?.message ?? String(error)
    throw codedError('llm-failed', `模型调用失败：${message}`, error)
  } finally {
    clearTimeout(timeout)
  }
  if (failure !== null) throw failure instanceof Error ? failure : codedError('llm-failed', failure)
  const result = cleanupModelText(text)
  if (result === '') throw codedError('llm-failed', '模型返回了空内容')
  return { text: result, truncated }
}

/** 把便签内容渲染成给模型看的纯文本。 */
export function renderNoteForModel(note) {
  const lines = []
  if (note.title) lines.push(`标题：${note.title}`)
  if (note.blocks?.length) {
    lines.push('', '正文：')
    for (const block of note.blocks) {
      const prefix = block.kind === 'li' ? '- ' : block.kind === 'h' ? '## ' : block.kind === 'quote' ? '> ' : ''
      lines.push(`${prefix}${block.text}`)
    }
  }
  if (note.comments?.length) {
    lines.push('', '已有评论：')
    for (const comment of note.comments.slice(-3)) {
      lines.push(`- ${comment.emoji ? `${comment.emoji} ` : ''}${comment.label}：${comment.text}`)
    }
  }
  const joined = lines.join('\n')
  return Array.from(joined).slice(0, 12_000).join('')
}

/** 评论请求：emoji 的提示词 = system，便签内容 = user；预算取这枚 emoji 的 ai。 */
export function buildCommentRequest(note, emoji) {
  const ai = normalizeAi(emoji?.ai)
  return {
    system: `${emoji.prompt}\n\n输出要求：只输出评论正文本身；不要复述原文；不要加标题、列表符号或代码围栏；中文。`,
    prompt: `下面是一张 Obsidian 便签的内容：\n\n${renderNoteForModel(note)}\n\n请直接写评论。`,
    maxTokens: ai.maxTokens,
    reasoningEffort: ai.reasoningEffort,
  }
}

/** 开档请求：结构化建档提示词 = system，便签内容 = user；预算取设置里的 projectAi。 */
export function buildProjectRequest(note, projectPrompt, projectName, ai) {
  const budget = normalizeAi(ai)
  return {
    system: projectPrompt,
    prompt: `项目名：${projectName}\n\n便签内容：\n\n${renderNoteForModel(note)}\n\n请输出结构化项目文档正文。`,
    maxTokens: budget.maxTokens,
    reasoningEffort: budget.reasoningEffort,
  }
}

/** 去掉路径扩展名，给 wikilink 用。 */
function withoutExt(relPath) {
  return String(relPath ?? '').replace(/\.md$/i, '')
}

/**
 * 拼出项目 md：frontmatter（PROJECTS 指向源便签）+ 模型正文 + 来源。
 * @param {{ name: string, generated: string, sourceRelPath: string, sourceTitle: string }} input
 */
export function buildProjectDocument(input) {
  const sourceLink = `[[${withoutExt(input.sourceRelPath)}|${input.sourceTitle}]]`
  const frontmatter = ['---', `PROJECTS: "${sourceLink.replace(/"/g, '\\"')}"`, 'TODO: []', '---', ''].join('\n')
  const generated = String(input.generated ?? '').trim()
  const heading = /^#\s/u.test(generated) ? '' : `# ${input.name}\n\n`
  return `${frontmatter}${heading}${generated}\n\n## 来源\n- ${sourceLink}\n`
}

/** 项目 md 里指向源便签的链接文本（给源便签写回用）。 */
export function sourceWikilink(projectRelPath, projectName) {
  return `[[${withoutExt(projectRelPath)}|${projectName}]]`
}
