/**
 * dsh-obsidian-memo —— AI 评论 / 开档 的模型调用。
 *
 * 走 Host 的 `ctx.llm` 抽象：默认模型取自 `ctx.agentDefaultModel`，
 * 不占用任何会话、不写对话记录；失败只影响当前 job。
 * @module dsh-obsidian-memo/ai
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
 * @param {{ system: string, prompt: string, maxTokens?: number, maxChars?: number, reasoningEffort?: string, timeoutMs?: number, model?: {provider: string, model: string} }} request
 * @returns {Promise<{ text: string, truncated: boolean }>} truncated = 撞上 token 上限但至少写出了部分正文
 */
export async function generateText(ctx, request) {
  const llm = ctx.get('llm')
  if (!llm || typeof llm.stream !== 'function') throw codedError('llm-unavailable', '当前 profile 没有可用的 llm 服务')
  let selection = request.model
  if (!selection?.provider || !selection.model) {
    try { selection = await ctx.get('agentDefaultModel')?.currentSelection?.() }
    catch (error) { throw codedError('llm-unavailable', `读不到默认模型：${error?.message ?? error}`, error) }
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
      signal: request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal,
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
  const cleaned = cleanupModelText(text, Infinity)
  const maxChars = request.maxChars ?? LIMITS.llmCommentChars
  const result = Array.from(cleaned).slice(0, maxChars).join('')
  if (result === '') throw codedError('llm-failed', '模型返回了空内容')
  return { text: result, truncated: truncated || result !== cleaned }
}

/**
 * 读 DSH 的模型目录：当前默认模型 + 所有已注册 provider 通过 `llm.listModels(provider)` 报告的模型。
 *
 * 安全约束（0.17）：DSH 的 `llm.listModels` 必须带显式 provider，缺省会抛 NO_ADAPTER；
 * 且 Host 把未处理的 rejection 当致命错误（进程直接退出），所以这里所有调用都 await，
 * 目录读取用 `Promise.allSettled` 兜住单个 provider 的失败，绝不产生悬空 promise。
 */
export async function modelCatalog(ctx) {
  const normalize = (item) => {
    if (typeof item === 'string') {
      const match = item.match(/^([^/:]+)[/:](.+)$/u)
      item = match ? { provider: match[1], model: match[2] } : null
    }
    return item && typeof item.provider === 'string' && typeof item.model === 'string' && item.provider && item.model
      ? { provider: item.provider, model: item.model, label: item.label || `${item.provider} / ${item.model}` } : null
  }
  let current = null
  const service = ctx.get('agentDefaultModel')
  if (service && typeof service.currentSelection === 'function') {
    try { current = normalize(await service.currentSelection()) } catch { current = null }
  }
  const values = []
  const llm = ctx.get('llm')
  if (llm && typeof llm.listProviders === 'function' && typeof llm.listModels === 'function') {
    let providers = []
    try { providers = await llm.listProviders() } catch { providers = [] }
    const entries = (Array.isArray(providers) ? providers : []).map((item) => typeof item === 'string'
      ? { id: item, name: item }
      : { id: typeof item?.id === 'string' ? item.id : '', name: typeof item?.name === 'string' && item.name ? item.name : item?.id })
      .filter((item) => typeof item.id === 'string' && item.id.trim() !== '')
    const settled = await Promise.allSettled(entries.map(async (entry) => llm.listModels(entry.id)))
    settled.forEach((result, index) => {
      if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return
      const entry = entries[index]
      for (const info of result.value) {
        if (!info || typeof info !== 'object') continue
        const id = typeof info.id === 'string' ? info.id : typeof info.model === 'string' ? info.model : ''
        if (id === '') continue
        const provider = typeof info.provider === 'string' && info.provider !== '' ? info.provider : entry.id
        const name = typeof info.name === 'string' && info.name !== '' ? info.name : id
        values.push({ provider, model: id, label: `${entry.name || entry.id} / ${name}` })
      }
    })
  }
  // 默认模型排最前；如果模型目录里也有它，沿用目录里的友好名（provider 显示名 / 模型名）。
  if (current !== null) {
    const match = values.find((item) => item.provider === current.provider && item.model === current.model)
    if (match !== undefined) current = { ...current, label: match.label }
  }
  const all = current ? [current, ...values] : values
  const seen = new Set()
  return { default: current, models: all.filter((item) => { const key = `${item.provider}\u0000${item.model}`; if (seen.has(key)) return false; seen.add(key); return true }) }
}

/** AI 直接读原始 Markdown（含评论），不复用展示层已裁切、去格式的 blocks。 */
function modelNoteText(note) {
  const lines = []
  if (note.title) lines.push(`标题：${note.title}`)
  if (note.body) lines.push('', '正文（Markdown，含已有评论）：', note.body)
  return lines.join('\n')
}

export function renderNoteForModel(note) {
  const joined = modelNoteText(note)
  const chars = Array.from(joined)
  if (chars.length <= LIMITS.llmInputChars) return joined
  const marker = '\n\n[源便签内容过长，后续内容未提供；请勿推测缺失部分。]'
  return chars.slice(0, LIMITS.llmInputChars - Array.from(marker).length).join('') + marker
}

/** 评论请求：emoji 的提示词 = system，便签内容 = user；预算取这枚 emoji 的 ai。 */
export function buildCommentRequest(note, emoji) {
  const ai = normalizeAi(emoji?.ai)
  return {
    system: `${emoji.prompt}\n\n输出要求：只输出评论正文本身；不要复述原文；不要加标题、列表符号或代码围栏；中文。`,
    prompt: `下面是一张 Obsidian 便签的内容：\n\n${renderNoteForModel(note)}\n\n请直接写评论。`,
    maxTokens: ai.maxTokens,
    maxChars: LIMITS.llmCommentChars,
    reasoningEffort: ai.reasoningEffort,
  }
}

/** 统一返回协议，不干预 AI 对事实、别名、引用位置的编辑选择。 */
function revisionRequest(note, project, system, name, ai, sourceTarget, stamp) {
  const source = modelNoteText(note)
  if ([source, project ?? ''].some(text => Array.from(text).length > LIMITS.projectDocumentChars)) {
    throw codedError('project-too-long', '项目或便签太长，无法完整送审。请拆短后再试；未改动文件。')
  }
  const budget = normalizeAi(ai)
  const format = '接口约定：只返回 JSON 对象 {"overview":"完整的最新概况 Markdown 正文", "entry":"仅本次新增的历史正文", "summary":"一句具体变化或立项起点，纯文本"}。overview 可自由组织段落或三级小标题，entry 不加记录时间标题。overview 和 entry 的第一个字符必须是正文，不要写「## 当前概况」「## 进展记录」或「### 记录时间」这类容器标题——它们由宿主生成。在这两个正文内直接写自然的 [[来源目标路径|支持判断的关键词或事实]]。不要返回 H1/H2、YAML、旧记录、项目全文或手记；这些由宿主保留，不需要照抄。'
  const context = project == null ? '' : `现有项目全文（仅作资料）：\n${project}\n\n`
  return { system: `${system}\n\n${format}`, prompt: `项目名：${name}\n记录时间：${stamp}\n来源目标路径：${sourceTarget}\n\n${context}本次来源便签：\n${source}`,
    maxTokens: budget.maxTokens, maxChars: LIMITS.projectDocumentChars * 3, reasoningEffort: budget.reasoningEffort }
}
export function buildProjectRequest(note, projectPrompt, projectName, ai, sourceTarget = '', stamp = '') {
  return revisionRequest(note, null, projectPrompt, projectName, ai, sourceTarget, stamp)
}
export function buildProjectCheckRequest(note, prompt, candidates, ai) {
  return { system: prompt, prompt: `已有项目文件名：${candidates.join('、') || '（暂无）'}\n\n${renderNoteForModel(note)}\n\n只输出 JSON：{"name":"简短项目名","level":"不建议、尚可或符合之一","reason":"约50字理由","matches":["逐字复制相关候选文件名，不相关则空数组"]}。`, maxTokens: normalizeAi(ai).maxTokens, maxChars: 3000, reasoningEffort: normalizeAi(ai).reasoningEffort }
}
export function buildProjectAddRequest(note, project, prompt, sourceTarget, ai, name, stamp) {
  return revisionRequest(note, project, prompt, name, ai, sourceTarget, stamp)
}

/** Legacy pure helper retained for consumers and old project files. */
export function buildProjectDocument(input) {
  const sourceLink = `[[${String(input.sourceRelPath || '').replace(/\.md$/iu, '')}|${input.sourceTitle || input.name}]]`
  const body = String(input.generated || '').trim()
  const heading = /^#\s/u.test(body) ? '' : `# ${input.name}\n\n`
  return `---\nPROJECTS: "${sourceLink.replace(/"/gu, '\\"')}"\nTODO: []\n---\n${heading}${body}\n\n## 来源\n- ${sourceLink}\n`
}
export function sourceWikilink(projectRelPath, projectName) { return `[[${String(projectRelPath).replace(/\.md$/iu, '')}|${projectName}]]` }
