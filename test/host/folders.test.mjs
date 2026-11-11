/** host: folders regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SETTINGS_FILE, makeCase } from '../../test-support/host.mjs'

test('saveSettings：includeSubfolders=false 只扫顶层，切回 true 恢复子文件夹便签', async () => {
  const c = await makeCase({
    notes: {
      '顶层.md': '# 顶层\n\n正文\n',
      'WORKING_NOW/子.md': '# 子\n\n正文\n',
    },
  })
  const first = await c.call('state')
  assert.equal(first.value.notes.length, 2)
  assert.deepEqual(first.value.notes.map((note) => note.name).sort(), ['子', '顶层'].sort())

  const saved = await c.call('saveSettings', {
    settings: { ...first.value.settings, includeSubfolders: false },
  })
  assert.equal(saved.ok, true)
  assert.equal(saved.value.settings.includeSubfolders, false)
  assert.equal(JSON.parse(await readFile(SETTINGS_FILE, 'utf8')).includeSubfolders, false)

  const flat = await c.call('state')
  assert.deepEqual(flat.value.notes.map((note) => note.name), ['顶层'])
  assert.equal(flat.value.notes[0].tag, null)
  assert.equal(flat.value.settings.includeSubfolders, false)
  assert.notEqual(flat.value.revision, first.value.revision)

  const restored = await c.call('saveSettings', {
    settings: { ...saved.value.settings, includeSubfolders: true },
  })
  assert.equal(restored.ok, true)
  assert.equal(restored.value.settings.includeSubfolders, true)

  const full = await c.call('state')
  assert.deepEqual(full.value.notes.map((note) => note.name).sort(), ['子', '顶层'].sort())
  assert.equal(full.value.notes.find((note) => note.name === '子').tag, 'WORKING_NOW')
})
