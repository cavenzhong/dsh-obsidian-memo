/** 评论与开档任务实现；复用实例任务表、默认模型和逐文件写锁。 */
import { buildCommentRequest, generateText } from '../ai.js'
import { failure, readNoteFile, replaceNoteFile } from '../files.js'
import { appendComment } from '../notes.js'
import { localStamp } from '../shared.js'
import { readModelSource } from './note-content.js'

function createAiEndpoints({
  assertNotePath, ctx, finishJob, getSettings, invalidateScan, jobs,
  runningJob, startJob, withNoteWrite,
}) {
  async function runCommentJob(job, emoji) {
    try {
      const note = await readModelSource(job.path, getSettings().titleMode)
      const generated = await generateText(ctx, buildCommentRequest(note, emoji))
      await withNoteWrite(job.path, async () => {
        await assertNotePath(job.path)
        const original = await readNoteFile(job.path)
        const next = appendComment(original, {
          type: emoji.callout,
          title: `${emoji.emoji} ${emoji.label} · ${localStamp()}`,
          text: generated.text,
        })
        await replaceNoteFile(job.path, next)
        invalidateScan(job.path)
      })
      // 撞上 token 上限但有正文：内容已写入，Client 用 job.truncated 提示「可能被截断」。
      if (generated.truncated) job.truncated = true
      finishJob(job)
    } catch (error) {
      finishJob(job, error)
    }
  }

  async function endpointComment(payload) {
    const filePath = await assertNotePath(payload?.path)
    const emojiId = typeof payload?.emojiId === 'string' ? payload.emojiId : ''
    const emoji = getSettings().emojis.find((item) => item.id === emojiId)
    if (!emoji) throw failure('bad-request', '找不到这个 emoji 的配置')
    await readNoteFile(filePath)
    const running = runningJob('comment', filePath, emojiId)
    if (running !== undefined) return { jobId: running.id }
    const runningCount = [...jobs.values()].filter((job) => job.status === 'running').length
    if (runningCount >= 4) throw failure('busy', '同时运行的 AI 任务太多了，稍等一下')
    const job = startJob('comment', filePath, { emojiId })
    void runCommentJob(job, emoji)
    return { jobId: job.id }
  }

  return { endpointComment }
}
export { createAiEndpoints }
