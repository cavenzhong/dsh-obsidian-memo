import test from 'node:test'
import assert from 'node:assert/strict'
import { getBody, normalizeText, splitFrontmatter } from '../../lib/notes.js'

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
