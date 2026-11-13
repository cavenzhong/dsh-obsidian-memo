/** endpoint 分发、错误信封与写入/配置/删除操作的串行化规则。 */
import { resolve } from 'node:path'

function createDispatcher({ endpoints, queueSettings, withNoteWrite }) {
  let deleteQueue = Promise.resolve()

  async function dispatch(endpoint, payload) {
    // DSH 的 client-connection 解析器（0.2.x）要求失败信封带 details 对象；缺了会把业务错误当成 transport 错误。
    if (typeof endpoint !== 'string' || !Object.hasOwn(endpoints, endpoint)) {
      return { ok: false, error: { code: 'bad-request', message: `未知 endpoint：${endpoint}`, details: {} } }
    }
    const handler = endpoints[endpoint]
    try {
      const mutating = ['saveNote', 'toggleTask', 'archive', 'deleteNote', 'deleteComment', 'undoDeleteComment'].includes(endpoint)
      const run = () => mutating && typeof payload?.path === 'string'
        ? withNoteWrite(resolve(payload.path), () => handler(payload)) : handler(payload)
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
