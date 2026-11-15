import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_FILE_NAME_PATTERN, buildCaptureFileName, expandFileNamePattern, sanitizeNoteFileName, truncateNoteName,
} from '../lib/filename.js'
import { LIMITS } from '../lib/shared.js'
import * as clientPattern from '../src/client/settings/note-title-pattern.js'
import { PATTERN_CASES, TOKEN_CASES, TRUNCATE_CASES, fixtureNow } from '../test-support/title-pattern-fixtures.mjs'

test('文件名规范化：清理路径/Markdown 特殊字符、空白与首尾点', () => {
  assert.deepEqual(sanitizeNoteFileName('  我的/想法:test*?"<>|#^[]  '), { name: '我的 想法 test', error: null })
  assert.deepEqual(sanitizeNoteFileName('.hidden'), { name: 'hidden', error: null })
  assert.deepEqual(sanitizeNoteFileName('  .hidden  '), { name: 'hidden', error: null })
  assert.deepEqual(sanitizeNoteFileName('name. . '), { name: 'name', error: null })
  assert.deepEqual(sanitizeNoteFileName('a..b'), { name: 'a..b', error: null })
})

test('文件名规范化：控制符、零宽与双向控制符被清掉，Unicode 归一为 NFC', () => {
  assert.deepEqual(sanitizeNoteFileName('a\u0000b\u001fc'), { name: 'a b c', error: null })
  assert.deepEqual(sanitizeNoteFileName('a\u200bb\u202ec'), { name: 'a b c', error: null })
  assert.deepEqual(sanitizeNoteFileName('e\u0301'), { name: 'é', error: null })
})

test('文件名规范化：拒绝空名与 Windows 保留设备名', () => {
  for (const raw of ['', '   ', '...', ' . . ']) {
    assert.equal(sanitizeNoteFileName(raw).error, 'empty')
  }
  for (const raw of ['CON', 'con', ' con ', 'CON.txt', 'PRN', 'AUX', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9']) {
    assert.equal(sanitizeNoteFileName(raw).error, 'reserved', raw)
  }
  for (const raw of ['CONSOLE', 'COM10', 'LPT10', 'con-x']) {
    assert.equal(sanitizeNoteFileName(raw).error, null, raw)
  }
})

test('文件名规范化：默认 240 UTF-8 字节上限，可传自定义上限', () => {
  assert.equal(LIMITS.noteNameBytes, 240)
  assert.equal(sanitizeNoteFileName('字'.repeat(80)).error, null)
  assert.equal(sanitizeNoteFileName('字'.repeat(81)).error, 'too-long')
  assert.equal(sanitizeNoteFileName('a'.repeat(240)).error, null)
  assert.equal(sanitizeNoteFileName('a'.repeat(241)).error, 'too-long')
  assert.equal(sanitizeNoteFileName('a'.repeat(11), 10).error, 'too-long')
})

test('文件名模板：token 展开、未知 token 原样保留、空模板回退默认', () => {
  const now = fixtureNow()
  assert.equal(expandFileNamePattern('{date}-{time}', { title: '想法', now }), '2026-11-13-1924')
  assert.equal(expandFileNamePattern('{timestamp}', { now }), '20261113-192405')
  assert.equal(expandFileNamePattern('叉叉-{title}', { title: '想法', now }), '叉叉-想法')
  assert.equal(expandFileNamePattern('{unknown}-{date}', { now }), '{unknown}-2026-11-13')
  assert.equal(expandFileNamePattern('', { now }), '2026-11-13-1924')
  assert.equal(expandFileNamePattern('   ', { now }), '2026-11-13-1924')
  assert.equal(DEFAULT_FILE_NAME_PATTERN, '{date}-{time}')
})

test('文件名模板：清洗、保留名与 240 字节截断', () => {
  assert.equal(buildCaptureFileName('{title}', { title: 'a/b:c', now: fixtureNow() }), 'a b c')
  assert.equal(buildCaptureFileName('便签', { title: 'x', now: fixtureNow() }), '便签')
  assert.equal(buildCaptureFileName('CON', { title: 'x', now: fixtureNow() }), 'note-CON')
  assert.equal(buildCaptureFileName('{title}', { title: '字'.repeat(81), now: fixtureNow() }), '字'.repeat(80))
  assert.equal(buildCaptureFileName('. . .', { now: fixtureNow() }), 'note-20261113-192405')
})

test('truncateNoteName：按 UTF-8 字节在码点边界截断，并清理尾随点/空格', () => {
  for (const item of TRUNCATE_CASES) {
    assert.equal(truncateNoteName(item.input), item.expected, JSON.stringify(item.input.slice(0, 12)))
  }
  assert.equal(Buffer.byteLength(truncateNoteName('字'.repeat(200)), 'utf8'), 240)
})

test('文件名模板 parity：Host buildCaptureFileName 与 Client buildPreviewName 一致', () => {
  const now = fixtureNow()
  for (const item of PATTERN_CASES) {
    const host = buildCaptureFileName(item.pattern, { title: item.title, now })
    const client = clientPattern.buildPreviewName(item.pattern, { title: item.title, now })
    assert.equal(host, item.expected, `host ${item.pattern}`)
    assert.equal(client, item.expected, `client ${item.pattern}`)
  }
  // 空模板与默认预览。
  assert.equal(clientPattern.buildPreviewName('', { now }), '2026-11-13-1924')
  assert.equal(clientPattern.resolveFileNamePattern('   '), DEFAULT_FILE_NAME_PATTERN)
  assert.equal(clientPattern.resolveFileNamePattern('x'.repeat(200)).length, 120)
})

test('文件名模板：Client token 插入到光标处', () => {
  for (const item of TOKEN_CASES) {
    const result = clientPattern.insertPatternToken(item.value, item.token, item.start, item.end)
    assert.deepEqual(result, { value: item.expected, caret: item.caret })
  }
})
