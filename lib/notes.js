/**
 * dsh-obsidian-memo —— Markdown 解析与写入（纯函数，可单测）。
 *
 * 只处理 Obsidian 风格的 md：
 * - frontmatter 只用于读/写 PROJECTS，渲染永远丢弃；
 * - 第一个标题或第一段 = 便签标题；
 * - 其余正文块 = 补充；callout = 评论；
 * - 行尾/段中 block id（`^qa-daily-preview-…`）不进入展示，且不影响锚点后面的文字。
 *
 * 写入只做两件事：在末尾评论块之前插入正文段落、在文末追加评论 callout；
 * 两者都返回新文本，由调用方原子写盘。frontmatter 其余内容一律原样保留。
 * @module dsh-obsidian-memo/notes
 */

import { readProjects } from './project-meta.js'
export { readProjects, setProjectsLink } from './project-meta.js'
import { CALLOUT_HEAD, QUOTE_LINE, closesFence, inlineImages, normalizeText, openingFence, stripBlockIds, stripInline } from './markdown.js'
import { findTitleLine, normalizeTitleMode } from './title.js'
import { LIMITS } from './shared.js'

// 0.16.8：行内文本工具迁到 markdown.js；这里继续导出，保持既有 import 不变。
export { normalizeText, stripBlockIds, stripInline } from './markdown.js'

const HEADING = /^\s*(#{1,6})\s+(.*)$/
const LIST_ITEM = /^\s*([-*+]|\d{1,9}[.)])\s+(.*)$/
const TASK_MARK = /^\[([ xX])\]\s+(.*)$/
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
/** 保留段落中的 Markdown / Obsidian 图片，图片两侧仍显示文字。 */
function paragraphBlocks(text, multilineParagraphs = null) {
  // 先按原始行删掉 block id，再按原样生成阅读块；卡片可额外保留段落中的换行。
  const source = stripBlockIds(text)
  const blocks = []
  const addText = (raw) => {
    const plain = stripInline(raw.replace(/\n/g, ' '))
    if (!plain) return
    const block = { kind: 'p', text: plain.slice(0, LIMITS.blockText) }
    blocks.push(block)
    if (multilineParagraphs && raw.includes('\n')) multilineParagraphs.set(block, raw)
  }
  let offset = 0
  for (const match of inlineImages(source)) {
    addText(source.slice(offset, match.index))
    blocks.push({ kind: 'image', text: '', source: (match[1] || match[4]).replace(/^<|>$/g, '').trim(), alt: match[2] || match[3] || '', wiki: Boolean(match[1]) })
    offset = match.index + match[0].length
  }
  addText(source.slice(offset))
  return blocks
}

/**
 * 拆分 frontmatter 与正文。
 * @param {string} text - md 原文。
 * @returns {{ frontmatter: string | null, body: string, bom: boolean }}
 */
export function splitFrontmatter(text) {
  const bom = typeof text === 'string' && text.startsWith('\uFEFF')
  const body = normalizeText(text)
  const lines = body.split('\n')
  if (lines[0]?.trim() !== '---') return { frontmatter: null, body, bom }
  let close = -1
  for (let i = 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (trimmed === '---' || trimmed === '...') {
      close = i
      break
    }
  }
  if (close < 0) return { frontmatter: null, body, bom }
  return {
    frontmatter: lines.slice(0, close + 1).join('\n'),
    body: lines.slice(close + 1).join('\n').replace(/^\n+/, ''),
    bom,
  }
}

/** 从 callout 标题里提取 emoji / label / time。 */
function splitCalloutTitle(title) {
  const raw = String(title ?? '').trim()
  let emoji = ''
  let rest = raw
  const leading = raw.match(/^([^\p{L}\p{N}\s]{1,8})\s*/u)
  if (leading) {
    emoji = leading[1]
    rest = raw.slice(leading[0].length)
  }
  const timeMatch = rest.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/)
  const time = timeMatch ? `${timeMatch[1]}${timeMatch[2] ? ` ${timeMatch[2]}` : ''}` : ''
  const beforeTime = time ? rest.slice(0, rest.indexOf(timeMatch[1])).replace(/\s*·\s*$/, '').trim() : rest
  const label = beforeTime.split(/\s*·\s*/)[0].trim() || beforeTime || ''
  return { emoji, label, time }
}

/**
 * 解析一张便签。
 * @param {string} text - md 原文。
 * @param {{ maxComments?: number, maxBlocks?: number, withCardPreview?: boolean, withBlockLines?: boolean }} [options]
 * @returns {{
 *   projects: string | null,
 *   title: string,
 *   blocks: { kind: string, text: string }[],
 *   comments: object[],
 *   excerpt: string,
 *   cardPreview?: string | null,
 * }}
 */
export function parseNote(text, options = {}) {
  const maxComments = options.maxComments ?? LIMITS.fullComments
  const maxBlocks = options.maxBlocks ?? LIMITS.blocks
  // 删除评论时额外要回正文行号；默认不下发，保持既有摘要/全文结构不变。
  const withRanges = options.withRanges === true
  // 标题只是原文的展示投影；不改写原始行，源行号仍用于评论与任务操作。
  const titleMode = normalizeTitleMode(options.titleMode)
  const { body, frontmatter } = splitFrontmatter(text)
  const lines = body.split('\n')
  const derived = findTitleLine(lines, titleMode)
  const blocks = []
  const appendBlocks = (entries, start, end = start) => {
    for (const block of entries) {
      if (options.withBlockLines) {
        block.sourceLine = start
        if (end > start) block.sourceEndLine = end
      }
      blocks.push(block)
    }
  }
  const comments = []
  // 仅扫描摘要需要段内换行；不把原始段落附到阅读块或摘要缓存中。
  const multilineParagraphs = options.withCardPreview === true ? new WeakMap() : null
  const projects = frontmatter && [...new Set([options.projectKey || 'PROJECT', 'PROJECT', 'PROJECTS'])]
    .map((key) => readProjects(frontmatter, key)).find(Boolean) || null

  let i = 0
  let renderComplete = false
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }

    // 只省略重复的标题文字，保留同行图片；不修改正文或源行数组。
    if (i === derived.index) {
      appendBlocks(paragraphBlocks(line).filter((block) => block.kind === 'image'), i)
      i += 1
      continue
    }

    const callout = line.match(CALLOUT_HEAD)
    if (callout) {
      const type = callout[1].toLowerCase()
      const title = callout[3].trim()
      const startLine = i
      const bodyLines = []
      const keepComment = comments.length < Math.max(1, maxComments)
      i += 1
      while (i < lines.length) {
        const quoted = lines[i].match(QUOTE_LINE)
        if (!quoted) break
        if (keepComment) bodyLines.push(quoted[1])
        i += 1
      }
      if (!keepComment) continue
      const rawText = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      const meta = splitCalloutTitle(title)
      comments.push({
        type,
        emoji: meta.emoji,
        label: meta.label || title || type,
        title,
        time: meta.time,
        text: stripInline(rawText).slice(0, LIMITS.commentText),
        ...(withRanges ? { startLine, endLine: i - 1 } : {}),
      })
      continue
    }

    // 展示块与标题都已齐全后，仅继续找尾部评论；不再解析随后所有段落。
    // fenced code 和普通引用仍须整段跳过，避免把其中的示例当作评论。
    if (!renderComplete && maxBlocks > 0 && blocks.length >= maxBlocks) {
      const titleBlock = blocks[findTitleIndex(blocks)]
      renderComplete = titleBlock?.kind === 'h' || titleBlock?.kind === 'p'
    }
    if (renderComplete) {
      const fence = openingFence(line)
      if (fence) {
        i += 1
        while (i < lines.length && !closesFence(lines[i], fence)) i += 1
        if (i < lines.length) i += 1
      } else if (QUOTE_LINE.test(line)) {
        while (i < lines.length && QUOTE_LINE.test(lines[i])) i += 1
      } else i += 1
      continue
    }

    if (HR.test(line)) {
      appendBlocks([{ kind: 'hr', text: '' }], i)
      i += 1
      continue
    }

    const fence = openingFence(line)
    if (fence) {
      const collected = []
      const start = i
      i += 1
      while (i < lines.length && !closesFence(lines[i], fence)) {
        collected.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      const codeText = collected.join('\n').trim()
      if (codeText) appendBlocks([{ kind: 'code', text: codeText.slice(0, LIMITS.blockText) }], start, i - 1)
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      appendBlocks([{ kind: 'h', text: stripInline(heading[2]).slice(0, LIMITS.blockText) },
        ...paragraphBlocks(heading[2]).filter((block) => block.kind === 'image')], i)
      i += 1
      continue
    }

    const quote = line.match(QUOTE_LINE)
    if (quote) {
      const start = i
      const collected = []
      while (i < lines.length) {
        const quoted = lines[i].match(QUOTE_LINE)
        if (!quoted) break
        collected.push(quoted[1])
        i += 1
      }
      const quotedText = stripInline(stripBlockIds(collected.join('\n')).replace(/\n/g, ' '))
      if (quotedText) appendBlocks([{ kind: 'quote', text: quotedText.slice(0, LIMITS.blockText) }], start, i - 1)
      continue
    }

    const item = line.match(LIST_ITEM)
    if (item) {
      const task = item[2].match(TASK_MARK)
      const checked = task === null ? null : task[1].toLowerCase() === 'x'
      const text = stripInline(task === null ? item[2] : task[2]).slice(0, LIMITS.blockText)
      const indent = line.match(/^[ 	]*/)[0].replace(/	/g, '    ').length
      const ordered = /^\d/.test(item[1])
      appendBlocks([{ kind: 'li', text, ...(indent > 0 ? { indent } : {}), ...(ordered ? { marker: item[1] } : {}),
        ...(checked === null ? {} : { checked }), ...(!ordered || checked !== null ? { sourceLine: i } : {}) }], i)
      i += 1
      continue
    }

    const paragraph = []
    while (i < lines.length && lines[i].trim() !== '') {
      const next = lines[i]
      if (HR.test(next) || CALLOUT_HEAD.test(next) || HEADING.test(next) || LIST_ITEM.test(next) || QUOTE_LINE.test(next) || openingFence(next)) break
      paragraph.push(next)
      i += 1
    }
    appendBlocks(paragraphBlocks(paragraph.join('\n'), multilineParagraphs), i - paragraph.length, i - 1)
    if (paragraph.length === 0) i += 1
  }

  // filename 模式仍取第一个 h/p（由 scan 覆写为文件名）；正文模式取刚才定位的标题。
  const titleIndex = findTitleIndex(blocks)
  const title = titleMode === 'filename'
    ? (titleIndex >= 0 ? blocks[titleIndex].text : '')
    : derived.title
  const bodyBlocks = blocks.slice(0, maxBlocks)
  const excerptParts = []
  for (const block of bodyBlocks) {
    if (block.kind === 'code' || block.kind === 'image' || block.kind === 'hr') continue
    const prefix = block.kind === 'li' && typeof block.checked === 'boolean' ? (block.checked ? '☑ ' : '☐ ') : ''
    excerptParts.push(`${prefix}${block.text}`)
    if (excerptParts.join(' ').length >= LIMITS.excerpt) break
  }
  const excerpt = clip(excerptParts.join(' ').replace(/\s+/g, ' '), LIMITS.excerpt)

  return {
    projects,
    title,
    blocks: bodyBlocks,
    comments: comments.slice(0, Math.max(1, maxComments)),
    excerpt,
    ...(multilineParagraphs ? { cardPreview: buildCardPreview(bodyBlocks, multilineParagraphs, excerpt) } : {}),
  }
}

/** 纯文本预览：换行和列表标记直接用字形，卡片无需 Markdown 渲染器或额外 DOM。 */
function buildCardPreview(blocks, multilineParagraphs, excerpt) {
  if (blocks.some((block) => block.kind === 'image' && block.source)) return null
  const parts = []
  let length = 0
  for (const block of blocks) {
    if (block.kind === 'code' || block.kind === 'image' || block.kind === 'hr') continue
    const raw = multilineParagraphs.get(block)
    const text = raw === undefined ? block.text : stripInline(raw).replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n')
    const task = typeof block.checked === 'boolean' ? (block.checked ? '☑' : '☐') : ''
    const marker = block.kind === 'li' ? [block.marker, task].filter(Boolean).join(' ') || '•' : ''
    const line = marker ? `${marker} ${text}` : text
    if (!line) continue
    parts.push(line)
    length += line.length + 1
    if (length > LIMITS.excerpt) break
  }
  const preview = clip(parts.join('\n'), LIMITS.excerpt)
  return preview && preview !== excerpt ? preview : null
}

/** 标题块：优先第一个 h/p，其次第一个非空块。 */
function findTitleIndex(blocks) {
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].kind === 'p' || blocks[i].kind === 'h') return i
  }
  return blocks.length > 0 ? 0 : -1
}

/** 按字符截断，尽量不切 emoji。 */
export function clip(value, max) {
  const s = String(value ?? '')
  if (s.length <= max) return s
  return `${Array.from(s).slice(0, max).join('')}…`
}

/** 取出正文（不含 frontmatter；用于编辑模式与保存）。 */
export function getBody(text) {
  const { body } = splitFrontmatter(text)
  return body.replace(/^\n+/, '')
}

/** 构造一个评论 callout 文本块。 */
export function buildCommentCallout({ type = 'note', title = '', text: body = '' }) {
  const head = `> [!${type}] ${String(title ?? '').trim()}`.trimEnd()
  const quoted = String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
  return [head, ...quoted].join('\n')
}

/**
 * 在文件末尾追加评论 callout。
 * @param {string} text - md 原文。
 * @param {{ type: string, title: string, text: string }} callout
 * @returns {string}
 */
export function appendComment(text, callout) {
  const bom = typeof text === 'string' && text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const base = normalizeText(text).replace(/\s+$/u, '')
  const block = buildCommentCallout(callout)
  return `${bom}${base ? `${base}\n\n${block}` : block}\n`
}

/**
 * 从相对路径推导 tag：相对 notesDir 的第一层子文件夹名。
 * @param {string} relativePath - 相对 notesDir 的路径（用 /）。
 * @returns {string | null}
 */
export function tagForRelativePath(relativePath) {
  const parts = String(relativePath ?? '').split('/').filter(Boolean)
  return parts.length > 1 ? parts[0] : null
}

/**
 * 抽正文里的图片：前 limit 张的来源 + 正文图片总数。
 * 只统计正文块（评论 callout 里的图不会进 blocks），供卡片缩略图与「＋N」使用。
 * @param {{ kind: string, source?: string, alt?: string, wiki?: boolean }[]} blocks
 * @param {number} [limit] - 最多下发几张（默认 LIMITS.cardImages）。
 * @returns {{ images: { source: string, alt: string, wiki: boolean }[], imageCount: number }}
 */
export function summarizeImages(blocks, limit = LIMITS.cardImages) {
  const all = (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block?.kind === 'image' && typeof block.source === 'string' && block.source.trim() !== '')
  return {
    images: all.slice(0, Math.max(0, limit)).map((block) => ({
      source: block.source,
      alt: typeof block.alt === 'string' ? block.alt : '',
      wiki: block.wiki === true,
    })),
    imageCount: all.length,
  }
}

/**
 * 评论里出现过的 emoji（去重、按出现顺序）。空 emoji 不计入。
 * @param {{ emoji?: string }[]} comments
 * @returns {string[]}
 */
export function commentKindsFrom(comments) {
  const seen = new Set()
  const kinds = []
  for (const comment of Array.isArray(comments) ? comments : []) {
    const emoji = typeof comment?.emoji === 'string' ? comment.emoji : ''
    if (emoji === '' || seen.has(emoji)) continue
    seen.add(emoji)
    kinds.push(emoji)
  }
  return kinds
}

