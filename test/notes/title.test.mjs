/** 0.16.8：标题推导与 parseNote 的标题行隐藏（文件行号保持不变）。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNote, summarizeImages } from '../../lib/notes.js'

test('parseNote：filename 模式保持旧行为（标题取第一个 h/p，标题行仍在 blocks）', () => {
  const parsed = parseNote('# 文件名不是标题\n\n正文', { titleMode: 'filename' })
  assert.equal(parsed.title, '文件名不是标题')
  assert.deepEqual(parsed.blocks.map((block) => block.text), ['文件名不是标题', '正文'])
})

test('parseNote：firstLine 模式标题行不进入 blocks / excerpt', () => {
  const parsed = parseNote('我的想法\n\n第一段正文\n第二行', { titleMode: 'firstLine' })
  assert.equal(parsed.title, '我的想法')
  assert.deepEqual(parsed.blocks.map((block) => block.text), ['第一段正文 第二行'])
  assert.equal(parsed.excerpt, '第一段正文 第二行')
})

test('parseNote：heading 模式取第一个一级标题，跳过代码围栏与二级标题', () => {
  const text = '```md\n# 代码里\n```\n\n## 二级\n\n# 真标题\n\n正文'
  const parsed = parseNote(text, { titleMode: 'heading' })
  assert.equal(parsed.title, '真标题')
  assert.equal(parsed.blocks.some((block) => block.text === '真标题'), false)
  assert.equal(parsed.blocks.some((block) => block.text === '二级'), true)
  assert.equal(parsed.blocks.some((block) => block.kind === 'code' && block.text === '# 代码里'), true, '代码块内容仍应显示')
})

test('parseNote：heading 模式没有 H1 时标题为空，正文完整保留', () => {
  const parsed = parseNote('## 只有二级\n\n正文', { titleMode: 'heading' })
  assert.equal(parsed.title, '')
  assert.deepEqual(parsed.blocks.map((block) => block.text), ['只有二级', '正文'])
})

test('parseNote：正文模式隐藏重复标题文字但保留源行号（评论删除的 withRanges 依赖）', () => {
  const text = '# 标题\n\n正文\n\n> [!note] 😈 毒舌 · 2026-11-13 10:00\n> 评论内容\n'
  const heading = parseNote(text, { titleMode: 'heading', withRanges: true })
  const firstLine = parseNote(text, { titleMode: 'firstLine', withRanges: true })
  const filename = parseNote(text, { titleMode: 'filename', withRanges: true })
  assert.equal(heading.comments.length, 1)
  assert.equal(firstLine.comments.length, 1)
  assert.equal(heading.comments[0].startLine, 4)
  assert.equal(firstLine.comments[0].startLine, 4)
  assert.equal(filename.comments[0].startLine, 4)
  assert.equal(heading.comments[0].endLine, 5)
})

test('标题展示投影：隐藏标题文字仍保留同行图片、任务与评论的源行号', () => {
  for (const mode of ['firstLine', 'heading']) {
    const text = '# **标题** ![[照片.png|300]] ![图](<附件/图 片.png>) ^memo\n\n- [ ] 任务\n\n> [!note] 评论\n> 内容\n'
    const parsed = parseNote(text, { titleMode: mode, withRanges: true })
    assert.equal(parsed.title, '标题')
    assert.equal(parsed.excerpt, '☐ 任务')
    assert.deepEqual(parsed.blocks.filter((block) => block.kind === 'image').map((block) => block.source), ['照片.png', '附件/图 片.png'])
    assert.equal(summarizeImages(parsed.blocks).imageCount, 2)
    assert.equal(parsed.blocks.find((block) => block.kind === 'li').sourceLine, 2)
    assert.equal(parsed.comments[0].startLine, 4)
    assert.equal(parsed.comments[0].endLine, 5)
  }
})

test('代码围栏：标题推导、阅读与评论解析共用完整闭合规则', () => {
  const text = '````md\n```\n# 代码标题\n> [!note] 示例评论\n> 不是评论\n````\n\n# 真标题\n\n> [!note] 真评论\n> 内容'
  for (const mode of ['filename', 'firstLine', 'heading']) {
    const parsed = parseNote(text, { titleMode: mode, withRanges: true })
    assert.equal(parsed.comments.length, 1)
    assert.equal(parsed.comments[0].title, '真评论')
    assert.equal(parsed.comments[0].startLine, 9)
    assert.equal(parsed.blocks[0].kind, 'code')
    assert.match(parsed.blocks[0].text, /# 代码标题/)
    assert.match(parsed.blocks[0].text, /> \[!note\] 示例评论/)
    if (mode === 'heading') assert.equal(parsed.title, '真标题')
    const limited = parseNote('首段\n\n' + text, { titleMode: mode, maxBlocks: 1 })
    assert.deepEqual(limited.comments.map((comment) => comment.title), ['真评论'], '达到展示上限后也不把示例当评论')
  }
})

test('parseNote：firstLine 围栏行不作为标题，也不会被置空（代码块语义不变）', () => {
  const text = '```js\n> [!note] 不是真评论\n> 示例\n```'
  const parsed = parseNote(text, { titleMode: 'firstLine' })
  assert.equal(parsed.title, '')
  assert.equal(parsed.comments.length, 0)
  assert.equal(parsed.blocks[0].kind, 'code')
})

test('parseNote：标题行只有图片 / 空 H1 时回退为空标题且不置空', () => {
  const image = parseNote('![[a.png]]\n正文', { titleMode: 'firstLine' })
  assert.equal(image.title, '')
  assert.equal(image.blocks.some((block) => block.kind === 'image'), true)
  const emptyHeading = parseNote('#\n\n正文', { titleMode: 'heading' })
  assert.equal(emptyHeading.title, '')
  assert.equal(emptyHeading.blocks.some((block) => block.kind === 'p' && block.text === '正文'), true)
})
