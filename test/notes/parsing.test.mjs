import { FULL_NOTE } from '../../test-support/notes-fixtures.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNote, summarizeImages } from '../../lib/notes.js'

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

test('parseNote：保留有序列表数字，圆点与任务列表继续独立解析，代码不当作列表', () => {
  const parsed = parseNote('1. 第一项\n2. 第二项\n12) 第十二项\n- 圆点\n* 星号\n+ 加号\n- [ ] 任务\n\n```\n1. 代码\n```')
  assert.deepEqual(parsed.blocks.filter((block) => block.kind === 'li').map((block) => [block.text, block.marker, block.checked]), [
    ['第一项', '1.', undefined], ['第二项', '2.', undefined], ['第十二项', '12)', undefined],
    ['圆点', undefined, undefined], ['星号', undefined, undefined], ['加号', undefined, undefined], ['任务', undefined, false],
  ])
  assert.equal(parsed.blocks.at(-1).kind, 'code')
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

test('parseNote：展示块到达上限后仍读取尾部评论，并跳过代码和引用中的示例', () => {
  const text = ['# 标题', '', '第二块', '', '- 第三块', '',
    '后续正文\n\n'.repeat(300),
    '```md', '> [!note] 不是真评论', '> 示例', '```', '',
    '> 普通引用', '> [!note] 同样只是引用内容', '',
    '> [!tip] 💡 尾部评论', '> 保留的评论', '',
    '> [!warning] 第二条评论', '> 到达评论上限后不再保留', '',
  ].join('\n')
  const parsed = parseNote(text, { maxBlocks: 3, maxComments: 1 })
  assert.deepEqual(parsed.blocks.map((block) => block.kind), ['h', 'p', 'li'])
  assert.equal(parsed.title, '标题')
  assert.equal(parsed.comments.length, 1)
  assert.equal(parsed.comments[0].text, '保留的评论')
  assert.equal(parsed.comments[0].emoji, '💡')
})

test('parseNote：首个文字标题在展示上限之外时仍保持原有标题语义', () => {
  const parsed = parseNote('***\n\n```js\ncode\n```\n\n---\n\n# 较晚的标题\n\n后续正文', { maxBlocks: 1 })
  assert.equal(parsed.title, '较晚的标题')
  assert.equal(parsed.blocks.length, 1)
  assert.equal(parsed.blocks[0].kind, 'hr')
})
