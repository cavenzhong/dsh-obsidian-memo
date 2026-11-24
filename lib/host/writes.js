/** 按真实文件路径串行写操作；失败不会阻塞后续写入。 */
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

function createWriteCoordinator() {
  const writes = new Map()
  const sharedWrites = new Set()
  let vaultBarrier = Promise.resolve()

  // Obsidian can rewrite any linked note. While relocating, no Host Markdown writer can run.
  // Ordinary writes still run in parallel on different paths.
  function withVaultWrite(action, { exclusive = false } = {}) {
    if (exclusive) {
      const pending = Promise.all([vaultBarrier, ...sharedWrites]).then(action)
      vaultBarrier = pending.catch(() => {})
      return pending
    }
    const pending = vaultBarrier.then(action)
    const settled = pending.then(() => {}, () => {})
    sharedWrites.add(settled)
    settled.then(() => sharedWrites.delete(settled))
    return pending
  }

  const key = filePath => realpath(filePath).catch(() => resolve(filePath))
  async function lock(filePath, action) {
    const previous = writes.get(filePath) || Promise.resolve()
    const pending = previous.catch(() => {}).then(action)
    writes.set(filePath, pending)
    try { return await pending } finally {
      if (writes.get(filePath) === pending) writes.delete(filePath)
    }
  }

  function withNoteWrite(filePath, action, options) {
    return withVaultWrite(async () => lock(await key(filePath), action), options)
  }
  function withNoteWrites(paths, action, options) {
    return withVaultWrite(async () => {
      // Resolve once before acquiring either lock. Aliases cannot self-deadlock and
      // two transactions naming the same pair in reverse order cannot block each other.
      const keys = [...new Set(await Promise.all(paths.map(key)))].sort()
      const acquire = i => i === keys.length ? action() : lock(keys[i], () => acquire(i + 1))
      return acquire(0)
    }, options)
  }
  return { withNoteWrite, withNoteWrites, withVaultWrite }
}

export { createWriteCoordinator }
