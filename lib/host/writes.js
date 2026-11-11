/** 按真实文件路径串行写操作；失败不会阻塞后续写入。 */
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

function createWriteCoordinator() {
  const writes = new Map()

  async function withNoteWrite(filePath, action) {
    filePath = await realpath(filePath).catch(() => resolve(filePath))
    const previous = writes.get(filePath) || Promise.resolve()
    const pending = previous.catch(() => {}).then(action)
    writes.set(filePath, pending)
    try { return await pending } finally {
      if (writes.get(filePath) === pending) writes.delete(filePath)
    }
  }

  return { withNoteWrite }
}

export { createWriteCoordinator }
