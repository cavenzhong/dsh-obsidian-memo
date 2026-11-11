/** host: capture regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeCase } from '../../test-support/host.mjs'

test('createNote：已认证 RPC 支持超过 2 MB 的图片请求，返回摘要并可阅读附件', async () => {
  const c = await makeCase()
  const bytes = Buffer.alloc(2 * 1024 * 1024)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes)
  const created = await c.call('createNote', { title: '快速记录', body: '一点细节', images: [{ dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }] })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(created.value.note.title, '快速记录')
  assert.equal(created.value.note.imageCount, 1)
  const image = created.value.note.images[0]
  const loaded = await c.call('readImage', { path: created.value.path, ...image })
  assert.equal(loaded.ok, true)
  assert.equal(Buffer.from(loaded.value.dataUrl.split(',')[1], 'base64').length, bytes.length)
  const state = await c.call('state', {})
  assert.equal(state.value.notes.length, 1)
  const duplicate = await c.call('createNote', { title: '快速记录', body: '覆盖' })
  assert.equal(duplicate.error.code, 'exists')
  const full = await c.call('note', { path: created.value.path })
  assert.match(full.value.body, /^一点细节/)
})
