/** endpoint 分发、错误信封与写入/配置/删除操作的串行化规则。 */
import { basename, extname, resolve } from 'node:path'

function createDispatcher({ endpoints, queueSettings, withNoteWrite, withVaultWrite = (action) => action() }) {
  let deleteQueue = Promise.resolve()

  async function dispatch(endpoint, payload) {
    // DSH 的 client-connection 解析器（0.2.x）要求失败信封带 details 对象；缺了会把业务错误当成 transport 错误。
    if (typeof endpoint !== 'string' || !Object.hasOwn(endpoints, endpoint)) {
      return { ok: false, error: { code: 'bad-request', message: `未知 endpoint：${endpoint}`, details: {} } }
    }
    const handler = endpoints[endpoint]
    try {
      // 撤回端点根据 token 自行加锁，不可因客户端附带 path 重复加锁。
      const mutating = ['saveNote', 'toggleTask', 'reorderTask', 'archive', 'moveNote', 'deleteNote', 'deleteComment'].includes(endpoint)
      const run = () => {
        if (!mutating || typeof payload?.path !== 'string') {
          return endpoint === 'createNote' ? withVaultWrite(() => handler(payload)) : handler(payload)
        }
        const path = resolve(payload.path)
        const renaming = endpoint === 'saveNote' && payload.name != null && payload.name !== basename(path, extname(path))
        const exclusive = renaming || endpoint === 'archive' || endpoint === 'moveNote'
        return withNoteWrite(path, () => handler(payload), { exclusive })
      }
      const deleting = endpoint === 'deleteNote' || endpoint === 'undoDelete' || endpoint === 'trash'
      const configuring = ['saveSettings', 'configFile', 'settings'].includes(endpoint)
      const pending = deleting ? deleteQueue.catch(() => {}).then(run) : configuring ? queueSettings(run) : run()
      if (deleting) deleteQueue = pending.catch(() => {})
      const value = await pending
      return { ok: true, value }
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'fs-failed'
      return { ok: false, error: { code, message: error?.message ?? String(error), details: {} } }
    }
  }

  return dispatch
}

export { createDispatcher }
