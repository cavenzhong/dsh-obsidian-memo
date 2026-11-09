/**
 * dsh-sticky-notes —— Markdown 解析与写入（纯函数，可单测）。
 *
 * 只处理 Obsidian 风格的 md：
 * - frontmatter 只用于读/写 PROJECTS，渲染永远丢弃；
 * - 第一个标题或第一段 = 便签标题；
 * - 其余正文块 = 补充；callout = 评论；
 * - 行尾/段中 block id（`^qa-daily-preview-…`）不进入展示，且不影响锚点后面的文字。
 *
 * 写入只做两件事：在末尾评论块之前插入正文段落、在文末追加评论 callout；
 * 两者都返回新文本，由调用方原子写盘。frontmatter 其余内容一律原样保留。
 * @module dsh-sticky-notes/notes
 */

import { LIMITS } from './shared.js'

const CALLOUT_HEAD = /^\s*>\s*\[!([A-Za-z0-9_-]+)\]([+-]?)\s*(.*)$/
const HEADING = /^\s*(#{1,6})\s+(.*)$/
const LIST_ITEM = /^\s*([-*+]|\d{1,9}[.)])\s+(.*)$/
const TASK_MARK = /^\[([ xX])\]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const FENCE = /^\s*(```|~~~)(.*)$/
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
// Obsidian block id（如 `^qa-daily-preview-1e5t8lm`）只出现在**行尾**。0.13.9：段落按行拼接成空格后，
// block id 会跑到段落中间，所以必须先在原始行上按「行尾锚点」删掉，再拼接——只删锚点本身，
// 锚点后面的文字（下一行）保留；同时不会误删行内代码 / 行中上标里的 `^`。
const BLOCK_ID = /(?:^|[ \t])\^[A-Za-z0-9][A-Za-z0-9_-]*(?:[ \t]+\^[A-Za-z0-9][A-Za-z0-9_-]*)*[ \t]*$/

/** 保留段落中的 Markdown / Obsidian 图片，图片两侧仍显示文字。 */
function paragraphBlocks(text) {
  // 0.13.9：先按原始行删掉行尾 block id（换行信息此时还在），再把段落拼成一行。
  const source = stripBlockIds(text)
  const pattern = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|!\[([^\]]*)\]\(\s*(<[^>]+>|(?:\\.|[^()\s]|\([^()]*\))+)(?:\s+["'][^"']*["'])?\s*\)/g
  const blocks = []
  let offset = 0
  for (const match of source.matchAll(pattern)) {
    const before = stripInline(source.slice(offset, match.index).replace(/\n/g, ' '))
    if (before) blocks.push({ kind: 'p', text: before.slice(0, LIMITS.blockText) })
    blocks.push({ kind: 'image', text: '', source: (match[1] || match[4]).replace(/^<|>$/g, '').trim(), alt: match[2] || match[3] || '', wiki: Boolean(match[1]) })
    offset = match.index + match[0].length
  }
  const rest = stripInline(source.slice(offset).replace(/\n/g, ' '))
  if (rest) blocks.push({ kind: 'p', text: rest.slice(0, LIMITS.blockText) })
  return blocks
}

/** 去掉 BOM 并统一换行。 */
export function normalizeText(text) {
  const withoutBom = typeof text === 'string' && text.startsWith('\uFEFF') ? text.slice(1) : text
  return String(withoutBom ?? '').replace(/\r\n?/g, '\n')
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

/** 读 frontmatter 里的 PROJECTS 原始值（没有则 null）。 */
export function readProjects(text) {
  const { frontmatter } = splitFrontmatter(text)
  if (frontmatter === null) return null
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^PROJECTS\s*:\s*(.*)$/)
    if (!match) continue
    const value = match[1].trim()
    return value === '' ? null : value
  }
  return null
}

/**
 * 给源便签写回项目链接（只动 PROJECTS 一个键）。
 * 已有非空值时不覆盖，返回 changed:false。
 * @param {string} text - md 原文。
 * @param {string} wikilink - 形如 `[[路径/项目|项目]]`。
 * @returns {{ text: string, changed: boolean, reason: string }}
 */
export function setProjectsLink(text, wikilink) {
  const bom = typeof text === 'string' && text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const body = normalizeText(text)
  const lines = body.split('\n')
  const value = `"${wikilink.replace(/"/g, '\\"')}"`
  let open = -1
  let close = -1
  if (lines[0]?.trim() === '---') {
    open = 0
    for (let i = 1; i < lines.length; i += 1) {
      const trimmed = lines[i].trim()
      if (trimmed === '---' || trimmed === '...') {
        close = i
        break
      }
    }
  }
  if (open >= 0 && close > 0) {
    for (let i = open + 1; i < close; i += 1) {
      const match = lines[i].match(/^PROJECTS\s*:\s*(.*)$/)
      if (!match) continue
      const rest = match[1].trim()
      if (rest !== '' && rest !== '[]' && rest !== '""' && rest !== "''" && rest !== '~' && rest !== 'null') {
        return { text, changed: false, reason: 'non-empty' }
      }
      for (let j = i + 1; j < close; j += 1) {
        if (!/^\s+-\s+/.test(lines[j])) break
        if (lines[j].trim() === '-' || /^\s+-\s*\S/.test(lines[j])) return { text, changed: false, reason: 'non-empty' }
      }
      lines[i] = `PROJECTS: ${value}`
      return { text: bom + lines.join('\n'), changed: true, reason: 'updated' }
    }
    lines.splice(close, 0, `PROJECTS: ${value}`)
    return { text: bom + lines.join('\n'), changed: true, reason: 'added' }
  }
  const created = ['---', `PROJECTS: ${value}`, '---', '', body.replace(/^\n+/, '')].join('\n')
  return { text: bom + created, changed: true, reason: 'created' }
}

/**
 * 0.13.9：按原始行删除行尾 block id，保留换行与后面的行。
 * Obsidian 的 block id 必须位于行尾（`^abc`），所以这里只匹配每行末尾的锚点；
 * 行中/行内代码里的 `^` 不会被误删。
 * @param {string} input
 * @returns {string}
 */
export function stripBlockIds(input) {
  return String(input ?? '')
    .split('\n')
    .map((line) => line.replace(BLOCK_ID, ''))
    .join('\n')
}

/** 去掉行内 markdown 记号，得到可展示的纯文本。 */
export function stripInline(input) {
  // 0.13.9：先处理行尾 block id（多行输入如评论 callout 也适用；单行标题/列表就是行尾）。
  let s = stripBlockIds(String(input ?? ''))
  s = s.replace(/!\[\[[^\]]*\]\]/g, '')
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  s = s.replace(/!\[[^\]]*\]/g, '')
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, _target, alias) => alias)
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_, target) => {
    const withoutHeading = String(target).replace(/#[^|]*$/, '')
    const leaf = withoutHeading.split('/').pop() ?? ''
    return leaf.replace(/\.md$/i, '')
  })
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, (_, label) => label)
  s = s.replace(/%%[\s\S]*?%%/g, '')
  s = s.replace(/`([^`]*)`/g, (_, code) => code)
  s = s.replace(/(\*\*|__)(.*?)\1/g, (_, _m, inner) => inner)
  s = s.replace(/(\*|_)(?=\S)([^*_]*?)(?<=\S)\1/g, (_, _m, inner) => inner)
  s = s.replace(/==([\s\S]*?)==/g, (_, inner) => inner)
  s = s.replace(/~~([\s\S]*?)~~/g, (_, inner) => inner)
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/[ \t]+/g, ' ')
  return s.trim()
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
 * @param {{ maxComments?: number, maxBlocks?: number }} [options]
 * @returns {{
 *   projects: string | null,
 *   title: string,
 *   blocks: { kind: string, text: string }[],
 *   comments: object[],
 *   excerpt: string,
 * }}
 */
export function parseNote(text, options = {}) {
  const maxComments = options.maxComments ?? LIMITS.fullComments
  const maxBlocks = options.maxBlocks ?? LIMITS.blocks
  const { body, frontmatter } = splitFrontmatter(text)
  const lines = body.split('\n')
  const blocks = []
  const comments = []
  let projects = null
  if (frontmatter !== null) {
    for (const line of frontmatter.split('\n')) {
      const match = line.match(/^PROJECTS\s*:\s*(.*)$/)
      if (match) {
        const value = match[1].trim()
        projects = value === '' ? null : value
        break
      }
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }

    if (HR.test(line)) {
      blocks.push({ kind: 'hr', text: '' })
      i += 1
      continue
    }

    const callout = line.match(CALLOUT_HEAD)
    if (callout) {
      const type = callout[1].toLowerCase()
      const title = callout[3].trim()
      const bodyLines = []
      i += 1
      while (i < lines.length) {
        const quoted = lines[i].match(QUOTE)
        if (!quoted) break
        bodyLines.push(quoted[1])
        i += 1
      }
      const rawText = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      const meta = splitCalloutTitle(title)
      comments.push({
        type,
        emoji: meta.emoji,
        label: meta.label || title || type,
        title,
        time: meta.time,
        text: stripInline(rawText).slice(0, LIMITS.commentText),
      })
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      const marker = fence[1]
      const collected = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        collected.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      const codeText = collected.join('\n').trim()
      if (codeText) blocks.push({ kind: 'code', text: codeText.slice(0, LIMITS.blockText) })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ kind: 'h', text: stripInline(heading[2]).slice(0, LIMITS.blockText) })
      i += 1
      continue
    }

    const quote = line.match(QUOTE)
    if (quote) {
      const collected = []
      while (i < lines.length) {
        const quoted = lines[i].match(QUOTE)
        if (!quoted) break
        collected.push(quoted[1])
        i += 1
      }
      const quotedText = stripInline(stripBlockIds(collected.join('\n')).replace(/\n/g, ' '))
      if (quotedText) blocks.push({ kind: 'quote', text: quotedText.slice(0, LIMITS.blockText) })
      continue
    }

    const item = line.match(LIST_ITEM)
    if (item) {
      const task = item[2].match(TASK_MARK)
      const checked = task === null ? null : task[1].toLowerCase() === 'x'
      const text = stripInline(task === null ? item[2] : task[2]).slice(0, LIMITS.blockText)
      blocks.push({ kind: 'li', text, ...(/^\d/.test(item[1]) ? { marker: item[1] } : {}), ...(checked === null ? {} : { checked, sourceLine: i }) })
      i += 1
      continue
    }

    const paragraph = []
    while (i < lines.length && lines[i].trim() !== '') {
      const next = lines[i]
      if (HR.test(next) || CALLOUT_HEAD.test(next) || HEADING.test(next) || LIST_ITEM.test(next) || QUOTE.test(next) || FENCE.test(next)) break
      paragraph.push(next)
      i += 1
    }
    blocks.push(...paragraphBlocks(paragraph.join('\n')))
    if (paragraph.length === 0) i += 1
  }

  // 标题现在取文件名（由 scan 覆写）；第一段仍然是正文的一部分，不再从 blocks 里剔除。
  const titleIndex = findTitleIndex(blocks)
  const title = titleIndex >= 0 ? blocks[titleIndex].text : ''
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
  }
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

