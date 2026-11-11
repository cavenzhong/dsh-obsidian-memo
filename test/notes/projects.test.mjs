import test from 'node:test'
import assert from 'node:assert/strict'
import { readProjects, setProjectsLink } from '../../lib/notes.js'

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
