/** Host / Client 标题行为一致性：同一组 fixture 分别跑 lib/title.js 与 reader/title-line.js。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as host from '../lib/title.js'
import * as client from '../src/client/reader/title-line.js'
import { SANITIZE_CASES, TITLE_CASES, WRITE_CASES } from '../test-support/title-parity-fixtures.mjs'

test('title parity：findTitleLine / deriveTitle 在三种模式下逐项一致', () => {
  for (const item of TITLE_CASES) {
    const lines = item.body.split('\n')
    const expected = { title: item.title, index: item.index, marker: item.marker }
    assert.deepEqual(host.findTitleLine(lines, item.mode), expected, `host ${item.mode} ${JSON.stringify(item.body)}`)
    assert.deepEqual(client.findTitleLine(lines, item.mode), expected, `client ${item.mode} ${JSON.stringify(item.body)}`)
    assert.equal(host.deriveTitle(item.body, item.mode), item.title)
    assert.equal(client.deriveTitle(item.body, item.mode), item.title)
  }
})

test('title parity：sanitizeTitleText 一致（换行、控制符、零宽字符、NFC）', () => {
  for (const [input, expected] of SANITIZE_CASES) {
    assert.equal(host.sanitizeTitleText(input), expected, `host ${JSON.stringify(input)}`)
    assert.equal(client.sanitizeTitleText(input), expected, `client ${JSON.stringify(input)}`)
  }
})

test('title parity：titleLineFor 写回与再读取一致（含围栏/分隔线的反斜杠转义）', () => {
  for (const item of WRITE_CASES) {
    const hostLine = host.titleLineFor(item.mode, item.title, item.marker)
    const clientLine = client.titleLineFor(item.mode, item.title, item.marker)
    assert.equal(hostLine, item.line, `host line ${item.mode} ${JSON.stringify(item.title)}`)
    assert.equal(clientLine, item.line, `client line ${item.mode} ${JSON.stringify(item.title)}`)
    if (item.line === '') continue
    assert.equal(host.findTitleLine([item.line], item.mode).title, item.expect)
    assert.equal(client.findTitleLine([item.line], item.mode).title, item.expect)
  }
})

test('title parity：stripTitleLine 去掉标题行、保留其余正文', () => {
  const cases = [
    ['firstLine', '标题\n\n正文\n第二段', '正文\n第二段'],
    ['firstLine', '\n\n标题\n正文', '正文'],
    ['heading', '前言\n\n# 标题\n\n正文', '前言\n\n\n正文'],
    ['heading', '没有一级标题\n正文', '没有一级标题\n正文'],
    ['filename', '标题\n正文', '标题\n正文'],
  ]
  for (const [mode, body, expected] of cases) {
    assert.equal(host.stripTitleLine(body, mode), expected)
    assert.equal(client.stripTitleLine(body, mode), expected)
  }
})

test('title：统一模式名非法值回退 filename', () => {
  for (const value of ['', null, undefined, 'FirstLine', 'body', 1]) {
    assert.equal(host.normalizeTitleMode(value), 'filename')
    assert.equal(client.normalizeTitleMode(value), 'filename')
  }
  assert.equal(host.normalizeTitleMode('heading'), 'heading')
  assert.equal(client.normalizeTitleMode('firstLine'), 'firstLine')
})
