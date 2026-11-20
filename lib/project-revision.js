/** AI edits prose. Only the Host owns the surrounding Markdown and the bytes of protected sections. */
import { failure } from './files.js'
import { LIMITS } from './shared.js'

const CURRENT = '当前概况', HISTORY = '进展记录'
const legacyOverview = new Set(['这是什么', '当前进度', '最近更新', '后续方向'])
const reject = message => { throw failure('project-revision-invalid', `项目未写入：${message}`) }

// Scan raw text: offsets can be used to preserve mixed line endings, whitespace and fenced examples.
function headings(text) {
  const found = []; let fence = ''
  for (const m of text.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/gu)) {
    const line = m[1], marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = ''
      continue
    }
    if (marker) { fence = marker[1]; continue }
    const h = /^ {0,3}(#{1,2})(?:[ \t]+(.*?)|$)[ \t]*$/u.exec(line)
    if (h) found.push({ level: h[1].length, name: (h[2] ?? '').replace(/[ \t]+#+$/u, ''), start: m.index, line })
  }
  if (fence) reject('Markdown 代码围栏未闭合，无法安全划分章节。')
  return found
}
function splitFile(raw) {
  const bom = raw.startsWith('\uFEFF') ? 1 : 0, text = raw.slice(bom)
  const opening = /^---[ \t]*(?:\r\n|\n|\r)/u.exec(text)
  const closing = opening && /^(?:---|\.\.\.)[ \t]*(?:\r\n|\n|\r|$)/mu.exec(text.slice(opening[0].length))
  if (opening && !closing) reject('旧稿的 YAML 未闭合，请先检查原文。')
  const offset = bom + (closing ? opening[0].length + closing.index + closing[0].length : 0)
  return { prefix: raw.slice(0, offset), body: raw.slice(offset), eol: raw.match(/\r\n|\n|\r/u)?.[0] ?? '\n' }
}

function fragment(value, label, eol) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) reject(`缺少有效的${label}。`)
  // Only a container boundary is disallowed; leave aliases, number of links, and internal layout to the author.
  if (headings(value).length) reject(`${label}应只包含正文，不要重复项目标题或独立二级章节。`)
  return value.replace(/^[\r\n]+|[\r\n]+$/gu, '').replace(/\r\n|\n|\r/gu, eol)
}
/**
 * Models often repeat the host-owned container heading (`## 当前概况`,
 * `## 进展记录`) or the project title even when asked not to. That is a
 * harmless wrapper, not a structural edit, so strip only these exact headings
 * from the start and keep every other H1/H2 rejected by fragment().
 */
function stripContainerPrefix(value, headingsToStrip) {
  if (typeof value !== 'string') return value
  let text = value
  for (let changed = true; changed;) {
    changed = false
    for (const heading of headingsToStrip) {
      if (!heading) continue
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
      const next = text.replace(new RegExp(`^[\\s\\uFEFF]*${escaped}[ \\t]*(?:\\r\\n|\\n|\\r)+`, 'u'), '')
      if (next !== text) { text = next; changed = true }
    }
  }
  return text
}
function paragraphAfter(text, eol) {
  if (!text) return text
  const last = /(?:\r\n|\n|\r)$/u.exec(text)
  if (!last) return text + eol + eol
  return /[\r\n]/u.test(text[last.index - 1] ?? '') ? text : text + eol
}

function assemble(original, name, stamp, answer) {
  const { body, prefix, eol } = splitFile(original ?? '')
  const overview = fragment(answer.overview, '当前概况', eol)
  const entry = `### ${stamp}${eol}${eol}` + fragment(answer.entry, '本次进展', eol)
  const all = headings(body), sections = all.filter(h => h.level === 2)
  const title = all.filter(h => h.level === 1)
  if (title.length > 1 || (title.length && title[0] !== all[0])) reject('旧稿含多个顶层文档，无法安全定位项目正文。')
  const lead = body.slice(0, sections[0]?.start)
  const intro = title.length ? lead : `# ${name}${eol}${eol}${lead}`
  const parts = sections.map((s, i) => ({ ...s, raw: body.slice(s.start, sections[i + 1]?.start) }))
  const tops = parts.filter(s => s.name === CURRENT), logs = parts.filter(s => s.name === HISTORY)
  if (tops.length > 1 || logs.length > 1 || (tops[0] && logs[0] && tops[0].start > logs[0].start)) reject('旧稿的当前概况/进展记录重复或倒置，请先整理章节。')
  const current = (tops[0]?.line ?? `## ${CURRENT}`) + eol + eol + overview
  let result
  if (tops.length && logs.length) {
    // Splice only the overview body and the end of the history. Keep user sections in their original positions.
    result = intro + parts.map((p, i) => {
      const tail = i + 1 === parts.length ? eol : eol + eol
      if (p.name === CURRENT) return current + tail
      if (p.name === HISTORY) return paragraphAfter(p.raw, eol) + entry + tail
      return p.raw
    }).join('')
  } else {
    // First creation / legacy layout. Demote only the heading of old, newest-first snapshots.
    const legacyProgress = p => !tops.length && p.name.startsWith('进展 · ')
    const dated = parts.filter(legacyProgress)
    const others = parts.filter(p => p.name !== CURRENT && p.name !== HISTORY && !legacyProgress(p) && (tops.length || !legacyOverview.has(p.name)))
    let log = `## ${HISTORY}`
    for (const p of dated.reverse()) log = paragraphAfter(log, eol) + p.raw.replace(/^( {0,3})##/u, '$1###')
    if (logs[0]) log = dated.length ? paragraphAfter(log, eol) + logs[0].raw.slice(logs[0].line.length) : logs[0].raw
    result = paragraphAfter(intro, eol) + current + eol + eol + paragraphAfter(log, eol) + entry + eol
    if (others.length) result = paragraphAfter(result, eol) + others.map(p => p.raw).join('')
  }
  return prefix + (prefix.length && prefix !== '\uFEFF' && !/[\r\n]$/u.test(prefix) ? eol : '') + result
}

export function readProjectRevision(text, original, { name, stamp }) {
  let answer
  try { answer = JSON.parse(text) } catch { reject('模型未返回完整的修订 JSON，请重试或调高项目 AI 预算。') }
  const summary = typeof answer?.summary === 'string' && answer.summary.replace(/\s+/gu, ' ').trim()
  if (!summary) reject('缺少验收摘要。')
  const fields = {
    ...(answer && typeof answer === 'object' ? answer : {}),
    overview: stripContainerPrefix(answer?.overview, ['## 当前概况', name ? `# ${name}` : '']),
    entry: stripContainerPrefix(answer?.entry, ['## 进展记录', stamp ? `### ${stamp}` : '']),
  }
  const next = assemble(original, name, stamp, fields)
  if (Array.from(next).length > LIMITS.projectDocumentChars) reject('项目太长，无法继续完整跟踪，请缩短或拆分项目。')
  return { next, summary: Array.from(summary).slice(0, 160).join('') }
}
