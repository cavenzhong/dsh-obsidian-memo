/**
 * lib/notes.js 的纯函数单测：
 * frontmatter 拆分、PROJECTS 读写四态、parseNote、getBody、appendComment、
 * colorForTag / darkColorForTag / tagForRelativePath。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  appendComment,
  buildCommentCallout,
  clip,
  commentKindsFrom,
  getBody,
  normalizeText,
  parseNote,
  readProjects,
  setProjectsLink,
  splitFrontmatter,
  stripBlockIds,
  stripInline,
  summarizeImages,
  tagForRelativePath,
} from '../lib/notes.js'
import { CARD_PALETTE, colorForTag, darkColorForTag } from '../lib/shared.js'

/* ─────────────────────────── frontmatter ─────────────────────────── */

test('splitFrontmatter：拆出 frontmatter 与正文', () => {
  const text = '---\ntags: a\nPROJECTS: "[[x|X]]"\n---\n\n# 标题\n\n正文'
  const split = splitFrontmatter(text)
  assert.equal(split.bom, false)
  assert.equal(split.frontmatter, '---\ntags: a\nPROJECTS: "[[x|X]]"\n---')
  assert.equal(split.body, '# 标题\n\n正文')
})

test('splitFrontmatter：没有 frontmatter 时 body 原文归一化', () => {
  const split = splitFrontmatter('第一行\r\n第二行\r\n')
  assert.equal(split.frontmatter, null)
  assert.equal(split.body, '第一行\n第二行\n')
  assert.equal(split.bom, false)
})

test('splitFrontmatter：BOM 被识别、正文去掉 BOM', () => {
  const split = splitFrontmatter('\uFEFF---\nx: 1\n---\nbody')
  assert.equal(split.bom, true)
  assert.equal(split.frontmatter, '---\nx: 1\n---')
  assert.equal(split.body, 'body')
})

test('splitFrontmatter：未闭合或首行不是 --- 都当作没有 frontmatter', () => {
  assert.equal(splitFrontmatter('---\nfoo: 1\n\nbody').frontmatter, null)
  assert.equal(splitFrontmatter('# 标题\n\n---\n').frontmatter, null)
})

test('splitFrontmatter：支持 ... 作为结束符', () => {
  const split = splitFrontmatter('---\nfoo: 1\n...\nbody')
  assert.equal(split.frontmatter, '---\nfoo: 1\n...')
  assert.equal(split.body, 'body')
})

test('normalizeText：去 BOM、统一 CRLF', () => {
  assert.equal(normalizeText('\uFEFFa\r\nb\rc'), 'a\nb\nc')
  assert.equal(normalizeText(null), '')
  assert.equal(normalizeText(undefined), '')
})

/* ──────────────────────────── PROJECTS ──────────────────────────── */

test('readProjects：无 frontmatter / 无键 / 空值都返回 null', () => {
  assert.equal(readProjects('# 标题\n正文'), null)
  assert.equal(readProjects('---\ntags: a\n---\nbody'), null)
  assert.equal(readProjects('---\nPROJECTS:\n---\nbody'), null)
  assert.equal(readProjects('---\nPROJECTS:   \n---\nbody'), null)
})

test('readProjects：返回原始值（保留引号）', () => {
  assert.equal(readProjects('---\nPROJECTS: "[[a/b|B]]"\n---\nbody'), '"[[a/b|B]]"')
  assert.equal(readProjects('---\nPROJECTS: [[a/b|B]]\n---\nbody'), '[[a/b|B]]')
})

test('setProjectsLink：created —— 没有 frontmatter 时新建', () => {
  const result = setProjectsLink('# 标题\n\n正文\n', '[[notes/设计|设计]]')
  assert.equal(result.changed, true)
  assert.equal(result.reason, 'created')
  assert.equal(result.text, '---\nPROJECTS: "[[notes/设计|设计]]"\n---\n\n# 标题\n\n正文\n')
  assert.equal(readProjects(result.text), '"[[notes/设计|设计]]"')
})

test('setProjectsLink：created —— 保留原正文与结尾换行习惯', () => {
  const result = setProjectsLink('只有正文', '[[a|A]]')
  assert.equal(result.text, '---\nPROJECTS: "[[a|A]]"\n---\n\n只有正文')
})

test('setProjectsLink：added —— 有 frontmatter 但没有 PROJECTS 键', () => {
  const result = setProjectsLink('---\ntags: a\n---\n\nbody\n', '[[a/b|B]]')
  assert.equal(result.changed, true)
  assert.equal(result.reason, 'added')
  assert.match(result.text, /^---\ntags: a\nPROJECTS: "\[\[a\/b\|B\]\]"\n---\n\nbody\n$/)
})

test('setProjectsLink：updated —— PROJECTS 为空值（四种空写法）', () => {
  for (const empty of ['PROJECTS:', 'PROJECTS: []', 'PROJECTS: ""', 'PROJECTS: null']) {
    const source = `---\n${empty}\ntags: a\n---\n\nbody\n`
    const result = setProjectsLink(source, '[[a/b|B]]')
    assert.equal(result.changed, true, `应写入空值 ${empty}`)
    assert.equal(result.reason, 'updated', `reason ${empty}`)
    assert.match(result.text, /PROJECTS: "\[\[a\/b\|B\]\]"/)
    assert.match(result.text, /tags: a/)
    assert.equal(readProjects(result.text), '"[[a/b|B]]"')
  }
})

test('setProjectsLink：non-empty —— 已有值不覆盖', () => {
  const source = '---\nPROJECTS: "[[old|旧]]"\n---\n\nbody\n'
  const result = setProjectsLink(source, '[[new|新]]')
  assert.equal(result.changed, false)
  assert.equal(result.reason, 'non-empty')
  assert.equal(result.text, source)
})

test('setProjectsLink：non-empty —— 列表形式的已有值也不覆盖', () => {
  const source = '---\nPROJECTS:\n  - "[[old|旧]]"\n---\n\nbody\n'
  const result = setProjectsLink(source, '[[new|新]]')
  assert.equal(result.changed, false)
  assert.equal(result.reason, 'non-empty')
  assert.equal(result.text, source)
})

test('setProjectsLink：BOM 原样保留', () => {
  const result = setProjectsLink('\uFEFF---\nPROJECTS:\n---\n\nbody', '[[a|A]]')
  assert.equal(result.changed, true)
  assert.equal(result.text.startsWith('\uFEFF'), true)
  assert.equal(readProjects(result.text), '"[[a|A]]"')
})

test('setProjectsLink：wikilink 里的双引号被转义', () => {
  const result = setProjectsLink('body', '[[a|say "hi"]]')
  assert.equal(result.text.includes('PROJECTS: "[[a|say \\"hi\\"]]"'), true)
})

/* ───────────────────────────── parseNote ───────────────────────────── */

const FULL_NOTE = `---
PROJECTS: "[[x/y|Y]]"
tags: meta
---
# 标题 **加粗**

正文第一段，带 [[链接/别名|别名]] 和 \`代码\`。 ^block-id

- 列表项 **一**
- 列表项 二

> 一段引用

\`\`\`js
const a = 1
\`\`\`

> [!quote] 🔍 洞察 · 2026-11-03 22:10
> 评论正文 **加重**
> 第二行

> [!warning] ⚠️ 风险
> 风险正文
`

test('parseNote：title 取第一个标题块；blocks 不再剔除标题块与首段', () => {
  const parsed = parseNote(FULL_NOTE)
  assert.equal(parsed.title, '标题 加粗')
  assert.deepEqual(
    parsed.blocks.map((block) => block.kind),
    ['h', 'p', 'li', 'li', 'quote', 'code'],
  )
  assert.deepEqual(parsed.blocks[0], { kind: 'h', text: '标题 加粗' })
  assert.equal(parsed.blocks[1].text, '正文第一段，带 别名 和 代码。')
  // 阅读视图/AI 用的 excerpt 也包含首段（不再因为它是标题候选而被剔除）
  assert.match(parsed.excerpt, /标题 加粗 正文第一段/)
})

test('parseNote：meta 不进入 excerpt、正文与标题', () => {
  const parsed = parseNote(FULL_NOTE)
  assert.doesNotMatch(parsed.title, /meta|tags|PROJECTS/)
  assert.doesNotMatch(parsed.excerpt, /meta|tags|PROJECTS/)
  assert.equal(parsed.excerpt.includes('评论正文'), false)
  assert.equal(parsed.excerpt.includes('风险正文'), false)
  assert.match(parsed.excerpt, /正文第一段/)
})

test('parseNote：callout 解析 type / emoji / label / time / text', () => {
  const parsed = parseNote(FULL_NOTE)
  assert.equal(parsed.comments.length, 2)

  const [insight, risk] = parsed.comments
  assert.equal(insight.type, 'quote')
  assert.equal(insight.emoji, '🔍')
  assert.equal(insight.label, '洞察')
  assert.equal(insight.title, '🔍 洞察 · 2026-11-03 22:10')
  assert.equal(insight.time, '2026-11-03 22:10')
  assert.equal(insight.text, '评论正文 加重\n第二行')

  assert.equal(risk.type, 'warning')
  assert.equal(risk.emoji, '⚠️')
  assert.equal(risk.label, '风险')
  assert.equal(risk.time, '')
  assert.equal(risk.text, '风险正文')
})

test('parseNote：callout 未知类型原样返回（client 侧回落）', () => {
  const parsed = parseNote('> [!bogus] 标题\n> 正文\n')
  assert.equal(parsed.comments[0].type, 'bogus')
  assert.equal(parsed.comments[0].label, '标题')
})

test('parseNote：callout 正文多段用换行保留', () => {
  const parsed = parseNote('> [!note] 📝 备注\n> 一\n>\n> 二\n')
  assert.equal(parsed.comments[0].text, '一\n\n二')
})

test('parseNote：没有标题时第一段当标题，且首段仍留在 blocks 里', () => {
  const parsed = parseNote('就是第一段。\n\n第二段。\n')
  assert.equal(parsed.title, '就是第一段。')
  assert.deepEqual(parsed.blocks, [
    { kind: 'p', text: '就是第一段。' },
    { kind: 'p', text: '第二段。' },
  ])
  assert.equal(parsed.excerpt, '就是第一段。 第二段。')
})

test('parseNote：只有列表时用列表首项当标题', () => {
  const parsed = parseNote('- 第一项\n- 第二项\n')
  assert.equal(parsed.title, '第一项')
})

test('parseNote：任务列表解析 checked（[ ] / [x] / [X]）且标记不残留', () => {
  const parsed = parseNote(
    [
      '# T',
      '',
      '- [ ] 待办一',
      '- [x] 已完成小写',
      '- [X] 已完成大写',
      '- 普通列表项',
      '* [ ] 星号任务',
      '1. [x] 有序任务',
    ].join('\n'),
  )
  const items = parsed.blocks.filter((block) => block.kind === 'li')
  assert.equal(items.length, 6)
  const byText = new Map(items.map((item) => [item.text, item]))
  assert.equal(byText.get('待办一').checked, false)
  assert.equal(byText.get('已完成小写').checked, true)
  assert.equal(byText.get('已完成大写').checked, true)
  assert.equal(byText.get('星号任务').checked, false)
  assert.equal(byText.get('有序任务').checked, true)
  // 普通列表项没有 checked 字段
  assert.equal('checked' in byText.get('普通列表项'), false)
  // 任务标记不残留在 text 里
  for (const item of items) {
    assert.doesNotMatch(item.text, /\[[ xX]\]/)
  }
})

test('parseNote：excerpt 任务项带 ☐ / ☑ 前缀，且不残留 [ ] 标记', () => {
  const parsed = parseNote('# T\n\n- [ ] 待办一\n- [x] 已完成\n- [X] 也完成\n- 普通项\n')
  assert.equal(parsed.excerpt, 'T ☐ 待办一 ☑ 已完成 ☑ 也完成 普通项')
  assert.doesNotMatch(parsed.excerpt, /\[[ xX]\]/)
})

test('parseNote：空文本不炸', () => {
  const parsed = parseNote('')
  assert.equal(parsed.title, '')
  assert.deepEqual(parsed.blocks, [])
  assert.deepEqual(parsed.comments, [])
  assert.equal(parsed.excerpt, '')
  assert.equal(parsed.projects, null)
})

test('parseNote：分界线作为独立块保留', () => {
  const parsed = parseNote('标题\n\n---\n\n后续内容')
  assert.ok(parsed.blocks.some((block) => block.kind === 'hr'))
  assert.ok(parsed.blocks.some((block) => block.text === '后续内容'))
})

test('parseNote：行内图片保留前后文字，支持网络、空格路径和 Obsidian 图片', () => {
  const parsed = parseNote('图前 ![说明](https://example.com/a_(b).png "标题") 图后\n\n![本地](<../附件/图 片.png>)\n\n![[附件/截图.png|300]]')
  const images = parsed.blocks.filter((block) => block.kind === 'image')
  assert.equal(images.length, 3)
  assert.equal(images[0].source, 'https://example.com/a_(b).png')
  assert.equal(images[0].alt, '说明')
  assert.equal(images[1].source, '../附件/图 片.png')
  assert.equal(images[2].source, '附件/截图.png')
  assert.equal(images[2].wiki, true)
  assert.equal(parsed.excerpt, '图前 图后')
})

test('parseNote：代码块中的图片和任务保持代码，紧接段落的分界线不被吞掉', () => {
  const parsed = parseNote('正文\n***\n\n```md\n![示例](x.png)\n- [ ] 示例\n```')
  assert.deepEqual(parsed.blocks.map((block) => block.kind), ['p', 'hr', 'code'])
})

test('parseNote：title / excerpt / comment 都不含 markdown 记号', () => {
  const parsed = parseNote(
    '# **标题** 带 `代码`\n\n**正文** 有 ==高亮== 和 ~~删除~~ 与 [链接](https://x)。\n\n> [!tip] 💡 延伸 · 2026-11-03 22:10\n> **评论** 内容 [[a/b|别名]]\n',
  )
  assert.equal(parsed.title, '标题 带 代码')
  assert.equal(parsed.excerpt, '标题 带 代码 正文 有 高亮 和 删除 与 链接。')
  assert.equal(parsed.comments[0].text, '评论 内容 别名')
})

test('parseNote：excerpt 截断到 360 字（带省略号）', () => {
  const parsed = parseNote(`# T\n\n${'字'.repeat(500)}\n`)
  assert.equal(parsed.excerpt.length, 361)
  assert.equal(parsed.excerpt.endsWith('…'), true)
})

test('parseNote：maxComments 生效', () => {
  const text = '> [!note] a\n> 1\n\n> [!note] b\n> 2\n\n> [!note] c\n> 3\n'
  assert.equal(parseNote(text, { maxComments: 2 }).comments.length, 2)
  assert.equal(parseNote(text).comments.length, 3)
})

test('parseNote：projects 取 frontmatter 原文', () => {
  assert.equal(parseNote(FULL_NOTE).projects, '"[[x/y|Y]]"')
  assert.equal(parseNote('# no fm').projects, null)
})

/* ─────────────────────────────── getBody ─────────────────────────────── */

test('getBody：去掉 frontmatter、BOM 与开头空行', () => {
  assert.equal(
    getBody('---\ntags: a\nPROJECTS: "[[x|X]]"\n---\n\n# 标题\n\n正文\n'),
    '# 标题\n\n正文\n',
  )
  assert.equal(getBody('\uFEFF---\nx: 1\n---\nbody'), 'body')
  assert.equal(getBody('# 无 frontmatter\n正文\n'), '# 无 frontmatter\n正文\n')
  assert.equal(getBody(''), '')
  // 只有 frontmatter 时正文为空
  assert.equal(getBody('---\nx: 1\n---\n\n'), '')
})

test('getBody：CRLF 归一化、未闭合 frontmatter 原样返回', () => {
  assert.equal(getBody('---\r\nx: 1\r\n---\r\n\r\n正文\r\n'), '正文\n')
  // 首行不是合法 frontmatter 时正文就是原文
  assert.equal(getBody('---\nx: 1\n正文'), '---\nx: 1\n正文')
})

test('getBody：与 splitFrontmatter 的 body 一致', () => {
  const text = '---\nPROJECTS: "[[a|A]]"\n---\n\n# T\n\n正文\n'
  assert.equal(getBody(text), splitFrontmatter(text).body)
})

test('getBody：正文中间的多个空行保留', () => {
  assert.equal(getBody('---\nx: 1\n---\n\n第一段\n\n\n第二段\n'), '第一段\n\n\n第二段\n')
})

/* ──────────────────────────── appendComment ──────────────────────────── */

test('buildCommentCallout：标题与正文格式', () => {
  const block = buildCommentCallout({ type: 'quote', title: '🔍 洞察 · 2026-11-03 22:10', text: '评论正文' })
  assert.equal(block, '> [!quote] 🔍 洞察 · 2026-11-03 22:10\n> 评论正文')
})

test('buildCommentCallout：多段正文空行写成 >', () => {
  const block = buildCommentCallout({ type: 'tip', title: '标题', text: '一\n\n二' })
  assert.equal(block, '> [!tip] 标题\n> 一\n>\n> 二')
})

test('appendComment：追加到文件末尾（空行分隔）', () => {
  const result = appendComment('# T\n\n正文\n', { type: 'quote', title: '🔍 洞察', text: '评论' })
  assert.equal(result, '# T\n\n正文\n\n> [!quote] 🔍 洞察\n> 评论\n')
})

test('appendComment：空文件只写评论块', () => {
  const result = appendComment('', { type: 'quote', title: '🔍 洞察', text: '评论' })
  assert.equal(result, '> [!quote] 🔍 洞察\n> 评论\n')
})

test('appendComment：多次追加按顺序累积', () => {
  let text = '# T\n\n正文\n'
  text = appendComment(text, { type: 'quote', title: '一', text: '第一条' })
  text = appendComment(text, { type: 'tip', title: '二', text: '第二条' })
  assert.equal(
    text,
    '# T\n\n正文\n\n> [!quote] 一\n> 第一条\n\n> [!tip] 二\n> 第二条\n',
  )
  const parsed = parseNote(text)
  assert.deepEqual(parsed.comments.map((comment) => comment.type), ['quote', 'tip'])
  assert.deepEqual(parsed.comments.map((comment) => comment.text), ['第一条', '第二条'])
})

test('appendComment：中文与多行评论都能被 parseNote 读回', () => {
  const result = appendComment('# T', { type: 'warning', title: '⚠️ 风险 · 2026-11-03 22:10', text: '第一段\n\n第二段' })
  const comment = parseNote(result).comments[0]
  assert.equal(comment.type, 'warning')
  assert.equal(comment.emoji, '⚠️')
  assert.equal(comment.label, '风险')
  assert.equal(comment.time, '2026-11-03 22:10')
  assert.equal(comment.text, '第一段\n\n第二段')
})

/* ───────────────────────── colorForTag / tag ───────────────────────── */

test('colorForTag：无 tag 用纸白', () => {
  assert.equal(colorForTag(null), CARD_PALETTE[0].color)
  assert.equal(colorForTag(''), CARD_PALETTE[0].color)
  assert.equal(colorForTag(undefined), '#FDFAF4')
})

test('CARD_PALETTE：0.12 修正轮色板与契约 §3.5 完全一致（日间纸色再往白里调）', () => {
  assert.deepEqual(
    CARD_PALETTE.map((item) => [item.name, item.color, item.dark]),
    [
      ['纸白', '#FDFAF4', '#2C2721'],
      ['苔绿', '#F5F9F4', '#232B24'],
      ['杏', '#FDF7F3', '#2E2622'],
      ['雾蓝', '#F4F8FC', '#222A33'],
      ['藕荷', '#FAF5FA', '#2A242C'],
      ['米', '#FAF8F2', '#2B2822'],
      ['胭脂', '#FDF5F6', '#2E2426'],
      ['青瓷', '#F5F9F7', '#222C29'],
    ],
  )
  // 旧的 0.11 / 首版 0.12 纸色都不应再出现
  for (const stale of ['#FBF3DF', '#FCF7EC']) {
    assert.equal(CARD_PALETTE.some((item) => item.color === stale), false, `旧色 ${stale} 不应留在色板里`)
  }
})

test('colorForTag：同一 tag 恒定、都在色板内', () => {
  const palette = new Set(CARD_PALETTE.map((item) => item.color))
  const first = colorForTag('设计')
  for (let i = 0; i < 20; i += 1) assert.equal(colorForTag('设计'), first)
  assert.equal(palette.has(first), true)
  assert.equal(colorForTag('设计'), colorForTag('设计'))
})

test('colorForTag：不同 tag 会分到多种色（不是恒定一色）', () => {
  const tags = ['设计', '想法', '读书', '代码', '工作', '生活', '研究', '写作', '灵感', '会议']
  const colors = new Set(tags.map((tag) => colorForTag(tag)))
  assert.ok(colors.size >= 2, `期望至少两种颜色，实际 ${[...colors].join(',')}`)
})

test('colorForTag / darkColorForTag：同 tag 稳定、color/darkColor 来自同一色板项', () => {
  const darkByColor = new Map(CARD_PALETTE.map((item) => [item.color, item.dark]))
  for (const tag of [null, '', '设计', 'WORKING_NOW', '想法', '读书']) {
    const color = colorForTag(tag)
    const dark = darkColorForTag(tag)
    assert.match(color, /^#[0-9A-Fa-f]{6}$/)
    assert.match(dark, /^#[0-9A-Fa-f]{6}$/)
    assert.equal(darkByColor.get(color), dark, `${tag} 的 color 与 darkColor 必须是同一色板项`)
    // 同一 tag 多次调用稳定
    assert.equal(colorForTag(tag), color)
    assert.equal(darkColorForTag(tag), dark)
  }
  // 无 tag = 纸白 + 纸白暗色
  assert.equal(colorForTag(null), '#FDFAF4')
  assert.equal(darkColorForTag(null), '#2C2721')
  // 同一 tag 的两个便签必然同色（hex 成对）
  assert.deepEqual([colorForTag('设计'), darkColorForTag('设计')], [colorForTag('设计'), darkColorForTag('设计')])
})

test('tagForRelativePath：顶层 null、第一层子目录为 tag', () => {
  assert.equal(tagForRelativePath('a.md'), null)
  assert.equal(tagForRelativePath('WORKING_NOW/b.md'), 'WORKING_NOW')
  assert.equal(tagForRelativePath('WORKING_NOW/深层/c.md'), 'WORKING_NOW')
  assert.equal(tagForRelativePath(''), null)
})

/* ─────────────────────────── 图片 / 评论种类（0.12） ─────────────────────────── */

test('summarizeImages：只取图片块、前 3 张、给出总数；非图片块忽略', () => {
  const blocks = [
    { kind: 'p', text: '前文' },
    { kind: 'image', text: '', source: 'a.png', alt: 'A', wiki: false },
    { kind: 'image', text: '', source: 'b.png', alt: '', wiki: true },
    { kind: 'image', text: '', source: 'c.png', alt: 'C', wiki: false },
    { kind: 'image', text: '', source: 'd.png', alt: 'D', wiki: false },
    { kind: 'li', text: '列表' },
  ]
  const result = summarizeImages(blocks)
  assert.deepEqual(result.images.map((item) => item.source), ['a.png', 'b.png', 'c.png'])
  assert.deepEqual(result.images[1], { source: 'b.png', alt: '', wiki: true })
  assert.equal(result.imageCount, 4)

  // limit 可调；空/异常输入安全
  assert.equal(summarizeImages(blocks, 1).images.length, 1)
  assert.deepEqual(summarizeImages(null), { images: [], imageCount: 0 })
  assert.deepEqual(summarizeImages([]), { images: [], imageCount: 0 })
  // 缺 source 的图片块不计入
  assert.equal(summarizeImages([{ kind: 'image', source: '  ' }]).imageCount, 0)
})

test('commentKindsFrom：评论 emoji 去重、按出现顺序、空 emoji 不计', () => {
  assert.deepEqual(
    commentKindsFrom([
      { emoji: '😈' },
      { emoji: '' },
      { emoji: '🔍' },
      { emoji: '😈' },
      {},
      { emoji: '⚠️' },
    ]),
    ['😈', '🔍', '⚠️'],
  )
  assert.deepEqual(commentKindsFrom(null), [])
  assert.deepEqual(commentKindsFrom([]), [])
})

test('parseNote：正文图片块 + 评论 callout 里的图分开（blocks 只含正文图）', () => {
  const parsed = parseNote(
    [
      '第一段 ![截图](img/a.png) 结束。',
      '',
      '![[附件/b.png]]',
      '',
      '> [!quote] 😈 毒舌 · 2026-11-03 22:10',
      '> 评论里 ![不算](img/c.png)',
      '',
    ].join('\n'),
  )
  const images = parsed.blocks.filter((block) => block.kind === 'image')
  assert.deepEqual(images.map((block) => block.source), ['img/a.png', '附件/b.png'])
  assert.deepEqual(summarizeImages(parsed.blocks).images, [
    { source: 'img/a.png', alt: '截图', wiki: false },
    { source: '附件/b.png', alt: '', wiki: true },
  ])
  assert.equal(summarizeImages(parsed.blocks).imageCount, 2)
})

/* ───────────────────────────── 其他纯函数 ───────────────────────────── */

test('stripInline：常见 markdown 记号清理', () => {
  assert.equal(stripInline('**粗** _斜_ ~~删~~ ==高亮== `代码`'), '粗 斜 删 高亮 代码')
  assert.equal(stripInline('[[a/b|别名]] 和 [[c/d]] 和 [[x#标题|带标题]]'), '别名 和 d 和 带标题')
  assert.equal(stripInline('![图](a.png) ![[嵌入]] [文字](https://x)'), '文字')
  assert.equal(stripInline('%%注释%% 正文 <span>标签</span>'), '正文 标签')
  assert.equal(stripInline('正文 ^block-id'), '正文')
})

test('stripInline / parseNote：0.13.9 隐藏行尾 block id 只去掉锚点，不吞掉它后面的文字', () => {
  // Obsidian block id 只出现在行尾：行尾锚点被删掉，锚点后面的下一行文字完整保留。
  assert.equal(stripInline('前文 ^qa-daily-preview-1e5t8lm'), '前文')
  assert.equal(stripInline('前文 ^qa-daily-preview-1e5t8lm\n后面的文字'), '前文\n后面的文字')
  assert.equal(stripInline('^qa-daily-preview-1e5t8lm'), '')
  assert.equal(stripBlockIds('第一行 ^id\n第二行 ^id-2\n第三行'), '第一行\n第二行\n第三行')
  assert.equal(stripBlockIds('连写锚点 ^id-1 ^id-2'), '连写锚点')

  // 行中/行首的 `^token` 不是 Obsidian 锚点，不能误删（否则会吞掉行内代码或上标）。
  assert.equal(stripInline('前文 ^id-1 中间 ^id-2 结尾'), '前文 ^id-1 中间 ^id-2 结尾')
  assert.equal(stripInline('说明里用 `^abc` 表示锚点'), '说明里用 ^abc 表示锚点')
  assert.equal(stripInline('代码 `x ^2` 与 `^block-id` 保留'), '代码 x ^2 与 ^block-id 保留')
  assert.equal(stripInline('求和公式 x ^2 加 y'), '求和公式 x ^2 加 y')
  assert.equal(stripInline('上标在行尾 x^2'), '上标在行尾 x^2')
  assert.equal(stripInline('^This 是行首'), '^This 是行首')
  assert.equal(stripInline('前文 ^qa-daily-preview-1e5t8lm。'), '前文 ^qa-daily-preview-1e5t8lm。')

  const parsed = parseNote([
    '# 标题 ^qa-daily-preview-1e5t8lm',
    '',
    '第一行 ^qa-daily-preview-1e5t8lm',
    '第二行继续',
    '',
    '- 列表项 ^qa-daily-preview-9x',
    '- 下一条',
    '',
    '> [!note] 评论',
    '> 评论正文 ^qa-daily-preview-1e5t8lm',
  ].join('\n'))
  assert.equal(parsed.title, '标题')
  assert.deepEqual(parsed.blocks.map((block) => block.text), ['标题', '第一行 第二行继续', '列表项', '下一条'])
  assert.match(parsed.excerpt, /第一行 第二行继续/)
  assert.doesNotMatch(parsed.excerpt, /qa-daily-preview/)
  assert.equal(parsed.comments.length, 1)
  assert.equal(parsed.comments[0].text, '评论正文')
})

test('clip：短文本原样，长文本截断加省略号', () => {
  assert.equal(clip('abc', 5), 'abc')
  assert.equal(clip('abcdef', 3), 'abc…')
})
