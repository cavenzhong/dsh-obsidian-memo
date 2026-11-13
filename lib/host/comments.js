/** 评论删除与撤回；按序号定位 callout，撤回只在文件未被再次修改时整份写回。 */
import { atomicWrite, contentRevision, failure, readNoteFile } from '../files.js'
import { removeCommentAt } from '../comments.js'
import { makeId } from '../settings.js'
import { DELETE_UNDO_MS } from '../trash.js'
import { now } from './environment.js'

function createCommentEndpoints({ assertNotePath, commentUndos, invalidateAndScan, purgeExpiredState, scanner, withNoteWrite }) {
  async function endpointDeleteComment(payload) {
    const filePath = await assertNotePath(payload?.path)
    const index = Number(payload?.index)
    if (!Number.isInteger(index) || index < 0) throw failure('bad-request', '评论序号无效')
    if (typeof payload?.expectedTitle !== 'string') throw failure('bad-request', '缺少评论校验信息')
    const expectedTime = typeof payload?.expectedTime === 'string' ? payload.expectedTime : ''
    const original = await readNoteFile(filePath)
    const removed = removeCommentAt(original, index)
    if (removed === null) throw failure('conflict', '评论已变化，请刷新后再试')
    // 文件可能在抽屉打开后被外部编辑：序号对得上但内容已换人时拒绝删除。
    if (removed.comment.title !== payload.expectedTitle || (removed.comment.time || '') !== expectedTime) {
      throw failure('conflict', '评论已变化，请刷新后再试')
    }
    const afterRevision = contentRevision(removed.text)
    await atomicWrite(filePath, removed.text)
    purgeExpiredState()
    const undoToken = makeId('comment')
    const expiresAt = now() + DELETE_UNDO_MS
    commentUndos.set(undoToken, {
      path: filePath,
      before: removed.before,
      afterRevision,
      expires: expiresAt,
    })
    await invalidateAndScan(filePath)
    return {
      note: scanner.summary(filePath),
      undoToken,
      expiresAt,
      removed: { title: removed.comment.title, label: removed.comment.label },
    }
  }

  async function endpointUndoDeleteComment(payload) {
    const token = typeof payload?.undoToken === 'string' ? payload.undoToken : ''
    const entry = commentUndos.get(token)
    if (!entry || entry.expires <= now()) {
      commentUndos.delete(token)
      throw failure('not-found', '撤回窗口已过期')
    }
    // 撤回请求只带 token（不带路径），由端点自己对同一文件加写锁，避免与 AI 追加/编辑并发。
    return withNoteWrite(entry.path, async () => {
      const filePath = await assertNotePath(entry.path)
      const current = await readNoteFile(filePath)
      if (contentRevision(current) !== entry.afterRevision) {
        throw failure('conflict', '便签已再次修改，无法撤回这条评论')
      }
      await atomicWrite(filePath, entry.before)
      commentUndos.delete(token)
      await invalidateAndScan(filePath)
      return { restoredTo: filePath, note: scanner.summary(filePath) }
    })
  }

  return { endpointDeleteComment, endpointUndoDeleteComment }
}

export { createCommentEndpoints }
