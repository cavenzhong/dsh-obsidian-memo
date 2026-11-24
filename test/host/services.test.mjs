import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionState } from '../../lib/host/session.js'
import { createWriteCoordinator } from '../../lib/host/writes.js'
import { createDispatcher } from '../../lib/host/dispatch.js'

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

test('Host 写队列：moveNote 与 saveNote 共用源便签的写锁', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'memo-write-service-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'note.md')
  await writeFile(path, '')
  const { withNoteWrite } = createWriteCoordinator()
  let release, markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const waiting = new Promise((resolve) => { release = resolve })
  const order = []
  const dispatch = createDispatcher({ withNoteWrite, endpoints: {
    async saveNote() { markStarted(); await waiting; order.push('save') },
    moveNote() { order.push('move') },
  } })
  const save = dispatch('saveNote', { path })
  await started
  const move = dispatch('moveNote', { path })
  release()
  assert.equal((await save).ok, true)
  assert.equal((await move).ok, true)
  assert.deepEqual(order, ['save', 'move'])
})

test('跨便签写入：受保护的迁移等待现有写操作；后续其他文件的编辑等待迁移', async () => {
  const { withNoteWrite, withNoteWrites, withVaultWrite } = createWriteCoordinator()
  let pauseWrite, pauseMove, startWrite, startMove
  const writePaused = new Promise(resolve => { pauseWrite = resolve })
  const movePaused = new Promise(resolve => { pauseMove = resolve })
  const writeStarted = new Promise(resolve => { startWrite = resolve })
  const moveStarted = new Promise(resolve => { startMove = resolve })
  const order = []
  const first = withNoteWrite('/reference.md', async () => { order.push('write'); startWrite(); await writePaused })
  await writeStarted
  const moving = withNoteWrites(['/old.md', '/new.md'], async () => {
    order.push('move'); startMove(); await movePaused; throw new Error('CLI failed')
  }, { exclusive: true })
  const rejected = assert.rejects(moving, /CLI failed/)
  const second = withNoteWrite('/other-reference.md', () => order.push('other'))
  const creating = withVaultWrite(() => order.push('create'))
  assert.deepEqual(order, ['write'])
  pauseWrite()
  await moveStarted
  assert.deepEqual(order, ['write', 'move'])
  pauseMove()
  await Promise.all([first, rejected, second, creating])
  assert.deepEqual(order.slice(2).sort(), ['create', 'other'])
})
