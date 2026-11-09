import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeNoteFileName } from '../lib/filename.js'
import { LIMITS } from '../lib/shared.js'

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
