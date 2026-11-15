/** 0.16.8：文件名模板与标题模式的浏览器端纯函数。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { getTestApi, loadClient } from '../../test-support/client.mjs'

test('client 0.16.8：标题模式常量与方向键切换', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.deepEqual(api.TITLE_MODES, ['filename', 'firstLine', 'heading'])
  assert.equal(api.DEFAULT_TITLE_MODE, 'filename')
  assert.equal(api.normalizeTitleMode(undefined), 'filename')
  assert.equal(api.normalizeTitleMode('heading'), 'heading')
  assert.equal(api.nextTitleMode('filename', 'ArrowRight'), 'firstLine')
  assert.equal(api.nextTitleMode('filename', 'ArrowDown'), 'firstLine')
  assert.equal(api.nextTitleMode('heading', 'ArrowRight'), 'filename')
  assert.equal(api.nextTitleMode('firstLine', 'ArrowLeft'), 'filename')
  assert.equal(api.nextTitleMode('firstLine', 'Escape'), null)
  assert.equal(api.nextTitleMode('未知', 'ArrowRight'), 'firstLine')
})

test('client 0.16.8：模板默认值、展开、清洗、截断与预览', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const now = new Date(2026, 10, 13, 19, 24, 5)
  assert.equal(api.DEFAULT_FILE_NAME_PATTERN, '{date}-{time}')
  assert.equal(api.resolveFileNamePattern('   '), '{date}-{time}')
  assert.equal(api.resolveFileNamePattern('x'.repeat(200)).length, api.FILE_NAME_PATTERN_MAX)
  assert.equal(api.expandFileNamePattern('{date}-{time}', { now }), '2026-11-13-1924')
  assert.equal(api.expandFileNamePattern('{timestamp}', { now }), '20261113-192405')
  assert.equal(api.expandFileNamePattern('{unknown}-{date}', { now }), '{unknown}-2026-11-13')
  assert.deepEqual(api.sanitizeGeneratedName('a/b:c'), { name: 'a b c', error: null })
  assert.equal(api.sanitizeGeneratedName('CON').error, 'reserved')
  assert.equal(api.sanitizeGeneratedName('   ').error, 'empty')
  assert.equal(api.truncateNoteName('字'.repeat(81)), '字'.repeat(80))
  assert.equal(api.buildPreviewName('便签', { now }), '便签')
  assert.equal(api.buildPreviewName('', { now }), '2026-11-13-1924')
  assert.equal(api.buildPreviewName('{title}', { title: 'a/b', now }), 'a b')
  assert.equal(api.NOTE_NAME_MAX_BYTES, 240)
})
