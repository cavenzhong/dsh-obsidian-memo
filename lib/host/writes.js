/** 按真实文件路径串行写操作；失败不会阻塞后续写入。 */
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

function createWriteCoordinator() {
  const writes = new Map()

  const key = filePath => realpath(filePath).catch(() => resolve(filePath))
  async function lock(filePath, action) {
    const previous = writes.get(filePath) || Promise.resolve()
    const pending = previous.catch(() => {}).then(action)
    writes.set(filePath, pending)
    try { return await pending } finally {
      if (writes.get(filePath) === pending) writes.delete(filePath)
    }
  }

  async function withNoteWrite(filePath, action) { return lock(await key(filePath), action) }
  async function withNoteWrites(paths, action) {
    // Resolve once before acquiring either lock. Aliases cannot self-deadlock and
    // two transactions naming the same pair in reverse order cannot block each other.
    const keys = [...new Set(await Promise.all(paths.map(key)))].sort()
    const acquire = i => i === keys.length ? action() : lock(keys[i], () => acquire(i + 1))
    return acquire(0)
  }
  return { withNoteWrite, withNoteWrites }
}

export { createWriteCoordinator }
