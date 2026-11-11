import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionState } from '../../lib/host/session.js'
import { createWriteCoordinator } from '../../lib/host/writes.js'

test('Host 服务：不同插件实例的任务与撤回 token 独立', () => {
  const first = createSessionState(), second = createSessionState()
  const job = first.startJob('comment', '/note.md', { emojiId: 'devil' })
  first.undos.set('archive', { expires: Date.now() + 10000 })
  first.deleteUndos.set('delete', { expires: Date.now() + 10000 })
  assert.equal(first.liveJobs()[0].id, job.id)
  assert.deepEqual(second.liveJobs(), [])
  assert.equal(second.undos.size, 0)
  assert.equal(second.deleteUndos.size, 0)
  const snapshot = first.liveJobs()
  snapshot[0].status = 'error'
  assert.equal(first.runningJob('comment', '/note.md', 'devil'), job)
})

test('Host 写队列：同一路径按序执行，失败后仍可继续，其他路径不被阻塞', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'memo-write-service-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'note.md'), other = join(directory, 'other.md')
  await writeFile(path, '')
  await writeFile(other, '')
  const { withNoteWrite } = createWriteCoordinator()
  let release, markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const waiting = new Promise((resolve) => { release = resolve })
  const order = []
  const first = withNoteWrite(path, async () => {
    order.push('first')
    markStarted()
    await waiting
    throw new Error('write failed')
  })
  const rejected = assert.rejects(first, /write failed/)
  await started
  const second = withNoteWrite(path, () => { order.push('second') })
  await withNoteWrite(other, () => { order.push('other') })
  assert.deepEqual(order, ['first', 'other'])
  release()
  await Promise.all([rejected, second])
  assert.deepEqual(order, ['first', 'other', 'second'])
})
